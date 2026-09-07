import type { Env } from "../env";
import { assertMayReachExternalModel } from "../policy/airlock";

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

export interface GratitudeResult {
  sentence: string;
  theme: string;
  model: string | null;
  /** Present instead of a sentence when one could not be produced. Never a fallback platitude. */
  unavailable: string | null;
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
export async function gratitudeFor(env: Env, dayId: string): Promise<GratitudeResult> {
  const theme = themeFor(dayId);

  /*
   * THE AIRLOCK IS ASKED, AND IT REFUSES — WHICH IS THE CORRECT ANSWER, NOT A BUG.
   *
   * `spirit` is a sovereign subsystem: LOCAL_ONLY on both axes, meaning spirit material may not be
   * stored in the cloud domain and may not be reasoned about by any cloud model. A gratitude
   * sentence drawn from her real life is spirit material, so Workers AI writing it is precisely
   * what that classification forbids.
   *
   * THE OWNER ASKED FOR BOTH THINGS. "The gratitude sentence is given to me by the LLM daily" and
   * "spirit is sovereign" cannot both hold, and choosing between them is not an implementation's
   * decision to make — least of all silently, in the direction that happens to ship the feature.
   *
   * SO THE MACHINERY IS BUILT AND WAITING. The prompt, the theme rotation and the 90-day no-repeat
   * check above are all real and tested; the moment she says the word, or the local runtime exists,
   * this is a call away. What it will not do is quietly loosen her own rule to reach a sentence.
   */
  const verdict = await assertMayReachExternalModel(env.DB, "gratitude_sentences", null, false)
    .then(() => null)
    .catch((err: unknown) => (err instanceof Error ? err.message : "the airlock refused"));

  if (verdict !== null) {
    return {
      sentence: "",
      theme,
      model: null,
      unavailable:
        "No sentence this morning, and nothing generic in its place — §8.5 rules out filler, and a " +
        "stock line dressed as today's gratitude would be indistinguishable from a real one.\n\n" +
        "The reason is a rule of yours, not a failure: Spirit is classified sovereign — local-only " +
        "storage AND local-only reasoning — so no cloud model may write a sentence drawn from your " +
        "life. You also asked for the LLM to write it daily. Both cannot hold.\n\n" +
        "Two ways forward, and both are yours: say plainly that the daily gratitude sentence may be " +
        "written by a cloud model, and it starts tomorrow; or the local runtime writes it and " +
        "nothing changes about the rule. Everything else is built and waiting.",
    };
  }

  /*
   * REACHED ONLY IF THE CLASSIFICATION CHANGES, and it says what is still missing rather than
   * querying a table that does not exist.
   *
   * The first version of this read from `gratitude_sentences` — which has no table, because the
   * whole point of the stop is that nothing is written down while the question is open. The SQL
   * validator caught it, correctly: a query against a table the migrations do not build is broken
   * code no matter which branch reaches it.
   *
   * The migration that loosens the rule is the same one that creates the table, so both halves of
   * her decision land together and neither can arrive without the other.
   */
  return {
    sentence: "",
    theme,
    model: null,
    unavailable:
      "Spirit is cloud-eligible now, but the sentence has nowhere to be kept: the migration that " +
      "changes the classification is the one that creates the table, so the 90-day no-repeat rule " +
      "has no history to check against yet.",
  };
}
