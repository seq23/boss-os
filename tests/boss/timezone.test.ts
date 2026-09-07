import { describe, expect, it } from "vitest";
import {
  OWNER_TIMEZONE, zoneOffsetMs, zonedTime, monthRange, monthIdInZone, dayIdInZone, inOwnerZone,
} from "../../src/shared/boss/timezone";

/**
 * THE OWNER READS IN CENTRAL, AND CENTRAL IS NOT AN OFFSET.
 *
 * It is UTC-5 for part of the year and UTC-6 for the rest, so every test here that matters is on or
 * near a DST boundary. A zone conversion that is only ever checked in July looks perfect and is
 * wrong for four months.
 */

const HOUR = 3_600_000;

describe("the zone itself", () => {
  it("is UTC-5 in summer and UTC-6 in winter, which is why it is a zone and not a number", () => {
    expect(zoneOffsetMs(Date.parse("2026-07-15T12:00:00Z"))).toBe(-5 * HOUR);
    expect(zoneOffsetMs(Date.parse("2026-01-15T12:00:00Z"))).toBe(-6 * HOUR);
  });

  it("gets her birth instant right, which is a 1986 date under the old DST rules", () => {
    // 1986 DST began 27 April, so 23 July was CDT. Getting this wrong by an hour moves the
    // ascendant fifteen degrees, which is how a whole natal chart goes quietly wrong.
    expect(zonedTime(1986, 7, 23, 2)).toBe(Date.parse("1986-07-23T07:00:00Z"));
  });
});

describe("wall-clock to instant, across the two days a year it is hard", () => {
  it("TAKES TWO PASSES, and one is wrong for eleven hours a year", () => {
    /*
     * The offset depends on the instant being solved for, and the instant is what is being solved
     * FOR. A single subtraction reads the offset on the wrong side of the transition and lands an
     * hour out — for the morning hours of both changeover days, which includes 6am, which is when
     * the Executive Intelligence Report is due.
     *
     * The first version of this test asserted noon on those days and passed with the second pass
     * removed. It proved nothing: at noon the offset is already settled either way. These are the
     * hours where the two methods genuinely disagree.
     */
    // Spring forward, 8 March 2026: 2am CST becomes 3am CDT.
    expect(zonedTime(2026, 3, 8, 6)).toBe(Date.parse("2026-03-08T11:00:00Z")); // 6am CDT
    expect(zonedTime(2026, 3, 8, 7)).toBe(Date.parse("2026-03-08T12:00:00Z"));
    // Fall back, 1 November 2026: 2am CDT becomes 1am CST.
    expect(zonedTime(2026, 11, 1, 6)).toBe(Date.parse("2026-11-01T12:00:00Z")); // 6am CST
    expect(zonedTime(2026, 11, 1, 5)).toBe(Date.parse("2026-11-01T11:00:00Z"));
  });

  it("is right on the ordinary days either side too", () => {
    expect(zonedTime(2026, 3, 7, 12)).toBe(Date.parse("2026-03-07T18:00:00Z")); // CST, UTC-6
    expect(zonedTime(2026, 3, 9, 12)).toBe(Date.parse("2026-03-09T17:00:00Z")); // CDT, UTC-5
    expect(zonedTime(2026, 10, 31, 12)).toBe(Date.parse("2026-10-31T17:00:00Z"));
    expect(zonedTime(2026, 11, 2, 12)).toBe(Date.parse("2026-11-02T18:00:00Z"));
  });
});

describe("the month, which is the owner's month", () => {
  it("starts at local midnight, not UTC midnight", () => {
    const { start } = monthRange("2026-09");
    expect(start).toBe(Date.parse("2026-09-01T05:00:00Z")); // midnight CDT
    expect(new Date(start).toISOString()).not.toBe("2026-09-01T00:00:00.000Z");
  });

  it("ENDS AT THE NEXT MONTH, NOT PLUS 31 DAYS", () => {
    /*
     * The route this replaced added a fixed 31 days. September then ran to 2 October, so a view of
     * September contained the 1st of the next month — and February contained three days of March.
     */
    for (const [month, days] of [["2026-09", 30], ["2026-02", 28], ["2024-02", 29], ["2026-01", 31]] as const) {
      const { start, end } = monthRange(month);
      expect(Math.round((end - start) / 86_400_000)).toBe(days);
    }
  });

  it("spans 30 or 32 real days when the clocks move inside it", () => {
    // March 2026 is an hour short and November an hour long. The boundaries still land on local
    // midnight, which is the property that matters — the DAY count is what stays whole.
    expect(monthRange("2026-03").end - monthRange("2026-03").start).toBe(31 * 86_400_000 - HOUR);
    expect(monthRange("2026-11").end - monthRange("2026-11").start).toBe(30 * 86_400_000 + HOUR);
  });

  it("files a late-evening record under the month she was living in", () => {
    /*
     * THE BUG THIS PINS. 8pm Central on 30 September is 1 October in UTC. `monthId` read UTC, so a
     * contribution logged then satisfied a month she had already closed and left the current one
     * showing nothing — against a floor whose whole requirement is one a month.
     */
    const lateSeptemberEvening = Date.parse("2026-10-01T01:00:00Z");
    expect(monthIdInZone(lateSeptemberEvening)).toBe("2026-09");
    expect(new Date(lateSeptemberEvening).toISOString().slice(0, 7)).toBe("2026-10");
  });
});

describe("rendering", () => {
  it("shows an instant on HER clock regardless of the machine's", () => {
    // A new moon at 2026-09-10T22:28Z is a 5:28pm Central evening, not a 10:28pm one.
    const rendered = inOwnerZone(Date.parse("2026-09-10T22:28:14Z"));
    expect(rendered).toContain("5:28");
    expect(rendered).toContain("Sep 10");
  });

  it("says nothing rather than a fake date when there is no timestamp", () => {
    expect(inOwnerZone(null)).toBe("—");
    expect(inOwnerZone(undefined)).toBe("—");
    expect(inOwnerZone(Number.NaN)).toBe("—");
  });

  it("names the zone it uses, so it is never inferred from the number", () => {
    expect(OWNER_TIMEZONE).toBe("America/Chicago");
  });
});

describe("the day boundary is hers", () => {
  it("DOES NOT END HER DAY AT 7PM", () => {
    /*
     * `dayId` read the UTC date, so her day rolled over six hours early, every day. Seen live: at
     * 9pm on a Sunday the Run of Show was already showing Monday — West Peek instead of the weekend
     * build order, a fresh empty set of blocks, and the evening she was actually living filed under
     * tomorrow.
     */
    const sundayEvening = Date.parse("2026-09-06T21:00:00-05:00"); // 9pm Central, Sunday
    expect(dayIdInZone(sundayEvening)).toBe("2026-09-06");
    // What it used to say, and why it mattered — a different day AND a different weekday.
    expect(new Date(sundayEvening).toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("rolls at local midnight, on both sides", () => {
    expect(dayIdInZone(Date.parse("2026-09-06T23:59:00-05:00"))).toBe("2026-09-06");
    expect(dayIdInZone(Date.parse("2026-09-07T00:01:00-05:00"))).toBe("2026-09-07");
  });

  it("still rolls at local midnight on the days the clocks move", () => {
    // 8 March 2026 loses an hour and 1 November gains one; neither is allowed to move the date.
    expect(dayIdInZone(Date.parse("2026-03-08T23:30:00-05:00"))).toBe("2026-03-08");
    expect(dayIdInZone(Date.parse("2026-11-01T23:30:00-06:00"))).toBe("2026-11-01");
  });
});
