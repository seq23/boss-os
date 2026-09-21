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
  const full = { phase: "land", plan_text: "# plan", answered_at: 1, answers_text: "go", pr_url: "https://x/pull/1", pr_number: 1, checks_green_at: 2 };
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
  return { problems: bad, cases: cases.length + 5 + replies.length };
}

// ─── B–G. The files, read ─────────────────────────────────────────────────────

export function fileProblems(f) {
  const bad = [];
  for (const k of ["lane", "routes", "mail", "answer", "executor", "runner", "prompt", "test", "ahrefs"]) {
    if (f[k] === null || f[k] === undefined) bad.push(`${FILES[k] ?? k} does not exist.`);
  }
  if (bad.length) return bad;

  // B. the guards are what hand out work
  if (!/claimablePhase\s*\(/.test(f.routes)) bad.push(`${FILES.routes}: the claim route does not call claimablePhase(); the guard is not the thing handing out work.`);
  if (!/canLand\s*\(/.test(f.routes)) bad.push(`${FILES.routes}: the land report does not call canLand().`);
  if (!/canEnterBuild\s*\(/.test(f.runner) || !/canLand\s*\(/.test(f.runner)) bad.push(`${FILES.runner}: the runner does not check canEnterBuild()/canLand() itself before running a phase.`);

  // C. the green has one writer
  const writers = (f.src.match(/checks_green_at\s*=\s*\?/g) ?? []).length;
  if (writers !== 1) bad.push(`checks_green_at is assigned in ${writers} place(s) across src/worker/boss; it must be exactly one — the /checks route on a green.`);
  const greenBranch = /state === "green"[\s\S]{0,600}checks_green_at = \?/.test(f.routes);
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
  const lane = await import(join(ROOT, FILES.lane));
  const guards = guardProblems(lane);
  return { problems: [...guards.problems, ...fileProblems(f)], cases: guards.cases, files: Object.keys(f).length };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const expect = (name, ok) => { if (!ok) { console.error(`  ✗ ${name}`); failed += 1; } };

  // A. a guard that forgot the green must be caught by running it.
  const loose = { canEnterBuild: () => ({ ok: true }), canLand: (r) => ({ ok: Boolean(r?.pr_url) }), claimablePhase: (r) => (r?.phase === "plan" ? "plan" : r?.phase === "build" ? "build" : r?.phase === "land" ? "land" : null) };
  expect("a canLand that ignores the green is caught", guardProblems(loose).problems.some((p) => p.includes("no green")));
  expect("a canEnterBuild that ignores the answer is caught", guardProblems(loose).problems.some((p) => p.includes("no answer")));

  // B–G over a fixture set that passes, then one break per rule.
  const good = {
    lane: "export const PHASE_MODELS = { plan: 'a', build: 'b', land: 'c' };",
    routes: 'const phase = claimablePhase(row); const gate = canLand(row); if (state === "green") { db(`UPDATE repo_changes SET checks_green_at = ? WHERE id = ?`) }',
    mail: "if (!authorised) { return refused; }\nconst planAnswer = await answerFromMail(env, {});\nadmitTask(env, {});",
    answer: "const reply = readReply(text); if (reply.mode === \"held\") { db(`UPDATE repo_changes SET held_at = ? WHERE id = ?`) }\nUPDATE repo_changes SET phase = 'build', answered_at = ? WHERE id = ? AND phase = 'asking'",
    executor: "NOTHING_CLAIMABLE=7\ncaffeinate timeout 3h node repo-change.mjs\ncase $RC in $NOTHING_CLAIMABLE) say quiet ;; esac",
    runner: "import { PHASE_MODELS, canEnterBuild, canLand } from '../../src/shared/boss/repoChange/lane.mjs';\nconst line = `My recommended default: ${a.default}`; const word = 'reply approved';\nconst NOTHING_CLAIMABLE = 7;\nif (!canEnterBuild(row).ok) return; if (!canLand(row).ok) return;\nspawn('claude', ['-p', prompt, '--model', PHASE_MODELS[phase], '--max-turns', '5']);\nconsole.error('NAMED STOP [NOTHING_CLAIMABLE] nothing'); process.exit(NOTHING_CLAIMABLE);",
    prompt: "## PHASE: PLAN\nplan with a \"default\" per ask\n## PHASE: BUILD\nNever `gh pr merge`.\n## PHASE: LAND\nrun {{LAND}} {{PR_NUMBER}}",
    test: 'it("SCOOTER CANNOT USE THIS LANE", async () => { expect(res.outcome).toBe("REFUSED_SENDER"); });\nit("a reply of exactly \\"approved\\" advances", () => {});\nit("\\"no\\" HOLDS the task", () => {});',
    ahrefs: 'const RUNNER = "scripts/ops/ahrefs-audit-fix.sh";\nfor (const forbidden of [/\\bgh\\s+pr\\s+merge\\b/]) {}',
    migrations: "CREATE TABLE repo_changes (checks_green_at INTEGER)",
    src: "UPDATE repo_changes SET checks_green_at = ? WHERE",
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

  if (failed) { console.error(`\nSELF-TEST FAILED: ${failed} case(s)`); process.exit(1); }
  console.log("SELF-TEST PASSED: 20/20 cases.");
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
