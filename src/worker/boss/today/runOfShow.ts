import type { Env } from "../env";
import { ENGINE, secondBlockVehicle, isWestPeekDay } from "../spirit/arcs";

/**
 * HER RUN OF SHOW — §15.2, §15.5 and the §26 master template, which all name the same seven blocks.
 *
 * WHAT THIS REPLACED, AND WHY IT WAS WRONG. Today rendered a five-stage "Day Flow": Morning Gate,
 * Agenda Calculation, Today's Contract, Midday Reset, Night Gate. Every one of those is a stage of
 * THIS SYSTEM, and none is a part of her day. "0 of 5 stages complete" told her how far the
 * machinery had got, on a screen whose whole job is telling her how far SHE had got. Her contract
 * has always specified seven blocks and they were never built.
 *
 * THE GATES BECOME EVIDENCE RATHER THAN A SECOND LIST. Completing the Morning Gate closes Morning
 * Launch; the Midday Reset closes Midday Stabilizer; the Night Gate closes Evening Close and Night
 * Reset. She never ticks the same thing twice, and the blocks a gate cannot speak for — the two
 * wealth blocks and the food check — are hers to close, which is the honest split: the system knows
 * what it watched happen and does not claim to know the rest.
 *
 * §15.5's CONFLICT RULE IS THE REASON `instruction` IS A RENDERING. "If Run of Show conflicts with
 * Pillar Contracts, Pillar Contracts win." So a block's instruction is drawn from the contract and
 * is never a second place the day gets decided.
 */

export interface RunOfShowBlock {
  key: string;
  title: string;
  /** The master template's own bracket text, which says what belongs in the block. */
  intent: string;
  /** Which gate, if any, closes this block by being completed. */
  closedBy: "morning" | "midday" | "night" | null;
}

/** §15.2's order, which is also §26's. Seven, and the order is part of the specification. */
export const RUN_OF_SHOW: RunOfShowBlock[] = [
  { key: "morning_launch", title: "Morning Launch", intent: "Body and Spirit, then first setup.", closedBy: "morning" },
  { key: "first_wealth_block", title: "First Wealth Block", intent: "The first concrete brokerage or active wealth action.", closedBy: null },
  { key: "midday_stabilizer", title: "Midday Stabilizer", intent: "Hydration, food guardrail, and one re-centering move.", closedBy: "midday" },
  { key: "afternoon_wealth_admin", title: "Afternoon Wealth / Admin", intent: "The second concrete wealth or admin move.", closedBy: null },
  { key: "food_guardrail_check", title: "Food Guardrail Check", intent: "One safe lane.", closedBy: null },
  { key: "evening_close", title: "Evening Close", intent: "One carry-forward, one loop closed.", closedBy: "night" },
  { key: "night_reset", title: "Night Reset", intent: "Skincare, shutdown, bedtime protection.", closedBy: "night" },
];

export const RUN_OF_SHOW_KEYS = RUN_OF_SHOW.map((b) => b.key);

/**
 * Create the day's seven rows if they are not there.
 *
 * IDEMPOTENT AND ORDER-CARRYING. `position` is stored rather than derived at read time so a block
 * added or reordered later cannot silently resequence days already lived.
 */
export async function ensureRunOfShow(env: Env, dayId: string): Promise<void> {
  const stmts = RUN_OF_SHOW.map((b, i) =>
    env.DB
      .prepare(`INSERT OR IGNORE INTO run_of_show (day_id, block_key, position) VALUES (?,?,?)`)
      .bind(dayId, b.key, i),
  );
  await env.DB.batch(stmts);
}

/**
 * A gate closed, so the blocks it speaks for are closed.
 *
 * ONLY FORWARD, AND NEVER OVER HER. `done_at IS NULL` in the WHERE clause means a block she already
 * closed herself keeps her timestamp and her `done_source`, because "she did it at 9" and "a gate
 * implied it at 2" are different facts and the earlier, more specific one is the true one.
 */
export async function closeBlocksForGate(env: Env, dayId: string, gate: "morning" | "midday" | "night"): Promise<string[]> {
  const keys = RUN_OF_SHOW.filter((b) => b.closedBy === gate).map((b) => b.key);
  if (!keys.length) return [];
  const now = Date.now();
  await env.DB.batch(
    keys.map((k) =>
      env.DB
        .prepare(`UPDATE run_of_show SET done_at = ?, done_source = 'gate' WHERE day_id = ? AND block_key = ? AND done_at IS NULL`)
        .bind(now, dayId, k),
    ),
  );
  return keys;
}

export interface RenderedBlock extends RunOfShowBlock {
  position: number;
  instruction: string | null;
  done: boolean;
  done_at: number | null;
  done_source: string | null;
}

export async function readRunOfShow(
  env: Env, dayId: string, context: { dayMode?: string | null; anchor?: string | null } = {},
): Promise<RenderedBlock[]> {
  const derived = instructionsFor({
    weekday: new Date(`${dayId}T12:00:00Z`).getUTCDay(),
    dayMode: context.dayMode ?? null,
    anchor: context.anchor ?? null,
  });

  const rows = await env.DB
    .prepare(`SELECT block_key, position, instruction, done_at, done_source FROM run_of_show WHERE day_id = ? ORDER BY position`)
    .bind(dayId)
    .all<{ block_key: string; position: number; instruction: string | null; done_at: number | null; done_source: string | null }>();

  const stored = new Map((rows.results ?? []).map((r) => [r.block_key, r]));
  /*
   * THE SPEC IS THE SOURCE OF THE LIST, NOT THE TABLE. A day written before a block existed still
   * renders all seven, with the new one simply not done — rather than showing a short day and
   * letting her think she had six blocks that morning.
   */
  return RUN_OF_SHOW.map((b, i) => {
    const row = stored.get(b.key);
    return {
      ...b,
      position: row?.position ?? i,
      // The stored instruction wins if one was ever written; otherwise the day's derived one, which
      // is a real lane rather than a description of the shape of the work.
      instruction: row?.instruction ?? derived[b.key] ?? null,
      done: Boolean(row?.done_at),
      done_at: row?.done_at ?? null,
      done_source: row?.done_source ?? null,
    };
  });
}

// ─── What each block actually IS today ───────────────────────────────────────

/**
 * The day's instructions, derived from her arcs and vehicles rather than left blank.
 *
 * WHAT WAS WRONG BEFORE. Every block rendered its `intent` — "the first concrete brokerage or
 * active wealth action" — which describes the SHAPE of the work and names none of it. Her §15.4
 * requires each pillar contract to contain "exact actionable instructions", and §7 of the coach
 * manual is blunter: the whole promise is zero cognitive load. A block that tells her to do a
 * concrete wealth action is asking her to decide what that is, which is the decision the system
 * exists to have already made.
 *
 * NOTHING HERE INVENTS A TASK. It names the vehicle her own rules say owns this block today —
 * §5.3's right of first refusal, §5.4's Wednesday cadence, §5.5's weekend build order — and stops
 * there. What to DO inside a block is hers; which lane it belongs to is a rule she already wrote,
 * and having her re-derive it every morning is the cognitive load.
 */
export function instructionsFor(opts: {
  weekday: number;
  dayMode: string | null;
  anchor: string | null;
}): Record<string, string> {
  const second = secondBlockVehicle(opts.weekday);
  const reduced = opts.dayMode === "recovery" || opts.dayMode === "mvd";

  return {
    morning_launch: reduced
      ? "Body floor in bed, spirit floor, water and medicine. Nothing else has to happen before you start."
      : "Movement, the manifestation sequence, water and medicine. Then set up.",

    /*
     * §5.3, VERBATIM IN EFFECT: "Brokerage gets right of first refusal every day." It is not
     * weighed against the others — it is the answer unless it is blocked, and the sentence says so
     * rather than leaving her to remember which vehicle is protected.
     */
    first_wealth_block: `${ENGINE.name}. ${ENGINE.note}`,

    midday_stabilizer: "Water, the food guardrail, and one thing that puts you back in the chair.",

    afternoon_wealth_admin: isWestPeekDay(opts.weekday)
      ? "West Peek Ventures — this is the Wednesday cadence with Scooter."
      : `${second.name}.${second.note ? ` ${second.note}` : ""}`,

    // §7's food arc is one of the two active pushes, so this block is not housekeeping.
    food_guardrail_check: "One safe keto lane. This is the weight-loss arc, not an afterthought.",

    evening_close: opts.anchor
      ? `Log the verdict, carry one thing forward, and set tomorrow's first money move. Today was: ${opts.anchor}`
      : "Log the verdict, carry one thing forward, and set tomorrow's first money move.",

    /*
     * MORE THAN THE BLOCK TITLE. This returned the block's own `intent` verbatim, which is a
     * sentence describing the block rather than an instruction for tonight — and a test caught it
     * by asserting no instruction may simply restate its intent. Tomorrow's first move is already
     * decided by §5.3, so saying so is the difference between shutting down and lying awake
     * planning.
     */
    night_reset: "Skincare, shutdown, phone down. Tomorrow's first money move is already decided — you do not have to work it out tonight.",
  };
}
