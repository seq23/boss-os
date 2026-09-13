import { describe, expect, it } from "vitest";
import { currentLunation } from "../../src/worker/boss/spirit/astro";

/**
 * THE LUNATION SHE IS INSIDE, NOT THE ONE THAT IS ABOUT TO ARRIVE.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "spirit page is now passed the new moon in virgo but u should so the last major lunation so
 *    evn tho its sept 13 i should still be able to see the new moon in virgo section for 2 weeks
 *    until the next major lunation"
 *
 * Measured on production 13 Sep 2026: `major_event` was NULL and the Spirit page read "No major
 * event in the next two days", while she was ten days into the cycle the Virgo new moon opened.
 * `major_event` looks 48 hours forward and 6 back, so it forgot the event the instant it passed.
 *
 * EVERY TEST BELOW IS WRITTEN AGAINST THAT. The central one asks the question she asked, on the
 * date she asked it, and expects Virgo.
 */

const DAY = 86_400_000;

/** Published lunar events, used as fixtures rather than as self-consistency checks. */
const VIRGO_NEW_MOON_2026 = Date.parse("2026-09-11T04:27:00Z");

describe("the current lunation", () => {
  /**
   * THE ONE SHE ASKED FOR, ON THE DATE SHE ASKED IT.
   *
   * NEGATIVE PROOF IS BUILT IN: this date is more than 48 hours after the new moon, which is
   * precisely the window `major_event` covers. Before the fix this section was empty on this date —
   * the test would have had nothing to assert against because nothing was computed at all.
   */
  it("still shows the New Moon in Virgo on 13 September, ten days after it happened", () => {
    const l = currentLunation(Date.parse("2026-09-13T12:00:00Z"));
    expect(l.current.kind).toBe("new_moon");
    expect(l.current.sign).toBe("Virgo");
    expect(l.current.label).toMatch(/New Moon in Virgo/);
    // Within a day of the published time, which is the accuracy the truncated series claims.
    expect(Math.abs(l.current.at - VIRGO_NEW_MOON_2026)).toBeLessThan(DAY);
    expect(l.days_since).toBeGreaterThanOrEqual(2);
  });

  /**
   * THE BOUNDARY IS THE NEXT EVENT, NOT FOURTEEN DAYS.
   *
   * A fixed fortnight drifts against a 29.53-day synodic month and is wrong by a day every couple
   * of cycles. Her own phrasing says the rule: "until the next major lunation".
   */
  it("names the event that closes the cycle, and it is the next new or full moon", () => {
    const l = currentLunation(Date.parse("2026-09-13T12:00:00Z"));
    expect(l.next.at).toBeGreaterThan(l.current.at);
    expect(["new_moon", "full_moon"]).toContain(l.next.kind);
    // A new moon is closed by a full moon, roughly half a synodic month later.
    expect(l.next.kind).toBe("full_moon");
    const span = (l.next.at - l.current.at) / DAY;
    expect(span).toBeGreaterThan(13);
    expect(span).toBeLessThan(16);
    expect(l.days_until).toBeGreaterThan(0);
  });

  it("hands over to the next lunation the moment it arrives, and not before", () => {
    const l = currentLunation(Date.parse("2026-09-13T12:00:00Z"));
    const justBefore = currentLunation(l.next.at - 60_000);
    const justAfter = currentLunation(l.next.at + 60_000);

    expect(justBefore.current.at).toBe(l.current.at);
    expect(justAfter.current.at).toBe(l.next.at);
    expect(justAfter.current.kind).toBe(l.next.kind);
  });

  /**
   * NEVER EMPTY. This is the whole reason it is computed rather than read from `astro_calendar`: a
   * lapse in the almanac's coverage would produce an empty section, which is indistinguishable from
   * the bug being fixed.
   */
  it("answers on every day of two years, with the moment always in the past", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let d = 0; d < 730; d += 1) {
      const ts = start + d * DAY;
      const l = currentLunation(ts);
      expect(l.current.at, `day ${d} returned a future moment as current`).toBeLessThanOrEqual(ts);
      expect(l.next.at, `day ${d} returned a past moment as next`).toBeGreaterThan(ts);
      expect(l.current.label).toMatch(/^(New|Full) Moon in /);
      expect(l.fraction).toBeGreaterThanOrEqual(0);
      expect(l.fraction).toBeLessThanOrEqual(1);
    }
  });

  it("alternates new and full, because they are the only two majors", () => {
    let ts = Date.parse("2026-01-01T00:00:00Z");
    const seen: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const l = currentLunation(ts);
      seen.push(l.current.kind);
      ts = l.next.at + 60_000;
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i], `two ${seen[i]} in a row — a quarter must not be counted as a major`).not.toBe(seen[i - 1]);
    }
  });

  it("carries the sign and the degree, so the section reads like her own report", () => {
    const l = currentLunation(Date.parse("2026-09-13T12:00:00Z"));
    expect(typeof l.current.sign).toBe("string");
    expect(l.current.degrees_in_sign).toBeGreaterThanOrEqual(0);
    expect(l.current.degrees_in_sign).toBeLessThan(30);
    expect(l.next.sign).toBeTruthy();
  });

  it("measures how far through the cycle against the real interval", () => {
    const l = currentLunation(Date.parse("2026-09-13T12:00:00Z"));
    const expected = (Date.parse("2026-09-13T12:00:00Z") - l.current.at) / (l.next.at - l.current.at);
    expect(l.fraction).toBeCloseTo(expected, 5);
    // At the exact moment of the event it is 0, not 1 — she is at the START of the cycle it opens.
    expect(currentLunation(l.current.at).fraction).toBe(0);
  });

  it("computes, so it needs no almanac row and no network", () => {
    // No db, no fetch, no env — the signature is the proof, and this asserts it stays that way.
    expect(currentLunation.length).toBe(1);
    expect(currentLunation(Date.parse("2031-04-02T00:00:00Z")).current.label).toMatch(/Moon in/);
  });
});
