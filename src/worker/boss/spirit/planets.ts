/**
 * Computed PLANETARY astronomy — the layer that was deferred, and did not need to be.
 *
 * WHAT WAS ON THE SCREEN BEFORE THIS. Five items in two categories: retrograde periods and shadow
 * windows "AWAITING ALMANAC IMPORT — MANUAL ENTRY", and natal placements, transits and planetary
 * ingresses "DEFERRED — NO EPHEMERIS SOURCE". The first pair had been waiting for a paste that never
 * came and would have had to come again every year; the second was filed as permanent.
 *
 * Three of the five were never a sourcing problem. Retrogrades, shadow windows and sign ingresses
 * are all the same computation — where a planet's apparent geocentric longitude is, and which way it
 * is moving — and that is arithmetic, exactly like the lunar series in `astro.ts`. No network call,
 * no ephemeris file, no vendor, no annual paste.
 *
 * THE METHOD, AND ITS HONEST LIMITS. Standish's Keplerian elements and their rates (JPL, "Approximate
 * Positions of the Major Planets"), solved through Kepler's equation. It is a low-precision method
 * and it says so: roughly an arcminute for the inner planets, a few for the outer ones, over
 * 1800–2050. That is far inside a thirty-degree sign, and good enough for a station to within a few
 * hours — which matters, because a planet at station is barely moving and its exact instant is the
 * least well-determined thing here. `STATION_UNCERTAINTY_HOURS` is carried into the record rather
 * than left in a comment.
 *
 * WHAT IS STILL NOT COMPUTED, AND WHY IT IS NOT A DEFERRAL. A natal chart needs a birth date, an
 * exact birth time and a birth place. That is not an ephemeris problem — this file could produce the
 * chart the moment those three facts exist. It is the one input only the owner holds, so it is a
 * named stop with a question, not a permanent "no source".
 */

const DAY_MS = 86_400_000;
const J2000_JD = 2_451_545.0;
const RAD = Math.PI / 180;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

export const METHOD_PLANETS =
  "Standish Keplerian elements with secular rates (JPL, Approximate Positions of the Major Planets), " +
  "solved through Kepler's equation. Valid 1800–2050. No network call.";

/**
 * How uncertain a station instant is, stated rather than implied.
 *
 * At a station the apparent longitude is stationary by definition, so a small error in longitude
 * becomes a large error in TIME. Quoting a station to the minute would be a precision this method
 * does not have, and the screen says the window rather than pretending to an instant.
 */
export const STATION_UNCERTAINTY_HOURS = 6;

export interface Elements {
  /** semi-major axis, au */ a: number;
  /** eccentricity */ e: number;
  /** inclination, deg */ I: number;
  /** mean longitude, deg */ L: number;
  /** longitude of perihelion, deg */ peri: number;
  /** longitude of ascending node, deg */ node: number;
}

interface PlanetDef {
  key: string;
  name: string;
  at: Elements;
  /** per Julian century */
  rate: Elements;
}

/**
 * EARTH IS IN THIS TABLE AND IS NOT A PLANET ON THE SCREEN. Its position is what makes every other
 * one geocentric, so it is computed and then never listed — `RETROGRADING` is the set a person sees.
 */
export const PLANETS: PlanetDef[] = [
  {
    key: "mercury", name: "Mercury",
    at: { a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.25032350, peri: 77.45779628, node: 48.33076593 },
    rate: { a: 0.00000037, e: 0.00001906, I: -0.00594749, L: 149472.67411175, peri: 0.16047689, node: -0.12534081 },
  },
  {
    key: "venus", name: "Venus",
    at: { a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.97909950, peri: 131.60246718, node: 76.67984255 },
    rate: { a: 0.00000390, e: -0.00004107, I: -0.00078890, L: 58517.81538729, peri: 0.00268329, node: -0.27769418 },
  },
  {
    key: "earth", name: "Earth",
    at: { a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, peri: 102.93768193, node: 0 },
    rate: { a: 0.00000562, e: -0.00004392, I: -0.01294668, L: 35999.37244981, peri: 0.32327364, node: 0 },
  },
  {
    key: "mars", name: "Mars",
    at: { a: 1.52371034, e: 0.09339410, I: 1.84969142, L: -4.55343205, peri: -23.94362959, node: 49.55953891 },
    rate: { a: 0.00001847, e: 0.00007882, I: -0.00813131, L: 19140.30268499, peri: 0.44441088, node: -0.29257343 },
  },
  {
    key: "jupiter", name: "Jupiter",
    at: { a: 5.20288700, e: 0.04838624, I: 1.30439695, L: 34.39644051, peri: 14.72847983, node: 100.47390909 },
    rate: { a: -0.00011607, e: -0.00013253, I: -0.00183714, L: 3034.74612775, peri: 0.21252668, node: 0.20469106 },
  },
  {
    key: "saturn", name: "Saturn",
    at: { a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, peri: 92.59887831, node: 113.66242448 },
    rate: { a: -0.00125060, e: -0.00050991, I: 0.00193609, L: 1222.49362201, peri: -0.41897216, node: -0.28867794 },
  },
  {
    key: "uranus", name: "Uranus",
    at: { a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, peri: 170.95427630, node: 74.01692503 },
    rate: { a: -0.00196176, e: -0.00004397, I: -0.00242939, L: 428.48202785, peri: 0.40805281, node: 0.04240589 },
  },
  {
    key: "neptune", name: "Neptune",
    at: { a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, peri: 44.96476227, node: 131.78422574 },
    rate: { a: 0.00026291, e: 0.00005105, I: 0.00035372, L: 218.45945325, peri: -0.32241464, node: -0.00508664 },
  },
];

export const PLANET_BY_KEY = new Map(PLANETS.map((p) => [p.key, p]));

/**
 * The planets a retrograde is reported for.
 *
 * Uranus and Neptune retrograde for about five months of every year, which is not news and would
 * bury the ones that mean something. Earth is excluded because it is the observer.
 */
export const RETROGRADING = ["mercury", "venus", "mars", "jupiter", "saturn"] as const;

function centuries(ts: number): number {
  return (ts / DAY_MS + 2_440_587.5 - J2000_JD) / 36_525;
}

/** Heliocentric ecliptic rectangular coordinates, J2000 frame, in au. */
function heliocentric(def: PlanetDef, ts: number): { x: number; y: number; z: number } {
  const T = centuries(ts);
  const a = def.at.a + def.rate.a * T;
  const e = def.at.e + def.rate.e * T;
  const I = (def.at.I + def.rate.I * T) * RAD;
  const L = def.at.L + def.rate.L * T;
  const peri = def.at.peri + def.rate.peri * T;
  const node = (def.at.node + def.rate.node * T) * RAD;

  const argPeri = (peri - (def.at.node + def.rate.node * T)) * RAD;
  // Mean anomaly, wrapped to ±180° so the Kepler iteration starts near the root.
  let M = norm360(L - peri);
  if (M > 180) M -= 360;
  M *= RAD;

  /*
   * KEPLER'S EQUATION, NEWTON-RAPHSON. Converges in a handful of steps for every eccentricity in
   * this table (Mercury's 0.2056 is the worst). The iteration cap is a guard, not a tuning knob:
   * exceeding it would mean the elements are wrong, and silently returning a half-converged anomaly
   * would put a planet somewhere it is not.
   */
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 64; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }

  // Position in the orbital plane.
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosArg = Math.cos(argPeri), sinArg = Math.sin(argPeri);
  const xp = xv * cosArg - yv * sinArg;
  const yp = xv * sinArg + yv * cosArg;

  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosN = Math.cos(node), sinN = Math.sin(node);

  return {
    x: xp * cosN - yp * cosI * sinN,
    y: xp * sinN + yp * cosI * cosN,
    z: yp * sinI,
  };
}

export interface PlanetPosition {
  key: string;
  name: string;
  /** Apparent geocentric ecliptic longitude, degrees 0–360. */
  longitude: number;
  /** Geocentric ecliptic latitude, degrees. */
  latitude: number;
  /** Distance from Earth, au. */
  distance: number;
  /** Degrees per day, signed. Negative is retrograde. */
  daily_motion: number;
  retrograde: boolean;
}

/**
 * PRECESSION FROM J2000 TO THE EQUINOX OF DATE, which is not a refinement — it is the difference
 * between right and wrong here.
 *
 * Standish's elements are referred to the mean ecliptic and equinox of J2000. The tropical zodiac is
 * referred to the equinox OF DATE: 0° Aries is wherever the vernal point is today, and that point
 * moves about 50.3 arcseconds a year. Left uncorrected, every longitude in this file was 0.36° short
 * in 2026 and every computed equinox landed 8 hours 39 minutes late — a constant error, in the same
 * direction, at all four seasons.
 *
 * CAUGHT BY CHECKING AGAINST PUBLISHED EQUINOXES rather than by reading the code. A 0.36° error is
 * invisible in a thirty-degree sign and would have shipped as plausible; it is the sign of the
 * constant offset across four independent dates that named the cause.
 *
 * IAU 2006 general precession in ecliptic longitude, arcseconds, T in Julian centuries from J2000.
 */
function precessionFromJ2000(ts: number): number {
  const T = centuries(ts);
  return (5028.796195 * T + 1.1054348 * T * T) / 3600;
}

/** Geocentric ecliptic longitude of one body, referred to the equinox of date. */
export function geocentricLongitude(key: string, ts: number): number {
  const p0 = precessionFromJ2000(ts);
  if (key === "sun") {
    const e = heliocentric(PLANET_BY_KEY.get("earth")!, ts);
    return norm360(Math.atan2(-e.y, -e.x) / RAD + p0);
  }
  const def = PLANET_BY_KEY.get(key);
  if (!def) throw new Error(`No orbital elements for "${key}"`);
  const p = heliocentric(def, ts);
  const e = heliocentric(PLANET_BY_KEY.get("earth")!, ts);
  return norm360(Math.atan2(p.y - e.y, p.x - e.x) / RAD + p0);
}

/** The full geocentric position, including which way it is moving. */
export function planetPosition(key: string, ts: number): PlanetPosition {
  const def = PLANET_BY_KEY.get(key);
  const name = key === "sun" ? "Sun" : def?.name ?? key;

  // ONE SOURCE FOR THE LONGITUDE. Recomputing it here would be a second place the precession
  // correction has to be remembered, and the place it would eventually be forgotten.
  const longitude = geocentricLongitude(key, ts);
  let latitude = 0, distance = 0;
  if (key === "sun") {
    const e = heliocentric(PLANET_BY_KEY.get("earth")!, ts);
    distance = Math.hypot(e.x, e.y, e.z);
  } else {
    const p = heliocentric(def!, ts);
    const e = heliocentric(PLANET_BY_KEY.get("earth")!, ts);
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    distance = Math.hypot(dx, dy, dz);
    latitude = Math.atan2(dz, Math.hypot(dx, dy)) / RAD;
  }

  const motion = dailyMotion(key, ts);
  return { key, name, longitude, latitude, distance, daily_motion: motion, retrograde: motion < 0 };
}

/**
 * Signed apparent motion in degrees per day, by central difference.
 *
 * The half-day step is deliberate: shorter and floating-point noise in the longitude starts to
 * dominate near a station, which is the exact moment this number decides something.
 */
export function dailyMotion(key: string, ts: number): number {
  const h = DAY_MS / 2;
  const before = geocentricLongitude(key, ts - h);
  const after = geocentricLongitude(key, ts + h);
  let delta = after - before;
  // Unwrap the 0/360 seam so a planet crossing Aries does not read as a 359° lurch backwards.
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// ─── Stations, retrogrades and shadow windows ────────────────────────────────

const norm180 = (d: number) => { let x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

export interface Station {
  key: string;
  name: string;
  at: number;
  into: "retrograde" | "direct";
  /** The longitude it turns at — the degree the shadow windows are measured from. */
  longitude: number;
}

/**
 * Every station in a window, found by scanning daily for a sign change in apparent motion and then
 * bisecting.
 *
 * DAILY IS FINE AND SHORTER IS NOT BETTER. No planet here reverses and reverses back inside a day,
 * so a day cannot hide a pair; a finer scan would only multiply the cost of a search whose answer
 * the bisection settles anyway.
 */
export function stations(key: string, fromTs: number, toTs: number): Station[] {
  const def = PLANET_BY_KEY.get(key);
  const found: Station[] = [];
  let prev = dailyMotion(key, fromTs) < 0;

  for (let t = fromTs + DAY_MS; t <= toTs; t += DAY_MS) {
    const rx = dailyMotion(key, t) < 0;
    if (rx !== prev) {
      let lo = t - DAY_MS, hi = t;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if ((dailyMotion(key, mid) < 0) === prev) lo = mid; else hi = mid;
      }
      const at = Math.round((lo + hi) / 2);
      found.push({ key, name: def?.name ?? key, at, into: rx ? "retrograde" : "direct", longitude: geocentricLongitude(key, at) });
    }
    prev = rx;
  }
  return found;
}

/** When a planet moving in `direction` crosses `target` longitude, searched backwards or forwards. */
function crossing(key: string, target: number, fromTs: number, step: number, limitMs: number): number | null {
  let prev = norm180(geocentricLongitude(key, fromTs) - target);
  for (let t = fromTs + step; Math.abs(t - fromTs) <= limitMs; t += step) {
    const now = norm180(geocentricLongitude(key, t) - target);
    // A sign change with both values small is a real crossing; the magnitude test rejects the
    // 0/360 seam, which flips sign without the planet going anywhere near the target.
    if (prev !== 0 && now !== 0 && Math.sign(now) !== Math.sign(prev) && Math.abs(now) < 90 && Math.abs(prev) < 90) {
      let lo = t - step, hi = t;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(norm180(geocentricLongitude(key, mid) - target)) === Math.sign(prev)) lo = mid; else hi = mid;
      }
      return Math.round((lo + hi) / 2);
    }
    prev = now;
  }
  return null;
}

export interface RetrogradeWindow {
  key: string;
  name: string;
  /** Station retrograde → station direct. */
  starts_at: number;
  ends_at: number;
  /** The degree it turns back at, and the degree it turns forward at again. */
  from_longitude: number;
  to_longitude: number;
  from_sign: string;
  to_sign: string;
  /** Pre-shadow: first arrival at the station-direct degree, up to the station retrograde. */
  pre_shadow_starts_at: number | null;
  /** Post-shadow: station direct, up to the return to the station-retrograde degree. */
  post_shadow_ends_at: number | null;
}

const signOf = (lon: number) => ZODIAC_SIGNS[Math.floor(norm360(lon) / 30)]!;

export const ZODIAC_SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;

/**
 * Retrograde windows with their shadow periods.
 *
 * THE SHADOWS ARE DERIVED, NOT LOOKED UP. The pre-retrograde shadow begins when the planet first
 * reaches — moving forward — the degree at which it will eventually station direct; the post
 * shadow ends when it returns to the degree at which it stationed retrograde. Both are consequences
 * of the two station longitudes, so once the stations are computed there is nothing left to enter.
 *
 * A SHADOW THAT CANNOT BE FOUND IS NULL, NOT GUESSED. Searching only 180 days either side means a
 * window at the very edge of the requested range can genuinely have no answer yet, and saying so is
 * the difference between an absent date and a wrong one.
 */
export function retrogrades(key: string, fromTs: number, toTs: number): RetrogradeWindow[] {
  const def = PLANET_BY_KEY.get(key);
  // Widened so a retrograde straddling either end is still paired with its own station rather than
  // being dropped, or worse, paired with the neighbouring cycle's.
  const pad = 400 * DAY_MS;
  const all = stations(key, fromTs - pad, toTs + pad);
  const windows: RetrogradeWindow[] = [];

  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i]!, b = all[i + 1]!;
    if (a.into !== "retrograde" || b.into !== "direct") continue;
    if (b.at < fromTs || a.at > toTs) continue;

    const limit = 180 * DAY_MS;
    windows.push({
      key, name: def?.name ?? key,
      starts_at: a.at, ends_at: b.at,
      from_longitude: a.longitude, to_longitude: b.longitude,
      from_sign: signOf(a.longitude), to_sign: signOf(b.longitude),
      pre_shadow_starts_at: crossing(key, b.longitude, a.at, -DAY_MS, limit),
      post_shadow_ends_at: crossing(key, a.longitude, b.at, DAY_MS, limit),
    });
  }
  return windows;
}

export interface Ingress {
  key: string;
  name: string;
  at: number;
  sign: string;
  from_sign: string;
  /** True when the planet is moving backwards into the previous sign. */
  retrograde: boolean;
}

/**
 * Sign ingresses — every crossing of a 30° boundary, in either direction.
 *
 * RETROGRADE INGRESSES COUNT. A planet backing out of a sign it entered three weeks ago has changed
 * sign, and a list that only recorded forward crossings would show it entering Libra twice with no
 * record of it ever leaving.
 */
export function ingresses(key: string, fromTs: number, toTs: number): Ingress[] {
  const def = PLANET_BY_KEY.get(key);
  const found: Ingress[] = [];
  let prevLon = geocentricLongitude(key, fromTs);
  let prevSign = Math.floor(prevLon / 30);

  for (let t = fromTs + DAY_MS; t <= toTs; t += DAY_MS) {
    const lon = geocentricLongitude(key, t);
    const sign = Math.floor(lon / 30);
    if (sign !== prevSign) {
      const boundary = norm360((Math.sign(norm180(lon - prevLon)) > 0 ? sign : prevSign) * 30);
      const at = crossing(key, boundary, t - DAY_MS, DAY_MS / 24, 2 * DAY_MS);
      if (at !== null) {
        found.push({
          key, name: def?.name ?? key, at,
          sign: ZODIAC_SIGNS[sign]!, from_sign: ZODIAC_SIGNS[prevSign]!,
          retrograde: dailyMotion(key, at) < 0,
        });
      }
    }
    prevLon = lon;
    prevSign = sign;
  }
  return found;
}

// ─── The natal chart ─────────────────────────────────────────────────────────

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
}

export interface NatalChart {
  placements: NatalPlacement[];
  ascendant: { longitude: number; sign: string; degrees_in_sign: number } | null;
  /** The Midheaven — the ecliptic point on the meridian. Null whenever the ascendant is. */
  midheaven: { longitude: number; sign: string; degrees_in_sign: number } | null;
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
  const bodies = ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
  const placements: NatalPlacement[] = bodies.map((key) => {
    const p = planetPosition(key, birth.born_at);
    return {
      key, name: p.name,
      longitude: p.longitude,
      sign: ZODIAC_SIGNS[Math.floor(p.longitude / 30)]!,
      degrees_in_sign: p.longitude % 30,
      // The Sun never retrogrades; reporting it as direct is a fact, not a special case.
      retrograde: key === "sun" ? false : p.retrograde,
    };
  });

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

  return {
    placements,
    ascendant: { longitude: asc, sign: ZODIAC_SIGNS[Math.floor(asc / 30)]!, degrees_in_sign: asc % 30 },
    midheaven: { longitude: mc, sign: ZODIAC_SIGNS[Math.floor(mc / 30)]!, degrees_in_sign: mc % 30 },
    houses_note: "Ascendant and Midheaven computed from an exact birth time and the given coordinates.",
    method: METHOD_PLANETS,
  };
}
