/**
 * Computed lunar astronomy — canon §42.1–42.3.
 *
 * Everything here is arithmetic. No network call, no ephemeris file, no
 * provider: the phase, the illumination and the lunar sign are computed from
 * the standard truncated series (Meeus, *Astronomical Algorithms*, ch. 47 and
 * 49), which is why the Spirit screens work on a plane with no signal.
 *
 * The accuracy is stated rather than implied. The phase times are good to a few
 * minutes; the lunar longitude is good to roughly a third of a degree, which is
 * ample for a thirty-degree sign except within a degree or so of a cusp — and
 * near a cusp this module says so instead of picking. Anything that would need
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

  const longitude = norm360(
    Lp +
      6.289 * sin(Mp) -
      1.274 * sin(2 * D - Mp) +
      0.658 * sin(2 * D) +
      0.214 * sin(2 * Mp) -
      0.186 * sin(M) -
      0.114 * sin(2 * F),
  );

  const index = Math.floor(longitude / 30) % 12;
  const degreesInSign = longitude - index * 30;
  const cusp = degreesInSign < CUSP_DEGREES || degreesInSign > 30 - CUSP_DEGREES;

  return {
    longitude,
    sign: ZODIAC[index],
    degrees_in_sign: degreesInSign,
    cusp,
    next_sign: cusp ? ZODIAC[(index + (degreesInSign > 15 ? 1 : 11)) % 12] : null,
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
    phase: PHASE_NAMES[octant],
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

export interface AlmanacEvent {
  kind: "new_moon" | "full_moon" | "window";
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
 * Twenty-four months of new and full moons, the two ritual anchor windows, and
 * canon §42.2's five window types derived from the same computed lunation.
 *
 * What is not here is what a person pastes in: retrograde periods and shadow
 * windows are imported, not computed. See `almanac_import.ts`.
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

  return events.sort((a, b) => a.starts_at - b.starts_at);
}

/**
 * The natal layer, and only the natal layer.
 *
 * Build plan §1.5 D4 defers exactly this much: transit-to-natal interpretation
 * needs a real ephemeris, has no acceptable vendor, and is not estimated into
 * existence. Retrograde periods and shadow windows are deliberately *not* here —
 * they are entered from a public almanac, which is a different kind of gap with
 * a different fix. Filing them under "no ephemeris" made them look permanent
 * when they are a paste away.
 */
export const DEFERRED_ASTRONOMY = [
  { key: "natal_chart", label: "Natal chart and placements", status: NO_EPHEMERIS },
  { key: "natal_transits", label: "Transits to natal placements", status: NO_EPHEMERIS },
  { key: "planetary_ingresses", label: "Planetary sign ingresses", status: NO_EPHEMERIS },
] as const;

/**
 * What the almanac holds only once a person has entered it. Canon §42.3 makes
 * the manual calendar the primary implementation, so this is the designed path
 * rather than a fallback, and each entry names what to paste.
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
