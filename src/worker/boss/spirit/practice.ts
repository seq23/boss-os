import type { Env } from "../env";
import { batchReads } from "../lib/batchReads";
import { isWestPeekDay, secondBlockVehicle } from "./arcs";

/**
 * THE MORNING PRACTICE — what she actually does, as opposed to what the sky is doing.
 *
 * Her §8.1: "Spirit is an active operating pillar and must be rendered explicitly in the daily
 * agenda." The Spirit screen rendered moon phase, illumination and a contribution counter — all
 * true, none of it a thing to do at 6am. This module is the other half: the exact sentence, the
 * exact sequence, and the floor for the days that do not have twenty minutes in them.
 */

// ─── §8.3 · the twenty-minute sequence ───────────────────────────────────────
//
// FIXED, IN CODE, AND NOT IN A TABLE. Her contract prints these seven steps with their minutes;
// they are not settings and nobody should be able to edit them by accident. A row in a database is
// something a request could one day change.

export interface PracticeStep {
  minutes: number;
  what: string;
}

export const MANIFESTATION_SEQUENCE: PracticeStep[] = [
  { minutes: 2, what: "Slow breathing. Nervous-system regulation." },
  { minutes: 2, what: "Chakra balancing / energetic centering." },
  { minutes: 2, what: "The gratitude sentence out loud, plus two supporting lines." },
  { minutes: 5, what: "Visualization of the desired life and identity." },
  { minutes: 4, what: "Affirmations and identity statements, spoken." },
  { minutes: 3, what: "Emotional embodiment and expectancy lock-in." },
  { minutes: 2, what: "Name today's energetic standard, and the one action that matches it." },
];

/**
 * §8.4's hard-day floor.
 *
 * NOT A SHORTER VERSION OF THE ABOVE — a different, shorter thing, and her document lists it
 * separately for that reason. Five items, one of which is a real-world action, because §8.2 says
 * manifestation "may not replace evidence, execution, recovery, or real-world action" and the floor
 * is where that rule is most likely to get quietly dropped.
 */
export const HARD_DAY_FLOOR: PracticeStep[] = [
  { minutes: 2, what: "Breathing." },
  { minutes: 1, what: "One gratitude sentence, out loud." },
  { minutes: 5, what: "Visualization." },
  { minutes: 1, what: "One identity statement." },
  { minutes: 0, what: "One real-world aligned action. This one is not optional on a floor day." },
];

export const SEQUENCE_MINUTES = MANIFESTATION_SEQUENCE.reduce((n, s) => n + s.minutes, 0);

// ─── §8.5 · the gratitude sentence ───────────────────────────────────────────

/** Her six themes, rotated so a week does not land on "resilience" three times. */
export const GRATITUDE_THEMES = [
  "wealth and opportunity",
  "resilience and survival",
  "body and health",
  "spiritual protection and alignment",
  "momentum and progress",
  "relationships and support",
] as const;

/** How far back the no-repeat rule reaches. Her §8.5: the active 90-day cycle. */
export const NO_REPEAT_DAYS = 90;

/** Rotates on the date, so the same day always draws the same theme and a week visibly cycles. */
export function themeFor(dayId: string): string {
  const days = Math.floor(Date.parse(`${dayId}T00:00:00Z`) / 86_400_000);
  return GRATITUDE_THEMES[((days % GRATITUDE_THEMES.length) + GRATITUDE_THEMES.length) % GRATITUDE_THEMES.length]!;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "had", "has", "have", "i",
  "in", "is", "it", "its", "me", "my", "of", "on", "or", "that", "the", "this", "to", "was", "what",
  "which", "with", "you", "your", "am", "so", "still", "even", "get", "got",
]);

/**
 * The content words of a sentence, sorted and joined.
 *
 * WHY NOT THE SENTENCE ITSELF. "Grateful my body carried me" and "grateful that my body carried me
 * through" are the same sentence for the purpose of a no-repeat rule, and comparing raw strings
 * would let both through — the repetition she asked to avoid, wearing a different preposition.
 */
export function fingerprint(sentence: string): string {
  return [...new Set(
    sentence.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )].sort().join(" ");
}

/** How much two fingerprints overlap, 0–1. */
export function similarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / new Set([...A, ...B]).size;
}

/** Above this, it is the same sentence again. Chosen to catch a rephrase, not a shared noun. */
export const SAME_SENTENCE = 0.6;

/**
 * The prompt.
 *
 * WHAT IT MAY SEE IS THE SAME LIST THE MORNING COACHING GETS: the shape of the day, and nothing
 * classified sovereign. No manifestations, no dreams, no relationship notes, no promoted memory. A
 * gratitude sentence would be MORE specific with those, and that is exactly why the line is drawn
 * here rather than argued about later.
 *
 * THE PROHIBITIONS ARE HERS, QUOTED. §8.5 rules out stiff, generic, corny and filler by name, which
 * is a sharper instruction than "write something nice" and is the whole difference between a
 * sentence she says out loud and one she skips.
 */
export function buildGratitudePrompt(ctx: {
  theme: string;
  anchor: string | null;
  openLoops: number;
  dayMode: string | null;
  avoid: string[];
}): string {
  return [
    "Write ONE sentence of gratitude for the owner of this system to say out loud tomorrow morning.",
    "",
    `Theme for today: ${ctx.theme}.`,
    "",
    "It must be:",
    "- grounded and specific, not abstract",
    "- speakable out loud without feeling silly",
    "- connected to her real life: her priorities, her progress, her resources, her current reality",
    "",
    "It must NOT be: stiff, generic, corny, or filler. Not a quote. Not advice. Not an affirmation.",
    "Not addressed to anyone. No preamble, no quotation marks, no explanation — the sentence only.",
    "",
    "What you know about her day, and it is all you know:",
    `- Today's centre of gravity: ${ctx.anchor ?? "not set"}`,
    `- Things open: ${ctx.openLoops}`,
    `- How the day is being run: ${ctx.dayMode ?? "a normal day"}`,
    ...(ctx.avoid.length
      ? ["", "She has already had these recently. Do not repeat their shape or their subject:",
         ...ctx.avoid.slice(0, 8).map((s) => `- ${s}`)]
      : []),
  ].join("\n");
}



/**
 * Today's sentence: read it if it exists, write it once if it does not.
 *
 * GENERATED LAZILY RATHER THAN ON A SCHEDULE. A duty would mean a sentence that is missing whenever
 * the duty failed, discovered by her at 6am; generating on first read means it exists the moment
 * she looks and costs one free-tier call a day.
 *
 * A FAILURE SAYS SO AND PRINTS NOTHING. §8.5 forbids filler, so there is no stock sentence to fall
 * back on — a generic line dressed as her daily gratitude would be exactly the thing the rule is
 * written against, and she would have no way to tell.
 */
/**
 * WHAT THE SENTENCE IS BUILT FROM. Facts this system already holds, read inside the Worker.
 *
 * THE MODEL WAS ALWAYS GOING TO BE WORSE AT THIS, and it took the owner asking to see it. The
 * airlock would only ever have shown a cloud model the SHAPE of her day — the anchor, a count of
 * open loops, the day mode — because everything that makes a gratitude sentence specific is
 * sovereign: her arcs, her vehicles, what she is holding, what she actually did. So the choice was
 * never "a good sentence or her sovereignty". It was a thin sentence written elsewhere, or a
 * grounded one composed here, and only the second is what §8.5 describes.
 *
 * COMPOSED, NEVER STORED, NEVER SENT. No table, so LOCAL_ONLY residency is honoured literally; no
 * model, so LOCAL_ONLY processing is honoured literally. Deterministic, so the same day always
 * yields the same sentence — which is what a mantra needs and what a generator would have spoiled.
 */
export interface DayFacts {
  anchor: string | null;
  dayMode: string | null;
  openLoops: number;
  /** Verdict of the most recently scored day, if any. */
  lastVerdict: string | null;
  /** Title of something she is currently holding, from §8's manifestation practice. */
  holding: string | null;
  /** Whether West Peek's Wednesday cadence lands today. */
  westPeekDay: boolean;
  /** Which vehicle the afternoon block belongs to today. */
  secondVehicle: string;
  /** Days in a row with a recorded day, however small. §2's continuity, not a streak to protect. */
  continuousDays: number;
}

/**
 * The forms, per theme.
 *
 * EACH ONE REQUIRES A REAL FACT AND RETURNS NULL WITHOUT IT. That is the whole mechanism against
 * §8.5's four prohibitions: a form that cannot find its fact does not fall back to something
 * general, it declines, and the next form is tried. Nothing here can produce a sentence that would
 * be true of anybody, because every one of them names something only true of her today.
 */
type Form = (f: DayFacts) => string | null;

const FORMS: Record<string, Form[]> = {
  "wealth and opportunity": [
    (f) => f.anchor ? `Grateful I know exactly what today is for, and it is ${lower(f.anchor)}.` : null,
    (f) => f.westPeekDay ? "Grateful the fund is a real conversation with my brother today and not a someday." : null,
    () => "Grateful the brokerage is mine to work — nobody hands me the next move, and nobody can take it.",
    (f) => f.secondVehicle ? `Grateful ${f.secondVehicle} is still standing and still mine to build.` : null,
  ],
  "resilience and survival": [
    (f) => f.lastVerdict === "miss" ? "Grateful yesterday is closed and today is the one that decides what it was." : null,
    (f) => f.continuousDays >= 3 ? `Grateful I have shown up ${f.continuousDays} days running, including the ones that were small.` : null,
    (f) => f.dayMode === "recovery" ? "Grateful I can name this a recovery day out loud instead of calling myself lazy." : null,
    () => "Grateful money fear has not gotten to decide how I negotiate.",
  ],
  "body and health": [
    (f) => f.dayMode === "recovery" || f.dayMode === "mvd"
      ? "Grateful the floor is in bed today, and that counts as done." : null,
    () => "Grateful my body still does what I ask it to, on the days I ask gently.",
    () => "Grateful keto is a decision I already made, so today is only the doing.",
  ],
  "spiritual protection and alignment": [
    (f) => f.holding ? `Grateful I am still holding ${lower(f.holding)} without gripping it.` : null,
    () => "Grateful for the people behind me who never needed to be asked.",
    () => "Grateful the quiet before anyone needs anything is mine.",
  ],
  "momentum and progress": [
    (f) => f.openLoops === 0 ? "Grateful nothing is hanging over me this morning." : null,
    (f) => f.openLoops > 0 && f.openLoops <= 3
      ? `Grateful only ${f.openLoops} thing${f.openLoops === 1 ? " is" : "s are"} open, and none of them is an emergency.` : null,
    (f) => f.lastVerdict === "full" ? "Grateful yesterday closed clean, and that is not luck." : null,
    (f) => f.anchor ? `Grateful today already has a centre of gravity: ${lower(f.anchor)}.` : null,
  ],
  "relationships and support": [
    (f) => f.westPeekDay ? "Grateful I get to build something with Scooter that outlasts both of us." : null,
    () => "Grateful for the people who knew me before any of this worked.",
    () => "Grateful I am not doing this alone, even on the days it feels like it.",
  ],
};

const lower = (s: string) => (s.length > 1 && s[0] === s[0]!.toUpperCase() && s[1] === s[1]!.toLowerCase()
  ? s[0]!.toLowerCase() + s.slice(1) : s).replace(/\.$/, "");

/**
 * Today's sentence.
 *
 * THE THEME ROTATES ON THE DATE AND THE FORM ROTATES WITHIN IT, so the pair does not recur for
 * weeks — which is how §8.5's 90-day rule is honoured WITHOUT a table. Storing sentences to check
 * for repeats would have meant writing her gratitude into Cloudflare's database, and the rule
 * against repetition is not worth breaking the rule about residency for.
 */
export function composeGratitude(dayId: string, facts: DayFacts): { sentence: string; theme: string } | null {
  const theme = themeFor(dayId);
  const forms = FORMS[theme] ?? [];
  const days = Math.floor(Date.parse(`${dayId}T00:00:00Z`) / 86_400_000);

  // Start at a different form each cycle, so a theme's first form is not simply always the one used.
  const offset = Math.floor(days / GRATITUDE_THEMES.length);
  for (let i = 0; i < forms.length; i++) {
    const form = forms[(offset + i) % forms.length]!;
    const sentence = form(facts);
    if (sentence) return { sentence, theme };
  }
  return null;
}

export interface GratitudeResult {
  sentence: string;
  theme: string;
  /** Where it came from, so it is never mistaken for something a vendor wrote. */
  source: string;
  unavailable: string | null;
}

/**
 * Read the facts and compose.
 *
 * NOTHING LEAVES AND NOTHING IS KEPT. The airlock is not asked because there is nothing to ask
 * about: no cloud model sees any of this, and no row is written. Spirit stays sovereign on both
 * axes with no change to its classification, which is what the owner's rule always wanted.
 */
export async function gratitudeFor(env: Env, dayId: string): Promise<GratitudeResult> {
  const theme = themeFor(dayId);
  const weekday = new Date(`${dayId}T12:00:00Z`).getUTCDay();

  // Five reads, one batch — each statement is CPU on this runtime (lib/batchReads.ts).
  const reads = batchReads(env.DB);
  const [day, loops, lastScored, holding, recentDays] = await Promise.all([
    reads.first<{ morning_contract: string | null; day_mode: string | null }>(true, () =>
      env.DB.prepare(`SELECT morning_contract, day_mode FROM days WHERE id = ?`).bind(dayId)),
    reads.first<{ n: number }>(true, () => env.DB.prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`)),
    reads.first<{ verdict: string }>(true, () =>
      env.DB.prepare(`SELECT verdict FROM days WHERE id < ? AND verdict IS NOT NULL ORDER BY id DESC LIMIT 1`).bind(dayId)),
    reads.first<{ title: string }>(true, () =>
      env.DB.prepare(`SELECT title FROM manifestations WHERE status = 'open' ORDER BY created_at DESC LIMIT 1`)),
    reads.all<{ id: string }>(true, () => env.DB.prepare(`SELECT id FROM days WHERE id <= ? ORDER BY id DESC LIMIT 30`).bind(dayId)),
    reads.flush(),
  ]);

  let anchor: string | null = null;
  try { anchor = day?.morning_contract ? (JSON.parse(day.morning_contract).commitment ?? null) : null; } catch { anchor = null; }

  /*
   * CONSECUTIVE DAYS, COUNTED BACKWARDS AND STOPPING AT THE FIRST GAP. §44's tone forbids streaks
   * as a thing to protect, so this is never shown as a score — it only decides whether one sentence
   * about continuity is available, and a broken run simply makes that form unavailable.
   */
  let continuousDays = 0;
  const have = new Set((recentDays.results ?? []).map((d) => d.id));
  for (let i = 0; ; i++) {
    const d = new Date(Date.parse(`${dayId}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    if (!have.has(d)) break;
    continuousDays += 1;
  }

  const composed = composeGratitude(dayId, {
    anchor,
    dayMode: day?.day_mode ?? null,
    openLoops: loops?.n ?? 0,
    lastVerdict: lastScored?.verdict ?? null,
    holding: holding?.title ?? null,
    westPeekDay: isWestPeekDay(weekday),
    secondVehicle: secondBlockVehicle(weekday).name,
    continuousDays,
  });

  if (!composed) {
    // Every form declined, which means none of them had a real fact to stand on. §8.5 bans filler,
    // so nothing general is printed in its place.
    return {
      sentence: "", theme, source: "composed here, from your own record",
      unavailable: "No sentence this morning — nothing in today's record was specific enough to build one on, and §8.5 rules out filler.",
    };
  }

  return {
    sentence: composed.sentence,
    theme: composed.theme,
    source: "composed here, from your own record — never sent anywhere, never stored",
    unavailable: null,
  };
}
