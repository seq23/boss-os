#!/usr/bin/env node
/**
 * THE REPO-CHANGE LANE LANDS ONLY ON A RECORDED GREEN AND HER RECORDED REPLY — AND ONLY FOR HER.
 *
 * ─── What this guards ───────────────────────────────────────────────────────
 *
 * Plan B, 20 September 2026. Danielle changes a grid repository on the owner's word: plan, ask,
 * build on her answers, PR, land on green, prove it live. Her decision — LAND ON GREEN — removes
 * the second reply, and that makes two recorded facts load-bearing where a person used to be:
 *
 *   1. `checks_green_at` on the row, written from what `gh pr checks` said and from nothing else.
 *   2. `answered_at` / `answers_text` on the row — her reply to the plan email, which is the plan
 *      approval. There is no BUILD without it and no LAND without it.
 *
 * And a third fact that makes the first two hers: the reply that records the approval is accepted
 * only from her, DMARC-proven, below the refusal in the mailbox. A token anyone could reply with
 * would make land-on-green a door anyone could open.
 *
 * ─── What is asserted, and why each is behaviour rather than prose ──────────
 *
 *   A. THE GUARDS REFUSE. `canEnterBuild` and `canLand` from the shared module are RUN over fixture
 *      rows: no plan → refused; no answer → refused; no PR → refused; no green → refused; all four
 *      present → allowed. `claimablePhase` agrees with both. The functions the Worker, the runner
 *      and this file call are the same functions.
 *   B. THE GUARDS ARE THE ONES THAT HAND OUT WORK. The claim route calls `claimablePhase(`, the land
 *      report calls `canLand(`, and the runner calls both before running a phase. A guard nobody
 *      calls is a comment.
 *   C. THE GREEN HAS ONE WRITER. `checks_green_at` is assigned in exactly one place, the `/checks`
 *      route, inside the `state === "green"` branch. No migration defaults it.
 *   D. THE APPROVAL IS HERS ALONE. In `inboundMail.ts` the call to `answerFromMail(` and the call to
 *      `admitTask(` both sit AFTER the `if (!authorised)` return. The test file pins the same thing
 *      by running a stranger's mail through the real handler (Scooter cannot use this lane).
 *   E. NOTHING LANDS OUTSIDE ~/bin/land. The lane's executor and runner carry no `gh pr merge`,
 *      `gh workflow run`, `git push … main`, `wrangler deploy` or `npm run deploy` in code; the
 *      prompt's LAND section names `{{LAND}}`; and the prompt mentions the forbidden verbs only on
 *      lines that forbid them.
 *   F. THE AHREFS PIN IS NOT LOOSENED. `the-audit-fixer-cannot-touch-velocity.mjs` still targets
 *      `ahrefs-audit-fix.sh` and still forbids `gh pr merge` there. Land-on-green is THIS lane's
 *      rule; the weekly fixer still opens PRs and she merges.
 *   H. ONE WORD APPROVES, "NO" HOLDS (owner, 21 Sep 2026). `readReply` is RUN over fixtures:
 *      "approved", "Approved.", "yes", "go", "land it" → approved; "no", "not approved", "stop",
 *      "changes: …" → held; "Use B. Go." → answers. The Worker's answer path calls `readReply(`
 *      and writes `held_at` on a hold without touching `answered_at`; the plan email prints a
 *      recommended default per ask and the word "approved"; the test file proves "approved"
 *      advances and "no" holds through the real handler.
 *   I. NOT PUBLISH-READY LANDS ONLY AFTER THE PREVIEW, OR BY HER NAMED FORCE (owner, 21 Sep 2026).
 *      `canLand` is RUN: a not-ready row with green + plan approval is refused; with a preview
 *      email and a second approval recorded AFTER it, allowed; with the approval BEFORE the email,
 *      refused; with `forced_by` + `forced_at`, allowed; with neither, refused; `preview_forced`
 *      on a ready plan behaves as not-ready. `readReply` is RUN: "preview" → preview (sets
 *      neither the land approval nor the force); "approved to production" / "force production" /
 *      "ship it anyway" / "land anyway" → forced; plain "approved" is never forced. In the Worker,
 *      `forced_by` is written only inside `recordForce`, which is called only from the answer path
 *      below the sender refusal; the plan route refuses a report without `publish_ready`; the
 *      build route sends a not-ready row to `preview` unless forced; the runner's DONE email leads
 *      with the force. The test file proves the four paths and the stranger's force.
 *   J. PRE-APPROVAL COMES ONLY FROM HER OWN REQUEST (owner, 21 Sep 2026). `preApprovalIn` is RUN
 *      over the six phrases and over near-misses; `pre_approved_phrase` is written in exactly one
 *      place — the INSERT in `tasks/admit.ts`, below the sender refusal — and never in the answer
 *      path; the finding names the phrase; the plan route refuses a pre-approved plan that asks
 *      and files it as approved BY HER; and `canLand` is RUN on a pre-approved not-ready row: refused
 *      without a preview approval or a force. The tests prove the three paths and the stranger.
 *   K. THE CLI RUNS ON HER SEAT (21 Sep 2026 live defect). The runner never spawns `claude` with
 *      `env: process.env`; every spawn passes `seatEnv(process.env)`, and `seatEnv` is RUN: given
 *      a parent carrying ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL and CLAUDE_CODE_OAUTH_TOKEN, the
 *      child env has none of them and still has PATH and HOME. The same for the other two
 *      vault-run CLI callers (credential-check, interest-extract).
 *   G. RULE 0 AND THE CAPS. The runner exits non-zero with NAMED STOP [NOTHING_CLAIMABLE] on a
 *      quiet tick; the executor maps that code to a named line; every `claude -p` carries
 *      `--max-turns`; and the model per phase is read from `PHASE_MODELS` — no `claude-…` literal
 *      is typed into the executor or the runner.
 *
 * RULE 0: zero fixtures, zero files or zero guard calls found is a FAILURE.
 *
 *   node scripts/validate/the-repo-lane-lands-only-on-green.mjs
 *   node scripts/validate/the-repo-lane-lands-only-on-green.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const FILES = {
  lane: "src/shared/boss/repoChange/lane.mjs",
  routes: "src/worker/boss/routes/repoChanges.ts",
  mail: "src/worker/boss/intake/inboundMail.ts",
  answer: "src/worker/boss/repoChange/answer.ts",
  admit: "src/worker/boss/tasks/admit.ts",
  credcheck: "scripts/ops/credential-check.mjs",
  extract: "scripts/ops/interest-extract.mjs",
  executor: "scripts/ops/repo-change.sh",
  runner: "scripts/ops/repo-change.mjs",
  prompt: "scripts/ops/repo-change-prompt.md",
  test: "tests/boss/repoChange.test.ts",
  ahrefs: "scripts/validate/the-audit-fixer-cannot-touch-velocity.mjs",
  migrations: null, // filled by the scan: every migration concatenated
  src: null,        // every .ts under src/worker/boss, concatenated, for the one-writer check
};

const code = (src) => String(src ?? "").split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");
const FORBIDDEN = [
  /\bgh\s+pr\s+merge\b/, /\bgh\s+workflow\s+run\b/, /\bgit\s+push\s+(?:\S+\s+)?(?:origin\s+)?main\b/, /\bwrangler\s+deploy\b/, /npm\s+run\s+deploy/,
  // The spawn-array spelling of the same verbs: spawnSync("gh", ["pr", "merge", …]).
  /["']gh["']\s*,\s*\[\s*["']pr["']\s*,\s*["']merge["']/, /["']gh["']\s*,\s*\[\s*["']workflow["']\s*,\s*["']run["']/, /["']wrangler["']\s*,\s*\[\s*["']deploy["']/,
];

// ─── A. The guards, run ───────────────────────────────────────────────────────

export function guardProblems(lane) {
  const bad = [];
  // `publish_ready: 1` is part of "all four" now: a row that never said is treated as not ready.
  const full = { phase: "land", plan_text: "# plan", answered_at: 1, answers_text: "go", pr_url: "https://x/pull/1", pr_number: 1, checks_green_at: 2, publish_ready: 1 };
  const cases = [
    ["build: no plan", lane.canEnterBuild({ ...full, phase: "build", plan_text: null }), false],
    ["build: no answer", lane.canEnterBuild({ ...full, phase: "build", answered_at: null, answers_text: null }), false],
    ["build: answered", lane.canEnterBuild({ ...full, phase: "build" }), true],
    ["build: wrong phase", lane.canEnterBuild({ ...full, phase: "asking" }), false],
    ["land: no PR", lane.canLand({ ...full, pr_url: null, pr_number: null }), false],
    ["land: no green", lane.canLand({ ...full, checks_green_at: null }), false],
    ["land: no answer", lane.canLand({ ...full, answered_at: null, answers_text: null }), false],
    ["land: wrong phase", lane.canLand({ ...full, phase: "landing" }), false],
    ["land: all four", lane.canLand(full), true],
    ["land: null row", lane.canLand(null), false],
  ];
  for (const [name, verdict, want] of cases) {
    if (Boolean(verdict?.ok) !== want) bad.push(`guard ${name}: expected ok=${want}, got ${JSON.stringify(verdict)}`);
  }
  if (lane.claimablePhase({ ...full, phase: "landing" }) !== null) bad.push("claimablePhase: a landing row (no recorded green) is claimable");
  if (lane.claimablePhase({ ...full, phase: "asking" }) !== null) bad.push("claimablePhase: an asking row (no reply) is claimable");
  if (lane.claimablePhase({ ...full, phase: "build", answered_at: null, answers_text: null }) !== null) bad.push("claimablePhase: an unanswered build is claimable");
  if (lane.claimablePhase(full) !== "land") bad.push("claimablePhase: a green, approved row is not claimable for land");
  if (lane.claimablePhase({ phase: "plan" }) !== "plan") bad.push("claimablePhase: a fresh row is not claimable for plan");

  // H. one word approves, "no" holds — run, not read.
  const replies = [
    ["approved", "approved"], ["Approved.", "approved"], ["yes", "approved"], ["go", "approved"], ["Land it", "approved"],
    ["no", "held"], ["No, not yet", "held"], ["not approved", "held"], ["stop", "held"], ["changes: use B", "held"],
    ["Use B. Go.", "answers"], ["note: B please", "answers"], ["approved\nbut B", "answers"], ["", "empty"],
  ];
  for (const [text, want] of replies) {
    const got = typeof lane.readReply === "function" ? lane.readReply(text)?.mode : "(no readReply)";
    if (got !== want) bad.push(`readReply(${JSON.stringify(text)}): expected ${want}, got ${got}`);
  }
  // I. the preview gate and the named force — run, not read.
  const notReady = { ...full, publish_ready: 0 };
  const previewCases = [
    ["not ready, green, approved, no preview", lane.canLand(notReady), false],
    ["not ready, preview sent, no second word", lane.canLand({ ...notReady, preview_sent_at: 10 }), false],
    ["not ready, second approved BEFORE the preview email", lane.canLand({ ...notReady, preview_sent_at: 10, land_approved_at: 9, land_approval_text: "approved" }), false],
    ["not ready, second approved AFTER the preview email", lane.canLand({ ...notReady, preview_sent_at: 10, land_approved_at: 11, land_approval_text: "approved" }), true],
    ["not ready, forced by her", lane.canLand({ ...notReady, forced_by: "seq.taylor@gmail.com", forced_at: 5 }), true],
    ["not ready, forced_by without forced_at", lane.canLand({ ...notReady, forced_by: "seq.taylor@gmail.com" }), false],
    ["ready but she asked for a preview", lane.canLand({ ...full, publish_ready: 1, preview_forced: 1 }), false],
    ["publish_ready never said", lane.canLand({ ...full, publish_ready: null }), false],
    ["ready, plain", lane.canLand({ ...full, publish_ready: 1 }), true],
  ];
  for (const [name, verdict, want] of previewCases) {
    if (Boolean(verdict?.ok) !== want) bad.push(`preview gate ${name}: expected ok=${want}, got ${JSON.stringify(verdict)}`);
  }
  const forceReplies = [
    ["preview", "preview"], ["Preview only.", "preview"], ["preview first", "preview"],
    ["approved to production", "forced"], ["force production", "forced"], ["ship it anyway", "forced"], ["land anyway", "forced"],
    ["approved", "approved"], ["approved to prod", "answers"], ["production", "answers"],
  ];
  for (const [text, want] of forceReplies) {
    const got = typeof lane.readReply === "function" ? lane.readReply(text)?.mode : "(no readReply)";
    if (got !== want) bad.push(`readReply(${JSON.stringify(text)}): expected ${want}, got ${got}`);
  }
  // J. pre-approval: the phrases, the near-misses, and the gate on a pre-approved not-ready row.
  const preCases = [
    ["your call — just do the hero", "your call"], ["You decide.", "you decide"], ["no need to ask me", "no need to ask"],
    ["Just do it", "just do it"], ["pick everything yourself", "pick everything"], ["no options please", "no options"],
    ["I have no option here", null], ["call me", null], ["decide with me", null], ["", null],
  ];
  for (const [text, want] of preCases) {
    const got = typeof lane.preApprovalIn === "function" ? lane.preApprovalIn(text) : "(no preApprovalIn)";
    if (got !== want) bad.push(`preApprovalIn(${JSON.stringify(text)}): expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  const preNotReady = { ...notReady, pre_approved_phrase: "your call", pre_approved_by: "seq.taylor@gmail.com", plan_approved_by: "seq.taylor@gmail.com (pre-approved in the request)" };
  if (lane.canLand(preNotReady).ok) bad.push("preview gate: a pre-approved NOT-ready row lands with neither a preview approval nor a force");
  if (!lane.canLand({ ...preNotReady, forced_by: "seq.taylor@gmail.com", forced_at: 3 }).ok) bad.push("preview gate: a pre-approved not-ready row forced by her does not land");
  if (!lane.canLand({ ...preNotReady, preview_sent_at: 10, land_approved_at: 11, land_approval_text: "approved" }).ok) bad.push("preview gate: a pre-approved not-ready row with her preview approval does not land");
  // K. seatEnv, run: the key never reaches the child; the plumbing does.
  const seat = lane.__seat;
  if (typeof seat?.seatEnv !== "function") bad.push("scripts/ops/lib/seat-env.mjs: seatEnv() is missing.");
  else {
    const child = seat.seatEnv({ PATH: "/usr/bin", HOME: "/Users/x", ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_AUTH_TOKEN: "t", CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_BIN: "/opt/claude", BOSS_PASSCODE: "p" });
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) if (k in child) bad.push(`seatEnv leaves ${k} in the child's environment — the CLI would take it over her login.`);
    for (const k of ["PATH", "HOME", "CLAUDE_BIN", "BOSS_PASSCODE"]) if (!(k in child)) bad.push(`seatEnv strips ${k}, which the child needs.`);
  }
  return { problems: bad, cases: cases.length + 5 + replies.length + previewCases.length + forceReplies.length + preCases.length + 3 + 8 };
}

// ─── B–G. The files, read ─────────────────────────────────────────────────────

export function fileProblems(f) {
  const bad = [];
  for (const k of ["lane", "routes", "mail", "answer", "admit", "executor", "runner", "prompt", "test", "ahrefs"]) {
    if (f[k] === null || f[k] === undefined) bad.push(`${FILES[k] ?? k} does not exist.`);
  }
  if (bad.length) return bad;

  // B. the guards are what hand out work
  if (!/claimablePhase\s*\(/.test(f.routes)) bad.push(`${FILES.routes}: the claim route does not call claimablePhase(); the guard is not the thing handing out work.`);
  if (!/canLand\s*\(/.test(f.routes)) bad.push(`${FILES.routes}: the land report does not call canLand().`);
  if (!/canEnterBuild\s*\(/.test(f.runner) || !/canLand\s*\(/.test(f.runner)) bad.push(`${FILES.runner}: the runner does not check canEnterBuild()/canLand() itself before running a phase.`);

  // C. the green has one writer
  // One writer, in either spelling: `= ?` or `= COALESCE(checks_green_at, ?)` (a green recorded twice keeps the first).
  const writers = (f.src.match(/checks_green_at\s*=\s*(?:\?|COALESCE\(checks_green_at,\s*\?\))/g) ?? []).length;
  if (writers !== 1) bad.push(`checks_green_at is assigned in ${writers} place(s) across src/worker/boss; it must be exactly one — the /checks route on a green.`);
  const greenBranch = /state === "green"[\s\S]{0,600}checks_green_at = (?:\?|COALESCE\(checks_green_at,\s*\?\))/.test(f.routes);
  if (!greenBranch) bad.push(`${FILES.routes}: checks_green_at is not set inside the state === "green" branch of /checks.`);
  if (/checks_green_at\s+INTEGER\s+(?:NOT NULL\s+)?DEFAULT/i.test(f.migrations)) bad.push("a migration gives checks_green_at a DEFAULT; green must be recorded, never assumed.");

  // D. the approval is hers alone
  const refusal = f.mail.indexOf("if (!authorised)");
  const answer = f.mail.indexOf("answerFromMail(");
  const admit = f.mail.indexOf("admitTask(");
  if (refusal === -1) bad.push(`${FILES.mail}: the sender refusal (if (!authorised)) is gone.`);
  if (answer === -1) bad.push(`${FILES.mail}: answerFromMail() is never called — her reply cannot resume a change.`);
  if (refusal !== -1 && answer !== -1 && answer < refusal) bad.push(`${FILES.mail}: answerFromMail() is called BEFORE the sender refusal — a stranger's reply could approve a plan.`);
  if (refusal !== -1 && admit !== -1 && admit < refusal) bad.push(`${FILES.mail}: admitTask() is called before the sender refusal.`);
  if (!/REFUSED_SENDER/.test(f.test) || !/scooter/i.test(f.test)) bad.push(`${FILES.test}: no test runs a stranger's (Scooter's) #danielle mail through the handler and asserts REFUSED_SENDER.`);
  if (!/phase = 'build'[\s\S]{0,200}WHERE id = \? AND phase = 'asking'/.test(f.answer)) bad.push(`${FILES.answer}: the answer must move a row from 'asking' to 'build' and nothing else.`);
  if (!/readReply\s*\(/.test(f.answer)) bad.push(`${FILES.answer}: does not read her reply through readReply(); one word must mean the whole approval.`);
  const heldAt = f.answer.indexOf('mode === "held"');
  const buildAt = f.answer.indexOf("phase = 'build'");
  const heldBranch = heldAt !== -1 && buildAt > heldAt ? f.answer.slice(heldAt, buildAt) : "";
  if (!/SET held_at = \?/.test(heldBranch)) bad.push(`${FILES.answer}: a held reply does not write held_at (the hold branch must sit before the build update).`);
  if (/answered_at = \?/.test(heldBranch)) bad.push(`${FILES.answer}: a held reply writes answered_at — a hold must not count as an approval.`);
  if (!/recommended default/i.test(f.runner) || !/approved/.test(f.runner)) bad.push(`${FILES.runner}: the plan email does not print a recommended default per ask and the word "approved".`);
  if (!/"default"/.test(f.prompt)) bad.push(`${FILES.prompt}: the PLAN section does not ask for a "default" on every ask.`);
  if (!/exactly[\s\S]{0,80}approved/i.test(f.test) || !/HOLDS the task/.test(f.test)) bad.push(`${FILES.test}: no test proves a reply of exactly "approved" advances the task and "no" holds it.`);

  // I. the preview gate and the force, in the code that writes the rows
  const forceWriters = (f.src.match(/SET forced_by = \?/g) ?? []).length;
  if (forceWriters !== 1) bad.push(`forced_by is assigned in ${forceWriters} place(s) across src/worker/boss; it must be exactly one — recordForce in the answer path.`);
  if (!/async function recordForce/.test(f.answer) || !/SET forced_by = \?/.test(f.answer)) bad.push(`${FILES.answer}: recordForce() is missing or no longer writes forced_by.`);
  if (!/mode === "forced"[\s\S]{0,300}recordForce\(/.test(f.answer)) bad.push(`${FILES.answer}: the forced reply does not go through recordForce().`);
  if (/mode === "approved"[\s\S]{0,600}recordForce\(/.test(f.answer.slice(0, f.answer.indexOf('mode === "forced"')))) bad.push(`${FILES.answer}: a plain "approved" reaches recordForce() — the force words are separate and explicit.`);
  if (!/repo_change_forced/.test(f.answer)) bad.push(`${FILES.answer}: the force raises no finding (task event 'repo_change_forced').`);
  const previewBranch = (() => { const a = f.answer.indexOf('mode === "preview"'); return a === -1 ? "" : f.answer.slice(a, a + 700); })();
  if (/land_approved_at = \?|forced_by = \?/.test(previewBranch)) bad.push(`${FILES.answer}: the "preview" reply sets the land approval or the force — it must set neither.`);
  if (!/typeof b\?\.publish_ready !== "boolean"/.test(f.routes)) bad.push(`${FILES.routes}: the plan route accepts a report without publish_ready.`);
  if (!/needsPreview\(row\) && !isForced\(row\) \? "preview" : "landing"/.test(f.routes)) bad.push(`${FILES.routes}: the build route does not send a not-ready (unforced) row to the preview step.`);
  if (!/preview_message_id/.test(f.routes)) bad.push(`${FILES.routes}: the preview report does not require the preview email's id.`);
  if (!/Landed to production with/.test(f.runner)) bad.push(`${FILES.runner}: the DONE email does not lead with the force.`);
  if (!/NOT PUBLISH-READY/.test(f.runner)) bad.push(`${FILES.runner}: the plan email does not say at the top that the change is not publish-ready.`);
  if (!/publish_ready/.test(f.prompt)) bad.push(`${FILES.prompt}: the PLAN section does not ask for publish_ready.`);
  // The post-land step (21 Sep 2026): only a step the instruction or the plan named, after ~/bin/land,
  // reported as post_land; a failed step is a named stop and the DONE email carries the proof.
  if (!/post_land/.test(f.prompt) || !/Only a step the instruction or the plan named/.test(f.prompt)) bad.push(`${FILES.prompt}: the LAND section does not bound the post-land step to what she or the plan named.`);
  if (!/POST_LAND_STEP_FAILED/.test(f.runner) || !/POST-LAND STEP/.test(f.runner)) bad.push(`${FILES.runner}: a failed post-land step is not a named stop, or the DONE email does not carry its proof.`);
  // A failed post-land step is the EMPLOYEE'S rework before it is ever the owner's email (21 Sep 2026,
  // rc_m32h8ze2a4hk37pc): the runner posts /rework and stops to the owner only past MAX_REWORKS; the
  // Worker has the route and reads the same number; the BUILD prompt is briefed with the failure.
  if (!/MAX_REWORKS/.test(f.runner) || !/\/rework`/.test(f.runner)) bad.push(`${FILES.runner}: a failed post-land step goes to the owner instead of back to build as the employee's rework (MAX_REWORKS, /rework).`);
  if (!/"\/:id\/rework"/.test(f.routes) || !/rework_count/.test(f.routes) || !/MAX_REWORKS/.test(f.routes)) bad.push(`${FILES.routes}: no /rework route bounded by the shared MAX_REWORKS.`);
  if (!/\{\{REWORK\}\}/.test(f.prompt)) bad.push(`${FILES.prompt}: the BUILD phase is not briefed with the failed post-land step it is fixing ({{REWORK}}).`);
  if (!/RUNBOOK_FORBIDS/.test(f.prompt)) bad.push(`${FILES.prompt}: the prompt no longer blocks on a runbook rule that forbids the instruction.`);
  // A post-land step is a RECORDED COMMAND (21 Sep 2026, rc_m32h8ze2a4hk37pc): resolved or refused at
  // PLAN time, checked against the record at LAND time; the plan endpoint stores it.
  if (!/POST_LAND_STEP_UNRESOLVED/.test(f.runner)) bad.push(`${FILES.runner}: a plan that names a post-land step and resolves no command is not refused before the build.`);
  if (!/POST_LAND_STEP_NOT_RUN/.test(f.runner) || !/row\.post_land_command/.test(f.runner)) bad.push(`${FILES.runner}: the LAND phase does not check the post-land step against the recorded command.`);
  if (!/post_land_command = \?/.test(f.routes)) bad.push(`${FILES.routes}: the plan endpoint does not record post_land_command.`);
  if (!/post_land_step/.test(f.prompt)) bad.push(`${FILES.prompt}: the PLAN section does not ask for post_land_step as a command.`);
  // The lane builds in its own worktree (21 Sep 2026, rc_m32h946mv0eybxhj): a dirty main checkout is
  // never her problem, so the uncommitted-changes stop is gone and the runner makes the worktree.
  if (/fail\(row, "REPO_HAS_UNCOMMITTED_CHANGES"/.test(f.runner)) bad.push(`${FILES.runner}: the REPO_HAS_UNCOMMITTED_CHANGES stop is back — the lane builds in its own worktree; a dirty main checkout is not a reason to stop.`);
  if (!/['"]worktree['"], ['"]add['"]/.test(f.runner) || !/symlinkSync\(nm/.test(f.runner)) bad.push(`${FILES.runner}: the BUILD phase does not run in a runner-made worktree off origin/main with node_modules symlinked.`);
  // A recoverable stop resumes itself (21 Sep 2026: a finished build with #103 open and green died on
  // max turns with a five-line log): state is read from the worktree/gh, the same phase continues up to
  // MAX_CONTINUATIONS times, a build whose PR exists gets its result synthesised, the log carries the transcript.
  if (!/export const MAX_CONTINUATIONS = 3/.test(f.runner) || !/function stateBehind\(/.test(f.runner) || !/continuation \$\{c\.count \+ 1\}/.test(f.runner)) bad.push(`${FILES.runner}: a phase that dies with state behind it is not continued (MAX_CONTINUATIONS / stateBehind).`);
  if (!/build\.json synthesised from state/.test(f.runner)) bad.push(`${FILES.runner}: a build whose PR already exists is not given its result from GitHub's state.`);
  if (!/"--output-format", "stream-json", "--verbose"/.test(f.runner) || !/export function transcriptLines/.test(f.runner)) bad.push(`${FILES.runner}: the phase log does not carry claude's transcript.`);
  if (!/PHASE_STUCK/.test(f.runner) || !/What you can do:/.test(f.runner)) bad.push(`${FILES.runner}: the stop for the truly stuck does not say what she can do.`);
  if (!/write `\{\{OUT_FILE\}\}` the moment the PR exists/.test(f.prompt) || !/\{\{CONTINUATION\}\}/.test(f.prompt) || !/plan-draft\.md/.test(f.prompt)) bad.push(`${FILES.prompt}: the result file is not written as things happen, or the continuation note is not handed to the model.`);
  // A retry resumes at the phase it stopped in (resumePhase), never at plan when her approval is on the record.
  if (!/export function resumePhase/.test(f.answer) || !/const phase = resumePhase\(row\)/.test(f.answer)) bad.push(`${FILES.answer}: retryRow() does not resume at the phase the row stopped in — a build stop would re-plan and re-ask.`);
  // J. pre-approval has one writer, at intake, below the refusal; never in the answer path.
  const preWriters = (f.src.match(/pre_approved_phrase, pre_approved_by, force_phrase/g) ?? []).length;
  if (preWriters !== 1) bad.push(`pre_approved_phrase is inserted in ${preWriters} place(s) across src/worker/boss; it must be exactly one — the repo_changes INSERT in tasks/admit.ts.`);
  if (/pre_approved_phrase\s*=/.test(f.src) || /pre_approved_by\s*=/.test(f.src)) bad.push("pre_approved_phrase / pre_approved_by is UPDATEd somewhere; it is written once at intake and never again.");
  if (/pre_approved_(?:phrase|by)\s*=\s*\?/.test(f.answer)) bad.push(`${FILES.answer}: the answer path writes pre-approval — a later message must never pre-approve.`);
  if (!/'repo_change_pre_approved'[\s\S]{0,400}\bphrase: change\.pre_approved_phrase/.test(f.admit)) bad.push("tasks/admit.ts: the pre-approval finding does not name the phrase.");
  if (!/A pre-approved plan may not ask/.test(f.routes)) bad.push(`${FILES.routes}: the plan route accepts a pre-approved plan that still asks.`);
  if (!/pre-approved in the request/.test(f.routes)) bad.push(`${FILES.routes}: a pre-approved plan is not filed as approved by her (plan_approved_by).`);
  if (!/you pre-approved this/.test(f.runner) || !/Reply \\?`stop\\?` within the build/.test(f.runner)) bad.push(`${FILES.runner}: the FYI email does not say she pre-approved it and how to stop it.`);
  // K. no spawn of the CLI inherits the vault's environment
  for (const [name, src] of [["runner", f.runner], ["credential-check", f.credcheck ?? ""], ["interest-extract", f.extract ?? ""]]) {
    if (/spawn(?:Sync)?\(\s*(?:CLAUDE|claude|"claude"|'claude')[\s\S]{0,400}?env:\s*(?:process\.env|\{\s*\.\.\.process\.env\s*\})/.test(code(src))) bad.push(`${name}: spawns claude with process.env — under vault:run that hands the CLI ANTHROPIC_API_KEY and it drops her seat.`);
    if (src && /spawn(?:Sync)?\(\s*(?:CLAUDE|claude|"claude"|'claude')/.test(code(src)) && !/seatEnv\(process\.env\)/.test(code(src))) bad.push(`${name}: spawns claude without seatEnv(process.env).`);
  }
  // A retry is a resume: one retry writer (retryRow), used by the route and by the reply on a failed
  // row; it never touches instruction-of-record fields it did not come to change (pre-approval, repo, folder).
  if (!/export async function retryRow/.test(f.answer) || !/phase === "failed"[\s\S]{0,900}retryRow\(/.test(f.answer)) bad.push(`${FILES.answer}: a reply on a failed change does not retry it through retryRow() — a fresh row from the reply's words is the 21 Sep defect.`);
  if (!/retryRow\(/.test(f.routes)) bad.push(`${FILES.routes}: the retry route does not use retryRow().`);
  const retryFn = (() => { const a = f.answer.indexOf("export async function retryRow"); const b = f.answer.indexOf("export async function", a + 10); return a === -1 ? "" : f.answer.slice(a, b === -1 ? undefined : b); })();
  for (const col of ["pre_approved_phrase", "pre_approved_by", "force_phrase", "repo =", "drive_folder", "mail_id ="]) {
    if (new RegExp(`\\b${col.replace(" =", "\\s*=")}\\s*=\\s*(?:\\?|NULL)`).test(retryFn)) bad.push(`${FILES.answer}: retryRow() rewrites ${col.replace(" =", "")} — a retry keeps her original instruction of record.`);
  }
  if (!/changeFromReplyChain\(/.test(f.answer) || !/replyChain/.test(f.mail)) bad.push("a reply with no token is not matched to its change through the References chain.");
  if (!/never a new one/.test(f.test)) bad.push(`${FILES.test}: no test proves a retry is a resume (a "try again" on the original thread keeps the row and its pre-approval).`);
  for (const proof of ["PATH 1", "PATH 3", "THE FORCE", "A STRANGER'S FORCE", "PRE-APPROVED + READY", "PRE-APPROVED + NOT READY", "PRE-APPROVED + FORCED", "A STRANGER'S PRE-APPROVAL"]) {
    if (!f.test.includes(proof)) bad.push(`${FILES.test}: no test named "${proof}…" — the preview/force paths are not proven.`);
  }

  // E. nothing lands outside ~/bin/land
  for (const [name, src] of [["executor", f.executor], ["runner", f.runner]]) {
    for (const re of FORBIDDEN) if (re.test(code(src))) bad.push(`${FILES[name]}: contains ${re} in code — the lane lands through ~/bin/land and nothing else.`);
  }
  const landSection = f.prompt.split(/^## PHASE: /m).find((s) => s.startsWith("LAND")) ?? "";
  if (!landSection.includes("{{LAND}}")) bad.push(`${FILES.prompt}: the LAND section does not name {{LAND}} (~/bin/land).`);
  for (const line of f.prompt.split("\n")) {
    if (FORBIDDEN.some((re) => re.test(line)) && !/\b(never|not|no)\b/i.test(line)) bad.push(`${FILES.prompt}: "${line.trim().slice(0, 80)}" names a merge/deploy verb without forbidding it.`);
  }

  // F. the Ahrefs pin is not loosened
  if (!/ahrefs-audit-fix\.sh/.test(f.ahrefs)) bad.push(`${FILES.ahrefs}: no longer targets ahrefs-audit-fix.sh.`);
  if (!/gh\\s\+pr\\s\+merge/.test(f.ahrefs)) bad.push(`${FILES.ahrefs}: no longer forbids gh pr merge in the Ahrefs fixer — that pin must not be loosened for land-on-green.`);
  if (/repo-change/.test(code(f.ahrefs))) bad.push(`${FILES.ahrefs}: mentions the repo-change lane in code; the two lanes have different rules and separate validators.`);

  // G. rule 0 and the caps
  if (!/NOTHING_CLAIMABLE\s*=\s*7/.test(f.runner) || !/process\.exit\(NOTHING_CLAIMABLE\)/.test(f.runner)) bad.push(`${FILES.runner}: a quiet tick must exit NOTHING_CLAIMABLE (7), never 0.`);
  if (!/NAMED STOP \[NOTHING_CLAIMABLE\]/.test(f.runner)) bad.push(`${FILES.runner}: the quiet tick is not a NAMED STOP.`);
  if (!/NOTHING_CLAIMABLE/.test(f.executor)) bad.push(`${FILES.executor}: does not map the runner's NOTHING_CLAIMABLE exit to a named line.`);
  if (!/--max-turns/.test(f.runner)) bad.push(`${FILES.runner}: claude -p runs without --max-turns.`);
  if (!/PHASE_MODELS/.test(f.runner)) bad.push(`${FILES.runner}: does not read PHASE_MODELS; the model per phase must come from the shared module.`);
  if (/claude-(?:opus|sonnet|haiku)/.test(code(f.runner)) || /claude-(?:opus|sonnet|haiku)/.test(code(f.executor))) bad.push("a model id is typed into the executor or the runner; PHASE_MODELS in lane.mjs is the one place.");
  if (!/PHASE_MODELS\s*=\s*\{[\s\S]*?plan:[\s\S]*?build:[\s\S]*?land:[\s\S]*?\}/.test(f.lane)) bad.push(`${FILES.lane}: PHASE_MODELS does not name plan, build and land.`);
  if (!/caffeinate/.test(code(f.executor))) bad.push(`${FILES.executor}: does not run under caffeinate; a 90-minute build dies with the lid.`);
  if (!/timeout/i.test(code(f.executor))) bad.push(`${FILES.executor}: has no hard wall-clock cap.`);
  return bad;
}

// ─── The scan ─────────────────────────────────────────────────────────────────

async function scan() {
  const { readdirSync } = await import("node:fs");
  const f = {};
  for (const [k, p] of Object.entries(FILES)) if (p) f[k] = read(p);
  const migrations = readdirSync(join(ROOT, "migrations")).filter((x) => x.endsWith(".sql")).sort();
  f.migrations = migrations.map((m) => read(`migrations/${m}`)).join("\n");
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : []);
  f.src = walk("src/worker/boss").map((p) => read(p)).join("\n");
  const lane = { ...(await import(join(ROOT, FILES.lane))), __seat: await import(join(ROOT, "scripts/ops/lib/seat-env.mjs")).catch(() => null) };
  const guards = guardProblems(lane);
  // Every `bad.push(` inside fileProblems is one guard case; counted from the source so the number
  // printed can never drift from the checks that ran (it was a literal that said 69 while 78 ran).
  const fileGuardCount = (String(fileProblems).match(/bad\.push\(/g) ?? []).length;
  return { problems: [...guards.problems, ...fileProblems(f)], cases: guards.cases + fileGuardCount, files: Object.keys(f).length };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function lane_readReply_stub(t) {
  const n = String(t).toLowerCase().replace(/[.!]+$/, "");
  if (["approved", "yes", "go", "land it"].includes(n)) return { mode: "approved" };
  if (["preview", "preview only", "preview first"].includes(n)) return { mode: "preview" };
  if (["approved to production", "force production", "ship it anyway", "land anyway"].includes(n)) return { mode: "forced" };
  if (n === "" ) return { mode: "empty" };
  if (/^(no|not approved|stop|changes:)/.test(n)) return { mode: "held" };
  return { mode: "answers" };
}

function selfTest() {
  let failed = 0; let ran = 0;
  const expect = (name, ok) => { ran += 1; if (!ok) { console.error(`  ✗ ${name}`); failed += 1; } };

  // A. a guard that forgot the green must be caught by running it.
  const seatOk = { seatEnv: (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !/^ANTHROPIC_|OAUTH_TOKEN/.test(k))) };
  const loose = { __seat: seatOk, readReply: lane_readReply_stub, preApprovalIn: (t) => /your call|you decide|no need to ask|just do it|pick everything|no options/.exec(String(t).toLowerCase())?.[0] ?? null, canEnterBuild: () => ({ ok: true }), canLand: (r) => ({ ok: Boolean(r?.pr_url) }), claimablePhase: (r) => (r?.phase === "plan" ? "plan" : r?.phase === "build" ? "build" : r?.phase === "land" ? "land" : null) };
  expect("a canLand that ignores the green is caught", guardProblems(loose).problems.some((p) => p.includes("no green")));
  expect("a canEnterBuild that ignores the answer is caught", guardProblems(loose).problems.some((p) => p.includes("no answer")));

  // B–G over a fixture set that passes, then one break per rule.
  const good = {
    lane: "export const PHASE_MODELS = { plan: 'a', build: 'b', land: 'c' };",
    routes: 'repoChanges.post("/:id/rework", async (c) => { rework_count MAX_REWORKS }); retryRow(c.env, row, {}); db(`UPDATE repo_changes SET post_land_command = ? WHERE id = ?`); const phase = claimablePhase(row); const gate = canLand(row); if (typeof b?.publish_ready !== "boolean") throw x; if (pre && asks.length) throw badRequest("A pre-approved plan may not ask"); const approvedBy = "x (pre-approved in the request)"; const next = needsPreview(row) && !isForced(row) ? "preview" : "landing"; preview_message_id; if (state === "green") { db(`UPDATE repo_changes SET checks_green_at = ? WHERE id = ?`) }',
    admit: "INSERT INTO repo_changes (…, pre_approved_phrase, pre_approved_by, force_phrase, …) VALUES; 'repo_change_pre_approved' { phrase: change.pre_approved_phrase }",
    mail: "if (!authorised) { return refused; }\nconst replyChain = [];\nconst planAnswer = await answerFromMail(env, { replyChain });\nadmitTask(env, {});",
    answer: "export async function retryRow(env, row) { const phase = resumePhase(row); db(`UPDATE repo_changes SET phase = ?, failure = NULL WHERE id = ?`) }\nexport function resumePhase(row) { return 'plan'; }\nexport async function changeFromReplyChain() {}\nif (row.phase === \"failed\") { await retryRow(env, row, {}); }\nasync function recordForce() { db(`UPDATE repo_changes SET forced_by = ? WHERE id = ?`); taskEvent('repo_change_forced') }\nif (reply.mode === \"forced\") { await recordForce(); }\nif (reply.mode === \"preview\") { note(); }\nconst reply = readReply(text); if (reply.mode === \"held\") { db(`UPDATE repo_changes SET held_at = ? WHERE id = ?`) }\nUPDATE repo_changes SET phase = 'build', answered_at = ? WHERE id = ? AND phase = 'asking'",
    executor: "NOTHING_CLAIMABLE=7\ncaffeinate timeout 3h node repo-change.mjs\ncase $RC in $NOTHING_CLAIMABLE) say quiet ;; esac",
    runner: "import { PHASE_MODELS, canEnterBuild, canLand } from '../../src/shared/boss/repoChange/lane.mjs';\nconst line = `My recommended default: ${a.default}`; const word = 'reply approved'; const top = 'NOT PUBLISH-READY'; const done = 'Landed to production with'; const pl = 'POST-LAND STEP'; const plf = 'POST_LAND_STEP_FAILED'; const mr = MAX_REWORKS; await api(`/${row.id}/rework`, {}); const fyi = 'you pre-approved this'; const stop = 'Reply `stop` within the build';\nconst NOTHING_CLAIMABLE = 7; export const MAX_CONTINUATIONS = 3; function stateBehind() {} export function transcriptLines() {} const cont = 'continuation ${c.count + 1}'; const syn = 'build.json synthesised from state'; const stuck = 'PHASE_STUCK'; const wyc = 'What you can do:'; spawn('claude', ['-p', prompt, \"--output-format\", \"stream-json\", \"--verbose\"]); const plu = 'POST_LAND_STEP_UNRESOLVED'; const pln = 'POST_LAND_STEP_NOT_RUN'; const w = row.post_land_command; spawnSync('git', ['worktree', 'add', wt]); symlinkSync(nm, x);\nif (!canEnterBuild(row).ok) return; if (!canLand(row).ok) return;\nspawn('claude', ['-p', prompt, '--model', PHASE_MODELS[phase], '--max-turns', '5'], { env: seatEnv(process.env) });\nconsole.error('NAMED STOP [NOTHING_CLAIMABLE] nothing'); process.exit(NOTHING_CLAIMABLE);",
    prompt: "RUNBOOK_FORBIDS\nContinuation: {{CONTINUATION}}\n- Rework: {{REWORK}}\n## PHASE: PLAN\nplan with a \"default\" per ask and publish_ready and post_land_step; plan-draft.md\n## PHASE: BUILD\nwrite `{{OUT_FILE}}` the moment the PR exists\n## PHASE: BUILD\nNever `gh pr merge`.\n## PHASE: LAND\nrun {{LAND}} {{PR_NUMBER}}; Only a step the instruction or the plan named goes under post_land",
    test: 'it("SCOOTER CANNOT USE THIS LANE", async () => { expect(res.outcome).toBe("REFUSED_SENDER"); });\nit("a reply of exactly \\"approved\\" advances", () => {});\nit("\\"no\\" HOLDS the task", () => {});\nit("PATH 1", () => {}); it("PATH 3", () => {}); it("THE FORCE", () => {}); it("A STRANGER\'S FORCE", () => {}); it("PRE-APPROVED + READY"); it("PRE-APPROVED + NOT READY"); it("PRE-APPROVED + FORCED"); it("A STRANGER\'S PRE-APPROVAL"); describe("a retry is a resume of her original instruction, never a new one");',
    ahrefs: 'const RUNNER = "scripts/ops/ahrefs-audit-fix.sh";\nfor (const forbidden of [/\\bgh\\s+pr\\s+merge\\b/]) {}',
    migrations: "CREATE TABLE repo_changes (checks_green_at INTEGER)",
    src: "UPDATE repo_changes SET checks_green_at = ? WHERE\nUPDATE repo_changes SET forced_by = ? WHERE\nINSERT INTO repo_changes (pre_approved_phrase, pre_approved_by, force_phrase)",
  };
  expect(`a complete lane passes: ${fileProblems(good).join(" | ")}`, fileProblems(good).length === 0);
  expect("a second writer of checks_green_at is caught", fileProblems({ ...good, src: good.src + "\nUPDATE repo_changes SET checks_green_at = ? WHERE phase" }).length > 0);
  expect("a green set outside the green branch is caught", fileProblems({ ...good, routes: 'claimablePhase(row); canLand(row); db(`SET checks_green_at = ?`); if (state === "green") {}' }).length > 0);
  expect("answerFromMail above the refusal is caught", fileProblems({ ...good, mail: "const planAnswer = await answerFromMail(env, {});\nif (!authorised) { return refused; }\nadmitTask(env, {});" }).some((p) => p.includes("BEFORE the sender refusal")));
  expect("a runner that learned gh pr merge is caught", fileProblems({ ...good, runner: good.runner + "\nspawnSync('gh', ['pr', 'merge'])" }).some((p) => p.includes("gh pr merge") || p.includes("lands through")));
  expect("a runner with a literal gh pr merge string is caught", fileProblems({ ...good, runner: good.runner + "\nrun('gh pr merge 1')" }).some((p) => p.includes("lands through")));
  expect("a LAND section without ~/bin/land is caught", fileProblems({ ...good, prompt: good.prompt.replace("{{LAND}}", "gh pr merge") }).length > 0);
  expect("a quiet tick that exits 0 is caught", fileProblems({ ...good, runner: good.runner.replace("process.exit(NOTHING_CLAIMABLE)", "process.exit(0)") }).some((p) => p.includes("never 0")));
  expect("a typed model id is caught", fileProblems({ ...good, runner: good.runner.replace("PHASE_MODELS[phase]", "'claude-opus-5'") }).some((p) => p.includes("one place")));
  expect("a missing --max-turns is caught", fileProblems({ ...good, runner: good.runner.replace("'--max-turns', '5'", "") }).some((p) => p.includes("--max-turns")));
  expect("the Ahrefs pin loosened is caught", fileProblems({ ...good, ahrefs: 'const RUNNER = "scripts/ops/ahrefs-audit-fix.sh";' }).some((p) => p.includes("must not be loosened")));
  expect("a test that stopped refusing Scooter is caught", fileProblems({ ...good, test: "it('x', () => {})" }).some((p) => p.includes("Scooter")));
  expect("no caffeinate is caught", fileProblems({ ...good, executor: good.executor.replace("caffeinate ", "") }).some((p) => p.includes("caffeinate")));
  expect("a hold that counts as an approval is caught", fileProblems({ ...good, answer: good.answer.replace("SET held_at = ?", "SET held_at = ?, answered_at = ?") }).some((p) => p.includes("must not count as an approval")));
  expect("an answer path that skips readReply is caught", fileProblems({ ...good, answer: good.answer.replace("readReply(text)", "text") }).some((p) => p.includes("readReply")));
  expect("a reader that approves 'no' is caught", guardProblems({ ...loose, readReply: () => ({ mode: "approved" }) }).problems.some((p) => p.includes('readReply("no")')));
  expect("a test file without the one-word proofs is caught", fileProblems({ ...good, test: good.test.split("\n")[0] }).some((p) => p.includes('exactly "approved"')));
  // I. the preview gate and the force
  const noGate = { ...loose, readReply: lane_readReply_stub, canLand: (r) => ({ ok: Boolean(r?.pr_url && r?.checks_green_at && r?.answered_at) }) };
  expect("a canLand that lands a not-ready row without the second approval is caught", guardProblems(noGate).problems.some((p) => p.includes("preview gate not ready, green, approved, no preview")));
  expect("a canLand that accepts the approval before the preview email is caught", guardProblems({ ...noGate, canLand: (r) => ({ ok: Boolean(r?.pr_url && r?.checks_green_at && r?.answered_at && (r?.land_approved_at || r?.forced_at || r?.publish_ready === 1) && !r?.preview_forced) }) }).problems.some((p) => p.includes("BEFORE the preview email")));
  expect("a readReply that forces on plain approved is caught", guardProblems({ ...loose, readReply: (t) => ({ mode: t === "approved" ? "forced" : lane_readReply_stub(t).mode }) }).problems.some((p) => p.includes('readReply("approved")')));
  expect("a second writer of forced_by is caught", fileProblems({ ...good, src: good.src + "\nUPDATE repo_changes SET forced_by = ? WHERE phase" }).some((p) => p.includes("forced_by is assigned")));
  expect("a preview reply that sets the land approval is caught", fileProblems({ ...good, answer: good.answer.replace('if (reply.mode === "preview") { note(); }', 'if (reply.mode === "preview") { db(`SET land_approved_at = ?`); }') }).some((p) => p.includes("must set neither")));
  expect("a plan route without publish_ready is caught", fileProblems({ ...good, routes: good.routes.replace('if (typeof b?.publish_ready !== "boolean") throw x; ', "") }).some((p) => p.includes("publish_ready")));
  // J. pre-approval
  expect("an answer path that pre-approves is caught", fileProblems({ ...good, answer: good.answer + "\nSET pre_approved_phrase = ?" }).some((p) => p.includes("later message must never pre-approve")));
  expect("a second pre-approval writer is caught", fileProblems({ ...good, src: good.src + "\nINSERT INTO repo_changes (pre_approved_phrase, pre_approved_by, force_phrase)" }).some((p) => p.includes("exactly one")));
  expect("a plan route that lets a pre-approved plan ask is caught", fileProblems({ ...good, routes: good.routes.replace('if (pre && asks.length) throw badRequest("A pre-approved plan may not ask"); ', "") }).some((p) => p.includes("still asks")));
  expect("a preApprovalIn that misses a phrase is caught", guardProblems({ ...loose, preApprovalIn: () => null }).problems.some((p) => p.includes('preApprovalIn("your call')));
  expect("a canLand that lands a pre-approved not-ready row is caught", guardProblems({ ...loose, preApprovalIn: (t) => /your call|you decide|no need to ask|just do it|pick everything|no options/.exec(String(t).toLowerCase())?.[0] ?? null, canLand: (r) => ({ ok: Boolean(r?.pr_url && r?.checks_green_at && (r?.answered_at || r?.plan_approved_by)) }) }).problems.some((p) => p.includes("pre-approved NOT-ready row lands")));
  expect("a finding that drops the phrase is caught", fileProblems({ ...good, admit: good.admit.replace("{ phrase: change.pre_approved_phrase }", "{ by }") }).some((p) => p.includes("does not name the phrase")));
  // K. the seat
  expect("a runner that spawns claude with process.env is caught", fileProblems({ ...good, runner: good.runner.replace("{ env: seatEnv(process.env) }", "{ env: process.env }") }).some((p) => p.includes("drops her seat")));
  expect("a runner that spawns claude with no seatEnv is caught", fileProblems({ ...good, runner: good.runner.replace(", { env: seatEnv(process.env) }", "") }).some((p) => p.includes("without seatEnv")));
  expect("a seatEnv that leaks the key is caught", guardProblems({ ...loose, __seat: { seatEnv: (e) => ({ ...e }) } }).problems.some((p) => p.includes("leaves ANTHROPIC_API_KEY")));
  expect("a seatEnv that strips PATH is caught", guardProblems({ ...loose, __seat: { seatEnv: () => ({}) } }).problems.some((p) => p.includes("strips PATH")));
  expect("a retry that rewrites the pre-approval is caught", fileProblems({ ...good, answer: good.answer.replace("failure = NULL WHERE", "failure = NULL, pre_approved_phrase = NULL WHERE") }).some((p) => p.includes("keeps her original instruction of record")));
  expect("a failed-row reply that does not retry is caught", fileProblems({ ...good, answer: good.answer.replace('if (row.phase === "failed") { await retryRow(env, row, {}); }', "") }).some((p) => p.includes("fresh row from the reply")));
  expect("a failed post-land step that stops to the owner instead of reworking is caught", fileProblems({ ...good, runner: good.runner.replace("MAX_REWORKS", "X").replace("/rework`", "/failed`") }).some((p) => p.includes("employee's rework")));
  expect("a Worker without the /rework route is caught", fileProblems({ ...good, routes: good.routes.replace('"/:id/rework"', '"/:id/x"') }).some((p) => p.includes("/rework route")));
  expect("a BUILD prompt not briefed with the failed step is caught", fileProblems({ ...good, prompt: good.prompt.replace("{{REWORK}}", "") }).some((p) => p.includes("{{REWORK}}")));
  expect("a runner that stops instead of continuing is caught", fileProblems({ ...good, runner: good.runner.replace("export const MAX_CONTINUATIONS = 3", "const x = 0") }).some((p) => p.includes("not continued")));
  expect("a log without the transcript is caught", fileProblems({ ...good, runner: good.runner.replace('"--output-format", "stream-json", "--verbose"', "") }).some((p) => p.includes("transcript")));
  expect("the dirty-checkout stop coming back is caught", fileProblems({ ...good, runner: good.runner + '\nfail(row, "REPO_HAS_UNCOMMITTED_CHANGES", "x");' }).some((p) => p.includes("REPO_HAS_UNCOMMITTED_CHANGES")));
  expect("a runner that builds outside a worktree is caught", fileProblems({ ...good, runner: good.runner.replace("'worktree', 'add'", "'checkout', '-b'") }).some((p) => p.includes("worktree")));
  expect("a plan that names a step without a command not being refused is caught", fileProblems({ ...good, runner: good.runner.replace("POST_LAND_STEP_UNRESOLVED", "X") }).some((p) => p.includes("resolves no command")));
  expect("a retry that always re-plans is caught", fileProblems({ ...good, answer: good.answer.replace("const phase = resumePhase(row)", "const phase = 'plan'") }).some((p) => p.includes("resume at the phase")));
  expect("a LAND section with an unbounded post-land step is caught", fileProblems({ ...good, prompt: good.prompt.replace("Only a step the instruction or the plan named", "any step") }).some((p) => p.includes("post-land step")));
  expect("a build route that skips the preview is caught", fileProblems({ ...good, routes: good.routes.replace('needsPreview(row) && !isForced(row) ? "preview" : "landing"', '"landing"') }).some((p) => p.includes("preview step")));

  if (failed) { console.error(`\nSELF-TEST FAILED: ${failed} case(s)`); process.exit(1); }
  console.log(`SELF-TEST PASSED: ${ran}/${ran} cases.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }

const { problems, cases, files } = await scan();
if (cases === 0 || files === 0) { console.error("REPO LANE SCAN EXAMINED NOTHING. That is a broken scan, not a clean repo."); process.exit(2); }
if (problems.length) {
  console.error("REPO LANE SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error("Land on green rests on two recorded facts and one refusal. Put them back.");
  process.exit(1);
}
console.log(`REPO LANE SCAN PASSED: ${cases} guard cases run, ${files} files read — no BUILD without her reply, no LAND without a recorded green and her reply, the approval is hers alone, nothing lands outside ~/bin/land, the Ahrefs pin stands.`);
