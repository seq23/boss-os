import { describe, expect, it } from "vitest";
import { alarmState, deployState, stopWords } from "../scripts/ops/alarm-watch.mjs";

/*
 * 8 Nov 2026, rework of output:duty_exec_intel: the post-land watch waited 75 minutes and reported
 * "still open" while production ran 40cbe53, which did not carry the fix (6f2db22): Deploy had
 * skipped the merge on a red e2e from a sibling PR. The watch must name the missing deploy.
 */
describe("alarm-watch: the fix must be live before the alarm is judged", () => {
  it("production behind or beside the fix is not live; at or after it is", () => {
    expect(deployState("6f2db22", "40cbe53", "behind").state).toBe("not live");
    expect(deployState("6f2db22", "40cbe53", "diverged").state).toBe("not live");
    expect(deployState("6f2db22", "87415e9", "ahead").state).toBe("live");
    expect(deployState("6f2db22", "6f2db22", null).state).toBe("live");
  });

  it("an unread deploy is 'not read', never live", () => {
    expect(deployState("6f2db22", "", null).state).toBe("not read");
    expect(deployState(null, "40cbe53", "ahead").state).toBe("not read");
    expect(deployState("6f2db22", "40cbe53", undefined).state).toBe("not read");
  });

  it("the stop names the missing deploy, not the alarm, when production lacks the fix", () => {
    const open = alarmState([{ alarm_key: "output:duty_exec_intel", status: "open", text: "0 reports delivered" }], "output:duty_exec_intel");
    const notLive = stopWords("output:duty_exec_intel", 75, { state: "not live", prod: "40cbe53abc", fix: "6f2db22abc" }, open);
    expect(notLive).toContain("[FIX_NOT_DEPLOYED]");
    expect(notLive).toContain("40cbe53");
    expect(notLive).not.toContain("[ALARM_NOT_CLOSED]");
    const live = stopWords("output:duty_exec_intel", 75, { state: "live", at: Date.UTC(2026, 10, 8, 19) }, open);
    expect(live).toContain("[ALARM_NOT_CLOSED]");
    expect(live).toContain("fix live in production since 2026-11-08T19:00:00.000Z");
  });
});
