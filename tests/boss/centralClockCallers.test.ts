import { describe, expect, it } from "vitest";
import { chicagoParts, inSendWindow } from "../../src/worker/boss/outreach/brakes";
import { centralTime } from "../../src/worker/boss/queue/freeRung";
import { nextDueAt, type DutySchedule } from "../../src/worker/boss/duties/cadence";
import { freeTierResetAt, nextCentralMidnight, nextCentralMonth } from "../../src/worker/boss/research/grounded";
import { freeDayStartedAt } from "../../src/worker/boss/router/experience";
import { monthRange } from "../../src/worker/boss/today/returns";

/**
 * ONE CENTRAL CLOCK, the Worker callers (24 Nov 2026). Each copy these replaced kept its own Central
 * maths; now each reads schedule/clock.mjs. 8 Mar 2026: 02:00 CST → 03:00 CDT at 08:00Z. 1 Nov 2026:
 * 02:00 CDT → 01:00 CST at 07:00Z. Pacific changes at 10:00Z on 8 Mar.
 */
const Z = (iso: string) => Date.parse(iso);
const daily = (h: number, m: number): DutySchedule => ({ cadence: "daily", local_hour: h, local_minute: m, timezone: "America/Chicago", weekday: null, weekdays: null });

describe("outreach brakes: the 09:00-16:59 weekday window and quiet hours", () => {
  it("opens at 09:00 Central in summer (14:00Z) and in winter (15:00Z)", () => {
    expect(chicagoParts(Z("2026-03-09T13:59:00Z")).hour).toBe(8); // Mon after the jump
    expect(inSendWindow(Z("2026-03-09T13:59:00Z"))).toBe(false);
    expect(inSendWindow(Z("2026-03-09T14:00:00Z"))).toBe(true);
    expect(inSendWindow(Z("2026-01-12T14:59:00Z"))).toBe(false);
    expect(inSendWindow(Z("2026-01-12T15:00:00Z"))).toBe(true);
    expect(inSendWindow(Z("2026-01-12T22:59:00Z"))).toBe(true); // 16:59
    expect(inSendWindow(Z("2026-01-12T23:00:00Z"))).toBe(false); // 17:00
  });

  it("turns the day and weekday at Central midnight", () => {
    expect(chicagoParts(Z("2026-01-13T05:59:00Z"))).toEqual({ weekday: 1, hour: 23, day: "2026-01-12" });
    expect(chicagoParts(Z("2026-01-13T06:00:00Z"))).toEqual({ weekday: 2, hour: 0, day: "2026-01-13" });
    expect(chicagoParts(Z("2026-07-14T04:59:00Z")).day).toBe("2026-07-13");
    expect(chicagoParts(Z("2026-07-14T05:00:00Z")).day).toBe("2026-07-14");
  });
});

describe("freeRung centralTime", () => {
  it("writes the wall time on both sides of each change", () => {
    expect(centralTime(Z("2026-03-08T07:59:00Z"))).toMatch(/^Sun, Mar 8, 1:59\s?AM$/u);
    expect(centralTime(Z("2026-03-08T08:00:00Z"))).toMatch(/^Sun, Mar 8, 3:00\s?AM$/u);
    expect(centralTime(Z("2026-11-01T06:30:00Z"))).toMatch(/^Sun, Nov 1, 1:30\s?AM$/u);
    expect(centralTime(Z("2026-11-01T07:30:00Z"))).toMatch(/^Sun, Nov 1, 1:30\s?AM$/u);
    expect(centralTime(Z("2026-01-16T05:59:00Z"))).toMatch(/^Thu, Jan 15, 11:59\s?PM$/u);
  });
});

describe("duty cadence nextDueAt", () => {
  it("a 23:15 daily duty that ran on 7 Mar is next due 23:15 CDT on 8 Mar, not 9 Mar", () => {
    expect(nextDueAt(daily(23, 15), Z("2026-03-08T05:15:00Z"))).toBe(Z("2026-03-09T04:15:00Z"));
  });

  it("a 02:30 duty runs on the spring day just after the jump", () => {
    expect(nextDueAt(daily(2, 30), Z("2026-03-07T08:30:00Z"))).toBe(Z("2026-03-08T08:30:00Z"));
  });

  it("a 01:30 duty runs once on the fall day, at the first 01:30", () => {
    const first = nextDueAt(daily(1, 30), Z("2026-10-31T06:30:00Z"));
    expect(first).toBe(Z("2026-11-01T06:30:00Z"));
    expect(nextDueAt(daily(1, 30), first)).toBe(Z("2026-11-02T07:30:00Z"));
  });

  it("midnight: a 00:00 duty at 23:59 Central is due one minute later, winter and summer", () => {
    expect(nextDueAt(daily(0, 0), Z("2026-01-16T05:59:00Z"))).toBe(Z("2026-01-16T06:00:00Z"));
    expect(nextDueAt(daily(0, 0), Z("2026-07-16T04:59:00Z"))).toBe(Z("2026-07-16T05:00:00Z"));
  });
});

describe("search allowances reset at the zone's own midnight", () => {
  it("nextCentralMidnight is tomorrow 00:05 on the clock, also when today is a change day", () => {
    expect(nextCentralMidnight(Z("2026-03-08T07:00:00Z"))).toBe(Z("2026-03-09T05:05:00Z")); // 01:00 CST → 00:05 CDT
    expect(nextCentralMidnight(Z("2026-11-01T05:30:00Z"))).toBe(Z("2026-11-02T06:05:00Z")); // 00:30 CDT → 00:05 CST
    expect(nextCentralMidnight(Z("2026-01-15T12:00:00Z"))).toBe(Z("2026-01-16T06:05:00Z"));
  });

  it("nextCentralMonth is 00:05 Central on the 1st: 05:05Z in summer, 06:05Z in winter", () => {
    expect(nextCentralMonth(Z("2026-07-15T12:00:00Z"))).toBe(Z("2026-08-01T05:05:00Z"));
    expect(nextCentralMonth(Z("2026-12-15T12:00:00Z"))).toBe(Z("2027-01-01T06:05:00Z"));
  });

  it("Pacific: the free tier resets and began at Pacific midnight on the spring day", () => {
    expect(freeTierResetAt(Z("2026-03-08T09:00:00Z"))).toBe(Z("2026-03-09T07:05:00Z")); // 01:00 PST → 00:05 PDT
    expect(freeDayStartedAt(Z("2026-03-08T20:00:00Z"))).toBe(Z("2026-03-08T08:00:00Z")); // 13:00 PDT → 00:00 PST
  });
});

describe("returns monthRange", () => {
  it("runs Central midnight to Central midnight across the spring change", () => {
    expect(monthRange("2026-03")).toEqual({ from: Z("2026-03-01T06:00:00Z"), to: Z("2026-04-01T05:00:00Z") });
    expect(monthRange("2026-11")).toEqual({ from: Z("2026-11-01T05:00:00Z"), to: Z("2026-12-01T06:00:00Z") });
  });
});
