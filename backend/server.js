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
    status: "Pooja Textiles Backend Running 🚀",
    pixelApiKeySet: !!PIXELAPI_KEY,
  });
});


// IMAGE OPTIMIZER
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
      .resize({
        width: size.width,
        height: size.height,
        fit: "inside",
      })
      .jpeg({
        quality: 95,
        mozjpeg: true,
      })
      .toBuffer();


    return `data:image/jpeg;base64,${processed.toString(
      "base64"
    )}`;

  } catch (e) {

    console.log(
      "Preprocess failed:",
      e.message
    );

    return dataUrl;
  }
};



// ⭐ FABRIC → REAL GARMENT CREATOR

const createVirtualGarment = async (fabricDataUrl) => {

  try {

    console.log(
      "👕 Creating premium garment from fabric"
    );


    const base64 =
      fabricDataUrl.split(",")[1];

    const fabricBuffer =
      Buffer.from(base64, "base64");



    // make repeated textile pattern
    const tile = await sharp(fabricBuffer)
      .resize(300, 300)
      .toBuffer();



    const fabricCanvas =
      await sharp({
        create: {
          width: 1024,
          height: 1365,
          channels: 3,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: tile,
            tile: true,
          },
        ])
        .toBuffer();



    // realistic shirt template
    const mask = Buffer.from(`

<svg width="1024" height="1365">

<path fill="white"

d="
M370 160

C430 240
590 240
650 160

L850 270

C940 330
960 430
900 520

L780 720

L700 660

L700 1220

C640 1280
380 1280
320 1220

L320 660

L240 720

L120 520

C60 430
80 330
170 270

Z"

/>

</svg>

`);



    const shirt =
      await sharp(fabricCanvas)
        .composite([
          {
            input: mask,
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();



    const final =
      await sharp({
        create: {
          width:1024,
          height:1365,
          channels:3,
          background:"#ffffff",
        },
      })
        .composite([
          {
            input: shirt,
          },
        ])
        .jpeg({
          quality:95,
        })
        .toBuffer();



    return (
      "data:image/jpeg;base64," +
      final.toString("base64")
    );


  } catch(err){

    console.log(
      "Garment creator failed:",
      err.message
    );

    return fabricDataUrl;

  }
};



const toRawBase64 = (img) =>
  img.split(",")[1] || img;




// TRY ON ROUTE

app.post("/tryon", async (req,res)=>{

const start = Date.now();

try{

if(!PIXELAPI_KEY){

return res.status(500).json({
success:false,
error:"PIXELAPI key missing"
});

}


const {
personImg,
clothImg,
garment
}=req.body;


if(!personImg || !clothImg){

return res.status(400).json({
success:false,
error:"Images missing"
});

}



console.log("Fabric → garment");

const virtualCloth =
await createVirtualGarment(clothImg);



const [
personProcessed,
clothProcessed
] =
await Promise.all([

preprocessImage(
personImg,
"person"
),

preprocessImage(
virtualCloth,
"garment"
)

]);



let category="upperbody";


const label =
(garment?.label || "")
.toLowerCase();


if(label.includes("saree"))
category="saree";

else if(label.includes("kurti"))
category="kurti";

else if(label.includes("dress"))
category="dress";

else if(label.includes("lehenga"))
category="lehenga";



console.log(
"PixelAPI category:",
category
);



const submit =
await fetch(
"https://api.pixelapi.dev/v1/virtual-tryon",
{

method:"POST",

headers:{
...PIXELAPI_HEADERS_BASE,
"Content-Type":
"application/json"
},


body:JSON.stringify({

person_image:
toRawBase64(personProcessed),

garment_image:
toRawBase64(clothProcessed),

category

})

});


const data =
await submit.json();



if(!submit.ok){

return res.status(400).json({
success:false,
error:
data.error ||
"PixelAPI failed"
});

}



let output=null;

let waited=0;

while(waited < 600000){

await new Promise(
r=>setTimeout(r,3000)
);

waited +=3000;


const poll =
await fetch(
`https://api.pixelapi.dev/v1/virtual-tryon/jobs/${data.job_id}`,
{
headers:
PIXELAPI_HEADERS_BASE
}
);


const result =
await poll.json();


console.log(
"status:",
result.status
);



if(
result.status==="completed"
){

output =
result.result_image_b64;

break;

}


if(result.status==="failed"){

throw new Error(
"AI generation failed"
);

}

}



if(!output){

return res.status(408).json({
success:false,
error:"Timeout"
});

}



res.json({

success:true,

image:
`data:image/png;base64,${output}`

});


console.log(
"DONE",
Date.now()-start
);


}catch(e){

console.log(e);

res.status(500).json({
success:false,
error:e.message
});

}

});



// ping

app.get("/ping",(req,res)=>{

res.json({
alive:true
});

});


const PORT =
process.env.PORT || 5000;


app.listen(PORT,()=>{

console.log(
`✅ Backend running ${PORT}`
);

});