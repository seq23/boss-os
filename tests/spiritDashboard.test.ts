/**
 * THE SPIRIT DASHBOARD, PINNED AGAINST HER OWN REPORT.
 *
 * Every number below is read out of the Executive Intelligence Report she attached to her mail of
 * 12 September 2026 08:59 ("#simone"), archived at R2
 * `boss-os-documents/boss-inbound-mail/2026-09-12/iml_m2aymnxamhsws8k7.eml`. Nothing here is a
 * snapshot of what this code happens to produce — these are her figures, and the test exists to
 * prove the system reproduces them rather than approximates them.
 *
 * WHAT THAT PROVED, ON THE FIRST RUN. Nine of the ten bodies agreed to the arcminute, the Moon by
 * one arcminute, all four retrogrades matched, all three of her aspects matched (two exactly), and
 * the void-of-course window matched her start to one minute and her end exactly. The astrology on
 * the Spirit page is therefore COMPUTED at her precision, not transcribed from the report — which
 * matters because the report is one day old tomorrow and a transcription would be silently stale.
 *
 * THE ONE-ARCMINUTE TOLERANCES ARE DELIBERATE AND SMALL. `planets.ts` documents its own accuracy as
 * "about one arcminute", so demanding exact equality would be asserting a precision the method does
 * not claim, and widening past one arcminute would stop the test catching the thing it is for.
 */

import { describe, it, expect } from "vitest";
import {
  ASTROLOGY_DISCLAIMER, EPHEMERIS_BODIES, SIGN_THEME, VOC_CONVENTION,
  astroDashboard, degreeMinute, ephemeris, majorAspects, moonDashboard, orbText, voidOfCourse,
} from "@worker/boss/spirit/dashboard";
import {
  BAND, MAP_CAVEAT, MAP_WEEKS, NOT_YET_GIVEN, reading, signalFor, travelMap, unsetWeek, weekFor,
} from "@worker/boss/spirit/travelMap";

/** Her report's stated frame: "calculated for approximately 12:00 UTC". */
const HER_TS = Date.parse("2026-09-12T12:00:00Z");

/** Minutes of arc between two `D°MM′ Sign` readings, or `Infinity` if the signs differ. */
function arcminutesApart(got: { sign: string; degrees: number; arcminutes: number }, want: string): number {
  const m = /^(\d+)°(\d+)′ (\w+)$/.exec(want)!;
  if (got.sign !== m[3]) return Infinity;
  return Math.abs((got.degrees * 60 + got.arcminutes) - (Number(m[1]) * 60 + Number(m[2])));
}

describe("the ephemeris reproduces her report", () => {
  /** Her table, verbatim, in her order. */
  const HERS: [string, string, "Direct" | "Retrograde"][] = [
    ["Sun", "19°45′ Virgo", "Direct"],
    ["Moon", "6°47′ Libra", "Direct"],
    ["Mercury", "3°03′ Libra", "Direct"],
    ["Venus", "1°22′ Scorpio", "Direct"],
    ["Mars", "20°35′ Cancer", "Direct"],
    ["Jupiter", "16°05′ Leo", "Direct"],
    ["Saturn", "13°02′ Aries", "Retrograde"],
    ["Uranus", "5°42′ Gemini", "Retrograde"],
    ["Neptune", "3°21′ Aries", "Retrograde"],
    ["Pluto", "3°19′ Aquarius", "Retrograde"],
  ];

  const rows = ephemeris(HER_TS);

  it("carries exactly her ten bodies, in her order", () => {
    expect(rows.map((r) => r.name)).toEqual(HERS.map((h) => h[0]));
    // Chiron is computed by this system and is deliberately not in her table.
    expect(EPHEMERIS_BODIES).toHaveLength(10);
    expect(rows.map((r) => r.key)).not.toContain("chiron");
  });

  for (const [name, position, motion] of HERS) {
    it(`${name} is within an arcminute of ${position}, ${motion}`, () => {
      const row = rows.find((r) => r.name === name)!;
      expect(arcminutesApart(row, position)).toBeLessThanOrEqual(1);
      expect(row.motion).toBe(motion);
    });
  }

  it("keeps degrees AND arcminutes AND motion on every row — the precision IS the requirement", () => {
    for (const row of rows) {
      expect(Number.isInteger(row.degrees)).toBe(true);
      expect(Number.isInteger(row.arcminutes)).toBe(true);
      expect(row.arcminutes).toBeLessThan(60);
      expect(row.text).toMatch(/^\d+°\d{2}′ \w+$/);
      expect(["Direct", "Retrograde"]).toContain(row.motion);
    }
  });

  it("never prints 60 arcminutes, at a sign boundary or anywhere else", () => {
    // 29.99999° Virgo must roll into Libra, not print as 29°60′ Virgo.
    expect(degreeMinute(179.999999).text).toBe("0°00′ Libra");
    expect(degreeMinute(149.999999).text).toBe("0°00′ Virgo");
    expect(degreeMinute(359.999999).text).toBe("0°00′ Aries");
  });
});

describe("the Moon dashboard reproduces her report", () => {
  const moon = moonDashboard(HER_TS);

  it("puts the Moon at her degree and her illumination", () => {
    expect(arcminutesApart(moon.position, "6°47′ Libra")).toBeLessThanOrEqual(1);
    // "Approximate illumination: 2%."
    expect(moon.illumination_percent).toBe(2);
    expect(moon.waxing).toBe(true);
  });

  it("names the convention rather than asserting one", () => {
    expect(moon.void_of_course.convention).toBe(VOC_CONVENTION);
    expect(VOC_CONVENTION).toBe("final-major-Ptolemaic-aspect");
  });

  it("agrees that the Moon is not void of course on 12 September", () => {
    expect(moon.void_of_course.now).toBe(false);
  });

  it("finds her next void-of-course window, both ends and the sign it enters", () => {
    const voc = voidOfCourse(HER_TS);
    // "begins Sunday, September 13 • approximately 9:27 AM Central"
    const start = new Date(voc.starts_at);
    expect(Math.abs(start.getTime() - Date.parse("2026-09-13T14:27:00Z"))).toBeLessThanOrEqual(2 * 60_000);
    // "ends Monday, September 14 • approximately 1:45 AM Central … when the Moon enters Scorpio"
    expect(Math.abs(voc.ends_at - Date.parse("2026-09-14T06:45:00Z"))).toBeLessThanOrEqual(2 * 60_000);
    expect(voc.enters_sign).toBe("Scorpio");
    // The window has an END to it, which is what makes it plannable rather than ominous.
    expect(voc.ends_at).toBeGreaterThan(voc.starts_at);
  });

  it("carries her Libra theme verbatim, keywords and planning translation", () => {
    expect(moon.theme.sign).toBe("Libra");
    expect(moon.theme.keywords).toEqual(["balance", "negotiation", "relationship", "agreement", "proportion"]);
    expect(moon.theme.translation).toBe(
      "Clean the relationship between competing priorities instead of trying to maximize all of them simultaneously.",
    );
  });

  /*
   * A MOON IN ANY SIGN MUST LAND ON A REAL THEME. The composed-meaning bug this guards against was
   * caught once already in `transitMeaning` — one missing key and the page emits "meets fortune",
   * or here, an empty keyword list under a heading that promises one.
   */
  it("has a theme for all twelve signs, each with keywords and a planning translation", () => {
    const signs = new Set<string>();
    for (let lon = 0; lon < 360; lon += 5) signs.add(degreeMinute(lon).sign);
    expect(signs.size).toBe(12);
    for (const sign of signs) {
      const theme = SIGN_THEME[sign];
      expect(theme, `no theme for ${sign}`).toBeDefined();
      expect(theme!.keywords.length).toBeGreaterThanOrEqual(3);
      expect(theme!.translation.length).toBeGreaterThan(20);
    }
  });
});

describe("major active aspects reproduce her report, to the arcminute", () => {
  const aspects = majorAspects(HER_TS);
  const find = (a: string, name: string, b: string) =>
    aspects.find((x) => x.a === a && x.b === b && x.aspect === name)!;

  it("Mercury trine Pluto, orb ~0°16′, with her translation", () => {
    const x = find("mercury", "trine", "pluto");
    expect(x.orb_text).toBe("0°16′");
    expect(x.tightness).toBe("Very tight");
    expect(x.symbolism).toContain("deep analysis");
    expect(x.translation).toBe("Ask the question beneath the question.");
  });

  it("Mercury opposition Neptune, orb ~0°18′, ambiguity and incomplete information", () => {
    const x = find("mercury", "opposition", "neptune");
    expect(x.orb_text).toBe("0°18′");
    expect(x.tightness).toBe("Very tight");
    expect(x.symbolism).toEqual(expect.arrayContaining(["ambiguity", "incomplete information"]));
    expect(x.translation).toMatch(/Verify before concluding/);
  });

  it("Neptune sextile Pluto, the generational one, within an arcminute of her 0°02′", () => {
    const x = find("neptune", "sextile", "pluto");
    expect(Math.abs(Math.round(x.orb * 60) - 2)).toBeLessThanOrEqual(1);
    expect(x.symbolism.join(" ")).toMatch(/long-duration institutional transformation/);
  });

  it("orders by tightness and states every orb in arcminutes, not decimals", () => {
    expect(aspects.length).toBeGreaterThan(0);
    for (const a of aspects) expect(a.orb_text).toMatch(/^\d+°\d{2}′$/);
    const orbs = aspects.map((a) => a.orb);
    expect([...orbs].sort((p, q) => p - q)).toEqual(orbs);
  });

  it("orbText keeps the distinction a decimal destroys", () => {
    // 0°16′ and 0°18′ are both "0.3°" rounded. That is the whole reason for this format.
    expect(orbText(16 / 60)).toBe("0°16′");
    expect(orbText(18 / 60)).toBe("0°18′");
    expect(orbText(16 / 60)).not.toBe(orbText(18 / 60));
  });
});

describe("the disclaimer travels with the content", () => {
  it("is hers, verbatim", () => {
    expect(ASTROLOGY_DISCLAIMER).toBe(
      "Astrology here is symbolic planning language—not scientifically validated forecasting.",
    );
  });

  it("is part of the dashboard payload, not a page decoration", () => {
    const d = astroDashboard(HER_TS);
    expect(d.disclaimer).toBe(ASTROLOGY_DISCLAIMER);
    expect(d.note).toMatch(/tropical and geocentric/);
    expect(d.note).toMatch(/12:00 UTC/);
    expect(d.bodies).toHaveLength(10);
    expect(d.retrogrades.map((r) => r.name)).toEqual(["Saturn", "Uranus", "Neptune", "Pluto"]);
  });
});

describe("the locked Money / Career / Travel Map", () => {
  it("covers every week from June to the end of the year with no hole between them", () => {
    expect(MAP_WEEKS.length).toBe(30);
    for (let i = 1; i < MAP_WEEKS.length; i++) {
      const prevEnd = Date.parse(`${MAP_WEEKS[i - 1]!.ends}T00:00:00Z`);
      const start = Date.parse(`${MAP_WEEKS[i]!.starts}T00:00:00Z`);
      expect(start - prevEnd).toBe(86_400_000);
    }
  });

  it("keeps her doubled marks distinct from her single ones", () => {
    expect(BAND.green.glyph).toBe("🟢");
    expect(BAND.peak_green.glyph).toBe("🟢🟢");
    expect(BAND.green.glyph).not.toBe(BAND.peak_green.glyph);
    expect(signalFor(MAP_WEEKS.find((w) => w.label === "Oct 12–18")!).signal).toBe("🟢🟢");
    expect(signalFor(MAP_WEEKS.find((w) => w.label === "Dec 21–31")!).signal).toBe("🔴 ✈️✈️");
    expect(signalFor(MAP_WEEKS.find((w) => w.label === "Dec 14–20")!).signal).toBe("🔴 ✈️");
  });

  it("uses her legend for red — a posture, not a holiday", () => {
    expect(BAND.red.meaning).toBe("Protect energy; do not force");
    expect(BAND.red.meaning).not.toMatch(/rest|reset/i);
  });

  it("puts 12 September in her yellow travel week and names the next transition", () => {
    const map = travelMap("2026-09-12");
    expect(map.current!.label).toBe("Sep 7–13");
    expect(map.current!.signal).toBe("🟡 ✈️");
    expect(map.current!.note).toBe("Travel, recalibration, systems review");
    expect(map.next!.label).toBe("Sep 14–20");
    expect(map.next!.signal).toBe("🟡");
    expect(map.caveat).toBe(MAP_CAVEAT);
  });

  /*
   * THE ARM THAT MATTERS MOST. On 12 September four weeks were briefly believed unlocked, and the
   * tempting fix was to infer them from the weeks either side. `unset` exists so that a week with
   * no band can never come out the other end wearing a colour.
   */
  it("renders an ungiven week as 'not yet given' and never as a colour", () => {
    const week = unsetWeek("Jan 5–11", "2027-01-05", "2027-01-11");
    const { signal, meaning } = signalFor(week);
    expect(signal).toBe(NOT_YET_GIVEN);
    expect(signal).not.toMatch(/🟢|🟡|🔴|✈️/);
    expect(meaning).toMatch(/has not locked a band/);
    expect(week.travel).toBeNull();
    expect(week.note).toBeNull();
  });

  /*
   * Her own reading of 12 September is the shape this must produce: the band, her note, and the
   * mistake the band invites — "…but don't try to manufacture peak October intensity in September."
   */
  it("reads the current week as a sentence, ending on the mistake the band invites", () => {
    const r = travelMap("2026-09-12").current!.reading!;
    expect(r).toMatch(/Maintain, prepare, refine/);
    expect(r).toMatch(/Travel, recalibration, systems review/);
    expect(r).toMatch(/travel\/reset window is favoured/i);
    expect(r).toMatch(/manufacture peak intensity out of a maintenance week/);
  });

  it("gives an ungiven week no reading — a sentence is the most persuasive form a guess can take", () => {
    expect(reading(unsetWeek("Jan 5–11", "2027-01-05", "2027-01-11"))).toBeNull();
    expect(reading(MAP_WEEKS.find((w) => w.label === "Dec 21–31")!)).toMatch(/Protect energy/);
  });

  it("has no glyph for `unset` at all, so no fallback can paint one", () => {
    expect(Object.keys(BAND)).not.toContain("unset");
    expect((BAND as Record<string, unknown>).unset).toBeUndefined();
  });

  it("says a day is outside the map rather than returning the nearest week", () => {
    expect(weekFor("2026-03-02")).toBeNull();
    const map = travelMap("2026-03-02");
    expect(map.current).toBeNull();
    expect(map.uncovered_reason).toMatch(/outside the locked map/);
  });

  /* RULE 0, in the data rather than only in the scan. */
  it("an empty map reports itself as a fault, not as a year without bands", () => {
    const map = travelMap("2026-09-12", []);
    expect(map.covered).toBe(false);
    expect(map.empty_reason).toMatch(/fault, not a year without bands/);
  });
});
