import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  SAME_GROUND,
  charterSimilarity,
  overlappingCharters,
  type RosterMember,
} from "../../src/shared/boss/rosterOverlap";
import { apiJson } from "./helpers";

/**
 * THE NEAR-MISS IS THE POINT OF THIS SUITE.
 *
 * The detector it replaces fired on the live roster and was wrong every time, because it measured
 * department co-membership and reported it as shared work. So the load-bearing tests here are the
 * ones asserting that real, distinct employees who happen to sit together do NOT trip it. A
 * detector that flags everything is as useless as one that flags nothing.
 *
 * The charters below are the real ones, verbatim from migration 0155. Paraphrasing them would
 * make this suite a test of my paraphrase rather than of the roster the owner actually has.
 */

/*
 * THE ROSTER AS OF 0175, verbatim. Seven people with real jobs, after Task Intake merged into the
 * Chief of Staff and Model Router merged into the Systems Manager.
 *
 * The merges REMOVED the old hardest near-miss: Chief of Staff and Task Intake both triaged
 * incoming work, and the owner's answer was that they were one job all along. What remains as the
 * closest honest pair is ZORA and CAMILLE - one turns conversation into candidate memory citing its
 * source, the other reports on the world refusing to state anything unsourced. Both are about
 * evidence, and they are still two jobs. That pair is now the test that matters.
 */
const SIMONE =
  "Read what comes in and decide what the Boss actually needs to see. Classify it, route it to the employee, template or duty that already fits, and write the permission envelope for that run. Refuse to invent a new employee when one already covers the work. Draft the recommendation, never the decision.";
const KENDRA =
  "Keep the system running and rebuildable. Decide where work runs - honouring privacy class, benchmark status, risk ceiling, cost mode and budget - and record every decision including the refusals. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.";
const ZORA =
  "Turn conversation into candidate memory. Never promote anything yourself. Propose, cite the source, and let the gate decide.";
const CAMILLE =
  "Deliver the Executive Intelligence Report every morning. Never invent a figure: no price, move, market cap, funding round, ruling or filing that has not been verified against a named source, and if a required fact cannot be verified, say so and name the gap rather than omitting it. Current data must be current - every figure carries when it was read. Keep fact and analysis structurally apart. Correct yesterday's report when today's reading contradicts it.";
const DANIELLE =
  "Prepare repository work as artifacts and scoped changes. You do not commit, merge, or deploy. Every mutation is a proposal with evidence.";
const MONIQUE =
  "Track who matters and what was promised. Prepare the Boss before the room and capture what was said after. Never send anything outward.";
const TONI =
  "Guard the trading lane. Check every order against the authority envelope. You have no execution authority and never will by default.";

const member = (over: Partial<RosterMember> & { name: string; charter: string }): RosterMember => ({
  id: `emp_${over.name.toLowerCase().replace(/\W+/g, "_")}`,
  lane: "ops",
  department: null,
  ...over,
});

describe("charter overlap — what 'covers the same ground' actually means", () => {
  describe("the false positives the old detector produced", () => {
    it("does NOT call Zora and Camille the same job — the closest honest pair", () => {
      // Both are about evidence and sourcing, which is exactly the kind of surface similarity that
      // fooled the old detector. If the threshold ever drifts far enough to catch this pair, it has
      // become the bug it replaced.
      expect(charterSimilarity(ZORA, CAMILLE)).toBeLessThan(SAME_GROUND);
    });

    it("does NOT call Simone and Kendra the same job", () => {
      // Both speak about routing work. One routes it to a PERSON, the other to a MODEL.
      expect(charterSimilarity(SIMONE, KENDRA)).toBeLessThan(SAME_GROUND);
    });

    it("reports nothing at all for the live roster", () => {
      const roster = [
        member({ name: "Simone", charter: SIMONE, department: "Office of the Principal" }),
        member({ name: "Camille", charter: CAMILLE, department: "Research" }),
        member({ name: "Danielle", charter: DANIELLE, department: "Engineering" }),
        member({ name: "Zora", charter: ZORA, department: "Records" }),
        member({ name: "Monique", charter: MONIQUE, department: "Relationships" }),
        member({ name: "Kendra", charter: KENDRA, department: "Systems" }),
        member({ name: "Toni", charter: TONI, lane: "trading", department: "Risk" }),
      ];
      // Every one of the seven does work no other one does. The detector must say so.
      expect(overlappingCharters(roster)).toEqual([]);
    });
  });

  describe("what it must still catch", () => {
    it("catches a charter copied and lightly reworded", () => {
      const roster = [
        member({ name: "Kendra", charter: KENDRA }),
        member({
          name: "Kendra Two",
          charter:
            "Keep the system running and rebuildable. Decide where the work runs - honouring the privacy class, benchmark status, risk ceiling, cost mode and budget - and record each decision including the refusals. Verify the snapshots, run the restore drills, and make sure tomorrow resumes instead of starting over.",
        }),
      ];
      const found = overlappingCharters(roster);
      expect(found).toHaveLength(1);
      expect(found[0]!.similarity).toBeGreaterThanOrEqual(SAME_GROUND);
      expect([found[0]!.a.name, found[0]!.b.name].sort()).toEqual(["Kendra", "Kendra Two"]);
    });

    it("catches an identical charter", () => {
      const roster = [
        member({ name: "A", charter: KENDRA }),
        member({ name: "B", charter: KENDRA }),
      ];
      expect(overlappingCharters(roster)[0]!.similarity).toBe(1);
    });
  });

  describe("boundaries", () => {
    it("never pairs across lanes, because employees cannot be merged across them", () => {
      const roster = [
        member({ name: "Ops Twin", charter: KENDRA, lane: "ops" }),
        member({ name: "Trading Twin", charter: KENDRA, lane: "trading" }),
      ];
      expect(overlappingCharters(roster)).toEqual([]);
    });

    it("treats a missing charter as no evidence rather than as a match", () => {
      // Two employees with nothing written down are not proven duplicates; they are unexamined.
      // Scoring them as identical would fabricate a finding out of an absence.
      const roster = [
        member({ name: "Blank One", charter: "" }),
        member({ name: "Blank Two", charter: "" }),
      ];
      expect(overlappingCharters(roster)).toEqual([]);
      expect(charterSimilarity(null, null)).toBe(0);
      expect(charterSimilarity(KENDRA, null)).toBe(0);
    });

    it("is symmetric, so the roster's ordering cannot change the answer", () => {
      expect(charterSimilarity(ZORA, CAMILLE)).toBe(charterSimilarity(CAMILLE, ZORA));
    });
  });
});

describe("the sprawl endpoint", () => {
  it("separates the roster fact from the accusation", async () => {
    const { status, body } = await apiJson("/api/employees/review/sprawl");
    expect(status).toBe(200);
    expect(body.data.roster_size).toBeGreaterThan(0);

    // The old key is gone. It carried a claim the query could not support.
    expect(body.data).not.toHaveProperty("duplicate_departments");
    expect(body.data).toHaveProperty("shared_departments");
    expect(body.data).toHaveProperty("overlapping_charters");

    // The seeded roster contains no genuine duplicates, and the endpoint must say so plainly
    // rather than reporting the departments they share as if it were the same finding.
    expect(body.data.overlapping_charters).toEqual([]);
  });

  it("finds a real duplicate once one exists, proving the endpoint is not simply always empty", async () => {
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO employees (id, lane, name, role, charter, autonomy, status, created_at, department, lifecycle)
         VALUES ('emp_dupe_probe','ops','Kendra Copy','Systems Manager', ?, 'ask','active', ?, 'Continuity + Local Model','active')`,
      )
      .bind(
        // Kendra's charter, verbatim from migration 0175. An exact copy is the clearest possible
        // duplicate, and if the endpoint cannot see this one it cannot see any.
        "Keep the system running and rebuildable. Decide where work runs - honouring privacy class, benchmark status, risk ceiling, cost mode and budget - and record every decision including the refusals. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.",
        now,
      )
      .run();

    try {
      const { body } = await apiJson("/api/employees/review/sprawl");
      const names = body.data.overlapping_charters.flatMap((o: any) => [o.a.name, o.b.name]);
      expect(names).toContain("Kendra Copy");
      expect(names).toContain("Kendra");
    } finally {
      await env.DB.prepare(`DELETE FROM employees WHERE id = 'emp_dupe_probe'`).run();
    }
  });
});
