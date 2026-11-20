import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { missedToday, staleDaily } from "../scripts/ops/missed-slots.mjs";

// 9 Nov 2026: the Mac booted at 07:36 and the Monday 07:00 prospect finder never ran that week.
describe("a weekly slot missed while the Mac was off runs once later that day (weekly)", () => {
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

// 20 Nov 2026: the 01:40 backup missed 16 and 20 Nov (lid closed, then a restart at 06:46).
describe("a daily slot missed while the Mac was asleep or off runs once later that day", () => {
  const job = (label: string, slots: unknown[], lastRunMs: number, program = "") => ({ label, slots, lastRunMs, program });
  const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m).getTime();
  it("the 01:40 backup with no log since 01:40 is started at 07:10", () => {
    expect(missedToday([job("com.seq.drive-backup", [{ Hour: 1, Minute: 40 }], at(1, 40) - 86_400_000)], at(7, 10))).toEqual(["com.seq.drive-backup"]);
  });
  it("a daily job that ran, one not yet due, an hourly one, the weekday senders and the morning catch-up are left alone", () => {
    const jobs = [
      job("com.seq.housekeeping", [{ Hour: 3, Minute: 30 }], at(3, 31)),
      job("com.seq.boss-mac-cleanup", [{ Hour: 9, Minute: 0 }], 0),
      job("com.seq.boss-brains-pull", [{ Minute: 23 }], 0),
      job("com.seq.boss-prospects", [1, 2, 3, 4, 5].map((Weekday) => ({ Weekday, Hour: 7, Minute: 0 })), 0),
      job("com.seq.boss-morning-catchup", [{ Hour: 6, Minute: 32 }], 0),
    ];
    expect(missedToday(jobs, at(7, 10))).toEqual([]);
  });
  it("a several-a-day job catches up only its latest past slot, once", () => {
    const j = job("com.seq.boss-owner-mail-watch", [{ Hour: 7, Minute: 50 }, { Hour: 15, Minute: 50 }], at(7, 51));
    expect(missedToday([j], at(16, 30))).toEqual(["com.seq.boss-owner-mail-watch"]);
    expect(missedToday([{ ...j, lastRunMs: at(15, 51) }], at(16, 30))).toEqual([]);
  });
  it("a daily job with no log for 36 hours is named; a fresh one and a weekly one are not", () => {
    const now = at(9);
    const stale = staleDaily([
      job("com.seq.drive-backup", [{ Hour: 1, Minute: 40 }], now - 50 * 3_600_000),
      job("com.seq.housekeeping", [{ Hour: 3, Minute: 30 }], now - 5 * 3_600_000),
      job("com.seq.kdp-publish", [{ Weekday: 1, Hour: 9, Minute: 45 }], 0),
    ], now);
    expect(stale.map((s: { label: string }) => s.label)).toEqual(["com.seq.drive-backup"]);
  });
});

describe("monthly jobs and jobs with no log are never caught up or called stale", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m).getTime();
  it("a 1st-of-month slot and a log-less job are left alone", () => {
    const jobs = [
      { label: "com.seq.mac-snapshot", slots: [{ Day: 1, Hour: 10 }, { Day: 15, Hour: 10 }], lastRunMs: 0 },
      { label: "com.seq.boss-fb-renew", slots: [{ Hour: 13, Minute: 40 }], lastRunMs: 0, noLog: true },
    ];
    expect(missedToday(jobs, at(16))).toEqual([]);
    expect(staleDaily(jobs, at(16))).toEqual([]);
  });
});
