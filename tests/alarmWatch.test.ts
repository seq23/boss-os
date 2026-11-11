import { readFileSync } from "node:fs";
import { PHASE_TIMEOUT_MIN, CLAIM_LEASE_MS } from "../src/shared/boss/repoChange/lane.mjs";
import { describe, expect, it } from "vitest";
import { alarmState, deployState, stopWords, watchMinutes } from "../scripts/ops/alarm-watch.mjs";

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

// Reproduce the prospects post-land failure: 150 minutes was killed at 30,
// then a two-minute probe was misreported as the recorded command's failure.
describe("the hourly alarm proof gets its bounded observation window", () => {
  it("rejects a short probe before any request, and lets the runner outlive a full watch", () => {
    for (const bad of [2, 0, 64, 181, NaN, Infinity, "oops"]) {
      expect(() => watchMinutes(bad)).toThrow("NAMED STOP [WATCH_WINDOW_TOO_SHORT_OR_INVALID]");
    }
    expect(watchMinutes("150")).toBe(150);
    expect(watchMinutes()).toBe(90);
    expect(watchMinutes(65)).toBe(65);
    expect(PHASE_TIMEOUT_MIN.land).toBeGreaterThanOrEqual(watchMinutes(180) + 30);
    expect(CLAIM_LEASE_MS).toBeGreaterThan(PHASE_TIMEOUT_MIN.land * 60_000);
    const shell = readFileSync("scripts/ops/repo-change.sh", "utf8");
    const hours = Number(shell.match(/REPO_CHANGE_TICK_TIMEOUT:-(\d+)h/)?.[1]);
    expect(hours * 60).toBeGreaterThan(PHASE_TIMEOUT_MIN.plan + PHASE_TIMEOUT_MIN.build + PHASE_TIMEOUT_MIN.land);
  });
});
