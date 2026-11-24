#!/usr/bin/env node
/**
 * `npm run validate:noelle-pictures`: NOELLE MAKES NO PICTURE THAT THE BUDGET LEDGER DOES NOT COUNT.
 * Her 24 Nov 2026 ruling (spry brain): "Picture budget raised to $5 for the rest of 2026 ... It
 * covers every picture made here or by Noelle". The ledger is ~/.boss-os/image-budget-2026.json
 * ({cap_usd, through, spent_usd, log[]}); the one paid lane that uses it today is p-n-p
 * scripts/generators/build_service_ai_images.mjs (lock dir `<ledger>.lock`, refuse before the call
 * when spent + estimate > cap, charge the real cost, NAMED STOP on a missing, unreadable or expired
 * ledger).
 *
 * Noelle has NO picture path today: her sandbox reaches only the hosts in
 * scripts/ops/noelle-permissions.json, her env holds no vendor key, and no script she can reach
 * calls a picture API. This validator keeps it that way, and fails by name when:
 *   - NOELLE_PICTURE_UNLEDGERED: a script she can reach (every scripts/ path named by her launcher,
 *     her sandbox setup, her settings or her persona, then every relative import and scripts/ path
 *     inside those, transitively) calls a picture API, and neither it nor a file it imports takes
 *     the ledger (the ledger path, the `.lock` directory, and the IMAGE_BUDGET_CAP,
 *     IMAGE_BUDGET_LEDGER_MISSING and IMAGE_BUDGET_EXPIRED stops). A free picture still goes through
 *     it, charged $0;
 *   - NOELLE_PICTURE_HOST: her sandbox may reach a picture vendor's host, or every host;
 *   - NOELLE_PICTURE_KEY: her settings hand her a vendor key by name;
 * and stops, unsure, never passing (exit 2, NAMED STOP NOELLE_PICTURE_SCOPE), when it cannot find
 * her entry points or reaches fewer than MIN_FILES scripts (Rule 0: a scan that saw nothing passes
 * nothing).
 * `--self-test` feeds each break through the same checks and fails unless each is caught.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SEEDS = ["scripts/ops/noelle.sh", "scripts/ops/lib/noelle-sandbox.sh", "scripts/ops/noelle-permissions.json", "scripts/ops/noelle/persona.md"];
export const ENTRIES = ["scripts/ops/noelle.mjs", "scripts/ops/noelle-github.mjs", "scripts/ops/noelle-guard.mjs"];
export const MIN_FILES = 20;

// A call that makes a picture: vendor endpoints, SDK calls and model names (structure, not meaning).
export const PICTURE_CALL = new RegExp([
  String.raw`api\.openai\.com/v1/images`, String.raw`/v1/images/(generations|edits|variations)`, String.raw`\bimages\.(generate|edit|createVariation)\s*\(`,
  String.raw`gpt-image-`, String.raw`chatgpt-image`, String.raw`dall-?e-?[23]`,
  String.raw`imagen-[0-9]`, String.raw`gemini-[0-9.]+-[a-z-]*image`, String.raw`:generateImages\b`, String.raw`:predict\b.*imagen`,
  String.raw`api\.replicate\.com`, String.raw`\bfal\.(run|ai)\b`, String.raw`api\.stability\.ai`, String.raw`api\.ideogram\.ai`,
  String.raw`recraft\.ai`, String.raw`api\.bfl\.(ai|ml)`, String.raw`api\.together\.(xyz|ai)/v1/images`, String.raw`leonardo\.ai`,
  String.raw`api\.(dev\.)?runwayml\.com`, String.raw`@cf/(black-forest-labs|stabilityai|bytedance|lykon|runwayml|leonardo)/`,
].join("|"), "i");
const LEDGER_SHAPE = [/image-budget-2026\.json/, /\.lock\b/, /IMAGE_BUDGET_CAP/, /IMAGE_BUDGET_LEDGER_MISSING/, /IMAGE_BUDGET_EXPIRED/];
export const PICTURE_HOSTS = /(^|\.)(openai\.com|replicate\.com|fal\.run|fal\.ai|fal\.media|stability\.ai|ideogram\.ai|recraft\.ai|bfl\.ai|bfl\.ml|together\.xyz|together\.ai|leonardo\.ai|runwayml\.com|googleapis\.com|api\.cloudflare\.com)$/i;
const PICTURE_KEY = /OPENAI|REPLICATE|FAL_|STABILITY|IDEOGRAM|RECRAFT|BFL_|TOGETHER|LEONARDO|RUNWAY|GEMINI|GOOGLE_API|GOOGLE_GENAI|CLOUDFLARE_API|CF_API/i;

/** Every script she can reach, as {path: text}. `read` returns null for a file that is not there. */
export function reach(read, seeds = SEEDS) {
  const files = new Map();
  const queue = [...seeds];
  while (queue.length) {
    const f = normalize(queue.shift());
    if (files.has(f)) continue;
    const text = read(f);
    if (text == null) continue;
    files.set(f, text);
    for (const m of text.matchAll(/\bscripts\/[A-Za-z0-9_./-]+\.(?:mjs|js|cjs|sh|json|md)\b/g)) queue.push(m[0]);
    if (/\.(mjs|js|cjs)$/.test(f)) {
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        let p = normalize(join(dirname(f), m[1]));
        if (read(p) == null) for (const ext of [".mjs", ".js"]) if (read(p + ext) != null) { p += ext; break; }
        queue.push(p);
      }
    }
  }
  return files;
}

function importsOf(f, text) {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => normalize(join(dirname(f), m[1])));
}

/** Breaks found, each "NAME detail". */
export function judge(files, settings) {
  const out = [];
  const hasLedger = (t) => LEDGER_SHAPE.every((re) => re.test(t));
  for (const [f, text] of files) {
    if (/\.md$/.test(f)) continue; // her persona and docs are read for the paths they name, never run
    const line = text.split("\n").find((l) => PICTURE_CALL.test(l));
    if (!line) continue;
    const near = [text, ...importsOf(f, text).flatMap((p) => [files.get(p), files.get(p + ".mjs"), files.get(p + ".js")]).filter(Boolean)];
    if (!near.some(hasLedger)) out.push(`NOELLE_PICTURE_UNLEDGERED ${f} makes a picture without the budget ledger: ${line.trim().slice(0, 120)}`);
  }
  const hosts = settings?.sandbox?.network?.allowedDomains ?? [];
  for (const h of hosts) {
    const bare = String(h).replace(/^\*\./, "");
    if (bare === "*" || PICTURE_HOSTS.test(bare)) out.push(`NOELLE_PICTURE_HOST her sandbox may reach ${h}, a picture vendor's host`);
  }
  for (const k of Object.keys(settings?.env ?? {})) if (PICTURE_KEY.test(k)) out.push(`NOELLE_PICTURE_KEY her settings hand her ${k}`);
  return out;
}

/** Rule 0: the scan saw her. Returns a reason it did not, or null. */
export function scopeProblem(files, settings) {
  const missing = ENTRIES.filter((e) => !files.has(e));
  if (missing.length) return `her entry points were not reached: ${missing.join(", ")}`;
  if (files.size < MIN_FILES) return `only ${files.size} scripts reached (at least ${MIN_FILES} expected)`;
  if (!(settings?.sandbox?.network?.allowedDomains ?? []).length) return "her sandbox lists no hosts at all; her settings were not read";
  return null;
}

const diskRead = (f) => { const p = join(ROOT, f); try { return existsSync(p) ? readFileSync(p, "utf8") : null; } catch { return null; } };

function realRun() {
  const files = reach(diskRead);
  let settings = null;
  try { settings = JSON.parse(diskRead("scripts/ops/noelle-permissions.json") ?? "null"); } catch { /* scopeProblem says so */ }
  const why = scopeProblem(files, settings);
  if (why) { console.error(`NAMED STOP [NOELLE_PICTURE_SCOPE] ${why}`); console.log("OUTPUT 0"); return 2; }
  const breaks = judge(files, settings);
  for (const b of breaks) console.error(b);
  if (breaks.length) { console.log(`OUTPUT noelle-pictures ${breaks.length} break(s)`); return 1; }
  console.log(`OUTPUT noelle-pictures 0 picture paths without the ledger in ${files.size} scripts she can reach; ${settings.sandbox.network.allowedDomains.length} hosts, none a picture vendor`);
  return 0;
}

function selfTest() {
  const real = reach(diskRead);
  const settings = JSON.parse(diskRead("scripts/ops/noelle-permissions.json"));
  const clone = () => JSON.parse(JSON.stringify(settings));
  const LEDGERED = `const L = join(home, ".boss-os", "image-budget-2026.json"); mkdirSync(\`\${L}.lock\`);\nthrow new Stop("IMAGE_BUDGET_CAP"); new Stop("IMAGE_BUDGET_LEDGER_MISSING"); new Stop("IMAGE_BUDGET_EXPIRED");\n`;
  const withFile = (f, text, also = {}) => { const m = new Map(real); m.set(f, text); for (const [k, v] of Object.entries(also)) m.set(k, v); return m; };
  const bad = [
    ["an OpenAI picture call in her ledger verb", withFile("scripts/ops/noelle.mjs", real.get("scripts/ops/noelle.mjs") + `\nawait fetch("https://api.openai.com/v1/images/generations", {});\n`), settings],
    ["an SDK picture call", withFile("scripts/ops/lib/x.mjs", `await client.images.generate({ model: "gpt-image-1-mini" });\n`), settings],
    ["a Gemini picture model", withFile("scripts/ops/lib/x.mjs", `const model = "gemini-2.5-flash-image";\n`), settings],
    ["a Workers AI picture model", withFile("scripts/ops/lib/x.mjs", `env.AI.run("@cf/black-forest-labs/flux-1-schnell", {});\n`), settings],
    ["a Replicate call", withFile("scripts/ops/lib/x.mjs", `fetch("https://api.replicate.com/v1/predictions")\n`), settings],
    ["the ledger half-built (no expiry stop)", withFile("scripts/ops/lib/x.mjs", `fetch("https://api.openai.com/v1/images/edits");\n` + LEDGERED.replace(`new Stop("IMAGE_BUDGET_EXPIRED");`, "")), settings],
    ["a picture vendor host in her sandbox", real, Object.assign(clone(), {}), (s) => s.sandbox.network.allowedDomains.push("api.openai.com")],
    ["Google's API host in her sandbox", real, clone(), (s) => s.sandbox.network.allowedDomains.push("generativelanguage.googleapis.com")],
    ["every host in her sandbox", real, clone(), (s) => { s.sandbox.network.allowedDomains = ["*"]; }],
    ["a vendor key in her env", real, clone(), (s) => { s.env.OPENAI_API_KEY = "x"; }],
  ];
  const good = [
    ["the real scripts", real, settings],
    ["a picture call that takes the ledger itself", withFile("scripts/ops/lib/x.mjs", `fetch("https://api.openai.com/v1/images/generations");\n` + LEDGERED), settings],
    ["a picture call whose import takes the ledger", withFile("scripts/ops/lib/x.mjs", `import { charge } from "./budget.mjs";\nfetch("https://api.openai.com/v1/images/generations");\n`, { "scripts/ops/lib/budget.mjs": LEDGERED }), settings],
    ["a page's robots meta (no picture made)", withFile("scripts/ops/lib/x.mjs", `const meta = "max-image-preview:large";\n`), settings],
  ];
  let failed = 0, caught = 0;
  for (const [name, files, s, mutate] of bad) {
    const st = mutate ? (mutate(s), s) : s;
    if (judge(files, st).length) caught++; else { failed++; console.error(`self-test: NOT caught: ${name}`); }
  }
  for (const [name, files, s] of good) {
    const b = judge(files, s);
    if (b.length) { failed++; console.error(`self-test: wrongly failed: ${name}: ${b[0]}`); }
  }
  // Rule 0: a scan that reached nothing, or missed an entry point, or read no settings, stops.
  const scope = [
    ["nothing reached", new Map(), settings],
    ["her GitHub broker not reached", new Map([...real].filter(([f]) => f !== "scripts/ops/noelle-github.mjs")), settings],
    ["her settings unread", real, null],
  ];
  for (const [name, files, s] of scope) if (scopeProblem(files, s)) caught++; else { failed++; console.error(`self-test: scope gap NOT caught: ${name}`); }
  if (scopeProblem(real, settings)) { failed++; console.error(`self-test: the real scan is out of scope: ${scopeProblem(real, settings)}`); }
  // The reach follows a scripts/ path named only inside a reached script (a spawned helper), and relative imports.
  const fake = { "scripts/ops/noelle.sh": `node scripts/ops/a.mjs\n`, "scripts/ops/a.mjs": `import "./lib/b.mjs";\nspawn("node", ["scripts/ops/c.mjs"]);\n`, "scripts/ops/lib/b.mjs": "", "scripts/ops/c.mjs": "" };
  const r = reach((f) => fake[f] ?? null, ["scripts/ops/noelle.sh"]);
  if (["scripts/ops/a.mjs", "scripts/ops/lib/b.mjs", "scripts/ops/c.mjs"].every((f) => r.has(f))) caught++; else { failed++; console.error(`self-test: reach missed a file: saw ${[...r.keys()].join(", ")}`); }
  const total = bad.length + scope.length + 1;
  if (failed) { console.error(`noelle-pictures self-test: ${failed} failure(s)`); return 1; }
  console.log(`noelle-pictures self-test: ${caught} of ${total} breaks caught, ${good.length} clean cases pass`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(process.argv.includes("--self-test") ? selfTest() : realRun());
