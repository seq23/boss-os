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

const CHIEF_OF_STAFF =
  "Read what comes in. Decide what the Boss actually needs to see. Draft the recommendation, never the decision.";
const TASK_INTAKE =
  "Classify what comes in, pick the existing employee, template, or duty that fits, and refuse to invent a new employee when one already covers the work.";
const CONTINUITY =
  "Keep the system rebuildable. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.";
const MODEL_ROUTER =
  "Decide where work runs. Respect privacy class, benchmark status, risk ceiling, and budget. Record every decision, including the refusals.";
const KNOWLEDGE =
  "Turn conversation into candidate memory. Never promote anything yourself. Propose, cite the source, and let the gate decide.";

const member = (over: Partial<RosterMember> & { name: string; charter: string }): RosterMember => ({
  id: `emp_${over.name.toLowerCase().replace(/\W+/g, "_")}`,
  lane: "ops",
  department: null,
  ...over,
});

describe("charter overlap — what 'covers the same ground' actually means", () => {
  describe("the false positives the old detector produced", () => {
    it("does NOT call Chief of Staff and Task Intake the same job", () => {
      // Both triage incoming work, so this is the hardest honest case on the roster - and they are
      // still two jobs. If the threshold ever drifts low enough to catch this pair, it has become
      // the bug it replaced.
      const score = charterSimilarity(CHIEF_OF_STAFF, TASK_INTAKE);
      expect(score).toBeLessThan(SAME_GROUND);
    });

    it("does NOT call Model Router and Continuity the same job", () => {
      expect(charterSimilarity(CONTINUITY, MODEL_ROUTER)).toBeLessThan(SAME_GROUND);
    });

    it("reports nothing at all for the live roster's shape", () => {
      const roster = [
        member({ name: "Chief of Staff", charter: CHIEF_OF_STAFF, department: "Command + Operations" }),
        member({ name: "Task Intake", charter: TASK_INTAKE, department: "Command + Operations" }),
        member({ name: "Continuity", charter: CONTINUITY, department: "Continuity + Local Model" }),
        member({ name: "Model Router", charter: MODEL_ROUTER, department: "Continuity + Local Model" }),
        member({ name: "Knowledge", charter: KNOWLEDGE, department: "Knowledge + Memory" }),
      ];
      // Four of these five share a department in pairs. The old query returned two "duplicates".
      expect(overlappingCharters(roster)).toEqual([]);
    });
  });

  describe("what it must still catch", () => {
    it("catches a charter copied and lightly reworded", () => {
      const roster = [
        member({ name: "Continuity", charter: CONTINUITY }),
        member({
          name: "Continuity Two",
          charter:
            "Keep the system rebuildable. Verify the snapshots, run the restore drills, and make sure tomorrow resumes rather than starting over.",
        }),
      ];
      const found = overlappingCharters(roster);
      expect(found).toHaveLength(1);
      expect(found[0]!.similarity).toBeGreaterThanOrEqual(SAME_GROUND);
      expect([found[0]!.a.name, found[0]!.b.name].sort()).toEqual(["Continuity", "Continuity Two"]);
    });

    it("catches an identical charter", () => {
      const roster = [
        member({ name: "A", charter: MODEL_ROUTER }),
        member({ name: "B", charter: MODEL_ROUTER }),
      ];
      expect(overlappingCharters(roster)[0]!.similarity).toBe(1);
    });
  });

  describe("boundaries", () => {
    it("never pairs across lanes, because employees cannot be merged across them", () => {
      const roster = [
        member({ name: "Ops Twin", charter: MODEL_ROUTER, lane: "ops" }),
        member({ name: "Trading Twin", charter: MODEL_ROUTER, lane: "trading" }),
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
      expect(charterSimilarity(CONTINUITY, null)).toBe(0);
    });

    it("is symmetric, so the roster's ordering cannot change the answer", () => {
      expect(charterSimilarity(CHIEF_OF_STAFF, TASK_INTAKE)).toBe(
        charterSimilarity(TASK_INTAKE, CHIEF_OF_STAFF),
      );
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
         VALUES ('emp_dupe_probe','ops','Continuity Copy','Continuity', ?, 'ask','active', ?, 'Continuity + Local Model','active')`,
      )
      .bind(
        // Continuity's charter, verbatim from migration 0155. An exact copy is the clearest
        // possible duplicate, and if the endpoint cannot see this one it cannot see any.
        "Keep the system rebuildable. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.",
        now,
      )
      .run();

    try {
      const { body } = await apiJson("/api/employees/review/sprawl");
      const names = body.data.overlapping_charters.flatMap((o: any) => [o.a.name, o.b.name]);
      expect(names).toContain("Continuity Copy");
      expect(names).toContain("Continuity");
    } finally {
      await env.DB.prepare(`DELETE FROM employees WHERE id = 'emp_dupe_probe'`).run();
    }
  });
});
