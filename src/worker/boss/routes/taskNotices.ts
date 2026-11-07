/**
 * The door her Mac drains, so a task that ended badly can reach her by email.
 *
 * ─── Why this exists at all ─────────────────────────────────────────────────
 *
 * Boss OS is a Cloudflare Worker and its only outbound mail capability is `message.reply()` on a
 * live inbound Email Routing event. A queue consumer finishing a task has no inbound message to
 * reply to, which is why nothing here has ever sent a completion email for a generic ops one-off —
 * `#danielle` repo changes and the KDP watch both get one only because both run on her Mac, where
 * `scripts/ops/notify.mjs` and its Resend key are.
 *
 * So the Worker writes the message down (migration 0273) and `scripts/ops/task-notices.mjs` sends
 * it from the Mac through the ONE roster module every employee email already goes through. This
 * file is the two ends of that: what is waiting, and what happened when it was tried.
 *
 * ─── THE OUTCOME IS RECORDED FROM THE SENDER'S ANSWER, NEVER OPTIMISTICALLY ─
 *
 * `/sent` is posted only after Resend accepted, and `/failed` carries the refusal. A drain that
 * marked rows sent before sending would turn "she was never told" back into a silence, which is the
 * exact shape of the bug this whole change closes one level up.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { logEvent } from "../lib/log";

export const taskNotices = new Hono<{ Bindings: Env; Variables: Vars }>();

type NoticeRow = {
  id: string; task_id: string; lane: string; from_name: string; kind: string;
  subject: string; body: string; created_at: number; sent_at: number | null;
  attempts: number; holds: number; error: string | null;
};

/**
 * WHAT IS WAITING TO BE SENT, oldest first.
 *
 * `attempts` is capped here rather than in the drain: a notice whose address is wrong would
 * otherwise be retried six times a day forever, and the honest end of that is a row that stops
 * being offered and keeps its last refusal for anyone who asks why she was not told.
 */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * A HELD NOTICE KEEPS ITS PLACE (repair, 6 Nov 2026). The plain-email gate on her Mac holds the same
 * words every run until the code that wrote them is fixed, and a fix job is opened for it. A hold is
 * therefore not a failed send: it is counted in `holds`, never `attempts`, so a finished report is
 * still offered once its sender is repaired. It has its own ceiling, so a hold never loops forever,
 * and both ceilings are named in `/pending` (rule 0).
 */
export const MAX_HOLDS = 10;

taskNotices.get("/pending", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM boss_task_notices
        WHERE sent_at IS NULL AND attempts < ? AND holds < ?
        ORDER BY created_at LIMIT 20`,
    )
    .bind(MAX_SEND_ATTEMPTS, MAX_HOLDS)
    .all<NoticeRow>();
  const stuck = await c.env.DB
    .prepare(
      `SELECT COALESCE(SUM(attempts >= ?1 OR holds >= ?2), 0) AS n,
              COALESCE(SUM(holds >= ?2), 0) AS held_out,
              COALESCE(SUM(holds > 0 AND holds < ?2 AND attempts < ?1), 0) AS held
         FROM boss_task_notices WHERE sent_at IS NULL`,
    )
    .bind(MAX_SEND_ATTEMPTS, MAX_HOLDS)
    .first<{ n: number; held_out: number; held: number }>();
  return ok(c, {
    items: rows.results ?? [],
    // Named rather than hidden: a notice nobody will retry is a thing she was not told.
    gave_up: stuck?.n ?? 0,
    // Of those, how many stopped on the hold ceiling; and how many are held now but still offered.
    gave_up_held: stuck?.held_out ?? 0,
    held: stuck?.held ?? 0,
    max_attempts: MAX_SEND_ATTEMPTS,
    max_holds: MAX_HOLDS,
  });
});

taskNotices.post("/:id/sent", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM boss_task_notices WHERE id = ?`).bind(id).first<NoticeRow>();
  if (!row) throw notFound("No such notice");
  if (row.sent_at) return ok(c, { id, sent_at: row.sent_at, already: true });

  const body = await c.req.json<{ from?: string }>().catch(() => ({} as { from?: string }));
  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE boss_task_notices SET sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?`)
    .bind(now, id)
    .run();
  await logEvent(c.env.DB, {
    level: "info", scope: "queue", event: "task_notice_sent", lane: row.lane, entityId: row.task_id,
    detail: { notice_id: id, kind: row.kind, from: body?.from ?? row.from_name },
  });
  return ok(c, { id, sent_at: now });
});

taskNotices.post("/:id/failed", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM boss_task_notices WHERE id = ?`).bind(id).first<NoticeRow>();
  if (!row) throw notFound("No such notice");

  const body = await c.req.json<{ error?: string; held?: boolean }>().catch(() => ({} as { error?: string; held?: boolean }));
  const error = typeof body?.error === "string" && body.error.trim() ? body.error.trim().slice(0, 500) : null;
  if (!error) throw badRequest("A failed send must say why", "Post { error: \"<what the sender refused with>\" }.");

  if (body?.held === true) {
    // The gate held it and opened a fix job: the words are wrong, not the send. Keep its place.
    await c.env.DB
      .prepare(`UPDATE boss_task_notices SET holds = holds + 1, error = ? WHERE id = ?`)
      .bind(error, id)
      .run();
    const holds = (row.holds ?? 0) + 1;
    await logEvent(c.env.DB, {
      level: "warn", scope: "queue", event: "task_notice_held", lane: row.lane, entityId: row.task_id,
      detail: { notice_id: id, kind: row.kind, holds, error },
    });
    return ok(c, { id, held: true, holds, attempts: row.attempts, gave_up: holds >= MAX_HOLDS });
  }

  await c.env.DB
    .prepare(`UPDATE boss_task_notices SET attempts = attempts + 1, error = ? WHERE id = ?`)
    .bind(error, id)
    .run();
  await logEvent(c.env.DB, {
    level: "error", scope: "queue", event: "task_notice_send_failed", lane: row.lane, entityId: row.task_id,
    detail: { notice_id: id, kind: row.kind, attempts: row.attempts + 1, error },
  });
  return ok(c, { id, attempts: row.attempts + 1, gave_up: row.attempts + 1 >= MAX_SEND_ATTEMPTS });
});
