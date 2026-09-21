import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { taskEvent } from "../repoChange/answer";
import { tokenIn, parseReply } from "../../../shared/boss/commentWatch/lane.mjs";

/**
 * THE COMMENT-WATCH LANE'S WORKER HALF — her reply becomes instruction rows.
 *
 * The parser lives in `src/shared/boss/commentWatch/lane.mjs`; this is the D1 plumbing: find the
 * digest her reply names by the `[cw_…]` token in the subject, read her lines against the rows
 * she was sent, and write the instruction on each row with who / when / via.
 *
 * ─── BELOW THE REFUSAL, DELIBERATELY ─────────────────────────────────────────
 *
 * This is called from inside the authorised region of `handleBossInboundMail`, after the
 * `!authorised` return: the sender is one of her addresses AND DMARC passed. An instruction row is
 * the only thing that lets the Mac's `act` half hide or post a comment, so it may be written from
 * nothing but a message proven to be hers. `validate:comment-act-instructed` pins the position.
 */

export interface CommentWatchItemRow {
  id: string; digest_id: string; n: number; comment_id: string; video_id: string; video_title: string | null;
  author: string | null; text: string; published_at: string | null; class: string;
  proposed_action: string; proposed_reply: string | null; product_note: string | null;
  action: string | null; reply_text: string | null; instructed_by: string | null; instructed_at: number | null;
  source: string | null; applied_at: number | null; result: string | null; created_at: number;
}

export interface CommentWatchDigestRow {
  id: string; duty_id: string; task_id: string | null; outcome: string; new_comments: number; by_class: string | null;
  item_count: number; mail_id: string | null; answered_at: number | null; answer_mail_id: string | null;
  answer_mode: string | null; answer_phrase: string | null; created_at: number;
}

export async function digestById(env: Env, id: string): Promise<CommentWatchDigestRow | null> {
  return env.DB.prepare(`SELECT * FROM comment_watch_digests WHERE id = ?`).bind(id).first<CommentWatchDigestRow>();
}

export async function itemsOf(env: Env, digestId: string): Promise<CommentWatchItemRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM comment_watch_items WHERE digest_id = ? ORDER BY n`).bind(digestId).all<CommentWatchItemRow>();
  return r.results ?? [];
}

export async function answerCommentWatchFromMail(
  env: Env, input: { sender: string; subject: string; text: string; mailId: string; now: number },
): Promise<{ digestId: string; instructed: number; note: string } | null> {
  const digestId = tokenIn(`${input.subject}\n${input.text}`);
  if (!digestId) return null;
  const digest = await digestById(env, digestId);
  if (!digest) return { digestId, instructed: 0, note: `Your message names ${digestId}, and no comment digest has that id. Nothing was changed.` };

  const items = await itemsOf(env, digestId);
  const open = items.filter((it) => !it.instructed_at);
  if (!open.length) {
    if (digest.task_id) await taskEvent(env, digest.task_id, "comment_watch_note", { digest_id: digestId, mail_id: input.mailId, text: input.text.slice(0, 4000) });
    return { digestId, instructed: 0, note: `Noted on ${digestId}: every comment in that digest already has your instruction. A second reply changes nothing; if you want something different, tell me by number in a new #monique message.` };
  }

  const parsed = parseReply(input.text, open);
  if (parsed.mode === "none") {
    if (digest.task_id) await taskEvent(env, digest.task_id, "comment_watch_unread", { digest_id: digestId, mail_id: input.mailId, unread: parsed.unread, text: input.text.slice(0, 4000) });
    return {
      digestId, instructed: 0,
      note: `I could not read an instruction in your reply to ${digestId}. One line per number — \`1 delete\`, \`2 reply as drafted\`, \`3 reply: <your words>\`, \`4 ignore\` — or \`your call\` on its own line. Nothing was changed.`,
    };
  }

  const source = parsed.mode === "your_call"
    ? `pre-approved by her reply: "${parsed.phrase}" (mail ${input.mailId})`
    : `email reply [${digestId}] mail ${input.mailId}`;
  let instructed = 0;
  for (const ins of parsed.instructions) {
    const r = await env.DB
      .prepare(
        `UPDATE comment_watch_items
            SET action = ?, reply_text = ?, instructed_by = ?, instructed_at = ?, source = ?
          WHERE digest_id = ? AND comment_id = ? AND instructed_at IS NULL`,
      )
      .bind(ins.action, ins.reply_text ?? null, input.sender, input.now, source, digestId, ins.comment_id)
      .run();
    instructed += r.meta.changes ?? 0;
  }
  await env.DB
    .prepare(`UPDATE comment_watch_digests SET answered_at = ?, answer_mail_id = ?, answer_mode = ?, answer_phrase = ? WHERE id = ?`)
    .bind(input.now, input.mailId, parsed.mode, parsed.phrase ?? null, digestId)
    .run();
  if (digest.task_id) {
    await taskEvent(env, digest.task_id, "comment_watch_instructed", {
      digest_id: digestId, mail_id: input.mailId, mode: parsed.mode, phrase: parsed.phrase, instructed, unread: parsed.unread,
      instructions: parsed.instructions.map((i) => ({ n: i.n, action: i.action })),
    });
  }
  await audit(env.DB, {
    actor: input.sender, lane: "ops", entityType: "comment_watch_digest", entityId: digestId,
    action: "instructed", detail: { mode: parsed.mode, phrase: parsed.phrase, instructed, mail_id: input.mailId },
  });

  const left = open.length - instructed;
  const how = parsed.mode === "your_call" ? `"${parsed.phrase}" — Monique applies every proposed action` : `${instructed} instruction${instructed === 1 ? "" : "s"} by number`;
  const tail = left > 0 ? ` ${left} item${left === 1 ? "" : "s"} still ${left === 1 ? "has" : "have"} no instruction and will not be touched.` : "";
  const unread = parsed.unread.length ? ` Could not read: ${parsed.unread.map((u) => `"${u}"`).join(", ")}.` : "";
  return { digestId, instructed, note: `Recorded on ${digestId}: ${how}. Applied on the Mac's next run, and you get one line per action.${tail}${unread}` };
}
