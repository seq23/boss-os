// "Tomorrow" is a date, never now + 24 h: on 1 Nov 2026 (clocks fall back) dayId(now + DAY_MS) was
// still today, so deferring an open loop carried it onto the same day (tests/boss/executive.test.ts
// failed only on that date). This pins the rule for every day of the year, not just the two that show it.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextDayId } from "../src/worker/boss/routes/today";

describe("day ids are calculated on the date", () => {
  it("no source computes a day id from a timestamp plus or minus a day of milliseconds", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter((f) => /\.(ts|mts|mjs)$/.test(f)).map((f) => `src/${f}`);
    expect(files.length).toBeGreaterThan(100);
    const bad = files.filter((f) => /dayId(InZone)?\([^)]*[+-]\s*(DAY_MS|86_?400_?000)/.test(readFileSync(f, "utf8").replace(/^\s*\*.*$/gm, "")));
    expect(bad).toEqual([]);
  });
  it("nextDayId crosses the fall-back and month ends", () => {
    expect(nextDayId("2026-11-01")).toBe("2026-11-02");
    expect(nextDayId("2026-03-08")).toBe("2026-03-09");
    expect(nextDayId("2026-12-31")).toBe("2027-01-01");
  });
});
