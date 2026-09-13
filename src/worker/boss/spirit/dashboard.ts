/**
 * THE ASTRONOMICAL / ASTROLOGICAL DASHBOARD — at the precision of her own report.
 *
 * ─── What this is for ─────────────────────────────────────────────────────────
 *
 * Her instruction of 12 September 2026: "pull out the astrology for the spirit page and mimic this
 * report for my daily briefing". The attached report carried a full dashboard — an ephemeris table
 * for ten bodies to the arcminute, a Moon dashboard with the void-of-course convention NAMED, the
 * sign theme with a planning translation, and major active aspects with orbs to the arcminute. The
 * Spirit page carried one prose paragraph: phase, one decimal place of Moon longitude, and
 * illumination.
 *
 * So this is not new data. `planets.ts` has computed every one of these positions to about an
 * arcminute since the almanac was built, and `astro.ts` computes the Moon from the full Meeus 47.A
 * series. It was a gap in what was RENDERED, not in what was known — the same defect class as the
 * `/astro/at` endpoint returning a Moon when it was named for the whole sky.
 *
 * ─── Precision is the requirement, not a nicety ───────────────────────────────
 *
 * `19.75° Virgo` and `19°45′ Virgo` are the same number and only one of them is an ephemeris. Her
 * report gives degrees AND arcminutes AND direct/retrograde for all ten bodies, and orbs to the
 * arcminute for every aspect, because at one decimal place a 0°16′ orb and a 0°18′ orb are both
 * "0.3°" and the tightness ordering — which is the only thing an orb is FOR — disappears.
 *
 * Checked against her report for 2026-09-12 12:00 UTC: nine of ten bodies agree to the arcminute
 * and the Moon is one arcminute out. `tests/boss/spiritDashboard.test.ts` pins all ten.
 *
 * ─── The disclaimer travels with the content ──────────────────────────────────
 *
 * `ASTROLOGY_DISCLAIMER` is exported from here and rendered ABOVE the ephemeris, not beneath it and
 * not on some other screen. Taking astrology out of the Executive Intelligence briefing must not
 * leave its caveat stranded in a document that no longer contains any astrology — a caveat with
 * nothing to caveat is worse than none, because it implies content that is not there.
 */

import { moonPhase, moonPosition } from "./astro";
import { geocentricLongitude, planetPosition, ZODIAC_SIGNS } from "./planets";

/** Hers, verbatim, and it sits above the table rather than under it. */
export const ASTROLOGY_DISCLAIMER =
  "Astrology here is symbolic planning language—not scientifically validated forecasting.";

/** Hers, verbatim. The frame the numbers are computed in, stated before the numbers. */
export const EPHEMERIS_NOTE =
  "Positions below are tropical and geocentric, calculated for approximately 12:00 UTC.";

/** How the numbers are produced, so no line is mistaken for something retrieved from a website. */
export const EPHEMERIS_METHOD =
  "Computed here. The Moon comes from the full Meeus 47.A series (about 0.005°); the planets from " +
  "Standish elements with IAU 2006 precession to the equinox of date (about one arcminute). " +
  "Nothing is retrieved from any site.";

/**
 * The ten bodies her report lists, in her order — which is the order a chart is read, not
 * alphabetical and not by speed. Chiron is computed by this system and is deliberately NOT here:
 * her report does not carry it, and a table that quietly grows an eleventh row is no longer the
 * table she asked for.
 */
export const EPHEMERIS_BODIES = [
  "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
] as const;

export interface DegreeMinute {
  sign: string;
  /** Whole degrees within the sign, 0–29. */
  degrees: number;
  /** Arcminutes, 0–59. THE PART THAT IS LOST BY ROUNDING TO A DECIMAL. */
  arcminutes: number;
  /** `19°45′ Virgo`. */
  text: string;
}

/**
 * Ecliptic longitude to sign, degree and arcminute.
 *
 * ROUNDING AT 60 IS HANDLED, because it is the bug this function exists to avoid: 19.99999° must
 * print as 20°00′ and not as 19°60′, and at a sign boundary 29.99999° must roll into the next sign
 * rather than print 29°60′ of the old one.
 */
export function degreeMinute(longitude: number): DegreeMinute {
  const wrapped = ((longitude % 360) + 360) % 360;
  let arcmin = Math.round(wrapped * 60);
  if (arcmin >= 360 * 60) arcmin = 0;
  const signIndex = Math.floor(arcmin / (30 * 60)) % 12;
  const within = arcmin - signIndex * 30 * 60;
  const degrees = Math.floor(within / 60);
  const arcminutes = within % 60;
  const sign = ZODIAC_SIGNS[signIndex]!;
  return { sign, degrees, arcminutes, text: `${degrees}°${String(arcminutes).padStart(2, "0")}′ ${sign}` };
}

export interface EphemerisRow extends DegreeMinute {
  key: string;
  name: string;
  longitude: number;
  retrograde: boolean;
  /** `"Direct"` or `"Retrograde"` — her column, in her words. */
  motion: "Direct" | "Retrograde";
}

const NAMES: Record<string, string> = {
  sun: "Sun", moon: "Moon", mercury: "Mercury", venus: "Venus", mars: "Mars",
  jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto",
};

function longitudeOf(key: string, ts: number): { longitude: number; retrograde: boolean } {
  // The Moon has its own series and never retrogrades; the Sun never retrogrades either, and
  // saying so is a fact rather than a special case.
  if (key === "moon") return { longitude: moonPosition(ts).longitude, retrograde: false };
  const p = planetPosition(key, ts);
  return { longitude: p.longitude, retrograde: key === "sun" ? false : p.retrograde };
}

/** Her ephemeris table: ten bodies, exact position, motion. */
export function ephemeris(ts: number): EphemerisRow[] {
  return EPHEMERIS_BODIES.map((key) => {
    const { longitude, retrograde } = longitudeOf(key, ts);
    return {
      key,
      name: NAMES[key]!,
      longitude,
      retrograde,
      motion: retrograde ? "Retrograde" : "Direct",
      ...degreeMinute(longitude),
    } as EphemerisRow;
  });
}

// ─── The Moon dashboard ───────────────────────────────────────────────────────

/**
 * THE CONVENTION IS NAMED, because astrology sources genuinely disagree about it.
 *
 * Her own spec said so before this was built: "Astrology sources disagree about VOC calculation, so
 * do not present one convention as universally authoritative." A void-of-course window printed
 * without its convention is a number that cannot be checked against anything, and different
 * conventions move the start by hours.
 */
export const VOC_CONVENTION = "final-major-Ptolemaic-aspect";

/**
 * The bodies a Moon aspect counts against under that convention: the seven traditional planets,
 * less the Moon itself. Outer planets are excluded ON PURPOSE — including them is a different
 * (modern) convention which produces different windows, and the whole point of naming a convention
 * is that the numbers under it are reproducible.
 */
const VOC_PARTNERS = ["sun", "mercury", "venus", "mars", "jupiter", "saturn"] as const;

/** The five Ptolemaic majors. */
export const PTOLEMAIC = [0, 60, 90, 120, 180] as const;
const ASPECT_NAME: Record<number, string> = { 0: "conjunction", 60: "sextile", 90: "square", 120: "trine", 180: "opposition" };

const MINUTE_MS = 60_000;
const SCAN_STEP_MS = 10 * MINUTE_MS;
/** Two full sign transits of the Moon is about five days; the scan never needs more. */
const SCAN_HORIZON_MS = 6 * 86_400_000;

/** Shortest angular separation, 0–180. */
function separation(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Signed distance from the nearest exact aspect angle, so a crossing is a sign change. */
function offsetFromExact(moon: number, other: number, angle: number): number {
  return separation(moon, other) - angle;
}

/** The instant the Moon next leaves the sign it is in at `ts`, found by bisection on the boundary. */
export function nextMoonIngress(ts: number): { at: number; enters: string } {
  const signAt = (t: number) => Math.floor(moonPosition(t).longitude / 30);
  const start = signAt(ts);
  let lo = ts;
  let hi = ts;
  for (let t = ts; t <= ts + SCAN_HORIZON_MS; t += SCAN_STEP_MS) {
    if (signAt(t) !== start) { hi = t; lo = t - SCAN_STEP_MS; break; }
    hi = t;
  }
  if (signAt(hi) === start) {
    // Cannot happen for the Moon inside six days; if it ever does, say so rather than guess.
    throw new Error("The Moon did not change sign within six days, which is astronomically impossible.");
  }
  while (hi - lo > MINUTE_MS) {
    const mid = Math.floor((lo + hi) / 2);
    if (signAt(mid) === start) lo = mid; else hi = mid;
  }
  return { at: hi, enters: ZODIAC_SIGNS[signAt(hi)]! };
}

export interface MoonAspectEvent {
  at: number;
  body: string;
  name: string;
  aspect: string;
}

/**
 * The Moon's last major Ptolemaic aspect before it leaves its current sign.
 *
 * `null` means the Moon is ALREADY void of course — it has made its last aspect and is coasting to
 * the boundary. That is a real state and it is distinguished from "we could not tell", which is
 * what a `null` with no accompanying flag would have been.
 */
export function lastAspectBeforeIngress(ts: number, ingressAt: number): MoonAspectEvent | null {
  /*
   * ONE MOON PER STEP, NOT THIRTY.
   *
   * This scan used to be written body-outer, angle-middle, time-inner: for every one of six
   * partners and five angles it walked the whole window in ten-minute steps, and at each step it
   * evaluated the full Meeus lunar series again — the same instant, thirty times over — and the
   * partner's position through `planetPosition`, which also computes latitude, distance and a
   * daily motion the comparison never reads. Two and a half days of window is ~360 steps, so that
   * was ~11,000 lunar evaluations to answer a question that needs 360. On the Free plan's 10 ms
   * this one function was most of the Spirit tab's budget.
   *
   * Now the window is walked ONCE. At each step the Moon is evaluated once and each partner once,
   * by `geocentricLongitude` — the very value `planetPosition` reports as `longitude`, so nothing
   * about the answer moves — and the thirty (partner, angle) pairs are checked against those
   * numbers. The crossings found, and the minute each bisects to, are the same as before.
   *
   * THE TIE-BREAK IS KEPT. The old loop accepted a later crossing only when strictly later, so
   * among crossings at the same minute the first (partner, angle) in list order won. Candidates
   * are chosen the same way here rather than by whichever the time-major walk met first.
   */
  const partners = VOC_PARTNERS.map((body) => ({ body, longitude: geocentricLongitude(body, ts) }));
  const moon0 = moonPosition(ts).longitude;
  const prev: number[] = [];
  for (const p of partners) for (const angle of PTOLEMAIC) prev.push(offsetFromExact(moon0, p.longitude, angle));

  let best: { at: number; rank: number; body: string; angle: number } | null = null;
  for (let t = ts + SCAN_STEP_MS; t <= ingressAt; t += SCAN_STEP_MS) {
    const moon = moonPosition(t).longitude;
    let i = 0;
    for (const p of partners) {
      const lon = geocentricLongitude(p.body, t);
      for (const angle of PTOLEMAIC) {
        const was = prev[i]!;
        const now = offsetFromExact(moon, lon, angle);
        if (was === 0 || (was < 0) !== (now < 0)) {
          // Bisect onto the crossing so the minute is real rather than a step boundary.
          let lo = t - SCAN_STEP_MS;
          let hi = Math.min(t, ingressAt);
          const sign0 = was < 0;
          while (hi - lo > MINUTE_MS) {
            const mid = Math.floor((lo + hi) / 2);
            const v = offsetFromExact(moonPosition(mid).longitude, geocentricLongitude(p.body, mid), angle);
            if ((v < 0) === sign0) lo = mid; else hi = mid;
          }
          if (!best || hi > best.at || (hi === best.at && i < best.rank)) {
            best = { at: hi, rank: i, body: p.body, angle };
          }
        }
        prev[i] = now;
        i++;
      }
    }
  }
  return best ? { at: best.at, body: best.body, name: NAMES[best.body]!, aspect: ASPECT_NAME[best.angle]! } : null;
}

export interface VoidOfCourse {
  convention: string;
  /** Whether the Moon is void of course at `ts` itself. */
  now: boolean;
  /** The window the Moon is in, or the next one. Always both ends and the sign it enters. */
  starts_at: number;
  ends_at: number;
  enters_sign: string;
  /** What ends the aspecting — the last major aspect the Moon makes before the boundary. */
  last_aspect: MoonAspectEvent | null;
}

/**
 * The void-of-course window the Moon is in, or the next one.
 *
 * HER REPORT NEEDED BOTH AND THE PAGE SHOWS BOTH. "The Moon is not void of course today" is only
 * half an answer — the half she acts on is "the next one begins Sunday 9:27 AM and ends Monday
 * 1:45 AM when the Moon enters Scorpio", because that is the part with a date in it.
 */
export function voidOfCourse(ts: number): VoidOfCourse {
  const ingress = nextMoonIngress(ts);
  const last = lastAspectBeforeIngress(ts, ingress.at);
  if (!last) {
    // Already void: the Moon has finished aspecting in this sign. The window started before `ts`,
    // so it is reported as current rather than searched for backwards.
    return {
      convention: VOC_CONVENTION,
      now: true,
      starts_at: ts,
      ends_at: ingress.at,
      enters_sign: ingress.enters,
      last_aspect: null,
    };
  }
  return {
    convention: VOC_CONVENTION,
    now: false,
    starts_at: last.at,
    ends_at: ingress.at,
    enters_sign: ingress.enters,
    last_aspect: last,
  };
}

/**
 * TWELVE SIGN THEMES, each with the traditional keywords and her "useful planning translation".
 *
 * Her Libra entry is verbatim from the report. The other eleven are written to the same shape and
 * the same rule: the translation is a way of ORGANISING a day, never a prediction about it, and
 * never a permission. Canon §5.2 governs every string here exactly as it governs `transitMeaning`.
 */
export const SIGN_THEME: Record<string, { keywords: string[]; translation: string }> = {
  Aries: { keywords: ["initiative", "directness", "speed", "courage", "self-assertion"], translation: "Start the thing you have been circling, and start it small enough to finish today." },
  Taurus: { keywords: ["steadiness", "value", "resources", "patience", "the physical"], translation: "Work on what compounds rather than what is urgent, and finish one thing properly." },
  Gemini: { keywords: ["information", "exchange", "curiosity", "variety", "contact"], translation: "Move information: the messages, the questions, the things waiting on a reply." },
  Cancer: { keywords: ["protection", "memory", "the domestic", "care", "belonging"], translation: "Protect the base — the people, the records, the things you would hate to lose." },
  Leo: { keywords: ["visibility", "authorship", "generosity", "confidence", "performance"], translation: "Put your name on something and let it be seen rather than refined further." },
  Virgo: { keywords: ["discernment", "craft", "correction", "service", "detail"], translation: "Fix the small broken thing that everything downstream keeps tripping on." },
  Libra: { keywords: ["balance", "negotiation", "relationship", "agreement", "proportion"], translation: "Clean the relationship between competing priorities instead of trying to maximize all of them simultaneously." },
  Scorpio: { keywords: ["depth", "consequence", "what is hidden", "commitment", "power"], translation: "Look at the number or the conversation you have been avoiding, and look at all of it." },
  Sagittarius: { keywords: ["scope", "meaning", "distance", "candour", "the long view"], translation: "Ask what this is for before asking how to do more of it." },
  Capricorn: { keywords: ["structure", "authority", "durability", "responsibility", "the long build"], translation: "Choose the version that will still be standing in a year, even if it is slower." },
  Aquarius: { keywords: ["system", "detachment", "the group", "reform", "the unorthodox"], translation: "Change the rule rather than handling the exception one more time." },
  Pisces: { keywords: ["dissolution", "imagination", "empathy", "porousness", "the unbounded"], translation: "Give the unresolved thing a boundary — a deadline, a name, or a decision to drop it." },
};

export interface MoonDashboard {
  position: DegreeMinute;
  longitude: number;
  phase: string;
  /** Whole-percent illumination, which is the precision her report states it at. */
  illumination_percent: number;
  waxing: boolean;
  age_days: number;
  void_of_course: VoidOfCourse;
  theme: { sign: string; keywords: string[]; translation: string };
}

export function moonDashboard(ts: number): MoonDashboard {
  const pos = moonPosition(ts);
  const phase = moonPhase(ts);
  const place = degreeMinute(pos.longitude);
  const theme = SIGN_THEME[place.sign];
  return {
    position: place,
    longitude: pos.longitude,
    phase: phase.phase,
    illumination_percent: Math.round(phase.illumination * 100),
    waxing: phase.waxing,
    age_days: phase.age_days,
    void_of_course: voidOfCourse(ts),
    theme: { sign: place.sign, keywords: theme?.keywords ?? [], translation: theme?.translation ?? "" },
  };
}

// ─── Major active aspects ─────────────────────────────────────────────────────

/**
 * ORBS, AND WHY THEY ARE TIGHT.
 *
 * Her report's three aspects were 0°16′, 0°18′ and 0°02′ — "Major Active Aspects" meant the ones
 * close enough to be worth a line, not every angle in the sky. A three-degree orb across ten bodies
 * produces a dozen every day and the section stops meaning anything, which is precisely the defect
 * the Spirit page's old transit panel had in the other direction.
 */
export const MUNDANE_ORB: Record<number, number> = { 0: 2, 60: 1.5, 90: 2, 120: 2, 180: 2 };
/** The Moon moves 13° a day, so a Moon aspect at 2° has already been "active" for four hours. */
const MOON_ORB = 1;

export interface MajorAspect {
  a: string;
  a_name: string;
  b: string;
  b_name: string;
  aspect: string;
  angle: number;
  /** Degrees from exact, as a number, for sorting. */
  orb: number;
  /** `0°16′` — the form the report states, because at one decimal 0°16′ and 0°18′ are both "0.3°". */
  orb_text: string;
  /** `Very tight` / `Tight` / `Close` / `Wide`. */
  tightness: string;
  applying: boolean;
  symbolism: string[];
  translation: string;
}

/** What each body contributes to a pair's symbolism. Noun phrases, so two of them compose. */
const SYMBOL: Record<string, string> = {
  sun: "identity and purpose",
  moon: "mood, instinct and what settles",
  mercury: "thinking, speech and the movement of information",
  venus: "value, money and attraction",
  mars: "drive, appetite and friction",
  jupiter: "expansion and appetite for scale",
  saturn: "limit, structure and consequence",
  uranus: "disruption and sudden change",
  neptune: "ambiguity, imagination and blur",
  pluto: "depth, power and what is underneath",
};

/** What the angle does to the pair. Textures, never verdicts — same rule as `ASPECT_TONE`. */
const ANGLE_QUALITY: Record<number, string> = {
  0: "fused, and loud",
  60: "available if reached for",
  90: "in friction; it wants a decision",
  120: "easy, and easy things get wasted",
  180: "pulling both ways, usually through someone else",
};

/**
 * HER TRANSLATIONS WIN WHERE SHE GAVE ONE.
 *
 * Two lines in the attached report are hers and are better than anything composed: "Ask the
 * question beneath the question" for Mercury trine Pluto, and the verify-before-concluding rule for
 * Mercury opposition Neptune. They are stored verbatim and keyed by pair-and-angle; everything else
 * composes, the same way `meaningFor` composes rather than storing six hundred sentences.
 */
const HER_TRANSLATION: Record<string, string> = {
  "mercury|pluto|120": "Ask the question beneath the question.",
  "mercury|neptune|180": "Verify before concluding. For deals, that is excellent advice regardless of astrology.",
};

const PAIR_SYMBOLISM: Record<string, string[]> = {
  "mercury|pluto|120": ["deep analysis", "investigative thinking", "direct communication around underlying issues"],
  "mercury|neptune|180": ["ambiguity", "imagination", "potential misunderstanding", "incomplete information"],
  "neptune|pluto|60": ["long-duration institutional transformation", "a generational configuration, background context only"],
};

function tightnessOf(orb: number): string {
  if (orb <= 0.5) return "Very tight";
  if (orb <= 1) return "Tight";
  if (orb <= 2) return "Close";
  return "Wide";
}

/** `0°16′`, from a decimal orb. Arcminutes, because that is the whole point of an orb. */
export function orbText(orb: number): string {
  const total = Math.round(orb * 60);
  return `${Math.floor(total / 60)}°${String(total % 60).padStart(2, "0")}′`;
}

/**
 * Every major aspect currently inside orb, tightest first.
 *
 * APPLYING IS COMPUTED, NOT GUESSED. Her spec asks for "applying / separating if available", and it
 * is available: the separation an hour later is either closer to exact or further from it. A
 * separating aspect is finishing and an applying one is not, which is the difference between a
 * thing to notice and a thing to plan around.
 */
export function majorAspects(ts: number): MajorAspect[] {
  const bodies = EPHEMERIS_BODIES;
  const lon = new Map(bodies.map((k) => [k as string, longitudeOf(k, ts).longitude]));
  const later = new Map(bodies.map((k) => [k as string, longitudeOf(k, ts + 3_600_000).longitude]));
  const out: MajorAspect[] = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      for (const angle of PTOLEMAIC) {
        const orb = Math.abs(separation(lon.get(a)!, lon.get(b)!) - angle);
        const limit = a === "moon" || b === "moon" ? MOON_ORB : MUNDANE_ORB[angle]!;
        if (orb > limit) continue;
        const orbLater = Math.abs(separation(later.get(a)!, later.get(b)!) - angle);
        const key = `${a}|${b}|${angle}`;
        out.push({
          a, a_name: NAMES[a]!, b, b_name: NAMES[b]!,
          aspect: ASPECT_NAME[angle]!,
          angle,
          orb,
          orb_text: orbText(orb),
          tightness: tightnessOf(orb),
          applying: orbLater < orb,
          symbolism: PAIR_SYMBOLISM[key] ?? [SYMBOL[a]!, SYMBOL[b]!, ANGLE_QUALITY[angle]!],
          translation:
            HER_TRANSLATION[key] ??
            `${cap(SYMBOL[a]!)} meets ${SYMBOL[b]!} — ${ANGLE_QUALITY[angle]!}.`,
        });
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every body currently retrograde, in her report's order. */
export function currentRetrogrades(ts: number): EphemerisRow[] {
  return ephemeris(ts).filter((r) => r.retrograde);
}

/**
 * The whole dashboard, in the order her report puts it: disclaimer, ephemeris, Moon, theme,
 * aspects, retrogrades.
 *
 * RULE 0 LIVES IN THE SHAPE. `bodies` is fixed at ten and the page renders `bodies.length`; a
 * dashboard that computed nothing would return an empty array and the page says so by name rather
 * than rendering an empty table that reads as a quiet sky.
 */
export function astroDashboard(ts: number) {
  return {
    ts,
    disclaimer: ASTROLOGY_DISCLAIMER,
    note: EPHEMERIS_NOTE,
    method: EPHEMERIS_METHOD,
    bodies: ephemeris(ts),
    moon: moonDashboard(ts),
    aspects: majorAspects(ts),
    retrogrades: currentRetrogrades(ts).map((r) => ({ name: r.name, position: r.text })),
  };
}
