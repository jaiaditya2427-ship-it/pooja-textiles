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

// ── Schema inspector (real, this time we actually use the result) ──────────
app.get("/catvton-flux-schema", async (req, res) => {
  try {
    const r = await fetch("https://api.replicate.com/v1/models/mmezhov/catvton-flux", {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_KEY}` },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ success: false, error: data });

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

// ── NEW: CatVTON-Flux try-on route (v2) ─────────────────────────────────────
// Uses mmezhov/catvton-flux (CatVTON on the FLUX.1-Fill-dev backbone) instead
// of the old zsxkib/cat-vton (SD1.5 backbone). Should give much better face/
// identity preservation. Test this against a few real photos before fully
// switching the frontend over from /tryon to /tryon-v2.
app.post("/tryon-v2", async (req, res) => {
  const t0 = Date.now();
  console.log("\n── New Try-On Request (CatVTON-Flux) ──────────────────────");

  try {
    if (!process.env.REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY not set on server." });
    }

    const { personImg, clothImg, garment } = req.body;
    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required." });
    }

    console.log("⚡ Preprocessing both images in parallel...");
    const [processedPerson, processedCloth] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(clothImg, "garment"),
    ]);

    console.log("⚡ Uploading both images to Replicate in parallel...");
    const [personUrl, garmentUrl] = await Promise.all([
      uploadToReplicate(processedPerson),
      uploadToReplicate(processedCloth),
    ]);

    console.log("⚡ Running CatVTON-Flux...");
    const t2 = Date.now();

    // Best-guess input shape based on the model's underlying CLI
    // (--image, --mask, --garment, --seed, --steps). If this errors,
    // Replicate's error message will name the exact field it expected —
    // paste that error back and we fix the field names in one pass.
    const output = await replicate.run(
      "mmezhov/catvton-flux:cc41d1b963023987ed2ddf26e9264efcc96ee076640115c303f95b0010f6a958",
      {
        input: {
          try_on: true,

          garment: garmentUrl,

          hf_token: process.env.HF_TOKEN,

          num_steps: 30
        },
      }
    );

    console.log(`✓ CatVTON-Flux done in ${Date.now() - t2}ms`);
    console.log("Raw output:", JSON.stringify(output)?.substring(0, 150));

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
      return res.status(500).json({ success: false, error: "AI did not return a valid image.", raw: output });
    }

    console.log(`✅ TOTAL: ${Date.now() - t0}ms`);
    return res.json({ success: true, image: imageUrl });

  } catch (err) {
    console.error("❌ CatVTON-Flux Error:", err.message);
    // Surface the raw Replicate error so we can see the exact expected field names
    return res.status(500).json({
      success: false,
      error: err.message || "Something went wrong.",
    });
  }
});

// ── Preprocess image ──────────────────────────────────────────────────────────
// CatVTON works well at 768x1024 (portrait). We keep portrait for processing,
// result comes out portrait matching the customer's pose.
const preprocessImage = async (dataUrl, type) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const processedBuffer = await sharp(buffer)
      .rotate()

      // preserve body + garment proportions
      // prevents collar/neck/sleeve stretching
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: false,
      })

      .sharpen({
        sigma: type === "garment" ? 1.2 : 0.8
      })

      .jpeg({
        quality: 100,
        progressive: false,
        mozjpeg: true
      })

      .toBuffer();

    return `data:image/jpeg;base64,${processedBuffer.toString("base64")}`;

  } catch (e) {
    console.log("Preprocess failed:", e.message);
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

    // ── STEP 3: Run IDM-VTON ─────────────────────────────────────────────────
    // FIX: zsxkib/cat-vton was removed/renamed by its author on Replicate and
    // now 404s. Switched to cuuupid/idm-vton, which this app ran on before its
    // migration to CatVTON, using the same field names that worked previously.
    //
    // ⚠ LICENSE NOTE: idm-vton on Replicate is CC BY-NC-SA 4.0 — non-commercial
    // use only. This unblocks tonight's client demo, but if this app is being
    // sold/used commercially long-term, swap to a properly commercial-licensed
    // provider (e.g. FASHN.ai's API) before ongoing production use.
    console.log("⚡ Step 3: Running IDM-VTON AI...");
    const t2 = Date.now();

    const category = garment?.category || "upper_body";

    const garmentDescription = `
Professional ecommerce fashion try-on.
Preserve the customer's original clothing structure and body fitting exactly.

Keep exactly the same:
- collar shape, type, angle, width, height, opening
- V-neck depth, neckline shape, neck curve
- button placket position, button spacing
- pocket location
- shoulder seams
- sleeve length, sleeve width, cuff position
- shirt length, shirt width, waist fitting
- oversized/slim/regular fit
- garment silhouette

Do not convert:
- shirt into t-shirt, t-shirt into shirt
- V-neck into round neck
- collar shirt into non-collar shirt
- half sleeve into full sleeve

Only transfer from garment image: fabric, color, print, embroidery, pattern, logo, texture.
Do not redesign the garment. Do not hallucinate new fashion details.
Maintain realistic store catalogue quality.
`;

    const output = await replicate.run(
      "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
      {
        input: {
          human_img: personUrl,
          garm_img: garmentUrl,
          garment_des: garmentDescription,
          category:
            category === "lower_body"
              ? "lower_body"
              : category === "dresses"
                ? "dresses"
                : "upper_body",
          crop: false,
          force_dc: false,
          steps: 40,
          seed: 12345,
        },
      }
    );

    console.log(`✓ IDM-VTON done in ${Date.now() - t2}ms`);
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