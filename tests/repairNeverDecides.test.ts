/**
 * REPAIRS NEVER WAIT ON HER (26 Oct 2026). Two repairs of Camille's failed report stopped NAMED STOP
 * [POST_LAND_STEP_UNRESOLVED] on a plan that said "Nothing runs after landing." and each emailed her
 * "Decide: Try again or drop the boss-os change", naming no change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRepair, namesPostLandStep } from "../src/shared/boss/repoChange/lane.mjs";

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
  it("ordinary English negations that POST_LAND_NONE's five nouns miss still read as no step (27 Oct 2026)", () => {
    for (const t of [
      "No re-run command runs after landing: the duty's own next scheduled run exercises the change.",
      "No further action after landing.",
      "No follow-up command runs after landing.",
      "No re-run after landing.",
    ]) expect(namesPostLandStep(t), t).toBe(false);
  });
  it("a negated sentence that still names a real command names a step (the 21 Sep catch is not traded away)", () => {
    expect(namesPostLandStep("No one else can do it, so after landing run `bin/publish`."), "command").toBe(true);
    expect(namesPostLandStep("After landing: the About text goes up."), "no command, no negator").toBe(true);
  });
  it("this stop's own sentence still names a step — it does name one, and that pin is not softened", () => {
    expect(namesPostLandStep(
      "the plan (or her instruction) names a step to run after landing and resolves no command for it.",
    )).toBe(true);
  });
});

describe("a repair's plan is read alone; her own instruction is always read (27 Oct 2026)", () => {
  const read = RUNNER.slice(RUNNER.indexOf("let namesStep = namesPostLandStep("), RUNNER.indexOf("if (namesStep &&"));
  it("the runner reads the plan when it is a repair, and the plan plus her instruction otherwise", () => {
    expect(read).toMatch(/isRepair\(row\)\s*\?\s*String\(out\.plan_text/);
  });
  it("isRepair tells the two cases apart", () => {
    expect(isRepair({ origin: "repair" })).toBe(true);
    expect(isRepair({ origin: "owner" })).toBe(false);
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
