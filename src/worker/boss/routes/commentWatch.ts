/**
 * Comment watch — the door for her Mac, and the list a screen reads.
 *
 *   POST /                       the Mac posts a sweep's digest: rows + a task, or NOTHING_TO_REPORT by name
 *   GET  /pending-instructions   rows that carry HER instruction and no result yet — the only feed `act` reads
 *   POST /applied                the Mac reports each result after how-we-know's `act` ran
 *   GET  /                       newest digests with their items, for the screen
 *
 * ─── The instruction row is the only path to the channel ───────────────────
 *
 * `/pending-instructions` selects `instructed_at IS NOT NULL AND applied_at IS NULL`, and
 * `instructed_at` has exactly one writer: `answerCommentWatchFromMail`, which the mailbox calls
 * below its verified-sender refusal. So the Mac cannot be handed a comment to hide or answer that
 * she did not instruct, and how-we-know's `act` refuses the instruction again on its own side if
 * the record is incomplete. `validate:comment-act-instructed` pins all three facts.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { taskEvent } from "../repoChange/answer";
import { digestById, itemsOf, type CommentWatchDigestRow, type CommentWatchItemRow } from "../commentWatch/answer";
import { DUTY_ID, TASK_KIND, ACTIONS } from "../../../shared/boss/commentWatch/lane.mjs";

/** Where the boss router mounts this: `/<delivers table, dashed>`, as every local-job door is named. */
export const COMMENT_WATCH_PATH = "/api/comment-watch-items";

export const commentWatch = new Hono<{ Bindings: Env; Variables: Vars }>();

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

interface DigestBody {
  new_comments?: number;
  by_class?: Record<string, number>;
  items?: Array<{
    comment_id: string; video_id: string; video_title?: string | null; author?: string | null; text: string;
    published_at?: string | null; class: string; proposed_action: string; proposed_reply?: string | null; product_note?: string | null;
  }>;
}

/** The Mac posts what the sweep found. Empty = NOTHING_TO_REPORT, recorded by name, no task. */
commentWatch.post("/", async (c) => {
  const b = (await c.req.json().catch(() => null)) as DigestBody | null;
  if (!b || typeof b !== "object") throw badRequest("Send the sweep's digest as JSON", "{ new_comments, by_class, items: [...] }");
  const items = Array.isArray(b.items) ? b.items : [];
  const now = Date.now();
  const id = newId("cw");
  const duty = await c.env.DB.prepare(`SELECT id, employee_id, lane FROM standing_duties WHERE id = ?`).bind(DUTY_ID).first<{ id: string; employee_id: string; lane: string }>();
  if (!duty) throw notFound(`No standing duty ${DUTY_ID}; the migration that seeds it has not applied.`);

  for (const [i, it] of items.entries()) {
    if (!text(it?.comment_id, 200) || !text(it?.video_id, 64) || !text(it?.text, 20000)) throw badRequest(`Item ${i + 1} lacks comment_id, video_id or text`);
    if (!ACTIONS.includes(it.proposed_action)) throw badRequest(`Item ${i + 1}: proposed_action must be one of ${ACTIONS.join("/")}`);
    if (it.class !== "negative" && it.class !== "question") throw badRequest(`Item ${i + 1}: class must be negative or question`);
  }
  // A comment already reported once is never reported twice, whatever the Mac's ledger says.
  const fresh: DigestBody["items"] = [];
  for (const it of items) {
    const seen = await c.env.DB.prepare(`SELECT id FROM comment_watch_items WHERE comment_id = ?`).bind(it.comment_id).first();
    if (!seen) fresh!.push(it);
  }

  if (!fresh!.length) {
    await c.env.DB
      .prepare(`INSERT INTO comment_watch_digests (id, duty_id, task_id, outcome, new_comments, by_class, item_count, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, DUTY_ID, null, "NOTHING_TO_REPORT", Number(b.new_comments ?? 0) || 0, JSON.stringify(b.by_class ?? {}), 0, now)
      .run();
    await logEvent(c.env.DB, { level: "info", scope: "comment_watch", event: "nothing_to_report", lane: "ops", entityId: id, detail: { new_comments: b.new_comments ?? 0, by_class: b.by_class ?? {} } });
    return ok(c, { id, outcome: "NOTHING_TO_REPORT", item_count: 0, task_id: null, email: false }, 201);
  }

  const taskId = newId("tsk");
  await c.env.DB
    .prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                          intake_kind, execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      taskId, duty.lane, duty.employee_id,
      `${fresh!.length} comment${fresh!.length === 1 ? "" : "s"} on the channel need your word`,
      JSON.stringify({ kind: TASK_KIND, digest_id: id, duty_id: DUTY_ID, item_count: fresh!.length }),
      "awaiting_approval", now, "ops", "AI_DRAFT", "low", "private", "NORMAL",
    )
    .run();
  await c.env.DB
    .prepare(`INSERT INTO comment_watch_digests (id, duty_id, task_id, outcome, new_comments, by_class, item_count, created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, DUTY_ID, taskId, "SENT", Number(b.new_comments ?? 0) || 0, JSON.stringify(b.by_class ?? {}), fresh!.length, now)
    .run();
  for (const [i, it] of fresh!.entries()) {
    await c.env.DB
      .prepare(
        `INSERT INTO comment_watch_items (id, digest_id, n, comment_id, video_id, video_title, author, text, published_at, class,
                                          proposed_action, proposed_reply, product_note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        newId("cwi"), id, i + 1, it.comment_id, it.video_id, text(it.video_title, 300), text(it.author, 200), it.text.slice(0, 20000),
        text(it.published_at, 40), it.class, it.proposed_action, text(it.proposed_reply, 2000), text(it.product_note, 500), now,
      )
      .run();
  }
  await c.env.DB.prepare(`UPDATE standing_duties SET last_task_id = ? WHERE id = ?`).bind(taskId, DUTY_ID).run();
  await taskEvent(c.env, taskId, "comment_watch_digest", { digest_id: id, item_count: fresh!.length, new_comments: b.new_comments ?? 0 });
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "comment_watch_digest", entityId: id, action: "posted", detail: { item_count: fresh!.length, task_id: taskId } });
  const rows = await itemsOf(c.env, id);
  return ok(c, { id, outcome: "SENT", item_count: rows.length, task_id: taskId, email: true, items: rows.map(({ n, comment_id, author, video_title, proposed_action, proposed_reply }) => ({ n, comment_id, author, video_title, proposed_action, proposed_reply })) }, 201);
});

/** The Mac records the digest email's id once it is sent, so the row says the mail went. */
commentWatch.post("/:id/mailed", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { mail_id?: string };
  const mailId = text(b.mail_id, 200);
  if (!mailId) throw badRequest("Send { mail_id }");
  const r = await c.env.DB.prepare(`UPDATE comment_watch_digests SET mail_id = ? WHERE id = ? AND outcome = 'SENT'`).bind(mailId, c.req.param("id")).run();
  if (!r.meta.changes) throw notFound("No sent digest with that id");
  return ok(c, { id: c.req.param("id"), mail_id: mailId });
});

/**
 * THE ONLY FEED `act` READS. Instructed (by her, below the refusal) and not yet applied. Each row
 * carries the record how-we-know's `act` demands: who, when, via.
 */
commentWatch.get("/pending-instructions", async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT i.*, d.answer_mode, d.answer_phrase FROM comment_watch_items i JOIN comment_watch_digests d ON d.id = i.digest_id
        WHERE i.instructed_at IS NOT NULL AND i.applied_at IS NULL AND i.action IS NOT NULL AND i.instructed_by IS NOT NULL AND i.source IS NOT NULL
        ORDER BY i.instructed_at, i.n`,
    )
    .all<CommentWatchItemRow & { answer_mode: string | null; answer_phrase: string | null }>();
  const rows = r.results ?? [];
  return ok(c, {
    count: rows.length,
    instructions: rows.map((i) => ({
      digest_id: i.digest_id, n: i.n, comment_id: i.comment_id, author: i.author, video_title: i.video_title,
      action: i.action, reply_text: i.reply_text,
      instructed_by: i.instructed_by, instructed_at: new Date(i.instructed_at!).toISOString(), source: i.source,
      answer_mode: i.answer_mode, answer_phrase: i.answer_phrase,
    })),
  });
});

/** The Mac reports what `act` did, row by row. A digest whose rows are all answered closes its task. */
commentWatch.post("/applied", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { results?: Array<{ comment_id: string; result: string }> } | null;
  const results = Array.isArray(b?.results) ? b!.results : [];
  if (!results.length) throw badRequest("Send { results: [{ comment_id, result }] }");
  const now = Date.now();
  let applied = 0;
  const digests = new Set<string>();
  for (const r of results) {
    const cid = text(r?.comment_id, 200);
    const res = text(r?.result, 500);
    if (!cid || !res) throw badRequest("Each result needs comment_id and result");
    const row = await c.env.DB.prepare(`SELECT digest_id FROM comment_watch_items WHERE comment_id = ? AND instructed_at IS NOT NULL AND applied_at IS NULL`).bind(cid).first<{ digest_id: string }>();
    if (!row) continue;
    await c.env.DB.prepare(`UPDATE comment_watch_items SET applied_at = ?, result = ? WHERE comment_id = ?`).bind(now, res, cid).run();
    applied += 1;
    digests.add(row.digest_id);
  }
  for (const digestId of digests) {
    const d = await digestById(c.env, digestId);
    const open = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM comment_watch_items WHERE digest_id = ? AND (instructed_at IS NULL OR applied_at IS NULL)`).bind(digestId).first<{ n: number }>();
    if (d?.task_id) {
      await taskEvent(c.env, d.task_id, "comment_watch_applied", { digest_id: digestId, applied, open: open?.n ?? 0 });
      if (!open?.n) await c.env.DB.prepare(`UPDATE tasks SET status = 'done', finished_at = ? WHERE id = ? AND status <> 'done'`).bind(now, d.task_id).run();
    }
  }
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "comment_watch_items", action: "applied", detail: { applied, digests: [...digests] } });
  return ok(c, { applied, digests: [...digests] });
});

/** Newest digests with their items, for Systems → Duties and the task card. */
commentWatch.get("/", async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM comment_watch_digests ORDER BY created_at DESC LIMIT 12`).all<CommentWatchDigestRow>();
  const digests = [];
  for (const d of r.results ?? []) digests.push({ ...d, by_class: parse(d.by_class), items: d.item_count ? await itemsOf(c.env, d.id) : [] });
  return ok(c, { digests });
});

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}
