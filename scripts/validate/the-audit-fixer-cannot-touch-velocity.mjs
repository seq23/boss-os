#!/usr/bin/env node
/**
 * THE AUDIT FIXER IS REAL, IT BELONGS TO SOMEBODY, AND IT CANNOT TOUCH THE ONE REPO IT MAY NOT.
 *
 * ─── What this guards ───────────────────────────────────────────────────────
 *
 * Owner, 10 September 2026: "i need an employee in Boss OS to search my seq.taylor@gmail.com for any
 * ahref audit reports and auto fix those too." `duty_site_audit_repair` is that employee's standing
 * work. Three separate things can quietly stop being true about it, and all three look fine:
 *
 *   1. THE DUTY STOPS BEING REACHABLE. A duty row whose executor script does not exist, or which is
 *      not in the launchd installer, is a cadence nobody performs. This repository has shipped that
 *      shape: a duty that fired eleven Sundays and dropped its payload every time.
 *   2. IT IS ASSIGNED TO A SEAT THAT IS NOT THERE. `employee_id` is a string. A retired seat, a
 *      renamed one, or a typo produces work with no owner, which is the same as no work — and the
 *      roster it points at is rebuilt by migrations, so it can go stale without anyone editing the
 *      duty.
 *   3. THE OFF-LIMITS RULE ROTS. `local-guides-citation-velocity` is under active heavy change and
 *      the fixer may not open a PR against it. That rule lives in ONE file and is enforced in three
 *      places; the failure mode is not somebody deleting it, it is somebody copying it.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * By REPLAYING EVERY MIGRATION into an in-memory SQLite database and asking the resulting schema the
 * questions the Worker asks — the method `validate:employee-tags` established. The roster and the
 * duty come out of the same migrations that ship, in order, rather than out of a regex or a fixture.
 *
 * And the off-limits rule is proven by CALLING `mayAutoFix` — the same function the route and the
 * local job call. A validator that reimplemented the rule in order to check the rule would be
 * asserting its own copy, which is the exact defect it exists to prevent.
 *
 * RULE 0: examining zero duties, zero employees or zero enforcement points is a FAILURE. Every one
 * of those is a loop that reports "no problems" over an empty set.
 *
 *   node scripts/validate/the-audit-fixer-cannot-touch-velocity.mjs
 *   node scripts/validate/the-audit-fixer-cannot-touch-velocity.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  NO_AUTO_FIX, NO_AUTO_FIX_REPOS, DISPOSITIONS, mayAutoFix, whyNoAutoFix,
} from "../../src/shared/boss/siteAudit/repoPolicy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const DUTY_ID = "duty_site_audit_repair";
const TABLE = "site_audit_findings";
const POLICY = "src/shared/boss/siteAudit/repoPolicy.mjs";
const ROUTE = "src/worker/boss/routes/siteAudit.ts";
const RUNNER = "scripts/ops/ahrefs-audit-fix.sh";
const REPORTER = "scripts/ops/ahrefs-audit-report.mjs";
const PROMPT = "scripts/ops/ahrefs-audit-fix-prompt.md";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";
const MOUNT = "src/worker/boss/index.ts";
const TODAY = "src/worker/boss/today/pillars.ts";
/** Where a duty's silence is supposed to surface: the alert list, not the day's contract. */
const ALERTS = "src/worker/boss/routes/today.ts";

/** Replay the shipped migrations and ask the resulting database about the duty and the roster. */
export function stateFromMigrations(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failed = [];
  for (const f of files) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  const duty = db.prepare(`SELECT * FROM standing_duties WHERE id = ?`).get(DUTY_ID) ?? null;
  const roster = db.prepare(
    `SELECT id, name, role, lane, status, lifecycle FROM employees
      WHERE status = 'active' AND lifecycle IN ('active','provisional')`,
  ).all();
  const table = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(TABLE) ?? null;
  const policy = db.prepare(`SELECT * FROM data_policy WHERE entity = ?`).get(TABLE) ?? null;
  return { duty, roster, table, policy, files: files.length, failed };
}

/**
 * Rule: the duty exists, is not suspended, runs on a cadence, and points at a script that is real
 * AND installed.
 */
export function dutyIsReachable(state, files) {
  const bad = [];
  const { duty } = state;
  if (!duty) return [`no duty called ${DUTY_ID} exists after every migration was replayed. The employee she asked for has no standing work.`];

  if (duty.suspended) bad.push(`${DUTY_ID} ships SUSPENDED. A duty installed switched off is a feature nobody gets.`);
  /*
   * ─── THE CADENCE IS HERS, AND THIS CHECK USED TO SAY OTHERWISE ────────────
   *
   * This asserted `cadence === "weekly"`, with the reason "Ahrefs recrawls weekly and the reports
   * arrive weekly; anything else grades a crawl that has not changed." That reasoning is sound on
   * its own terms and it is not the one that decides. Owner, 13 September 2026:
   *
   *   "fix it so danielle does this ahref sweep on a schedule (1x per month is fine)"
   *
   * She is buying back attention, and she is entitled to make that trade: a monthly pass grades four
   * weeks of accumulated reports instead of one, which means some findings are older when they are
   * fixed. That is the real cost, it is hers to accept, and stating it here is better than a
   * validator quietly overruling her because an earlier engineering preference got written down as
   * a rule. A validator that outranks the owner is not a guard, it is a disagreement with tenure.
   *
   * WHAT IS STILL CHECKED is the thing that actually rots: a cadence this system cannot schedule.
   * `duties/cadence.ts` understands daily, weekly and monthly and nothing else, and a weekly duty
   * that names no weekday fires on whatever day the scheduler defaults to.
   */
  const SCHEDULABLE = new Set(["daily", "weekly", "monthly"]);
  if (!SCHEDULABLE.has(duty.cadence)) {
    bad.push(`${DUTY_ID} has cadence '${duty.cadence}', which duties/cadence.ts cannot schedule. nextDueAt() would throw and the duty would keep a stale clock for ever.`);
  }
  if (duty.cadence === "weekly" && (duty.weekday === null || duty.weekday === undefined)) {
    bad.push(`${DUTY_ID} is weekly and names no weekday, so its next occurrence is whatever the scheduler defaults to.`);
  }
  if (duty.cadence === "monthly" && duty.weekday !== null && duty.weekday !== undefined) {
    bad.push(`${DUTY_ID} is monthly and still carries weekday ${duty.weekday}. nextDueAt() ignores weekday for a monthly cadence, so that is a fact governing nothing — which is how the next reader is misled about when this runs.`);
  }
  if (!state.table) bad.push(`no migration creates the table '${TABLE}', so the duty delivers into nothing.`);
  if (!state.policy) bad.push(`'${TABLE}' has no data_policy row. An unclassified table is refused at runtime.`);

  let input = {};
  try { input = JSON.parse(duty.task_input ?? "{}"); } catch { bad.push(`${DUTY_ID} has task_input that is not JSON.`); }

  if (input.delivers !== TABLE) {
    bad.push(`${DUTY_ID} delivers '${input.delivers ?? "nothing"}' rather than '${TABLE}', so its output lands somewhere this guard does not watch.`);
  }
  const job = input.local_job;
  if (!job) {
    bad.push(`${DUTY_ID} names no local_job. It reads her mailbox and opens PRs; there is no cloud version of that.`);
  } else {
    if (!files.runner) bad.push(`${DUTY_ID} names ${job} and scripts/ops/${job} does not exist.`);
    if (files.installer !== null && !files.installer.includes(job)) {
      bad.push(`${INSTALLER} does not name ${job}, so it is a file somebody has to remember to run rather than an installed job.`);
    }
  }
  /*
   * THE MODEL IS NAMED IN BOTH PLACES OR IN NEITHER. A duty row saying Sonnet while the shell script
   * silently runs the default is how one briefing cost $3.88.
   */
  if (input.model && files.runner !== null && !files.runner.includes(input.model)) {
    bad.push(`${DUTY_ID} names model '${input.model}' and ${RUNNER} does not, so the row and the run disagree about what it costs.`);
  }
  return bad;
}

/**
 * Rule: the seat it is assigned to is a real, active employee — and is the RIGHT KIND of seat.
 *
 * Not merely "an employee exists with that id". Ahrefs findings are site health in a repository, so
 * routing them to Relationships or to the Chief of Staff would be using the default as a decision.
 * The check is on the DEPARTMENT AND CHARTER of whoever holds the row, so renaming the person does
 * not break it and reassigning the work to the wrong desk does.
 */
export function assignedToARealSeat(state) {
  const bad = [];
  const { duty, roster } = state;
  if (!duty) return ["the duty does not exist, so its assignment cannot be checked."];
  if (roster.length === 0) {
    return ["the roster query returned zero active employees, so this check examined nothing. That is a failure, not a pass."];
  }

  const seat = roster.find((s) => s.id === duty.employee_id);
  if (!seat) {
    bad.push(
      `${DUTY_ID} is assigned to '${duty.employee_id}', who is not an active employee. `
      + `Active seats are: ${roster.map((s) => `${s.id} (${s.name}, ${s.role})`).join("; ")}.`,
    );
    return bad;
  }

  const engineering = /engineer|technical|program manager|repo|systems/i;
  if (!engineering.test(`${seat.role} ${seat.name}`)) {
    bad.push(
      `${DUTY_ID} is held by ${seat.name}, ${seat.role}. Ahrefs findings are site health in a repository. `
      + "Capital and publishing seats are the wrong desk, and the Chief of Staff is the seat that takes what nobody else can place — "
      + "routing repo work there is using the default as a decision.",
    );
  }
  if (!duty.lane) bad.push(`${DUTY_ID} has no lane, so nothing it raises can be filed.`);
  return bad;
}

/**
 * Rule: `local-guides-citation-velocity` cannot be auto-fixed — asserted on BEHAVIOUR, then on the
 * three places that behaviour has to be enforced.
 */
export function velocityCannotBeAutoFixed(files) {
  const bad = [];

  if (NO_AUTO_FIX.length === 0) return ["the off-limits list is EMPTY, so this guard would examine nothing and pass."];
  if (!NO_AUTO_FIX_REPOS.includes("local-guides-citation-velocity")) {
    bad.push("local-guides-citation-velocity is not on the off-limits list. It is under active heavy change and the fixer may not open a PR against it.");
  }
  for (const entry of NO_AUTO_FIX) {
    if (!entry.why || entry.why.length < 40) {
      bad.push(`${entry.repo} is excluded with no reason worth reading. A bare list decays into folklore nobody can tell from a stale entry.`);
    }
  }

  // BEHAVIOURAL, through the function everything else calls.
  if (mayAutoFix("local-guides-citation-velocity")) bad.push("mayAutoFix() allowed local-guides-citation-velocity.");
  if (mayAutoFix("/Users/sequoiataylor/GitHub/local-guides-citation-velocity")) {
    bad.push("mayAutoFix() allowed local-guides-citation-velocity when it arrived as a full path — and a path is the form the local job actually holds.");
  }
  if (mayAutoFix("seq23/local-guides-citation-velocity")) bad.push("mayAutoFix() allowed local-guides-citation-velocity in owner/name form.");
  if (mayAutoFix("")) bad.push("mayAutoFix() allowed an EMPTY repository name. 'I could not tell which repo this is' must never resolve to 'go ahead and commit'.");
  if (mayAutoFix(null)) bad.push("mayAutoFix() allowed a null repository name.");
  if (!mayAutoFix("WPP-llm") || !mayAutoFix("sprylabs-hpc-site")) {
    bad.push("mayAutoFix() refused a repository that IS fixable — a guard that blocks everything is a guard somebody removes.");
  }
  if (!whyNoAutoFix("local-guides-citation-velocity")) {
    bad.push("whyNoAutoFix() gives no reason for the one repository on the list, so a refusal cannot explain itself.");
  }
  if (!DISPOSITIONS.includes("off_limits") || !DISPOSITIONS.includes("none")) {
    bad.push("the disposition vocabulary cannot express 'off limits' or 'found nothing', so a refusal or an empty week has nowhere to be recorded.");
  }

  /*
   * ─── AND THE RULE IS ENFORCED WHERE IT MATTERS, NOT JUST DEFINED ──────────
   *
   * The function can be perfect while nothing calls it. "Exists but nothing invokes it" is the
   * sibling defect and this repository has shipped it more than once.
   */
  if (files.route === null) {
    bad.push(`${ROUTE} does not exist, so nothing server-side refuses a fix in a forbidden repository.`);
  } else {
    if (!files.route.includes("siteAudit/repoPolicy.mjs")) {
      bad.push(`${ROUTE} does not import the policy, so it has its own idea of what is off limits — or none.`);
    }
    if (!/\bmayAutoFix\s*\(/.test(files.route)) {
      bad.push(`${ROUTE} never calls mayAutoFix(), so a report claiming a fix in a forbidden repository would be recorded.`);
    }
    // The array's local name is the route's business; that it REFUSES an empty one is this file's.
    if (!/\b(?:rows|findings)\.length\s*===\s*0/.test(files.route)) {
      bad.push(`${ROUTE} accepts an empty findings array, which would advance the duty's clock while recording nothing — a run that reports it did nothing must not read as a healthy week.`);
    }
    if (!/searched/.test(files.route)) {
      bad.push(`${ROUTE} does not require search evidence. A bare "nothing found" is not acceptable and has been wrong in this portfolio before.`);
    }
  }

  if (files.runner === null) {
    bad.push(`${RUNNER} does not exist, so the duty names an executor that is not there.`);
  } else {
    if (!files.runner.includes("repoPolicy.mjs")) {
      bad.push(`${RUNNER} does not read the off-limits list from the shared policy — a second copy of the rule is the defect this whole design avoids.`);
    }
    /*
     * IT MERGES NOTHING. Her instruction, and the one thing an automated fixer must not learn to do:
     * a fixer that lands its own work removes the only place a person looks at what it did.
     */
    for (const forbidden of [/\bgh\s+pr\s+merge\b/, /\bgh\s+workflow\s+run\b/, /\bgit\s+push\s+(?:\S+\s+)?(?:origin\s+)?main\b/, /\bwrangler\s+deploy\b/, /npm\s+run\s+deploy/]) {
      if (forbidden.test(files.runner)) {
        bad.push(`${RUNNER} contains ${forbidden} — it opens pull requests and she merges. It never merges, deploys or dispatches a release.`);
      }
    }
  }

  if (files.reporter === null) {
    bad.push(`${REPORTER} does not exist, so the run has no way to tell Boss OS what it did.`);
  } else {
    if (!/\bmayAutoFix\s*\(/.test(files.reporter)) {
      bad.push(`${REPORTER} never checks the policy, so a forbidden fix would reach the endpoint and fail there with a 400 nobody reads at 06:00 on a Thursday.`);
    }
    if (!files.reporter.includes("/site-audit-findings")) {
      bad.push(`${REPORTER} posts nowhere. The job would read, decide, fix, write a file, and tell Boss OS nothing.`);
    }
  }

  if (files.prompt === null) {
    bad.push(`${PROMPT} does not exist, so the run has no instructions.`);
  } else {
    if (!files.prompt.includes("local-guides-citation-velocity")) {
      bad.push(`${PROMPT} never mentions local-guides-citation-velocity, so the run is not told to leave it alone before it starts.`);
    }
    if (!/REPO_IDENTITY/.test(files.prompt)) {
      bad.push(`${PROMPT} does not tell the run to map projects by REPO_IDENTITY.md, so a repository could be chosen by resemblance.`);
    }
    if (!/seq\.taylor@gmail\.com/.test(files.prompt) || !/sa@ahrefs\.com/.test(files.prompt)) {
      bad.push(`${PROMPT} does not name the mailbox and the sender, so the search is undefined.`);
    }
  }

  return bad;
}

/**
 * Rule: the route is mounted, and a missed pass is VISIBLE — on the alert surface, not in the
 * contract.
 *
 * ─── This check used to assert the opposite, and the owner corrected it ────
 *
 * It required `today/pillars.ts` to mention the duty and read `site_audit_findings`, because
 * `siteAuditGap()` composed a line for Today's CONTRACT. She found that line and named the rule:
 *
 *   "this was in today's contract: `Danielle's Ahrefs pass has not reported — run
 *    ahrefs-audit-fix.sh or find out why launchd did not.` ----- something not working should never
 *    be in today's contract it should be in the inbox."
 *
 * Today's contract is what SHE is doing today. A job that did not run is a notification about her
 * own machinery — and it did not merely sit there, it returned FIRST, ahead of a stalling deal and
 * the oldest open loop. A cron was outranking a dying deal.
 *
 * ─── THE CONCERN WAS RIGHT; ONLY ITS ADDRESS WAS WRONG ────────────────────
 *
 * "A duty that stops running looks exactly like one finding nothing" is true and is exactly what
 * this guard exists for, so the check is not deleted — it is REPOINTED. `routes/today.ts` raises a
 * HIGH alert for every duty that has not fired within twice its cadence, on the surface that already
 * carries the other thirty machinery items. This duty was never exempt from it.
 *
 * So the invariant is now stated in both directions, which is what makes it a rule rather than a
 * preference: the alert path MUST exist, and the contract MUST NOT carry it.
 * `validate:contract-is-her-work` holds the same line from the other end, and two validators that
 * contradicted each other — which is what these two did for about an hour — is worse than one.
 */
export function reachableAndEscalating(files) {
  const bad = [];
  if (files.mount === null) return [`${MOUNT} could not be read.`];
  if (!/routes\/siteAudit/.test(files.mount) || !/app\.route\([^)]*siteAudit\)/.test(files.mount)) {
    bad.push(`${MOUNT} does not mount the siteAudit router, so the endpoint the job posts to does not exist and every run would 404.`);
  }
  // ── The alert path exists, and covers EVERY duty rather than naming this one ──
  if (files.alerts === null) {
    bad.push(`${ALERTS} could not be read, so the escalation is unverified.`);
  } else {
    /*
     * GENERIC, NOT BY NAME, AND THAT IS STRICTLY BETTER. The old design hand-wrote an escalation for
     * this one duty; the alert surface raises one for ANY duty whose clock says it should have fired
     * and has not. So the check is that the generic path exists — a per-duty check here would be a
     * second list, and the eleven other local-job duties would still have nothing.
     */
    const raisesStaleDuties =
      /FROM standing_duties/.test(files.alerts) &&
      /has not fired for/.test(files.alerts) &&
      /never fired since it was created/.test(files.alerts);
    if (!raisesStaleDuties) {
      bad.push(
        `${ALERTS} no longer raises an alert for a duty that has not fired. A duty that stops running ` +
        `looks exactly like one finding nothing, and with the contract line correctly removed this is ` +
        `the ONLY thing that would tell her — so its absence is silent by construction.`,
      );
    }
  }

  // ── And the contract does NOT carry it. Stated here too, so the two ends cannot drift. ──
  if (files.today === null) {
    bad.push(`${TODAY} could not be read, so it cannot be confirmed free of machinery.`);
  } else {
    const code = files.today.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (code.includes(DUTY_ID) || new RegExp(`FROM\\s+${TABLE}`).test(code)) {
      bad.push(
        `${TODAY} reads ${DUTY_ID} or ${TABLE} again. Her rule of 13 Sep 2026: "something not working ` +
        `should never be in today's contract it should be in the inbox." It belongs on the alert ` +
        `surface, where every other duty's silence already goes — and in the contract it DISPLACES ` +
        `real work, because it returned ahead of a stalling deal.`,
      );
    }
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const loadFiles = () => ({
  route: read(ROUTE), runner: read(RUNNER), reporter: read(REPORTER),
  prompt: read(PROMPT), installer: read(INSTALLER), mount: read(MOUNT), today: read(TODAY),
  alerts: read(ALERTS),
});

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const state = stateFromMigrations();
  const files = loadFiles();

  expect("the shipped duty is reachable", dutyIsReachable(state, files), false);
  expect("the shipped duty has a real, correct seat", assignedToARealSeat(state), false);
  expect("velocity cannot be auto-fixed", velocityCannotBeAutoFixed(files), false);
  expect("the route is mounted and a missed week escalates", reachableAndEscalating(files), false);

  // ─── NEGATIVE PROOFS. Break each rule and require the guard to see it. ────
  expect("a duty assigned to a retired seat", assignedToARealSeat({
    ...state, duty: { ...state.duty, employee_id: "emp_intake" },
  }), true);
  expect("a duty assigned to Monique (Relationships)", assignedToARealSeat({
    ...state, duty: { ...state.duty, employee_id: "emp_relationship" },
  }), true);
  expect("a duty assigned to the Chief of Staff by default", assignedToARealSeat({
    ...state, duty: { ...state.duty, employee_id: "emp_chief" },
  }), true);
  expect("an empty roster", assignedToARealSeat({ ...state, roster: [] }), true);

  expect("a suspended duty", dutyIsReachable({ ...state, duty: { ...state.duty, suspended: 1 } }, files), true);
  expect("a duty whose script is not installed", dutyIsReachable(state, {
    ...files, installer: (files.installer ?? "").replaceAll("ahrefs-audit-fix.sh", "some-other-job.sh"),
  }), true);
  expect("a duty whose model disagrees with its script", dutyIsReachable(state, {
    ...files, runner: (files.runner ?? "").replace("claude-sonnet-4-5-20250929", "claude-haiku-4-5"),
  }), true);
  // The cadence is hers; what must fail is one `duties/cadence.ts` cannot schedule at all.
  expect("a cadence the scheduler cannot schedule", dutyIsReachable({
    ...state, duty: { ...state.duty, cadence: "fortnightly" },
  }, files), true);
  expect("a monthly duty still carrying a weekday that governs nothing", dutyIsReachable({
    ...state, duty: { ...state.duty, cadence: "monthly", weekday: 4 },
  }, files), true);
  expect("a weekly duty that names no day", dutyIsReachable({
    ...state, duty: { ...state.duty, cadence: "weekly", weekday: null },
  }, files), true);

  expect("a route that stops calling mayAutoFix", velocityCannotBeAutoFixed({
    ...files, route: (files.route ?? "").replace(/mayAutoFix\(/g, "alwaysTrue("),
  }), true);
  expect("a route that accepts an empty report", velocityCannotBeAutoFixed({
    ...files, route: (files.route ?? "").replace("rows.length === 0", "false"),
  }), true);
  expect("a runner that learned to merge", velocityCannotBeAutoFixed({
    ...files, runner: `${files.runner ?? ""}\ngh pr merge --squash\n`,
  }), true);
  expect("a runner that learned to dispatch a deploy", velocityCannotBeAutoFixed({
    ...files, runner: `${files.runner ?? ""}\ngh workflow run deploy.yml\n`,
  }), true);
  expect("a prompt that no longer names the forbidden repo", velocityCannotBeAutoFixed({
    ...files, prompt: (files.prompt ?? "").replaceAll("local-guides-citation-velocity", "some-repo"),
  }), true);
  expect("a reporter that posts nowhere", velocityCannotBeAutoFixed({
    ...files, reporter: (files.reporter ?? "").replaceAll("/site-audit-findings", "/nowhere"),
  }), true);
  expect("an unmounted router", reachableAndEscalating({ ...files, mount: (files.mount ?? "").replace(/app\.route\("\/api\/engineering", siteAudit\);/, "") }), true);
  expect("an alert surface that stopped raising a duty that has not fired", reachableAndEscalating({
    ...files, alerts: (files.alerts ?? "").replaceAll("has not fired for", "is quite happy after"),
  }), true);
  /*
   * AND THE OTHER DIRECTION, which is the half that would otherwise rot. Her rule is that machinery
   * belongs in the Inbox, so putting the escalation BACK into the contract must fail here as well as
   * in `validate:contract-is-her-work`. A rule stated at one end only is a preference.
   */
  expect("the escalation put back into Today's contract", reachableAndEscalating({
    ...files, today: `${files.today ?? ""}\nconst d = await env.DB.prepare("SELECT suspended FROM standing_duties WHERE id = '${DUTY_ID}'").first();`,
  }), true);

  if (failed) { console.error(`AUDIT FIXER SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("AUDIT FIXER SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const state = stateFromMigrations();

if (state.failed.length) {
  console.error(`AUDIT FIXER SCAN FAILED — ${state.failed.length} migration(s) could not be applied, so the duty being checked is not the one that ships:`);
  for (const f of state.failed) console.error(`  ✗ ${f}`);
  process.exit(2);
}

/*
 * RULE 0, three ways. Any of these being empty turns every check below into a loop over nothing that
 * reports a clean bill of health.
 */
if (!state.duty) {
  console.error(`AUDIT FIXER SCAN FAILED — ${state.files} migrations replayed and no ${DUTY_ID} exists.`);
  process.exit(2);
}
if (state.roster.length === 0) {
  console.error(`AUDIT FIXER SCAN FAILED — ${state.files} migrations replayed and the roster is empty, so no assignment could be checked.`);
  process.exit(2);
}
if (NO_AUTO_FIX.length === 0) {
  console.error("AUDIT FIXER SCAN FAILED — the off-limits list is empty, so this guard would examine zero repositories and pass.");
  process.exit(2);
}

const files = loadFiles();
const problems = [
  ...dutyIsReachable(state, files),
  ...assignedToARealSeat(state),
  ...velocityCannotBeAutoFixed(files),
  ...reachableAndEscalating(files),
];

if (problems.length) {
  console.error(`AUDIT FIXER SCAN FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const seat = state.roster.find((s) => s.id === state.duty.employee_id);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
console.log(
  `AUDIT FIXER SCAN PASSED: ${DUTY_ID} is held by ${seat.name} (${seat.role}), runs ${state.duty.cadence} `
  + `${state.duty.cadence === "weekly" ? `on ${DAYS[state.duty.weekday]} ` : state.duty.cadence === "monthly" ? "on the 1st " : ""}`
  + `at ${String(state.duty.local_hour).padStart(2, "0")}:${String(state.duty.local_minute).padStart(2, "0")} `
  + `${state.duty.timezone}, delivers into ${TABLE} through a mounted route, raises an ALERT rather than a contract line when it does not, `
  + `and cannot open a pull request against ${NO_AUTO_FIX_REPOS.join(", ")} — refused in the policy, in the runner, `
  + `in the reporter and again server-side. ${state.roster.length} active employees examined.`,
);
