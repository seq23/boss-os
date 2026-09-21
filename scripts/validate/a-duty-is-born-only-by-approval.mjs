#!/usr/bin/env node
/**
 * A DUTY IS BORN ONLY BY HER APPROVAL, AND ONLY IF IT CAN RUN.
 *
 * ─── The lane this guards ───────────────────────────────────────────────────
 *
 * 21 Sep 2026: "is there a lane for me to ask for a new duty to my Boss OS agents?" Now there is —
 * `#<seat> new duty …` by mail, or Team → Duties — and a duty row can be created from a sentence.
 * A row that can be created from a sentence can be created wrongly: no owner, no model, a script
 * her Mac does not have, a delivery key nothing handles. Each is a duty that fires on time and
 * does nothing — "runs but inert", the defect this repository produces most.
 *
 * ─── What it pins, and why each is separate ─────────────────────────────────
 *
 *   1. ONE WRITER. Exactly one `INSERT INTO standing_duties` exists under src/worker, and it is in
 *      `duties/create.ts`. A second insert anywhere is a second road around the check.
 *   2. THE CHECK SITS ABOVE THE WRITE. `createDutyFromDraft` calls `dutyCanRun` before the INSERT,
 *      and `dutyCanRun` runs `dutyProblems` — the shared lane's one rule (owner active, model
 *      named, agent → a delivery key with a handler, local job → an installed script no other duty
 *      claims).
 *   3. TWO ROADS TO THE WRITER, BOTH HERS. `createDutyFromDraft` is called from exactly two places:
 *      the `duty_created` resume handler (the approval loop — the Inbox button and her `approved`
 *      by mail both decide that same judgement call) and the mail lane's pre-approval branch,
 *      which must pass `via: "pre_approved"` WITH the phrase. `create.ts` refuses a pre-approval
 *      that carries no phrase.
 *   4. BELOW THE REFUSAL. In `intake/inboundMail.ts`, both duty-lane calls sit after the
 *      `if (!authorised)` return, so a stranger who knows a token cannot draft or approve.
 *   5. THE MANIFEST IS THE INSTALLER. `INSTALLED_LOCAL_JOBS` in the shared lane equals the set of
 *      scripts `install-agent-launchd.sh` wraps in `duty-run.sh`. The Worker cannot read the Mac's
 *      disk; this is how it knows what exists there, and two lists with no link is the defect.
 *   6. THE RULES RUN. `dutyProblems`, `dutyRequestIn`, `readDutyReply` and `pickSlot` are executed
 *      over fixtures here, so a rule that drifted would fail this file even if the vitest suite
 *      were skipped.
 *
 * RULE 0: zero installed jobs, zero fixtures, or zero writers found is a failure, never a pass.
 *
 *   node scripts/validate/a-duty-is-born-only-by-approval.mjs
 *   node scripts/validate/a-duty-is-born-only-by-approval.mjs --self-test
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANE = "src/shared/boss/duties/lane.mjs";
const CREATE = "src/worker/boss/duties/create.ts";
const RESUME = "src/worker/boss/approvals/resume.ts";
const MAIL_LANE = "src/worker/boss/duties/mailLane.ts";
const INBOUND = "src/worker/boss/intake/inboundMail.ts";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";
const WORKER_DIR = "src/worker";

const lane = await import(join(ROOT, LANE));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Every source file under src/worker as { relativePath: text }. */
function readWorker() {
  const files = {};
  for (const p of walk(join(ROOT, WORKER_DIR))) files[relative(ROOT, p)] = readFileSync(p, "utf8");
  return files;
}

/** Code only: block and line comments removed, so a rule quoted in a comment is not a hit. */
function code(text) {
  return String(text ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function installedInInstaller(installerText) {
  const names = new Set();
  // A script name, with its extension: prose like "WRAPPED IN duty-run.sh SO THE RUN" is not a job.
  for (const m of String(installerText ?? "").matchAll(/duty-run\.sh\s+([a-z0-9][a-z0-9-]*\.(?:sh|mjs))\b/gi)) names.add(m[1].toLowerCase());
  return [...names].sort();
}

/**
 * The structural pins, over a map of file → text. Pure, so the self-test can feed mutations.
 */
export function problemsIn(files, installerText, laneManifest) {
  const problems = [];

  // 1. One writer.
  const writers = [];
  for (const [path, text] of Object.entries(files)) {
    const n = (code(text).match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+standing_duties\b/gi) ?? []).length;
    if (n > 0) writers.push({ path, n });
  }
  if (writers.length === 0) problems.push("RULE 0: no `INSERT INTO standing_duties` found anywhere under src/worker — the lane has no writer, so nothing can be pinned.");
  for (const w of writers) {
    if (w.path !== CREATE) problems.push(`${w.path} inserts into standing_duties (${w.n}×). The one writer is ${CREATE}; a second insert is a road around the check.`);
    else if (w.n !== 1) problems.push(`${CREATE} inserts into standing_duties ${w.n} times; exactly one.`);
  }

  // 2. The check sits above the write.
  const create = code(files[CREATE] ?? "");
  if (!create) problems.push(`${CREATE} is missing.`);
  else {
    const check = create.indexOf("await dutyCanRun(");
    const insert = create.search(/INSERT\s+INTO\s+standing_duties/i);
    if (check === -1) problems.push(`${CREATE} never calls dutyCanRun().`);
    else if (insert !== -1 && check > insert) problems.push(`${CREATE} inserts before it checks: dutyCanRun() must run above the INSERT.`);
    if (!/dutyProblems\(/.test(create)) problems.push(`${CREATE} does not run dutyProblems() — the shared lane's one rule — inside its check.`);
    if (!/throw new DutyCannotRun\(problems\)/.test(create)) problems.push(`${CREATE} does not refuse on problems; a check whose result is ignored is prose.`);
    if (!/via === "pre_approved" && !provenance\.phrase/.test(create)) problems.push(`${CREATE} does not refuse a pre-approval that carries no phrase.`);
  }

  // 3. Two roads to the writer.
  const callers = [];
  for (const [path, text] of Object.entries(files)) {
    if (path === CREATE) continue;
    const c = code(text);
    const n = (c.match(/createDutyFromDraft\(/g) ?? []).length;
    if (n > 0) callers.push({ path, n, text: c });
  }
  const allowed = new Set([RESUME, MAIL_LANE]);
  for (const c of callers) {
    if (!allowed.has(c.path)) problems.push(`${c.path} calls createDutyFromDraft(). Only the approval loop (${RESUME}) and the recorded pre-approval (${MAIL_LANE}) may.`);
  }
  const resume = callers.find((c) => c.path === RESUME);
  if (!resume) problems.push(`${RESUME} does not call createDutyFromDraft() — the approval loop no longer creates the duty.`);
  else {
    const handler = resume.text.indexOf("duty_created: async");
    const call = resume.text.indexOf("createDutyFromDraft(");
    if (handler === -1 || call < handler) problems.push(`${RESUME} calls createDutyFromDraft() outside the duty_created handler.`);
    if (resume.n !== 1) problems.push(`${RESUME} calls createDutyFromDraft() ${resume.n} times; exactly one, inside duty_created.`);
  }
  const mailLane = callers.find((c) => c.path === MAIL_LANE);
  if (!mailLane) problems.push(`${MAIL_LANE} does not call createDutyFromDraft() — pre-approval in the request creates nothing.`);
  else {
    if (mailLane.n !== 1) problems.push(`${MAIL_LANE} calls createDutyFromDraft() ${mailLane.n} times; exactly one, on the pre-approval branch.`);
    const call = mailLane.text.indexOf("createDutyFromDraft(");
    const guard = mailLane.text.lastIndexOf('if (state === "created")', call);
    if (guard === -1) problems.push(`${MAIL_LANE} calls createDutyFromDraft() outside the \`state === "created"\` (pre-approved) branch.`);
    const args = mailLane.text.slice(call, call + 400);
    if (!/via: "pre_approved"/.test(args)) problems.push(`${MAIL_LANE}'s call does not record via: "pre_approved".`);
    if (!/phrase: input\.preApproved/.test(args)) problems.push(`${MAIL_LANE}'s call does not carry the pre-approval phrase.`);
    if (!/state: FiledDraft\["state"\] = draft\.refusals\.length > 0 \? "refused" : input\.preApproved \? "created" : "drafted"/.test(mailLane.text)) {
      problems.push(`${MAIL_LANE}: the pre-approved state must be decided from input.preApproved (the ORIGINAL request) and refusals first.`);
    }
    if (!/const req = dutyRequestIn\(input\.subject, input\.text, input\.roster\)/.test(mailLane.text) || !/preApproved: req\.preApproved/.test(mailLane.text)) {
      problems.push(`${MAIL_LANE}: the pre-approval must be read by dutyRequestIn from the request mail itself.`);
    }
    // A later message must not pre-approve: the reply path files with preApproved: null.
    const answer = mailLane.text.indexOf("export async function answerDutyFromMail");
    if (answer === -1) problems.push(`${MAIL_LANE} has no answerDutyFromMail.`);
    else if (/preApproved: (?!null)/.test(mailLane.text.slice(answer))) problems.push(`${MAIL_LANE}: a reply may not carry a pre-approval; only the original request may.`);
  }

  // 4. Below the refusal.
  const inbound = code(files[INBOUND] ?? "");
  if (!inbound) problems.push(`${INBOUND} is missing.`);
  else {
    const refusal = inbound.indexOf("if (!authorised)");
    for (const fn of ["answerDutyFromMail(", "newDutyFromMail("]) {
      const at = inbound.indexOf(`await ${fn}`);
      if (at === -1) problems.push(`${INBOUND} never calls ${fn} — the mail door is not wired.`);
      else if (refusal === -1 || at < refusal) problems.push(`${INBOUND} calls ${fn} ABOVE the sender refusal; a stranger could draft or approve a duty.`);
    }
  }

  // 5. The manifest is the installer.
  const installed = installedInInstaller(installerText);
  const manifest = [...(laneManifest ?? [])].map((s) => String(s).toLowerCase()).sort();
  if (installed.length === 0) problems.push(`RULE 0: ${INSTALLER} wraps no script in duty-run.sh; nothing to pin the manifest against.`);
  for (const s of installed) if (!manifest.includes(s)) problems.push(`${INSTALLER} installs ${s} and INSTALLED_LOCAL_JOBS in ${LANE} does not list it. Add it.`);
  for (const s of manifest) if (!installed.includes(s)) problems.push(`INSTALLED_LOCAL_JOBS in ${LANE} lists ${s} and ${INSTALLER} does not install it. Remove it or wrap it.`);

  return { problems, writers: writers.length, callers: callers.length, installed: installed.length };
}

// ─── 6. The rules run ────────────────────────────────────────────────────────

const ROSTER = [
  { id: "emp_chief", name: "Simone", role: "Chief of Staff" },
  { id: "emp_relationship", name: "Monique", role: "Director of Relationships" },
  { id: "emp_research", name: "Camille", role: "Director of Research" },
];
const KEYS = ["executive_reports", "sourcing_candidates", "link_prospects", "tool_suggestions", "practice_week"];
const OK = { employee_id: "emp_x", employee_active: true, model: "claude-haiku-4-5-20251001" };

export function fixturesFor(lane) {
  return [
  { name: "an agent duty with a handled key passes", run: () => lane.dutyProblems({ ...OK, executor: "agent", delivers: "executive_reports" }, [], KEYS).length === 0 },
  { name: "an agent duty with no key is refused", run: () => /land nowhere/.test(lane.dutyProblems({ ...OK, executor: "agent", delivers: null }, [], KEYS)[0] ?? "") },
  { name: "a local job naming an uninstalled script is a NAMED STOP", run: () => /NAMED STOP \[NO_SUCH_SCRIPT\]/.test(lane.dutyProblems({ ...OK, executor: "local_job", local_job: "not-there.sh" }, [], KEYS)[0] ?? "") },
  { name: "a local job naming an installed, unclaimed script passes", run: () => lane.dutyProblems({ ...OK, executor: "local_job", local_job: lane.INSTALLED_LOCAL_JOBS[0] }, [], KEYS).length === 0 },
  { name: "a local job naming a script another duty claims is refused", run: () => /already belongs/.test(lane.dutyProblems({ ...OK, executor: "local_job", local_job: lane.INSTALLED_LOCAL_JOBS[0] }, [{ id: "duty_a", name: "A", local_job: lane.INSTALLED_LOCAL_JOBS[0] }], KEYS)[0] ?? "") },
  { name: "an inactive owner is refused", run: () => /not an active employee/.test(lane.dutyProblems({ ...OK, employee_active: false, executor: "agent", delivers: "executive_reports" }, [], KEYS)[0] ?? "") },
  { name: "no model is refused", run: () => /No model/.test(lane.dutyProblems({ ...OK, model: "", executor: "agent", delivers: "executive_reports" }, [], KEYS)[0] ?? "") },
  { name: "#monique new duty <words> names the seat", run: () => lane.dutyRequestIn("#monique new duty", "every friday check the sheet", ROSTER)?.seat?.id === "emp_relationship" },
  { name: "#simone new duty camille … routes to Camille", run: () => { const r = lane.dutyRequestIn("#simone new duty camille weekly report", "", ROSTER); return r?.seat?.id === "emp_research" && r?.routedBy?.id === "emp_chief"; } },
  { name: "an ordinary mail is not a request", run: () => lane.dutyRequestIn("#monique add the Databricks buyers", "", ROSTER) === null },
  { name: "an unknown seat is an error, not a guess", run: () => Boolean(lane.dutyRequestIn("#nobody new duty x", "", ROSTER)?.error) },
  { name: "`your call` is read from the request", run: () => lane.dutyRequestIn("#monique new duty weekly, your call", "", ROSTER)?.preApproved === "your call" },
  { name: "`approved` approves; with a token too", run: () => lane.readDutyReply("approved").mode === "approved" && lane.readDutyReply("approved [dd_abc]").mode === "approved" },
  { name: "`changes: …` redrafts with the text", run: () => { const r = lane.readDutyReply("changes: daily at 3pm"); return r.mode === "changes" && r.text === "daily at 3pm"; } },
  { name: "`no` holds; a question is a note", run: () => lane.readDutyReply("no thanks").mode === "held" && lane.readDutyReply("how much?").mode === "other" },
  { name: "the slot skips her busy hours", run: () => { const s = lane.pickSlot([], { cadence: "weekly", weekday: 1 }); return s.hour === 8 && !(s.hour in lane.BUSY_HOURS); } },
  { name: "the slot skips an hour a daily duty takes, and says so", run: () => { const s = lane.pickSlot([{ local_hour: 8, cadence: "daily", name: "Eight" }], { cadence: "weekly", weekday: 5 }); return s.hour === 13 && /Eight/.test(s.why); } },
  { name: "the slot ignores a weekly duty on another day", run: () => lane.pickSlot([{ local_hour: 8, cadence: "weekly", weekday: 2 }], { cadence: "weekly", weekday: 5 }).hour === 8 },
  ];
}

export const FIXTURES = fixturesFor(lane);

export function ruleFailures(l = lane) {
  const out = [];
  for (const f of fixturesFor(l)) {
    let ok = false;
    try { ok = Boolean(f.run()); } catch (err) { ok = false; out.push(`${f.name}: threw ${err instanceof Error ? err.message : err}`); continue; }
    if (!ok) out.push(f.name);
  }
  return out;
}

// ─── Self-test: break each pin, watch it fail, restore ───────────────────────

function selfTest() {
  const files = readWorker();
  const installer = readFileSync(join(ROOT, INSTALLER), "utf8");
  const base = problemsIn(files, installer, lane.INSTALLED_LOCAL_JOBS);
  const cases = [];
  const expectFail = (name, mutated, installerText = installer, manifest = lane.INSTALLED_LOCAL_JOBS, pattern) => {
    const r = problemsIn(mutated, installerText, manifest);
    const hit = r.problems.some((p) => pattern.test(p));
    cases.push({ name, ok: hit, got: r.problems });
  };

  expectFail("a second INSERT in a route", { ...files, "src/worker/boss/routes/x.ts": "await env.DB.prepare(`INSERT INTO standing_duties (id) VALUES (?)`).run();" }, undefined, undefined, /second insert is a road/);
  expectFail("the writer removed", { ...files, [CREATE]: files[CREATE].replace("`INSERT INTO standing_duties\n", "`SELECT 1 FROM standing_duties\n") }, undefined, undefined, /RULE 0: no `INSERT INTO standing_duties`/);
  expectFail("the check below the write", { ...files, [CREATE]: files[CREATE].replace("const problems = await dutyCanRun(env, draft);\n  if (problems.length > 0) throw new DutyCannotRun(problems);\n", "").replace("  if (provenance.draft_id) {", "  const problems = await dutyCanRun(env, draft);\n  if (problems.length > 0) throw new DutyCannotRun(problems);\n  if (provenance.draft_id) {") }, undefined, undefined, /inserts before it checks/);
  expectFail("the check ignored", { ...files, [CREATE]: files[CREATE].replace("if (problems.length > 0) throw new DutyCannotRun(problems);", "void problems;") }, undefined, undefined, /does not refuse on problems/);
  expectFail("a pre-approval without a phrase allowed", { ...files, [CREATE]: files[CREATE].replace('if (provenance.via === "pre_approved" && !provenance.phrase) {', "if (false) {") }, undefined, undefined, /pre-approval that carries no phrase/);
  expectFail("a route creating a duty directly", { ...files, "src/worker/boss/routes/x.ts": "await createDutyFromDraft(env, draft, { approved_by: 'boss', via: 'screen' });" }, undefined, undefined, /Only the approval loop/);
  expectFail("the resume handler no longer creates", { ...files, [RESUME]: files[RESUME].replace("createDutyFromDraft(", "somethingElse(") }, undefined, undefined, /approval loop no longer creates/);
  expectFail("the pre-approval branch drops the phrase", { ...files, [MAIL_LANE]: files[MAIL_LANE].replace("phrase: input.preApproved,", "phrase: null,") }, undefined, undefined, /does not carry the pre-approval phrase/);
  expectFail("a reply carrying a pre-approval", { ...files, [MAIL_LANE]: files[MAIL_LANE].replace("tag: row.tag, routedBy: signer.id !== seat.id ? signer : null, preApproved: null,", "tag: row.tag, routedBy: signer.id !== seat.id ? signer : null, preApproved: readDutyReply(input.text).text,") }, undefined, undefined, /a reply may not carry a pre-approval/);
  expectFail("the mail door above the refusal", { ...files, [INBOUND]: files[INBOUND].replace("if (!authorised) {", "if (false) {").replace(/const dutyAnswer = planAnswer \? null : await answerDutyFromMail\(/, "const dutyAnswer = planAnswer ? null : await answerDutyFromMail(") }, undefined, undefined, /never calls|ABOVE the sender refusal/);
  expectFail("the mail door unwired", { ...files, [INBOUND]: files[INBOUND].replace("await newDutyFromMail(", "await nothing(") }, undefined, undefined, /never calls newDutyFromMail/);
  expectFail("a script installed but not in the manifest", files, `${installer}\n<string>bash $REPO/scripts/ops/duty-run.sh brand-new.sh -- bash brand-new.sh</string>`, undefined, /installs brand-new\.sh and INSTALLED_LOCAL_JOBS/);
  expectFail("a manifest entry the installer does not know", files, undefined, [...lane.INSTALLED_LOCAL_JOBS, "phantom.sh"], /lists phantom\.sh/);
  expectFail("an installer with no duties (Rule 0)", files, "# nothing", undefined, /RULE 0/);

  // The rule fixtures must fail when the rule is broken: a check that passes everything, a reader
  // that approves everything, a slot picker that ignores the busy hours.
  cases.push({ name: "the rule fixtures catch a permissive dutyProblems", ok: ruleFailures({ ...lane, dutyProblems: () => [] }).length >= 5, got: [] });
  cases.push({ name: "the rule fixtures catch a reader that approves everything", ok: ruleFailures({ ...lane, readDutyReply: () => ({ mode: "approved", text: "" }) }).length >= 2, got: [] });
  cases.push({ name: "the rule fixtures catch a slot picker that ignores busy hours", ok: ruleFailures({ ...lane, pickSlot: () => ({ hour: 7, minute: 0, why: "" }) }).length >= 2, got: [] });
  cases.push({ name: "the rule fixtures catch a grammar that routes nothing", ok: ruleFailures({ ...lane, dutyRequestIn: () => null }).length >= 3, got: [] });

  const failed = cases.filter((c) => !c.ok);
  if (base.problems.length) {
    console.error("self-test cannot run against a failing tree:\n  " + base.problems.join("\n  "));
    process.exit(1);
  }
  if (failed.length) {
    console.error(`validate:duty-birth self-test FAILED (${failed.length} of ${cases.length}):`);
    for (const c of failed) console.error(`  ✗ ${c.name}\n      got: ${c.got.join(" | ") || "(no problems reported)"}`);
    process.exit(1);
  }
  console.log(`validate:duty-birth self-test: ${cases.length} mutations each caught.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const files = readWorker();
const installer = readFileSync(join(ROOT, INSTALLER), "utf8");
const { problems, writers, callers, installed } = problemsIn(files, installer, lane.INSTALLED_LOCAL_JOBS);
const rules = ruleFailures();
if (FIXTURES.length === 0) { console.error("RULE 0: no rule fixtures."); process.exit(2); }
if (problems.length || rules.length) {
  console.error("validate:duty-birth FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  for (const r of rules) console.error(`  ✗ rule fixture: ${r}`);
  process.exit(1);
}
console.log(
  `validate:duty-birth: ${writers} writer (${CREATE}), ${callers} roads to it (approval loop + recorded pre-approval), ` +
  `both mail-door calls below the sender refusal, ${installed} installed local jobs pinned to the installer, ${FIXTURES.length} rule fixtures pass.`,
);
