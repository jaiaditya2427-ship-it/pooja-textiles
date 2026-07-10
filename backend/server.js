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

const PIXELAPI_KEY = process.env.PIXELAPI_KEY;
// PixelAPI's CDN blocks requests without a proper User-Agent header (see their
// troubleshooting docs) — always send one.
const PIXELAPI_HEADERS_BASE = {
  Authorization: `Bearer ${PIXELAPI_KEY}`,
  "User-Agent": "PoojaTextilesFashionTryOn/1.0",
};

app.get("/", (req, res) => {
  res.json({
    status: "Pooja Textiles PixelAPI Try-On Backend 🚀",
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
// ── FABRIC TO VIRTUAL GARMENT ────────────────────────────────────────────────
const createVirtualGarment = async (fabricDataUrl) => {
  try {
    console.log("👕 Creating virtual garment from fabric");

    const base64 = fabricDataUrl.split(",")[1];
    const fabricBuffer = Buffer.from(base64, "base64");

    const shirtShape = Buffer.from(`
      <svg width="1024" height="1024">
        <path d="
        M350 120
        L512 60
        L674 120
        L900 300
        L760 520
        L690 420
        L690 950
        L334 950
        L334 420
        L264 520
        L124 300
        Z"
        fill="white"/>
      </svg>
    `);

    const fabric = await sharp(fabricBuffer)
      .resize(1024, 1024)
      .toBuffer();

    const garment = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([
        {
          input: fabric,
          blend: "over"
        },
        {
          input: shirtShape,
          blend: "dest-in"
        }
      ])
      .png()
      .toBuffer();


    return `data:image/png;base64,${garment.toString("base64")}`;

  } catch (err) {
    console.log("Fabric conversion failed:", err.message);
    return fabricDataUrl;
  }
};
// Strip the "data:image/...;base64," prefix — PixelAPI wants the raw base64
// string only, not a data URL and not a public URL.
const toRawBase64 = (dataUrl) => dataUrl.split(",")[1] || dataUrl;

// ── TRY-ON ROUTE (PixelAPI) ──────────────────────────────────────────────────
app.post("/tryon", async (req, res) => {
  const start = Date.now();
  console.log("\n── New PixelAPI Try-On Request ──");

  try {
    if (!PIXELAPI_KEY) {
      return res.status(500).json({ success: false, error: "PIXELAPI_KEY not set on server." });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "Missing images" });
    }

    console.log("⚡ creating garment from fabric");

    const virtualCloth = await createVirtualGarment(clothImg);
    console.log(
      "Virtual garment created:",
      virtualCloth.length
    );

    console.log("⚡ preprocessing");

    const [personProcessed, clothProcessed] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(virtualCloth, "garment"),
    ]);
    // PixelAPI's /v1/virtual-tryon endpoint takes raw base64 image strings
    // directly in the JSON body — no separate upload/hosting step needed.
    const personB64 = toRawBase64(personProcessed);
    const garmentB64 = toRawBase64(clothProcessed);

    // Map your app's garment label to PixelAPI's accepted category enum.
    // PixelAPI rejects anything else (it does NOT accept "upper_body" etc.).
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
        ...PIXELAPI_HEADERS_BASE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        person_image: personB64,
        garment_image: garmentB64,
        category,
      }),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      console.error("PixelAPI submit error:", JSON.stringify(submitData));
      const detail = submitData.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : detail?.message || detail?.error || submitData.error || "Failed to start generation";
      return res.status(400).json({ success: false, error: msg });
    }

    const jobId = submitData.job_id;
    console.log(`Job submitted: ${jobId} (credits used: ${submitData.credits_used})`);

    // ── Poll for result ─────────────────────────────────────────────────────
    let output = null;
    const maxWaitMs = 10 * 60 * 1000; // waits 10 minutes
    const intervalMs = 3000;
    let elapsed = 0;

    while (elapsed < maxWaitMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      elapsed += intervalMs;

      const pollRes = await fetch(`https://api.pixelapi.dev/v1/virtual-tryon/jobs/${jobId}`, {
        headers: PIXELAPI_HEADERS_BASE,
      });
      const pollData = await pollRes.json();
      console.log(`[${elapsed / 1000}s] status: ${pollData.status}`);

      if (pollData.status === "completed") {
        // PixelAPI returns the result under "result_image_b64", not "output".
        output = pollData.result_image_b64;
        break;
      }

      if (pollData.status === "failed") {
        console.error("PixelAPI job failed:", pollData.error_message || pollData.error);
        return res.status(500).json({
          success: false,
          error: pollData.error_message || pollData.error || "AI generation failed",
        });
      }
    }

    if (!output) {
      return res.status(408).json({ success: false, error: "Timed out waiting for result. Please try again." });
    }

    // Result comes back as a base64 PNG (no prefix) — wrap it as a data URL.
    const imageDataUrl = output.startsWith("data:") ? output : `data:image/png;base64,${output}`;

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
});
