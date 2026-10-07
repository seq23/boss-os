#!/usr/bin/env node
/**
 * SEEING IT PRODUCES SOMETHING — the Kindle surface duty cannot see a problem and produce nothing.
 *
 * 12–21 Sep 2026: Simone's daily scan saw Amazon's title flag on The Gift Letter three times. No
 * email went (the prompt told a vault-less model to send), the assignment to Zora was a sentence
 * with no work_assignments row, and four "quiet" runs never re-raised an open problem inside
 * Amazon's five-day window. The scan happened daily; what failed is that seeing it produced nothing.
 *
 * What this pins, reading the real files:
 *   1. ONE POSTER. The prompt never tells the model to run the report script, `npm run notify`, or
 *      print `KDP-SURFACE-COMPLETE`; the wrapper posts through the vault exactly once and refuses
 *      to post without the file; the sentinel is derived by the report script (`sentinelFor`).
 *   2. THE REGISTER IS READ FIRST AND IS COMPLETE. Seven titles, each with target LIVE and a
 *      title_ref that matches kdp-cover-map.json; the prompt names the register before Gmail.
 *   3. AN ASSIGNMENT IS A ROW. The endpoint refuses `assigned` without an `assign` block and inserts
 *      into work_assignments inside /mail; the report script refuses the same offline.
 *   4. A PROBLEM STAYS LOUD. The endpoint stores due_at / delivered_message_id / nagged_at /
 *      resolved_at; the report script chases (`dueForChase`) and records the Resend id; the wrapper
 *      hands the open list to the run before it reads mail.
 *   5. HER REPLY LANDS. `[kml_…]` is routed in the intake to `answerKdpFromMail`.
 *
 * RULE 0: zero titles in the register, or zero rules checked, hard-fails.
 *
 *   node scripts/validate/kdp-seeing-it-produces-something.mjs
 *   node scripts/validate/kdp-seeing-it-produces-something.mjs --self-test
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const F = {
  prompt: "scripts/ops/kdp-surface-prompt.md",
  wrapper: "scripts/ops/kdp-surface.sh",
  report: "scripts/ops/kdp-surface-report.mjs",
  register: "scripts/ops/kdp-register.json",
  coverMap: "scripts/ops/kdp-cover-map.json",
  route: "src/worker/boss/routes/kdp.ts",
  intake: "src/worker/boss/intake/inboundMail.ts",
  retitle: "scripts/ops/kdp-retitle.mjs",
  lane: "src/shared/boss/repoChange/lane.mjs",
  migrations: "migrations",
};

export function check(files) {
  const p = [];
  const { prompt, wrapper, report, route, intake } = files;
  let register; let coverMap;
  try { register = JSON.parse(files.register); coverMap = JSON.parse(files.coverMap); }
  catch { return ["the register or the cover map is not readable JSON."]; }

  // 1. One poster.
  if (/run `?scripts\/ops\/kdp-surface-report\.mjs`?,? which posts/i.test(prompt) || /Then run .*kdp-surface-report/i.test(prompt)) p.push("the prompt tells the model to run the report script — two posters, and the model has no vault.");
  if (/Use\s+`npm run notify/i.test(prompt) || /npm run notify -- --from Simone/i.test(prompt)) p.push("the prompt tells the model to send email — it cannot, and a needs_owner that goes nowhere is the 12 Sep defect.");
  if (/must be exactly one of:[\s\S]*KDP-SURFACE-COMPLETE: quiet/i.test(prompt)) p.push("the prompt asks the model for the sentinel; the sentinel is derived from the file by the report script.");
  if (!/KDP-SURFACE-FILE-WRITTEN/.test(prompt)) p.push("the prompt has no end marker (KDP-SURFACE-FILE-WRITTEN).");
  const posts = (wrapper.match(/kdp-surface-report\.mjs/g) ?? []).length;
  if (posts !== 1) p.push(`the wrapper invokes the report script ${posts} time(s); exactly one poster.`);
  if (!/if \[ ! -f "\$HOME\/\.boss-os\/kdp\/surface\.json" \]/.test(wrapper)) p.push("the wrapper does not assert surface.json exists before posting.");
  if (/grep -q "KDP-SURFACE-COMPLETE:" "\$RUN_LOG"[\s\S]*?exit 9/.test(wrapper) && !/TRIAGE_DID_NOT_COMPLETE\] no surface\.json/.test(wrapper)) p.push("the wrapper still gates on the model's sentinel instead of the file.");
  if (!/export function sentinelFor/.test(report)) p.push("the report script does not derive the sentinel from the file (sentinelFor).");
  if (!/KDP-SURFACE-COMPLETE: \$\{sentinel\}/.test(report)) p.push("the report script does not print the derived sentinel.");

  // 2. The register.
  const titles = Array.isArray(register.titles) ? register.titles : [];
  if (titles.length === 0) { p.push("RULE 0: the register lists no titles."); return p; }
  const mapRefs = new Set((coverMap.titles ?? []).map((t) => t.title_ref));
  if (mapRefs.size === 0) p.push("RULE 0: the cover map lists no titles to compare against.");
  for (const t of titles) {
    if (t.target !== "LIVE") p.push(`register: "${t.title}" has target ${t.target}; her goal is every book published and working.`);
    if (!mapRefs.has(t.title_ref)) p.push(`register: "${t.title}" (${t.title_ref}) is not a title_ref the cover map knows.`);
  }
  for (const r of mapRefs) if (!titles.some((t) => t.title_ref === r)) p.push(`register: cover-map title ${r} is missing from the register.`);
  if (!register.settled?.covers?.do_not_re_raise || !register.settled?.case_51496198?.do_not_re_raise) p.push("register: the covers and case #51496198 must be settled with do_not_re_raise.");
  if (/draft by (her )?choice/i.test(files.register)) p.push("register: 'draft by choice' — the memory she corrected on 21 Sep.");
  const gmailAt = prompt.search(/Load the Gmail tools/i); const regAt = prompt.search(/kdp-register\.json/);
  if (regAt < 0 || gmailAt < 0 || regAt > gmailAt) p.push("the prompt does not read the register before it reads Gmail.");
  if (!/open\.json/.test(prompt)) p.push("the prompt does not read the open problems (open.json).");
  if (!/kdp-open\.mjs/.test(wrapper)) p.push("the wrapper does not hand the run the open problems before it reads mail.");

  // 3. An assignment is a row.
  if (!/outcome === "assigned" && !assign/.test(route)) p.push("the endpoint accepts 'assigned' without an assign block.");
  if (!/INSERT INTO work_assignments[\s\S]{0,600}kdp_mail_log/.test(route) && !/kdp\.post\("\/mail"[\s\S]*INSERT INTO work_assignments/.test(route)) p.push("the /mail endpoint does not create the work_assignments row in the same request.");
  if (!/ASSIGNMENT_IS_A_SENTENCE/.test(report)) p.push("the report script does not refuse 'assigned' without an assign block.");

  // 4. A problem stays loud.
  for (const col of ["due_at", "delivered_message_id", "nagged_at", "resolved_at", "owner_answer"]) {
    if (!files.migrationText.includes(`ADD COLUMN ${col}`)) p.push(`no migration adds kdp_mail_log.${col}.`);
  }
  if (!/export function dueForChase/.test(report)) p.push("the report script has no chase (dueForChase).");
  if (!/\/delivered`, cookie, \{ kind: "ask"/.test(report)) p.push("the report script does not record the needs_owner email's id on the row.");
  if (!/OWNER_NOT_WOKEN/.test(report)) p.push("a needs_owner row whose email did not go is not a named stop.");
  if (!/kdp\.get\("\/mail\/open"/.test(route)) p.push("no open-problems endpoint.");
  if (!/REGISTER_CONTRADICTED/.test(report)) p.push("the report script does not refuse a file that contradicts the register's target.");
  // One email per tick per problem (first hands-off run, 21 Sep 2026: ask 22:32:09, chase 22:32:10).
  if (!/Math\.max\(Number\(p\.nagged_at \?\? 0\), Number\(p\.seen_at \?\? 0\)\)/.test(report)) p.push("the chase does not count the ask itself (seen_at) as the last contact — a fresh row is chased in the same tick as its ask.");
  if (!/export function withoutDuplicates/.test(report) || !/withoutDuplicates\(payload\.items, openBefore\)/.test(report)) p.push("a problem already open on the same title and matter is filed (and emailed) again every day.");
  // Simone signs in herself (her ruling, 21 Sep 2026); one message, one meaning.
  if (!/kdp-signin\.mjs/.test(wrapper)) p.push("the wrapper does not run Simone's own sign-in (kdp-signin.mjs) before the triage.");
  if (!/export function messageShape/.test(report) || !/MIXED_MESSAGE/.test(report)) p.push("the report script does not split ask from stop (messageShape) or refuse a mixed message.");
  if (!/No reply is needed/.test(report) || !/Reply with one word — approved/.test(report)) p.push("the two email shapes are not both present.");
  if (/npm run browser:signin -- --profile simone/.test(prompt) && !/signin\.json/.test(prompt)) p.push("the prompt still tells the model to ask her to sign in.");
  if (!/signin\.json/.test(prompt)) p.push("the prompt does not read signin.json.");
  if (!/blocked_titles_are_not_editable/.test(files.register)) p.push("the register does not carry the fact that a BLOCKED title cannot be edited.");
  if (!/blocked_not_editable/.test(files.retitle)) p.push("the retitle tool does not name the blocked-not-editable case.");
  if (!/export function herWords/.test(files.lane) || !/const raw = herWords\(text\)/.test(files.lane)) p.push("readReply does not judge her own words (quoted mail and signature stripped) — 'approved.' with a quoted thread was read as her own wording on 21 Sep.");

  // 5. Her reply lands.
  if (!/answerKdpFromMail/.test(intake)) p.push("the intake does not route a [kml_…] reply to answerKdpFromMail.");
  return p;
}

function load() {
  const { readdirSync } = require_fs();
  const migrationText = readdirSync(join(ROOT, F.migrations)).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(ROOT, F.migrations, f), "utf8")).join("\n");
  const out = { migrationText };
  for (const [k, v] of Object.entries(F)) if (k !== "migrations") out[k] = readFileSync(join(ROOT, v), "utf8");
  return out;
}
function require_fs() { return { readdirSync: readdirSyncNode }; }
import { readdirSync as readdirSyncNode } from "node:fs";

function selfTest() {
  const good = load();
  const cases = [
    ["the shipped shape passes", good, 0],
    ["the prompt telling the model to post", { ...good, prompt: good.prompt + "\nThen run `scripts/ops/kdp-surface-report.mjs`, which posts the file." }, 1],
    ["the prompt telling the model to email", { ...good, prompt: good.prompt + "\nUse `npm run notify -- --from Simone --subject x --body y`." }, 1],
    ["a second poster in the wrapper", { ...good, wrapper: good.wrapper + "\nnode scripts/ops/kdp-surface-report.mjs\n" }, 1],
        ["a title whose target is not LIVE", { ...good, register: good.register.replace(/"target": "LIVE",(\s*)"status": "IN_REVIEW"/, '"target": "DRAFT",$1"status": "IN_REVIEW"') }, 1],
    ["'draft by choice' back in the register", { ...good, register: good.register.replace('"owner_goal"', '"note": "Gift Letter is Draft by her choice", "owner_goal"') }, 1],
    ["the endpoint accepting assigned without a block", { ...good, route: good.route.replace('outcome === "assigned" && !assign', "false") }, 1],
    ["the chase removed", { ...good, report: good.report.replace("export function dueForChase", "function dueForChaseX") }, 1],
    ["the same-tick chase back", { ...good, report: good.report.replace("Math.max(Number(p.nagged_at ?? 0), Number(p.seen_at ?? 0))", "Number(p.nagged_at ?? 0)") }, 1],
    ["the dedupe removed", { ...good, report: good.report.replace("withoutDuplicates(payload.items, openBefore)", "{ kept: payload.items, dropped: [] }") }, 1],
    ["the sign-in pre-step removed from the wrapper", { ...good, wrapper: good.wrapper.replace(/kdp-signin\.mjs/g, "x") }, 1],
    ["the mixed-message refusal removed", { ...good, report: good.report.replace("MIXED_MESSAGE", "X") }, 1],
    ["readReply judging the whole message again", { ...good, lane: good.lane.replace("const raw = herWords(text)", "const raw = String(text ?? \"\").trim()") }, 1],
    ["the reply path unwired", { ...good, intake: good.intake.replace(/answerKdpFromMail/g, "nothing") }, 1],
    ["RULE 0: an empty register", { ...good, register: JSON.stringify({ titles: [], settled: {} }) }, 1],
    ["the register read after Gmail", { ...good, prompt: good.prompt.replace(/kdp-register\.json/g, "x").concat("\nLoad the Gmail tools ... then read kdp-register.json") }, 1],
  ];
  let wrong = 0;
  for (const [name, files, min] of cases) {
    const p = check(files);
    const ok = min === 0 ? p.length === 0 : p.length >= min;
    if (!ok) { wrong += 1; console.error(`  ✗ ${name}: ${p.length} problem(s)\n    ${p.join("\n    ")}`); }
  }
  if (wrong) { console.error(`kdp-seeing-it-produces-something self-test: ${wrong} case(s) wrong`); process.exit(1); }
  console.log(`kdp-seeing-it-produces-something self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }
const problems = check(load());
if (problems.length) {
  console.error("SEEING IT DOES NOT PRODUCE SOMETHING:");
  for (const x of problems) console.error(`  ✗ ${x}`);
  process.exit(1);
}
const n = JSON.parse(readFileSync(join(ROOT, F.register), "utf8")).titles.length;
console.log(`kdp-seeing-it-produces-something: one poster, ${n} titles in the register all target LIVE, assignment is a row, a problem stays loud, her reply lands. OK.`);
