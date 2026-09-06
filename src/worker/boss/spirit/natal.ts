import { planetPosition, geocentricLongitude, ZODIAC_SIGNS, METHOD_PLANETS } from "./planets";
import { moonPosition } from "./astro";

/**
 * THE NATAL CHART — its own module, because it needs both halves of the sky.
 *
 * It lives here rather than in `planets.ts` for a mechanical reason: the chart needs the Moon, the
 * Moon lives in `astro.ts`, and `astro.ts` already imports the planets for the almanac. Putting the
 * chart in either one would close a circular import. A third module that depends on both is the
 * shape that actually works.
 *
 * WHAT THE OWNER CAUGHT, AND IT WAS NOT SUBTLE ONCE SAID: the first version of this chart had NO
 * MOON. The body list ran Sun through Neptune and simply never included it — the one point besides
 * the Sun and the Ascendant that everybody reads first. It also had no Pluto and no Lot of Fortune.
 */

const DAY_MS = 86_400_000;
const RAD = Math.PI / 180;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const J2000_JD = 2_451_545.0;


/**
 * How well the birth time is known, which decides how much of the chart is real.
 *
 * THIS IS NOT A DISCLAIMER FIELD. The planets move slowly enough that an hour either way barely
 * touches them; the ascendant moves a degree every four minutes. So the accuracy determines what
 * gets returned, not merely what gets footnoted — an unknown time returns placements and NO houses,
 * because a house cusp computed from a guess is a number that looks exactly like a fact.
 */
export const TIME_ACCURACY = ["exact", "approximate", "unknown"] as const;
export type TimeAccuracy = (typeof TIME_ACCURACY)[number];

export interface BirthData {
  /** Epoch ms of the birth instant, UTC. */
  born_at: number;
  birth_place: string;
  time_accuracy: TimeAccuracy;
  /** Degrees north, needed for the ascendant. */
  latitude?: number | null;
  /** Degrees east, needed for the ascendant. */
  longitude?: number | null;
}

export interface NatalPlacement {
  key: string;
  name: string;
  longitude: number;
  sign: string;
  degrees_in_sign: number;
  retrograde: boolean;
  /** How far this particular number can be trusted. Carried per body, because it differs per body. */
  accuracy?: string;
}

export interface NatalChart {
  placements: NatalPlacement[];
  ascendant: { longitude: number; sign: string; degrees_in_sign: number } | null;
  /** The Midheaven — the ecliptic point on the meridian. Null whenever the ascendant is. */
  midheaven: { longitude: number; sign: string; degrees_in_sign: number } | null;
  /**
   * The Lot of Fortune, which needs the ascendant and therefore shares its fate: no exact time, no
   * Fortune. `sect` is carried because the formula REVERSES between a day and a night birth, and a
   * Fortune quoted without saying which was used cannot be checked by anyone.
   */
  fortune: { longitude: number; sign: string; degrees_in_sign: number; sect: "day" | "night" } | null;
  /** Why there is no ascendant, when there is none. Never silent. */
  houses_note: string;
  method: string;
}

/** Greenwich mean sidereal time in degrees. Meeus ch. 12. */
function gmstDegrees(ts: number): number {
  const jd = ts / DAY_MS + 2_440_587.5;
  const T = (jd - J2000_JD) / 36_525;
  return norm360(
    280.46061837 + 360.98564736629 * (jd - J2000_JD) + 0.000387933 * T * T - (T * T * T) / 38_710_000,
  );
}

/**
 * The Sun's altitude above the horizon, which is what decides sect.
 *
 * Computed rather than inferred from the hour, because "day birth" is a statement about the sky and
 * a 2:29am birth in July is not the same question as a 2:29am birth in December.
 */
function solarAltitude(ts: number, latitude: number, longitude: number): number {
  const lon = geocentricLongitude("sun", ts) * RAD;
  const e = obliquity(ts) * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(lon));
  const ra = Math.atan2(Math.cos(e) * Math.sin(lon), Math.cos(lon)) / RAD;
  const ha = norm360(gmstDegrees(ts) + longitude - ra) * RAD;
  const lat = latitude * RAD;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** Mean obliquity of the ecliptic, degrees. */
function obliquity(ts: number): number {
  const T = (ts / DAY_MS + 2_440_587.5 - J2000_JD) / 36_525;
  return 23.439291111 - 0.0130041667 * T - 1.6667e-7 * T * T + 5.027778e-7 * T * T * T;
}

/**
 * The natal chart, from the same arithmetic as everything else on the Spirit screen.
 *
 * NOTHING WAS EVER MISSING BUT THE BIRTH DATA. This function existed the moment `planets.ts` did;
 * what it needs is three facts, and the screen asks for them rather than reporting the whole layer
 * as permanently deferred for want of an ephemeris.
 */
export function natalChart(birth: BirthData): NatalChart {
  /*
   * THE MOON IS FIRST BECAUSE IT IS FIRST. It comes from the lunar series rather than the planetary
   * table — a different computation for a body in a different place — and being the fastest thing
   * in the chart it is also the one most sensitive to the birth time.
   */
  const moon = moonPosition(birth.born_at);
  const sunLongitude = geocentricLongitude("sun", birth.born_at);

  /*
   * THE MEAN NODE AND MEAN LILITH, from their standard polynomials. Both are properties of the
   * Moon's orbit rather than things in the sky: the node is where its plane crosses the ecliptic,
   * Lilith is the empty focus of its ellipse — the perigee plus 180°.
   */
  const T = (birth.born_at / DAY_MS + 2_440_587.5 - J2000_JD) / 36_525;
  const node = norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T);
  const lilith = norm360(
    83.3532465 + 4069.0137287 * T - 0.0103200 * T * T - (T ** 3) / 80_053 + (T ** 4) / 18_999_000 + 180,
  );
  const bodies = ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "chiron"];
  const placements: NatalPlacement[] = [
    {
      key: "moon", name: "Moon",
      longitude: moon.longitude,
      sign: moon.sign,
      degrees_in_sign: moon.degrees_in_sign,
      retrograde: false, // The Moon never retrogrades. Saying so is a fact, not a special case.
      accuracy: "about 0.005° — the full Meeus 47.A series",
    },
    ...bodies.map((key) => {
    const p = planetPosition(key, birth.born_at);
    return {
      key, name: p.name,
      longitude: p.longitude,
      sign: ZODIAC_SIGNS[Math.floor(p.longitude / 30)]!,
      degrees_in_sign: p.longitude % 30,
      // The Sun never retrogrades; reporting it as direct is a fact, not a special case.
      retrograde: key === "sun" ? false : p.retrograde,
      /*
       * ACCURACY, PER BODY, ON THE ROW ITSELF. Chiron is a Saturn-crossing centaur whose elements
       * are held at one epoch, so it is exact near that epoch and drifts about a degree over forty
       * years — checked against a professional chart in both directions. Saying so beside the
       * degree is the difference between a number and a claim.
       */
      accuracy: key === "chiron" ? "about 1° for dates far from 2026" : "about 1 arcminute",
    };
  }),
  /*
   * THE POINTS THAT ARE NOT BODIES, and were missing entirely until the owner listed her own chart.
   * The Node and Lilith are angles derived from the lunar orbit rather than objects with positions,
   * which is exactly why they got overlooked: nothing in a table of planets would ever produce them.
   */
  {
    key: "node", name: "North Node (mean)",
    longitude: node,
    sign: ZODIAC_SIGNS[Math.floor(node / 30)]!,
    degrees_in_sign: node % 30,
    // The nodes always move backwards. It is not a retrograde in the sense the planets have one.
    retrograde: true,
    accuracy: "exact — the mean node is a defined angle, not an observation",
  },
  {
    key: "lilith", name: "Lilith (mean)",
    longitude: lilith,
    sign: ZODIAC_SIGNS[Math.floor(lilith / 30)]!,
    degrees_in_sign: lilith % 30,
    retrograde: false,
    accuracy: "about 0.1° — implementations of the mean apogee differ slightly",
  }];

  /*
   * THE ASCENDANT IS RETURNED ONLY WHEN IT CAN BE. It needs an exact time AND a latitude and
   * longitude, and each missing piece is named — "houses unavailable" with no reason is the kind of
   * blank a person fills in with the wrong assumption.
   */
  const missing: string[] = [];
  if (birth.time_accuracy !== "exact") missing.push(`the birth time is ${birth.time_accuracy}`);
  if (birth.latitude === null || birth.latitude === undefined) missing.push("no birth latitude");
  if (birth.longitude === null || birth.longitude === undefined) missing.push("no birth longitude");

  if (missing.length) {
    return {
      placements,
      ascendant: null,
      midheaven: null,
      fortune: null,
      houses_note:
        `No ascendant or houses: ${missing.join(", ")}. The planetary placements above are unaffected — ` +
        `they move slowly enough that a time to the nearest hour does not change them, whereas the ` +
        `ascendant moves a degree every four minutes.`,
      method: METHOD_PLANETS,
    };
  }

  const lst = norm360(gmstDegrees(birth.born_at) + birth.longitude!);
  const e = obliquity(birth.born_at) * RAD;
  const ramc = lst * RAD;
  const lat = birth.latitude! * RAD;

  /*
   * THE ASCENDANT, AND THE +180 THAT USED TO BE HERE WAS THE DESCENDANT.
   *
   * This atan2 form already lands on the eastern horizon; adding 180° on top of it turned every
   * chart a half-turn and returned the western point instead. Her chart came back with a
   * Sagittarius rising at 2:29am, which is roughly the opposite of what a birth three hours before
   * dawn gives, and that is what caught it — the arithmetic was self-consistent and confidently
   * wrong.
   *
   * THE TEST THAT CANNOT LIE, and the one that now guards this: AT SUNRISE THE ASCENDANT IS THE
   * SUN. The Sun is on the eastern horizon at the moment it rises, so the two longitudes must
   * agree. No external reference, no published table — a fact about what the ascendant means.
   */
  const asc = norm360(
    Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(e) + Math.tan(lat) * Math.sin(e))) / RAD,
  );

  /*
   * THE MIDHEAVEN, which is worth having in its own right and is also what makes the ascendant
   * checkable without an external table. The MC needs no latitude — it is where the meridian cuts
   * the ecliptic — so an error in the ascendant cannot hide behind a matching error here.
   */
  const mc = norm360(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(e)) / RAD);

  /*
   * SECT, DECIDED BY WHERE THE SUN ACTUALLY WAS, not by the clock.
   *
   * "Day birth" means the Sun was above the horizon, and at 2:29 in July that is a different answer
   * from what a naive before-noon/after-noon rule would give. The two Fortune formulas are mirror
   * images, so getting sect wrong does not produce a small error — it reflects the point across the
   * ascendant, and the result still looks like a perfectly ordinary degree of a perfectly ordinary
   * sign.
   */
  const sect: "day" | "night" = solarAltitude(birth.born_at, birth.latitude!, birth.longitude!) > 0 ? "day" : "night";
  const fortune = norm360(sect === "day" ? asc + moon.longitude - sunLongitude : asc + sunLongitude - moon.longitude);

  return {
    placements,
    ascendant: { longitude: asc, sign: ZODIAC_SIGNS[Math.floor(asc / 30)]!, degrees_in_sign: asc % 30 },
    midheaven: { longitude: mc, sign: ZODIAC_SIGNS[Math.floor(mc / 30)]!, degrees_in_sign: mc % 30 },
    fortune: {
      longitude: fortune,
      sign: ZODIAC_SIGNS[Math.floor(fortune / 30)]!,
      degrees_in_sign: fortune % 30,
      sect,
    },
    houses_note:
      `Ascendant, Midheaven and Lot of Fortune computed from an exact birth time and the given ` +
      `coordinates. The Sun was ${sect === "day" ? "above" : "below"} the horizon, so the ${sect} formula applies.`,
    method: METHOD_PLANETS,
  };
}

// ─── Transits ────────────────────────────────────────────────────────────────

export interface Transit {
  key: string;
  name: string;
  longitude: number;
  sign: string;
  degrees_in_sign: number;
  retrograde: boolean;
  /** Degrees from this body's own natal position, 0–180. */
  from_natal: number;
  /** The classical aspect it makes to its natal place, when it makes one. */
  aspect: string | null;
}

/** The classical aspects and how close counts. Tight, because a wide orb makes everything an aspect. */
export const ASPECTS: { name: string; angle: number; orb: number }[] = [
  { name: "conjunction", angle: 0, orb: 3 },
  { name: "sextile", angle: 60, orb: 2 },
  { name: "square", angle: 90, orb: 3 },
  { name: "trine", angle: 120, orb: 3 },
  { name: "opposition", angle: 180, orb: 3 },
];

/**
 * Where everything is now, against where it was at birth.
 *
 * PROMISED AND THEREFORE BUILT. The natal endpoint told her transits "follow automatically once the
 * chart exists" — a sentence that would have been a lie if this had not been written, and the kind
 * of lie that is only discovered by the person who waited for it.
 *
 * Each body is compared to ITS OWN natal position, which is the return cycle a person actually
 * tracks. Cross-body aspects are a much larger surface and are not silently half-built here.
 */
export function transits(chart: NatalChart, at: number): Transit[] {
  const natalBy = new Map(chart.placements.map((p) => [p.key, p.longitude]));

  return chart.placements
    // The node and Lilith are derived angles rather than bodies; transiting them needs the same
    // polynomials, not a position lookup, so they are left out rather than approximated.
    .filter((p) => p.key !== "node" && p.key !== "lilith")
    .map((p) => {
      const now = p.key === "moon" ? moonPosition(at).longitude : planetPosition(p.key, at).longitude;
      const natal = natalBy.get(p.key)!;

      let gap = Math.abs(now - natal) % 360;
      if (gap > 180) gap = 360 - gap;
      const aspect = ASPECTS.find((a) => Math.abs(gap - a.angle) <= a.orb);

      return {
        key: p.key,
        name: p.name,
        longitude: now,
        sign: ZODIAC_SIGNS[Math.floor(now / 30)]!,
        degrees_in_sign: now % 30,
        retrograde: p.key === "sun" || p.key === "moon" ? false : planetPosition(p.key, at).retrograde,
        from_natal: gap,
        aspect: aspect ? aspect.name : null,
      };
    });
}
