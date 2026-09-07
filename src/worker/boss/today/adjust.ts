import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";

/**
 * WHEN SOMETHING COMES UP.
 *
 * Her requirement, in her words: the system decides her priorities each day and lets her "make last
 * min or emergency adjustments or inputs if something comes up".
 *
 * ─── Why this is not just re-running the Morning Gate ───────────────────────
 *
 * Re-running it would recompute the whole day and overwrite the contract, and that quietly destroys
 * the two things the record is FOR. First, the morning contract is what the Night Gate scores
 * against — a day that rewrites its own contract at 3pm always meets it, and the verdict becomes
 * meaningless. Second, it would erase the fact that the day changed at all, and a week where three
 * days got hijacked is a pattern she should be able to see rather than a set of days that each look
 * fine.
 *
 * So an adjustment is APPENDED. The original stands, the interruption is named, and both are true.
 *
 * ─── An emergency is not a failure ──────────────────────────────────────────
 *
 * Core Law 3 is "yesterday is closed; the system moves forward only", and §17.2's Recovery Mode
 * exists because bad days are expected rather than exceptional. A system that treats an interrupted
 * day as a broken one teaches her to stop telling it the truth, which is the one thing that makes
 * every other number worthless.
 */

export type AdjustmentKind = "emergency" | "reprioritise" | "added" | "dropped";

export interface Adjustment {
  id: string;
  kind: AdjustmentKind;
  what: string;
  /** What it displaces, when it displaces something. Null when it is simply added. */
  instead_of: string | null;
  at: number;
}

/**
 * Record one change to today, and return the day's priorities as they now stand.
 *
 * THE ANCHOR IS DEFENDED, NOT FROZEN. Displacing the first money move is allowed — some days a real
 * emergency outranks it — but it is recorded as displacing the anchor specifically, because §5.3
 * gives the engine right of first refusal and a week of anchors quietly dropped is the single most
 * useful thing this table could ever tell her.
 */
export async function adjustToday(
  env: Env,
  dayId: string,
  input: { kind: AdjustmentKind; what: string; instead_of?: string | null },
): Promise<{ adjustments: Adjustment[]; priorities: string[]; anchor_displaced: boolean }> {
  const day = await env.DB
    .prepare(`SELECT id, morning_contract, adjustments FROM days WHERE id = ?`)
    .bind(dayId)
    .first<{ id: string; morning_contract: string | null; adjustments: string | null }>();
  if (!day) throw new Error(`No day ${dayId}`);

  let contract: { priorities?: string[]; commitment?: string | null } = {};
  try { contract = day.morning_contract ? JSON.parse(day.morning_contract) : {}; } catch { contract = {}; }

  let existing: Adjustment[] = [];
  try { existing = day.adjustments ? (JSON.parse(day.adjustments) as Adjustment[]) : []; } catch { existing = []; }

  const entry: Adjustment = {
    id: newId("adj"),
    kind: input.kind,
    what: input.what,
    instead_of: input.instead_of ?? null,
    at: Date.now(),
  };
  const adjustments = [...existing, entry];

  /*
   * THE LIVE LIST IS DERIVED FROM BOTH, never stored as a third thing. One list that is the truth
   * and one journal that explains it — a stored "current priorities" column would be a copy that
   * can disagree with the two records it came from.
   */
  const base = Array.isArray(contract.priorities) ? [...contract.priorities] : [];
  let priorities = base;
  for (const a of adjustments) {
    if (a.kind === "dropped") priorities = priorities.filter((p) => p !== a.what);
    else if (a.instead_of) priorities = priorities.map((p) => (p === a.instead_of ? a.what : p));
    else if (a.kind === "emergency") priorities = [a.what, ...priorities];
    else priorities = [...priorities, a.what];
  }

  const anchor = contract.commitment ?? null;
  const anchorDisplaced = adjustments.some((a) => a.instead_of !== null && a.instead_of === anchor);

  await env.DB
    .prepare(`UPDATE days SET adjustments = ? WHERE id = ?`)
    .bind(JSON.stringify(adjustments), dayId)
    .run();

  await audit(env.DB, {
    actor: "boss", lane: "ops", entityType: "day", entityId: dayId,
    action: "day_adjusted",
    detail: { kind: input.kind, what: input.what, instead_of: input.instead_of ?? null, anchor_displaced: anchorDisplaced },
  });

  return { adjustments, priorities, anchor_displaced: anchorDisplaced };
}
