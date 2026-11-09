#!/usr/bin/env node
/**
 * THE MORNING CATCH-UP (repair rc_m6gtk44dhfjq6rvj, 3 Nov 2026).
 *
 * 3 Nov 2026: the Mac rebooted at 07:11:52 Eastern, 39 minutes into com.seq.boss-capital's
 * ledger-hunt stage, killing the chain before its fourth stage (capital:grid, the producer of
 * "deals" and "monique_found") ever ran. Nothing re-ran it, so Simone's 06:40 email went without
 * them. Rule 0 now runs here, 06:32 Central, eight minutes before the email: a section the registry
 * expects today either reports in, or its producer runs again right now, or it is a NAMED STOP.
 *
 * Only a producer that sends nothing may be caught up (`catchUp` in MORNING_SECTION_SPECS, proved
 * against SENDING_PATTERNS by tests/morningCatchup.test.ts) — re-running a sender blind, this close
 * to the email, could put a second message in front of a real person. Everything else keeps the
 * existing repair path (your-day.mjs notReportedRepairs), which this does not replace.
 *
 * 9 Nov 2026 (repair rc_m708yvvt99yvy416): the Mac was OFF through 05:30-06:40 (booted 07:36 Central).
 * launchd never replays a calendar slot missed across a shutdown, so neither the capital chain nor this
 * 06:32 run fired, and "deals" missed the email again. The plist now also runs this when the Mac comes
 * up (RunAtLoad, scripts/ops/install-morning-catchup.sh). A run after 06:40 Central cannot save today's
 * email (it is already sent): it writes Today and tomorrow's email, and its completion line says so
 * (`catchUpWindow`), so a boot-time run never claims to have saved the email.
 *
 *   npm run morning:catchup
 */
import { execFileSync } from "node:child_process";
import { bossApi } from "./lib/duty-kit.mjs";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";
import { readMorningSections, freshSections } from "../../src/shared/boss/mail/morning.mjs";
import { MORNING_SECTION_SPECS, sectionsNotReported, catchUpPlan } from "../../src/shared/boss/mail/morningSections.mjs";

const TZ = "America/Chicago";
/** Before the email: eight minutes, so the email is never raced. After it there is no deadline, so a
 * long producer (catchUpLongWhy, e.g. the Monday sites:audit: 7 minutes for 27 sites on 2 Nov) runs
 * too, within 45 minutes so a boot run never hangs (repair rc_m708yx6am3k3arpe, 9 Nov 2026). */
const BUDGET_MS = Object.freeze({ before_email: 8 * 60_000, after_email: 45 * 60_000 });

/** How long this run may spend, and whether long producers run. Pure. */
export function catchUpBudget(window) {
  return { long: window === "after_email", budgetMs: BUDGET_MS[window] ?? BUDGET_MS.before_email };
}
/** Simone's morning email, minutes after midnight Central (job-your-day.yml, 06:40). */
export const EMAIL_MINUTE_CENTRAL = 6 * 60 + 40;

/**
 * Was this run before or after the morning email? Read in Central, whatever zone the Mac is in. Pure.
 * "before_email" → it can still put a section in today's email; "after_email" → Today and tomorrow's.
 */
export function catchUpWindow(now = Date.now(), tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error(`NAMED STOP [MORNING_CATCHUP_CLOCK] could not read the time in ${tz}`);
  return hour * 60 + minute < EMAIL_MINUTE_CENTRAL ? "before_email" : "after_email";
}

/** The words for the completion line. Pure. */
export function windowWords(window) {
  return window === "before_email" ? "before the 06:40 email" : "after the 06:40 email: for Today and tomorrow's email";
}

/** Today's weekday in her zone, the word MORNING_SECTION_SPECS' `expect` arrays use. Pure. */
export function expectedSections(weekday, specs = MORNING_SECTION_SPECS) {
  const count = specs.filter((s) => s.expect?.includes(weekday)).length;
  if (!count) throw new Error(`NAMED STOP [MORNING_CATCHUP_NOTHING_CHECKED] no section expected on ${weekday}`);
  return count;
}

export function weekdayIn(tz, now = Date.now()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(now));
}

/** Of what was missing before the catch-up ran, the ones it actually attempted (had a `catchUp`). Pure. */
export function attemptedNames(missingBefore, plan) {
  const cannot = new Set(plan.cannotCatchUp.map((c) => c.name));
  return (missingBefore ?? []).filter((m) => !cannot.has(m.name)).map((m) => m.name);
}

/**
 * RULE 0 (repair rc_m6gtk44dhfjq6rvj): a section that had a `catchUp` and ran again but is still
 * missing is a NAMED STOP, named; otherwise how many were re-run and how many are still missing
 * (expected — a `catchUpWhy` section stays on the existing repair path, notReportedRepairs). Pure.
 */
export function catchUpOutcome({ missingBefore, missingAfter, plan }) {
  const attempted = attemptedNames(missingBefore, plan);
  const stillMissing = (missingAfter ?? []).filter((m) => attempted.includes(m.name));
  return {
    stop: stillMissing.length ? "MORNING_CATCHUP_STILL_MISSING" : null,
    names: stillMissing.map((m) => m.name),
    reRun: attempted.length,
    stillMissing: (missingAfter ?? []).length,
  };
}

async function readSections(api, now) {
  const store = await api.get("/morning/sections");
  if (!Array.isArray(store?.rows)) throw new Error("NAMED STOP [MORNING_STORE_UNREADABLE] no section rows returned");
  const local = readMorningSections({ now, store: store.rows });
  for (const why of local.skipped) console.error(`morning-catchup: ${why}`);
  // The email now reads the cloud store. A fresh Mac file cannot prove its post succeeded.
  return freshSections(store.rows.map((r) => ({ name: r.section, obj: r.body })), now, "store");
}

function runCatchUp(command, timeout) {
  console.log(`morning-catchup: running npm run ${command}`);
  try {
    execFileSync("npm", ["run", "--silent", ...command.split(" ")], { stdio: "inherit", timeout });
  } catch (e) {
    console.error(`morning-catchup: "npm run ${command}" failed (${e.message})`);
  }
}

async function main() {
  const now = Date.now();
  const weekday = weekdayIn(TZ, now);
  const expectedCount = expectedSections(weekday);
  const window = catchUpWindow(now);
  const when = windowWords(window);
  const { long, budgetMs } = catchUpBudget(window);

  const api = await bossApi();
  const before = await readSections(api, now);
  const { missing: missingBefore } = sectionsNotReported(before.sections, { weekday, now });

  if (missingBefore.length === 0) {
    console.log(`MORNING-CATCHUP-COMPLETE: ${expectedCount} expected, 0 re-run, 0 still missing (${when}).`);
    console.log(outputLine(0, "sections re-run"));
    return;
  }

  const plan = catchUpPlan(missingBefore, { long });
  const deadline = Date.now() + budgetMs;
  for (const command of plan.commands) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    runCatchUp(command, remaining);
  }
  for (const c of plan.cannotCatchUp) console.log(`morning-catchup: "${c.label}" stays missing — ${c.why}`);

  const after = await readSections(api, Date.now());
  const { missing: missingAfter } = sectionsNotReported(after.sections, { weekday, now: Date.now() });
  const outcome = catchUpOutcome({ missingBefore, missingAfter, plan });

  console.log(`MORNING-CATCHUP-COMPLETE: ${expectedCount} expected, ${outcome.reRun} re-run, ${outcome.stillMissing} still missing (${when}).`);
  console.log(outputLine(outcome.reRun, "sections re-run"));
  if (outcome.stop) {
    console.error(`NAMED STOP [${outcome.stop}] ${outcome.names.join(", ")} ran again and is still missing.`);
    process.exit(6);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`MORNING CATCHUP FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
