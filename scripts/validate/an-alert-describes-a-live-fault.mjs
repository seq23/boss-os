#!/usr/bin/env node
/**
 * AN ALERT DESCRIBES SOMETHING THAT IS WRONG NOW.
 *
 * Not a decision she made on purpose. Not a schedule she is keeping. Not a failure that has already
 * been fixed.
 *
 * ─── Her words, and the five alerts they were about ─────────────────────────
 *
 *   "also fix all critical alerts now and you can mark all as resovled as they are fixed"
 *
 * Five alerts on her morning screen, 13 September 2026. THREE OF THE FIVE WERE FALSE, and each was
 * false in a different way — which is why this is one guard with three rules rather than three
 * guards. They are the same defect: a query answering a question about the past and being read as
 * a statement about the present.
 *
 *   1. A DECISION IN FORCE, REPORTED AS A FAULT. Two HIGH alerts, at the top:
 *      "Nothing has ever checked The Anthropic key" and the same for OpenAI. Measured against
 *      production: `bk_anthropic` and `bk_openai` are `registered`, never enabled, and
 *      `coaching_backend` is `bk_workers_ai` — the free Llama, which is what she chose. The keys
 *      are absent because those backends are deliberately off. The system was shouting twice, at
 *      HIGH, about a choice she made.
 *
 *   2. A SCHEDULE KEPT, REPORTED AS A FAULT. "Brokerage Sourcing Sweep (Mon/Wed/Fri) has not fired
 *      for 2 days. Its clock says it should have." Its clock said nothing of the sort: the duty is
 *      `weekdays = [1,3,5]`, it ran Friday, and the next occurrence was Monday. The staleness check
 *      measured a weekday-restricted duty against a daily clock — a guard that could not reach what
 *      it governed.
 *
 *   3. HISTORY, REPORTED AS A FAULT. "2 tasks failed and have not been requeued or cancelled." Both
 *      rows were from 9 September, both said `stdout was not JSON`, and BOTH duties have run
 *      successfully since. The same shape produced five `queue: task_failed` events about one task
 *      that hit the capability wall on the 12th and has not failed since the 70B promotion.
 *
 * ─── Why a false alert is worse than a missing one ──────────────────────────
 *
 * This repository says it in `OPERATIONS`, about a different decision: "a false alarm, which is
 * worse than the gap, because a screen that cries wolf is one you stop reading." Three of five is
 * not a screen she can triage; it is a screen she learns to scroll past, and the two real alerts
 * underneath go with it.
 *
 * ─── What is checked ────────────────────────────────────────────────────────
 *
 * The SHIPPED functions, over the EXACT production rows that produced each false alert.
 *
 *   · `alertsForProbes` is silent about a never-checked credential whose backend is not enabled,
 *     and still shouts about one that is enabled, about one with no backend at all, and about any
 *     probe proven DEAD — a disabled backend must never mute a revoked token something else uses.
 *     The gate is read off `execution_backends.status`, never off a list of credential names.
 *   · `dutyStaleness` is quiet about the Mon/Wed/Fri duty on the Sunday it went loud, quiet about a
 *     daily duty that has not run yet this morning, and LOUD on the Tuesday after a missed Monday.
 *   · The route's failed-task alert counts failures nothing has since succeeded at, and its error
 *     window excludes `task_failed` events whose task is no longer failed.
 *
 * RULE 0: zero probes, zero duties, or zero fixtures examined is a HARD FAILURE. Every rule here is
 * of the form "this must be quiet", and silence over an empty set is the easiest pass there is.
 *
 *   node scripts/validate/an-alert-describes-a-live-fault.mjs
 *   node scripts/validate/an-alert-describes-a-live-fault.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CREDENTIALS = "src/worker/boss/today/credentials.ts";
const STALENESS = "src/worker/boss/duties/staleness.ts";
const ROUTE = "src/worker/boss/routes/today.ts";

/**
 * THE PRODUCTION ROWS, COPIED. Two probes that went loud and should not have, one that must keep
 * its voice because its backend is on, one with no backend at all, and one proven dead.
 */
export const PROBE_FIXTURES = [
  {
    id: "cred_anthropic_key", label: "The Anthropic key", what_depends: "Morning coaching on a frontier model.",
    state: "unknown", detail: null, fix_steps: "npm run vault:set ANTHROPIC_API_KEY", checked_at: null,
    max_age_hours: 168, backend_id: "bk_anthropic", backend_status: "registered",
    expect: "silent", why: "the backend is registered, never enabled — coaching runs on the free Llama by her choice",
  },
  {
    id: "cred_openai_key", label: "The OpenAI key", what_depends: "The second frontier option for coaching.",
    state: "unknown", detail: null, fix_steps: "npm run vault:set OPENAI_API_KEY", checked_at: null,
    max_age_hours: 168, backend_id: "bk_openai", backend_status: "registered",
    expect: "silent", why: "same decision, same silence",
  },
  {
    id: "cred_enabled_backend", label: "A key something switched on needs", what_depends: "Work that runs.",
    state: "unknown", detail: null, fix_steps: "set it", checked_at: null,
    max_age_hours: 36, backend_id: "bk_workers_ai", backend_status: "enabled",
    expect: "loud", why: "the backend is ENABLED and its credential has never been checked — a real gap",
  },
  {
    id: "cred_gmail_connector", label: "The claude.ai Gmail connector", what_depends: "Simone's KDP watch and the mailbox sweep.",
    state: "unknown", detail: null, fix_steps: "reconnect it", checked_at: null,
    max_age_hours: 36, backend_id: null, backend_status: null,
    expect: "loud", why: "no backend at all, so this gate does not apply — and it never did",
  },
  {
    id: "cred_dead_on_a_disabled_backend", label: "A revoked token on a switched-off backend",
    what_depends: "Nothing here, but the token is shared.",
    state: "dead", detail: "Proven by a 401.", fix_steps: "rotate it", checked_at: 1_789_000_000_000,
    max_age_hours: 36, backend_id: "bk_anthropic", backend_status: "registered",
    expect: "loud", why: "PROVEN DEAD is evidence about the world; a disabled backend must not mute it",
  },
];

/** The Mon/Wed/Fri duty, exactly as production holds it. */
export const BROKERAGE_DUTY = {
  id: "duty_brokerage_sourcing",
  name: "Brokerage Sourcing Sweep (Mon/Wed/Fri)",
  cadence: "daily",
  weekday: null,
  weekdays: "[1,3,5]",
  local_hour: 6,
  local_minute: 45,
  timezone: "America/Chicago",
  suspended: 0,
  last_run_at: 1_789_128_106_042, // Friday 11 September, 07:01 Central
  created_at: 1_788_802_886_000,
};

/** A plain daily duty, for the case the old threshold got right and must keep getting right. */
export const DAILY_DUTY = {
  id: "duty_exec_intel", name: "Executive Intelligence Report", cadence: "daily",
  weekday: null, weekdays: null, local_hour: 6, local_minute: 30, timezone: "America/Chicago",
  suspended: 0, last_run_at: Date.parse("2026-09-12T11:30:00Z"), created_at: Date.parse("2026-08-01T00:00:00Z"),
};

export const STALENESS_FIXTURES = [
  {
    name: "the Mon/Wed/Fri duty on the Sunday it went loud",
    duty: BROKERAGE_DUTY, at: Date.parse("2026-09-13T18:57:00Z"), expect: "quiet",
    why: "it ran Friday and its next occurrence is Monday — this is THE false alert",
  },
  {
    name: "the Mon/Wed/Fri duty on the Tuesday after a missed Monday",
    duty: BROKERAGE_DUTY, at: Date.parse("2026-09-15T18:00:00Z"), expect: "loud",
    why: "Monday's occurrence went by and a full day has passed — a real fault",
  },
  {
    name: "the Mon/Wed/Fri duty on Monday morning, not yet run",
    duty: BROKERAGE_DUTY, at: Date.parse("2026-09-14T13:00:00Z"), expect: "quiet",
    why: "one missed morning is a closed laptop, and the grace is one day",
  },
  {
    name: "a daily duty that missed this morning only",
    duty: DAILY_DUTY, at: Date.parse("2026-09-13T14:00:00Z"), expect: "quiet",
    why: "the rule the old threshold got right, and it must keep getting it right",
  },
  {
    name: "a daily duty that has missed two mornings",
    duty: DAILY_DUTY, at: Date.parse("2026-09-14T14:00:00Z"), expect: "loud",
    why: "two mornings is a fault, and it was a fault before this change too",
  },
  {
    name: "a suspended duty, however late",
    duty: { ...DAILY_DUTY, suspended: 1 }, at: Date.parse("2026-10-01T14:00:00Z"), expect: "quiet",
    why: "switched off is a decision, and a decision in force is not a fault",
  },
  {
    name: "a duty with no readable schedule",
    duty: { ...DAILY_DUTY, timezone: null, local_hour: null }, at: Date.now(), expect: "loud",
    why: "a row nothing can schedule must be reported, never assumed fine",
  },
];

export function check({ probeAlerts, staleness, route }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(probeAlerts) || probeAlerts.length === 0 || !Array.isArray(staleness) || staleness.length === 0) {
    problems.push(
      `Zero credential probes or zero duty fixtures were examined. Every rule below is of the form ` +
      `"this must be quiet", and silence over an empty set is the easiest pass there is.`,
    );
    return problems;
  }

  // ── 1. A decision in force is not a fault ────────────────────────────────
  for (const row of probeAlerts) {
    const spoke = row.alerts.length > 0;
    if (row.expect === "silent" && spoke) {
      problems.push(
        `\`${row.id}\` still raises "${row.alerts[0].text.slice(0, 70)}" — ${row.why}. An alert that fires ` +
        `because a deliberate choice is in force is noise, and it was the loudest thing on her screen.`,
      );
    }
    if (row.expect === "loud" && !spoke) {
      problems.push(
        `\`${row.id}\` went silent, and it must not: ${row.why}. A gate written to quieten a false alert ` +
        `that also quietens the true ones has made the register decorative.`,
      );
    }
  }

  // ── 2. A schedule kept is not a fault ────────────────────────────────────
  for (const row of staleness) {
    const loud = row.result.stale;
    if (row.expect === "quiet" && loud) {
      problems.push(
        `${row.name}: reported STALE — "${row.result.reason}". It should be quiet because ${row.why}.`,
      );
    }
    if (row.expect === "loud" && !loud) {
      problems.push(`${row.name}: reported on schedule. It should be loud because ${row.why}.`);
    }
    if (row.expect === "loud" && loud && !row.result.reason) {
      problems.push(`${row.name}: went loud without a reason. A red state with no sentence is a puzzle, not an alert.`);
    }
  }

  // ── 3. History is not a fault ────────────────────────────────────────────
  const routeCode = code(route);
  if (/CASE cadence WHEN 'daily' THEN 2/.test(routeCode)) {
    problems.push(
      `${ROUTE} still decides staleness with \`CASE cadence WHEN 'daily' THEN 2 …\` in SQL. That clause IS ` +
      `the false alert: SQL cannot know a duty runs Mon/Wed/Fri, and \`weekdays\` was invisible to it.`,
    );
  }
  if (!/dutyStaleness\s*\(/.test(routeCode)) {
    problems.push(`${ROUTE} does not use \`dutyStaleness\`, so the alert and the health dot are two copies of one rule again.`);
  }
  if (!/s\.status\s*=\s*'done'\s*AND\s*s\.created_at\s*>\s*f\.created_at/.test(routeCode)) {
    problems.push(
      `${ROUTE}'s failed-task count no longer excludes failures the same work has since succeeded at. ` +
      `Both rows on her screen were from 9 September and both duties had run successfully since.`,
    );
  }
  if (!/t\.id = e\.entity_id AND t\.status <> 'failed'/.test(routeCode)) {
    problems.push(
      `${ROUTE}'s error window no longer excludes \`task_failed\` events whose task is no longer failed. ` +
      `Five such events, all one task that recovered, were on her screen as a present condition.`,
    );
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const creds = await import(`file://${join(ROOT, CREDENTIALS)}`);
  const stale = await import(`file://${join(ROOT, STALENESS)}`);

  /*
   * EACH PROBE IS JUDGED ON ITS OWN, not as a list. `alertsForProbes` returns early when the whole
   * register is empty, so feeding it one row at a time is the only way to attribute a sentence to
   * the row that produced it — and attribution is the entire content of rule 1.
   */
  const probeAlerts = PROBE_FIXTURES.map((p) => ({
    id: p.id,
    expect: p.expect,
    why: p.why,
    alerts: creds.alertsForProbes([p], Date.parse("2026-09-13T18:57:00Z")),
  }));

  const staleness = STALENESS_FIXTURES.map((f) => ({
    name: f.name,
    expect: f.expect,
    why: f.why,
    result: stale.dutyStaleness(f.duty, f.at),
  }));

  return { probeAlerts, staleness };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const { probeAlerts, staleness } = await evaluate();
  const good = { probeAlerts, staleness, route: readFileSync(join(ROOT, ROUTE), "utf8") };
  const loud = (text) => [{ severity: "high", text, source_type: "tasks", source_id: null }];

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE FALSE ALERT: the Anthropic key shouting again",
      input: {
        ...good,
        probeAlerts: good.probeAlerts.map((r) =>
          r.id === "cred_anthropic_key" ? { ...r, alerts: loud("Nothing has ever checked The Anthropic key.") } : r),
      },
      expect: 1,
    },
    {
      name: "the gate silencing a key an ENABLED backend needs",
      input: {
        ...good,
        probeAlerts: good.probeAlerts.map((r) => (r.id === "cred_enabled_backend" ? { ...r, alerts: [] } : r)),
      },
      expect: 1,
    },
    {
      name: "the gate silencing a probe with no backend at all",
      input: {
        ...good,
        probeAlerts: good.probeAlerts.map((r) => (r.id === "cred_gmail_connector" ? { ...r, alerts: [] } : r)),
      },
      expect: 1,
    },
    {
      name: "a disabled backend muting a PROVEN DEAD token",
      input: {
        ...good,
        probeAlerts: good.probeAlerts.map((r) => (r.id === "cred_dead_on_a_disabled_backend" ? { ...r, alerts: [] } : r)),
      },
      expect: 1,
    },
    {
      name: "THE FALSE ALERT: Mon/Wed/Fri going loud on a Sunday again",
      input: {
        ...good,
        staleness: good.staleness.map((r, i) => (i === 0 ? { ...r, result: { ...r.result, stale: true, reason: "has not fired for 2 days" } } : r)),
      },
      expect: 1,
    },
    {
      name: "a genuinely missed Monday going quiet",
      input: {
        ...good,
        staleness: good.staleness.map((r, i) => (i === 1 ? { ...r, result: { ...r.result, stale: false } } : r)),
      },
      expect: 1,
    },
    {
      name: "a duty that went loud with no reason on it",
      input: {
        ...good,
        staleness: good.staleness.map((r, i) => (i === 1 ? { ...r, result: { ...r.result, reason: "" } } : r)),
      },
      expect: 1,
    },
    {
      name: "the daily CASE clause restored in SQL",
      input: { ...good, route: `${good.route}\nCASE cadence WHEN 'daily' THEN 2 WHEN 'weekly' THEN 14 END\n` },
      expect: 1,
    },
    {
      name: "the route no longer using dutyStaleness",
      input: { ...good, route: good.route.replaceAll("dutyStaleness", "oldCheck") },
      expect: 1,
    },
    {
      name: "the failed-task count reading history again",
      input: { ...good, route: good.route.replace(/s\.status = 'done' AND s\.created_at > f\.created_at/, "1 = 0") },
      expect: 1,
    },
    {
      name: "recovered task_failed events back in the window",
      input: { ...good, route: good.route.replace(/t\.id = e\.entity_id AND t\.status <> 'failed'/, "1 = 0") },
      expect: 1,
    },
    { name: "RULE 0 — no probes examined", input: { ...good, probeAlerts: [] }, expect: 1 },
    { name: "RULE 0 — no duties examined", input: { ...good, staleness: [] }, expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nan-alert-describes-a-live-fault self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`an-alert-describes-a-live-fault self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [CREDENTIALS, STALENESS, ROUTE].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`an-alert-describes-a-live-fault FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const { probeAlerts, staleness } = await evaluate();
  const problems = check({ probeAlerts, staleness, route: readFileSync(join(ROOT, ROUTE), "utf8") });

  if (problems.length) {
    console.error("an-alert-describes-a-live-fault FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `an-alert-describes-a-live-fault: ${probeAlerts.length} credential probes and ${staleness.length} duty ` +
    `fixtures judged by the shipped code — a decision in force, a schedule kept and a failure already ` +
    `fixed are all quiet, and a real gap, a missed Monday and a dead token are all loud. OK.`,
  );
}
