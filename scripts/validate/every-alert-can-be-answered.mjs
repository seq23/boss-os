#!/usr/bin/env node
/**
 * EVERY ALERT CAN BE ANSWERED, AND THE ANSWER IS WHERE HER HANDS ARE.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "and the dimiss and mark resolved buttons dont work"
 *
 * Both endpoints worked. `POST /today/alerts/dismiss` returned 201, the row landed in
 * `alert_dismissals`, and the alert was gone on the next read — watched happening, live. The
 * deployed bundle was not stale and the service worker never caches `/api/*`. Three real defects,
 * none of them on the server:
 *
 *   (a) DISMISS WAS A TWO-STEP WHOSE SECOND STEP WAS OFF-SCREEN. Pressing "Dismiss" replaces the
 *       button with a reason box, and the "Put it aside" / "Cancel" pair rendered BELOW THE FOLD,
 *       behind the fixed bottom nav. From her seat: she presses Dismiss, the button she pressed
 *       vanishes, nothing is dismissed. That is precisely "doesn't work", and no amount of endpoint
 *       testing finds it. Worse, "Put it aside" sat grey and silent until three characters were
 *       typed, so even scrolled into view it looked dead on arrival.
 *
 *   (b) "MARK RESOLVED" RENDERED ON ZERO ALERTS. It was gated on
 *       `a.source_type === "tasks" && a.source_id?.startsWith("del_")`, and NONE of the alerts on
 *       her screen had a `del_` source id. The button she was complaining about was not on the page
 *       at all — "exists but nothing invokes it", wearing a button.
 *
 *   (c) A DISMISSAL ON AN EVENT ALERT WAS DEAD ON ARRIVAL BY CONSTRUCTION. `alertKey()` builds
 *       `source_type:source_id`, and the error alerts carried `evt_…` — a primary key unique per
 *       OCCURRENCE. The same condition recurring writes a new row with a new id and sails straight
 *       past the snooze she set. She dismisses it, it returns tomorrow, and the button looks broken
 *       because for that class it was.
 *
 * ─── What is checked ───────────────────────────────────────────────────────
 *
 *   1. THE IDENTITY IS THE CAUSE, run through the shipped `alertKey`: two alerts from different
 *      event rows with the same `scope`+`event` must key IDENTICALLY, or a dismissal cannot
 *      survive the next occurrence. A deliverable alert must still key by its own id.
 *   2. "MARK RESOLVED" IS RENDERED FOR EVERY ALERT — no `del_` gate on the button.
 *   3. THE SERVER CAN ANSWER FOR EVERY ALERT, by recomputing the surface, while the
 *      `TERMINAL_CHECKS` path for an owned deliverable is untouched — that design refuses her
 *      assertion when the records disagree and must not be weakened into a recompute.
 *   4. THE SECOND STEP COMES TO HER: the reason box scrolls into view and takes focus.
 *   5. THE DISABLED BUTTON SAYS WHY IT IS DISABLED, and the required reason SURVIVES — the rule is
 *      good, the placement was what was broken.
 *
 * RULE 0: zero alert fixtures keyed, or no alert-action markup found to inspect, is a HARD FAILURE.
 *
 *   node scripts/validate/every-alert-can-be-answered.mjs
 *   node scripts/validate/every-alert-can-be-answered.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALERTS = "src/worker/boss/today/alerts.ts";
const ROUTE = "src/worker/boss/routes/today.ts";
const SCREEN = "src/client/boss/pages/Today.tsx";
const API = "src/client/boss/api.ts";

/**
 * THE SAME CAUSE, TWICE, FROM TWO DIFFERENT EVENT ROWS.
 *
 * This is the production case: five `queue`/`task_failed` rows, five distinct `evt_…` ids, one
 * condition. A dismissal is only worth pressing if these two key the same.
 */
export const KEY_FIXTURES = [
  {
    name: "the same cause seen twice, from two event rows",
    a: { severity: "medium", text: "A queued task failed 5 times in the last day — no model satisfied policy", source_type: "tasks", source_id: "evtclass:queue:task_failed" },
    b: { severity: "medium", text: "A queued task failed 2 times in the last day — no model satisfied policy", source_type: "tasks", source_id: "evtclass:queue:task_failed" },
    same: true,
    why: "she dismissed the condition, not the row — a new occurrence must not escape the snooze",
  },
  {
    name: "two different causes",
    a: { severity: "medium", text: "A queued task failed", source_type: "tasks", source_id: "evtclass:queue:task_failed" },
    b: { severity: "medium", text: "The nightly run failed", source_type: "tasks", source_id: "evtclass:cron:run_failed" },
    same: false,
    why: "dismissing one condition must never mute a different one",
  },
  {
    name: "an owned deliverable, keyed by its own id",
    a: { severity: "high", text: "x", source_type: "tasks", source_id: "del_westpeek_reply_path" },
    b: { severity: "high", text: "x, reworded since", source_type: "tasks", source_id: "del_westpeek_reply_path" },
    same: true,
    why: "the deliverable IS the subject and its sentence is expected to change every morning",
  },
];

export function check({ keyed, alerts, route, screen, api }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const screenCode = code(screen);
  const routeCode = code(route);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(keyed) || keyed.length === 0) {
    problems.push(`No alert fixtures were keyed. Rule 1 is the only behavioural check here and it examined nothing.`);
    return problems;
  }
  if (!/Mark resolved/.test(screenCode) || !/Dismiss/.test(screenCode)) {
    problems.push(
      `${SCREEN} has no alert action markup this scan can find. Every rule below is about those two ` +
      `controls, so the scan has examined nothing.`,
    );
    return problems;
  }

  // ── 1. The identity is the cause ─────────────────────────────────────────
  for (const row of keyed) {
    if (row.same && row.keyA !== row.keyB) {
      problems.push(
        `${row.name}: keyed "${row.keyA}" and "${row.keyB}" — they must match, because ${row.why}.`,
      );
    }
    if (!row.same && row.keyA === row.keyB) {
      problems.push(`${row.name}: both keyed "${row.keyA}" — they must differ, because ${row.why}.`);
    }
  }
  if (/source_id:\s*g\.newest_id/.test(routeCode)) {
    problems.push(
      `${ROUTE} still keys an error alert to \`g.newest_id\` — an \`evt_…\` primary key, unique per ` +
      `occurrence. A dismissal on it is dead on arrival: the same condition recurring gets a new id ` +
      `and sails past the snooze.`,
    );
  }

  // ── 2. Mark resolved renders for every alert ─────────────────────────────
  const buttonBlock = /Mark resolved/.exec(screenCode);
  const before = buttonBlock ? screenCode.slice(Math.max(0, buttonBlock.index - 900), buttonBlock.index) : "";
  if (/startsWith\("del_"\)\s*&&\s*\(/.test(before) || /source_id\?\.startsWith\("del_"\)\s*&&\s*\(\s*$/.test(before.trimEnd())) {
    problems.push(
      `${SCREEN} still gates the "Mark resolved" button on a \`del_\` source id. None of the alerts on ` +
      `her screen had one, so the button she reported as broken was not rendered at all.`,
    );
  }

  // ── 3. The server can answer for every alert, deliverables unchanged ─────
  if (!/assembleDayFlow\s*\(/.test(routeCode) || !/alert_rechecked/.test(routeCode)) {
    problems.push(
      `${ROUTE}'s resolve endpoint has no general re-test. Every alert on Today is derived on read, ` +
      `so recomputing the surface and looking for the key IS the honest re-check — and it needs no ` +
      `per-source registry to fall out of step with the producers.`,
    );
  }
  if (!/TERMINAL_CHECKS\[row\.terminal_check\]/.test(routeCode)) {
    problems.push(
      `${ROUTE} no longer re-verifies an owned deliverable through \`TERMINAL_CHECKS\`. That path does ` +
      `something recomputing cannot: it REFUSES her assertion when the records disagree, and says so. ` +
      `Replacing it with a recompute would let her close work that is not finished.`,
    );
  }
  if (!/deliverable_id/.test(code(api)) || !/\bkey\b/.test(code(api))) {
    problems.push(`${API}'s resolveAlert does not carry both a deliverable id and an alert key, so one class of alert has no way to be asked again.`);
  }

  // ── 4. The second step comes to her ──────────────────────────────────────
  if (!/scrollIntoView/.test(screenCode)) {
    problems.push(
      `${SCREEN} does not scroll the dismiss reason box into view. It renders below the fold behind ` +
      `the fixed bottom nav, so pressing Dismiss makes the button vanish and nothing else happen — ` +
      `which is exactly what "doesn't work" meant.`,
    );
  }
  if (!/\.focus\(\)/.test(screenCode)) {
    problems.push(`${SCREEN} does not focus the reason box, so the next thing she must do is not where the cursor is.`);
  }

  // ── 5. The disabled state speaks, and the rule survives ──────────────────
  if (!/Say why first/.test(screenCode)) {
    problems.push(
      `${SCREEN}'s dismiss button gives no reason for being disabled. It sat grey and silent until ` +
      `three characters were typed, on a control she had to scroll to find.`,
    );
  }
  if (!/reason\.trim\(\)\.length\s*<\s*3/.test(screenCode)) {
    problems.push(
      `${SCREEN} no longer requires a reason before a dismissal. That rule is a good decision and was ` +
      `never the defect — a snooze that cannot say why it was set arrives next week looking new.`,
    );
  }
  if (!/dismissAlert\(/.test(screenCode)) {
    problems.push(`${SCREEN} no longer offers dismissal at all.`);
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, ALERTS)}`);
  return KEY_FIXTURES.map((f) => ({
    name: f.name, same: f.same, why: f.why,
    keyA: mod.alertKey(f.a), keyB: mod.alertKey(f.b),
  }));
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const keyed = await evaluate();
  const good = {
    keyed,
    alerts: readFileSync(join(ROOT, ALERTS), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    api: readFileSync(join(ROOT, API), "utf8"),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE DEFECT: the same cause keyed differently per occurrence",
      input: { ...good, keyed: good.keyed.map((r, i) => (i === 0 ? { ...r, keyB: "tasks:evt_9" } : r)) },
      expect: 1,
    },
    {
      name: "two different causes collapsed onto one key",
      input: { ...good, keyed: good.keyed.map((r, i) => (i === 1 ? { ...r, keyB: r.keyA } : r)) },
      expect: 1,
    },
    {
      name: "the row id restored as the alert's identity",
      input: { ...good, route: `${good.route}\nalerts.push({ source_type: "tasks", source_id: g.newest_id });\n` },
      expect: 1,
    },
    {
      name: "THE DEFECT: Mark resolved gated back behind del_",
      input: {
        ...good,
        screen: good.screen.replace(
          '                <button\n                  className="btn"\n                  disabled={busy}\n                  onClick={() => run(async () => {\n                    const r = await api.resolveAlert({',
          '                {a.source_id?.startsWith("del_") && (\n                <button\n                  className="btn"\n                  disabled={busy}\n                  onClick={() => run(async () => {\n                    const r = await api.resolveAlert({',
        ),
      },
      expect: 1,
    },
    {
      name: "the general re-test removed from the endpoint",
      input: { ...good, route: good.route.replaceAll("assembleDayFlow", "somethingElse") },
      expect: 1,
    },
    {
      name: "TERMINAL_CHECKS replaced by a recompute for deliverables too",
      input: { ...good, route: good.route.replace("TERMINAL_CHECKS[row.terminal_check]", "null") },
      expect: 1,
    },
    {
      name: "the reason box no longer scrolled into view",
      input: { ...good, screen: good.screen.replaceAll("scrollIntoView", "noop") },
      expect: 1,
    },
    {
      name: "the reason box no longer focused",
      input: { ...good, screen: good.screen.replaceAll(".focus()", ".blur2()") },
      expect: 1,
    },
    {
      name: "the disabled button going silent again",
      input: { ...good, screen: good.screen.replace(/\{reason\.trim\(\)\.length < 3 \? "Say why first" : "Put it aside"\}/, "Put it aside") },
      expect: 1,
    },
    {
      name: "the required reason dropped instead of the placement fixed",
      input: { ...good, screen: good.screen.replaceAll("reason.trim().length < 3", "false") },
      expect: 1,
    },
    { name: "RULE 0 — nothing keyed", input: { ...good, keyed: [] }, expect: 1 },
    { name: "RULE 0 — no alert action markup at all", input: { ...good, screen: "// nothing here" }, expect: 1 },
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
    console.error(`\nevery-alert-can-be-answered self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`every-alert-can-be-answered self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [ALERTS, ROUTE, SCREEN, API].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`every-alert-can-be-answered FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const keyed = await evaluate();
  const problems = check({
    keyed,
    alerts: readFileSync(join(ROOT, ALERTS), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    api: readFileSync(join(ROOT, API), "utf8"),
  });

  if (problems.length) {
    console.error("every-alert-can-be-answered FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `every-alert-can-be-answered: ${keyed.length} keying fixtures behave (a cause keeps its key across ` +
    `occurrences, two causes stay apart), "Mark resolved" renders on every alert with the deliverable ` +
    `path intact, and the dismiss box comes to her and says what it is waiting for. OK.`,
  );
}
