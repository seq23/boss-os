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
  /** When she marked this lane done today, or null. The only record of DOING that exists. */
  done_at: number | null;
}

const on = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * WHY THIS MOVEMENT, IN A SENTENCE THAT IS TRUE.
 *
 * ─── The defect this replaces, in the payload she was shown ────────────────
 *
 *     neck          "tiny chin nod"    because: "Not done before."
 *     pelvis_lumbar "knee sway"        because: "Not done before."
 *     hips          "knee opener"      because: "Not done before."
 *     pilates       "heel slide"       because: "Not done before."
 *     upper_body    "shoulder press"   because: "Not done before."
 *
 * Five lanes, one sentence, five times — and the sentence was a CLAIM THE DATABASE COULD NOT
 * SUPPORT. `movement_log` records which movement was CHOSEN on which day; its own data-policy row
 * says so in those words. Nothing in this system has ever recorded that she DID one. So
 * `chosen.last === 0` means "never chosen", and the code printed "Not done before." — telling her
 * something about her own body that it had no way to know.
 *
 * It would also have stayed true for weeks by construction: LRU picks an unchosen movement first,
 * and the lanes hold five to ten each, so every morning's five would be "never chosen" until a lane
 * ran out. A true report of a broken completion path, repeated until it read as a bug.
 *
 * ─── THREE SENTENCES, EACH FOR A STATE THE RECORD CAN ACTUALLY DISTINGUISH ──
 *
 *   done      — she marked this lane done on a day. The only thing here that is about her.
 *   chosen    — it came up before and nothing was recorded. Says exactly that, and does not imply
 *               she skipped it: an unmarked day is unknown, not a failure. No guilt, per §44's tone
 *               and the standing rule across this repository.
 *   new       — it has not come up yet. "New to the rotation" is a fact about the rotation.
 */
export function becauseFor(lastDone: number, lastChosen: number): string {
  if (lastDone > 0) return `Last done ${on(lastDone)}.`;
  if (lastChosen > 0) return `Came up ${on(lastChosen)}; nothing was recorded either way.`;
  return "New to the rotation.";
}

/**
 * Pick today's somatic sequence: one movement per lane, least recently DONE first.
 *
 * WHY LEAST-RECENTLY-USED AND NOT RANDOM. Random repeats — over five lanes and a week, it would land
 * on yesterday's movement often enough that she would notice, and "avoid the exact same major
 * movement on consecutive days" would be true only on average. LRU makes the rule literal.
 *
 * DONE OUTRANKS CHOSEN, and that is the Somatic brain's rule read properly. Its §10 says "avoid
 * using the exact same major movement on consecutive days" — about the movement she DID, not the
 * one a screen offered her and she never got to. Ranking still falls back to when a movement was
 * last chosen, so novelty works exactly as before on a record with no completions in it yet.
 */
export async function selectSomatic(env: Env, dayId: string): Promise<SomaticSelection[]> {
  const history = await env.DB
    .prepare(
      `SELECT lane, movement, MAX(chosen_at) AS last_chosen, COALESCE(MAX(done_at), 0) AS last_done
         FROM movement_log GROUP BY lane, movement`,
    )
    .all<{ lane: string; movement: string; last_chosen: number; last_done: number }>();

  const seen = new Map((history.results ?? []).map((r) => [`${r.lane}::${r.movement}`, r]));

  return MOVEMENT_LANES.map((lane) => {
    const ranked = lane.movements
      .map((m) => {
        const row = seen.get(`${lane.key}::${m}`);
        return { m, lastDone: row?.last_done ?? 0, lastChosen: row?.last_chosen ?? 0 };
      })
      /*
       * Never DONE sorts first, then oldest done. Among movements never done, the one least
       * recently offered comes up — so a lane still cycles rather than jamming on one name while
       * nothing is being marked. The movement name breaks ties so the choice is reproducible.
       */
      .sort((a, b) => a.lastDone - b.lastDone || a.lastChosen - b.lastChosen || a.m.localeCompare(b.m));
    // Every lane in MOVEMENT_LANES is non-empty, so this is a type narrowing rather than a real case
    // — but a lane emptied by a future edit should fail loudly here, not select `undefined`.
    const chosen = ranked[0];
    if (!chosen) throw new Error(`The ${lane.key} movement lane is empty, so no somatic sequence can be built`);
    return {
      lane: lane.key,
      title: lane.title,
      movement: chosen.m,
      because: becauseFor(chosen.lastDone, chosen.lastChosen),
      done_at: null,
    };
  });
}

/**
 * TODAY'S ROTATION IS DECIDED ONCE, AND THEN IT IS TODAY'S ROTATION.
 *
 * ─── A second defect, found while fixing the first ─────────────────────────
 *
 * `logSomatic` was called on every read of `/spirit/day`, and it DELETED the day's rows and wrote
 * the new choice with a fresh `chosen_at`. So the movement it had just logged became the most
 * recently used one — and the very next read ranked it LAST and picked something else, rewriting
 * the day again. Measured against production within ten minutes:
 *
 *     first read   hips=hip circles  neck=neck isometric  pelvis=heel drag  …
 *     later read   hips=knee opener  neck=tiny chin nod   pelvis=knee sway  …
 *
 * Today and Spirit disagreed about what today's sequence was, and both changed under her while she
 * read them. A contract she cannot finish because it is a different contract each time she looks.
 *
 * So: the day's rows are the day's answer. If they exist, they are returned — carrying whether she
 * marked them done — and nothing is re-selected. A day with no rows selects once and writes once.
 */
export async function todaysSomatic(env: Env, dayId: string): Promise<SomaticSelection[]> {
  const existing = await env.DB
    .prepare(`SELECT lane, movement, chosen_at, done_at FROM movement_log WHERE day_id = ?`)
    .bind(dayId)
    .all<{ lane: string; movement: string; chosen_at: number; done_at: number | null }>();

  const rows = existing.results ?? [];
  if (rows.length === 0) return selectSomatic(env, dayId);

  /*
   * THE REASON IS RE-DERIVED FROM HISTORY BEFORE TODAY, not from the row itself. A movement chosen
   * today has a `chosen_at` of today, and reading it back would make every line say "Came up today",
   * which is both useless and circular.
   */
  const history = await env.DB
    .prepare(
      `SELECT lane, movement, MAX(chosen_at) AS last_chosen, COALESCE(MAX(done_at), 0) AS last_done
         FROM movement_log WHERE day_id < ? GROUP BY lane, movement`,
    )
    .bind(dayId)
    .all<{ lane: string; movement: string; last_chosen: number; last_done: number }>();
  const before = new Map((history.results ?? []).map((r) => [`${r.lane}::${r.movement}`, r]));

  const byLane = new Map(rows.map((r) => [r.lane, r]));
  return MOVEMENT_LANES.flatMap((lane) => {
    const row = byLane.get(lane.key);
    if (!row) return [];
    const prior = before.get(`${lane.key}::${row.movement}`);
    return [{
      lane: lane.key,
      title: lane.title,
      movement: row.movement,
      because: row.done_at
        ? "Done today."
        : becauseFor(prior?.last_done ?? 0, prior?.last_chosen ?? 0),
      done_at: row.done_at,
    }];
  });
}

/**
 * Record what was selected, so tomorrow's rotation knows.
 *
 * INSERT-IF-ABSENT, NEVER DELETE-AND-REWRITE. The delete was what made the day's rotation churn on
 * every read, and it would now also throw away the one thing in this table that is about HER — a
 * `done_at` she had already set. A day that already has rows keeps them.
 */
export async function logSomatic(env: Env, dayId: string, selection: SomaticSelection[]): Promise<void> {
  const now = Date.now();
  const existing = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM movement_log WHERE day_id = ?`).bind(dayId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return;

  await env.DB.batch(
    selection.map((s) =>
      env.DB
        .prepare(`INSERT INTO movement_log (id, day_id, lane, movement, chosen_at) VALUES (?,?,?,?,?)`)
        .bind(newId("mv"), dayId, s.lane, s.movement, now),
    ),
  );
}

/**
 * SHE DID IT. The write that did not exist, and whose absence made every reason line a guess.
 *
 * ONE MARK FOR THE ROTATION, NOT FIVE. Five ticks at 7am is five chances to decide this screen is
 * work. The sequence is one sequence and it is marked as one.
 *
 * IT UNDOES. A mis-tap that cannot be taken back teaches her not to touch the control at all, and
 * this is the only record of her own practice in the system.
 *
 * NO COUNT, NO STREAK, NO PROGRESS. The standing rule against guilt binds here as it does on the
 * contribution practice: this exists so the rotation can vary honestly, not so she can fail at it.
 */
export async function markSomaticDone(
  env: Env,
  dayId: string,
  done: boolean,
  now = Date.now(),
): Promise<{ lanes: number; done: boolean }> {
  const res = await env.DB
    .prepare(`UPDATE movement_log SET done_at = ? WHERE day_id = ?`)
    .bind(done ? now : null, dayId)
    .run();
  return { lanes: res.meta.changes ?? 0, done };
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
  /*
   * `todaysSomatic`, NOT `selectSomatic`. The day's rotation is decided once and then read back, so
   * Today and Spirit agree and neither changes under her between two looks at the same morning.
   */
  const somatic = await todaysSomatic(env, dayId);
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
