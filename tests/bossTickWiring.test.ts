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

  it("runs every Boss lane, each in its own waitUntil", () => {
    const lanes = [
      "drainBossTasks(",
      "runBossDuties(",
      "runBossReaper(",
      "runBossOutreach(",
      "runBossEightraise(",
      "runBossOpenLoops(",
      "runBossKendra(",
      "runBossNightly(",
      "routeSimoneWhenMacIsDown(",
    ];
    for (const call of lanes) {
      expect(handler, `scheduled() no longer calls ${call}`).toContain(call);
    }
    // Each listed lane gets one waitUntil. The mail alarm and cloud clock get one each as well.
    expect((handler.match(/ctx\.waitUntil\(/g) ?? []).length).toBe(lanes.length + 2);
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
