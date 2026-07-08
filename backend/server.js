import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "50mb" }));

const API_KEY = process.env.REPLICATE_API_KEY;

app.get("/", (req, res) => {
  res.json({ status: "Fashion Try-On Backend is running 🚀", apiKeySet: !!API_KEY });
});

app.post("/tryon", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY is not set" });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required" });
    }

    const uploadImage = async (dataUrl) => {
      const base64 = dataUrl.split(",")[1];
      const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
      const buffer = Buffer.from(base64, "base64");

      const uploadRes = await fetch("https://api.replicate.com/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Token ${API_KEY}`,
          "Content-Type": mimeType,
          "Content-Length": buffer.length,
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        console.error("Upload error:", err);
        return dataUrl;
      }

      const file = await uploadRes.json();
      console.log("Uploaded file URL:", file.urls?.get || file.url);
      return file.urls?.get || file.url || dataUrl;
    };

    console.log("Uploading images...");
    const personUrl = await uploadImage(personImg);
    const clothUrl = await uploadImage(clothImg);
    console.log("Images uploaded!");

    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4",
        input: {
          human_img: personUrl,
          garm_img: clothUrl,
          garment_des: garment?.label
            ? `a ${garment.label.toLowerCase()}, exact original collar/neckline shape, exact sleeve length, exact fit, realistic ecommerce fashion photography`
            : "clothing item, exact original structure and fit, realistic ecommerce fashion photography",
          category: garment?.category || "upper_body",
          is_checked: true,
          is_checked_crop: false,
          denoise_steps: 40,
          seed: Math.floor(Math.random() * 1000000),
        },
      }),
    });

    const prediction = await createRes.json();

    if (!createRes.ok) {
      console.error("Replicate create error:", prediction);
      return res.status(400).json({ success: false, error: prediction.detail || prediction.error || "Failed to start AI generation" });
    }

    console.log(`Prediction created: ${prediction.id}`);

    let output = null;

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { Authorization: `Token ${API_KEY}` },
      });

      const data = await pollRes.json();
      console.log(`Poll ${i + 1}: status = ${data.status}`);

      if (data.status === "succeeded") {
        console.log("Raw output:", JSON.stringify(data.output));

        const raw = data.output;
        if (typeof raw === "string") {
          output = raw;
        } else if (Array.isArray(raw)) {
          const first = raw[0];
          if (typeof first === "string") output = first;
          else if (first?.url) output = first.url;
          else output = String(first);
        } else if (raw && typeof raw === "object") {
          output = raw.url || raw.image || Object.values(raw)[0];
        }

        console.log("Final image URL:", output);
        break;
      }

      if (data.status === "failed") {
        console.error("Prediction failed:", data.error);
        return res.status(500).json({ success: false, error: data.error || "AI model failed" });
      }
    }

    if (!output) {
      return res.status(408).json({ success: false, error: "Timed out. Please try again." });
    }

    return res.json({ success: true, image: output });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ success: false, error: err.message || "Unexpected server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`✅ Replicate API key: ${API_KEY ? "SET ✓" : "NOT SET ✗"}`);
});