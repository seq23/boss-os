import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * EVERYTHING THE HOURLY TICK IS SUPPOSED TO DO IS ACTUALLY CALLED FROM IT.
 *
 * "Exists but nothing invokes it" is the defect class this repository names most often, and a
 * function on a cron is its favourite home: `reapSilentRuns` would compile, test green and never
 * run if the `waitUntil` in `scheduled()` were dropped in a refactor. Read off the source, because
 * nothing in the test suites drives the Worker's `scheduled()` export itself.
 */
describe("the Worker's scheduled() handler", () => {
  const src = readFileSync("src/worker/index.ts", "utf8");
  const handler = src.slice(src.indexOf("async scheduled("), src.indexOf("} satisfies ExportedHandler"));

  // The five-minute branch (`if (event?.cron === MAIL_ALARM_CRON) { … return; }`) and the hourly rest.
  const fiveStart = handler.indexOf("if (event?.cron === MAIL_ALARM_CRON)");
  // The branch's own closing `return;` (six-space indent), not the owner-stop early return inside it.
  const fiveEnd = handler.indexOf("\n      return;\n", fiveStart);
  const five = handler.slice(fiveStart, fiveEnd);
  const hourly = handler.slice(fiveEnd);

  it("runs every Boss lane, each in its own waitUntil", () => {
    const lanes = [
      "runBossDuties(",
      "runBossReaper(",
      "runBossOutreach(",
      "runBossEightraise(",
      "runBossOpenLoops(",
      "runBossKendra(",
      "runBossNightly(",
    ];
    for (const call of lanes) {
      expect(hourly, `the hourly tick no longer calls ${call}`).toContain(call);
    }
    expect((hourly.match(/ctx\.waitUntil\(/g) ?? []).length).toBe(lanes.length);
    // The */5 tick: the mail alarm, the cloud clock, Simone's cloud fallback, and the work mover (duty clock
    // then drain): one waitUntil each.
    expect(fiveStart).toBeGreaterThan(-1);
    expect(five).toContain("routeSimoneWhenMacIsDown(");
    expect((five.match(/ctx\.waitUntil\(/g) ?? []).length).toBe(4);
  });

  /*
   * The owner's stop switch ("stop everything") on the reworked tick (#586 merged into #582, 27 Nov 2026).
   * Only the "no Got it yet" alarm runs while she has stopped operations, so she still hears that mail
   * went unanswered; nothing that moves work (cloud clock, Simone's fallback, duty clock, drain) and no
   * hourly lane starts before the stop is read.
   */
  it("reads the owner's stop before anything that moves work, on both ticks", () => {
    const STOP = "if (await operatingStopped(env.WP_OS_DB)) return;";
    const fiveStop = five.indexOf(STOP);
    expect(fiveStop, "the five-minute tick no longer reads the owner's stop").toBeGreaterThan(-1);
    expect(five.indexOf("runMailAlarm(")).toBeLessThan(fiveStop);
    for (const call of ["runBossCloudClock(", "routeSimoneWhenMacIsDown(", "runBossDutyClock(", "drainBossTasks("]) {
      expect(five.indexOf(call), `${call} is missing from the five-minute tick`).toBeGreaterThan(-1);
      expect(five.indexOf(call), `${call} runs before the owner's stop is read`).toBeGreaterThan(fiveStop);
    }
    const hourlyStop = hourly.indexOf(STOP);
    expect(hourlyStop, "the hourly tick no longer reads the owner's stop").toBeGreaterThan(-1);
    expect(hourly.indexOf("ctx.waitUntil(")).toBeGreaterThan(hourlyStop);
    // The drain that a request triggers checks the stop itself (bossMount drainBossTasks).
    const mount = readFileSync("src/worker/bossMount.ts", "utf8");
    const drain = mount.slice(mount.indexOf("export async function drainBossTasks("));
    expect(drain.slice(0, drain.indexOf("\n}\n"))).toMatch(/if \(await operatingStopped\(db\)\) return \{ ran: 0, failed: 0, dead: 0 \};/);
  });

  /*
   * 27 Nov 2026: Camille's briefing was late for the morning email. The duty clock and the queue drain rode the
   * HOURLY tick while the five-minute tick returned before them, so a duty due at 04:00 was a task that no seat had
   * been handed when her Mac's 04:05 slot asked, and a duty due off the hour waited up to 59 minutes to exist.
   */
  it("moves work on the five-minute tick: the duty clock, then the drain, in that order", () => {
    const clock = five.indexOf("runBossDutyClock(");
    const drain = five.indexOf("drainBossTasks(");
    expect(clock, "the five-minute tick does not run the duty clock").toBeGreaterThan(-1);
    expect(drain, "the five-minute tick does not drain the queue").toBeGreaterThan(-1);
    expect(clock).toBeLessThan(drain);
    // Chained, so a duty that comes due on this tick is drained on this tick (two waitUntils would race).
    expect(five.slice(clock, drain)).toMatch(/\.then\(\(\) => $/m);
  });

  it("and only there: the hourly tick neither materialises duties nor drains, so two ticks at :00 never race a duty's clock", () => {
    expect(hourly).not.toContain("runBossDutyClock(");
    expect(hourly).not.toContain("drainBossTasks(");
    const boss = readFileSync("src/worker/boss/index.ts", "utf8");
    const runDuties = boss.slice(boss.indexOf("export async function runDuties("), boss.indexOf("export async function runDutyClock("));
    expect(runDuties).not.toContain("materialiseDueDuties(");
  });

  it("no longer runs the copied West Peek fund jobs (chassis retirement, 22 Nov 2026)", () => {
    // West Peek OS runs diagnostics_sweep, deck_reading and network_sync itself; the pause
    // migration in #531 switched the rows off here. The tick must not reach the chassis scheduler.
    expect(handler).not.toMatch(/runDueJobs\s*\(/);
    // Nor may the Worker entry import it: the imports sit at the top of the file, not in the handler.
    const jobsImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/services\/jobs"/.exec(src)?.[1] ?? "";
    expect(jobsImport).not.toMatch(/\brunDueJobs\b/);
  });

  it("the reaper is the Boss module's, re-exported through the mount like the duties are", () => {
    const mount = readFileSync("src/worker/bossMount.ts", "utf8");
    expect(mount).toMatch(/runReaper as runBossReaper/);
    expect(mount).toMatch(/export \{[^}]*runBossReaper[^}]*\}/);
  });
});
