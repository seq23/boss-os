#!/usr/bin/env node
/**
 * KINDLE BOOKS PER LINE, INTO THE SPRY BRAIN'S NUMBERS (owner, 7 Nov 2026, spry brain).
 *
 * Simone's monthly KDP run (kdp-surface.sh, the 1st) records how many books each line has —
 * ApprovalPrep, Dream Wedding, A Player Mode, KeepMyProof — as one Numbers row per line
 * ("Kindle books: <line>", value "N (M live)"), through `setNumber`, so the definition and source
 * of an existing row are kept. The count is read from `kdp-register.json`, the one list of her
 * titles (`titles[].line`, `lines`). A register that cannot be read writes "not read: <reason>" in
 * every row, never 0; a line the register lists with no title is a true 0.
 *
 *   npm run vault:run -- node scripts/ops/kdp-line-counts.mjs [--dry-run]
 *
 * Exit 0 written (or dry run), 2 NAMED STOP (brain unread / not recorded), 3 no passcode.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setNumber } from "../../src/shared/boss/brains/brain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTER = process.env.BOSS_OS_KDP_REGISTER ?? join(ROOT, "scripts/ops/kdp-register.json");
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const SLUG = "spry";
const DEFINITION = "Kindle books in this line (live ones in brackets)";
const SOURCE = "kdp-register.json, counted by kdp-line-counts.mjs on the monthly KDP run";

/** The four lines when the register itself cannot be read, so each row still says "not read". */
export const DEFAULT_LINES = Object.freeze({ approvalprep: "ApprovalPrep", wedding: "Dream Wedding", "a-player-mode": "A Player Mode", keepmyproof: "KeepMyProof" });
export const metricFor = (label) => `Kindle books: ${label}`;

/** `{ "Kindle books: <label>": "N (M live)" | "not read: <reason>" }`. Pure. */
export function lineCounts(register, problem = null) {
  const lines = register?.lines && typeof register.lines === "object"
    ? Object.fromEntries(Object.entries(register.lines).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v?.label ?? k]))
    : null;
  const why = problem ?? (!lines || !Object.keys(lines).length ? "the register lists no Kindle lines" : !Array.isArray(register?.titles) ? "the register has no titles list" : null);
  if (why) return Object.fromEntries(Object.values(lines ?? DEFAULT_LINES).map((l) => [metricFor(l), `not read: ${why}`]));
  const out = {};
  for (const [key, label] of Object.entries(lines)) {
    const mine = register.titles.filter((t) => t?.line === key);
    out[metricFor(label)] = `${mine.length} (${mine.filter((t) => t?.status === "LIVE").length} live)`;
  }
  const stray = register.titles.filter((t) => !t?.line || !(t.line in lines)).map((t) => t?.title ?? t?.title_ref);
  if (stray.length) for (const m of Object.keys(out)) out[m] = `not read: ${stray.length} title(s) name no listed line (${stray.slice(0, 2).join(", ")})`;
  return out;
}

/**
 * What the publish run saw on the bookshelf, over the committed register (hostile review, 8 Nov 2026:
 * "The Co-Parenting Log" was Live from 7 Nov and the register still said DRAFT_LOCAL, so the brain
 * read "KeepMyProof 0 live"). A title with a `kmp_folder` whose `<drafts>/<folder>/publish.json`
 * (written by kdp-new-title.mjs from the bookshelf) reads LIVE counts as live. Pure but for `read`.
 */
export function withPublished(register, { drafts = KMP_DRAFTS, read = (f) => readFileSync(f, "utf8") } = {}) {
  if (!register || !Array.isArray(register.titles)) return register;
  return { ...register, titles: register.titles.map((t) => {
    if (!t?.kmp_folder || t.status === "LIVE") return t;
    try { const p = JSON.parse(read(join(drafts, t.kmp_folder, "publish.json"))); return p?.resulting_state === "LIVE" ? { ...t, status: "LIVE" } : t; } catch { return t; }
  }) };
}
const KMP_DRAFTS = process.env.KMP_KDP_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/keepmyproof");

export function readRegister(path = REGISTER) {
  try { return { register: JSON.parse(readFileSync(path, "utf8")), problem: null }; }
  catch (e) { return { register: null, problem: `could not read the KDP register (${String(e?.code ?? e?.message ?? e).slice(0, 80)})` }; }
}

const centralDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(now));

export async function run({ dryRun = false, env = process.env, now = Date.now(), fetchImpl = fetch, path = REGISTER } = {}) {
  const { register, problem } = readRegister(path);
  const values = lineCounts(withPublished(register), problem);
  if (dryRun) return { values, written: false };
  if (!env.BOSS_PASSCODE) throw Object.assign(new Error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not set; run through the vault."), { code: 3 });
  const u = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: env.BOSS_PASSCODE }) });
  if (!u.ok) throw Object.assign(new Error(`NAMED STOP [UNLOCK_REFUSED] Boss OS refused the passcode (${u.status}).`), { code: 3 });
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const g = await fetchImpl(`${ORIGIN}/api/boss/brains/${SLUG}`, { headers: { cookie } });
  if (!g.ok) throw Object.assign(new Error(`NAMED STOP [BRAIN_UNREAD] could not read the ${SLUG} brain (${g.status}).`), { code: 2 });
  let md = (await g.json()).data.body_md;
  const day = centralDay(now);
  for (const [metric, value] of Object.entries(values)) md = setNumber(md, metric, value, day, { definition: DEFINITION, source: SOURCE });
  const numbers = /^## Numbers[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1]?.trim() ?? "";
  const p = await fetchImpl(`${ORIGIN}/api/boss/brains/${SLUG}`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ section: "Numbers", text: numbers, note: "Monthly Kindle book counts (kdp-line-counts.mjs)" }),
  });
  if (!p.ok) throw Object.assign(new Error(`NAMED STOP [NOT_RECORDED] Boss OS did not keep the Numbers (${p.status}).`), { code: 2 });
  return { values, written: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  run({ dryRun })
    .then(({ values, written }) => {
      for (const [m, v] of Object.entries(values)) console.log(`${m}: ${v}`);
      const unread = Object.values(values).filter((v) => v.startsWith("not read")).length;
      console.log(`OUTPUT: KDP-LINE-COUNTS lines=${Object.keys(values).length} not_read=${unread} ${written ? `written to the ${SLUG} brain` : "dry run, not written"}`);
    })
    .catch((e) => { console.error(String(e?.message ?? e)); process.exit(e?.code ?? 2); });
}
