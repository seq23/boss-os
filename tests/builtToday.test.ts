import { describe, expect, it } from "vitest";
import { builtTodayLine, builtTodayProblem } from "../src/shared/boss/engineering/builtToday.mjs";

/**
 * "BUILT FROM SCRATCH TODAY, WOULD IT LOOK LIKE THIS?" (owner ruling, 19 Nov 2026). Danielle's plan (repo-change.mjs)
 * and every Ahrefs fix (ahrefs-audit-report.mjs) are refused without a real answer; this is the one reader both use.
 */
describe("the engineering bar's one question", () => {
  it("refuses a plan or fix that does not answer it", () => {
    expect(builtTodayProblem(undefined)).toMatch(/no built_today/);
    expect(builtTodayProblem({ answer: "maybe", different: "we will see what happens" })).toMatch(/not yes or no/);
    expect(builtTodayProblem({ answer: "no", different: "" })).toMatch(/does not say what is different/);
    expect(builtTodayProblem({ answer: "yes" })).toMatch(/no reason/);
  });
  it("takes a real yes or no, and says it in one line", () => {
    const no = { answer: "No", different: "the reply is read by keywords today; this change moves it onto the first read" };
    expect(builtTodayProblem(no)).toBeNull();
    expect(builtTodayLine(no)).toBe("Built from scratch today, would it look like this? No: the reply is read by keywords today; this change moves it onto the first read");
    expect(builtTodayProblem({ answer: "yes", different: "nothing: static copy in the site's own templates" })).toBeNull();
  });
});
