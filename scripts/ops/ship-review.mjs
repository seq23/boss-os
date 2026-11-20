#!/usr/bin/env node
/**
 * THE ONE SHARED SHIP-READY REVIEWER (owner, 19 Nov 2026, personal brain "VETERAN QUALITY BAR,
 * HANDS-OFF"; ~/.claude/skills/ship-ready). The builder never grades its own work: this captures the
 * REAL output the way a person meets it, hands it to a fresh model with the ship-ready checklist, and
 * records PASS or FAIL with numbered findings and exactly what was looked at.
 *
 *   npm run vault:run -- node scripts/ops/ship-review.mjs --kind page --target https://example.com/ --builder "<who built it>"
 *     --kind     page | email | video | profile | images
 *     --target   page/profile: a URL · email: a rendered .html file · video: a video file ·
 *                images: a folder of images or a comma list of image files
 *     --builder  who built it (named in the record; the reviewer is never it)
 *     --subject  the key the verdict is kept under (default "<kind>:<target>"); senders and posters
 *                use their Email Map / Social Map row id ("email:<id>", "social:<id>")
 *     --brand    a brand slug: its ~/.claude/skills/design-<slug>/SKILL.md is the brand note
 *     --surface  public-page | operator-doc | email | app-screen | video | social-profile: which
 *                rules judge it (default from --kind; a private runbook or book is operator-doc)
 *     --planned  "<text>" (repeatable): a deliberate placeholder waiting on a known step; not a finding
 *     --brief    a file saying what changed and what to judge (the change's review brief)
 *     page/profile --target may be a comma list of up to 4 pages (the pages the change touched)
 *     --focus    "<text>" (repeatable): text the change touched; each page also gets a shot around it
 *                (with --brief the verdict is the CHANGE's; problems already there are listed apart)
 *     --launch   new and going public: judged against ship-ready section 3 too; prints Launch-ready
 *     --private  never a free route (default for emails and Boss OS's own screens); --public overrides
 *     --pr       owner/repo#N: on PASS the line is appended to that PR's body, where `land` reads it
 *     --out      where captures and verdict.json go (default ~/.boss-os/ship-reviews/<id>)
 *     --no-store judge and print only (a dry run; nothing is recorded, so `land` gets no line)
 *
 * The route walk is aiRoles.routeOrder: a subject never passed before is HARD (Claude, then Codex);
 * a re-review is SHORT (free Gemini vision models first, then Codex, then Claude); private output
 * never reaches a free route. A free route may FAIL a piece but never PASS it: its PASS goes on to a
 * seat for the final word. Never a paid API: Gemini's free tier, Codex on her ChatGPT plan and her
 * Claude seat through ~/bin/ai-run.
 *
 * RULE 0: `OUTPUT 1 reviews` only when a verdict was recorded. Exit 0 PASS · 1 FAIL · 2 NOT_RECORDED ·
 * 3 a key only she holds · 9 nothing captured or no route could review.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  KINDS, SURFACES, DEFAULT_SURFACE, findingLines, lookedAtText, parseVerdict, passLine, reviewId, reviewPrompt, reviewRoutes,
} from "../../src/shared/boss/shipReview/review.mjs";

const ROSTER = "https://raw.githubusercontent.com/seq23/search-loop/main/config/free-models.json";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const YT_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_CHANNEL = /youtube\.com\/(?:(@[\w.-]+)|channel\/(UC[\w-]+))/i;

const stop = (code, tag, why) => Object.assign(new Error(`NAMED STOP [${tag}] ${why}`), { code });

export function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    if (["--launch", "--private", "--public", "--no-store", "--capture-only", "--on-github"].includes(k)) { a.flags.add(k.slice(2)); continue; }
    if (k === "--planned") { (a.planned ??= []).push(argv[++i]); continue; }
    if (k === "--focus") { (a.focus ??= []).push(argv[++i]); continue; }
    a[k.slice(2)] = argv[++i];
  }
  a.planned ??= [];
  if (a.surface && !(a.surface in SURFACES)) throw stop(64, "BAD_ARGS", `--surface must be one of ${Object.keys(SURFACES).join(", ")}`);
  if (!KINDS.includes(a.kind)) throw stop(64, "BAD_ARGS", `--kind must be one of ${KINDS.join(", ")}`);
  if (!a.target) throw stop(64, "BAD_ARGS", "--target is required: what real output to look at");
  if (!a.builder) throw stop(64, "BAD_ARGS", "--builder is required: the reviewer must know who it is not");
  return a;
}

/** Output that may carry her private business (Boss OS's screens, emails) never reaches a free route. */
export function isPrivate(a) {
  if (a.flags.has("public")) return false;
  return a.flags.has("private") || a.kind === "email" || /(^|\/\/)boss\.sequoiataylor\.com/.test(String(a.target));
}

// ─── Capture: the real output, the way a person meets it ─────────────────────────────────────────

async function browser() {
  const { chromium } = await import("@playwright/test");
  return chromium.launch();
}

/** Tile height so a tall page is read at real size, in at most MAX_TILES parts that together cover it all. */
export const MAX_TILES = 8;
export function tilesFor(fullH, width) {
  const h = Math.max(1, Math.round(fullH || 1));
  let tile = width < 600 ? 2400 : 1800;
  if (Math.ceil(h / tile) > MAX_TILES) tile = Math.ceil(h / MAX_TILES);
  const out = [];
  for (let y = 0; y < h; y += tile) out.push({ y, height: Math.min(tile, h - y) });
  return out;
}

/** What a page's colours are: dark mode is read only when it really changes them. */
const COLORS = () => {
  const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "rgb(255, 255, 255)"; };
  const main = document.querySelector("main, article, h1, p") ?? document.body;
  return `${bg(document.body)} / ${bg(main)} / ${getComputedStyle(main).color}`;
};
const THEME_TOGGLE = /dark|theme|night|light mode|colou?r mode/i;

/**
 * One page at one size: the WHOLE page in tiles (no height cut: 20 Nov 2026, a change below a 3,200 px
 * cut could not be judged) and what the browser measured. For the dark pass, `lightColors` is the light
 * pass's colours: a site with no dark scheme is not captured twice; one with a theme toggle has it
 * pressed; a dark that cannot be reached is "dark: not read", never a finding.
 */
async function shoot(b, url, { width, height, scheme, file, focus = [], focusFile = null, lightColors = null }) {
  // The browser says what it is (owner's coordinator, 20 Nov 2026: the reviewer is never disguised to
  // get past a site's bot handling). YouTube is read through its Data API instead (captureYouTube).
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme, locale: "en-US", isMobile: width < 600, hasTouch: width < 600 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => ({ status: () => `not loaded (${e.message.split("\n")[0]})` }));
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // A consent wall is answered the privacy-first way (reject), as a stranger who declines would.
  for (const name of [/^reject all$/i, /^reject$/i, /^decline( all)?$/i, /^only (allow )?(necessary|essential)/i]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) { await btn.click().catch(() => {}); await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {}); break; }
  }
  // Wait for real content (words or pictures on the first screen), up to 25 s.
  await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 80 || [...document.querySelectorAll("img,video,canvas,svg")].filter((e) => e.getBoundingClientRect().width > 60).length > 2, null, { timeout: 25_000 }).catch(() => {});
  // Scroll the whole page once so scroll-triggered reveals and lazy images load, then settle at the
  // top: a capture taken mid-animation shows an empty or blurred hero (20 Nov 2026, linear.app).
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForTimeout(2000);
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    fullH: document.documentElement.scrollHeight,
    broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5),
    title: document.title,
    words: (document.body?.innerText ?? "").trim().length,
    media: [...document.querySelectorAll("img,video,canvas,svg")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 30; }).length,
  })).catch(() => ({ scrollW: width, fullH: height, broken: [], title: "", words: 0, media: 0 }));
  let colors = await page.evaluate(COLORS).catch(() => null);
  let dark = null;
  if (scheme === "dark" && lightColors && colors === lightColors) {
    const toggle = page.getByRole("button", { name: THEME_TOGGLE }).or(page.locator("[aria-label*=theme i], [aria-label*=dark i], [data-theme-toggle]")).first();
    if (await toggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await toggle.click().catch(() => {});
      await page.waitForTimeout(1_000);
      colors = await page.evaluate(COLORS).catch(() => null);
      dark = colors && colors !== lightColors ? "toggle" : "not read";
    } else dark = "none";
    if (dark !== "toggle") { await ctx.close(); return { dark, tiles: [], shot: false, blank: false, focused: [], errors, status: res?.status?.() ?? "unknown", ...m }; }
  }
  // Every part of the page, at real size. A busy Mac can hold a screenshot on web fonts past
  // Playwright's 30 s default: allow 180 s; a part that still cannot be captured is named, never faked.
  // fullPage is what lets a clip reach below the first screen.
  const parts = tilesFor(m.fullH || height, width);
  const tiles = [], missing = [];
  for (const [i, t] of parts.entries()) {
    const f = parts.length === 1 ? file : file.replace(/\.png$/, `-${i + 1}of${parts.length}.png`);
    const ok = await page.screenshot({ path: f, timeout: 180_000, fullPage: true, animations: "disabled", clip: { x: 0, y: t.y, width, height: t.height } }).then(() => true, () => false);
    if (ok) tiles.push(f); else missing.push(`part ${i + 1} of ${parts.length} (${t.y}-${t.y + t.height} px)`);
  }
  if (!tiles.length) await page.screenshot({ path: file, timeout: 60_000, animations: "disabled" }).then(() => { tiles.push(file); missing.push("the whole page (only the first screen was taken)"); }, () => {});
  const shot = tiles.length > 0;
  // THE CHANGED TEXT, WHEREVER IT SITS (20 Nov 2026: a footer note 6,500 px down was never in the
  // capture, so the change could not be judged). Each --focus text found on the page gets its own shot
  // of the screen around it.
  const focused = [];
  for (const [i, text] of focus.entries()) {
    const box = await page.getByText(text, { exact: false }).first().boundingBox({ timeout: 5_000 }).catch(() => null);
    if (!box) { focused.push({ text, file: null }); continue; }
    const top = Math.max(0, box.y - height / 2), f = focusFile(i);
    const ok = await page.screenshot({ path: f, fullPage: true, timeout: 120_000, animations: "disabled", clip: { x: 0, y: top, width, height: Math.min(height, Math.max(1, (m.fullH || height) - top)) } }).then(() => true, () => false);
    focused.push({ text, file: ok ? f : null });
  }
  await ctx.close();
  return { status: res?.status?.() ?? "unknown", errors, shot, tiles, missing, colors, dark, blank: isBlank(m), focused, ...m };
}

/** A capture with almost no words and no pictures is the browser failing, not the work: never judged. */
export const isBlank = (m) => (m?.words ?? 0) < 40 && (m?.media ?? 0) === 0;

/** A page's short name for capture labels: "/questions/x/" → "questions-x", the home page → "home". */
export const pageSlug = (u) => { try { const p = new URL(u).pathname.replace(/\/+$/, ""); return p ? p.slice(1).replace(/[^a-z0-9]+/gi, "-").slice(0, 48) : "home"; } catch { return "page"; } };

/**
 * One page: phone light + dark and laptop. Several pages (a comma list, the pages a change touched):
 * phone and laptop of each, at most 4 pages, so every capture still fits one review.
 */
async function capturePage(a, out) {
  const targets = a.kind === "email" ? [a.target] : String(a.target).split(",").map((t) => t.trim()).filter(Boolean);
  if (targets.length > 4) throw stop(64, "BAD_ARGS", `at most 4 pages per review (got ${targets.length}); split the review`);
  if (a.kind === "email" && !existsSync(a.target)) throw stop(9, "NOTHING_CAPTURED", `${a.target} does not exist: give the rendered email's .html file`);
  const many = targets.length > 1;
  const b = await browser();
  const shots = [], facts = [], blanks = [];
  try {
    for (const target of targets) {
      const url = a.kind === "email" ? pathToFileURL(resolve(target)).href : target;
      const pre = many ? `${pageSlug(target)}-` : "";
      // Dark is read on the first page of a review (one page's dark tells whether the site has one).
      const sizes = [
        { label: `${pre}phone-390-light.png`, width: 390, height: 844, scheme: "light" },
        ...(target === targets[0] ? [{ label: `${pre}phone-390-dark.png`, width: 390, height: 844, scheme: "dark" }] : []),
        { label: `${pre}laptop-1280-light.png`, width: 1280, height: 800, scheme: "light" },
      ];
      let lightColors = null;
      const say = (f) => facts.push(many ? `${pageSlug(target)}: ${f}` : f);
      for (const s of sizes) {
        const file = join(out, s.label);
        const fbase = s.label.replace(/\.png$/, "");
        const m = await shoot(b, url, { ...s, file, lightColors: s.scheme === "dark" ? lightColors : null, focus: s.scheme === "light" ? (a.focus ?? []) : [], focusFile: (i) => join(out, `${fbase}-focus-${i + 1}.png`) });
        if (s === sizes[0]) lightColors = m.colors;
        if (s.scheme === "dark" && (m.dark === "none" || m.dark === "not read")) {
          say(m.dark === "none" ? "dark: the site has no dark scheme (the page looks the same with the phone in dark mode); nothing to judge" : "dark: not read (a theme toggle was there but the harness could not reach a dark page)");
          continue;
        }
        if (s.scheme === "dark") say(m.dark === "toggle" ? "dark: read through the site's own theme toggle" : "dark: the site has its own dark scheme; captured");
        for (const [i, f] of (m.focused ?? []).entries()) {
          if (f.file) shots.push({ path: f.file, label: `${fbase}-focus-${i + 1}.png` });
          else say(`the changed text "${f.text.slice(0, 80)}" was not found on this page at ${s.width} px`);
        }
        if (m.shot && !m.blank) for (const t of m.tiles) shots.push({ path: t, label: basename(t) });
        if (m.shot && !m.blank) say(`the ${fbase} capture is the whole page (${m.fullH} px) in ${m.tiles.length} part${m.tiles.length === 1 ? "" : "s"}${m.missing.length ? `; NOT captured: ${m.missing.join(", ")}` : ""}`);
        else say(`the ${s.label.replace(/\.png$/, "")} capture could not be taken${m.blank ? " (the browser got a blank page)" : ""}`);
        if (m.blank) blanks.push(s.label);
        if (s === sizes[0]) {
          if (a.kind !== "email") say(`HTTP status of the page: ${m.status}`);
          say(m.scrollW > 390 ? `horizontal scroll at 390 px: the page is ${m.scrollW} px wide` : "no horizontal scroll at 390 px");
          say(m.broken.length ? `broken images: ${m.broken.join(", ")}` : "no broken images");
          if (a.kind !== "email") say(m.title ? `page title: "${m.title}"` : "the page has NO <title>");
          say(m.errors.length ? `console errors on load: ${m.errors.slice(0, 3).join(" | ")}` : "no console errors on load");
        }
      }
    }
  } finally { await b.close(); }
  // RULE 0: a blank capture is the capture failing, a NAMED STOP, never a FAIL on the builder's work.
  if (!shots.length && blanks.length) throw stop(9, "CAPTURE_BLANK", `the browser got a blank page for ${a.target} at ${blanks.join(", ")}; nothing was judged. Retry, or capture it another way (--kind images with real screenshots)`);
  return { shots, facts };
}

function captureVideo(a, out) {
  if (!existsSync(a.target)) throw stop(9, "NOTHING_CAPTURED", `${a.target} does not exist`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.target], { encoding: "utf8" });
  const dur = Number(probe.stdout.trim());
  if (!(dur > 0)) throw stop(9, "NOTHING_CAPTURED", `ffprobe could not read a duration from ${a.target}`);
  const sheet = join(out, "contact-sheet-12-frames.png"), first = join(out, "first-frame.png");
  spawnSync("ffmpeg", ["-y", "-v", "error", "-i", a.target, "-vf", `fps=12/${dur},scale=360:-2,tile=4x3`, "-frames:v", "1", sheet]);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", "0.3", "-i", a.target, "-frames:v", "1", "-vf", "scale=720:-2", first]);
  const shots = [{ path: first, label: "first-frame.png" }, { path: sheet, label: "contact-sheet-12-frames.png" }].filter((s) => existsSync(s.path));
  return { shots, facts: [`video length ${dur.toFixed(1)} s; the contact sheet holds 12 frames, one every ${(dur / 12).toFixed(1)} s, left to right, top to bottom`] };
}

function captureImages(a) {
  const t = String(a.target);
  const files = existsSync(t) && statSync(t).isDirectory()
    ? readdirSync(t).filter((f) => IMAGE_EXT.test(f)).sort().map((f) => join(t, f))
    : t.split(",").map((s) => s.trim()).filter(Boolean);
  const shots = files.filter((f) => IMAGE_EXT.test(f) && existsSync(f)).slice(0, 8).map((f) => ({ path: resolve(f), label: basename(f) }));
  return { shots, facts: files.length > 8 ? [`${files.length} images given; the first 8 are judged`] : [] };
}


/**
 * A YOUTUBE CHANNEL IS READ THROUGH THE OFFICIAL DATA API (20 Nov 2026: a headless browser gets a blank
 * shell from YouTube, and the reviewer is never disguised to get past that). Her own key
 * (HOWWEKNOW_YOUTUBE_API_KEY, read-only public data): channels.list for the avatar, banner, title,
 * handle, description and counts, the uploads playlist for the newest video thumbnails. They are drawn
 * at the sizes YouTube shows them (phone 390 px, laptop 1280 px) and the raw avatar and banner are
 * judged at full size too.
 */
async function captureYouTube(a, out, { env = process.env, fetchImpl = fetch } = {}) {
  const key = env.HOWWEKNOW_YOUTUBE_API_KEY;
  if (!key) throw stop(3, "NO_YOUTUBE_KEY", "HOWWEKNOW_YOUTUBE_API_KEY is not in the environment: run through the vault (npm run vault:run -- …)");
  const [, handle, id] = YOUTUBE_CHANNEL.exec(a.target);
  const get = async (path) => { const r = await fetchImpl(`${YT_API}/${path}&key=${encodeURIComponent(key)}`); const j = await r.json().catch(() => ({})); if (!r.ok) throw stop(75, "YOUTUBE_API", `${path.split("?")[0]} answered ${r.status} ${j?.error?.message ?? ""}`); return j; };
  const ch = (await get(`channels?part=snippet,brandingSettings,statistics,contentDetails&${handle ? `forHandle=${encodeURIComponent(handle)}` : `id=${id}`}`)).items?.[0];
  if (!ch) throw stop(9, "NOTHING_CAPTURED", `YouTube has no channel at ${a.target}`);
  const sn = ch.snippet ?? {}, st = ch.statistics ?? {};
  const avatar = sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null;
  const banner = ch.brandingSettings?.image?.bannerExternalUrl ?? null;
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const vids = uploads ? ((await get(`playlistItems?part=snippet&maxResults=8&playlistId=${uploads}`).catch(() => ({ items: [] }))).items ?? []) : [];
  const thumbs = vids.map((v) => ({ title: v.snippet?.title ?? "", url: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url })).filter((v) => v.url);
  const facts = [
    "read through the YouTube Data API (the channel's real avatar, banner, title, description and newest uploads), drawn at YouTube's display sizes; not a browser visit",
    `channel title "${sn.title ?? ""}", handle ${sn.customUrl ?? handle ?? id}`,
    `${st.hiddenSubscriberCount ? "subscriber count hidden" : `${st.subscriberCount ?? "?"} subscribers`}, ${st.videoCount ?? 0} public videos`,
    sn.description ? `description (${sn.description.length} characters): "${sn.description.replace(/\s+/g, " ").slice(0, 400)}"` : "the channel has NO description",
    avatar ? "avatar set" : "NO avatar (YouTube's default letter)",
    banner ? "banner set" : "NO banner",
    thumbs.length ? `${thumbs.length} newest upload thumbnail(s) shown` : "NO uploads: a first visitor sees an empty channel",
  ];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pageFor = (w) => {
    const phone = w < 600, av = phone ? 72 : 160, bh = Math.round(w / (phone ? 3.65 : 6.2));
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:14px Roboto,Arial,sans-serif;color:#0f0f0f;width:${w}px">
${banner ? `<div style="height:${bh}px;background:url('${banner}=w2560') center/cover"></div>` : ""}
<div style="display:flex;gap:${phone ? 12 : 24}px;align-items:center;padding:${phone ? 12 : 24}px">
${avatar ? `<img src="${avatar}" style="width:${av}px;height:${av}px;border-radius:50%">` : `<div style="width:${av}px;height:${av}px;border-radius:50%;background:#888"></div>`}
<div><div style="font-size:${phone ? 22 : 36}px;font-weight:700">${esc(sn.title ?? "")}</div>
<div style="color:#606060">${esc(sn.customUrl ?? "")} · ${st.hiddenSubscriberCount ? "" : `${esc(st.subscriberCount ?? 0)} subscribers · `}${esc(st.videoCount ?? 0)} videos</div>
<div style="color:#606060;max-width:${phone ? 260 : 700}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((sn.description ?? "").split("\n")[0])}</div></div></div>
<div style="display:grid;grid-template-columns:repeat(${phone ? 1 : 4},1fr);gap:16px;padding:${phone ? 12 : 24}px">
${thumbs.map((t) => `<div><img src="${t.url}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px"><div style="font-weight:600;margin-top:6px">${esc(t.title)}</div></div>`).join("")}
${thumbs.length ? "" : `<div style="color:#606060;padding:32px 0">This channel doesn't have any content</div>`}</div></body>`;
  };
  const b = await browser();
  const shots = [];
  try {
    for (const [label, w, h] of [["youtube-phone-390.png", 390, 844], ["youtube-laptop-1280.png", 1280, 800]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.setContent(pageFor(w), { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
      await page.screenshot({ path: join(out, label), fullPage: true, timeout: 120_000 }).then(() => shots.push({ path: join(out, label), label })).catch(() => facts.push(`the ${label} drawing could not be taken`));
      await ctx.close();
    }
  } finally { await b.close(); }
  for (const [label, url] of [["avatar-full.jpg", avatar ? avatar.replace(/=s\d+[^/]*$/, "=s800") : null], ["banner-full.jpg", banner ? `${banner}=w2560` : null]]) {
    if (!url) continue;
    const r = await fetchImpl(url).catch(() => null);
    if (r?.ok) { writeFileSync(join(out, label), Buffer.from(await r.arrayBuffer())); shots.push({ path: join(out, label), label }); }
  }
  return { shots, facts };
}

export async function capture(a, out, deps = {}) {
  if (YOUTUBE_CHANNEL.test(String(a.target)) && (a.kind === "profile" || a.kind === "page")) return captureYouTube(a, out, deps);
  if (a.kind === "video") return captureVideo(a, out);
  if (a.kind === "images") return captureImages(a);
  return capturePage(a, out);
}

/**
 * THE CAPTURE ON GITHUB (coordinator, 20 Nov 2026: 8 GB Mac, 22 GB into swap from headless Chromes).
 * `--capture-only` (what the workflow runs) writes the shots and facts with `capture.json`; `--on-github`
 * dispatches .github/workflows/ship-review-capture.yml, waits for it in one bounded call, downloads the
 * artifact and judges from it on the Mac. Public pages only: this repo and its artifacts are public.
 */
const CAPTURE_REPO = "seq23/boss-os";
export function writeCaptureFile(out, { shots, facts }) {
  writeFileSync(join(out, "capture.json"), JSON.stringify({ shots: shots.map((s) => ({ label: s.label, file: basename(s.path) })), facts }, null, 2));
}
export function readCaptureFile(dir) {
  const f = join(dir, "capture.json");
  if (!existsSync(f)) throw stop(9, "GITHUB_CAPTURE", `${f} is missing: the GitHub capture left no capture.json`);
  const j = JSON.parse(readFileSync(f, "utf8"));
  const shots = (j.shots ?? []).map((s) => ({ label: s.label, path: join(dir, s.file) })).filter((s) => existsSync(s.path));
  return { shots, facts: Array.isArray(j.facts) ? j.facts : [] };
}
async function captureOnGithub(a, id, out, { run = spawnSync, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (isPrivate(a) || a.kind !== "page" || YOUTUBE_CHANNEL.test(String(a.target))) throw stop(64, "BAD_ARGS", "--on-github is for public web pages only (its artifacts are public); capture private work and YouTube on the Mac");
  const gh = (args, o = {}) => run("gh", args, { encoding: "utf8", maxBuffer: 64 << 20, ...o });
  const d = gh(["workflow", "run", "ship-review-capture.yml", "-R", CAPTURE_REPO, "-f", `target=${a.target}`, "-f", `label=${id}`, "-f", `focus=${JSON.stringify(a.focus ?? [])}`]);
  if (d.status !== 0) throw stop(9, "GITHUB_CAPTURE", `could not start the capture workflow: ${String(d.stderr).trim().slice(0, 200)}`);
  let runId = null;
  for (let i = 0; i < 24 && !runId; i++) {
    await wait(5_000);
    const l = gh(["run", "list", "-R", CAPTURE_REPO, "-w", "ship-review-capture.yml", "-L", "20", "--json", "databaseId,displayTitle"]);
    runId = (JSON.parse(l.stdout || "[]").find((r) => r.displayTitle === `ship-review capture ${id}`) ?? {}).databaseId ?? null;
  }
  if (!runId) throw stop(9, "GITHUB_CAPTURE", `the capture run for ${id} never appeared in two minutes`);
  const w = gh(["run", "watch", String(runId), "-R", CAPTURE_REPO, "--exit-status", "-i", "15"], { timeout: 25 * 60_000 });
  if (w.status !== 0) throw stop(9, "GITHUB_CAPTURE", `the capture run ${runId} failed or timed out (gh run view ${runId} -R ${CAPTURE_REPO} --log-failed)`);
  const dl = gh(["run", "download", String(runId), "-R", CAPTURE_REPO, "-n", `ship-capture-${id}`, "-D", out]);
  if (dl.status !== 0) throw stop(9, "GITHUB_CAPTURE", `could not download the capture of run ${runId}: ${String(dl.stderr).trim().slice(0, 200)}`);
  const c = readCaptureFile(out);
  return { ...c, facts: [...c.facts, `captured on GitHub Actions (run ${runId}), the same capture code as on the Mac`] };
}

// ─── Judge: down the route walk until one route returns a review it can trust ─────────────────────

async function geminiModels(fetchImpl) {
  try {
    const j = await (await fetchImpl(ROSTER)).json();
    if (j?.policy?.max_cost_usd !== 0 || j?.policy?.fallback_to_paid !== false) return [];
    return (j.gemini_models ?? []).map((m) => (typeof m === "string" ? { id: m } : m));
  } catch { return []; }
}

const mediaType = (p) => ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(p).toLowerCase()] ?? "image/png");

async function freeTier({ prompt, shots, env, fetchImpl, log, scoped = false }) {
  if (!env.GEMINI_API_KEY) { log("free: no GEMINI_API_KEY in the environment (run through vault:run); passed over"); return null; }
  for (const m of await geminiModels(fetchImpl)) {
    const content = [{ type: "text", text: prompt }, ...shots.map((s) => ({ type: "image_url", image_url: { url: `data:${mediaType(s.path)};base64,${readFileSync(s.path).toString("base64")}` } }))];
    try {
      const r = await fetchImpl(GEMINI, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.GEMINI_API_KEY}` }, body: JSON.stringify({ model: m.id, messages: [{ role: "user", content }], max_tokens: 4000, temperature: 0.1, reasoning_effort: m.reasoning_effort ?? "none" }), signal: AbortSignal.timeout(180_000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { log(`free: ${m.id} answered ${r.status}`); continue; }
      const v = parseVerdict(j?.choices?.[0]?.message?.content ?? "", shots, { scoped });
      if (v.error) { log(`free: ${m.id} — ${v.error}`); continue; }
      return { ...v, model: `gemini ${m.id}` };
    } catch (e) { log(`free: ${m.id} — ${e.message}`); }
  }
  return null;
}

function seatTier(tier, { prompt, shots, out, env, log, run = spawnSync, scoped = false }) {
  const bin = env.AI_RUN_BIN || join(env.HOME || homedir(), "bin", "ai-run");
  if (!existsSync(bin)) { log(`${tier}: ${bin} is not installed`); return null; }
  const role = tier === "codex" ? "worker" : "brain";
  const r = run(bin, ["--role", role, "--cwd", out, "--", prompt], {
    encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 32 << 20,
    env: { ...env, AI_RUN_CALLER: "ship-review", ...(tier === "codex" ? { AI_RUN_NO_CLAUDE_FALLBACK: "1" } : {}) },
  });
  const v = parseVerdict(`${r.stdout ?? ""}`, shots, { scoped });
  if (v.error) { log(`${tier}: exit ${r.status} — ${v.error}`); return null; }
  return { ...v, model: tier === "codex" ? "codex seat" : "claude seat" };
}

/** Walk the routes. Returns the first trusted review, or null when every route was out or untrustworthy. */
export async function judge({ routes, base, shots, out, env = process.env, fetchImpl = fetch, log = () => {}, run = spawnSync }) {
  for (const tier of routes) {
    const onDisk = `on disk: ${shots.map((s) => `${s.label} = ${s.path}`).join("; ")}. Open every one (Claude: the Read tool; Codex: view_image). Do not create or edit any file`;
    const prompt = reviewPrompt({ ...base, shots, imageHow: tier === "free" ? "attached in that order" : onDisk });
    const scoped = Boolean(base.brief);
    const v = tier === "free" ? await freeTier({ prompt, shots, env, fetchImpl, log, scoped }) : seatTier(tier, { prompt, shots, out, env, log, run, scoped });
    if (!v) continue;
    // A FREE PASS IS NOT FINAL (measured 20 Nov 2026: a free Gemini model passed a P&P reel with frozen
    // repeated frames and warped balloon lettering that it failed as stills). A free route may FAIL a
    // piece, since its findings are specific and checkable; only a seat may PASS it.
    if (v.verdict === "PASS" && tier === "free") { log(`free: ${v.model} passed it; a free PASS is confirmed by a seat before it counts`); continue; }
    if (v.verdict === "UNSEEN" && tier === "free") { log(`free: ${v.model} could not see ${v.unseen.join("; ")}; a seat looks before the capture is called incomplete`); continue; }
    return { ...v, tier };
  }
  return null;
}

// ─── Record and hand on ──────────────────────────────────────────────────────────────────────────

async function bossApi(env, fetchImpl) {
  const origin = env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  if (!env.BOSS_PASSCODE) throw stop(3, "NO_PASSCODE", "run through the vault: npm run vault:run -- node scripts/ops/ship-review.mjs …");
  const u = await fetchImpl(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: env.BOSS_PASSCODE }) });
  if (!u.ok) throw stop(3, "UNLOCK_FAILED", `Boss OS refused the passcode (${u.status})`);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const call = async (method, path, body) => {
    const r = await fetchImpl(`${origin}/api/boss${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j?.error ?? j).slice(0, 200)}`);
    return j?.data ?? j;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };
}

/** Findings as one PR comment, so the builder reads them where it works. */
function commentOnPr(pr, body, run = spawnSync) {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(pr));
  if (!m) return `--pr must look like owner/repo#123 (got ${pr})`;
  const r = run("gh", ["pr", "comment", m[2], "-R", m[1], "--body-file", "-"], { input: body, encoding: "utf8" });
  return r.status === 0 ? null : `gh pr comment failed: ${String(r.stderr).trim().slice(0, 200)}`;
}

/**
 * THE CHANGE ITSELF for the reviewer (20 Nov 2026, hicks #72: with only the live page, the reviewer could
 * not tell which sentence the change reworded). A PR's unified diff → its changed lines, per file, with
 * lockfiles, maps, minified and binary files left out, each line trimmed, capped in total. Pure.
 */
const NOT_READ = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(min\.(js|css)|map|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf|mp4)$/i;
export function changedLines(diff, cap = 6000) {
  const out = [];
  let file = null, skip = false, len = 0, dropped = 0;
  for (const l of String(diff ?? "").split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l);
    if (f) { file = f[1]; skip = NOT_READ.test(file); continue; }
    if (skip || l.startsWith("---") || !/^[+-]/.test(l) || !l.slice(1).trim()) continue;
    const line = `${l[0]} ${l.slice(1).trim().slice(0, 300)}`;
    const head = out.at(-1)?.file === file ? "" : `${file}:\n`;
    if (len + head.length + line.length > cap) { dropped++; continue; }
    out.push({ file, text: `${head}${line}` }); len += head.length + line.length + 1;
  }
  return out.map((o) => o.text).join("\n") + (dropped ? `\n(${dropped} more changed line${dropped === 1 ? "" : "s"} not shown)` : "");
}
function prDiff(pr, run = spawnSync) {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(pr));
  if (!m) return null;
  const r = run("gh", ["pr", "diff", m[2], "-R", m[1]], { encoding: "utf8", maxBuffer: 64 << 20 });
  return r.status === 0 ? changedLines(r.stdout) : null;
}

/** Append the PASS line to a PR body (land reads the last one). */
function addToPr(pr, line, run = spawnSync) {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(pr));
  if (!m) return `--pr must look like owner/repo#123 (got ${pr})`;
  const view = run("gh", ["pr", "view", m[2], "-R", m[1], "--json", "body", "-q", ".body"], { encoding: "utf8" });
  if (view.status !== 0) return `gh pr view failed: ${String(view.stderr).trim().slice(0, 200)}`;
  const edit = run("gh", ["pr", "edit", m[2], "-R", m[1], "--body-file", "-"], { input: `${String(view.stdout).replace(/\s+$/, "")}\n\n${line}\n`, encoding: "utf8" });
  return edit.status === 0 ? null : `gh pr edit failed: ${String(edit.stderr).trim().slice(0, 200)}`;
}

export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = fetch, log = (s) => console.error(s), print = (s) => console.log(s) } = {}) {
  const a = parseArgs(argv);
  const id = reviewId();
  const out = resolve(a.out ?? join(env.HOME || homedir(), ".boss-os", "ship-reviews", id));
  mkdirSync(out, { recursive: true });
  if (a.flags.has("capture-only")) {
    const c = await capture(a, out, { env, fetchImpl });
    writeCaptureFile(out, c);
    print(`CAPTURED ${c.shots.length} shots, ${c.facts.length} facts`);
    if (!c.shots.length) throw stop(9, "NOTHING_CAPTURED", `no capture of ${a.target} could be made`);
    return 0;
  }
  const subject = a.subject ?? `${a.kind}:${a.target}`;
  const skill = env.SHIP_READY_SKILL ?? join(env.HOME || homedir(), ".claude", "skills", "ship-ready", "SKILL.md");
  if (!existsSync(skill)) throw stop(2, "NO_CHECKLIST", `${skill} is missing: the reviewer judges against the ship-ready skill and will not judge without it`);
  if (a.brief && !existsSync(a.brief)) throw stop(64, "NO_BRIEF", `${a.brief} does not exist`);
  const brandFile = a.brand ? join(env.HOME || homedir(), ".claude", "skills", `design-${a.brand}`, "SKILL.md") : null;
  if (brandFile && !existsSync(brandFile)) throw stop(64, "NO_BRAND_NOTE", `${brandFile} does not exist; leave --brand off or name a brand that has a design skill`);

  const api = a.flags.has("no-store") ? null : await bossApi(env, fetchImpl);
  const before = api ? await api.get(`/quality/reviews?subject=${encodeURIComponent(subject)}`).catch((e) => { log(`could not read earlier verdicts (${e.message}); judged as a first review`); return null; }) : null;
  const firstOfKind = !before?.passed_before;
  const privateWork = isPrivate(a);
  const { routes } = reviewRoutes({ firstOfKind, privateWork });

  const { shots, facts } = a.flags.has("on-github") ? await captureOnGithub(a, id, out) : await capture(a, out, { env, fetchImpl });
  if (!shots.length) { print("OUTPUT 0 reviews"); throw stop(9, "NOTHING_CAPTURED", `no capture of ${a.target} could be made, so nothing was judged`); }
  const lookedAt = `${lookedAtText({ kind: a.kind, target: a.target, shots })}, judged as ${a.surface ?? DEFAULT_SURFACE[a.kind]}${a.planned.length ? ` with ${a.planned.length} planned placeholder(s) excluded` : ""}`;
  log(`ship-review ${id}: ${lookedAt}; ${firstOfKind ? "first review" : "re-review"}${privateWork ? ", private" : ""}; routes ${routes.join(" → ")}`);

  const base = {
    kind: a.kind, target: a.target, builder: a.builder, facts, launch: a.flags.has("launch"),
    surface: a.surface ?? DEFAULT_SURFACE[a.kind], planned: a.planned,
    brief: a.brief ? readFileSync(a.brief, "utf8").slice(0, 6000) : null,
    change: a.pr && a.kind === "page" ? prDiff(a.pr) : null,
    checklist: readFileSync(skill, "utf8").replace(/^---[\s\S]*?---\s*/, ""),
    brand: brandFile ? readFileSync(brandFile, "utf8").replace(/^---[\s\S]*?---\s*/, "").slice(0, 8000) : null,
  };
  const v = await judge({ routes, base, shots, out, env, fetchImpl, log });
  if (!v) { print("OUTPUT 0 reviews"); throw stop(9, "NO_REVIEWER", `every route (${routes.join(", ")}) was out or gave no review it could trust; the next run tries again. Captures kept in ${out}`); }

  // RULE 0: what no capture showed stops the harness, never the work (coordinator, 20 Nov 2026).
  if (v.verdict === "UNSEEN") {
    writeFileSync(join(out, "verdict.json"), JSON.stringify({ id, subject, verdict: "UNSEEN", unseen: v.unseen, already: v.already, route: v.model, facts, at: new Date().toISOString() }, null, 2));
    print("OUTPUT 0 reviews");
    throw stop(9, "CAPTURE_INCOMPLETE", `${v.model} could not see: ${v.unseen.join("; ")}. Nothing was judged; capture it (--focus "<changed text>", or the page that holds it) and rerun. Captures kept in ${out}`);
  }
  const reviewer = `boss-os ship-review ${id} (${v.model})`;
  const line = v.verdict === "PASS" ? passLine({ reviewer, lookedAt, launch: base.launch }) : `${base.launch ? "Launch" : "Ship"}-ready: FAIL — ${reviewer} looked at ${lookedAt}`;
  const already = v.already ?? [];
  const record = { id, subject, kind: a.kind, verdict: v.verdict, findings: v.findings, already, looked_at: lookedAt, builder: a.builder, route: v.model, line, facts, surface: a.surface ?? DEFAULT_SURFACE[a.kind], planned: a.planned, at: new Date().toISOString() };
  writeFileSync(join(out, "verdict.json"), JSON.stringify(record, null, 2));
  print(line);
  for (const l of findingLines(v.findings)) print(l);
  if (v.unseen?.length) print(`Not seen in any capture (the harness's, not a finding): ${v.unseen.join("; ")}`);
  if (already.length) { print("Already there before this change (not this change's verdict; fix in its own round):"); for (const l of findingLines(already)) print(`  ${l}`); }
  print(`Captures and verdict: ${out}`);

  if (api) {
    try { await api.post("/quality/reviews", record); }
    catch (e) { print("OUTPUT 0 reviews"); throw stop(2, "NOT_RECORDED", `the verdict was not stored in Boss OS (${e.message}); it is in ${join(out, "verdict.json")}. Rerun once Boss OS answers`); }
  }
  if (a.pr && v.verdict === "PASS") { const err = addToPr(a.pr, line); if (err) log(`NAMED STOP [PR_NOT_UPDATED] ${err}; add the line above to the PR body by hand`); }
  if (a.pr && (v.verdict === "FAIL" || already.length)) {
    const body = [line, "", ...(v.findings.length ? ["Findings (this change):", ...findingLines(v.findings), ""] : []),
      ...(already.length ? ["Already there before this change (not this verdict; fix in its own round):", ...findingLines(already), ""] : []),
      ...(v.unseen?.length ? [`Not seen in any capture (the harness's, not a finding): ${v.unseen.join("; ")}`, ""] : []),
      `Looked at: ${lookedAt}`].join("\n");
    const err = commentOnPr(a.pr, body);
    if (err) log(`NAMED STOP [PR_NOT_UPDATED] ${err}; the findings are in ${join(out, "verdict.json")}`);
  }
  print(api ? "OUTPUT 1 reviews" : "OUTPUT 0 reviews (--no-store: judged, not recorded)");
  return v.verdict === "PASS" ? 0 : 1;
}


if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
