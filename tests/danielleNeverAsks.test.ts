/**
 * WORK BOSS OS STARTED ITSELF NEVER ASKS HER (owner, 2 Nov 2026: "I'd rather Danielle have not asked
 * me anything and just fixed it all"). The runner's side; tests/boss/danielleNeverAsks.test.ts pins
 * the Worker routes.
 */
import { describe, expect, it } from "vitest";
import { actionTask } from "../scripts/ops/waiting-on.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { redChecksPlan, repairDoneLine } from "../scripts/ops/repo-change.mjs";
import { repairOriginOf, MAX_REWORKS } from "../src/shared/boss/repoChange/lane.mjs";
import { ownerTextProblems } from "../src/shared/boss/repoChange/repairReport.mjs";

const ITEM = { id: "wo_wpp_thin", what: "WPP-llm thin pages: measure", owner: "emp_repo", action: "seq23/boss-os — measure the thin pages", kind: "measurement" };

describe("Danielle never asks her about work Boss OS started itself (2 Nov 2026)", () => {
  it("a due waiting-on action opens a REPAIR, so it never gets a plan email", () => {
    const t = actionTask(ITEM);
    expect(t.employee_id).toBe("emp_repo");
    expect(t.input.waiting_on).toBe("wo_wpp_thin");
    expect(repairOriginOf(t.input)).toEqual({ origin: "repair", repair_kind: "waiting_on" });
    // A task row written by the older runner (origin "waiting_on") is a repair too.
    expect(repairOriginOf({ origin: "waiting_on" }).origin).toBe("repair");
    expect(repairOriginOf({ origin: "repair", repair_kind: "open_loop_overdue" }).origin).toBe("repair");
    expect(repairOriginOf({}).origin).toBe("owner");
  });

  it("red checks are rework for ANY change; past the budget only her own request is emailed", () => {
    for (const origin of ["repair", "owner"]) for (let n = 0; n < MAX_REWORKS; n++) expect(redChecksPlan({ origin, rework_count: n })).toEqual({ action: "rework", emails: false });
    expect(redChecksPlan({ origin: "repair", rework_count: MAX_REWORKS })).toEqual({ action: "record", emails: false });
    expect(redChecksPlan({ origin: "owner", rework_count: MAX_REWORKS })).toEqual({ action: "email", emails: true });
  });

  it("a landed repair is one plain morning line", () => {
    const line = repairDoneLine({ id: "rc_x", repair_kind: "waiting_on" }, { in_plain: { what_we_did: "Filled the thin pages on the site." } });
    expect(line).toBe("Danielle fixed it: Filled the thin pages on the site.");
    expect(ownerTextProblems(line)).toEqual([]);
    expect(ownerTextProblems(repairDoneLine({ id: "rc_x", repair_kind: "waiting_on" }, { in_plain: { what_we_did: "edited `scripts/x.mjs` --flag" } }))).toEqual([]);
  });
});
