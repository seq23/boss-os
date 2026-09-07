import { describe, expect, it } from "vitest";
import { natalChart, transitAspects, transits, ASPECTS } from "../../src/worker/boss/spirit/natal";
import { ORB, TRANSIT_BODY, NATAL_POINT, ASPECT_TONE, meaningFor } from "../../src/worker/boss/spirit/transitMeaning";

/**
 * THE GUARD ON THE TRANSIT SURFACE.
 *
 * THE BUG THIS EXISTS TO KEEP DEAD: `transits()` compared every body ONLY to its own natal degree.
 * Ten bodies, ten comparisons, and the only aspects that could ever exist were returns and their
 * fractions. The Spirit screen showed two lines, both slow outer-planet aspects that had been true
 * for a year — and the owner's report was precisely the symptom: "the spirit tab does not have all
 * the transits happening only 2 long term ones."
 *
 * Nothing about that output looked broken. Two aspects is a plausible number of aspects. It was
 * only wrong in what it could NEVER say, which is why the tests below assert reach — how many
 * distinct natal points the sky is capable of touching — rather than any particular day's list.
 */

const OWNER = {
  born_at: Date.parse("1986-07-23T02:29:00-05:00"),
  birth_place: "Memphis, TN",
  time_accuracy: "exact" as const,
  latitude: 35.1495,
  longitude: -90.0490,
};

const CHART = natalChart(OWNER);
const DAY = 86_400_000;

describe("transits reach the whole chart, not just each body's own degree", () => {
  /*
   * THE NEGATIVE PROOF, RUN AS A TEST RATHER THAN DESCRIBED IN A COMMENT. The old function is still
   * exported and still correct at what it does, so the difference can be measured directly instead
   * of asserted from memory: over the same month, returns-only reaches a handful of natal points
   * and cross-body reaches most of the chart. If someone ever rewires the screen back to
   * `transits()`, this is the number that collapses.
   */
  const MONTH = Array.from({ length: 30 }, (_, i) => Date.UTC(2026, 8, 1) + i * DAY);

  it("touches many more natal points than the returns-only function could", () => {
    const crossPoints = new Set<string>();
    for (const at of MONTH) for (const t of transitAspects(CHART, at)) crossPoints.add(t.natal_point);

    const returnPoints = new Set<string>();
    for (const at of MONTH) {
      for (const t of transits(CHART, at)) if (t.aspect) returnPoints.add(t.key);
    }

    // Rule 0: a scan that examined nothing is not a pass.
    expect(MONTH.length).toBe(30);
    expect(crossPoints.size).toBeGreaterThan(returnPoints.size * 2);
    expect(crossPoints.size).toBeGreaterThanOrEqual(10);
  });

  it("sees the Moon against natal points that are not the Moon — the case that was impossible before", () => {
    /*
     * HER OWN EXAMPLE, MADE INTO AN ASSERTION. "If the moon crosses your natal jupiter" — the Moon
     * aspects natal Jupiter several times a month and the old function could not have produced that
     * line on any day of any year, because the Moon was only ever compared to the Moon.
     */
    const hits = MONTH.flatMap((at) => transitAspects(CHART, at))
      .filter((t) => t.body === "moon" && t.natal_point === "jupiter");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("includes the angles, which only exist because the birth time is exact", () => {
    const angles = new Set(
      MONTH.flatMap((at) => transitAspects(CHART, at))
        .map((t) => t.natal_point)
        .filter((k) => k === "ascendant" || k === "midheaven" || k === "fortune"),
    );
    expect(angles.size).toBeGreaterThan(0);
  });

  it("omits the angles entirely rather than approximating them when the time is unknown", () => {
    const vague = natalChart({ ...OWNER, time_accuracy: "unknown" });
    const points = new Set(transitAspects(vague, Date.UTC(2026, 8, 7)).map((t) => t.natal_point));
    expect(points.has("ascendant")).toBe(false);
    expect(points.has("midheaven")).toBe(false);
    expect(points.has("fortune")).toBe(false);
  });
});

describe("orbs are sized to each body's speed", () => {
  it("never reports an aspect wider than the moving body's own orb", () => {
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      for (const t of transitAspects(CHART, Date.UTC(2026, 8, 1) + i * DAY)) {
        checked++;
        expect(t.orb).toBeLessThanOrEqual(ORB[t.body]!);
      }
    }
    // A loop that examined zero aspects would pass vacuously, which is the defect class this
    // repository names most often.
    expect(checked).toBeGreaterThan(50);
  });

  it("classifies the slow bodies as season and the fast ones as today", () => {
    const sample = Array.from({ length: 20 }, (_, i) => Date.UTC(2026, 8, 1) + i * DAY)
      .flatMap((at) => transitAspects(CHART, at));
    expect(sample.some((t) => t.speed === "fast")).toBe(true);
    for (const t of sample) {
      const fast = ["moon", "sun", "mercury", "venus", "mars"].includes(t.body);
      expect(t.speed).toBe(fast ? "fast" : "slow");
    }
  });
});

describe("canon §5.2 — the copy describes weather and never instructs", () => {
  /*
   * THE COPY IS WHERE THIS RULE ACTUALLY BREAKS. The arithmetic cannot violate §5.2; a sentence
   * can, and it takes one word. "A good time to ask for money" is the system treating a sky
   * position as a cause, which §1.5 forbids by name — and it is the single most natural sentence to
   * write on a transit screen, which is exactly why it is asserted against rather than trusted to
   * reviewer attention.
   */
  const FORBIDDEN = [
    /\bgood (?:time|day) to\b/i,
    /\bbad (?:time|day) to\b/i,
    /\byou should\b/i,
    /\bavoid\b/i,
    /\bdon't\b/i,
    /\bmake sure to\b/i,
    /\bexpect (?:money|a windfall|good news)\b/i,
    /\bwill bring\b/i,
    /\bguarantee/i,
    /\blucky day\b/i,
  ];

  it("produces no instruction or prediction across every possible combination", () => {
    let checked = 0;
    for (const body of Object.keys(TRANSIT_BODY)) {
      for (const point of Object.keys(NATAL_POINT)) {
        for (const aspect of Object.keys(ASPECT_TONE)) {
          const line = meaningFor(body, point, aspect);
          checked++;
          expect(line.length).toBeGreaterThan(20);
          for (const pattern of FORBIDDEN) {
            expect(line, `${body} ${aspect} ${point}`).not.toMatch(pattern);
          }
        }
      }
    }
    // Every combination, not a sample — the whole point of composing from parts is that the surface
    // is small enough to check exhaustively.
    expect(checked).toBe(
      Object.keys(TRANSIT_BODY).length * Object.keys(NATAL_POINT).length * Object.keys(ASPECT_TONE).length,
    );
  });

  it("has a meaning for every body, point and aspect the transit engine can emit", () => {
    // A missing vocabulary entry falls back to the raw key and produces a line like "moon meets
    // midheaven" — grammatical, useless, and invisible unless something checks the keys line up.
    for (const t of Array.from({ length: 30 }, (_, i) => Date.UTC(2026, 8, 1) + i * DAY)
      .flatMap((at) => transitAspects(CHART, at))) {
      expect(TRANSIT_BODY[t.body], `no vocabulary for transiting ${t.body}`).toBeDefined();
      expect(NATAL_POINT[t.natal_point], `no vocabulary for natal ${t.natal_point}`).toBeDefined();
      expect(ASPECT_TONE[t.aspect], `no vocabulary for ${t.aspect}`).toBeDefined();
    }
  });

  it("covers every aspect the engine knows about", () => {
    for (const a of ASPECTS) expect(ASPECT_TONE[a.name]).toBeDefined();
  });
});

/**
 * THE SKY ENDPOINT HAD TO BE ASKED FOR THE SKY AND ANSWERED WITH A MOON.
 *
 * `/astro/at` is named for the whole sky at an instant and returned lunar data only. The omission
 * was invisible from the outside — a caller asking where the sky is and getting a moon does not
 * obviously have half an answer — and it cost something real: the first Executive Intelligence
 * Report went to the open web for planetary longitudes, collected four 403s and 404s, and filed a
 * gap saying its positions carried ±1°, while this system held them to about an arcminute.
 */
describe("the sky endpoint returns the whole sky", () => {
  it("names every body with a position, not only the Moon", async () => {
    const { apiJson } = await import("./helpers");
    const { status, body } = await apiJson(`/api/spirit/astro/at?ts=${Date.UTC(2026, 8, 7, 12)}`);
    expect(status).toBe(200);
    expect(body.data.moon).toBeTruthy();

    const keys = body.data.planets.map((p: any) => p.key);
    for (const k of ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "chiron"]) {
      expect(keys, `${k} missing from the sky`).toContain(k);
    }
  });

  it("agrees with the natal chart's own arithmetic, rather than being a second implementation", async () => {
    // Two code paths producing two answers for one sky is how a screen and a report quietly
    // disagree. They must be the same function, and this is what proves they are.
    const { apiJson } = await import("./helpers");
    const at = Date.UTC(2026, 8, 7, 12);
    const { body } = await apiJson(`/api/spirit/astro/at?ts=${at}`);
    const chart = natalChart({ ...OWNER, born_at: at });
    for (const p of body.data.planets) {
      const same = chart.placements.find((x) => x.key === p.key);
      if (!same) continue;
      expect(Math.abs(same.longitude - p.longitude)).toBeLessThan(1e-9);
    }
  });

  it("says plainly that nothing is retrieved from a site", async () => {
    const { apiJson } = await import("./helpers");
    const { body } = await apiJson(`/api/spirit/astro/at?ts=${Date.now()}`);
    expect(body.data.method).toContain("Nothing is retrieved");
  });
});

/**
 * THE MONTH'S IMPORTANT DATES.
 *
 * The almanac already computed thirty-odd events a month, and the page could already show them all.
 * That is a calendar, not a signal: shown at once it says nothing about which two days are worth
 * knowing in advance. What makes a date important is that it is HERS — a full moon belongs to
 * everybody, a transit going exact on her Midheaven does not.
 */
describe("the month ahead", () => {
  const at = (m: string) => Date.parse(`${m}-15T12:00:00Z`);

  it("finds dates that touch her own chart, which an almanac structurally cannot", async () => {
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(OWNER, at("2026-10"));
    const personal = m.dates.filter((d) => d.scope === "personal");
    expect(personal.length).toBeGreaterThan(0);
    expect(personal.map((d) => d.headline).join(" | ")).toMatch(/your natal/);
  });

  it("lists periods nowhere, because this is a list of dates", async () => {
    /*
     * The derived lunar windows — intention, push, visibility, release, reflection — cover most of a
     * month between them, and on the first run they filled a third of the list with spans that have
     * no particular day. They remain in the full almanac, where a period belongs.
     */
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(OWNER, at("2026-09"));
    expect(m.dates.map((d) => d.headline).join(" ")).not.toMatch(/window/i);
  });

  it("keeps every date inside the month it claims", async () => {
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    for (const month of ["2026-09", "2026-10", "2026-11"]) {
      const m = monthAhead(OWNER, at(month));
      expect(m.month).toBe(month);
      for (const d of m.dates) expect(d.day.startsWith(month), `${d.day} is not in ${month}`).toBe(true);
    }
  });

  it("reports one date per transit, not forty consecutive ones", async () => {
    /*
     * A Saturn aspect stays in orb for weeks. Without taking the minimum it would appear on every
     * day of that window, which is the opposite of a list of important dates.
     */
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(OWNER, at("2026-10"));
    const personal = m.dates.filter((d) => d.scope === "personal").map((d) => d.headline);
    expect(new Set(personal).size).toBe(personal.length);
  });

  it("only lists slow bodies, because the fast ones do this every month", async () => {
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(OWNER, at("2026-09"));
    for (const d of m.dates.filter((x) => x.scope === "personal")) {
      expect(d.headline).not.toMatch(/^(Moon|Sun|Mercury|Venus|Mars) /);
    }
  });

  it("says a quiet month is quiet rather than padding it", async () => {
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(null, at("2026-09"));
    expect(m.note).toContain("No birth data");
    expect(m.dates.every((d) => d.scope === "sky")).toBe(true);
  });

  it("carries §5.2 on the month view as well as the day view", async () => {
    const { monthAhead } = await import("../../src/worker/boss/spirit/month");
    const m = monthAhead(OWNER, at("2026-09"));
    expect(m.caveat).toMatch(/reason to schedule or avoid/i);
    // Approximate, and it says so rather than implying a precision it did not compute.
    expect(m.caveat).toMatch(/approximate/i);
  });
});
