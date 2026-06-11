import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import Replicate from "replicate";
import sharp from "sharp";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "50mb" }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

app.get("/", (req, res) => {
  res.json({ status: "Fashion Try-On Backend is running 🚀", apiKeySet: !!process.env.REPLICATE_API_KEY });
});

// ── Image preprocessing for maximum accuracy ──────────────────────────────────
const preprocessImage = async (dataUrl, type) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
    const buffer = Buffer.from(base64, "base64");

    let processedBuffer;

    if (type === "person") {
      // Person photo: resize to optimal 768x1024, enhance contrast and sharpness
      processedBuffer = await sharp(buffer)
        .resize(768, 1024, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
          withoutEnlargement: false,
        })
        .sharpen({ sigma: 1.2, m1: 0.5, m2: 0.5 })
        .normalise()
        .jpeg({ quality: 95, progressive: true })
        .toBuffer();
    } else {
      // Garment photo: resize to 768x1024, white background, max sharpness
      processedBuffer = await sharp(buffer)
        .resize(768, 1024, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
          withoutEnlargement: false,
        })
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5 })
        .normalise()
        .jpeg({ quality: 98, progressive: true })
        .toBuffer();
    }

    const processed64 = processedBuffer.toString("base64");
    return `data:image/jpeg;base64,${processed64}`;
  } catch (e) {
    console.log("Preprocessing failed, using original:", e.message);
    return dataUrl;
  }
};

// ── Upload to Replicate storage ───────────────────────────────────────────────
const uploadToReplicate = async (dataUrl) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
    const buffer = Buffer.from(base64, "base64");

    const uploadRes = await fetch("https://api.replicate.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
        "Content-Type": mimeType,
        "Content-Length": buffer.length,
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      console.log("Upload failed, using base64 directly");
      return dataUrl;
    }

    const file = await uploadRes.json();
    const url = file.urls?.get || file.url || dataUrl;
    console.log("Uploaded to Replicate:", url.substring(0, 60) + "...");
    return url;
  } catch (e) {
    console.log("Upload error, using base64:", e.message);
    return dataUrl;
  }
};

// ── Garment description builder for maximum accuracy ─────────────────────────
const buildGarmentDescription = (garment) => {
  const descriptions = {
    "T-Shirt / Shirt": "upper body garment shirt or t-shirt - preserve exact sleeve length whether short half or full long sleeve, preserve exact collar style v-neck round-neck polo collar, preserve exact fit slim regular loose oversized, preserve all design details prints patterns colors exactly",
    "Pants / Jeans":   "lower body garment pants jeans trousers - preserve exact length full length cropped ankle length, preserve exact fit slim straight wide leg, preserve exact waistband style, preserve all design details color wash distressing exactly",
    "Dress / Gown":    "full body dress gown - preserve exact length mini midi maxi, preserve exact sleeve style sleeveless short long, preserve exact neckline collar style, preserve silhouette A-line fitted flowy, preserve all design details exactly",
    "Jacket / Coat":   "outerwear jacket coat - preserve open or closed front style, preserve exact sleeve length, preserve lapel collar style, preserve exact length cropped regular long, preserve all buttons zippers design details exactly",
  };
  return descriptions[garment?.label] || `${garment?.label || "clothing"} - preserve all garment details sleeve length collar neckline fit measurements exactly as shown in garment image`;
};

app.post("/tryon", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY is not set" });
    }

    const { personImg, clothImg, garment } = req.body;
    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required" });
    }

    // ── Step 1: Preprocess both images for maximum accuracy ───────────────
    console.log("Step 1: Preprocessing images for optimal quality...");
    const [processedPerson, processedCloth] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(clothImg, "garment"),
    ]);
    console.log("Images preprocessed!");

    // ── Step 2: Remove background from person photo ───────────────────────
    console.log("Step 2: Removing background for cleaner body detection...");
    let cleanPersonImg = processedPerson;
    try {
      const bgRemoveOutput = await replicate.run(
        "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
        { input: { image: processedPerson } }
      );
      const bgUrl = Array.isArray(bgRemoveOutput) ? String(bgRemoveOutput[0]) : String(bgRemoveOutput);
      if (bgUrl.startsWith("http")) {
        cleanPersonImg = bgUrl;
        console.log("Background removed successfully!");
      }
    } catch (e) {
      console.log("BG removal failed, continuing with original:", e.message);
    }

    // ── Step 3: Upload garment to Replicate for better processing ─────────
    console.log("Step 3: Uploading garment image...");
    const garmentUrl = await uploadToReplicate(processedCloth);

    // ── Step 4: Build detailed garment description ────────────────────────
    const garmentDescription = buildGarmentDescription(garment);
    console.log("Garment description:", garmentDescription.substring(0, 80) + "...");

    // ── Step 5: Run IDM-VTON with maximum quality settings ────────────────
    console.log("Step 4: Running AI try-on with maximum quality settings...");
    const output = await replicate.run(
      "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
      {
        input: {
          human_img:       cleanPersonImg,
          garm_img:        garmentUrl,
          garment_des:     garmentDescription,
          category:        garment?.category || "upper_body",

          // ✅ Maximum accuracy settings
          is_checked:      true,   // auto-masking for better body detection
          is_checked_crop: true,   // handles partial/half body
          denoise_steps: 60,     // 30→50: much better detail preservation
          guidance_scale: 3.5,    // sharper garment detail transfer
          seed:            Math.floor(Math.random() * 99999), // random = better results
        }
      }
    );

    console.log("Output received:", JSON.stringify(output).substring(0, 100));

    // ── Extract URL ───────────────────────────────────────────────────────
    let imageUrl = null;
    if (Array.isArray(output)) {
      for (const item of output) {
        const str = String(item);
        if (str.startsWith("http")) { imageUrl = str; break; }
        if (item?.url) { imageUrl = String(item.url); break; }
      }
    } else if (output) {
      const str = String(output);
      if (str.startsWith("http")) imageUrl = str;
    }

    console.log("Final image URL:", imageUrl);

    if (!imageUrl || !imageUrl.startsWith("http")) {
      return res.status(500).json({ success: false, error: "Could not get image from AI" });
    }

    return res.json({ success: true, image: imageUrl });

  } catch (err) {
    console.error("Error:", err.message);

    if (err.message?.includes("list index out of range")) {
      return res.status(400).json({
        success: false,
        error: "Person not detected clearly. Please use a photo where the full person is visible — standing straight works best.",
      });
    }

    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`✅ API key: ${process.env.REPLICATE_API_KEY ? "SET ✓" : "NOT SET ✗"}`);
});