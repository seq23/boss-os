import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { missedToday } from "../scripts/ops/missed-weekly-slots.mjs";

// 9 Nov 2026: the Mac booted at 07:36 and the Monday 07:00 prospect finder never ran that week.
describe("a weekly slot missed while the Mac was off runs once later that day", () => {
  const monday = new Date(2026, 10, 9, 7, 40).getTime();
  const slotAt = new Date(2026, 10, 9, 7, 0).getTime();
  const job = (label: string, slots: unknown[], lastRunMs: number) => ({ label, slots, lastRunMs });
  it("the 07:00 Monday job with no log since 07:00 is started; the 09:45 one is not yet due", () => {
    const jobs = [
      job("com.seq.boss-prospect-discovery", [{ Weekday: 1, Hour: 9, Minute: 15 }, { Weekday: 1, Hour: 7, Minute: 0 }], slotAt - 7 * 86_400_000),
      job("com.seq.kdp-publish", [{ Weekday: 1, Hour: 9, Minute: 45 }], 0),
    ];
    expect(missedToday(jobs, monday)).toEqual(["com.seq.boss-prospect-discovery"]);
  });
  it("a job that already ran, another day's job, a several-a-week sender and a one-shot are left alone", () => {
    const jobs = [
      job("com.seq.boss-people", [{ Weekday: 1, Hour: 7, Minute: 15 }], slotAt + 15 * 60_000),
      job("com.seq.boss-capital-buyers", [{ Weekday: 2, Hour: 7, Minute: 0 }], 0),
      job("com.seq.boss-prospects", [1, 2, 3, 4, 5].map((Weekday) => ({ Weekday, Hour: 7, Minute: 0 })), 0),
      job("com.seq.oneshot.x", [{ Weekday: 1, Hour: 7, Minute: 0 }], 0),
      { ...job("com.seq.boss-sites-audit", [{ Weekday: 1, Hour: 6, Minute: 0 }], 0), program: "npm run sites:audit -- --morning" },
    ];
    expect(missedToday(jobs, monday)).toEqual([]);
  });
});
