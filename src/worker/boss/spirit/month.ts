import { buildAlmanac, type AlmanacEvent } from "./astro";
import { natalChart, transitAspects, type BirthData } from "./natal";
import { ORB, TRANSIT_BODY, NATAL_POINT, ASPECT_TONE } from "./transitMeaning";
import { monthIdInZone, OWNER_TIMEZONE_LABEL, dateTimeFormat } from "@shared/boss/timezone";

/**
 * THE MONTH'S DATES THAT ACTUALLY MATTER — asked for because a list of everything is not a month.
 *
 * The almanac already computes new moons, full moons, stations, retrograde windows and ingresses,
 * and the Spirit page could already show them. That is thirty-odd events a month, which is a
 * calendar rather than a signal: shown all at once it says nothing about which two days are worth
 * knowing about in advance.
 *
 * ─── What makes a date important is that it is HERS ─────────────────────────
 *
 * A full moon is a full moon for eight billion people. A transit going exact against her natal
 * Midheaven is a date about her, and it is the thing the almanac could never produce because the
 * almanac does not know her chart. So the ranking is not "how rare is this event" but "how directly
 * does this touch her" — and the sky-wide events stay, ranked below the personal ones, because
 * "Mercury stations on the 14th" is genuinely useful context for a week of contract talk.
 *
 * ─── Exactness is found by scanning, not by solving ─────────────────────────
 *
 * The orb of an aspect falls to a minimum and rises again. Finding that minimum analytically means
 * per-body orbital algebra; finding it by sampling every six hours across the month and taking the
 * lowest point is a few hundred cheap evaluations and is accurate to within hours. For a date on a
 * screen that says "around the 14th", hours is far below the resolution that matters — and the
 * function says `about` rather than pretending to a precision it did not compute.
 *
 * ─── §5.2 holds here exactly as it does on the daily panel ──────────────────
 *
 * Nothing on this list is a reason to schedule or avoid anything. A date is context: it says what
 * the sky is doing that day, and reality has priority over all of it.
 */

const DAY_MS = 86_400_000;
const SIX_HOURS = 6 * 3_600_000;

export interface MonthDate {
  /** ISO day in her zone. */
  day: string;
  at: number;
  /** personal | sky */
  scope: "personal" | "sky";
  headline: string;
  why: string;
  /** Lower sorts first within a day. Used only for ordering, never shown. */
  rank: number;
}

export interface MonthAhead {
  month: string;
  timezone_label: string;
  dates: MonthDate[];
  /** Said plainly when a month genuinely has little in it. */
  note: string;
  caveat: string;
}

/**
 * The slow bodies. A transit from one of these going exact is a date worth knowing weeks ahead,
 * because it arrives once and does not come back for years. The fast ones do this every month and
 * would flood the list — they belong on the daily panel, which is where they already are.
 */
const SLOW = new Set(["jupiter", "saturn", "uranus", "neptune", "pluto", "chiron"]);

/** The natal points where a transit is most likely to mean something she would notice. */
const WEIGHT: Record<string, number> = {
  sun: 0, moon: 0, ascendant: 0, midheaven: 0,
  mercury: 1, venus: 1, mars: 1,
  jupiter: 2, saturn: 2, node: 2, fortune: 2,
  uranus: 3, neptune: 3, pluto: 3, chiron: 3, lilith: 3,
};

const dayIn = (ts: number, tz: string) =>
  dateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

/**
 * When each slow transit reaches its tightest point inside the window.
 *
 * ONE ENTRY PER PAIR, at its minimum. Without that a Saturn transit in orb for six weeks would
 * appear on forty consecutive days, which is the opposite of a list of important dates.
 */
function exactDates(birth: BirthData, from: number, to: number, tz: string): MonthDate[] {
  const chart = natalChart(birth);
  const best = new Map<string, { orb: number; at: number; body: string; point: string; aspect: string; pointName: string; bodyName: string }>();

  // Only the slow bodies are asked for — the fast ones were computed at every sample and thrown
  // away on the next line, which was half the cost of the month.
  const slow = [...SLOW];
  for (let t = from; t <= to; t += SIX_HOURS) {
    for (const a of transitAspects(chart, t, slow)) {
      if (!SLOW.has(a.body)) continue;
      const key = `${a.body}|${a.natal_point}|${a.aspect}`;
      const seen = best.get(key);
      if (!seen || a.orb < seen.orb) {
        best.set(key, {
          orb: a.orb, at: t, body: a.body, point: a.natal_point,
          aspect: a.aspect, pointName: a.natal_point_name, bodyName: a.body_name,
        });
      }
    }
  }

  const out: MonthDate[] = [];
  for (const e of best.values()) {
    /*
     * A MINIMUM AT THE EDGE OF THE WINDOW IS NOT A PEAK. If the tightest sample is the first or last
     * one, the aspect is still closing or already separating and its real exact date is outside this
     * month — listing it would put a date on the calendar that is not this month's date.
     */
    if (e.at <= from + SIX_HOURS || e.at >= to - SIX_HOURS) continue;
    // Still only worth a date if it actually gets close. Half the body's orb is the bar.
    if (e.orb > (ORB[e.body] ?? 2) / 2) continue;

    out.push({
      day: dayIn(e.at, tz),
      at: e.at,
      scope: "personal",
      headline: `${e.bodyName} ${e.aspect} your natal ${e.pointName}`,
      why: `${cap(TRANSIT_BODY[e.body] ?? e.body)} meets ${NATAL_POINT[e.point] ?? e.point}. ` +
        `${cap(ASPECT_TONE[e.aspect] ?? e.aspect)}. Closest around this date, give or take a day.`,
      rank: WEIGHT[e.point] ?? 3,
    });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sky-wide events, kept but ranked below anything touching her own chart. */
function skyDates(events: AlmanacEvent[], from: number, to: number, tz: string): MonthDate[] {
  const out: MonthDate[] = [];
  for (const e of events) {
    if (e.starts_at < from || e.starts_at > to) continue;
    /*
     * WINDOWS AND SHADOWS ARE PERIODS, NOT DATES, and this is a list of dates.
     *
     * The almanac's derived lunar windows — intention, push, visibility, release, reflection — cover
     * most of the month between them, so on the first run they filled a third of the list with
     * spans that have no particular day. A shadow period is likewise a nuance of a retrograde; the
     * station is the date. Both stay in the full almanac below, where a period belongs.
     */
    if (e.kind === "shadow" || e.kind === "window") continue;

    const rank =
      e.kind === "retrograde" ? 4 :
      e.kind === "new_moon" || e.kind === "full_moon" ? 5 : 6;

    out.push({
      day: dayIn(e.starts_at, tz),
      at: e.starts_at,
      scope: "sky",
      headline: e.label,
      why:
        e.kind === "retrograde"
          ? "A station. The days either side of one are the part people actually notice."
          : e.kind === "new_moon"
            ? "The dark of the moon — the start of a cycle rather than a thing that happens to you."
            : e.kind === "full_moon"
              ? "Full moon. Whatever was already loud gets louder."
              : "A sign change. Slow bodies do this rarely enough to be worth a note.",
      rank,
    });
  }
  return out;
}

export function monthAhead(birth: BirthData | null, at: number, tz = "America/Chicago"): MonthAhead {
  const month = monthIdInZone(at, tz);
  const from = Date.parse(`${month}-01T00:00:00Z`) - 2 * DAY_MS;
  const to = from + 35 * DAY_MS;

  const sky = skyDates(buildAlmanac(from, 2), from + 2 * DAY_MS, to - 3 * DAY_MS, tz);
  const personal = birth ? exactDates(birth, from, to, tz) : [];

  const dates = [...personal, ...sky]
    .filter((d) => d.day.startsWith(month))
    .sort((a, b) => a.at - b.at || a.rank - b.rank);

  /*
   * A QUIET MONTH SAYS SO. Padding the list with every ingress to make it look substantial is how a
   * page teaches her that none of it means anything — the same reasoning as the daily panel's
   * "nothing is close today".
   */
  const note = personal.length === 0
    ? birth
      ? "Nothing slow reaches your own chart this month. The dates below are sky-wide."
      : "No birth data, so nothing here is about your chart specifically."
    : `${personal.length} date${personal.length === 1 ? "" : "s"} this month touch your chart directly.`;

  return {
    month,
    timezone_label: OWNER_TIMEZONE_LABEL,
    dates,
    note,
    caveat:
      "Dates are approximate to within a day, and none of them is a reason to schedule or avoid " +
      "anything — canon §5.2 puts reality first and the sky second, always.",
  };
}
