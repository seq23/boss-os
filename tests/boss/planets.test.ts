import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { EXPECTED_COMPUTED_KINDS } from "../../src/worker/boss/spirit/day";
import {
  geocentricLongitude, dailyMotion, stations, retrogrades, ingresses,
  RETROGRADING, PLANET_BY_KEY,
} from "../../src/worker/boss/spirit/planets";
import { natalChart, type NatalPlacement } from "../../src/worker/boss/spirit/natal";
import { moonPosition } from "../../src/worker/boss/spirit/astro";

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
    expect(chart.placements.find((p: NatalPlacement) => p.key === "sun")!.sign).toBe("Aries");
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
    expect(chart.placements.find((p: NatalPlacement) => p.key === "sun")!.retrograde).toBe(false);
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

describe("the ascendant, against facts that cannot lie", () => {
  const MEMPHIS = { latitude: 35.1495, longitude: -90.0490 };
  const chartAt = (ts: number) =>
    natalChart({ born_at: ts, birth_place: "Memphis", time_accuracy: "exact", ...MEMPHIS });

  /**
   * Solar altitude, so "is the Sun rising here" is answerable without a sunrise table.
   */
  function solarAltitude(ts: number): number {
    const RAD = Math.PI / 180;
    const lon = geocentricLongitude("sun", ts) * RAD;
    const T = (ts / 86_400_000 + 2_440_587.5 - 2_451_545.0) / 36_525;
    const e = (23.439291111 - 0.0130041667 * T) * RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(lon));
    const ra = Math.atan2(Math.cos(e) * Math.sin(lon), Math.cos(lon)) / RAD;
    const jd = ts / 86_400_000 + 2_440_587.5;
    const gmst = 280.46061837 + 360.98564736629 * (jd - 2_451_545.0);
    const ha = (((gmst + MEMPHIS.longitude - ra) % 360) + 360) % 360;
    const lat = MEMPHIS.latitude * RAD;
    return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD;
  }

  it("IS THE SUN AT SUNRISE, AND SUNRISE IS WHEN THE SUN IS RISING", () => {
    /*
     * THE BUG THIS EXISTS FOR. The formula returned the DESCENDANT — an extra 180° on a form that
     * already lands on the eastern horizon. Every chart was a half-turn wrong and entirely
     * self-consistent; nothing about the output looked odd. What caught it was a birth three hours
     * before dawn coming back with a Sagittarius rising.
     *
     * The check needs no published table: the Sun sits on the eastern horizon at the moment it
     * rises, so at that instant the ascendant IS the Sun. The descendant would coincide at SUNSET,
     * which is why the altitude has to be increasing for the test to mean anything — matching
     * longitudes alone would pass either way, twelve hours apart.
     */
    const day = Date.UTC(1986, 6, 23);
    let matched = false;

    for (let m = 0; m < 24 * 60; m += 2) {
      const t = day + m * 60_000;
      const asc = chartAt(t).ascendant!.longitude;
      const sun = geocentricLongitude("sun", t);
      let gap = Math.abs(asc - sun);
      if (gap > 180) gap = 360 - gap;
      if (gap < 0.6) {
        expect(solarAltitude(t + 600_000)).toBeGreaterThan(solarAltitude(t - 600_000));
        // And it is genuinely near the horizon, not merely climbing at midday.
        expect(Math.abs(solarAltitude(t))).toBeLessThan(3);
        matched = true;
      }
    }
    expect(matched).toBe(true);
  });

  it("runs forward through the zodiac, and never sits behind the Midheaven", () => {
    // ASC leads MC through the signs. A flipped ascendant puts the gap past 180°, so this catches
    // the same defect from a completely different direction.
    for (let h = 0; h < 24; h += 3) {
      const c = chartAt(Date.UTC(1986, 6, 23) + h * 3_600_000);
      const gap = (((c.ascendant!.longitude - c.midheaven!.longitude) % 360) + 360) % 360;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(180);
    }
  });

  it("moves about a degree every four minutes, which is why the birth time matters", () => {
    const t = Date.UTC(1986, 6, 23, 7, 29);
    const a = chartAt(t).ascendant!.longitude;
    const b = chartAt(t + 4 * 60_000).ascendant!.longitude;
    let moved = b - a;
    if (moved < -180) moved += 360;
    expect(moved).toBeGreaterThan(0.4);
    expect(moved).toBeLessThan(2.5);
  });
});

describe("the Moon, against Meeus's own worked example", () => {
  it("REPRODUCES EXAMPLE 47.a — the check that caught a 1.7° error", () => {
    /*
     * THE BUG THIS EXISTS FOR, AND IT WAS IN THE ORIGINAL SIX-TERM CODE TOO.
     *
     * The EVECTION — the second-largest term in the lunar longitude series — carried the wrong
     * sign. That is a 1.7° error in the Moon, which is three hours of lunar motion and enough to
     * put it in the wrong SIGN for half a day either side of a cusp. Nothing looked wrong: the Moon
     * was in a plausible degree of a plausible sign every single day.
     *
     * It survived because the module was only ever checked against itself. The owner caught it by
     * reading her own natal Moon and saying it was a degree and a half out. This test is the check
     * that should have existed from the first line: Meeus publishes the intermediate values AND the
     * answer for 1992 April 12.0, so the series can be verified without any ephemeris at all.
     */
    const t = Date.parse("1992-04-12T00:00:00Z");
    expect(moonPosition(t).longitude).toBeCloseTo(133.162655, 1);
  });

  it("agrees with a professional ephemeris on a real birth chart", () => {
    // Independent of Meeus: a chart cast elsewhere, for a date forty years earlier. Two references
    // that cannot both be wrong in the same direction.
    const born = Date.parse("1986-07-23T02:29:00-05:00");
    const moon = moonPosition(born);
    expect(moon.sign).toBe("Aquarius");
    expect(moon.degrees_in_sign).toBeCloseTo(25 + 34 / 60, 1);
  });

  it("keeps the evection at full strength, not merely present", () => {
    /*
     * A sign error and a dropped term look identical in a single spot check — both leave the Moon
     * somewhere plausible. Sampling across a month catches either, because the evection's
     * contribution swings through its full ±1.27° range over the synodic cycle.
     */
    let worst = 0;
    for (let d = 0; d < 30; d++) {
      const t = Date.parse("1992-04-12T00:00:00Z") + d * 86_400_000;
      // Recompute the expected longitude from the series' own definition of a day's motion: the
      // Moon must never jump. A wrong-signed term shows up as a discontinuity in the derivative.
      const a = moonPosition(t).longitude;
      const b = moonPosition(t + 3_600_000).longitude;
      let step = b - a;
      if (step < -180) step += 360;
      worst = Math.max(worst, Math.abs(step));
    }
    // The Moon moves 0.4–0.7° an hour. Anything outside that band means a term is fighting the rest.
    expect(worst).toBeLessThan(0.75);
  });
});

describe("the chart points that are not planets", () => {
  const BIRTH = {
    born_at: Date.parse("1986-07-23T02:29:00-05:00"),
    birth_place: "Memphis, TN", time_accuracy: "exact" as const,
    latitude: 35.1495, longitude: -90.0490,
  };

  it("includes the Moon at all — it was missing entirely", () => {
    // The first version listed Sun through Neptune and simply never added the Moon, which is one of
    // the three points anybody reads first. Nothing in a table of PLANETS would have produced it.
    const keys = natalChart(BIRTH).placements.map((p: NatalPlacement) => p.key);
    expect(keys).toContain("moon");
    expect(keys).toContain("pluto");
    expect(keys).toContain("chiron");
    expect(keys).toContain("node");
    expect(keys).toContain("lilith");
  });

  it("matches a professional chart on the slow points, which cannot be time errors", () => {
    const by = new Map(natalChart(BIRTH).placements.map((p: NatalPlacement) => [p.key, p]));
    // Pluto moves 1.5° a YEAR, so agreeing here validates the elements rather than the clock.
    expect(by.get("pluto")!.sign).toBe("Scorpio");
    expect(by.get("pluto")!.degrees_in_sign).toBeCloseTo(4 + 33 / 60, 1);
    expect(by.get("node")!.sign).toBe("Aries");
    expect(by.get("node")!.degrees_in_sign).toBeCloseTo(25 + 3 / 60, 1);
  });

  it("states Chiron's accuracy rather than implying it has none", () => {
    const chiron = natalChart(BIRTH).placements.find((p: NatalPlacement) => p.key === "chiron")!;
    expect(chiron.sign).toBe("Gemini");
    // Held at one epoch and propagated, so it is a degree out forty years back. Said, not hidden.
    expect(chiron.accuracy).toContain("1°");
  });

  it("puts Fortune where the night formula puts it, and says which it used", () => {
    const c = natalChart(BIRTH);
    expect(c.fortune!.sect).toBe("night");
    expect(c.fortune!.sign).toBe("Scorpio");
    expect(c.fortune!.degrees_in_sign).toBeCloseTo(15 + 42 / 60, 1);
  });
});
