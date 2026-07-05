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
  res.json({
    status: "Pooja Textiles AI Try-On Backend 🚀",
    apiKeySet: !!process.env.REPLICATE_API_KEY,
  });
});

// ── Preprocess image ──────────────────────────────────────────────────────────
// CatVTON works well at 768x1024 (portrait). We keep portrait for processing,
// result comes out portrait matching the customer's pose.
const preprocessImage = async (dataUrl, type) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const processedBuffer = await sharp(buffer)
      .rotate() // auto-orient using EXIF data (fixes photos coming out rotated/vertical)
      .resize(768, 1024, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
        position: "center",
      })
      .sharpen({ sigma: type === "garment" ? 1.8 : 1.0 })
      .jpeg({ quality: 90, progressive: false })
      .toBuffer();

    return `data:image/jpeg;base64,${processedBuffer.toString("base64")}`;
  } catch (e) {
    console.log("Preprocess failed, using original:", e.message);
    return dataUrl;
  }
};

// ── Upload image to Replicate file storage ────────────────────────────────────
const uploadToReplicate = async (dataUrl) => {
  try {
    const base64   = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
    const buffer   = Buffer.from(base64, "base64");

    const res = await fetch("https://api.replicate.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
        "Content-Type": mimeType,
        "Content-Length": buffer.length,
      },
      body: buffer,
    });

    if (!res.ok) return dataUrl;
    const file = await res.json();
    const url = file.urls?.get || file.url || dataUrl;
    console.log("✓ Uploaded:", url.substring(0, 55) + "...");
    return url;
  } catch (e) {
    console.log("Upload failed, using base64");
    return dataUrl;
  }
};

// ── Main try-on route ─────────────────────────────────────────────────────────
app.post("/tryon", async (req, res) => {
  const t0 = Date.now();
  console.log("\n── New Try-On Request ──────────────────────────────");

  try {
    if (!process.env.REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY not set on server." });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required." });
    }

    // ── STEP 1: Preprocess both images in parallel ────────────────────────
    console.log("⚡ Step 1: Preprocessing both images in parallel...");
    const [processedPerson, processedCloth] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(clothImg, "garment"),
    ]);
    console.log(`✓ Preprocessed in ${Date.now() - t0}ms`);

    // ── STEP 2: Upload BOTH to Replicate in parallel ──────────────────────
    // Uploading gives Replicate a stable URL = faster model loading
    console.log("⚡ Step 2: Uploading both images to Replicate in parallel...");
    const t1 = Date.now();
    const [personUrl, garmentUrl] = await Promise.all([
      uploadToReplicate(processedPerson),
      uploadToReplicate(processedCloth),
    ]);
    console.log(`✓ Both uploaded in ${Date.now() - t1}ms`);

    // ── STEP 3: Run CatVTON ─────────────────────────────────────────────────
    console.log("⚡ Step 3: Running CatVTON AI...");
    const t2 = Date.now();

    const category = garment?.category || "upper_body";

    const output = await replicate.run(
      "zsxkib/cat-vton",
      {
        input: {
          person_image: personUrl,
          cloth_image: garmentUrl,

          cloth_type:
            category === "lower_body"
              ? "lower"
              : category === "dresses"
              ? "overall"
              : "upper",

          // Lowered from 50 → 30. CatVTON's own quality curve flattens out
          // well before 50 steps for this kind of garment-transfer task —
          // this alone typically cuts model runtime by ~35-40% with no
          // visible quality difference. Bump back toward 40-45 only if you
          // start noticing texture/edge artifacts on tricky prints.
          num_inference_steps: 30,

          // Slightly higher than before (3.5 → 4.0): pulls the output
          // closer to the garment image's exact print/pattern/color instead
          // of letting the model "reinterpret" it, which is what most
          // "wrong fit" complaints usually come down to. If results start
          // looking over-sharpened or artifact-y, dial back to 3.5.
          guidance_scale: 4.0,

          seed: Math.floor(Math.random() * 999999),
        },
      }
    );

    console.log(`✓ CatVTON done in ${Date.now() - t2}ms`);
    console.log("Raw output:", JSON.stringify(output).substring(0, 120));

    // ── STEP 4: Extract image URL from output ─────────────────────────────
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

    if (!imageUrl?.startsWith("http")) {
      console.error("No valid image URL in output:", output);
      return res.status(500).json({ success: false, error: "AI did not return a valid image. Please try again." });
    }

    console.log(`✅ TOTAL: ${Date.now() - t0}ms`);
    console.log("Final URL:", imageUrl.substring(0, 70) + "...");

    return res.json({ success: true, image: imageUrl });

  } catch (err) {
    console.error("❌ Error:", err.message);

    // ── Friendly error messages ───────────────────────────────────────────
    if (err.message?.includes("list index out of range")) {
      return res.status(400).json({
        success: false,
        error: "Could not detect the person clearly in the photo. Please use a well-lit photo where the full person is visible and standing straight.",
      });
    }

    if (err.message?.includes("NSFW")) {
      return res.status(400).json({
        success: false,
        error: "Photo was flagged. Please use a clear, appropriate photo.",
      });
    }

    if (err.message?.includes("insufficient")) {
      return res.status(402).json({
        success: false,
        error: "AI service credits exhausted. Please contact support.",
      });
    }

    return res.status(500).json({
      success: false,
      error: err.message || "Something went wrong. Please try again.",
    });
  }
});

// ── Health check with timing ──────────────────────────────────────────────────
app.get("/ping", (req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n✅ Pooja Textiles Backend running on port ${PORT}`);
  console.log(`✅ Replicate API key: ${process.env.REPLICATE_API_KEY ? "SET ✓" : "NOT SET ✗"}`);
  console.log(`✅ Ready to serve try-on requests\n`);
});