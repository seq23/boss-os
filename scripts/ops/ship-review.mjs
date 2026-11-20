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
  KINDS, findingLines, lookedAtText, parseVerdict, passLine, reviewId, reviewPrompt, reviewRoutes,
} from "../../src/shared/boss/shipReview/review.mjs";

const ROSTER = "https://raw.githubusercontent.com/seq23/search-loop/main/config/free-models.json";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

const stop = (code, tag, why) => Object.assign(new Error(`NAMED STOP [${tag}] ${why}`), { code });

export function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    if (["--launch", "--private", "--public", "--no-store"].includes(k)) { a.flags.add(k.slice(2)); continue; }
    a[k.slice(2)] = argv[++i];
  }
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

/** One page at one size: a screenshot (capped in height) and what the browser measured. */
async function shoot(b, url, { width, height, scheme, file, maxHeight }) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch((e) => ({ status: () => `not loaded (${e.message.split("\n")[0]})` }));
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    fullH: document.documentElement.scrollHeight,
    broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5),
    title: document.title,
  })).catch(() => ({ scrollW: width, fullH: height, broken: [], title: "" }));
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height: Math.min(m.fullH || height, maxHeight) } }).catch(async () => page.screenshot({ path: file }));
  await ctx.close();
  return { status: res?.status?.() ?? "unknown", errors, ...m };
}

async function capturePage(a, out) {
  const url = a.kind === "email" ? pathToFileURL(resolve(a.target)).href : a.target;
  if (a.kind === "email" && !existsSync(a.target)) throw stop(9, "NOTHING_CAPTURED", `${a.target} does not exist: give the rendered email's .html file`);
  const sizes = [
    { label: "phone-390-light.png", width: 390, height: 844, scheme: "light", maxHeight: 3200 },
    { label: "phone-390-dark.png", width: 390, height: 844, scheme: "dark", maxHeight: 3200 },
    { label: "laptop-1280-light.png", width: 1280, height: 800, scheme: "light", maxHeight: 2400 },
  ];
  const b = await browser();
  const shots = [], facts = [];
  try {
    for (const s of sizes) {
      const file = join(out, s.label);
      const m = await shoot(b, url, { ...s, file });
      shots.push({ path: file, label: s.label });
      if (s.label === sizes[0].label) {
        if (a.kind !== "email") facts.push(`HTTP status of the page: ${m.status}`);
        facts.push(m.scrollW > 390 ? `horizontal scroll at 390 px: the page is ${m.scrollW} px wide` : "no horizontal scroll at 390 px");
        facts.push(m.broken.length ? `broken images: ${m.broken.join(", ")}` : "no broken images");
        if (a.kind !== "email") facts.push(m.title ? `page title: "${m.title}"` : "the page has NO <title>");
        facts.push(m.errors.length ? `console errors on load: ${m.errors.slice(0, 3).join(" | ")}` : "no console errors on load");
        if (m.fullH > s.maxHeight) facts.push(`the phone capture shows the first ${s.maxHeight} px of ${m.fullH}`);
      }
    }
  } finally { await b.close(); }
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

export async function capture(a, out) {
  if (a.kind === "video") return captureVideo(a, out);
  if (a.kind === "images") return captureImages(a);
  return capturePage(a, out);
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

async function freeTier({ prompt, shots, env, fetchImpl, log }) {
  if (!env.GEMINI_API_KEY) { log("free: no GEMINI_API_KEY in the environment (run through vault:run); passed over"); return null; }
  for (const m of await geminiModels(fetchImpl)) {
    const content = [{ type: "text", text: prompt }, ...shots.map((s) => ({ type: "image_url", image_url: { url: `data:${mediaType(s.path)};base64,${readFileSync(s.path).toString("base64")}` } }))];
    try {
      const r = await fetchImpl(GEMINI, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.GEMINI_API_KEY}` }, body: JSON.stringify({ model: m.id, messages: [{ role: "user", content }], max_tokens: 4000, temperature: 0.1, reasoning_effort: m.reasoning_effort ?? "none" }), signal: AbortSignal.timeout(180_000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { log(`free: ${m.id} answered ${r.status}`); continue; }
      const v = parseVerdict(j?.choices?.[0]?.message?.content ?? "", shots);
      if (v.error) { log(`free: ${m.id} — ${v.error}`); continue; }
      return { ...v, model: `gemini ${m.id}` };
    } catch (e) { log(`free: ${m.id} — ${e.message}`); }
  }
  return null;
}

function seatTier(tier, { prompt, shots, out, env, log, run = spawnSync }) {
  const bin = env.AI_RUN_BIN || join(env.HOME || homedir(), "bin", "ai-run");
  if (!existsSync(bin)) { log(`${tier}: ${bin} is not installed`); return null; }
  const role = tier === "codex" ? "worker" : "brain";
  const r = run(bin, ["--role", role, "--cwd", out, "--", prompt], {
    encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 32 << 20,
    env: { ...env, AI_RUN_CALLER: "ship-review", ...(tier === "codex" ? { AI_RUN_NO_CLAUDE_FALLBACK: "1" } : {}) },
  });
  const v = parseVerdict(`${r.stdout ?? ""}`, shots);
  if (v.error) { log(`${tier}: exit ${r.status} — ${v.error}`); return null; }
  return { ...v, model: tier === "codex" ? "codex seat" : "claude seat" };
}

/** Walk the routes. Returns the first trusted review, or null when every route was out or untrustworthy. */
export async function judge({ routes, base, shots, out, env = process.env, fetchImpl = fetch, log = () => {}, run = spawnSync }) {
  for (const tier of routes) {
    const onDisk = `on disk: ${shots.map((s) => `${s.label} = ${s.path}`).join("; ")}. Open every one (Claude: the Read tool; Codex: view_image). Do not create or edit any file`;
    const prompt = reviewPrompt({ ...base, shots, imageHow: tier === "free" ? "attached in that order" : onDisk });
    const v = tier === "free" ? await freeTier({ prompt, shots, env, fetchImpl, log }) : seatTier(tier, { prompt, shots, out, env, log, run });
    if (!v) continue;
    // A FREE PASS IS NOT FINAL (measured 20 Nov 2026: a free Gemini model passed a P&P reel with frozen
    // repeated frames and warped balloon lettering that it failed as stills). A free route may FAIL a
    // piece, since its findings are specific and checkable; only a seat may PASS it.
    if (v.verdict === "PASS" && tier === "free") { log(`free: ${v.model} passed it; a free PASS is confirmed by a seat before it counts`); continue; }
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
  const subject = a.subject ?? `${a.kind}:${a.target}`;
  const skill = env.SHIP_READY_SKILL ?? join(env.HOME || homedir(), ".claude", "skills", "ship-ready", "SKILL.md");
  if (!existsSync(skill)) throw stop(2, "NO_CHECKLIST", `${skill} is missing: the reviewer judges against the ship-ready skill and will not judge without it`);
  const brandFile = a.brand ? join(env.HOME || homedir(), ".claude", "skills", `design-${a.brand}`, "SKILL.md") : null;
  if (brandFile && !existsSync(brandFile)) throw stop(64, "NO_BRAND_NOTE", `${brandFile} does not exist; leave --brand off or name a brand that has a design skill`);

  const api = a.flags.has("no-store") ? null : await bossApi(env, fetchImpl);
  const before = api ? await api.get(`/quality/reviews?subject=${encodeURIComponent(subject)}`).catch((e) => { log(`could not read earlier verdicts (${e.message}); judged as a first review`); return null; }) : null;
  const firstOfKind = !before?.passed_before;
  const privateWork = isPrivate(a);
  const { routes } = reviewRoutes({ firstOfKind, privateWork });

  const { shots, facts } = await capture(a, out);
  if (!shots.length) { print("OUTPUT 0 reviews"); throw stop(9, "NOTHING_CAPTURED", `no capture of ${a.target} could be made, so nothing was judged`); }
  const lookedAt = lookedAtText({ kind: a.kind, target: a.target, shots });
  log(`ship-review ${id}: ${lookedAt}; ${firstOfKind ? "first review" : "re-review"}${privateWork ? ", private" : ""}; routes ${routes.join(" → ")}`);

  const base = {
    kind: a.kind, target: a.target, builder: a.builder, facts, launch: a.flags.has("launch"),
    checklist: readFileSync(skill, "utf8").replace(/^---[\s\S]*?---\s*/, ""),
    brand: brandFile ? readFileSync(brandFile, "utf8").replace(/^---[\s\S]*?---\s*/, "").slice(0, 8000) : null,
  };
  const v = await judge({ routes, base, shots, out, env, fetchImpl, log });
  if (!v) { print("OUTPUT 0 reviews"); throw stop(9, "NO_REVIEWER", `every route (${routes.join(", ")}) was out or gave no review it could trust; the next run tries again. Captures kept in ${out}`); }

  const reviewer = `boss-os ship-review ${id} (${v.model})`;
  const line = v.verdict === "PASS" ? passLine({ reviewer, lookedAt, launch: base.launch }) : `${base.launch ? "Launch" : "Ship"}-ready: FAIL — ${reviewer} looked at ${lookedAt}`;
  const record = { id, subject, kind: a.kind, verdict: v.verdict, findings: v.findings, looked_at: lookedAt, builder: a.builder, route: v.model, line, facts, at: new Date().toISOString() };
  writeFileSync(join(out, "verdict.json"), JSON.stringify(record, null, 2));
  print(line);
  for (const l of findingLines(v.findings)) print(l);
  print(`Captures and verdict: ${out}`);

  if (api) {
    try { await api.post("/quality/reviews", record); }
    catch (e) { print("OUTPUT 0 reviews"); throw stop(2, "NOT_RECORDED", `the verdict was not stored in Boss OS (${e.message}); it is in ${join(out, "verdict.json")}. Rerun once Boss OS answers`); }
  }
  if (a.pr && v.verdict === "PASS") { const err = addToPr(a.pr, line); if (err) log(`NAMED STOP [PR_NOT_UPDATED] ${err}; add the line above to the PR body by hand`); }
  print(api ? "OUTPUT 1 reviews" : "OUTPUT 0 reviews (--no-store: judged, not recorded)");
  return v.verdict === "PASS" ? 0 : 1;
}


if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
