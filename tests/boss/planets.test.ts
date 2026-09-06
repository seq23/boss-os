import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { EXPECTED_COMPUTED_KINDS } from "../../src/worker/boss/spirit/day";
import {
  geocentricLongitude, dailyMotion, stations, retrogrades, ingresses,
  RETROGRADING, PLANET_BY_KEY, natalChart,
} from "../../src/worker/boss/spirit/planets";

/**
 * THE ASTRONOMY IS CHECKED AGAINST THE SKY, NOT AGAINST ITSELF.
 *
 * A wrong row in the orbital-elements table produces perfectly plausible output: planets in signs,
 * retrogrades three times a year, shadows around them. Nothing about the shape of the answer would
 * reveal it. So these tests compare against published values that were established independently —
 * equinox and solstice instants, and the 2026 retrograde calendar — and they are the only thing
 * standing between a typo in a coefficient and a screen that is confidently wrong.
 *
 * THIS IS HOW THE PRECESSION BUG WAS FOUND. Every longitude was 0.36° short, every computed equinox
 * landed 8h39m late, and the error was invisible inside a thirty-degree sign. It was the CONSTANT
 * offset across four independent dates that named the cause: J2000 elements read against an
 * equinox-of-date zodiac.
 */

const UTC = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const HOUR = 3_600_000;

/** When solar longitude crosses `target` — an equinox or a solstice. */
function solarCrossing(target: number, from: number, to: number): number {
  const f = (t: number) => {
    let d = geocentricLongitude("sun", t) - target;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };
  let lo = from, hi = to;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

describe("the ephemeris, against published astronomy", () => {
  /*
   * Published instants for 2026. These are the reference the method is judged by; a tolerance of
   * half an hour is comfortably inside the arcminute-level accuracy claimed for it, and comfortably
   * outside the 8h39m the precession bug produced.
   */
  const SEASONS = [
    { name: "March equinox", target: 0, from: UTC(2026, 3, 15), to: UTC(2026, 3, 25), published: Date.parse("2026-03-20T14:46:00Z") },
    { name: "June solstice", target: 90, from: UTC(2026, 6, 17), to: UTC(2026, 6, 25), published: Date.parse("2026-06-21T08:24:00Z") },
    { name: "September equinox", target: 180, from: UTC(2026, 9, 20), to: UTC(2026, 9, 26), published: Date.parse("2026-09-23T00:05:00Z") },
    { name: "December solstice", target: 270, from: UTC(2026, 12, 18), to: UTC(2026, 12, 25), published: Date.parse("2026-12-21T20:50:00Z") },
  ];

  for (const s of SEASONS) {
    it(`puts the ${s.name} within half an hour of the published instant`, () => {
      const computed = solarCrossing(s.target, s.from, s.to);
      expect(Math.abs(computed - s.published)).toBeLessThan(0.5 * HOUR);
    });
  }

  it("APPLIES PRECESSION — the check that would have caught the original bug", () => {
    /*
     * Without the J2000 → equinox-of-date correction every season lands late by the SAME amount.
     * Four dates agreeing on their error is the signature of a systematic offset, and asserting the
     * spread rather than each instant is what makes that visible in a test rather than in a
     * spreadsheet.
     */
    const errors = SEASONS.map((s) => solarCrossing(s.target, s.from, s.to) - s.published);
    const spread = Math.max(...errors) - Math.min(...errors);
    expect(spread).toBeLessThan(0.5 * HOUR);
    for (const e of errors) expect(Math.abs(e)).toBeLessThan(0.5 * HOUR);
  });
});

describe("retrogrades, against the published 2026 calendar", () => {
  const YEAR = { from: UTC(2026, 1, 1), to: UTC(2027, 1, 1) };
  const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

  it("finds Mercury's three retrogrades on the published days", () => {
    const found = retrogrades("mercury", YEAR.from, YEAR.to);
    expect(found.map((r) => [day(r.starts_at), day(r.ends_at)])).toEqual([
      ["2026-02-26", "2026-03-20"],
      ["2026-06-29", "2026-07-23"],
      ["2026-10-24", "2026-11-13"],
    ]);
  });

  it("puts Mercury in the right signs, which a bad elements row would not", () => {
    const found = retrogrades("mercury", YEAR.from, YEAR.to);
    expect(found.map((r) => r.from_sign)).toEqual(["Pisces", "Cancer", "Scorpio"]);
  });

  it("gives Mars no retrograde in 2026, because it has none", () => {
    // The easiest way to be wrong here is to find one anyway. Mars retrogrades roughly every 26
    // months and 2026 falls between two of them.
    expect(retrogrades("mars", YEAR.from, YEAR.to)).toEqual([]);
  });

  it("matches Venus and Saturn to the published calendar", () => {
    const venus = retrogrades("venus", YEAR.from, YEAR.to);
    expect(venus).toHaveLength(1);
    expect(day(venus[0]!.starts_at)).toBe("2026-10-03");
    expect(venus[0]!.from_sign).toBe("Scorpio");
    expect(venus[0]!.to_sign).toBe("Libra");

    const saturn = retrogrades("saturn", YEAR.from, YEAR.to);
    expect(saturn).toHaveLength(1);
    expect(day(saturn[0]!.starts_at)).toBe("2026-07-26");
    expect(saturn[0]!.from_sign).toBe("Aries");
  });

  it("orders the shadow windows around the retrograde rather than beside it", () => {
    for (const r of retrogrades("mercury", YEAR.from, YEAR.to)) {
      expect(r.pre_shadow_starts_at).not.toBeNull();
      expect(r.post_shadow_ends_at).not.toBeNull();
      // Pre-shadow → station retrograde → station direct → post-shadow. Any other order means the
      // crossings were found on the wrong side of the loop.
      expect(r.pre_shadow_starts_at!).toBeLessThan(r.starts_at);
      expect(r.starts_at).toBeLessThan(r.ends_at);
      expect(r.ends_at).toBeLessThan(r.post_shadow_ends_at!);
    }
  });

  it("retraces exactly the arc it backed over — the shadow's whole definition", () => {
    for (const r of retrogrades("mercury", YEAR.from, YEAR.to)) {
      // The pre-shadow begins where the retrograde will END, and the post-shadow ends where it
      // BEGAN. Getting these the wrong way round produces windows of plausible length in the wrong
      // place, which is why the degrees are checked and not just the dates.
      expect(geocentricLongitude("mercury", r.pre_shadow_starts_at!)).toBeCloseTo(r.to_longitude, 1);
      expect(geocentricLongitude("mercury", r.post_shadow_ends_at!)).toBeCloseTo(r.from_longitude, 1);
    }
  });

  it("moves backwards for the whole of a retrograde and forwards outside it", () => {
    const r = retrogrades("mercury", YEAR.from, YEAR.to)[0]!;
    const mid = (r.starts_at + r.ends_at) / 2;
    expect(dailyMotion("mercury", mid)).toBeLessThan(0);
    expect(dailyMotion("mercury", r.starts_at - 10 * 86_400_000)).toBeGreaterThan(0);
    expect(dailyMotion("mercury", r.ends_at + 10 * 86_400_000)).toBeGreaterThan(0);
  });
});

describe("ingresses", () => {
  it("records retrograde ingresses too, or a planet leaves a sign it never entered", () => {
    const found = ingresses("venus", UTC(2026, 1, 1), UTC(2027, 1, 1));
    expect(found.length).toBeGreaterThan(0);
    // Venus backs from Scorpio into Libra during its 2026 retrograde. A forward-only scan would
    // show it entering Scorpio twice with no record of it ever leaving.
    expect(found.some((i) => i.retrograde)).toBe(true);

    const SIGNS = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];
    for (const i of found) {
      /*
       * SAMPLED JUST AFTER, NOT AT. At the ingress instant the longitude sits exactly on the
       * boundary and `floor(lon / 30)` is ambiguous by a floating-point hair — 359.99999° is Pisces
       * and 0.00001° is Aries, and the bisection can land on either. The claim being tested is that
       * it is in the new sign AFTER crossing, so that is what gets sampled.
       */
      const after = geocentricLongitude("venus", i.at + 6 * 3_600_000);
      expect(SIGNS[Math.floor((((after % 360) + 360) % 360) / 30)]).toBe(i.sign);
    }
  });

  it("gives the slow planets few ingresses and the fast ones many", () => {
    const year = [UTC(2026, 1, 1), UTC(2027, 1, 1)] as const;
    expect(ingresses("mercury", ...year).length).toBeGreaterThan(ingresses("saturn", ...year).length);
    expect(ingresses("saturn", ...year).length).toBeLessThanOrEqual(2);
  });
});

describe("the table itself", () => {
  it("carries Earth for the geocentric conversion and never reports it as a planet", () => {
    expect(PLANET_BY_KEY.has("earth")).toBe(true);
    expect(RETROGRADING as readonly string[]).not.toContain("earth");
  });

  it("leaves the outer two out of the retrograde list on purpose", () => {
    // Uranus and Neptune are retrograde for about five months of every year, which is not news and
    // would bury the ones that mean something.
    expect(RETROGRADING as readonly string[]).not.toContain("uranus");
    expect(RETROGRADING as readonly string[]).not.toContain("neptune");
  });

  it("refuses a body it has no elements for rather than returning a plausible number", () => {
    expect(() => geocentricLongitude("planet-x", Date.now())).toThrow(/No orbital elements/);
  });
});

describe("the natal chart — the one thing that waits on a person", () => {
  const BIRTH = Date.parse("1990-04-17T06:12:00-05:00");

  it("computes placements from the date alone, with no ascendant and a reason", () => {
    const chart = natalChart({ born_at: BIRTH, birth_place: "Memphis", time_accuracy: "approximate" });
    expect(chart.placements.length).toBeGreaterThanOrEqual(8);
    expect(chart.placements.find((p) => p.key === "sun")!.sign).toBe("Aries");
    // A house cusp from a guessed time is a number that looks exactly like a fact, so there is none.
    expect(chart.ascendant).toBeNull();
    expect(chart.houses_note).toContain("approximate");
  });

  it("REFUSES AN ASCENDANT WITHOUT COORDINATES even when the time is exact", () => {
    const chart = natalChart({ born_at: BIRTH, birth_place: "Memphis", time_accuracy: "exact" });
    expect(chart.ascendant).toBeNull();
    expect(chart.houses_note).toContain("latitude");
  });

  it("computes the ascendant when it actually can, and names that it did", () => {
    const chart = natalChart({
      born_at: BIRTH, birth_place: "Memphis", time_accuracy: "exact",
      latitude: 35.1495, longitude: -90.0490,
    });
    expect(chart.ascendant).not.toBeNull();
    expect(chart.ascendant!.longitude).toBeGreaterThanOrEqual(0);
    expect(chart.ascendant!.longitude).toBeLessThan(360);
    expect(chart.ascendant!.degrees_in_sign).toBeLessThan(30);
    expect(chart.houses_note).toContain("exact birth time");
  });

  it("never marks the Sun retrograde, because it does not", () => {
    const chart = natalChart({ born_at: BIRTH, birth_place: "Memphis", time_accuracy: "unknown" });
    expect(chart.placements.find((p) => p.key === "sun")!.retrograde).toBe(false);
  });
});

describe("the almanac notices a kind it has never been given", () => {
  it("REBUILDS when a computed kind is missing, not only when the horizon is short", async () => {
    /*
     * THE BUG THIS PINS, FOUND IN PRODUCTION. `ensureAlmanac` asked only how far ahead the rows
     * reached. Every existing database already had twenty-four months of lunar rows, so the check
     * passed, the rebuild reported `built: 0`, and not a single retrograde was ever written — a
     * stage that runs and does nothing.
     */
    // FIRST cover the horizon, so the horizon test cannot be what triggers the rebuild. Without
    // this the test passed with the guard removed — it was proving that an EMPTY almanac gets
    // built, which was never in doubt.
    await apiJson("/api/spirit/astro/almanac/rebuild", { method: "POST", body: {} });
    const settled = await apiJson("/api/spirit/astro/almanac/rebuild", { method: "POST", body: {} });
    expect(settled.body.data.built).toBe(0);

    // Now remove ONLY the planetary kinds. The horizon is still covered, so a rebuild can only
    // happen if the missing kind is noticed.
    await env.DB.prepare(`DELETE FROM astro_calendar WHERE kind IN ('retrograde','shadow','ingress')`).run();
    const before = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM astro_calendar WHERE kind = 'retrograde'`);
    expect(before!.n).toBe(0);

    const { body } = await apiJson("/api/spirit/astro/almanac/rebuild", { method: "POST", body: {} });
    expect(body.data.built).toBeGreaterThan(0);

    const after = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM astro_calendar WHERE kind = 'retrograde'`);
    expect(after!.n).toBeGreaterThan(0);
  });

  it("names every kind it knows how to compute, so the next one added cannot go missing", () => {
    expect([...EXPECTED_COMPUTED_KINDS]).toEqual(
      expect.arrayContaining(["new_moon", "full_moon", "window", "retrograde", "shadow", "ingress"]),
    );
  });
});
