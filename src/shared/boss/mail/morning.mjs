/**
 * THE MORNING EMAIL'S SECTIONS — THE ONE INTERFACE EVERY PRODUCER WRITES (owner, 23 Oct 2026, rule 1).
 *
 * "ONE morning email from Simone (06:40)": Decide → New deals since yesterday + "Monique found" →
 * Camille's briefing → Done for you → Porch & Party: To do for Valerie → sign-off → the 8Raise line.
 * The standalone emails it replaced (Zora's archive audit, Toni's routine risk, the tail reports,
 * Monique's "crosses" and "people worth a look") now write a section file here instead of sending.
 *
 * A SECTION FILE is `~/.boss-os/morning/<section>.json` (every function takes `{ dir }` to override), written by
 * `writeMorningSection` (whole section) or `addMorningLines` (append a line, for producers that run
 * many times a day). Its shape:
 *
 *   {
 *     "section": "deals",                 one of MORNING_SECTIONS
 *     "at": "2026-10-23T11:20:00.000Z",   when it was written (stale after STALE_MS: not shown)
 *     "decide": [{ "title", "body", "buttons": [{ "label", "url" }], "priority"? }],
 *     "rows":   [{ "company", "side", "size", "price", "from", "when", "url" }],   (deals only)
 *     "lines":  ["one plain sentence", { "text", "links": [{ "label", "url" }] }],
 *     "link":   { "label", "url" },       e.g. "See the full grid"
 *     "credits": { "used", "budget", "kept" }   (eightraise only)
 *   }
 *
 * WHERE EACH PART LANDS (scripts/ops/your-day.mjs `buildDay`):
 *   decide  → Decide (every section's items pooled, highest `priority` first, three shown). The
 *             "catchups" section's decide items show under "Catch up with" instead (rule 14).
 *   rows    → "New deals since yesterday" (deals); link → the button under it.
 *   lines   → "Monique found" (monique_found), "Catch up with" (catchups), else "Done for you" (three
 *             shown, pooled across sections).
 *   credits → the 8Raise line under the sign-off.
 * Missing or stale files are skipped; a file that does not parse or fails `morningSectionProblems` is
 * skipped AND named in the run's log, never shown half-read.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export { MORNING_SECTIONS, STALE_MS, morningSectionProblems, appendToSection, newerSections } from "./morningSections.mjs";
import { STALE_MS, morningSectionProblems, appendToSection, newerSections } from "./morningSections.mjs";

export function morningDir() {
  return join(homedir(), ".boss-os", "morning");
}

/**
 * THE BOSS OS STORE (1 Nov 2026, the Mac→cloud move). Every section a writer keeps is ALSO posted to
 * Boss OS (`POST /api/boss/morning/sections`, D1 `morning_sections`), so a writer on a cloud runner
 * and one on her Mac feed the same morning email; your-day reads the store and falls back to the Mac
 * files during the cutover (`newerSections`). The writers stay synchronous for their callers: the
 * post runs in a short child process (scripts/ops/lib/morning-push.mjs).
 *
 * Posted only for the real morning dir (a test's own `dir` never posts) and only with the passcode
 * present (the child decides; it skips quietly without one on the Mac). On a cloud runner a post that fails THROWS — the runner has no Mac file to fall back to, so a
 * section that reached nowhere must fail the run by name (rule 0). On the Mac the file stands and
 * the miss is said in the log.
 */
const PUSH = fileURLToPath(new URL("../../../../scripts/ops/lib/morning-push.mjs", import.meta.url));
/** The job named in the store: the script that wrote (the child adds the runner's job name if any). */
const scriptName = () => basename(process.argv[1] ?? "unknown").replace(/\.m?js$/, "");
const storeOn = (dir) => dir === morningDir();
function pushToStore(body) {
  try {
    execFileSync(process.execPath, [PUSH], { input: JSON.stringify({ ...body, script: scriptName() }), stdio: ["pipe", "ignore", "pipe"], timeout: 45_000 });
  } catch (e) {
    const why = String(e?.stderr ?? e?.message ?? e).trim().split("\n").pop()?.slice(0, 200);
    // Exit 3 = a cloud run: there is no Mac file to fall back to, so the run fails by name.
    if (e?.status === 3) throw new Error(`NAMED STOP [MORNING_STORE_UNREACHED] section "${body.section}" was not kept in Boss OS: ${why}`);
    console.error(`morning store: section "${body.section}" not kept in Boss OS (${why}); the Mac file stands`);
  }
}

/** Write a whole section (atomically: a half-written file is never read), and keep it in Boss OS. */
export function writeMorningSection(section, data, { dir = morningDir(), now = Date.now() } = {}) {
  const obj = { section, at: new Date(now).toISOString(), decide: [], rows: [], lines: [], ...data };
  const problems = morningSectionProblems(obj);
  if (problems.length) throw new Error(`morning section "${section}" refused: ${problems.join("; ")}`);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${section}.json.tmp`);
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, join(dir, `${section}.json`));
  if (storeOn(dir)) pushToStore({ mode: "replace", section, body: obj });
  return obj;
}

/**
 * Append lines (and decide items) to today's copy of a section; a copy from an older day starts fresh.
 * The store appends server-side, so a cloud writer (which never sees the Mac file) and a Mac writer
 * add to the same section.
 */
export function addMorningLines(section, { lines = [], decide = [] } = {}, { dir = morningDir(), now = Date.now() } = {}) {
  const file = join(dir, `${section}.json`);
  let prev = null;
  try { prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { prev = null; }
  const obj = appendToSection(prev, section, { lines, decide }, now);
  const problems = morningSectionProblems(obj);
  if (problems.length) throw new Error(`morning section "${section}" refused: ${problems.join("; ")}`);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${section}.json.tmp`);
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file);
  if (storeOn(dir)) pushToStore({ mode: "append", section, body: { lines, decide } });
  return obj;
}

/** Fresh, valid sections out of a list of objects: `{ sections, skipped }`. Pure. */
export function freshSections(objs, now = Date.now(), from = "file") {
  const sections = {};
  const skipped = [];
  for (const { name: n, obj, error } of objs) {
    const name = from === "file" ? n : `${n} (${from})`;
    if (error) { skipped.push(`${name}: ${error}`); continue; }
    const problems = morningSectionProblems(obj);
    if (problems.length) { skipped.push(`${name}: ${problems.join("; ")}`); continue; }
    if (now - Date.parse(obj.at) > STALE_MS) { skipped.push(`${name}: stale (written ${obj.at})`); continue; }
    sections[obj.section] = obj;
  }
  return { sections, skipped };
}

/**
 * Every present, fresh, valid section: `{ sections: { name: obj }, skipped: ["name: why"] }`.
 * `store` is the Boss OS copy (`GET /morning/sections` rows, read by the caller); per section the
 * newer of store and Mac file wins whole (`newerSections`). No store given = the Mac files alone.
 */
export function readMorningSections({ dir = morningDir(), now = Date.now(), store = null } = {}) {
  const objs = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => /^[a-z_]+\.json$/.test(x))) {
      const name = f.replace(/\.json$/, "");
      try { objs.push({ name, obj: JSON.parse(readFileSync(join(dir, f), "utf8")) }); } catch { objs.push({ name, error: "does not parse" }); }
    }
  }
  const files = freshSections(objs, now, "file");
  if (!store) return files;
  const kept = freshSections((store ?? []).map((r) => ({ name: r.section, obj: r.body })), now, "store");
  return { sections: newerSections(files.sections, kept.sections), skipped: [...files.skipped, ...kept.skipped] };
}

/** After the morning email went: the one-off sections (lines and decisions already told) are cleared. */
export function clearToldSections(names, { dir = morningDir() } = {}) {
  for (const n of names) {
    const file = join(dir, `${n}.json`);
    if (existsSync(file)) renameSync(file, join(dir, `.${n}.told.json`));
  }
}
