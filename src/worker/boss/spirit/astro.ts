/**
 * Computed lunar astronomy — canon §42.1–42.3.
 *
 * Everything here is arithmetic. No network call, no ephemeris file, no
 * provider: the phase, the illumination and the lunar sign are computed from
 * the standard truncated series (Meeus, *Astronomical Algorithms*, ch. 47 and
 * 49), which is why the Spirit screens work on a plane with no signal.
 *
 * The accuracy is stated rather than implied. The phase times are good to a few
 * minutes; the lunar longitude carries the full Meeus 47.A series and is good to
 * about 0.01°. It used to carry six terms of that table and claim a third of a
 * degree, which it did not deliver — a natal Moon came out 1.6° wrong, and the
 * owner caught it on her own chart. Near a cusp this module still says so
 * instead of picking. Anything that would need
 * a real ephemeris — natal placements, transits to them — is not computed here
 * and is not invented: it is reported as deferred.
 *
 * Retrograde periods and shadow windows are neither computed nor deferred: they
 * are entered from a published almanac, which canon §42.3 makes the primary
 * implementation. `almanac_import.ts` is that path.
 */

const DAY_MS = 86_400_000;
const SYNODIC_MONTH_DAYS = 29.530_588_853;
const J2000_JD = 2_451_545.0;

import {
  METHOD_PLANETS, RETROGRADING, STATION_UNCERTAINTY_HOURS, retrogrades, ingresses,
} from "./planets";

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Whatever the almanac cannot compute honestly says this and stops. */
export const NO_EPHEMERIS = "DEFERRED — NO EPHEMERIS SOURCE";

/**
 * What the almanac is waiting for a person to paste in.
 *
 * This is deliberately not `NO_EPHEMERIS`. Build plan §1.5 D4 reserves that
 * status for the natal layer, and puts retrograde periods and shadow windows in
 * a different category entirely: a table "entered once from a public almanac and
 * refreshable the same way", which canon §42.3 permits as the primary
 * implementation. Nothing is missing here for want of an ephemeris — what is
 * missing is a five-minute paste, and saying so is the difference between a gap
 * that closes and one that never does.
 */
export const AWAITING_ALMANAC = "AWAITING ALMANAC IMPORT — MANUAL ENTRY (canon §42.3)";

/** The two almanac kinds a person enters rather than the arithmetic producing. */
export const MANUAL_ALMANAC_KINDS = ["retrograde", "shadow"] as const;
export type ManualAlmanacKind = (typeof MANUAL_ALMANAC_KINDS)[number];

export const ZODIAC = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;

export const PHASE_NAMES = [
  "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
  "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
] as const;

/** How close to a sign boundary counts as "this may be the next sign". */
export const CUSP_DEGREES = 1.5;

export function julianDay(ts: number): number {
  return ts / DAY_MS + 2_440_587.5;
}

export function fromJulianDay(jd: number): number {
  return Math.round((jd - 2_440_587.5) * DAY_MS);
}

function centuries(ts: number): number {
  return (julianDay(ts) - J2000_JD) / 36_525;
}

export interface MoonPosition {
  /** Apparent ecliptic longitude in degrees, 0–360. */
  longitude: number;
  sign: (typeof ZODIAC)[number];
  degrees_in_sign: number;
  /** True when the longitude is within `CUSP_DEGREES` of a boundary. */
  cusp: boolean;
  next_sign: (typeof ZODIAC)[number] | null;
}

/**
 * Lunar longitude from the truncated series: mean longitude plus the six
 * largest periodic terms. Good to about 0.3°.
 */
export function moonPosition(ts: number): MoonPosition {
  const T = centuries(ts);

  const Lp = 218.316_4477 + 481_267.881_234_21 * T - 0.001_5786 * T * T;
  const D = 297.850_1921 + 445_267.111_4034 * T - 0.001_8819 * T * T;
  const M = 357.529_1092 + 35_999.050_290_9 * T - 0.000_1536 * T * T;
  const Mp = 134.963_3964 + 477_198.867_505_5 * T + 0.008_7414 * T * T;
  const F = 93.272_095 + 483_202.017_5233 * T - 0.003_6539 * T * T;

  /*
   * THE FULL MEEUS 47.A LONGITUDE SERIES, NOT SIX TERMS OF IT.
   *
   * This used to carry the six largest periodic terms and claim a third of a degree. It was not
   * worth a third of a degree: the omitted terms reach 0.059° individually and well over a degree
   * in combination, and a natal Moon computed from it landed 1.6° — nearly three hours of lunar
   * motion — from the value a real ephemeris gives. The owner noticed, on her own chart.
   *
   * THE MOON IS THE FASTEST THING ON THIS SCREEN, which is why it is the one that could not afford
   * the shortcut: 13° a day means an error tolerable for Saturn puts the Moon in the wrong sign for
   * half a day either side of a cusp. With the full table this is good to about 0.01°.
   *
   * Columns are the multipliers of D, M, M′ and F, then the coefficient in millionths of a degree.
   */
  const TERMS: [number, number, number, number, number][] = [
    [0,0,1,0,6288774],[2,0,-1,0,1274027],[2,0,0,0,658314],[0,0,2,0,213618],
    [0,1,0,0,-185116],[0,0,0,2,-114332],[2,0,-2,0,58793],[2,-1,-1,0,57066],
    [2,0,1,0,53322],[2,-1,0,0,45758],[0,1,-1,0,-40923],[1,0,0,0,-34720],
    [0,1,1,0,-30383],[2,0,0,-2,15327],[0,0,1,2,-12528],[0,0,1,-2,10980],
    [4,0,-1,0,10675],[0,0,3,0,10034],[4,0,-2,0,8548],[2,1,-1,0,-7888],
    [2,1,0,0,-6766],[1,0,-1,0,-5163],[1,1,0,0,4987],[2,-1,1,0,4036],
    [2,0,2,0,3994],[4,0,0,0,3861],[2,0,-3,0,3665],[0,1,-2,0,-2689],
    [2,0,-1,2,-2602],[2,-1,-2,0,2390],[1,0,1,0,-2348],[2,-2,0,0,2236],
    [0,1,2,0,-2120],[0,2,0,0,-2069],[2,-2,-1,0,2048],[2,0,1,-2,-1773],
    [2,0,0,2,-1595],[4,-1,-1,0,1215],[0,0,2,2,-1110],[3,0,-1,0,-892],
    [2,1,1,0,-810],[4,-1,-2,0,759],[0,2,-1,0,-713],[2,2,-1,0,-700],
    [2,1,-2,0,691],[2,-1,0,-2,596],[4,0,1,0,549],[0,0,4,0,537],
    [4,-1,0,0,520],[1,0,-2,0,-487],[2,1,0,-2,-399],[0,0,2,-2,-381],
    [1,1,1,0,351],[3,0,-2,0,-340],[4,0,-3,0,330],[2,-1,2,0,327],
    [0,2,1,0,-323],[1,1,-1,0,299],[2,0,3,0,294],
  ];

  /*
   * THE ECCENTRICITY FACTOR. The Earth's orbit is not fixed, and terms involving the SUN's mean
   * anomaly have to be scaled by it — squared where M appears twice. Dropping E is a classic
   * silent error: it changes nothing structurally and quietly biases every solar-coupled term.
   */
  const E = 1 - 0.002_516 * T - 0.000_0074 * T * T;

  let sigmaL = 0;
  for (const [cD, cM, cMp, cF, coeff] of TERMS) {
    const arg = cD * D + cM * M + cMp * Mp + cF * F;
    const scale = cM === 0 ? 1 : Math.abs(cM) === 1 ? E : E * E;
    sigmaL += coeff * scale * sin(arg);
  }

  // Meeus's additive terms: Venus (A1), Jupiter (A2), and the flattening of the Earth.
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479_264.290 * T;
  sigmaL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);

  /*
   * NUTATION, so this is the APPARENT longitude the zodiac actually uses. Only about 17 arcseconds,
   * which did not matter when the series itself was a degree out and does now.
   */
  const omega = 125.04452 - 1934.136261 * T;
  const nutation = (-17.20 * sin(omega) - 1.32 * sin(2 * (280.4665 + 36_000.7698 * T))) / 3600;

  const longitude = norm360(Lp + sigmaL / 1_000_000 + nutation);

  const index = Math.floor(longitude / 30) % 12;
  const degreesInSign = longitude - index * 30;
  const cusp = degreesInSign < CUSP_DEGREES || degreesInSign > 30 - CUSP_DEGREES;

  return {
    longitude,
    // index is Math.floor(longitude / 30) on a value already normalised to [0, 360), so it is
    // always 0..11. The chassis compiles with noUncheckedIndexedAccess, which the artifact did not.
    sign: ZODIAC[index]!,
    degrees_in_sign: degreesInSign,
    cusp,
    next_sign: cusp ? ZODIAC[(index + (degreesInSign > 15 ? 1 : 11)) % 12]! : null,
  };
}

export interface MoonPhase {
  phase: (typeof PHASE_NAMES)[number];
  /** Days since the new moon that began this lunation. */
  age_days: number;
  /** 0 at new, 1 at full. */
  illumination: number;
  waxing: boolean;
  lunation_percent: number;
}

/** Phase, age and illuminated fraction, from the same series. */
export function moonPhase(ts: number): MoonPhase {
  const T = centuries(ts);
  const D = 297.850_1921 + 445_267.111_4034 * T - 0.001_8819 * T * T;
  const M = 357.529_1092 + 35_999.050_290_9 * T - 0.000_1536 * T * T;
  const Mp = 134.963_3964 + 477_198.867_505_5 * T + 0.008_7414 * T * T;

  // Phase angle of the Moon: 0° at full, 180° at new.
  const i = norm360(
    180 -
      norm360(D) -
      6.289 * sin(Mp) +
      2.1 * sin(M) -
      1.274 * sin(2 * D - Mp) -
      0.658 * sin(2 * D) -
      0.214 * sin(2 * Mp) -
      0.11 * sin(D),
  );
  const illumination = (1 + cos(i)) / 2;

  const elongation = norm360(D);
  const ageDays = (elongation / 360) * SYNODIC_MONTH_DAYS;
  const octant = Math.floor((elongation + 22.5) / 45) % 8;

  return {
    // octant is `% 8` over eight names.
    phase: PHASE_NAMES[octant]!,
    age_days: ageDays,
    illumination,
    waxing: elongation < 180,
    lunation_percent: elongation / 360,
  };
}

/**
 * Mean phase time for lunation `k`, corrected by the largest periodic terms
 * (Meeus ch. 49). `k` is integral for a new moon and `k + 0.5` for a full moon.
 */
function phaseTime(k: number, kind: "new" | "full"): number {
  const T = k / 1_236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  let jde =
    2_451_550.097_66 +
    29.530_588_861 * k +
    0.000_154_37 * T2 -
    0.000_000_150 * T3 +
    0.000_000_000_73 * T4;

  const E = 1 - 0.002_516 * T - 0.000_0074 * T2;
  const M = norm360(2.5534 + 29.105_356_70 * k - 0.000_0014 * T2 - 0.000_000_11 * T3);
  const Mp = norm360(201.5643 + 385.816_935_28 * k + 0.010_758_2 * T2 + 0.000_012_38 * T3);
  const F = norm360(160.7108 + 390.670_502_84 * k - 0.001_611_8 * T2 - 0.000_002_27 * T3);
  const omega = norm360(124.7746 - 1.563_755_88 * k + 0.002_067_2 * T2 + 0.000_002_15 * T3);

  if (kind === "new") {
    jde +=
      -0.40720 * sin(Mp) +
      0.17241 * E * sin(M) +
      0.01608 * sin(2 * Mp) +
      0.01039 * sin(2 * F) +
      0.00739 * E * sin(Mp - M) -
      0.00514 * E * sin(Mp + M) +
      0.00208 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(omega);
  } else {
    jde +=
      -0.40614 * sin(Mp) +
      0.17302 * E * sin(M) +
      0.01614 * sin(2 * Mp) +
      0.01043 * sin(2 * F) +
      0.00734 * E * sin(Mp - M) -
      0.00515 * E * sin(Mp + M) +
      0.00209 * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(omega);
  }

  return fromJulianDay(jde);
}

/** The lunation number whose new moon is nearest `ts`. */
function lunationNumber(ts: number): number {
  const yearsSince2000 = (julianDay(ts) - J2000_JD) / 365.25;
  return Math.round(yearsSince2000 * 12.3685);
}

/**
 * THE LUNATION SHE IS CURRENTLY INSIDE — not the one that is about to arrive.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "spirit page is now passed the new moon in virgo but u should so the last major lunation so
 *    evn tho its sept 13 i should still be able to see the new moon in virgo section for 2 weeks
 *    until the next major lunation"
 *
 * `major_event` looks forward 48 hours and 6 hours back. Measured on production 13 Sep 2026 it was
 * NULL and the page read "No major event in the next two days" — while she was ten days into the
 * Virgo new moon, in the cycle it opened. The page forgot the event the instant it passed.
 *
 * THAT IS THE WRONG MODEL, AND IT IS NOT A HORIZON THAT NEEDS WIDENING. A new moon is not a
 * notification that expires; it OPENS A CYCLE, and the cycle runs until the next major lunation
 * closes it. She is still inside the Virgo new moon on the 13th in exactly the way she is still
 * inside September. So the boundary is computed — the next new or full moon — and never a fixed
 * fourteen days, which would drift against a 29.53-day synodic month and be wrong by a day every
 * couple of cycles.
 *
 * ─── Computed here rather than read from `astro_calendar` ──────────────────
 *
 * The almanac table is seeded from this same series and is the right source for a calendar. It is
 * the wrong source for THIS, because a lapse in its coverage would empty the section — and an empty
 * "what cycle am I in" is indistinguishable from the bug being fixed. This is arithmetic over a
 * truncated Meeus series; it cannot be empty, and it cannot go stale.
 *
 * NEW MOONS AND FULL MOONS BOTH COUNT. She said "the next major lunation", and a full moon is one:
 * the cycle she is in after a full moon is the waning half, which is a different thing to be inside
 * from the waxing half. Quarters do not count — they would halve the window to a week and put
 * something new at the top of the page most of the time, which is the same as putting nothing.
 */
export interface LunationMoment {
  kind: "new_moon" | "full_moon";
  label: string;
  at: number;
  sign: (typeof ZODIAC)[number];
  degrees_in_sign: number;
}

export interface CurrentLunation {
  /** The lunation she is inside: the most recent new or full moon at or before `ts`. */
  current: LunationMoment;
  /** The one that closes it. The window is [current.at, next.at). */
  next: LunationMoment;
  days_since: number;
  days_until: number;
  /** How far through this cycle, 0–1. Computed against the real interval, never a fixed 14 days. */
  fraction: number;
  method: string;
}

function lunationMoment(at: number, kind: "new_moon" | "full_moon"): LunationMoment {
  const position = moonPosition(at);
  return {
    kind,
    label: `${kind === "new_moon" ? "New Moon" : "Full Moon"} in ${position.sign}`,
    at: Math.round(at),
    sign: position.sign,
    degrees_in_sign: position.degrees_in_sign,
  };
}

export function currentLunation(ts: number): CurrentLunation {
  /*
   * FIVE LUNATIONS EITHER SIDE IS DELIBERATE OVERKILL. Two would do — the answer is always within
   * one — and the cost is forty evaluations of a truncated series, which is nothing. The reason to
   * be generous is that `lunationNumber` ROUNDS, so near a boundary the nearest k can be the one
   * after the moment being asked about, and a tight window would then have no candidate at or
   * before `ts`. A search that can come up empty is exactly the failure being fixed.
   */
  const k0 = lunationNumber(ts);
  const moments: LunationMoment[] = [];
  for (let k = k0 - 5; k <= k0 + 5; k += 1) {
    moments.push(lunationMoment(phaseTime(k, "new"), "new_moon"));
    moments.push(lunationMoment(phaseTime(k + 0.5, "full"), "full_moon"));
  }
  moments.sort((a, b) => a.at - b.at);

  let current = moments[0]!;
  for (const m of moments) {
    if (m.at <= ts) current = m;
    else break;
  }
  const next = moments.find((m) => m.at > ts) ?? current;

  const span = Math.max(1, next.at - current.at);
  return {
    current,
    next,
    days_since: Math.floor((ts - current.at) / DAY_MS),
    days_until: Math.ceil((next.at - ts) / DAY_MS),
    fraction: Math.min(1, Math.max(0, (ts - current.at) / span)),
    method: METHOD,
  };
}

export interface AlmanacEvent {
  /*
   * `retrograde`, `shadow` and `ingress` joined this union when the planetary layer was computed.
   * The first two were already legal values of `astro_calendar.kind` — the schema had been waiting
   * for them since 0160, and only the import path could produce them.
   */
  kind: "new_moon" | "full_moon" | "window" | "retrograde" | "shadow" | "ingress";
  label: string;
  starts_at: number;
  ends_at: number | null;
  detail: Record<string, unknown>;
  source: "computed";
  method: string;
}

const METHOD = "Meeus truncated series, computed in TypeScript. No network call and no ephemeris file.";

/**
 * Canon §42.2's window types, as the build plan names them: push, rest,
 * visibility, networking, reflection.
 *
 * The names are authority; the boundaries are not. No document available to this
 * build fixes where each window starts and stops, so each one is derived here
 * from the computed lunation as a fraction of the interval between one new moon
 * and the next, and every row says so in its own `detail`. That distinction is
 * the point: the vocabulary is canon's, the arithmetic is this build's, and a
 * reader can tell which is which without leaving the row.
 *
 * The five fractions partition the lunation exactly once, so every day of every
 * month falls inside exactly one of them and none of them overlap.
 */
export const CANON_WINDOW_TYPES = [
  {
    key: "push",
    label: "Push",
    from: 0,
    to: 0.25,
    derivation: "new moon to first quarter",
    meaning: "The waxing quarter: start things.",
  },
  {
    key: "visibility",
    label: "Visibility",
    from: 0.25,
    to: 0.5,
    derivation: "first quarter to full moon",
    meaning: "Building to full: show the work.",
  },
  {
    key: "networking",
    label: "Networking",
    from: 0.5,
    to: 0.65,
    derivation: "full moon and the days after it",
    meaning: "The brightest stretch: be among people.",
  },
  {
    key: "reflection",
    label: "Reflection",
    from: 0.65,
    to: 0.9,
    derivation: "waning gibbous through last quarter",
    meaning: "The waning stretch: review what happened.",
  },
  {
    key: "rest",
    label: "Rest",
    from: 0.9,
    to: 1,
    derivation: "the dark days before the next new moon",
    meaning: "The end of the cycle: stop.",
  },
] as const;

export type CanonWindowKey = (typeof CANON_WINDOW_TYPES)[number]["key"];

const WINDOW_DERIVATION_NOTE =
  "Canon §42.2 fixes this window's name. Its boundary is derived in this build " +
  "as a fraction of the computed lunation, because no authority document " +
  "available to this build fixes where the window starts and stops.";

/**
 * Twenty-four months of new and full moons, the two ritual anchor windows, canon §42.2's five window
 * types derived from the same computed lunation — and, since the planetary layer was built, every
 * retrograde, shadow window and sign ingress in the same span.
 *
 * THE LAST SENTENCE OF THIS COMMENT USED TO SAY THE OPPOSITE: "retrograde periods and shadow windows
 * are imported, not computed." They were never a sourcing problem — a retrograde is just apparent
 * geocentric longitude moving backwards, which is arithmetic of exactly the kind the lunar series
 * above already does. `almanac_import.ts` still works and is still the way a correction gets in by
 * hand; it is no longer the only way the rows exist.
 */
export function buildAlmanac(fromTs: number, months = 24): AlmanacEvent[] {
  const events: AlmanacEvent[] = [];
  const start = fromTs;
  const end = fromTs + months * 30.44 * DAY_MS;

  const firstK = lunationNumber(fromTs) - 1;
  const lastK = lunationNumber(end) + 1;

  for (let k = firstK; k <= lastK; k++) {
    const newMoon = phaseTime(k, "new");
    const fullMoon = phaseTime(k + 0.5, "full");
    const nextNewMoon = phaseTime(k + 1, "new");
    const lunation = nextNewMoon - newMoon;

    // Canon §42.2's five windows, laid across this lunation.
    if (newMoon >= start && newMoon <= end) {
      for (const window of CANON_WINDOW_TYPES) {
        events.push({
          kind: "window",
          label: `${window.label} window (derived: ${window.derivation})`,
          starts_at: Math.round(newMoon + window.from * lunation),
          ends_at: Math.round(newMoon + window.to * lunation),
          detail: {
            window_type: window.key,
            canon: "§42.2",
            meaning: window.meaning,
            derived_from: "computed lunation",
            lunation_fraction: [window.from, window.to],
            lunation: k,
            note: WINDOW_DERIVATION_NOTE,
          },
          source: "computed",
          method: METHOD,
        });
      }
    }

    if (newMoon >= start && newMoon <= end) {
      const position = moonPosition(newMoon);
      events.push({
        kind: "new_moon",
        label: `New Moon in ${position.sign}`,
        starts_at: newMoon,
        ends_at: null,
        detail: { lunation: k, sign: position.sign, degrees_in_sign: position.degrees_in_sign, cusp: position.cusp },
        source: "computed",
        method: METHOD,
      });
      events.push({
        kind: "window",
        label: "Intention window (derived: new moon ±2 days)",
        starts_at: newMoon - 2 * DAY_MS,
        ends_at: newMoon + 2 * DAY_MS,
        detail: {
          window_type: "new_moon_anchor",
          derived_from: "computed new moon",
          canon_note: "The anchor a lunar ritual is tied to, not one of canon §42.2's five window types.",
        },
        source: "computed",
        method: METHOD,
      });
    }

    if (fullMoon >= start && fullMoon <= end) {
      const position = moonPosition(fullMoon);
      events.push({
        kind: "full_moon",
        label: `Full Moon in ${position.sign}`,
        starts_at: fullMoon,
        ends_at: null,
        detail: { lunation: k, sign: position.sign, degrees_in_sign: position.degrees_in_sign, cusp: position.cusp },
        source: "computed",
        method: METHOD,
      });
      events.push({
        kind: "window",
        label: "Release window (derived: full moon to +3 days)",
        starts_at: fullMoon,
        ends_at: fullMoon + 3 * DAY_MS,
        detail: {
          window_type: "full_moon_anchor",
          derived_from: "computed full moon",
          canon_note: "The anchor a lunar ritual is tied to, not one of canon §42.2's five window types.",
        },
        source: "computed",
        method: METHOD,
      });
    }
  }

  /*
   * THE PLANETARY LAYER. Computed here rather than pasted, and marked `computed` so a reader can
   * tell at a glance which rows arrived by arithmetic and which by hand — `almanac_import.ts`
   * writes `imported`, and a correction entered by a person should not be indistinguishable from a
   * number this file produced.
   */
  for (const key of RETROGRADING) {
    for (const r of retrogrades(key, start, end)) {
      events.push({
        kind: "retrograde",
        label: `${r.name} retrograde in ${r.from_sign}${r.to_sign === r.from_sign ? "" : ` → ${r.to_sign}`}`,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        detail: {
          planet: r.key,
          from_longitude: Number(r.from_longitude.toFixed(3)),
          to_longitude: Number(r.to_longitude.toFixed(3)),
          from_sign: r.from_sign,
          to_sign: r.to_sign,
          // Carried on the row, because a station is the least certain instant this method produces
          // and a screen quoting it to the minute would be claiming a precision that is not here.
          station_uncertainty_hours: STATION_UNCERTAINTY_HOURS,
        },
        source: "computed",
        method: METHOD_PLANETS,
      });

      // A shadow window is only written when both ends were actually found. A half-open shadow
      // would render as a period with an invented boundary.
      if (r.pre_shadow_starts_at !== null) {
        events.push({
          kind: "shadow",
          label: `${r.name} pre-retrograde shadow`,
          starts_at: r.pre_shadow_starts_at,
          ends_at: r.starts_at,
          detail: { planet: r.key, phase: "pre", retrograde_starts_at: r.starts_at, degree: Number(r.to_longitude.toFixed(3)) },
          source: "computed",
          method: METHOD_PLANETS,
        });
      }
      if (r.post_shadow_ends_at !== null) {
        events.push({
          kind: "shadow",
          label: `${r.name} post-retrograde shadow`,
          starts_at: r.ends_at,
          ends_at: r.post_shadow_ends_at,
          detail: { planet: r.key, phase: "post", retrograde_ends_at: r.ends_at, degree: Number(r.from_longitude.toFixed(3)) },
          source: "computed",
          method: METHOD_PLANETS,
        });
      }
    }

    for (const i of ingresses(key, start, end)) {
      events.push({
        kind: "ingress",
        label: `${i.name} enters ${i.sign}${i.retrograde ? " (retrograde)" : ""}`,
        starts_at: i.at,
        ends_at: null,
        detail: { planet: i.key, sign: i.sign, from_sign: i.from_sign, retrograde: i.retrograde },
        source: "computed",
        method: METHOD_PLANETS,
      });
    }
  }

  return events.sort((a, b) => a.starts_at - b.starts_at);
}

/**
 * NOTHING IS DEFERRED FOR WANT OF AN EPHEMERIS ANY MORE.
 *
 * This list held three items and all three were mis-filed. Planetary sign ingresses are computed by
 * `planets.ts` and appear in the almanac. Natal placements and transits to them were never blocked
 * on a source either: the same arithmetic produces a natal chart, and what it needs is a birth date,
 * an exact birth time and a birth place — three facts only the owner has.
 *
 * So this is a NAMED STOP with a question, not a permanent absence. The distinction is the whole
 * point: "no ephemeris source" reads as something nobody can fix, and a reader would never have
 * thought to ask. `NO_EPHEMERIS` is kept as an exported constant because the import path and its
 * tests still reference the vocabulary, and because a status that vanishes leaves no trace of what
 * it used to say.
 */
export const DEFERRED_ASTRONOMY: readonly { key: string; label: string; status: string }[] = [];

/** The one input the arithmetic cannot supply, and the exact question that unblocks it. */
export const AWAITING_OWNER = "AWAITING BIRTH DATA — THE ONLY INPUT NOT COMPUTABLE HERE";

export const OWNER_INPUTS = [
  {
    key: "natal_chart",
    label: "Natal chart and placements",
    status: AWAITING_OWNER,
    needs: "Birth date, birth time as exactly as you know it, and birth city.",
    /*
     * WHY THE TIME MATTERS AND THE OTHER TWO DO NOT, MUCH. The planets move slowly enough that a day
     * either way barely shifts them; the ascendant and the house cusps move a degree every four
     * minutes. An approximate time gives real planetary placements and unreliable houses, and that
     * is worth saying up front rather than discovering later.
     */
    why: "Planets need only the date. The ascendant and houses move a degree every four minutes, so an approximate time gives real placements and unreliable houses — which this will say rather than hide.",
    how: "POST /api/spirit/astro/natal with { born_at, birth_place, time_accuracy }.",
  },
  {
    key: "natal_transits",
    label: "Transits to natal placements",
    status: AWAITING_OWNER,
    needs: "Nothing further — this follows automatically once the natal chart exists.",
    why: "A transit is a computed planet against a natal degree. Both halves are arithmetic; only one of them is missing.",
    how: "Nothing to send. It appears when the chart above does.",
  },
] as const;

/**
 * WHAT MAY STILL BE ENTERED BY HAND, WHICH IS NO LONGER THE SAME AS WHAT IS MISSING.
 *
 * Canon §42.3 permits a manually entered calendar and this build now computes both kinds anyway. The
 * import path is kept — a published almanac disagreeing with the arithmetic is worth being able to
 * record, and an imported row overrides nothing silently because `source` distinguishes them — but
 * these are no longer gaps, and `almanacCoverage` reports them as covered by computation rather than
 * as awaiting a paste.
 */
export const MANUAL_ALMANAC = [
  {
    key: "retrogrades",
    kind: "retrograde" as ManualAlmanacKind,
    label: "Planetary retrograde periods",
    status: AWAITING_ALMANAC,
    how: "POST /api/spirit/astro/almanac/import with one row per retrograde: kind, label, starts_at, ends_at.",
  },
  {
    key: "shadow_periods",
    kind: "shadow" as ManualAlmanacKind,
    label: "Pre- and post-retrograde shadow windows",
    status: AWAITING_ALMANAC,
    how: "The same import, kind 'shadow', each row naming the retrograde it belongs to and whether it is the pre or post shadow.",
  },
] as const;

/**
 * The standing note on what any of this is for. Canon §5.2 puts reality first,
 * and canon §1.5 forbids the system treating a sky position as a cause.
 */
export const ADVISORY_NOTE =
  "Advisory only. The sky is context, never a cause and never a permission. " +
  "Nothing here blocks an action, schedules work, or explains an outcome.";
