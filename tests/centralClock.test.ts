import { describe, expect, it } from "vitest";
import {
  CENTRAL, clockRowProblems, dayOf, instantAt, nextSlotAt, startOfDay, wallClock, weekOf, zoneOffsetMs,
} from "../src/shared/boss/schedule/clock.mjs";
import { chicagoWeekOf, summaryProblem, SPRY_WEEKLY } from "../src/shared/boss/spryWeekly/compose.mjs";
import { chicagoInstant } from "../scripts/ops/lp-followups.mjs";
import { chicagoOffset } from "../scripts/ops/lib/schedule.mjs";
import { startOfCentralDay } from "../src/shared/boss/outreach/cadence.mjs";
import { dayStart } from "../src/shared/boss/pnp/outreach.mjs";
import { centralDay } from "../src/shared/boss/alarms/rules.mjs";
import { deferredItemsIn } from "../src/shared/boss/service/practices.mjs";

/**
 * ONE CENTRAL CLOCK (24 Nov 2026, engineering-check FAIL on #553). Boss OS had a dozen hand-rolled
 * Central conversions; each now calls schedule/clock.mjs. These pin the two 2026 clock changes:
 *  - 8 Mar 2026: 02:00 CST jumps to 03:00 CDT at 08:00Z (02:00-02:59 never happens);
 *  - 1 Nov 2026: 02:00 CDT falls back to 01:00 CST at 07:00Z (01:00-01:59 happens twice);
 * plus midnight at 05:59/06:00Z in winter and 04:59/05:00Z in summer. Each caller test below failed
 * against the copy it replaced (see the PR's Mutation proof).
 */
const Z = (iso: string) => Date.parse(iso);
const H = 3_600_000;

describe("the clock primitives", () => {
  it("reads the offset on each side of both changes from Intl, never a fixed -6", () => {
    expect(zoneOffsetMs(Z("2026-03-08T07:59:00Z"), CENTRAL)).toBe(-6 * H);
    expect(zoneOffsetMs(Z("2026-03-08T08:00:00Z"), CENTRAL)).toBe(-5 * H);
    expect(zoneOffsetMs(Z("2026-11-01T06:59:00Z"), CENTRAL)).toBe(-5 * H);
    expect(zoneOffsetMs(Z("2026-11-01T07:00:00Z"), CENTRAL)).toBe(-6 * H);
  });

  it("puts a time in the skipped spring hour just past the jump, and the repeated fall hour at its first instant", () => {
    expect(instantAt(CENTRAL, 2026, 3, 8, 1, 59)).toBe(Z("2026-03-08T07:59:00Z"));
    expect(instantAt(CENTRAL, 2026, 3, 8, 2, 30)).toBe(Z("2026-03-08T08:30:00Z")); // 03:30 CDT
    expect(instantAt(CENTRAL, 2026, 3, 8, 3, 0)).toBe(Z("2026-03-08T08:00:00Z"));
    expect(instantAt(CENTRAL, 2026, 11, 1, 1, 30)).toBe(Z("2026-11-01T06:30:00Z")); // first 01:30 (CDT)
    expect(instantAt(CENTRAL, 2026, 11, 1, 2, 0)).toBe(Z("2026-11-01T08:00:00Z"));
    // Both 01:30s read 01:30 on the wall.
    expect(wallClock(Z("2026-11-01T06:30:00Z"))).toMatchObject({ h: 1, min: 30 });
    expect(wallClock(Z("2026-11-01T07:30:00Z"))).toMatchObject({ h: 1, min: 30 });
  });

  it("turns the day at Central midnight: 05:59/06:00Z in winter, 04:59/05:00Z in summer", () => {
    expect(dayOf(Z("2026-01-16T05:59:00Z"))).toBe("2026-01-15");
    expect(dayOf(Z("2026-01-16T06:00:00Z"))).toBe("2026-01-16");
    expect(dayOf(Z("2026-07-16T04:59:00Z"))).toBe("2026-07-15");
    expect(dayOf(Z("2026-07-16T05:00:00Z"))).toBe("2026-07-16");
    expect(dayOf("2026-07-16T05:00:00Z")).toBe("2026-07-16"); // an ISO string, as the old copies accepted
  });

  it("starts a change day at its own midnight (a 23- and a 25-hour day)", () => {
    expect(startOfDay(Z("2026-03-08T20:00:00Z"))).toBe(Z("2026-03-08T06:00:00Z"));
    expect(startOfDay(Z("2026-11-01T20:00:00Z"))).toBe(Z("2026-11-01T05:00:00Z"));
  });

  it("starts the week on Monday at Central midnight, winter and summer", () => {
    expect(weekOf(Z("2026-11-30T05:59:00Z"))).toBe("2026-11-23"); // Sun 29 Nov 23:59 CST
    expect(weekOf(Z("2026-11-30T06:00:00Z"))).toBe("2026-11-30"); // Mon 00:00 CST
    expect(weekOf(Z("2026-07-20T04:59:00Z"))).toBe("2026-07-13"); // Sun 19 Jul 23:59 CDT
    expect(weekOf(Z("2026-07-20T05:00:00Z"))).toBe("2026-07-20"); // Mon 00:00 CDT
  });
});

describe("every replaced caller", () => {
  it("scripts/ops/lib/schedule.mjs chicagoOffset flips at the jump, not at UTC midnight", () => {
    expect(chicagoOffset(new Date("2026-03-08T07:59:00Z"))).toBe(-6);
    expect(chicagoOffset(new Date("2026-03-08T08:00:00Z"))).toBe(-5);
    expect(chicagoOffset(new Date("2026-11-01T06:59:00Z"))).toBe(-5);
    expect(chicagoOffset(new Date("2026-11-01T07:00:00Z"))).toBe(-6);
  });

  it("lp-followups chicagoInstant: 02:30 on the spring day is 03:30 CDT, never 02:30 UTC the day before", () => {
    expect(chicagoInstant("2026-03-08", 2, 30)).toBe(Z("2026-03-08T08:30:00Z"));
    expect(chicagoInstant("2026-11-01", 1, 30)).toBe(Z("2026-11-01T06:30:00Z"));
    expect(chicagoInstant("2026-01-15", 9, 0)).toBe(Z("2026-01-15T15:00:00Z"));
    expect(chicagoInstant("2026-07-15", 9, 0)).toBe(Z("2026-07-15T14:00:00Z"));
  });

  it("Spry weekly chicagoWeekOf turns Sunday into Monday at Central midnight", () => {
    expect(chicagoWeekOf(Z("2026-11-30T05:59:00Z"))).toBe("2026-11-23");
    expect(chicagoWeekOf(Z("2026-11-30T06:00:00Z"))).toBe("2026-11-30");
    expect(chicagoWeekOf(Z("2026-07-20T04:59:00Z"))).toBe("2026-07-13");
    expect(chicagoWeekOf(Z("2026-07-20T05:00:00Z"))).toBe("2026-07-20");
  });

  it("Spry weekly counts a report from the first summer hour of Monday as this week (a fixed 06:00Z did not)", () => {
    const summary = (at: string) => ({ schema: SPRY_WEEKLY.schema, generated_at: at });
    const now = Z("2026-07-23T15:00:00Z"); // Thursday, 3+ days later, well past the 36-hour limit
    expect(summaryProblem(summary("2026-07-20T05:30:00Z"), { now })).toBeNull(); // Mon 00:30 CDT
    expect(summaryProblem(summary("2026-07-20T04:30:00Z"), { now })).toMatch(/not this week/); // Sun 23:30 CDT
  });

  it("nextSlotAt runs a 02:30 slot on the spring day itself, just after the jump", () => {
    expect(nextSlotAt("daily 02:30", Z("2026-03-08T06:00:00Z"))).toBe(Z("2026-03-08T08:30:00Z"));
    expect(nextSlotAt("daily 01:30", Z("2026-11-01T05:00:00Z"))).toBe(Z("2026-11-01T06:30:00Z"));
    expect(nextSlotAt("daily 23:59", Z("2026-01-15T06:00:00Z"))).toBe(Z("2026-01-16T05:59:00Z"));
  });

  it("names a worker-clocked Central cron set inside the skipped 02:00 hour, and passes the hours around it", () => {
    const row = (cron: string) => ({ rows: [{ id: "r", trigger: { clock: "worker", repo: "boss-os", file: "f.yml", event: "r", crons: [cron] } }] });
    expect(clockRowProblems(row("CRON_TZ=America/Chicago 30 2 * * *")).join()).toMatch(/02:00 Central hour/);
    expect(clockRowProblems(row("CRON_TZ=America/Chicago 30 1,2 * * *")).join()).toMatch(/02:00 Central hour/);
    expect(clockRowProblems(row("CRON_TZ=America/Chicago 30 1 * * *"))).toEqual([]);
    expect(clockRowProblems(row("CRON_TZ=America/Chicago 30 3 * * *"))).toEqual([]);
    expect(clockRowProblems(row("CRON_TZ=America/Chicago 17 * * * *"))).toEqual([]);
    expect(clockRowProblems(row("30 2 * * *"))).toEqual([]); // UTC: no skipped hour
  });

  it("outreach startOfCentralDay and P&P dayStart begin a change day at its real midnight", () => {
    // Old copies subtracted the wall time already elapsed: an hour early in spring, an hour late in fall.
    expect(startOfCentralDay(Z("2026-03-08T20:00:00Z"))).toBe(Z("2026-03-08T06:00:00Z"));
    expect(startOfCentralDay(Z("2026-11-01T20:00:00Z"))).toBe(Z("2026-11-01T05:00:00Z"));
    expect(dayStart(Z("2026-03-08T20:00:00Z"))).toBe(Z("2026-03-08T06:00:00Z"));
    expect(dayStart(Z("2026-11-01T20:00:00Z"))).toBe(Z("2026-11-01T05:00:00Z"));
    expect(startOfCentralDay(Z("2026-01-15T05:59:00Z"))).toBe(Z("2026-01-14T06:00:00Z"));
  });

  it("alarms centralDay moves calendar days, so 23:30 on 7 Mar plus one day is 8 Mar", () => {
    expect(centralDay(Z("2026-03-08T05:30:00Z"), 1)).toBe("2026-03-08");
    expect(centralDay(Z("2026-11-01T04:30:00Z"), 1)).toBe("2026-11-01"); // 31 Oct 23:30 CDT
    expect(centralDay(Z("2026-11-01T04:30:00Z"), 0)).toBe("2026-10-31");
  });

  it("a deferred item is due at 09:00 on her clock in winter too (a fixed -05:00 said 08:00 CST)", () => {
    expect(deferredItemsIn("Deferred to 2026-12-01: send the deck")[0]?.due_at).toBe("2026-12-01T15:00:00.000Z");
    expect(deferredItemsIn("Deferred to 2026-07-01: send the deck")[0]?.due_at).toBe("2026-07-01T14:00:00.000Z");
    expect(deferredItemsIn("Deferred to 2026-13-45: bad")).toEqual([]);
  });
});
