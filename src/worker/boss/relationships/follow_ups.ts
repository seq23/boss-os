/**
 * Follow-ups, and how they reach the screen.
 *
 * A commitment with a date on it is worth nothing until the day it is due puts
 * it in front of the Boss. Canon §40 says overdue follow-ups surface into open
 * loops and Today; this is where that happens.
 *
 * This module deliberately knows nothing about `routes/today.ts`. It takes a
 * day that already exists and writes onto it, which keeps the dependency
 * pointing one way: Today imports follow-ups, never the reverse.
 */

import { newId } from "../lib/id";
import { rescoreRelationship } from "./scoring";

const DAY_MS = 86_400_000;

/** Late by more than this, or owed to someone strategically central, is a high-priority loop. */
const URGENT_LATENESS_MS = 7 * DAY_MS;
const URGENT_IMPORTANCE = 70;

interface DueRow {
  id: string;
  person_id: string;
  relationship_id: string | null;
  meeting_id: string | null;
  owner: string;
  title: string;
  due_at: number;
  full_name: string | null;
  strategic_importance: number | null;
}

/**
 * Puts every follow-up that is due, and not already on the board, onto `dayIdValue`.
 *
 * `loop_id` is the idempotence key: a follow-up is surfaced once, and after that
 * the open-loop carry-forward rules already keep it visible until it is closed.
 * The day row must already exist — the caller owns that.
 */
export async function surfaceOverdueFollowUps(
  db: D1Database,
  dayIdValue: string,
  dueBy: number,
  now = Date.now(),
): Promise<{ surfaced: number; follow_up_ids: string[] }> {
  const due = await db
    .prepare(
      `SELECT f.id, f.person_id, f.relationship_id, f.meeting_id, f.owner, f.title, f.due_at,
              p.full_name, r.strategic_importance
         FROM follow_ups f
         JOIN people p ON p.id = f.person_id
    LEFT JOIN relationships r ON r.id = f.relationship_id
        WHERE f.status = 'open' AND f.loop_id IS NULL AND f.due_at <= ?
        ORDER BY f.due_at ASC
        LIMIT 200`,
    )
    .bind(dueBy)
    .all<DueRow>();

  const rows = due.results ?? [];
  if (rows.length === 0) return { surfaced: 0, follow_up_ids: [] };

  const statements = [];
  for (const f of rows) {
    const loopId = newId("loop");
    const late = dueBy - f.due_at;
    const priority =
      late > URGENT_LATENESS_MS || (f.strategic_importance ?? 0) >= URGENT_IMPORTANCE ? 1 : 2;

    statements.push(
      db
        .prepare(
          `INSERT INTO open_loops (id, day_id, kind, title, detail, source_type, source_id, priority, status, created_at, updated_at)
           VALUES (?,?,'follow_up',?,?,'relationship',?,?,'open',?,?)`,
        )
        .bind(
          loopId,
          dayIdValue,
          `${f.title} — ${f.full_name ?? "someone"}`,
          JSON.stringify({
            follow_up_id: f.id,
            owner: f.owner,
            owed_by: f.owner === "boss" ? "you" : f.full_name,
            due_at: f.due_at,
            person_id: f.person_id,
            meeting_id: f.meeting_id,
            days_late: Math.max(0, Math.floor(late / DAY_MS)),
          }),
          f.id,
          priority,
          now,
          now,
        ),
      db
        .prepare(`UPDATE follow_ups SET loop_id = ?, surfaced_at = ?, updated_at = ? WHERE id = ? AND loop_id IS NULL`)
        .bind(loopId, now, now, f.id),
    );
  }

  await db.batch(statements);
  return { surfaced: rows.length, follow_up_ids: rows.map((f) => f.id) };
}

/**
 * Keeps the follow-up and the open loop that represents it in step.
 *
 * Resolving the loop keeps the commitment; dismissing it drops the commitment,
 * which costs relationship health rather than disappearing quietly. Deferring
 * re-points the follow-up at tomorrow's loop, because the commitment is still
 * open and must not become invisible.
 */
export async function applyLoopActionToFollowUp(
  db: D1Database,
  followUpId: string,
  action: "resolve" | "dismiss" | "defer",
  carriedLoopId: string | null,
  now = Date.now(),
): Promise<void> {
  const followUp = await db
    .prepare(`SELECT id, relationship_id, status FROM follow_ups WHERE id = ?`)
    .bind(followUpId)
    .first<{ id: string; relationship_id: string | null; status: string }>();
  if (!followUp || followUp.status !== "open") return;

  if (action === "defer") {
    await db
      .prepare(`UPDATE follow_ups SET loop_id = ?, updated_at = ? WHERE id = ?`)
      .bind(carriedLoopId, now, followUpId)
      .run();
    return;
  }

  const status = action === "resolve" ? "done" : "dropped";
  await db
    .prepare(`UPDATE follow_ups SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, now, followUpId)
    .run();

  if (followUp.relationship_id) await rescoreRelationship(db, followUp.relationship_id, now);
}
