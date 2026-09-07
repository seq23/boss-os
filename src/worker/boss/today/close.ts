import type { Env } from "../env";

/**
 * DID THE DAY'S ANCHOR ACTUALLY HAPPEN, AND HOW OFTEN DOES IT NOT?
 *
 * The Morning Gate proposes a first money move every day. Until now nothing ever asked whether it
 * got done. A system in that state proposes the same thing for a fortnight, watches it go undone
 * every time, and keeps proposing it with complete confidence — the agenda stops describing her
 * life and starts describing its own intentions, which is worse than having no agenda because it
 * still looks like one.
 *
 * ─── The value is in the sequence, not the day ─────────────────────────────
 *
 * One missed anchor is a Tuesday, and treating it as a failure is how a system teaches someone to
 * stop being honest with it. Four missed in five days is a fact about her life that she asked this
 * thing to notice on her behalf. So nothing here scolds and nothing here scores a single day —
 * it counts, and it only speaks when a run is long enough to mean something.
 *
 * ─── Nothing is inferred ───────────────────────────────────────────────────
 *
 * §14.2: "Ask what was completed before assigning a verdict. DO NOT GUESS COMPLETION." A closed Run
 * of Show block is not evidence the touch happened. An unanswered day is `unknown` and stays
 * unknown — it is not quietly counted as a miss, because a night she was too tired to close the
 * gate is not the same as a day she skipped the work, and conflating them would make the streak
 * mean nothing.
 */

export type AnchorOutcome = "done" | "missed" | "unknown";

export interface AnchorStreak {
  /** Days examined, most recent first, excluding today. */
  examined: number;
  done: number;
  missed: number;
  unknown: number;
  /** Consecutive misses ending at the most recent ANSWERED day. */
  consecutive_missed: number;
  /** Said only when the run is long enough to be a pattern rather than a bad week. */
  warning: string | null;
}

/** Below this, a run of misses is a bad week and the system says nothing. */
const PATTERN_FLOOR = 3;

export async function anchorStreak(env: Env, beforeDayId: string, window = 10): Promise<AnchorStreak> {
  const rows = await env.DB
    .prepare(
      `SELECT id, anchor_outcome
         FROM days
        WHERE id < ? AND morning_completed_at IS NOT NULL
        ORDER BY id DESC
        LIMIT ?`,
    )
    .bind(beforeDayId, window)
    .all<{ id: string; anchor_outcome: string | null }>();

  const days = rows.results ?? [];
  let done = 0;
  let missed = 0;
  let unknown = 0;
  for (const d of days) {
    if (d.anchor_outcome === "done") done++;
    else if (d.anchor_outcome === "missed") missed++;
    else unknown++;
  }

  /*
   * UNANSWERED DAYS DO NOT BREAK THE RUN, AND THEY DO NOT EXTEND IT EITHER.
   *
   * If a silent day broke the streak, closing the gate late would erase a real pattern. If it
   * extended it, a fortnight of not closing the gate would look like a fortnight of missed work.
   * Skipping them counts what is actually known.
   */
  let consecutive = 0;
  for (const d of days) {
    if (d.anchor_outcome === "missed") consecutive++;
    else if (d.anchor_outcome === "done") break;
  }

  const warning =
    consecutive >= PATTERN_FLOOR
      ? `The first money move has not happened ${consecutive} days running. That is the engine, and it is the one thing §5.3 protects — either the day is wrong or the move is.`
      : null;

  return { examined: days.length, done, missed, unknown, consecutive_missed: consecutive, warning };
}

/**
 * Deals that have not moved stage, which is the third symptom and the only one nothing measured.
 *
 * AGE IN STAGE, NOT AGE OF EDIT. `updated_at` moves when anything at all changes, so adding a note
 * to a dying deal made it look freshly worked — the exact record you would touch while worrying
 * about it. `stage_since` moves only when the stage does, which is the difference between "I
 * thought about this" and "this advanced".
 *
 * THRESHOLDS ARE PER STAGE because they mean different things. A week in `screening` is normal; a
 * week between a committed deal and a closed one is a problem. Closed, passed and dead are finished
 * and are never stale.
 */
export const STAGE_STALE_DAYS: Record<string, number> = {
  sourced: 21,
  screening: 14,
  diligence: 14,
  committed: 7,
};

export interface StalledDeal {
  id: string;
  name: string;
  stage: string;
  days_in_stage: number;
  threshold: number;
  next_step: string | null;
  overdue_next_step: boolean;
}

export async function stalledDeals(env: Env, now = Date.now()): Promise<StalledDeal[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, name, stage, stage_since, opened_at, next_step, next_step_due_at
         FROM deals
        WHERE stage NOT IN ('closed', 'passed', 'dead')
        ORDER BY COALESCE(stage_since, opened_at) ASC`,
    )
    .all<{ id: string; name: string; stage: string; stage_since: number | null; opened_at: number; next_step: string | null; next_step_due_at: number | null }>();

  const out: StalledDeal[] = [];
  for (const d of rows.results ?? []) {
    const threshold = STAGE_STALE_DAYS[d.stage];
    // A stage with no threshold is one nobody decided about. Alarming on it would be inventing a
    // rule; ignoring it silently would hide a deal. It is skipped and the stage list is the fix.
    if (!threshold) continue;

    const since = d.stage_since ?? d.opened_at;
    const days = Math.floor((now - since) / 86_400_000);
    if (days < threshold) continue;

    out.push({
      id: d.id,
      name: d.name,
      stage: d.stage,
      days_in_stage: days,
      threshold,
      next_step: d.next_step,
      overdue_next_step: Boolean(d.next_step_due_at && d.next_step_due_at < now),
    });
  }

  // Most overdue relative to its own stage first — a committed deal at 10 days outranks a sourced
  // one at 25, because the thresholds are what make those numbers comparable at all.
  return out.sort((a, b) => b.days_in_stage / b.threshold - a.days_in_stage / a.threshold);
}
