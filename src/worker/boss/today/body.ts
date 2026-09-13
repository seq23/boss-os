import type { Env } from "../env";
import { newId } from "../lib/id";

/**
 * THE BODY CONTRACT — §6.9's stored sequence, §6.10's somatic lane, and the Somatic brain's novelty
 * engine.
 *
 * §6.11 states the whole requirement in one line: "The Body pillar should render as a designed daily
 * contract, NOT SCATTERED REMINDERS." That is the difference between this and a checklist.
 *
 * TWO HARD RULES FROM HER OWN DOCUMENTS, BOTH ENFORCED IN CODE RATHER THAN ASKED FOR IN A PROMPT:
 *
 *   BED FIRST (§6.8, and the Somatic brain's §2). "Minimum Viable means the entire fallback sequence
 *   must be completable WITHOUT GETTING OUT OF BED. No standing, walking pad, outdoor walking, or
 *   out-of-bed exercise may appear in the minimum-viable fallback." Every movement in this file is
 *   bed-based, so the fallback cannot acquire a standing move by accident.
 *
 *   NOVELTY (Somatic brain §10). "Do NOT generate essentially the same routine every morning. Track
 *   recent movement selections whenever history is available. Avoid using the exact same major
 *   movement on consecutive days." A novelty engine with no memory is a random number generator, so
 *   selection reads `movement_log` and picks the LEAST RECENTLY USED movement in each lane. It is
 *   deterministic, which means it also never needs a model — and cannot repeat by chance.
 */

/** §6.9. "Print this exactly, in order." It is not paraphrased, reordered, or trimmed. */
export const STORED_MORNING_SEQUENCE = [
  "10 in-bed leg raises per side",
  "10 seated knee-to-chest pulls per side",
  "10 seated torso twists per side",
  "30 seconds shoulder rolls",
  "30 seconds deep breathing",
];

/** The Somatic brain's rotation lanes, with its own movement names. */
export const MOVEMENT_LANES: { key: string; title: string; movements: string[] }[] = [
  {
    key: "neck",
    title: "Nervous-system + neck regulation",
    movements: ["eye-led head turn", "tiny chin nod", "gentle humming", "neck isometric → release", "shoulder shrug → melt"],
  },
  {
    key: "pelvis_lumbar",
    title: "Pelvis / lower back",
    movements: ["pelvic wave", "pelvic clock", "diagonal glide", "side shift", "knee sway", "heel reach", "heel drag", "leg glide", "contract-release"],
  },
  {
    key: "hips",
    title: "Hips",
    movements: ["figure-4", "knee opener", "hip circles", "hip spirals", "butterfly", "single-knee rotation", "supported half-happy-baby"],
  },
  {
    key: "pilates",
    title: "Bed Pilates / stability",
    movements: ["mini bridge", "heel slide", "low march", "foot hover", "toe tap", "hand-to-thigh press", "arm press", "side leg lift", "side leg sweep", "clam variation"],
  },
  {
    key: "upper_body",
    title: "Upper body",
    movements: ["arm arc", "rib reach", "diagonal reach", "shoulder press", "shoulder shrug/release", "open-book reach"],
  },
];

/** The brain's §18. Carried as content, so it appears on the screen rather than in a comment. */
export const SAFETY_STOP =
  "Sharp pain, worsening pain, numbness, tingling, dizziness, breathing difficulty, faintness or distress — " +
  "stop the sequence and do not push through. Seek professional guidance if it persists.";

/**
 * §6.10's language rule, kept beside the sequence it governs.
 *
 * Her document is explicit about what this lane may NOT claim, and the constraint belongs where the
 * text is generated rather than in a policy file nobody reads while writing copy.
 */
export const LANGUAGE_RULE =
  "Supports mobility, decompression, body awareness, downshifting and regulation. " +
  "It does not cure trauma, heal the vagus nerve, treat cortisol, or replace medical, physiotherapy or mental-health care.";

export interface SomaticSelection {
  lane: string;
  title: string;
  movement: string;
  /** Why this one — the novelty engine saying its reasoning out loud. */
  because: string;
}

/**
 * Pick today's somatic sequence: one movement per lane, least recently used first.
 *
 * WHY LEAST-RECENTLY-USED AND NOT RANDOM. Random repeats — over five lanes and a week, it would land
 * on yesterday's movement often enough that she would notice, and "avoid the exact same major
 * movement on consecutive days" would be true only on average. LRU makes the rule literal: the
 * movement done most recently is the last one that can come up again.
 */
export async function selectSomatic(env: Env, dayId: string): Promise<SomaticSelection[]> {
  const history = await env.DB
    .prepare(`SELECT lane, movement, MAX(chosen_at) AS last FROM movement_log GROUP BY lane, movement`)
    .all<{ lane: string; movement: string; last: number }>();

  const lastUsed = new Map((history.results ?? []).map((r) => [`${r.lane}::${r.movement}`, r.last]));

  return MOVEMENT_LANES.map((lane) => {
    const ranked = lane.movements
      .map((m) => ({ m, last: lastUsed.get(`${lane.key}::${m}`) ?? 0 }))
      // Never used sorts first (0), then oldest. The name breaks ties so the choice is reproducible.
      .sort((a, b) => a.last - b.last || a.m.localeCompare(b.m));
    // Every lane in MOVEMENT_LANES is non-empty, so this is a type narrowing rather than a real case
    // — but a lane emptied by a future edit should fail loudly here, not select `undefined`.
    const chosen = ranked[0];
    if (!chosen) throw new Error(`The ${lane.key} movement lane is empty, so no somatic sequence can be built`);
    return {
      lane: lane.key,
      title: lane.title,
      movement: chosen.m,
      because: chosen.last === 0 ? "Not done before." : `Last done ${new Date(chosen.last).toISOString().slice(0, 10)}.`,
    };
  });
}

/**
 * Record what was selected, so tomorrow's rotation knows.
 *
 * WRITTEN ONCE PER DAY. Re-rendering Today must not re-log the same selection five times and skew
 * the history it is about to read — the delete makes the write idempotent for the day.
 */
export async function logSomatic(env: Env, dayId: string, selection: SomaticSelection[]): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM movement_log WHERE day_id = ?`).bind(dayId),
    ...selection.map((s) =>
      env.DB
        .prepare(`INSERT INTO movement_log (id, day_id, lane, movement, chosen_at) VALUES (?,?,?,?,?)`)
        .bind(newId("mv"), dayId, s.lane, s.movement, now),
    ),
  ]);
}

export interface BodyContract {
  launch_sequence: string[];
  somatic: SomaticSelection[];
  hydration: string;
  medication: string;
  food_rule: string;
  movement_floor: string;
  minimum_viable: string[];
  safety_stop: string;
  language_rule: string;
  bed_only: boolean;
}

/**
 * The day's Body contract.
 *
 * `bed_only` is TRUE on a recovery or minimum-viable day, and that is §6.8 and §17.2 meeting: the
 * fallback must be completable without getting out of bed, and Recovery Mode preserves the Body
 * floor rather than dropping it. Nothing standing appears here in either case, because nothing
 * standing exists in this file at all.
 */
export async function buildBodyContract(env: Env, dayId: string, dayMode: string | null): Promise<BodyContract> {
  const somatic = await selectSomatic(env, dayId);
  const reduced = dayMode === "recovery" || dayMode === "mvd";

  return {
    launch_sequence: STORED_MORNING_SEQUENCE,
    // A reduced day keeps regulation and the lower back, which are the two the brain leads with.
    somatic: reduced ? somatic.filter((s) => s.lane === "neck" || s.lane === "pelvis_lumbar") : somatic,
    hydration: "One full Stanley cup minimum, two is the target — about 80 oz.",
    medication: "Water and BP medicine in the first hour.",
    food_rule: "Strict keto. No sugar, no off-lane takeout. Safe keto takeout lanes are allowed.",
    /*
     * THE FLOOR IS WORDED FOR THE DAY, and this is where §6.8 is actually enforced.
     *
     * The general wording lists §6.7's lanes, two of which require getting up. Printing it on a
     * recovery day would put "walking pad" inside the minimum-viable fallback, which her document
     * forbids in those words — and it would do it in the copy rather than in a movement, which is
     * exactly how the rule gets broken without anyone editing a sequence. Caught by the bed-only
     * test, which checks the whole contract rather than only the fallback list.
     */
    movement_floor: reduced
      ? "10 minutes minimum, all of it in bed. Nothing here needs you to stand up."
      : "10 minutes minimum. Outside walk, walking pad, bed yoga or somatic all count.",
    /*
     * THE FALLBACK IS THE SAME FIVE MOVEMENTS AS THE LAUNCH SEQUENCE, AND THAT IS DELIBERATE.
     *
     * It reads like a copy-paste accident, so it is written down here rather than left to be
     * rediscovered. §6.9's stored sequence is entirely bed-based — leg raises, knee-to-chest pulls,
     * torso twists, shoulder rolls, breathing — and §6.8 requires the minimum-viable fallback to be
     * completable WITHOUT GETTING OUT OF BED. The launch sequence already clears that bar, so on the
     * worst day there is nothing to cut: the fallback IS the sequence, and inventing a shorter
     * second list would be inventing content her documents do not contain.
     *
     * The screen does not print the five twice. `BodyContract.tsx` DERIVES the identity and says it
     * in one line, and prints the fallback as its own list should the two ever diverge.
     */
    minimum_viable: STORED_MORNING_SEQUENCE,
    safety_stop: SAFETY_STOP,
    language_rule: LANGUAGE_RULE,
    bed_only: reduced,
  };
}
