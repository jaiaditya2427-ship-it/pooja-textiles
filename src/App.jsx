import { useState, useRef, useCallback, useEffect } from "react";

const BACKEND = "https://fashion-tryon-backend1.onrender.com";

// ── Audio Engine ──────────────────────────────────────────────────────────────
const AudioEngine = {
  ctx: null,
  init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); return this; },
  play(type) {
    try {
      this.init(); const ctx = this.ctx; const now = ctx.currentTime;
      const tone = (freq, start, dur, vol = 0.08, wave = "sine") => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = wave; o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(freq, now + start);
        g.gain.setValueAtTime(vol, now + start);
        g.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
        o.start(now + start); o.stop(now + start + dur);
      };
      if (type === "click")   { tone(900,0,0.08); tone(500,0,0.08); }
      if (type === "success") { tone(523,0,0.3); tone(659,0.12,0.3); tone(784,0.24,0.4); tone(1047,0.36,0.5); }
      if (type === "whoosh")  { tone(300,0,0.35,"sawtooth"); }
      if (type === "welcome") { [261,329,392,523,659].forEach((f,i)=>tone(f,i*0.13,0.4,0.09)); }
      if (type === "select")  { tone(660,0,0.12); tone(880,0.08,0.12); }
      if (type === "error")   { tone(200,0,0.2,0.1,"sawtooth"); tone(150,0.15,0.2,0.08,"sawtooth"); }
      if (type === "back")    { tone(440,0,0.1); tone(330,0.08,0.15); }
    } catch(e) {}
  }
};

const haptic = (t="light") => {
  if (!navigator.vibrate) return;
  ({light:()=>navigator.vibrate(10),medium:()=>navigator.vibrate(25),heavy:()=>navigator.vibrate([30,10,30]),success:()=>navigator.vibrate([10,50,10,50,80])}[t]||(() => {}))();
};

const readFileAsDataURL = (file) => new Promise((res,rej) => {
  const r = new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file);
});

const GARMENT_TYPES = [
  {
    label: "T-Shirt",
    short: "T-Shirt",
    icon: "👕",
    category: "upper_body"
  },

  {
    label: "Shirt",
    short: "Shirt",
    icon: "👔",
    category: "upper_body"
  },

  { label: "Pants / Jeans", short: "Pants", icon: "👖", category: "lower_body" },
  { label: "Dress / Gown", short: "Dress", icon: "👗", category: "dresses" },
  { label: "Jacket / Coat", short: "Jacket", icon: "🧥", category: "upper_body" },

  { label: "Lehenga", short: "Lehenga", icon: "👗", category: "ethnic_wear" },
  { label: "Kurta / Kurti", short: "Kurta", icon: "👘", category: "ethnic_wear" },
  { label: "Ethnic Jacket", short: "Ethnic", icon: "🧥", category: "ethnic_wear" },
];

const FRIENDLY_ERRORS = {
  "list index out of range": "Could not detect a person clearly. Please use a photo where the person is clearly visible.",
  "Failed to fetch": "Unable to reach AI server. Check your internet connection.",
  "NetworkError": "Unable to reach AI server. Check your internet connection.",
  "Timeout": "Generation is taking longer than expected. Please try again.",
  "insufficient credit": "AI service credit exhausted. Please contact support.",
  "Invalid API": "AI service configuration error. Please contact support.",
  "REPLICATE_API_KEY": "AI service not configured. Please contact support.",
};

const getFriendlyError = (msg) => {
  for (const [key, val] of Object.entries(FRIENDLY_ERRORS)) {
    if (msg?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return msg || "Something went wrong. Please try again.";
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const S = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0D0D0D; --surface:#161616; --card:#1E1E1E; --border:#2A2A2A;
  --gold:#D4A843; --gold2:#F0C96A; --cream:#FAF6EF; --muted:#888;
  --green:#22C55E; --red:#EF4444;
  --glass:rgba(255,255,255,0.04); --r:12px;
}
html,body{background:var(--bg);color:var(--cream);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.app{min-height:100vh;max-width:430px;margin:0 auto;position:relative}

/* WELCOME */
.welcome{position:fixed;inset:0;z-index:200;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .9s ease,transform .9s ease}
.welcome.out{opacity:0;transform:scale(1.06);pointer-events:none}
.wbg{position:absolute;inset:0;overflow:hidden}
.wbg::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(212,168,67,.15) 0%,transparent 70%)}
.wbg::after{content:'';position:absolute;width:500px;height:500px;border-radius:50%;border:1px solid rgba(212,168,67,.06);top:50%;left:50%;transform:translate(-50%,-50%);animation:pulseRing 4s ease-in-out infinite}
@keyframes pulseRing{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.4}50%{transform:translate(-50%,-50%) scale(1.15);opacity:.15}}
.w-particles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.wp{position:absolute;width:2px;height:2px;border-radius:50%;background:var(--gold);animation:wpFloat linear infinite;opacity:0}
@keyframes wpFloat{0%{transform:translateY(105vh);opacity:0}10%{opacity:.8}90%{opacity:.8}100%{transform:translateY(-5vh) translateX(var(--dx));opacity:0}}
.wcontent{position:relative;z-index:1;text-align:center;padding:2rem}
.wbadge{font-size:.6rem;letter-spacing:.4em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(212,168,67,.3);padding:.3rem .9rem;margin-bottom:2rem;display:inline-block;animation:fadeUp .8s ease .2s both}
.wlogo{font-family:'Playfair Display',serif;font-size:clamp(2.8rem,10vw,4.8rem);font-weight:700;color:var(--cream);line-height:1;animation:fadeUp .8s ease .4s both}
.wlogo em{color:var(--gold);font-style:normal}
.wsub{font-size:.75rem;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-top:.8rem;animation:fadeUp .8s ease .6s both}
.wdivider{width:1px;height:40px;background:linear-gradient(to bottom,transparent,var(--gold),transparent);margin:2rem auto;animation:fadeUp .8s ease .7s both}
.wbtn{display:inline-flex;align-items:center;gap:.8rem;padding:1rem 2.5rem;background:var(--gold);color:#000;font-family:'DM Sans',sans-serif;font-size:.75rem;font-weight:600;letter-spacing:.25em;text-transform:uppercase;border:none;cursor:pointer;position:relative;overflow:hidden;animation:fadeUp .8s ease .9s both;transition:all .3s}
.wbtn::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.15);transform:translateX(-100%);transition:transform .4s ease}
.wbtn:hover::after{transform:translateX(0)}
.wbtn:hover{box-shadow:0 0 40px rgba(212,168,67,.5)}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

/* HEADER */
.hdr{padding:1rem 1.25rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50;background:rgba(13,13,13,.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.hlogo{font-family:'Playfair Display',serif;font-size:1.2rem;font-weight:500;color:var(--cream);letter-spacing:.05em}
.hlogo em{color:var(--gold);font-style:normal}
.hpill{font-size:.58rem;letter-spacing:.2em;text-transform:uppercase;padding:.25rem .65rem;background:rgba(212,168,67,.12);border:1px solid rgba(212,168,67,.25);color:var(--gold)}
.hback{background:transparent;border:1px solid var(--border);color:var(--muted);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .25s;font-size:.85rem;flex-shrink:0}
.hback:hover{border-color:var(--gold);color:var(--gold)}

/* STEPS */
.steps{display:flex;align-items:flex-start;justify-content:center;padding:1.5rem 1rem 1rem;gap:0}
.si{display:flex;align-items:center}
.sw{display:flex;flex-direction:column;align-items:center}
.sd{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:600;border:1.5px solid var(--border);color:var(--muted);transition:all .4s}
.sd.active{background:var(--gold);color:#000;border-color:var(--gold);box-shadow:0 0 0 4px rgba(212,168,67,.15)}
.sd.done{background:var(--green);color:#000;border-color:var(--green)}
.sl{width:40px;height:1px;background:var(--border);position:relative;margin-bottom:17px}
.sl::after{content:'';position:absolute;left:0;top:0;height:100%;background:var(--gold);transition:width .6s ease;width:0}
.sl.done::after{width:100%}
.slabel{font-size:.55rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:.35rem}

/* TIP */
.tipbox{margin:0 1.25rem .75rem;padding:.8rem 1rem;background:rgba(212,168,67,.05);border:1px solid rgba(212,168,67,.12);border-radius:10px;font-size:.68rem;color:rgba(212,168,67,.75);line-height:1.6;display:flex;gap:.6rem}
.tipbox-icon{font-size:1rem;flex-shrink:0}

/* GARMENT SELECTOR */
.gsec{padding:0 1.25rem 1.25rem}
.sec-label{font-size:.6rem;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;display:flex;align-items:center;gap:.6rem}
.sec-label::after{content:'';flex:1;height:1px;background:var(--border)}
.gchips{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
.gc{padding:.65rem .25rem;border:1.5px solid var(--border);background:var(--card);display:flex;flex-direction:column;align-items:center;gap:.28rem;cursor:pointer;transition:all .2s;border-radius:8px;position:relative;-webkit-tap-highlight-color:transparent}
.gc:active{transform:scale(.95)}
.gc:hover{border-color:var(--gold);background:rgba(212,168,67,.06)}
.gc.sel{border-color:var(--gold);background:rgba(212,168,67,.1)}
.gc.sel::after{content:'✓';position:absolute;top:3px;right:6px;font-size:.5rem;color:var(--gold);font-weight:800}
.gc-icon{font-size:1.4rem}
.gc-lbl{font-size:.55rem;letter-spacing:.06em;text-align:center;color:var(--cream);opacity:.8}

/* UPLOAD ZONE */
.uploadsec{padding:0 1.25rem 1.25rem;display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.uzone{aspect-ratio:3/4;border:1.5px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;background:var(--card);transition:all .3s;border-radius:var(--r);-webkit-tap-highlight-color:transparent}
.uzone:active{transform:scale(.97)}
.uzone:hover{border-color:var(--gold);background:rgba(212,168,67,.04)}
.uzone.has{border-style:solid;border-color:var(--border)}
.uzone img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:var(--r)}
.uoverlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;opacity:0;transition:opacity .3s;border-radius:var(--r)}
.uzone:hover .uoverlay,.uzone:focus-within .uoverlay{opacity:1}
.uoverlay-btns{display:flex;gap:.5rem}
.uov-btn{padding:.35rem .7rem;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;border:1px solid rgba(255,255,255,.3);color:white;background:rgba(255,255,255,.1);cursor:pointer;transition:all .2s;border-radius:4px;font-family:'DM Sans',sans-serif}
.uov-btn:hover{background:var(--gold);color:#000;border-color:var(--gold)}
.uov-btn.danger:hover{background:var(--red);border-color:var(--red)}
.u-icon{font-size:2rem;opacity:.25;margin-bottom:.5rem}
.u-title{font-family:'Playfair Display',serif;font-size:.95rem;color:var(--cream);opacity:.8}
.u-sub{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-top:.15rem}
.u-hint{font-size:.55rem;color:var(--gold);opacity:.6;margin-top:.3rem;text-align:center;padding:0 .4rem;line-height:1.4}
.uzone-badge{position:absolute;top:.5rem;left:.5rem;font-size:.55rem;letter-spacing:.12em;text-transform:uppercase;padding:.2rem .5rem;border-radius:4px;font-weight:600}
.uzone-badge.ok{background:rgba(34,197,94,.2);color:var(--green);border:1px solid rgba(34,197,94,.3)}

/* CHECKLIST */
.checklist{padding:0 1.25rem 1rem;display:flex;flex-direction:column;gap:.4rem}
.chk{display:flex;align-items:center;gap:.6rem;font-size:.7rem;color:var(--muted);transition:color .3s}
.chk.ok{color:var(--green)}
.chk-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}

/* ERROR */
.errbox{margin:0 1.25rem 1.25rem;padding:.9rem 1rem;background:rgba(239,68,68,.08);border-left:3px solid var(--red);font-size:.75rem;color:#FCA5A5;line-height:1.6;border-radius:0 8px 8px 0}
.errbox strong{display:block;margin-bottom:.25rem;font-size:.78rem}
.retry-btn{margin-top:.6rem;padding:.4rem .9rem;background:transparent;border:1px solid rgba(239,68,68,.4);color:#FCA5A5;font-family:'DM Sans',sans-serif;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;cursor:pointer;border-radius:6px;transition:all .2s}
.retry-btn:hover{background:rgba(239,68,68,.15)}

/* GENERATE BTN */
.genwrap{padding:0 1.25rem 1.5rem}
.genbtn{width:100%;padding:1.1rem;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#000;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:.75rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;position:relative;overflow:hidden;transition:all .3s;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:.75rem}
.genbtn:disabled{opacity:.3;cursor:not-allowed;background:var(--border);color:var(--muted)}
.genbtn:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(212,168,67,.4)}
.genbtn:not(:disabled):active{transform:translateY(0)}
.shine{position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:shine 2.5s ease-in-out infinite}
@keyframes shine{0%{left:-100%}50%{left:150%}100%{left:150%}}

/* LOADING */
.loadover{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.95);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;backdrop-filter:blur(16px)}
.lring{width:56px;height:56px;border:1.5px solid rgba(212,168,67,.15);border-top-color:var(--gold);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.ltext{font-family:'Playfair Display',serif;font-size:1.4rem;color:var(--cream);font-weight:400;letter-spacing:.08em;text-align:center}
.lsub{font-size:.65rem;letter-spacing:.28em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:-.75rem;text-align:center}
.lbar{width:200px;height:2px;background:rgba(212,168,67,.12);border-radius:1px;overflow:hidden}
.lbar::after{content:'';display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold2));animation:lp 2s ease-in-out infinite;border-radius:1px}
@keyframes lp{0%{width:0;margin-left:0}50%{width:60%;margin-left:20%}100%{width:0;margin-left:100%}}

/* PROGRESS PIPELINE */
.pipeline{display:flex;flex-direction:column;gap:.5rem;margin-top:.5rem}
.pipe-step{display:flex;align-items:center;gap:.6rem;font-size:.68rem;color:rgba(255,255,255,.3);transition:all .5s}
.pipe-step.done{color:var(--green)}
.pipe-step.active{color:var(--cream)}
.pipe-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.pipe-step.active .pipe-dot{animation:pipePulse 1s ease-in-out infinite}
@keyframes pipePulse{0%,100%{opacity:1}50%{opacity:.3}}

/* RESULT */
.resultsec{padding:0 1.25rem 2rem}
.rlabel{font-size:.6rem;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;display:flex;align-items:center;gap:.6rem}
.rlabel::before,.rlabel::after{content:'';flex:1;height:1px;background:var(--border)}
.rimgwrap{position:relative;border-radius:var(--r);overflow:hidden;background:var(--card);cursor:zoom-in}
.rimgwrap img{width:100%;display:block;animation:reveal .8s ease}
@keyframes reveal{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:scale(1)}}
.rbadge{position:absolute;bottom:.75rem;left:.75rem;font-size:.55rem;letter-spacing:.16em;text-transform:uppercase;padding:.28rem .65rem;background:rgba(212,168,67,.9);color:#000;font-weight:700;border-radius:4px}
.rtap-hint{position:absolute;bottom:.75rem;right:.75rem;font-size:.55rem;letter-spacing:.12em;text-transform:uppercase;padding:.28rem .65rem;background:rgba(0,0,0,.5);color:rgba(255,255,255,.6);border-radius:4px}
.ractions{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.9rem}
.ractions2{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;margin-top:.6rem}
.abtn{padding:.82rem .4rem;background:transparent;border:1.5px solid var(--border);font-family:'DM Sans',sans-serif;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;color:var(--cream);cursor:pointer;transition:all .25s;display:flex;align-items:center;justify-content:center;gap:.35rem;border-radius:8px;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.abtn:hover{background:var(--glass);border-color:rgba(255,255,255,.2)}
.abtn:active{transform:scale(.96)}
.abtn.gold{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}
.abtn.gold:hover{background:var(--gold2);border-color:var(--gold2)}
.abtn.wa:hover{background:#25D366;border-color:#25D366;color:#000}
.abtn.ig:hover{background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);border-color:#dc2743}

/* BEFORE/AFTER SLIDER */
.baslider{position:relative;border-radius:var(--r);overflow:hidden;background:var(--card);margin-top:.9rem;touch-action:none}
.baslider-label{position:absolute;top:.5rem;font-size:.55rem;letter-spacing:.15em;text-transform:uppercase;padding:.2rem .5rem;border-radius:4px;z-index:5;font-weight:600;background:rgba(0,0,0,.6);color:white}
.baslider-label.left{left:.5rem}
.baslider-label.right{right:.5rem}
.ba-after{width:100%;display:block}
.ba-before-wrap{position:absolute;inset:0;overflow:hidden}
.ba-before{width:100%;display:block;object-fit:cover;height:100%}
.ba-handle{position:absolute;top:0;bottom:0;width:2px;background:white;cursor:ew-resize;z-index:10;transform:translateX(-50%)}
.ba-handle::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;background:white;box-shadow:0 2px 12px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.ba-handle::after{content:'⟺';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:.8rem;color:#000;z-index:11;pointer-events:none}

/* FULLSCREEN VIEWER */
.fsviewer{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(20px);animation:fsin .3s ease}
@keyframes fsin{from{opacity:0}to{opacity:1}}
.fsviewer img{max-width:100%;max-height:100vh;object-fit:contain;animation:fsscale .3s ease}
@keyframes fsscale{from{transform:scale(.9)}to{transform:scale(1)}}
.fsclose{position:absolute;top:1.5rem;right:1.5rem;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:white;width:40px;height:40px;border-radius:50%;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.fsclose:hover{background:rgba(255,255,255,.2)}

/* SHARE SHEET */
.sheetbg{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(8px);animation:bgin .3s ease}
@keyframes bgin{from{opacity:0}to{opacity:1}}
.sheet{width:100%;max-width:430px;background:#1A1A1A;border-top:1px solid var(--border);border-radius:20px 20px 0 0;padding:1.5rem 1.25rem 2.5rem;animation:slideup .35s cubic-bezier(.32,.72,0,1)}
@keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
.shandle{width:36px;height:3px;background:var(--border);border-radius:2px;margin:0 auto 1.5rem}
.shtitle{font-family:'Playfair Display',serif;font-size:1.2rem;color:var(--cream);margin-bottom:1.25rem;font-weight:400}
.shgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:.65rem;margin-bottom:1.25rem}
.shi{padding:1rem .5rem;border:1.5px solid var(--border);background:var(--card);display:flex;flex-direction:column;align-items:center;gap:.45rem;cursor:pointer;transition:all .25s;border-radius:10px;-webkit-tap-highlight-color:transparent}
.shi:hover{border-color:var(--gold);background:rgba(212,168,67,.08)}
.shi:active{transform:scale(.95)}
.shi-icon{font-size:1.5rem}
.shi-lbl{font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.shclose{width:100%;padding:.82rem;background:transparent;border:1.5px solid var(--border);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .25s;border-radius:8px}
.shclose:hover{border-color:rgba(255,255,255,.2);color:var(--cream)}

/* TOAST */
.toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(12px);background:#1E1E1E;color:var(--cream);padding:.65rem 1.4rem;font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;border:1px solid var(--border);opacity:0;transition:all .4s cubic-bezier(.32,.72,0,1);pointer-events:none;white-space:nowrap;z-index:600;border-radius:40px}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}

/* SAVED LOOKS */
.saved-looks{padding:0 1.25rem .5rem}
.saved-scroll{display:flex;gap:.6rem;overflow-x:auto;padding-bottom:.25rem;scrollbar-width:none}
.saved-scroll::-webkit-scrollbar{display:none}
.saved-thumb{flex-shrink:0;width:64px;cursor:pointer;opacity:.7;transition:all .25s}
.saved-thumb:hover{opacity:1}
.saved-thumb img{width:64px;height:85px;object-fit:cover;border-radius:6px;border:1.5px solid var(--border)}
.saved-thumb.active img{border-color:var(--gold)}
.saved-thumb-lbl{font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:.3rem;text-align:center}
`;

// ── Particles ─────────────────────────────────────────────────────────────────
const Particles = () => (
  <div className="w-particles">
    {Array.from({length:24},(_,i)=>(
      <div key={i} className="wp" style={{
        left:Math.random()*100+"%",
        animationDuration:(7+Math.random()*9)+"s",
        animationDelay:Math.random()*10+"s",
        "--dx":(Math.random()-.5)*120+"px",
        width:Math.random()>0.7?"3px":"2px",
        height:Math.random()>0.7?"3px":"2px",
      }}/>
    ))}
  </div>
);

// ── Before/After Slider ────────────────────────────────────────────────────────
const BeforeAfterSlider = ({ before, after }) => {
  const [pos, setPos] = useState(50);
  const ref = useRef();
  const dragging = useRef(false);

  const getPos = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    return Math.min(95, Math.max(5, p));
  };

  const onMouseDown = (e) => { dragging.current = true; };
  const onMouseMove = (e) => { if (dragging.current) setPos(getPos(e.clientX)); };
  const onMouseUp   = () => { dragging.current = false; };
  const onTouchMove = (e) => { e.preventDefault(); setPos(getPos(e.touches[0].clientX)); };

  useEffect(() => {
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div className="baslider" ref={ref}
      onMouseMove={onMouseMove}
      onTouchMove={onTouchMove}
      onTouchStart={e=>setPos(getPos(e.touches[0].clientX))}>
      <span className="baslider-label left">Before</span>
      <span className="baslider-label right">After</span>
      <img className="ba-after" src={after} alt="After"/>
      <div className="ba-before-wrap" style={{width:pos+"%"}}>
        <img className="ba-before" src={before} alt="Before" style={{width:ref.current?.offsetWidth||"100%"}}/>
      </div>
      <div className="ba-handle" style={{left:pos+"%"}} onMouseDown={onMouseDown}/>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,    setScreen]    = useState("welcome");
  const [wExit,     setWExit]     = useState(false);
  const [personImg, setPersonImg] = useState(null);
  const [clothImg,  setClothImg]  = useState(null);
  const [garment,   setGarment]   = useState(GARMENT_TYPES[0]);
  const [loading,   setLoading]   = useState(false);
  const [loadMsg,   setLoadMsg]   = useState("Crafting Your Look");
  const [pipeStep,  setPipeStep]  = useState(0);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState("");
  const [toast,     setToast]     = useState("");
  const [toastOn,   setToastOn]   = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [fsOpen,    setFsOpen]    = useState(false);
  const [savedLooks,setSavedLooks]= useState([]);

  const personRef = useRef();
  const clothRef  = useRef();

  const showToast = useCallback((msg)=>{
    setToast(msg); setToastOn(true);
    setTimeout(()=>setToastOn(false), 2800);
  },[]);

  const click = () => { AudioEngine.play("click"); haptic("light"); };

  // ── Back button logic ──
  const handleBack = () => {
    AudioEngine.play("back"); haptic("medium");
    if (screen === "result") {
      setScreen("main"); setResult(null);
    } else if (clothImg) {
      setClothImg(null);
    } else if (personImg) {
      setPersonImg(null);
    } else {
      setWExit(false); setScreen("welcome");
    }
  };

  const enter = () => {
    click(); AudioEngine.play("welcome"); haptic("medium");
    setWExit(true);
    setTimeout(()=>setScreen("main"), 900);
  };

  // ── Android-safe upload ──
  const handleUpload = async (e, who) => {
    const file = e.target.files[0]; if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
  showToast("Please use images below 10MB");
  return;
}
    e.target.value = ""; click();
    try {
      const dataURL = await readFileAsDataURL(file);
      if (who==="person") { setPersonImg(dataURL); showToast("✓ Photo ready!"); }
      else                { setClothImg(dataURL);  showToast("✓ Garment ready!"); }
    } catch { showToast("Could not read image. Try another."); }
  };

  const retake = (who) => {
    click(); haptic("medium");
    if (who==="person") { setPersonImg(null); setTimeout(()=>personRef.current?.click(),100); }
    else                { setClothImg(null);  setTimeout(()=>clothRef.current?.click(),100); }
  };
  const remove = (who) => {
    click(); haptic("medium");
    if (who==="person") setPersonImg(null); else setClothImg(null);
  };

  // ── Generate Again ──
  const generateAgain = () => {
    click(); AudioEngine.play("whoosh");
    setClothImg(null); setResult(null); setError("");
    setScreen("main");
    showToast("Upload a new garment to try again!");
  };

  // ── Pipeline steps ──
  const PIPE_STEPS = [
    "Uploading photos",
    "Removing background",
    "Detecting body pose",
    "Understanding garment",
    "Fitting garment on body",
    "AI rendering final look",
    "Finalizing your result",
  ];

  // ── Generate ──
  const generate = async () => {
    if (!personImg || !clothImg) { showToast("⚠ Add both photos first"); haptic("heavy"); return; }
    click(); setLoading(true); setError(""); setResult(null); setPipeStep(0);
    setLoadMsg("Preparing your look...");

    const pipeInterval = setInterval(()=>{
      setPipeStep(p => p < PIPE_STEPS.length - 1 ? p + 1 : p);
    }, 8000);

    try {
      try { await fetch(`${BACKEND}/`); } catch(_) {}
      setPipeStep(1); setLoadMsg("AI is working...");

      const res = await fetch(`${BACKEND}/tryon`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          personImg, clothImg,
          garment: { label: garment.label, category: garment.category }
        }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error(`Server error ${res.status}`); }

      if (!res.ok || !data.success) throw new Error(data.error || `Error ${res.status}`);

      setPipeStep(PIPE_STEPS.length - 1);
      setLoadMsg("Your look is ready! ✦");

      // Save to history
      setSavedLooks(prev => [{image:data.image, garment:garment.short||garment.label, ts:Date.now()}, ...prev].slice(0,3));

      setTimeout(()=>{
        setResult(data.image);
        setScreen("result");
        AudioEngine.play("success"); haptic("success");
      }, 800);

    } catch(e) {
      AudioEngine.play("error"); haptic("heavy");
      // Keep photos on failure! Don't clear personImg or clothImg
      setError(getFriendlyError(e.message));
    } finally {
      clearInterval(pipeInterval);
      setLoading(false);
    }
  };

  const download = async () => {
    click();
    try {
      const res = await fetch(result);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href=url; a.download=`fashion-tryon-${Date.now()}.jpg`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      showToast("✓ Saved to device!");
    } catch { window.open(result,"_blank"); showToast("Opened in new tab"); }
  };

  const shareWA = () => {
    click();
    window.open(`https://wa.me/?text=${encodeURIComponent("Check my AI try-on look! 👗✨ "+result)}`,"_blank");
    setShareOpen(false);
  };
  const shareIG = async () => { click(); await download(); showToast("Saved! Open Instagram → Stories"); setShareOpen(false); };
  const shareNative = async () => {
    click();
    if (navigator.share) { try { await navigator.share({title:"My Fashion Try-On",url:result}); } catch{} }
    else { await navigator.clipboard?.writeText(result); showToast("✓ Link copied!"); }
    setShareOpen(false);
  };
  const copyLink = async () => { click(); await navigator.clipboard?.writeText(result); showToast("✓ Link copied!"); setShareOpen(false); };
  const reset = () => { click(); AudioEngine.play("whoosh"); setPersonImg(null); setClothImg(null); setResult(null); setError(""); setScreen("main"); };

  const step = !personImg ? 1 : !clothImg ? 2 : 3;
  const showBack = screen !== "welcome";

  return (
    <>
      <style>{S}</style>
      <div className="app">

        {/* WELCOME */}
        {screen==="welcome" && (
          <div className={`welcome${wExit?" out":""}`}>
            <div className="wbg"/>
            <Particles/>
            <div className="wcontent">
              <div className="wbadge">✦ Powered by Idea Infoline</div>
              <div className="wlogo">Fashion<em> Try‑On</em></div>
             <div className="wsub" style={{ marginTop: "1.5rem" }}>
  <div
    style={{
      fontSize: "2.6rem",
      fontWeight: 900,
      letterSpacing: "0.15em",
      color: "#D4A843",
      textTransform: "uppercase",
      lineHeight: "1",
      textShadow: "0 0 30px rgba(212,168,67,0.3)"
    }}
  >
    POOJA TEXTILES
  </div>

  <div
    style={{
      marginTop: "12px",
      fontSize: "0.85rem",
      letterSpacing: "0.35em",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.55)"
    }}
  >
    Virtual Fitting Experience
  </div>
</div>
              <div className="wdivider"/>
              <button className="wbtn" onClick={enter}>
                <span>Start Experience</span><span style={{fontSize:"1rem"}}>→</span>
              </button>
            </div>
          </div>
        )}

        {/* MAIN + RESULT */}
        {(screen==="main"||screen==="result") && (
          <>
            <header className="hdr">
              {showBack
                ? <button className="hback" onClick={handleBack} title="Go back">←</button>
                : <div style={{width:32}}/>
              }
              <div className="hlogo">Fashion<em> Try‑On</em></div>
              <div className="hpill">Idea Infoline</div>
            </header>

            {screen==="main" && (
              <>
                {/* Steps */}
                <div className="steps">
                  {[{n:1,l:"Photo"},{n:2,l:"Garment"},{n:3,l:"Generate"}].map((s,i)=>(
                    <div key={s.n} className="si">
                      {i>0 && <div className={`sl${step>s.n?" done":""}`}/>}
                      <div className="sw">
                        <div className={`sd${step===s.n?" active":step>s.n?" done":""}`}>{step>s.n?"✓":s.n}</div>
                        <div className="slabel">{s.l}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tip box */}
                <div className="tipbox">
                  <div className="tipbox-icon">💡</div>
                  <div>
                    <strong style={{display:"block",marginBottom:".15rem",color:"var(--gold)"}}>Tips for best results</strong>
                    For best results:
• Full body photo
• Head and feet visible
• Standing pose
• Good lighting
• Single person only

Garment:
• Flat lay or catalogue image
• Entire garment visible
• High resolution image
                  </div>
                </div>

                {/* Garment type */}
                <div className="gsec">
                  <div className="sec-label">Garment Type</div>
                  <div className="gchips">
                    {GARMENT_TYPES.map((g,i)=>(
                      <div key={i} className={`gc${garment.label===g.label?" sel":""}`}
                        onClick={()=>{ AudioEngine.play("select"); haptic("light"); setGarment(g); }}>
                        <div className="gc-icon">{g.icon}</div>
                        <div className="gc-lbl">{g.short}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Upload zones */}
                <div className="uploadsec">
                  <div>
                    {/* Android-safe: visible but positioned absolutely */}
                    <input ref={personRef} type="file" accept="image/*"
                      style={{position:"absolute",opacity:0,width:"1px",height:"1px",overflow:"hidden"}}
                      onChange={e=>handleUpload(e,"person")}/>
                    <div className={`uzone${personImg?" has":""}`}
                      onClick={()=>!personImg&&(click(),personRef.current.click())}
                      role="button" tabIndex={0}
                      onKeyDown={e=>e.key==="Enter"&&personRef.current.click()}>
                      {personImg ? (
                        <>
                          <img src={personImg} alt="Customer"/>
                          <div className="uzone-badge ok">✓ Ready</div>
                          <div className="uoverlay">
                            <div className="uoverlay-btns">
                              <button className="uov-btn" onClick={e=>{e.stopPropagation();retake("person")}}>Retake</button>
                              <button className="uov-btn danger" onClick={e=>{e.stopPropagation();remove("person")}}>Remove</button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="u-icon">📷</div>
                          <div className="u-title">Customer</div>
                          <div className="u-sub">Tap to upload</div>
                          <div className="u-hint">Any photo • any background • selfie OK</div>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <input ref={clothRef} type="file" accept="image/*"
                      style={{position:"absolute",opacity:0,width:"1px",height:"1px",overflow:"hidden"}}
                      onChange={e=>handleUpload(e,"cloth")}/>
                    <div className={`uzone${clothImg?" has":""}`}
                      onClick={()=>!clothImg&&(click(),clothRef.current.click())}
                      role="button" tabIndex={0}
                      onKeyDown={e=>e.key==="Enter"&&clothRef.current.click()}>
                      {clothImg ? (
                        <>
                          <img src={clothImg} alt="Garment"/>
                          <div className="uzone-badge ok">✓ Ready</div>
                          <div className="uoverlay">
                            <div className="uoverlay-btns">
                              <button className="uov-btn" onClick={e=>{e.stopPropagation();retake("cloth")}}>Retake</button>
                              <button className="uov-btn danger" onClick={e=>{e.stopPropagation();remove("cloth")}}>Remove</button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="u-icon">{garment.icon}</div>
                          <div className="u-title">Garment</div>
                          <div className="u-sub">Tap to upload</div>
                          <div className="u-hint">Product photo • flat lay • any background</div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Checklist */}
                <div className="checklist">
                  <div className={`chk${personImg?" ok":""}`}><div className="chk-dot"/>{personImg?"✓ Customer photo added":"Add customer photo"}</div>
                  <div className={`chk${clothImg?" ok":""}`}><div className="chk-dot"/>{clothImg?"✓ Garment photo added":"Add garment photo"}</div>
                </div>

                {error && (
                  <div className="errbox">
                    <strong>⚠ Generation Failed</strong>
                    {error}
                    <button className="retry-btn" onClick={generate}>↺ Try Again</button>
                  </div>
                )}

                {/* Generate */}
                <div className="genwrap">
                  <button className="genbtn" onClick={generate} disabled={!personImg||!clothImg}>
                    <div className="shine"/>
                    <span>✦</span>
                    <span>Generate Try-On</span>
                  </button>
                </div>

                {/* Saved looks */}
                {savedLooks.length > 0 && (
                  <div className="saved-looks">
                    <div className="sec-label">Recent Looks</div>
                    <div className="saved-scroll">
                      {savedLooks.map((look,i)=>(
                        <div key={i} className="saved-thumb" onClick={()=>{
                          click(); setResult(look.image); setScreen("result");
                        }}>
                          <img src={look.image} alt="Saved look"/>
                          <div className="saved-thumb-lbl">{look.garment}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* RESULT */}
            {screen==="result" && result && (
              <div className="resultsec" style={{paddingTop:"1.5rem"}}>
                <div className="rlabel">Your Look</div>
                <div className="rimgwrap" onClick={()=>{click();setFsOpen(true)}}>
                  <img src={result} alt="Try-on result"/>
                  <div className="rbadge">✦ AI Generated</div>
                  <div className="rtap-hint">Tap to zoom</div>
                </div>

                {/* Before / After slider */}
                {personImg && (
                  <BeforeAfterSlider before={personImg} after={result}/>
                )}

                <div className="ractions">
                  <button className="abtn gold" onClick={download}>⬇ Download</button>
                  <button className="abtn" onClick={()=>{click();setShareOpen(true)}}>↗ Share</button>
                </div>
                <div className="ractions2">
                  <button className="abtn wa" onClick={shareWA}>💬 WhatsApp</button>
                  <button className="abtn ig" onClick={shareIG}>📸 Instagram</button>
                  <button className="abtn" onClick={generateAgain}>↺ Try Again</button>
                </div>
                <div style={{display:"flex",gap:".6rem",marginTop:".9rem",opacity:.6}}>
                  <img src={personImg} alt="" style={{width:52,height:70,objectFit:"cover",borderRadius:6,border:"1px solid var(--border)"}}/>
                  <img src={clothImg}  alt="" style={{width:52,height:70,objectFit:"cover",borderRadius:6,border:"1px solid var(--border)"}}/>
                  <div style={{flex:1,display:"flex",alignItems:"center",paddingLeft:".5rem",fontSize:".65rem",color:"var(--muted)",lineHeight:1.4}}>
                    Tap <em style={{color:"var(--gold)",fontStyle:"normal",margin:"0 .25rem"}}>Try Again</em> to try a different garment
                  </div>
                </div>

                {/* Reset */}
                <div style={{marginTop:"1rem",textAlign:"center"}}>
                  <button onClick={reset} style={{background:"transparent",border:"none",color:"var(--muted)",fontSize:".65rem",letterSpacing:".2em",textTransform:"uppercase",cursor:"pointer",padding:".5rem 1rem"}}>
                    ✕ Start Over
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* LOADING */}
        {loading && (
          <div className="loadover">
            <div className="lring"/>
            <div className="ltext">{loadMsg}</div>
            <div className="lsub">This usually takes 15–30 seconds</div>
            <div className="lbar"/>
            <div className="pipeline">
              {PIPE_STEPS.map((s,i)=>(
                <div key={i} className={`pipe-step${i<pipeStep?" done":i===pipeStep?" active":""}`}>
                  <div className="pipe-dot"/>
                  <span>{i<pipeStep?"✓ ":""}{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FULLSCREEN VIEWER */}
        {fsOpen && (
          <div className="fsviewer" onClick={()=>setFsOpen(false)}>
            <img src={result} alt="Fullscreen" onClick={e=>e.stopPropagation()}/>
            <button className="fsclose" onClick={()=>setFsOpen(false)}>✕</button>
          </div>
        )}

        {/* SHARE SHEET */}
        {shareOpen && (
          <div className="sheetbg" onClick={()=>setShareOpen(false)}>
            <div className="sheet" onClick={e=>e.stopPropagation()}>
              <div className="shandle"/>
              <div className="shtitle">Share Your Look</div>
              <div className="shgrid">
                {[
                  {icon:"💬",lbl:"WhatsApp",fn:shareWA},
                  {icon:"📸",lbl:"Instagram",fn:shareIG},
                  {icon:"📤",lbl:"More Apps",fn:shareNative},
                  {icon:"⬇️",lbl:"Download",fn:download},
                  {icon:"🔗",lbl:"Copy Link",fn:copyLink},
                  {icon:"✕",lbl:"Cancel",fn:()=>{click();setShareOpen(false)}},
                ].map((item,i)=>(
                  <div key={i} className="shi" onClick={item.fn}>
                    <div className="shi-icon">{item.icon}</div>
                    <div className="shi-lbl">{item.lbl}</div>
                  </div>
                ))}
              </div>
              <button className="shclose" onClick={()=>{click();setShareOpen(false)}}>Cancel</button>
            </div>
          </div>
        )}

        {/* TOAST */}
        <div className={`toast${toastOn?" on":""}`}>{toast}</div>
      </div>
    </>
  );
}