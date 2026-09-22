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
  attempts: number; error: string | null;
};

/**
 * WHAT IS WAITING TO BE SENT, oldest first.
 *
 * `attempts` is capped here rather than in the drain: a notice whose address is wrong would
 * otherwise be retried six times a day forever, and the honest end of that is a row that stops
 * being offered and keeps its last refusal for anyone who asks why she was not told.
 */
export const MAX_SEND_ATTEMPTS = 5;

taskNotices.get("/pending", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM boss_task_notices
        WHERE sent_at IS NULL AND attempts < ?
        ORDER BY created_at LIMIT 20`,
    )
    .bind(MAX_SEND_ATTEMPTS)
    .all<NoticeRow>();
  const stuck = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM boss_task_notices WHERE sent_at IS NULL AND attempts >= ?`)
    .bind(MAX_SEND_ATTEMPTS)
    .first<{ n: number }>();
  return ok(c, {
    items: rows.results ?? [],
    // Named rather than hidden: a notice nobody will retry is a thing she was not told.
    gave_up: stuck?.n ?? 0,
    max_attempts: MAX_SEND_ATTEMPTS,
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

  const body = await c.req.json<{ error?: string }>().catch(() => ({} as { error?: string }));
  const error = typeof body?.error === "string" && body.error.trim() ? body.error.trim().slice(0, 500) : null;
  if (!error) throw badRequest("A failed send must say why", "Post { error: \"<what the sender refused with>\" }.");

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
