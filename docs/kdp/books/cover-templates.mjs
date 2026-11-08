// THE APPROVED COVER TEMPLATES (owner, 8 Nov 2026: "ok they look fine to me", all 22 covers on
// https://claude.ai/artifact/TPkSyXAZKpdMR78CU3TZSi). Reference code for ENGINE to move into the pipeline:
// one HTML template per line (KeepMyProof, ApprovalPrep, Dream Wedding, A Player Mode, Time-2-Read,
// uscisexam), 1600 px wide, screenshotted by Playwright exactly like lib.mjs coverHtml. Kindle 1600x2560;
// paperback fronts 1600x2400 (6x9) and 1600x2071 (8.5x11). Reads the specs in scripts/ops/kdp-books/.
// node docs/kdp/books/cover-templates.mjs <repo root> [slug...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const WT = process.argv[2];
const only = new Set(process.argv.slice(3));
const SPEC = join(WT, "scripts/ops/kdp-books");
const OUT = join(WT, "docs/kdp/books/assets/covers");
const SCR = process.env.KDP_COVER_SCRATCH ?? join(process.env.TMPDIR ?? "/tmp", "kdp-covers");
mkdirSync(OUT, { recursive: true }); mkdirSync(SCR, { recursive: true });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nb = (s) => esc(s).replace(/-/g, "‑");
const b64 = (p) => readFileSync(p).toString("base64");
const KMP = process.env.KMP_ASSETS ?? join(process.env.HOME ?? "", "GitHub/keepmyproof/assets/site/");
const kfont = { serif: b64(KMP + "noto-serif-700.woff2"), sans: b64(KMP + "noto-sans.woff2"), mono: b64(KMP + "noto-sans-mono-500.woff2") };
const mark = readFileSync(KMP + "mark.svg", "utf8").replace(/width="\d+" height="\d+"/, "");
const GF = (fam) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fam}&display=block">`;
const base = (W, H) => `*{box-sizing:border-box;margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden}body{position:relative}`;
// Largest size whose greedy word wrap fits a box (charW = average glyph width in em).
const fitBox = (title, max, min, boxW, boxH, charW, lh = 1) => {
  for (let size = max; size > min; size -= 4) {
    const cpl = boxW / (size * charW); let lines = 1, cur = 0, ok = true;
    for (const w of title.split(/\s+/)) { if (w.length > cpl) { ok = false; break; } if (cur && cur + 1 + w.length > cpl) { lines++; cur = w.length; } else cur += (cur ? 1 : 0) + w.length; }
    if (ok && lines * size * lh <= boxH) return size;
  }
  return min;
};
const fit = (title, max, min, perLine) => { const longest = Math.max(...title.split(/\s+/).map((w) => w.length)); return Math.max(min, Math.min(max, Math.floor(perLine / Math.max(longest, 6)))); };

// Short checklist rows for the KMP card (cover only).
const KROWS = {
  "parallel-parenting": ["One channel, short replies", "Handoff log, same day", "Every paper in one place"],
  "hostile-work-environment": ["Same-day incident notes", "Hours against pay stubs", "Complaint and every reply"],
  "va-disability-rating": ["DD-214 and service papers", "Medical records and exam notes", "Buddy statements, copied"],
  "504-plan-iep-meeting": ["Current plan and evaluations", "Requests made in writing", "Meeting notes and follow-up"],
  "what-to-do-when-someone-dies": ["Death certificates", "Accounts and property", "Bills to close out"],
  "co-parenting-log": ["Handoff and visit log", "Messages received", "Child expenses"],
};

function kmpCover(b, W, H) {
  const size = fitBox(b.title, 300, 130, 1370, 820, 0.56);
  const rows = (KROWS[b.slug] ?? []).map((r, i) => `<div class="row"><span class="tick ${i < 2 ? "on" : ""}"></span><span>${esc(r)}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:NS;font-weight:700;src:url(data:font/woff2;base64,${kfont.serif})}@font-face{font-family:NA;src:url(data:font/woff2;base64,${kfont.sans})}@font-face{font-family:NM;src:url(data:font/woff2;base64,${kfont.mono})}
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:NA}
.brand{position:absolute;top:100px;left:120px;display:flex;align-items:center;gap:26px;font-family:NS;font-size:60px}.brand svg{width:100px;height:100px}.brand b{color:${b.cover.accent}}
.main{position:absolute;top:270px;left:120px;right:110px;bottom:${Math.round(H * 0.105) + 40}px;display:flex;flex-direction:column}
.kicker{font-family:NM;font-size:46px;letter-spacing:5px;text-transform:uppercase;color:#6B5320}
h1{margin-top:36px;font-family:NS;font-size:${size}px;line-height:1.0;letter-spacing:-3px}
.promise{margin-top:60px;font-size:96px;line-height:1.25;color:#2A3034;font-weight:600;border-left:14px solid #D9A441;padding-left:36px}
.card{margin-top:auto;background:#fff;border:3px solid #D6D9D3;border-radius:28px;padding:40px 56px;box-shadow:0 18px 40px rgba(30,35,38,.10)}
.row{display:flex;align-items:center;gap:28px;font-size:50px;padding:18px 0;border-top:2px solid #ECEEEA}.row:first-child{border-top:0}
.tick{flex:none;width:58px;height:58px;border:6px solid ${b.cover.accent};border-radius:12px;position:relative}.tick.on{background:${b.cover.accent}}
.tick.on:after{content:"";position:absolute;left:15px;top:2px;width:16px;height:30px;border:solid #fff;border-width:0 8px 8px 0;transform:rotate(45deg)}
.foot{position:absolute;left:0;right:0;bottom:0;height:${Math.round(H * 0.105)}px;background:${b.cover.accent};color:#F3F4F1;display:flex;align-items:center;justify-content:space-between;padding:0 120px}
.foot .a{font-family:NS;font-size:84px}.foot .s{font-family:NM;font-size:36px;opacity:.9;text-align:right;line-height:1.3}
</style></head><body><div class="brand">${mark}<span>KeepMy<b>Proof</b></span></div>
<div class="main"><div class="kicker">${esc(b.cover.kicker)}</div><h1>${nb(b.title)}</h1><div class="promise">${esc(b.cover.promise)}</div>
<div class="card">${rows}</div></div><div class="foot"><span class="a">${esc(b.author)}</span><span class="s">Record book<br>with fill-in logs</span></div></body></html>`;
}

function apCover(b, W, H) {
  const m = /^(.*?)\s*\((.*)\)$/.exec(b.title); const paren = m ? m[2] : null;
  const t = (m ? m[1] : b.title).replace(/^The /, "");
  const longest = Math.max(...t.split(/\s+/).map((w) => w.length));
  const size = Math.min(260, Math.floor(1360 / (longest * 0.82)));
  return `<!doctype html><html><head><meta charset="utf-8">${GF("family=Archivo:wdth,wght@112,800&family=Atkinson+Hyperlegible+Next:wght@500;700&family=IBM+Plex+Mono:wght@500")}<style>
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:"Atkinson Hyperlegible Next"}
.logo{position:absolute;top:110px;left:120px;display:flex;align-items:center;gap:22px;font-family:Archivo;font-weight:800;font-stretch:112%;font-size:66px}
.box{width:86px;height:86px;border-radius:16px;background:${b.cover.accent};position:relative}.box:after{content:"";position:absolute;left:28px;top:8px;width:22px;height:46px;border:solid ${b.cover.fg};border-width:0 11px 11px 0;transform:rotate(45deg)}
.hl{background:${b.cover.decoration};padding:0 12px}
.kicker{position:absolute;top:300px;left:120px;font-family:"IBM Plex Mono";font-size:46px;letter-spacing:4px;text-transform:uppercase}
.the{position:absolute;top:420px;left:120px;font-family:Archivo;font-weight:800;font-stretch:112%;font-size:90px}
h1{position:absolute;top:${b.title.startsWith("The ") ? 530 : 440}px;left:110px;right:90px;font-family:Archivo;font-weight:800;font-stretch:112%;font-size:${size}px;line-height:.98;letter-spacing:-2px;text-transform:uppercase}
.paren{display:block;font-size:110px;margin-top:24px;letter-spacing:0}.bar{display:block;width:420px;height:40px;background:${b.cover.decoration};margin-top:40px}
.promise{position:absolute;left:120px;right:120px;bottom:${Math.round(H * 0.105) + 380}px;font-size:92px;font-weight:700;line-height:1.18}
.sheet{position:absolute;right:120px;bottom:${Math.round(H * 0.105) + 70}px;width:520px;height:250px;background:#fff;border:3px solid #E2DCCD;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.08);padding:40px}
.sheet i{display:block;height:14px;background:#E9E3D6;border-radius:7px;margin:18px 0}.sheet i:nth-child(2){width:80%}.sheet i:nth-child(3){width:60%}
.sheet .ok{position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:22px;background:${b.cover.accent}}.sheet .ok:after{content:"";position:absolute;left:36px;top:12px;width:28px;height:56px;border:solid ${b.cover.fg};border-width:0 13px 13px 0;transform:rotate(45deg)}
.left{position:absolute;left:120px;bottom:${Math.round(H * 0.105) + 90}px;font-family:"IBM Plex Mono";font-size:40px;line-height:1.5;color:#55524A}
.foot{position:absolute;left:0;right:0;bottom:0;height:${Math.round(H * 0.105)}px;background:${b.cover.fg};color:${b.cover.bg};display:flex;align-items:center;justify-content:space-between;padding:0 120px;font-family:Archivo;font-weight:800;font-stretch:112%;font-size:76px}
.foot small{font-family:"IBM Plex Mono";font-weight:500;font-size:36px;color:${b.cover.decoration}}
</style></head><body><div class="logo"><span class="box"></span><span>Approval<span class="hl">Prep</span></span></div>
<div class="kicker">${esc(b.cover.kicker)}</div>${b.title.startsWith("The ") ? '<div class="the">THE</div>' : ""}<h1>${nb(t)}${paren ? `<span class="paren">${esc(paren)}</span>` : ""}<span class="bar"></span></h1>
<div class="promise">${esc(b.cover.promise)}</div><div class="left">Samples · checklists<br>· plain steps</div><div class="sheet"><i></i><i></i><i></i><i></i><span class="ok"></span></div>
<div class="foot"><span>${esc(b.author)}</span><small>Self-help guide</small></div></body></html>`;
}

function wedCover(b, W, H) {
  const ph = b.cover.photo ? `data:image/jpeg;base64,${b64(join(WT, b.cover.photo.path))}` : "";
  const t = b.title;
  const size = fitBox(t, 300, 130, 1360, 560, 0.42, 0.95);
  const photoH = Math.round(H * 0.40);
  return `<!doctype html><html><head><meta charset="utf-8">${GF("family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@500;600&family=DM+Mono:wght@500")}<style>
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:"Instrument Sans"}
.photo{position:absolute;top:0;left:0;right:0;height:${photoH}px;background:url(${ph}) center/cover}
.tabs{position:absolute;top:${photoH - 60}px;right:110px;display:flex;flex-direction:column;align-items:flex-end}
.tab{height:120px;border-radius:22px 22px 0 0;display:flex;align-items:center;padding:0 40px;font-family:"DM Mono";font-size:40px;color:#fff}
.t1{width:380px;background:${b.cover.accent}}.t2{width:300px;background:${b.cover.decoration};margin-right:0;border-radius:0 0 22px 22px;color:${b.cover.fg}}
.main{position:absolute;top:${photoH + 100}px;left:120px;right:120px;bottom:${Math.round(H * 0.13)}px;display:flex;flex-direction:column}
.kicker{font-family:"DM Mono";font-size:44px;letter-spacing:4px;text-transform:uppercase;color:${b.cover.accent}}
h1{margin-top:20px;font-family:"Instrument Serif";font-weight:400;font-size:${size}px;line-height:.95;letter-spacing:-2px}
.promise{margin-top:auto;font-family:"Instrument Serif";font-style:italic;font-size:110px;line-height:1.1}
.foot{position:absolute;left:120px;right:120px;bottom:0;height:${Math.round(H * 0.11)}px;border-top:4px solid ${b.cover.fg};display:flex;align-items:center;justify-content:space-between}
.foot .a{font-family:"Instrument Serif";font-size:84px}.foot .b{font-family:"Instrument Serif";font-size:52px}.foot .b i{font-style:italic;color:${b.cover.accent}}
</style></head><body><div class="photo"></div><div class="tabs"><div class="tab t1">PLAN</div><div class="tab t2">DO</div></div>
<div class="main"><div class="kicker">${esc(b.cover.kicker)}</div><h1>${nb(t)}</h1><div class="promise">${esc(b.cover.promise)}</div></div>
<div class="foot"><span class="a">${esc(b.author)}</span><span class="b">Dream <i>Wedding</i></span></div></body></html>`;
}

function apmCover(b, W, H) {
  const roles = ["Executive Coach", "Executive Assistant", "Chief of Staff", "Accountability Partner", "Mindset Coach"];
  return `<!doctype html><html><head><meta charset="utf-8">${GF("family=Outfit:wght@600;700&family=Nunito+Sans:wght@600;700")}<style>
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:"Nunito Sans"}
.logo{position:absolute;top:110px;left:120px;display:flex;align-items:center;gap:28px;font-family:Outfit;font-weight:600;font-size:60px}
.sq{width:110px;height:110px;border-radius:24px;background:${b.cover.fg};color:${b.cover.bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:56px;line-height:1}
.sq i{display:block;width:56px;height:5px;background:${b.cover.decoration};margin-top:5px}
.kicker{position:absolute;top:320px;left:120px;font-family:Outfit;font-weight:600;font-size:46px;letter-spacing:6px;text-transform:uppercase;color:${b.cover.accent}}
h1{position:absolute;top:420px;left:110px;right:80px;font-family:Outfit;font-weight:700;font-size:250px;line-height:.92;letter-spacing:-6px}
.promise{position:absolute;top:1000px;left:120px;right:120px;font-size:96px;font-weight:700;line-height:1.2;color:${b.cover.accent}}
.roles{position:absolute;left:120px;right:120px;top:${Math.round(H * 0.52)}px;bottom:${Math.round(H * 0.13)}px;display:flex;flex-direction:column;justify-content:space-evenly}
.r{display:flex;align-items:center;gap:40px;font-family:Outfit;font-weight:600;font-size:76px}.r b{flex:none;height:60px;border-radius:22px;background:${b.cover.decoration}}
.foot{position:absolute;left:0;right:0;bottom:0;height:${Math.round(H * 0.105)}px;background:${b.cover.fg};color:${b.cover.bg};display:flex;align-items:center;justify-content:space-between;padding:0 120px;font-family:Outfit;font-weight:600;font-size:80px}
.foot small{font-size:38px;color:${b.cover.decoration}}
</style></head><body><div class="logo"><div class="sq">A<i></i><i></i><i></i><i></i><i></i></div><span>A Player Mode</span></div>
<div class="kicker">${esc(b.cover.kicker)}</div><h1>Executive<br>Dys&shy;function</h1><div class="promise">${esc(b.cover.promise)}</div>
<div class="roles">${roles.map((r, i) => `<div class="r"><b style="width:${240 - i * 30}px"></b>${esc(r)}</div>`).join("")}</div>
<div class="foot"><span>${esc(b.author)}</span><small>Field guide · fill-in pages</small></div></body></html>`;
}

function t2rCover(b, W, H) {
  const tiles = ["a", "i", "o", "e", "u", "sh", "ch"];
  return `<!doctype html><html><head><meta charset="utf-8">${GF("family=Andika:wght@400;700")}<style>
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:Andika}
.kicker{position:absolute;top:110px;left:120px;font-size:56px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${b.cover.accent}}
h1{position:absolute;top:200px;left:110px;right:110px;font-size:270px;font-weight:700;line-height:.92;letter-spacing:-4px}
.sub{position:absolute;top:780px;left:120px;font-size:96px;font-weight:700}
.badge{position:absolute;top:760px;right:120px;width:300px;height:300px;border-radius:50%;background:${b.cover.accent};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;line-height:1;transform:rotate(8deg)}
.badge small{font-size:64px}.badge b{font-size:150px}
svg.art{position:absolute;left:0;right:0;top:${Math.round(H * 0.38)}px;width:${W}px;height:${Math.round(H * 0.36)}px}
.tiles{position:absolute;left:120px;right:120px;bottom:${Math.round(H * 0.125)}px;display:flex;gap:26px;justify-content:center}
.tiles span{background:#fff;border:6px solid ${b.cover.fg};border-radius:28px;min-width:150px;height:150px;display:flex;align-items:center;justify-content:center;font-size:100px;font-weight:700;padding:0 20px}
.foot{position:absolute;left:0;right:0;bottom:0;height:${Math.round(H * 0.095)}px;background:${b.cover.fg};color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 120px;font-size:72px;font-weight:700}
.foot small{font-size:44px;color:${b.cover.bg}}
</style></head><body><div class="kicker">${esc(b.cover.kicker)}</div><div class="badge"><small>BOOK</small><b>1</b></div>
<h1>Decodable<br>Stories</h1><div class="sub">for Early Readers</div>
<svg class="art" viewBox="0 0 1600 920">
<rect x="330" y="730" width="940" height="110" rx="30" fill="${b.cover.accent}"/><rect x="330" y="730" width="940" height="110" rx="30" fill="none" stroke="${b.cover.fg}" stroke-width="10"/>
<g stroke="${b.cover.fg}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" fill="#F6A04D">
<path d="M640 735 C600 560 660 430 800 420 C940 430 1000 560 960 735 Z"/>
<path d="M1000 690 C1120 690 1150 590 1090 560" fill="none"/>
<circle cx="800" cy="360" r="150"/><path d="M680 280 L690 160 L770 230 Z"/><path d="M920 280 L910 160 L830 230 Z"/></g>
<circle cx="745" cy="350" r="18" fill="${b.cover.fg}"/><circle cx="855" cy="350" r="18" fill="${b.cover.fg}"/>
<path d="M785 400 L815 400 L800 418 Z" fill="${b.cover.fg}"/><path d="M800 418 C790 440 770 445 760 440 M800 418 C810 440 830 445 840 440" stroke="${b.cover.fg}" stroke-width="8" fill="none" stroke-linecap="round"/>
<text x="1400" y="800" font-family="Andika" font-weight="700" font-size="90" fill="${b.cover.fg}" text-anchor="middle">mat</text>
<text x="200" y="560" font-family="Andika" font-weight="700" font-size="90" fill="${b.cover.fg}" text-anchor="middle">cat</text></svg>
<div class="tiles">${tiles.map((t) => `<span>${t}</span>`).join("")}</div>
<div class="foot"><span>${esc(b.author)}</span><small>7 stories · ages 4–7</small></div></body></html>`;
}

function uscisCover(b, W, H) {
  return `<!doctype html><html><head><meta charset="utf-8">${GF("family=Libre+Franklin:wght@600;800&family=Literata:opsz,wght@7..72,600")}<style>
${base(W, H)}body{background:${b.cover.bg};color:${b.cover.fg};font-family:"Libre Franklin"}
.kicker{position:absolute;top:120px;left:120px;font-size:50px;font-weight:600;letter-spacing:5px;text-transform:uppercase;color:#7A5A1C}
.small{font-family:Literata;font-weight:600;font-size:80px}
.col{position:absolute;top:230px;left:110px;right:100px;bottom:${Math.round(H * 0.105) + 90}px;display:flex;flex-direction:column}h1{font-weight:800;font-size:190px;line-height:.98;letter-spacing:-4px}
h1 .amp{color:${b.cover.accent}}
.steps{margin-top:auto;display:flex;flex-direction:column;gap:30px}
.s{display:flex;align-items:center;gap:40px;background:#fff;border:4px solid #E1D6BF;border-radius:30px;padding:30px 44px;font-size:64px;font-weight:600}
.s b{flex:none;width:110px;height:110px;border-radius:50%;background:${b.cover.fg};color:${b.cover.bg};display:flex;align-items:center;justify-content:center;font-size:66px}
.promise{margin-top:50px;font-family:Literata;font-weight:600;font-size:96px;color:${b.cover.fg}}
.foot{position:absolute;left:0;right:0;bottom:0;height:${Math.round(H * 0.105)}px;background:${b.cover.fg};color:${b.cover.bg};display:flex;align-items:center;justify-content:space-between;padding:0 120px;font-size:78px;font-weight:800}
.foot small{font-size:34px;font-weight:600;color:#E9C98A;text-align:right;line-height:1.3}
</style></head><body><div class="kicker">${esc(b.cover.kicker)}</div>
<div class="col"><h1><span class="small">The</span><br>Naturalization Interview <span class="amp">&amp;</span> Immigration Medical Exam<br><span class="small">Guide</span></h1>
<div class="promise">${esc(b.cover.promise)}</div>
<div class="steps"><div class="s"><b>1</b>The medical exam</div><div class="s"><b>2</b>The interview</div></div></div>
<div class="foot"><span>${esc(b.author)}</span><small>Independent guide · not<br>affiliated with any agency</small></div></body></html>`;
}

const books = [];
for (const f of ["keepmyproof", "aplayermode", "time2read", "wedding", "uscisexam"]) {
  const s = JSON.parse(readFileSync(join(SPEC, f + ".json"), "utf8"));
  for (const b of s.series_books) books.push({ ...b, line: f, author: b.author ?? s.author, isNew: true });
}
for (const b of JSON.parse(readFileSync(join(SPEC, "existing-books.json"), "utf8")).books) books.push({ ...b, isNew: false });
const tpl = { keepmyproof: kmpCover, approvalprep: apCover, wedding: wedCover, aplayermode: apmCover, time2read: t2rCover, uscisexam: uscisCover };

const br = await chromium.launch();
const manifest = [];
for (const b of books) {
  if (only.size && !only.has(b.slug)) continue;
  const sizes = [["kindle", 1600, 2560]];
  // Kindle front only: ENGINE builds the paperback wrap (blurb, spine, barcode) around this front.
  for (const [kind, W, H] of sizes) {
    const p = await br.newPage({ viewport: { width: W, height: H } });
    await p.setContent(tpl[b.line](b, W, H), { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const full = join(SCR, `${b.slug}-${kind}.png`);
    await p.screenshot({ path: full });
    await p.close();
    const name = kind === "kindle" ? `${b.slug}.jpg` : `${b.slug}-paperback.jpg`;
    await sharp(full).jpeg({ quality: 88, progressive: true }).toFile(join(OUT, name)); // full size, 1600x2560 (KDP needs 1000+ px)
    await sharp(full).resize({ height: 160 }).png().toFile(join(SCR, `${b.slug}-${kind}-160.png`));
    manifest.push({ slug: b.slug, kind, file: name });
  }
  console.log("rendered", b.slug);
}
await br.close();
writeFileSync(join(SCR, "manifest.json"), JSON.stringify(manifest, null, 1));
