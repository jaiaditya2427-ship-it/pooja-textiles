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
const PIXELAPI_HEADERS_BASE = {
Authorization: `Bearer ${PIXELAPI_KEY}`,
"User-Agent": "PoojaTextilesFashionTryOn/1.0",
};
// HEALTH
app.get("/", (req, res) => {
res.json({
status: "Pooja Textiles Backend Running ",
pixelApiKeySet: !!PIXELAPI_KEY,
});
});
// ── IMAGE PREPROCESS (resize/rotate/compress before sending to PixelAPI) ──
const preprocessImage = async (dataUrl, type) => {
try {
const base64 = dataUrl.split(",")[1];
const buffer = Buffer.from(base64, "base64");
const size =
type === "person"
? { width: 1024, height: 1365 }
: { width: 1024, height: 1024 };

const processed = await sharp(buffer)
.rotate()
.resize({ width: size.width, height: size.height, fit: "inside" })
.jpeg({ quality: 95, mozjpeg: true })
.toBuffer();
return `data:image/jpeg;base64,${processed.toString("base64")}`;
} catch (e) {
console.log("Preprocess failed:", e.message);
return dataUrl;
}
};
const toRawBase64 = (img) => img.split(",")[1] || img;
// Human-readable garment description per type, used to prompt the fabric->garment step
const GARMENT_DESCRIPTIONS = {
"T-Shirt": "a men's plain crew-neck t-shirt",
"Shirt": "a men's collared button-up shirt",
"Pants / Jeans": "a pair of tailored trousers",
"Dress / Gown": "an elegant floor-length dress",
"Jacket / Coat": "a tailored jacket",
"Lehenga": "a traditional Indian lehenga skirt with matching blouse",
"Kurta / Kurti": "a traditional Indian kurta",
"Ethnic Jacket": "a traditional embroidered ethnic jacket",
};
// ── STEP 1: turn a flat fabric/texture photo into a realistic garment product photo ──
// Uses PixelAPI's instruction-based image editing endpoint (POST /v1/image/edit).
// This is the step that was missing — sending raw fabric straight to try-on gives
// bad results because there's no real garment shape, folds, or shading in it.
const generateGarmentFromFabric = async (fabricDataUrl, garmentLabel) => {
const description = GARMENT_DESCRIPTIONS[garmentLabel] || "a garment";
const prompt =
`Transform this fabric swatch into a professional product photo of ${description} ` +
`made from this exact fabric, color and texture. Show it on an invisible mannequin ` +
`(ghost mannequin style) or flat lay, with realistic folds, shading, and stitching. ` +
`Studio lighting, plain white background, full garment clearly visible, high resolution.`;
const submit = await fetch("https://api.pixelapi.dev/v1/image/edit", {
method: "POST",
headers: {
...PIXELAPI_HEADERS_BASE,
"Content-Type": "application/json",
},

body: JSON.stringify({
image: fabricDataUrl,
prompt,
}),
});
const submitData = await submit.json();
if (!submit.ok) {
throw new Error(submitData.error || "Fabric-to-garment step failed to start");
}
const generationId = submitData.generation_id;
let waited = 0;
while (waited < 120000) {
await new Promise((r) => setTimeout(r, 3000));
waited += 3000;
const poll = await fetch(
`https://api.pixelapi.dev/v1/image/edit/${generationId}`,
{ headers: PIXELAPI_HEADERS_BASE }
);
const result = await poll.json();
console.log("garment-gen status:", result.status);
if (result.status === "completed") {
// Fetch the output image and convert to a data URL for the next step
const imgRes = await fetch(result.output_url);
const arrBuf = await imgRes.arrayBuffer();
const b64 = Buffer.from(arrBuf).toString("base64");
return `data:image/png;base64,${b64}`;
}
if (result.status === "failed") {
throw new Error("Fabric-to-garment generation failed");
}
}
throw new Error("Fabric-to-garment generation timed out");
};
// Frontend already tags each garment with a correct semantic category —
// map that to what PixelAPI's try-on endpoint actually accepts:
// upperbody | lowerbody | dress
const CATEGORY_MAP = {
upper_body: "upperbody",
lower_body: "lowerbody",
dresses: "dress",

ethnic_wear: "upperbody", // no ethnic-specific category in PixelAPI; upperbody fits best
};
// ── TRY ON ROUTE ──
app.post("/tryon", async (req, res) => {
const start = Date.now();
try {
if (!PIXELAPI_KEY) {
return res.status(500).json({ success: false, error: "PIXELAPI key missing" });
}
const { personImg, clothImg, garment } = req.body;
if (!personImg || !clothImg) {
return res.status(400).json({ success: false, error: "Images missing" });
}
console.log("Step 1: fabric → realistic garment photo");
const realGarmentImg = await generateGarmentFromFabric(clothImg, garment?.label);
console.log("Step 2: preprocessing images");
const [personProcessed, clothProcessed] = await Promise.all([
preprocessImage(personImg, "person"),
preprocessImage(realGarmentImg, "garment"),
]);
const category = CATEGORY_MAP[garment?.category] || "upperbody";
console.log("PixelAPI category:", category);
console.log("Step 3: submitting try-on job");
const submit = await fetch("https://api.pixelapi.dev/v1/virtual-tryon", {
method: "POST",
headers: {
...PIXELAPI_HEADERS_BASE,
"Content-Type": "application/json",
},
body: JSON.stringify({
person_image: toRawBase64(personProcessed),
garment_image: toRawBase64(clothProcessed),
category,
}),
});
const data = await submit.json();
if (!submit.ok) {
return res.status(400).json({ success: false, error: data.error || "PixelAPI failed" });
}

let output = null;
let waited = 0;
while (waited < 600000) {
await new Promise((r) => setTimeout(r, 3000));
waited += 3000;
const poll = await fetch(
`https://api.pixelapi.dev/v1/virtual-tryon/jobs/${data.job_id}`,
{ headers: PIXELAPI_HEADERS_BASE }
);
const result = await poll.json();
console.log("tryon status:", result.status);
if (result.status === "completed") {
output = result.result_image_b64;
break;
}
if (result.status === "failed") {
throw new Error("AI generation failed");
}
}
if (!output) {
return res.status(408).json({ success: false, error: "Timeout" });
}
res.json({ success: true, image: `data:image/png;base64,${output}` });
console.log("DONE", Date.now() - start, "ms");
} catch (e) {
console.log(e);
res.status(500).json({ success: false, error: e.message });
}
});
app.get("/ping", (req, res) => res.json({ alive: true }));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
console.log(` Backend running ${PORT}`);
});