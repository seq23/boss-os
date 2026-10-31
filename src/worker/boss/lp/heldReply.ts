import type { Env } from "../env";
import { audit } from "../lib/audit";
import { holdThreadReply } from "../wealth/gmailDraft";
import { sendDraft, lpReplyClosed } from "../routes/lpTap";
import { tapToken } from "./desk";

/**
 * ✓ SEND AS IS / ✎ CHANGE IT, FROM TODAY (owner, Today v4, 31 Oct 2026).
 *
 * The same safe path as the morning email's one-tap page (routes/lpTap.ts), reached from her signed-in
 * screen instead of a token link:
 *
 *   Send as is   sends the draft held in that person's own Gmail thread, from the mailbox they wrote
 *                to, ONLY if the draft is still the one whose words she was shown (`draft_message_id`).
 *   Change it    her words replace the held draft in the same thread (`holdThreadReply`) and come
 *                back to her word for word; one more tap on Send as is sends them. Nothing else sends.
 *
 * NOTHING HERE WRITES WITH A MODEL. LP replies are fixed templates or her own words, so no LP name or
 * deal term ever reaches a route (the router refuses `confidentialDraft` outright, and a Mac task
 * carrying one runs on the Claude seat only: duties/seatOrder.ts).
 */

export async function lpRow(env: Env, id: string): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE id = ?`).bind(id).first<any>();
}

export async function sendHeldLp(env: Env, row: any, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; line: string }> {
  const who = row.name || "them";
  if (lpReplyClosed(row) && row.status !== "replied_again") return { ok: false, line: row.status === "skipped" ? "That reply was skipped." : "That reply has already gone." };
  if (!row.draft_id || !row.draft_body || !row.draft_message_id) return { ok: false, line: "No reply is ready in their thread yet. Tap Change it to write one." };
  const r = await sendDraft(env, row.reply_from, row.draft_id, fetchImpl, row.draft_message_id);
  if (!r.ok) {
    await env.DB.prepare(`UPDATE lp_reply_drafts SET decision = 'send', decided_at = ?, send_error = ?, updated_at = ? WHERE id = ?`).bind(now, r.why ?? null, now, row.id).run();
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "send_failed", detail: { why: r.why, via: "today" } });
    return { ok: false, line: `Not sent yet: ${r.why}.` };
  }
  await env.DB.prepare(`UPDATE lp_reply_drafts SET status = 'sent', decision = 'send', decided_at = ?, sent_at = ?, send_error = NULL, updated_at = ? WHERE id = ?`).bind(now, now, now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "sent", detail: { via: "today" } });
  return { ok: true, line: `Sent to ${who}, in their thread.` };
}

export async function holdHerWords(env: Env, row: any, words: string, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; line: string; text: string | null }> {
  const text = words.trim().slice(0, 6000);
  if (!text) return { ok: false, line: "Type the reply you want to send.", text: null };
  if (["sent", "skipped", "scheduled"].includes(row.status)) return { ok: false, line: "That reply has already gone, so nothing was changed.", text: null };
  const held = await holdThreadReply(env, row.reply_from, {
    draftId: row.draft_id, to: row.address, subject: row.subject ?? "", inReplyTo: row.in_reply_to, threadId: row.thread_id, body: text,
  }, fetchImpl);
  if (!held.ok) {
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "her_words_not_held", detail: { why: held.why, via: "today" } });
    return { ok: false, line: `Your words could not be put in their thread: ${held.why}. Nothing was sent.`, text: null };
  }
  await env.DB.prepare(
    `UPDATE lp_reply_drafts SET draft_id = ?, draft_message_id = ?, draft_body = ?, status = 'drafted', decision = 'edit',
       decided_at = ?, drafted_at = ?, send_error = NULL, tap_token = COALESCE(tap_token, ?), updated_at = ? WHERE id = ?`,
  ).bind(held.draftId, held.messageId, text, now, now, tapToken(), now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "her_words_held", detail: { via: "today", draft_id: held.draftId } });
  return { ok: true, line: "Here is the new version, in their thread. Tap Send as is to send it.", text };
}
