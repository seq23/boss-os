/**
 * THE MORNING EMAIL'S SECTIONS — THE ONE INTERFACE EVERY PRODUCER WRITES (owner, 23 Oct 2026, rule 1).
 *
 * "ONE morning email from Simone (06:40)": Decide → New deals since yesterday + "Monique found" →
 * Camille's briefing → Done for you → Porch & Party: To do for Valerie → sign-off → the 8Raise line.
 * The standalone emails it replaced (Zora's archive audit, Toni's routine risk, the tail reports,
 * Monique's "crosses" and "people worth a look") now write a section file here instead of sending.
 *
 * A SECTION FILE is `~/.boss-os/morning/<section>.json` (BOSS_OS_MORNING_DIR overrides), written by
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
import { join } from "node:path";

/** Producers: D writes deals + monique_found; L writes lp, prospects, catchups, eightraise; E the rest. */
export const MORNING_SECTIONS = Object.freeze([
  "deals", "monique_found", "lp", "prospects", "catchups", "eightraise",
  "risk", "archive", "tail", "bounces", "notices",
]);
export const STALE_MS = 30 * 3_600_000;

export function morningDir() {
  return process.env.BOSS_OS_MORNING_DIR ?? join(homedir(), ".boss-os", "morning");
}

const isButton = (b) => b && typeof b.label === "string" && typeof b.url === "string" && /^(?:https?:\/\/|mailto:)\S+$/.test(b.url);

/** What is wrong with a section object, by name. `[]` means it is shown. Pure. */
export function morningSectionProblems(obj) {
  const p = [];
  if (!obj || typeof obj !== "object") return ["not an object"];
  if (!MORNING_SECTIONS.includes(obj.section)) p.push(`unknown section "${obj.section}"`);
  if (!obj.at || Number.isNaN(Date.parse(obj.at))) p.push("no valid \"at\"");
  for (const [i, d] of (obj.decide ?? []).entries()) {
    if (!d || typeof d.title !== "string" || !d.title.trim()) p.push(`decide[${i}] has no title`);
    if (!Array.isArray(d?.buttons) || !d.buttons.length) p.push(`decide[${i}] has no one-tap button`);
    else if (!d.buttons.every(isButton)) p.push(`decide[${i}] has a button without a real link`);
  }
  for (const [i, r] of (obj.rows ?? []).entries()) if (!r || typeof r.company !== "string") p.push(`rows[${i}] has no company`);
  for (const [i, l] of (obj.lines ?? []).entries()) if (!(typeof l === "string" || (l && typeof l.text === "string"))) p.push(`lines[${i}] is not a line`);
  if (obj.link && !isButton(obj.link)) p.push("link is not { label, url }");
  return p;
}

/** Write a whole section (atomically: a half-written file is never read). */
export function writeMorningSection(section, data, { dir = morningDir(), now = Date.now() } = {}) {
  const obj = { section, at: new Date(now).toISOString(), decide: [], rows: [], lines: [], ...data };
  const problems = morningSectionProblems(obj);
  if (problems.length) throw new Error(`morning section "${section}" refused: ${problems.join("; ")}`);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${section}.json.tmp`);
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, join(dir, `${section}.json`));
  return obj;
}

/** Append lines (and decide items) to today's copy of a section; a copy from an older day starts fresh. */
export function addMorningLines(section, { lines = [], decide = [] } = {}, { dir = morningDir(), now = Date.now() } = {}) {
  const file = join(dir, `${section}.json`);
  let prev = null;
  try { prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { prev = null; }
  const fresh = prev && now - Date.parse(prev.at) < 20 * 3_600_000;
  const base = fresh ? prev : { decide: [], rows: [], lines: [] };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mergedLines = [...(base.lines ?? [])];
  for (const l of lines) if (!mergedLines.some((x) => same(x, l))) mergedLines.push(l);
  const mergedDecide = [...(base.decide ?? [])];
  for (const d of decide) if (!mergedDecide.some((x) => x.title === d.title)) mergedDecide.push(d);
  return writeMorningSection(section, { ...base, lines: mergedLines, decide: mergedDecide }, { dir, now });
}

/** Every present, fresh, valid section: `{ sections: { name: obj }, skipped: ["name: why"] }`. */
export function readMorningSections({ dir = morningDir(), now = Date.now() } = {}) {
  const sections = {};
  const skipped = [];
  if (!existsSync(dir)) return { sections, skipped };
  for (const f of readdirSync(dir).filter((x) => /^[a-z_]+\.json$/.test(x))) {
    const name = f.replace(/\.json$/, "");
    let obj;
    try { obj = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { skipped.push(`${name}: does not parse`); continue; }
    const problems = morningSectionProblems(obj);
    if (problems.length) { skipped.push(`${name}: ${problems.join("; ")}`); continue; }
    if (now - Date.parse(obj.at) > STALE_MS) { skipped.push(`${name}: stale (written ${obj.at})`); continue; }
    sections[obj.section] = obj;
  }
  return { sections, skipped };
}

/** After the morning email went: the one-off sections (lines and decisions already told) are cleared. */
export function clearToldSections(names, { dir = morningDir() } = {}) {
  for (const n of names) {
    const file = join(dir, `${n}.json`);
    if (existsSync(file)) renameSync(file, join(dir, `.${n}.told.json`));
  }
}
