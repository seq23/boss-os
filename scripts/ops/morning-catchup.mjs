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
 *   npm run morning:catchup
 */
import { execFileSync } from "node:child_process";
import { bossApi } from "./lib/duty-kit.mjs";
import { readMorningSections } from "../../src/shared/boss/mail/morning.mjs";
import { MORNING_SECTION_SPECS, sectionsNotReported, catchUpPlan } from "../../src/shared/boss/mail/morningSections.mjs";

const TZ = "America/Chicago";
const CATCHUP_TIMEOUT_MS = 8 * 60_000;

/** Today's weekday in her zone, the word MORNING_SECTION_SPECS' `expect` arrays use. Pure. */
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
  const store = await api.get("/morning/sections").then((d) => d?.rows ?? []).catch((e) => {
    console.error(`morning-catchup: the morning sections in Boss OS not read (${e.message}); the Mac files only`);
    return null;
  });
  return readMorningSections({ now, store });
}

function runCatchUp(command) {
  console.log(`morning-catchup: running npm run ${command}`);
  try {
    execFileSync("npm", ["run", "--silent", ...command.split(" ")], { stdio: "inherit", timeout: CATCHUP_TIMEOUT_MS });
  } catch (e) {
    console.error(`morning-catchup: "npm run ${command}" failed (${e.message})`);
  }
}

async function main() {
  const now = Date.now();
  const weekday = weekdayIn(TZ, now);
  const expectedCount = MORNING_SECTION_SPECS.filter((s) => s.expect?.includes(weekday)).length;
  if (expectedCount === 0) {
    console.error(`NAMED STOP [MORNING_CATCHUP_NOTHING_CHECKED] no section in the registry is expected on a ${weekday}.`);
    process.exit(5);
  }

  const api = await bossApi();
  const before = await readSections(api, now);
  const { missing: missingBefore } = sectionsNotReported(before.sections, { weekday, now });

  if (missingBefore.length === 0) {
    console.log(`MORNING-CATCHUP-COMPLETE: ${expectedCount} expected, 0 re-run, 0 still missing.`);
    return;
  }

  const plan = catchUpPlan(missingBefore);
  for (const command of plan.commands) runCatchUp(command);
  for (const c of plan.cannotCatchUp) console.log(`morning-catchup: "${c.label}" stays missing — ${c.why}`);

  const after = await readSections(api, Date.now());
  const { missing: missingAfter } = sectionsNotReported(after.sections, { weekday, now: Date.now() });
  const outcome = catchUpOutcome({ missingBefore, missingAfter, plan });

  console.log(`MORNING-CATCHUP-COMPLETE: ${expectedCount} expected, ${outcome.reRun} re-run, ${outcome.stillMissing} still missing.`);
  if (outcome.stop) {
    console.error(`NAMED STOP [${outcome.stop}] ${outcome.names.join(", ")} ran again and is still missing.`);
    process.exit(6);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`MORNING CATCHUP FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
