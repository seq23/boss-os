/**
 * REPAIRS NEVER WAIT ON HER (26 Oct 2026). Two repairs of Camille's failed report stopped NAMED STOP
 * [POST_LAND_STEP_UNRESOLVED] on a plan that said "Nothing runs after landing." and each emailed her
 * "Decide: Try again or drop the boss-os change", naming no change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namesPostLandStep } from "../src/shared/boss/repoChange/lane.mjs";

const RUNNER = readFileSync(join(__dirname, "../scripts/ops/repo-change.mjs"), "utf8");

describe("a plan that says nothing runs after land names no step", () => {
  it("the 26 Oct plan's own sentence, and its kin, resolve to no step", () => {
    for (const t of [
      "Proven live, today: this morning's briefing, 17 searches,\n  24 sources, no error. Nothing runs after landing.",
      "No step runs after land.", "Post-land step: none.", "There is no post-land step.", "No command is needed after the merge lands; nothing runs after landing.",
    ]) expect(namesPostLandStep(t), t).toBe(false);
  });
  it("a sentence that names a step still does (the 21 Sep shape stays caught)", () => {
    for (const t of ["After land: loop/channel_about.py pushed from the Mac.", "Once it is merged, run the sync.", "Post-land: push the channel copy."]) expect(namesPostLandStep(t), t).toBe(true);
  });
});

describe("the runner never stops a repair for a post-land step, and never emails her a Decide for one", () => {
  const fail = RUNNER.slice(RUNNER.indexOf("async function fail(row, tag, why, log) {"), RUNNER.indexOf("async function release("));
  it("fail(): a repair is recorded and returns before any email is built", () => {
    const repairAt = fail.indexOf("if (isRepair(row)) {");
    expect(repairAt).toBeGreaterThan(0);
    const branch = fail.slice(repairAt, fail.indexOf("return;", repairAt));
    expect(branch).not.toMatch(/email\(|stoppedMail/);
    expect(repairAt).toBeLessThan(fail.indexOf("stoppedMail("));
  });
  it("the plan check reads namesPostLandStep and lets a repair through", () => {
    expect(RUNNER).toMatch(/let namesStep = namesPostLandStep\(/);
    expect(RUNNER).toMatch(/isRepair\(row\)\) \{\s*\/\/ REPAIRS NEVER STOP HERE/);
  });
});
