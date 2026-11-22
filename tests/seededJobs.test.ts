import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * No migration seeds scheduled_job the swallowing way.
 *
 * The dispatcher that ran these rows (services/jobs.ts) retired with the chassis on 22 Nov 2026; the
 * migration guard below stays, because the table and its history stay.
 *
 * WHY THIS TEST EXISTS. Migration 0046 registered `monthly_room_proposal` with `INSERT OR IGNORE`
 * and omitted a NOT NULL column. The constraint violation was swallowed, the migration reported
 * success, schema_version advanced, and the job existed in no database at all — discovered only by
 * querying production by hand. Nothing in the suite would have caught it.
 *
 * Seeding is the one place a migration can "succeed" while doing nothing, so the seeded rows need
 * an assertion of their own rather than trust in the migration runner.
 */

describe("no migration seeds with INSERT OR IGNORE into scheduled_job", () => {
  it("has a compensating migration for every job grandfathered on the promise of one", () => {
    /*
     * A grandfather list is a place bugs go to be forgiven, so the two entries added on 22 Aug 2026
     * are only exempt because `0127` re-inserts the job the loud way. If that file is ever deleted
     * or loses its guard, the exemption stops being true — and a comment saying "compensated
     * elsewhere" would go on passing. This checks the compensation is really there.
     */
    const dir = fileURLToPath(new URL("../migrations", import.meta.url));
    const compensating = readFileSync(join(dir, "0127_the_diagnostics_job_is_provably_there.sql"), "utf8");
    expect(compensating).toContain("INSERT INTO scheduled_job");
    expect(compensating).toContain("WHERE NOT EXISTS");
    expect(compensating).toContain("diagnostics_sweep");
    // And it must not itself use the swallowing form for the job row. Comments are stripped first:
    // this file EXPLAINS the pattern it is compensating for, and a scan that cannot tell prose from
    // SQL would fail on the explanation — the same trap the design-token validator hit when its own
    // documentation contained the violation it was written to catch.
    const sql = compensating
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .replace(/INSERT OR IGNORE INTO schema_version[^;]*;/g, "");
    expect(sql).not.toContain("INSERT OR IGNORE");
  });

  it("uses WHERE NOT EXISTS instead, so a constraint failure is loud", () => {
    const dir = fileURLToPath(new URL("../migrations", import.meta.url));
    const GRANDFATHERED = new Set([
      "0018_orchestration.sql",
      "0043_scheduled_briefings.sql",
      "0046_monthly_room_proposal.sql",
      // 0112 and 0113 seeded `diagnostics_sweep` the swallowing way — 0113 is even named "the
      // diagnostics job actually lands" and used the form that loses rows to land it. Both are
      // applied and cannot be edited, so `0127_the_diagnostics_job_is_provably_there.sql`
      // compensates: it re-inserts the job with WHERE NOT EXISTS, so on any database where the row
      // was silently dropped it is created, and any constraint failure now aborts loudly.
      "0112_diagnostics_runs_on_the_clock.sql",
      "0113_the_diagnostics_job_actually_lands.sql",
    ]);
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      // Grandfathered. These predate the rule and their rows demonstrably exist, so rewriting
      // them would churn working history for nothing. 0046 is the one that actually failed and is
      // left in place on purpose: an applied migration does not re-run, and editing it would make
      // the history lie about what happened. 0047 is the fix.
      if (GRANDFATHERED.has(file)) continue;
      const sql = readFileSync(`${dir}/${file}`, "utf8");
      if (/INSERT\s+OR\s+IGNORE\s+INTO\s+scheduled_job/i.test(sql)) offenders.push(file);
    }
    expect(offenders, "seed scheduled_job with INSERT … SELECT … WHERE NOT EXISTS").toEqual([]);
  });
});
