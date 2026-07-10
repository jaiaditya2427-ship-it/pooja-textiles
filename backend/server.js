import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import sharp from "sharp";

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "50mb" }));

const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY; // used only for temporary public image hosting
const PIXELAPI_KEY = process.env.PIXELAPI_KEY;

app.get("/", (req, res) => {
  res.json({
    status: "Pooja Textiles PixelAPI Try-On Backend 🚀",
    replicateKeySet: !!REPLICATE_API_KEY,
    pixelApiKeySet: !!PIXELAPI_KEY,
  });
});

// ── IMAGE PREPROCESS ─────────────────────────────────────────────────────────
// PixelAPI recommends: person photo 768x1024+, garment photo 512x512+
const preprocessImage = async (dataUrl, type) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const target =
      type === "garment" ? { width: 1024, height: 1024 } : { width: 1024, height: 1365 };

    const processed = await sharp(buffer)
      .rotate()
      .resize({
        width: target.width,
        height: target.height,
        fit: "inside",
        withoutEnlargement: false,
      })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();

    return `data:image/jpeg;base64,${processed.toString("base64")}`;
  } catch (err) {
    console.log("Preprocess failed:", err.message);
    return dataUrl;
  }
};

// ── UPLOAD TO GET A PUBLIC HTTPS URL ─────────────────────────────────────────
// PixelAPI requires publicly accessible URLs, not raw base64. We reuse
// Replicate's file storage (already have this key) purely as a temporary
// public host — has nothing to do with running a Replicate model here.
const uploadForPublicUrl = async (dataUrl) => {
  const base64 = dataUrl.split(",")[1];
  const buffer = Buffer.from(base64, "base64");

  const form = new FormData();
  form.append("content", new Blob([buffer], { type: "image/jpeg" }), "image.jpg");

  const response = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_KEY}`,
      // Do NOT set Content-Type manually — fetch sets the correct multipart boundary itself
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image hosting upload failed: ${errText}`);
  }

  const file = await response.json();
  const url = file.urls?.get || file.url;
  if (!url) throw new Error("No public URL returned from image host");
  return url;
};

// ── TRY-ON ROUTE (PixelAPI) ──────────────────────────────────────────────────
app.post("/tryon", async (req, res) => {
  const start = Date.now();
  console.log("\n── New PixelAPI Try-On Request ──");

  try {
    if (!PIXELAPI_KEY) {
      return res.status(500).json({ success: false, error: "PIXELAPI_KEY not set on server." });
    }
    if (!REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY not set on server (needed for image hosting)." });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "Missing images" });
    }

    console.log("⚡ preprocessing");
    const [personProcessed, clothProcessed] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(clothImg, "garment"),
    ]);

    console.log("⚡ uploading for public URLs");
    const [personUrl, garmentUrl] = await Promise.all([
      uploadForPublicUrl(personProcessed),
      uploadForPublicUrl(clothProcessed),
    ]);

    console.log("PERSON URL:", personUrl);
    console.log("GARMENT URL:", garmentUrl);

    // Map your app's garment label to PixelAPI's exact accepted category
    // enum: upperbody, lowerbody, dress, saree, lehenga, kurti, sherwani.
    // PixelAPI rejects anything else (it does NOT accept "upper_body" etc.),
    // and ethnic wear needs its own specific value rather than a generic
    // upper/lower/full split.
    const rawLabel = (garment?.label || "").toLowerCase();
    const rawCategory = garment?.category || "upper_body";

    let category;
    if (rawLabel.includes("lehenga")) category = "lehenga";
    else if (rawLabel.includes("kurta") || rawLabel.includes("kurti")) category = "kurti";
    else if (rawLabel.includes("saree") || rawLabel.includes("sari")) category = "saree";
    else if (rawLabel.includes("sherwani") || (rawCategory === "ethnic_wear" && rawLabel.includes("ethnic jacket"))) category = "sherwani";
    else if (rawLabel.includes("dress") || rawLabel.includes("gown") || rawCategory === "dresses") category = "dress";
    else if (rawCategory === "lower_body") category = "lowerbody";
    else category = "upperbody";

    console.log(`Category resolved: "${garment?.label}" (${rawCategory}) → "${category}"`);

    console.log("⚡ Submitting PixelAPI job...");
    const submitRes = await fetch("https://api.pixelapi.dev/v1/virtual-tryon", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PIXELAPI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        person_image: personUrl,
        garment_image: garmentUrl,
        category,
        n_steps: 30,
      }),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      console.error("PixelAPI submit error:", submitData);
      return res.status(400).json({
        success: false,
        error: submitData.detail || submitData.error || "Failed to start generation",
      });
    }

    const jobId = submitData.job_id;
    console.log(`Job submitted: ${jobId} (credits used: ${submitData.credits_used})`);

    // ── Poll for result ─────────────────────────────────────────────────────
    let output = null;
    const maxWaitMs = 90000;
    const intervalMs = 3000;
    let elapsed = 0;

    while (elapsed < maxWaitMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      elapsed += intervalMs;

      const pollRes = await fetch(`https://api.pixelapi.dev/v1/virtual-tryon/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${PIXELAPI_KEY}` },
      });
      const pollData = await pollRes.json();
      console.log(`[${elapsed / 1000}s] status: ${pollData.status}`);

      if (pollData.status === "completed") {
        output = pollData.output;
        break;
      }

      if (pollData.status === "failed") {
        console.error("PixelAPI job failed:", pollData.error);
        return res.status(500).json({ success: false, error: pollData.error || "AI generation failed" });
      }
    }

    if (!output) {
      return res.status(408).json({ success: false, error: "Timed out waiting for result. Please try again." });
    }

    // output is base64 (may or may not include the data: prefix)
    const imageDataUrl = output.startsWith("data:") ? output : `data:image/jpeg;base64,${output}`;

    console.log(`✅ DONE ${Date.now() - start}ms`);
    return res.json({ success: true, image: imageDataUrl });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/ping", (req, res) => {
  res.json({ alive: true, time: Date.now() });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Pooja Textiles Backend running on port ${PORT}`);
  console.log(`✅ PixelAPI key: ${PIXELAPI_KEY ? "SET ✓" : "NO ✗"}`);
  console.log(`✅ Replicate key (hosting only): ${REPLICATE_API_KEY ? "SET ✓" : "NO ✗"}`);
});