import type { Env } from "../env";
import { audit } from "../lib/audit";
import { holdThreadReply } from "../wealth/gmailDraft";
import { sendDraft } from "../routes/lpTap";
import { lpNudgeBody, lpReplyRecipients } from "../../../shared/boss/lp/plan.mjs";

/**
 * ONE GENTLE NUDGE, SENT ON HER YES (owner, 26 Oct 2026; repaired 4 Nov 2026).
 *
 * The Decide card offered the nudge word for word but could not send it, and nothing remembered a
 * nudge had gone (`nudged_at` was read, never written). She typed "Send one gentle nudge to <address>
 * … mark her nudged" into Boss OS; triage gave it to research, which wrote a page about it.
 *
 * Two doors now reach this one sender: the card's one tap (routes/lpTap.ts `do=nudge`) and her own
 * words naming the address with "nudge" (`nudgeFromWords`, read in intake/inboundMail.ts before the
 * command reader and the triage). Either way:
 *   - only a row whose reply WENT (`sent`), that has not written back since, and was never nudged;
 *   - the words are the fixed template the card showed (`lpNudgeBody`), never a model's;
 *   - it goes in their own thread, from the West Peek mailbox they wrote to, through the delegation's
 *     compose scope (a held draft, then drafts.send of that exact message);
 *   - `nudged_at` is claimed BEFORE the send, so two taps never send two nudges; a failed send
 *     releases the claim and says why.
 */
export type NudgeResult = { ok: boolean; title: string; line: string };

export function nudgeEligible(row: any): { ok: true } | { ok: false; title: string; line: string } {
  if (!row) return { ok: false, title: "Nothing to nudge", line: "That person is not on the LP replies tracker." };
  if (row.nudged_at) return { ok: false, title: "Already done", line: Number(row.nudge_sent) ? "The one nudge already went. They will not be offered again." : "You chose no nudge for them. They will not be offered again." };
  if (row.status !== "sent" || !(Number(row.sent_at) > 0)) return { ok: false, title: "No nudge needed", line: "Your reply to them has not gone yet, so there is nothing to nudge." };
  if (Number(row.last_reply_at) > Number(row.sent_at)) return { ok: false, title: "They wrote back", line: "They answered after your reply, so no nudge goes. Their message is in Decide." };
  if (!row.thread_id) return { ok: false, title: "Open their thread to send it", line: "Their thread could not be found, so nothing was sent from here." };
  return { ok: true };
}

export async function sendLpNudge(env: Env, row: any, via: "one_tap" | "her_email", now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<NudgeResult> {
  const gate = nudgeEligible(row);
  if (!gate.ok) return { ok: false, title: gate.title, line: gate.line };
  const who = row.name || "them";
  const claim = await env.DB.prepare(`UPDATE lp_reply_drafts SET nudged_at = ?, updated_at = ? WHERE id = ? AND nudged_at IS NULL`).bind(now, now, row.id).run();
  if (!claim.meta?.changes) return { ok: false, title: "Already done", line: "The one nudge already went. They will not be offered again." };
  const release = async (why: string): Promise<NudgeResult> => {
    await env.DB.prepare(`UPDATE lp_reply_drafts SET nudged_at = NULL, send_error = ?, updated_at = ? WHERE id = ?`).bind(why.slice(0, 300), now, row.id).run();
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "nudge_failed", detail: { via, why } });
    return { ok: false, title: "Not sent yet", line: `${why}. Nothing went; the nudge stays on your list.` };
  };
  const held = await holdThreadReply(env, row.reply_from, {
    ...lpReplyRecipients(row), subject: row.subject ?? "", inReplyTo: row.in_reply_to, threadId: row.thread_id, body: lpNudgeBody(row),
  }, fetchImpl);
  if (!held.ok) return release(held.why);
  const sent = await sendDraft(env, row.reply_from, held.draftId, fetchImpl, held.messageId);
  if (!sent.ok) return release(sent.why ?? "Gmail did not send it");
  await env.DB.prepare(`UPDATE lp_reply_drafts SET nudge_sent = 1, send_error = NULL, updated_at = ? WHERE id = ?`).bind(now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "nudged", detail: { via } });
  return { ok: true, title: "Nudge sent", line: `The one gentle nudge went to ${who} in your thread. They will not be offered again.` };
}

export async function skipLpNudge(env: Env, row: any, now = Date.now()): Promise<NudgeResult> {
  if (!row || row.nudged_at) return { ok: false, title: "Already done", line: "Nothing else to do here." };
  await env.DB.prepare(`UPDATE lp_reply_drafts SET nudged_at = ?, nudge_sent = 0, updated_at = ? WHERE id = ? AND nudged_at IS NULL`).bind(now, now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "nudge_skipped", detail: {} });
  return { ok: true, title: "No nudge", line: "Nothing goes. They will not be offered again." };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Her own words asking for the nudge: the word "nudge" and at least one address. Returns the
 * addresses (lower case) to look up on the tracker; the tracker row decides, never the words.
 */
export function nudgeAddressesIn(text: string): string[] {
  const t = String(text ?? "");
  if (!/\bnudge\b/i.test(t)) return [];
  return [...new Set((t.match(EMAIL_RE) ?? []).map((a) => a.toLowerCase().replace(/\.+$/, "")))];
}

/**
 * The email door: an email of hers that asks for the nudge to an LP on the tracker is the whole job.
 * Null when it names no tracker row (the email goes on exactly as before).
 */
export async function nudgeFromWords(env: Env, text: string, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<{ note: string; sent: number } | null> {
  const addresses = nudgeAddressesIn(text);
  if (!addresses.length) return null;
  const lines: string[] = [];
  let sent = 0;
  for (const address of addresses) {
    const row = await env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE address = ?`).bind(address).first<any>();
    if (!row) continue;
    const r = await sendLpNudge(env, row, "her_email", now, fetchImpl);
    if (r.ok) sent++;
    lines.push(r.ok ? r.line : `${row.name || address}: ${r.title}. ${r.line}`);
  }
  if (!lines.length) return null;
  return { note: lines.join("\n"), sent };
}

