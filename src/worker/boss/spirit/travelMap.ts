/**
 * THE LOCKED 2026 MONEY / CAREER / TRAVEL MAP.
 *
 * ─── Why it lives here and not in the briefing spec ────────────────────────────
 *
 * It used to live in `docs/boss/EXECUTIVE_INTELLIGENCE.md`, as twenty-six lines of prose bullets
 * inside the document the Executive Intelligence duty passes to a model as `task_input.spec`. Her
 * instruction of 12 September 2026:
 *
 *   "They are not to be mixed in the way this report is but pull out the astrology for the spirit
 *    page and mimic this report for my daily briefing."
 *
 * The map is astrologically derived. She chose, explicitly, to move it to the Spirit page WITH the
 * ephemeris rather than leave it in the briefing — and her reason is the one that makes this
 * checkable: once the map is out, the briefing contains NO astrologically-derived content at all,
 * which is a rule a validator can enforce. A briefing that keeps "the map but not the chart" is a
 * judgement call on every future edit; a briefing that keeps neither is a scan.
 *
 * ─── Why it is DATA and not prose ─────────────────────────────────────────────
 *
 * As bullets in a markdown file, nothing could answer "which week is today in?" — the model
 * re-derived it every morning from a list it had to read correctly, and a misread was invisible.
 * As rows, `weekFor()` answers it, and the page states the band rather than reciting the table.
 *
 * ─── `unset` IS A REAL VALUE ──────────────────────────────────────────────────
 *
 * A week with no band is not a blank row and not a guess. Jan–May 2026 have no bands, and neither
 * does any of 2027. The failure this prevents is specific and was live for about four hours on
 * 12 September: four weeks (Oct 26–Nov 1, Nov 2–8, Nov 9–15, Nov 30–Dec 6) were believed unlocked,
 * and the tempting fix — infer them from her line "advises against fully unplugging until
 * November 15" — would have rendered a GREEN week she never gave. She sent the real bands an hour
 * later and they were indeed green, which is exactly why the inference was still wrong: a guess
 * that happens to be right is indistinguishable on screen from one that is not.
 *
 * So `"unset"` is a member of the band union, it has no colour, and `BAND` has no glyph for it.
 * Filling a week in is a one-line edit to the table below.
 */

/** Her legend, verbatim. The doubled marks are SEPARATE values, not intensifiers of one value. */
export type Band = "green" | "peak_green" | "yellow" | "red" | "unset";

/** How favourable a travel/reset window is. `0` is not a window at all. */
export type TravelMark = 0 | 1 | 2;

export interface MapWeek {
  /** Inclusive first day, `YYYY-MM-DD`. Weeks run Monday–Sunday; several cross a month boundary. */
  starts: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  ends: string;
  /** Her label for the range, as she writes it. */
  label: string;
  band: Band;
  /**
   * `null` when the week has no band. NOT `0` — zero is "she gave this week a band and it carries
   * no plane", which is a different statement from "she has not given this week anything."
   */
  travel: TravelMark | null;
  /** Her note for the week, `null` when unset. */
  note: string | null;
}

/**
 * HER LEGEND, VERBATIM, AND IT IS NOT WHAT ANYONE WOULD GUESS.
 *
 * 🔴 is "Protect energy; do not force" — NOT "rest" and NOT "reset". A red week is a week where
 * pushing is the error, which is a posture, not a holiday. Paraphrasing it to "rest/reset" turns a
 * working instruction into a permission to disappear, and she has a separate mark (✈️) for that.
 */
export const BAND: Record<Exclude<Band, "unset">, { glyph: string; meaning: string }> = {
  green: { glyph: "🟢", meaning: "Push, accelerate, close" },
  peak_green: { glyph: "🟢🟢", meaning: "Peak — the strongest commercial weeks of the year" },
  yellow: { glyph: "🟡", meaning: "Maintain, prepare, refine" },
  red: { glyph: "🔴", meaning: "Protect energy; do not force" },
};

export const TRAVEL: Record<Exclude<TravelMark, 0>, { glyph: string; meaning: string }> = {
  1: { glyph: "✈️", meaning: "Favorable travel/reset window" },
  2: { glyph: "✈️✈️", meaning: "Best travel/reset window" },
};

/**
 * WHAT A WEEK WITH NO BAND SAYS. Not "—", not an empty cell, not a colour.
 *
 * The string is asserted by `scripts/validate/the-briefing-is-not-the-chart.mjs`, because the whole
 * point of `unset` is that it is VISIBLE. A blank cell and a green week look different; a blank
 * cell and a broken lookup do not.
 */
export const NOT_YET_GIVEN = "not yet given";

/** Hers, and it travels with the map wherever the map goes. */
export const MAP_CAVEAT = "This is a planning framework, not a guaranteed prediction.";

/**
 * The locked map, as she sent it on 12 September 2026. One row per week, her note per week.
 *
 * The coarse ranges that appear in her narrative — "October 5–25", "December 7–31" — are summaries
 * of three weeks each with three different notes, and they are stored as the three weeks. Rolling
 * them up would lose "finalize major opportunities" into "peak commercial stretch".
 */
export const MAP_WEEKS: readonly MapWeek[] = [
  { starts: "2026-06-01", ends: "2026-06-07", label: "Jun 1–7", band: "green", travel: 0, note: "Money push" },
  { starts: "2026-06-08", ends: "2026-06-14", label: "Jun 8–14", band: "green", travel: 0, note: "Outreach, pipeline, visibility, revenue conversations" },
  { starts: "2026-06-15", ends: "2026-06-21", label: "Jun 15–21", band: "yellow", travel: 1, note: "Refinement, lighter work, offer cleanup, short travel" },
  { starts: "2026-06-22", ends: "2026-06-28", label: "Jun 22–28", band: "yellow", travel: 2, note: "Best remaining June travel week; Europe/rest favored" },
  { starts: "2026-06-29", ends: "2026-07-05", label: "Jun 29–Jul 5", band: "yellow", travel: 1, note: "Soft re-entry/final travel stretch; do not disappear completely" },
  { starts: "2026-07-06", ends: "2026-07-12", label: "Jul 6–12", band: "yellow", travel: 0, note: "Prepare launches, tighten messaging, set Q3 targets" },
  { starts: "2026-07-13", ends: "2026-07-19", label: "Jul 13–19", band: "peak_green", travel: 0, note: "Major ignition week—launch, announce, make bold asks" },
  { starts: "2026-07-20", ends: "2026-07-26", label: "Jul 20–26", band: "green", travel: 0, note: "Follow up, convert interest, push active deals" },
  { starts: "2026-07-27", ends: "2026-08-02", label: "Jul 27–Aug 2", band: "green", travel: 0, note: "Visibility, capital conversations, closings" },
  { starts: "2026-08-03", ends: "2026-08-09", label: "Aug 3–9", band: "green", travel: 0, note: "Revenue generation, networking, growth" },
  { starts: "2026-08-10", ends: "2026-08-16", label: "Aug 10–16", band: "green", travel: 0, note: "Partnerships, investor conversations, sales" },
  { starts: "2026-08-17", ends: "2026-08-23", label: "Aug 17–23", band: "green", travel: 0, note: "Negotiation, authority-building, closing" },
  { starts: "2026-08-24", ends: "2026-08-30", label: "Aug 24–30", band: "yellow", travel: 1, note: "Travel/reset; stabilize gains" },
  { starts: "2026-08-31", ends: "2026-09-06", label: "Aug 31–Sep 6", band: "green", travel: 0, note: "Final summer push, strategic meetings, revenue" },
  { starts: "2026-09-07", ends: "2026-09-13", label: "Sep 7–13", band: "yellow", travel: 1, note: "Travel, recalibration, systems review" },
  { starts: "2026-09-14", ends: "2026-09-20", label: "Sep 14–20", band: "yellow", travel: 0, note: "Pipeline management and internal organization" },
  { starts: "2026-09-21", ends: "2026-09-27", label: "Sep 21–27", band: "yellow", travel: 0, note: "Prepare for October; cut distractions" },
  { starts: "2026-09-28", ends: "2026-10-04", label: "Sep 28–Oct 4", band: "green", travel: 0, note: "Begin harvest; activate the strongest opportunities" },
  { starts: "2026-10-05", ends: "2026-10-11", label: "Oct 5–11", band: "peak_green", travel: 0, note: "Peak money week—contracts, revenue, investments, closings" },
  { starts: "2026-10-12", ends: "2026-10-18", label: "Oct 12–18", band: "peak_green", travel: 0, note: "Peak money week—capital, deal execution, expansion" },
  { starts: "2026-10-19", ends: "2026-10-25", label: "Oct 19–25", band: "peak_green", travel: 0, note: "Peak money week—finalize major opportunities" },
  { starts: "2026-10-26", ends: "2026-11-01", label: "Oct 26–Nov 1", band: "green", travel: 0, note: "Capture momentum and finish strong" },
  { starts: "2026-11-02", ends: "2026-11-08", label: "Nov 2–8", band: "green", travel: 0, note: "Close loops, secure commitments, collect revenue" },
  { starts: "2026-11-09", ends: "2026-11-15", label: "Nov 9–15", band: "green", travel: 0, note: "Final major push" },
  { starts: "2026-11-16", ends: "2026-11-22", label: "Nov 16–22", band: "yellow", travel: 1, note: "Travel/reset" },
  { starts: "2026-11-23", ends: "2026-11-29", label: "Nov 23–29", band: "yellow", travel: 1, note: "Thanksgiving, rest, travel, protect gains" },
  { starts: "2026-11-30", ends: "2026-12-06", label: "Nov 30–Dec 6", band: "yellow", travel: 0, note: "Year-end review, strategy, planning" },
  { starts: "2026-12-07", ends: "2026-12-13", label: "Dec 7–13", band: "red", travel: 1, note: "Rest, retreat, low-pressure travel" },
  { starts: "2026-12-14", ends: "2026-12-20", label: "Dec 14–20", band: "red", travel: 1, note: "Recovery, reflection, integration" },
  { starts: "2026-12-21", ends: "2026-12-31", label: "Dec 21–31", band: "red", travel: 2, note: "Best full-reset window—travel, retreat, visioning and 2027 planning" },
];

/** A week she has not given a band, rendered rather than hidden. */
export function unsetWeek(label: string, starts: string, ends: string): MapWeek {
  return { starts, ends, label, band: "unset", travel: null, note: null };
}

export interface MapWeekView extends MapWeek {
  /** `"🟡 ✈️"`, or `NOT_YET_GIVEN`. Never a colour the week was not given. */
  signal: string;
  /** Her legend line for the band, or the reason there is none. */
  meaning: string;
  current: boolean;
}

/**
 * THE ONE PLACE A BAND BECOMES A GLYPH.
 *
 * `BAND` deliberately has no `unset` key, so this cannot accidentally paint an ungiven week: the
 * lookup is a `switch` on a value outside the record and there is no `?? BAND.green` fallback
 * anywhere. That is the whole mechanism — a missing band is a compile-time hole, not a default.
 */
export function signalFor(week: MapWeek): { signal: string; meaning: string } {
  if (week.band === "unset") {
    return {
      signal: NOT_YET_GIVEN,
      meaning: "She has not locked a band for this week. Nothing is inferred from the weeks around it.",
    };
  }
  const band = BAND[week.band];
  const plane = week.travel && week.travel > 0 ? TRAVEL[week.travel] : null;
  return {
    signal: plane ? `${band.glyph} ${plane.glyph}` : band.glyph,
    meaning: plane ? `${band.meaning} · ${plane.meaning}` : band.meaning,
  };
}

/** `YYYY-MM-DD` comparison, which is lexicographic and therefore needs no Date at all. */
function within(week: MapWeek, day: string): boolean {
  return day >= week.starts && day <= week.ends;
}

/** The week a day falls in, or `null` when the map does not cover it. Never the nearest week. */
export function weekFor(day: string, weeks: readonly MapWeek[] = MAP_WEEKS): MapWeek | null {
  return weeks.find((w) => within(w, day)) ?? null;
}

/** The week after the one `day` falls in, which is what "next map transition" means. */
export function nextWeekAfter(day: string, weeks: readonly MapWeek[] = MAP_WEEKS): MapWeek | null {
  return weeks.find((w) => w.starts > day) ?? null;
}

export function view(week: MapWeek, today: string): MapWeekView {
  return { ...week, ...signalFor(week), current: within(week, today) };
}

/** What each band is NOT, so a reading can end on the mistake the week invites. */
const OVERREACH: Record<Exclude<Band, "unset">, string> = {
  green: "Do not turn a green week into indiscriminate activity; one high-value ask beats ten small ones.",
  peak_green: "This is the week to spend, not the week to prepare. Preparation was the point of the yellow ones.",
  yellow: "Do not try to manufacture peak intensity out of a maintenance week.",
  red: "Protecting energy is the assignment. Lower output this week is the plan working, not a lapse.",
};

/**
 * THE WEEK AS A SENTENCE, WHICH IS WHAT SHE ACTUALLY READS.
 *
 * Her own reading of 12 September, which is the shape this composes to:
 *
 *   "This is a yellow travel/recalibration week. Keep live opportunities moving, clean up your
 *    systems, and prepare the pipeline—but don't try to manufacture peak October intensity in
 *    September."
 *
 * Note what it is made of: the band, her note for the week, and THE MISTAKE THE BAND INVITES. A
 * coloured tile alone tells her nothing she can act on — "🟡" is a fact about a table, and "don't
 * manufacture peak October intensity in September" is a decision about today. So the reading is
 * composed from three named parts rather than stored as thirty sentences that would go stale one at
 * a time, the same reasoning as `meaningFor` in `transitMeaning.ts`.
 *
 * An ungiven week gets NO reading at all. A sentence is the most persuasive form a guess can take.
 */
export function reading(week: MapWeek): string | null {
  if (week.band === "unset") return null;
  const band = BAND[week.band];
  const plane = week.travel && week.travel > 0 ? ` ${TRAVEL[week.travel].meaning.toLowerCase()} is favoured.` : "";
  const note = week.note ? ` ${week.note}.` : "";
  return `${band.glyph} ${band.meaning}.${note}${plane} ${OVERREACH[week.band]}`;
}

/**
 * Everything the Spirit page needs to render the map.
 *
 * RULE 0 IS ENFORCED IN THE DATA, NOT ONLY IN THE SCAN. An empty table produces
 * `covered: false` and a named reason, so a map that lost its rows says so instead of rendering an
 * empty section that reads as "a quiet year".
 */
export function travelMap(today: string, weeks: readonly MapWeek[] = MAP_WEEKS) {
  const current = weekFor(today, weeks);
  const next = nextWeekAfter(today, weeks);
  return {
    covered: weeks.length > 0,
    empty_reason: weeks.length > 0 ? null : "The locked map has no weeks in it at all. That is a fault, not a year without bands.",
    today,
    current: current ? { ...view(current, today), reading: reading(current) } : null,
    uncovered_reason: current
      ? null
      : `${today} falls outside the locked map. No band is shown, because none was given for it.`,
    next: next ? view(next, today) : null,
    weeks: weeks.map((w) => view(w, today)),
    legend: [
      ...Object.values(BAND).map((b) => ({ glyph: b.glyph, meaning: b.meaning })),
      ...Object.values(TRAVEL).map((t) => ({ glyph: t.glyph, meaning: t.meaning })),
      { glyph: NOT_YET_GIVEN, meaning: "No band has been given for that week." },
    ],
    caveat: MAP_CAVEAT,
  };
}
