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

  it("runs the chassis jobs, the Boss drain, the duties, the reaper and the nightly, each in its own waitUntil", () => {
    for (const call of ["runDueJobs(", "drainBossTasks(", "runBossDuties(", "runBossReaper(", "runBossNightly("]) {
      expect(handler, `scheduled() no longer calls ${call}`).toContain(call);
    }
    expect((handler.match(/ctx\.waitUntil\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("the reaper is the Boss module's, re-exported through the mount like the duties are", () => {
    const mount = readFileSync("src/worker/bossMount.ts", "utf8");
    expect(mount).toMatch(/runReaper as runBossReaper/);
    expect(mount).toMatch(/export \{[^}]*runBossReaper[^}]*\}/);
  });
});
