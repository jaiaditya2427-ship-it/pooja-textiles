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
}); // ── TEMPORARY: schema inspector ─────────────────────────────────────────────
app.get("/catvton-flux-schema", async (req, res) => {
  try {
    const r = await fetch("https://api.replicate.com/v1/models/mmezhov/catvton-flux", {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_KEY}` },
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ success: false, error: data });
    }

    const schema = data?.latest_version?.openapi_schema;
    const inputProps = schema?.components?.schemas?.Input?.properties || null;
    const requiredFields = schema?.components?.schemas?.Input?.required || [];

    return res.json({
      success: true,
      model_version_id: data?.latest_version?.id,
      required_fields: requiredFields,
      input_fields: inputProps,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── Preprocess image ──────────────────────────────────────────────────────────
// IDM-VTON works best at exactly 768x1024 (portrait)
// We keep portrait for processing, result comes out portrait matching customer pose
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
      .jpeg({ quality: 100, progressive: false })
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
    const base64 = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
    const buffer = Buffer.from(base64, "base64");

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

// ── Garment descriptions ──────────────────────────────────────────────────────
// Detailed prompts help IDM-VTON preserve garment details accurately
const buildGarmentDescription = (garment) => {
  const map = {
    "T-Shirt":
      "Upper body t-shirt. Preserve exact sleeve length, neckline (round, crew, V-neck, Henley), fit (slim, regular, oversized), stitching, graphics, logos, prints, colors and fabric texture exactly as shown. Never convert into a collared shirt.",

    "Shirt": `
The customer is already wearing a collared shirt.

Only transfer the uploaded shirt's fabric, print, embroidery, texture, pattern and color.

Do not redesign the customer's shirt.

Preserve exactly:

- Collar type
- Collar shape
- Collar size
- Collar height
- Collar opening
- Sleeve length
- Half sleeve
- Full sleeve
- Shoulder seams
- Armhole position
- Chest pocket
- Pocket position
- Button placket
- Buttons
- Cuffs
- Shirt length
- Hem
- Fit
- Slim Fit
- Regular Fit
- Relaxed Fit
- Oversized Fit

Supported collars:

- Shirt Collar
- Spread Collar
- Button Down Collar
- Button Up Collar
- Band Collar
- Chinese Collar
- Mandarin Collar
- Regular Collar

Only replace:

- Fabric
- Print
- Pattern
- Texture
- Embroidery
- Logo
- Color

Never convert into a T-Shirt.

Never change collar style.

Never change sleeve length.

Never reconstruct the shirt.

Keep the customer's original shirt geometry exactly the same while transferring only the visual appearance of the uploaded shirt.
`,

    "Pants / Jeans":
      "Lower body pants or jeans. Preserve exact waist, length, fit, pockets, zipper, stitching, wash, color and fabric texture exactly.",

    "Dress / Gown":
      "Full body dress or gown. Preserve exact neckline, sleeves, silhouette, fit, embroidery, colors, length and fabric exactly.",

    "Jacket / Coat":
      "Outerwear jacket or coat. Preserve zipper, buttons, lapels, collar, pockets, sleeve length, fit and fabric exactly.",

    "Lehenga":
      "Indian ethnic lehenga. Preserve embroidery, mirror work, dupatta, flare, colors, borders and fabric exactly.",

    "Kurta / Kurti":
      "Indian kurta or kurti. Preserve neckline, collar, sleeve length, embroidery, prints, colors and fabric exactly.",

    "Ethnic Jacket":
      "Indian ethnic jacket. Preserve collar, buttons, embroidery, fit, fabric and colors exactly.",
  };
  return (
    map[garment?.label] ||
    `${garment?.label || "clothing"} - preserve all design details, colors, patterns, sleeve length, collar and fit exactly as shown in the garment image.
    Preserve garment geometry exactly.

Preserve collar angle.

Preserve collar width.

Preserve collar height.

Preserve neckline depth.

Preserve shoulder seam position.

Preserve sleeve attachment.

Preserve sleeve circumference.

Preserve button spacing.

Preserve shirt silhouette.

Preserve shirt dimensions.

Replace ONLY the fabric appearance.

Do not alter garment construction under any circumstances.`
  );
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

    // ── STEP 3: Run CatVTON ─────────────────────────────
    console.log("⚡ Step 3: Running CatVTON AI...");
    const t2 = Date.now();

    const category = garment?.category || "upper_body";

    const output = await replicate.run(
      "mmezhov/catvton-flux:cc41d1b963023987ed2ddf26e9264efcc96ee076640115c303f95b0010f6a958",
      {
        input: {
          person_image: personUrl,

          cloth_image: garmentUrl,

          hf_token: process.env.HF_TOKEN,

          cloth_type:
            category === "lower_body"
              ? "lower"
              : category === "dresses"
                ? "overall"
                : "upper",

          num_inference_steps: 50,

          guidance_scale: 3.5,

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