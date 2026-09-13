#!/usr/bin/env node
/**
 * AN ALERT SAYS WHAT HAPPENED, ONCE.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * She opened Today and found ELEVEN critical alerts, FIVE of which were the literal text
 * `queue: task_failed` — a database key and a database value with a colon between them, repeated
 * five times, with no explanation and nothing to act on.
 *
 *     SELECT id, ts, scope, event FROM system_events WHERE level = 'error' … LIMIT 5
 *     alerts.push({ text: `${ev.scope}: ${ev.event}` })
 *
 * Three faults in those two lines:
 *
 *   1. IT PRINTED A KEY PAIR AS PROSE. Every other alert on that surface is a sentence.
 *   2. IT NEVER READ `detail`, WHICH IS WHERE THE ANSWER WAS. All five production rows held
 *      `{"message":"No model on this route satisfied policy: 3 of 4 refused at capability — model
 *      is cleared to low risk, task is medium"}`. The cause was one column away, unread.
 *   3. IT DUPLICATED THE AGGREGATE SEVENTEEN LINES ABOVE — "N tasks failed and have not been
 *      requeued or cancelled" — so one fact appeared twice in two shapes, and `LIMIT 5` made the
 *      raw list neither complete nor a sample she could reason about.
 *
 * ─── The four rules, and why each is here ───────────────────────────────────
 *
 *   1. NO ALERT TEXT IS A BARE `scope: event` PAIR. Checked as a SHAPE, not as that one string, so
 *      the next producer that dumps a column pair is caught the day it is written.
 *   2. NO TWO ALERTS IN A RENDER CARRY THE SAME TEXT. Five identical lines is the thing she saw. A
 *      repeated sentence carries nothing the first carried, and its only effect is to push a
 *      different alert off the screen.
 *   3. A CLASS WITH NO ACTIONABLE CONTENT DOES NOT REACH THE SURFACE. An error class whose rows
 *      carry no readable `detail` cannot be made actionable; it belongs in Diagnostics, which reads
 *      the same table in full. An alert she cannot act on trains her past the ones she can.
 *   4. THE QUERY READS `detail`, AND THE RENDER IS COLLAPSED. Behaviour is checked by running the
 *      shipped code over a fixture; these two are checked in the source, because they are the
 *      wiring that lets the behaviour be right.
 *
 * RULE 0: a fixture render that produces ZERO alerts is a HARD FAILURE. Every rule below is of the
 * form "no alert is…", and an empty list satisfies all of them while proving nothing — which is
 * exactly how a validator stays green for years over code that has rotted.
 *
 *   node scripts/validate/an-alert-says-what-happened.mjs
 *   node scripts/validate/an-alert-says-what-happened.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ROUTE = "src/worker/boss/routes/today.ts";
const GROUPER = "src/worker/boss/today/errorAlerts.ts";
const ALERTS = "src/worker/boss/today/alerts.ts";

/**
 * THE FIXTURE IS THE PRODUCTION ROW SET, PLUS THE TWO CASES IT DID NOT CONTAIN.
 *
 * Five identical `queue`/`task_failed` rows with a real message — what she actually saw, copied
 * from `system_events` on 12 September 2026. Then a class whose rows carry NOTHING readable, which
 * is the case rule 3 exists for, and a single one-off with a message, which is the case that must
 * still be allowed to speak.
 */
export const FIXTURE_ROWS = [
  { id: "evt_1", ts: 1_789_243_486_856, scope: "queue", event: "task_failed", detail: '{"message":"No model on this route satisfied policy: 3 of 4 refused at capability — model is cleared to low risk, task is medium"}' },
  { id: "evt_2", ts: 1_789_243_444_690, scope: "queue", event: "task_failed", detail: '{"message":"No model on this route satisfied policy"}' },
  { id: "evt_3", ts: 1_789_243_305_424, scope: "queue", event: "task_failed", detail: '{"message":"No model on this route satisfied policy"}' },
  { id: "evt_4", ts: 1_789_243_163_654, scope: "queue", event: "task_failed", detail: '{"message":"No model on this route satisfied policy"}' },
  { id: "evt_5", ts: 1_789_243_051_775, scope: "queue", event: "task_failed", detail: '{"message":"No model on this route satisfied policy"}' },
  { id: "evt_6", ts: 1_789_243_000_000, scope: "router", event: "route_probe_failed", detail: null },
  { id: "evt_7", ts: 1_789_242_900_000, scope: "router", event: "route_probe_failed", detail: "{}" },
  { id: "evt_8", ts: 1_789_242_800_000, scope: "cron", event: "run_failed", detail: '{"message":"Nightly run aborted after the budget check"}' },
];

/** The number of tasks sitting `failed` in the fixture, which is what the aggregate counts. */
export const FIXTURE_FAILED_TASKS = 5;

/**
 * Render the alert surface the way `routes/today.ts` renders it, using the SHIPPED functions.
 *
 * The route's other producers are represented by one ordinary sentence, so the dedupe rule is
 * exercised against a realistic list rather than against error alerts alone.
 */
export function renderFixture(mod, dedupeAlerts, rows = FIXTURE_ROWS, failedTasks = FIXTURE_FAILED_TASKS) {
  const alerts = [
    {
      severity: "high",
      text: '"Brokerage Sourcing Sweep" has not fired for 2 days.',
      source_type: "tasks",
      source_id: "duty_brokerage",
    },
  ];

  const groups = mod.groupErrorEvents(rows);
  const failedGroup = groups.find((g) => g.scope === "queue" && g.event === "task_failed") ?? null;

  if (failedTasks > 0) {
    alerts.push({
      severity: "medium",
      text: mod.failedTaskAlertText(failedTasks, failedGroup),
      source_type: "tasks",
      source_id: null,
    });
  }
  for (const g of groups) {
    if (g === failedGroup && failedTasks > 0) continue;
    alerts.push({ severity: "medium", text: mod.errorAlertText(g), source_type: "tasks", source_id: g.newest_id });
  }

  return dedupeAlerts(alerts);
}

/** A text that is nothing but a snake_case key, a colon, and a snake_case value. */
export function isBareKeyPair(text) {
  return /^\s*[a-z][a-z0-9_]*\s*:\s*[a-z][a-z0-9_]*\s*$/.test(text);
}

export function check({ rendered, rows, route, grouper, alerts }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(rendered) || rendered.length === 0) {
    problems.push(
      `The fixture render produced ZERO alerts. Every rule in this scan is of the form "no alert ` +
      `is…", so an empty list passes all of them while examining nothing. ${rows.length} error rows ` +
      `went in and nothing came out.`,
    );
    return problems;
  }

  // ── 1. No bare key pairs ─────────────────────────────────────────────────
  for (const a of rendered) {
    if (isBareKeyPair(a.text)) {
      problems.push(
        `An alert reads "${a.text}" — a database key and a database value with a colon between them, ` +
        `not a sentence. This is the exact shape she found five copies of. What happened lives in ` +
        `\`system_events.detail\`; read it or do not raise the alert.`,
      );
    }
  }
  for (const row of rows) {
    const pair = `${row.scope}: ${row.event}`;
    if (rendered.some((a) => a.text.trim() === pair)) {
      problems.push(`An alert is verbatim the row's own columns: "${pair}".`);
    }
  }

  // ── 2. No two alerts say the same words ──────────────────────────────────
  const seen = new Map();
  for (const a of rendered) seen.set(a.text, (seen.get(a.text) ?? 0) + 1);
  for (const [text, n] of seen) {
    if (n > 1) {
      problems.push(
        `"${text.slice(0, 80)}" appears ${n} times in one render. Five of a thing is ONE fact about a ` +
        `thing that happened five times — the count belongs in the sentence, not in the list length.`,
      );
    }
  }

  // ── 3. A class that cannot say what happened does not reach the surface ──
  const mute = new Map();
  for (const row of rows) {
    const key = `${row.scope}::${row.event}`;
    const readable = typeof row.detail === "string" && /"(message|error|reason|summary)"\s*:\s*"/.test(row.detail);
    mute.set(key, (mute.get(key) ?? true) && !readable);
  }
  for (const [key, isMute] of mute) {
    if (!isMute) continue;
    const [scope, event] = key.split("::");
    const leaked = rendered.filter((a) => a.text.includes(event.replace(/_/g, " ")) || a.text.includes(event));
    if (leaked.length > 0) {
      problems.push(
        `\`${scope}/${event}\` has no readable \`detail\` in any of its rows and still reached the ` +
        `surface as "${leaked[0].text.slice(0, 80)}". An alert she cannot act on trains her to scroll ` +
        `past the ones she can; that class belongs in Diagnostics, which reads the same table in full.`,
      );
    }
  }

  // ── 3b. The one fact, once: the count and the reason are a single alert ──
  const failedLines = rendered.filter((a) => /failed and have not been requeued/.test(a.text));
  if (failedLines.length > 1) {
    problems.push(`The failed-task aggregate is raised ${failedLines.length} times in one render.`);
  }
  if (failedLines.length === 1 && rendered.some((a) => a !== failedLines[0] && /task failed/i.test(a.text))) {
    problems.push(
      `The failed-task COUNT and the failed-task REASON are two separate alerts. They are one fact ` +
      `in two shapes — exactly the duplication that put "queue: task_failed" under "5 tasks failed" ` +
      `— and the count belongs in the same sentence as the reason.`,
    );
  }
  if (failedLines.length === 1 && !/No model on this route satisfied policy/.test(failedLines[0].text)) {
    problems.push(
      `The failed-task alert does not carry the reason out of \`detail\`. The fixture's newest row ` +
      `says "No model on this route satisfied policy: 3 of 4 refused at capability"; the alert says ` +
      `"${failedLines[0].text.slice(0, 90)}".`,
    );
  }

  // ── 4. The wiring that makes the above possible ──────────────────────────
  const routeCode = code(route);
  if (!/SELECT[^`]*\bdetail\b[^`]*FROM system_events[\s\S]*?level\s*=\s*'error'/.test(routeCode)) {
    problems.push(
      `${ROUTE} does not select \`detail\` in its error-event query. The column has existed since ` +
      `migration 0154 and \`logEvent\` has always written to it; leaving it out of the SELECT is what ` +
      `left the answer unread beside the question.`,
    );
  }
  if (/\$\{\s*\w+\.scope\s*\}\s*:\s*\$\{\s*\w+\.event\s*\}/.test(routeCode)) {
    problems.push(
      `${ROUTE} still builds an alert text as \`\${row.scope}: \${row.event}\`. That template IS the ` +
      `defect.`,
    );
  }
  if (!/dedupeAlerts\s*\(/.test(routeCode)) {
    problems.push(
      `${ROUTE} does not collapse its alert list before rendering. Grouping fixed the cause that ` +
      `produced five identical lines; \`dedupeAlerts\` is what stops a future producer reintroducing ` +
      `the shape.`,
    );
  }
  if (!/export function dedupeAlerts/.test(code(alerts))) {
    problems.push(`${ALERTS} does not export \`dedupeAlerts\`, so the route's collapse cannot be the real one.`);
  }
  if (!/export function groupErrorEvents/.test(code(grouper)) || !/export function messageFrom/.test(code(grouper))) {
    problems.push(`${GROUPER} no longer exports the grouping and detail-reading this scan exercises.`);
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const mod = await import(`file://${join(ROOT, GROUPER)}`);
  const alertsMod = await import(`file://${join(ROOT, ALERTS)}`);
  const good = {
    rendered: renderFixture(mod, alertsMod.dedupeAlerts),
    rows: FIXTURE_ROWS,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    grouper: readFileSync(join(ROOT, GROUPER), "utf8"),
    alerts: readFileSync(join(ROOT, ALERTS), "utf8"),
  };

  /** The surface as she actually found it, reconstructed line for line. */
  const asSheFoundIt = [
    { severity: "high", text: '"Brokerage Sourcing Sweep" has not fired for 2 days.', source_type: "tasks", source_id: "d1" },
    { severity: "medium", text: "5 tasks failed and have not been requeued or cancelled.", source_type: "tasks", source_id: null },
    { severity: "medium", text: "queue: task_failed", source_type: "tasks", source_id: "evt_1" },
    { severity: "medium", text: "queue: task_failed", source_type: "tasks", source_id: "evt_2" },
    { severity: "medium", text: "queue: task_failed", source_type: "tasks", source_id: "evt_3" },
    { severity: "medium", text: "queue: task_failed", source_type: "tasks", source_id: "evt_4" },
    { severity: "medium", text: "queue: task_failed", source_type: "tasks", source_id: "evt_5" },
  ];

  const cases = [
    { name: "the shipped render passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: five copies of `queue: task_failed` under the aggregate",
      input: { ...good, rendered: asSheFoundIt },
      expect: 1,
    },
    {
      name: "a single bare key pair, with no repetition to give it away",
      input: { ...good, rendered: [{ severity: "medium", text: "router: route_probe_failed", source_type: "tasks", source_id: "e" }] },
      expect: 1,
    },
    {
      name: "two producers reaching the same sentence",
      input: { ...good, rendered: [...good.rendered, { ...good.rendered[0] }] },
      expect: 1,
    },
    {
      name: "a detail-less class surfaced anyway",
      input: {
        ...good,
        rendered: [...good.rendered, { severity: "medium", text: "router reported route probe failed", source_type: "tasks", source_id: "evt_6" }],
      },
      expect: 1,
    },
    {
      name: "the count and the reason split back into two alerts",
      input: {
        ...good,
        rendered: [
          { severity: "medium", text: "5 tasks failed and have not been requeued or cancelled.", source_type: "tasks", source_id: null },
          { severity: "medium", text: "A queued task failed 5 times in the last day — No model on this route satisfied policy", source_type: "tasks", source_id: "evt_1" },
        ],
      },
      expect: 1,
    },
    {
      name: "the aggregate that never reads detail",
      input: {
        ...good,
        rendered: [{ severity: "medium", text: "5 tasks failed and have not been requeued or cancelled.", source_type: "tasks", source_id: null }],
      },
      expect: 1,
    },
    {
      name: "the query drops `detail` again",
      input: { ...good, route: good.route.replace("SELECT id, ts, scope, event, detail FROM system_events", "SELECT id, ts, scope, event FROM system_events") },
      expect: 1,
    },
    {
      name: "the raw key-pair template returns to the route",
      input: { ...good, route: `${good.route}\nalerts.push({ text: \`\${ev.scope}: \${ev.event}\` });\n` },
      expect: 1,
    },
    {
      name: "the render is no longer collapsed",
      input: { ...good, route: good.route.replaceAll("dedupeAlerts", "passThrough") },
      expect: 1,
    },
    {
      name: "RULE 0 — a render that produces nothing at all",
      input: { ...good, rendered: [] },
      expect: 1,
    },
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
    console.error(`\nan-alert-says-what-happened self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`an-alert-says-what-happened self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missing = [ROUTE, GROUPER, ALERTS].filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.error(`an-alert-says-what-happened FAILED — ${missing.join(", ")} missing. A scan whose subject does not exist must fail.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const mod = await import(`file://${join(ROOT, GROUPER)}`);
  const alertsMod = await import(`file://${join(ROOT, ALERTS)}`);
  const rendered = renderFixture(mod, alertsMod.dedupeAlerts);

  const problems = check({
    rendered,
    rows: FIXTURE_ROWS,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    grouper: readFileSync(join(ROOT, GROUPER), "utf8"),
    alerts: readFileSync(join(ROOT, ALERTS), "utf8"),
  });

  if (problems.length) {
    console.error("an-alert-says-what-happened FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `an-alert-says-what-happened: ${FIXTURE_ROWS.length} error rows over ${new Set(FIXTURE_ROWS.map((r) => `${r.scope}/${r.event}`)).size} ` +
    `classes rendered ${rendered.length} distinct alerts — no key pairs, no repeats, and the class ` +
    `with no readable detail stayed off the surface. OK.`,
  );
}
