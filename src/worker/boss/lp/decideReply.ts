/**
 * ─── HER NUMBERED ANSWER TO A DECIDE CARD REACHES THAT CARD (27 Oct 2026) ────────
 *
 * Every Decide card in Simone's morning email says `Reply "N: …" to this email to answer this one`
 * (scripts/ops/your-day.mjs `replyHint`). Until today only the prospect-email card had a reader
 * (templateReply.ts). Her "2: Hi …, Tuesday at 9am PT works well. Please send the invite to …" on
 * an LP who wrote back went to generic intake instead, was handed to Monique on words from the
 * QUOTED morning email ("seller", "shares") and opened a $200M seller hunt. Now:
 *
 *   an LP card (`lp:` / `lp-again:`)  her words become the reply held in that LP's own thread
 *                                     (`holdThreadReply`), shown to her word for word, and sent
 *                                     ONLY by the existing one-tap "Send as is" (routes/lpTap.ts)
 *   a held or stopped task (`task:`)  her words go to that task's own door (`answerBlockFromMail`)
 *   any other card                    her words are kept on that card, and she is told so plainly
 *
 * The prospect-email card stays templateReply.ts's. Never a hunt, never a new job, never a send.
 * Her words only: the quoted morning under them is never read (`ownWords`).
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { ownWords } from "../../../shared/boss/intake/messageBody.mjs";
import { gmailDraftUrl, gmailThreadUrl, tapUrl } from "../../../shared/boss/lp/plan.mjs";
import { holdThreadReply } from "../wealth/gmailDraft";
import { answerBlockFromMail } from "../service/blockReply";
import { commandReplyIn } from "../../../shared/boss/commands/parse.mjs";
import { getCommand, handleErrandSelf } from "../commands/run";
import { tapToken } from "./desk";

/** "2: …", "#2: …", "2. …", "2) …", "2 - …": a number, a mark, then her words. Never "2 people …". */
export const DECIDE_ANSWER_RE = /^\s*#?(\d{1,2})\s*(?::|\.(?!\d)|\)|-|—)\s*([\s\S]+)$/;

export interface DecideCard {
  day: string; index: number; key: string | null; title: string; details: string[]; screen: string | null;
}

/** The morning a reply answers: the `yd_<yyyymmdd>` code her client carried back, else the newest. */
export function morningDayOf(refs: string[]): string | null {
  const ref = refs.find((r) => /^yd_\d{8}$/.test(r));
  return ref ? `${ref.slice(3, 7)}-${ref.slice(7, 9)}-${ref.slice(9, 11)}` : null;
}

/** Card N of that morning, as she was sent it. */
export async function decideCardOf(env: Env, n: number, day: string | null = null): Promise<DecideCard | null> {
  const r = day
    ? await env.DB.prepare(`SELECT day, payload FROM morning_digests WHERE day = ?`).bind(day).first<{ day: string; payload: string }>()
    : await env.DB.prepare(`SELECT day, payload FROM morning_digests ORDER BY day DESC LIMIT 1`).first<{ day: string; payload: string }>();
  if (!r || n < 1) return null;
  try {
    const d = (JSON.parse(r.payload)?.decide ?? [])[n - 1];
    if (!d) return null;
    return {
      day: r.day, index: n - 1, key: d.key ? String(d.key) : null, title: String(d.title ?? ""),
      details: Array.isArray(d.details) ? d.details.map(String) : [], screen: d.screen ? String(d.screen) : null,
    };
  } catch { return null; }
}

/** Her answer, written onto the card in the kept morning: Today and the item screen read it. */
async function markCard(env: Env, card: DecideCard, mark: { words: string; answered: boolean; note: string }, now: number): Promise<void> {
  const r = await env.DB.prepare(`SELECT payload FROM morning_digests WHERE day = ?`).bind(card.day).first<{ payload: string }>();
  if (!r) return;
  try {
    const p = JSON.parse(r.payload);
    const d = p?.decide?.[card.index];
    if (!d) return;
    d.answer = { words: mark.words.slice(0, 4000), at: now, note: mark.note };
    if (mark.answered) d.answered_at = now;
    await env.DB.prepare(`UPDATE morning_digests SET payload = ?, updated_at = ? WHERE day = ?`).bind(JSON.stringify(p), now, card.day).run();
  } catch { /* an unreadable morning keeps what it had; her reply still says what happened */ }
}

/** Which LP a card is about: its key, else (a morning kept before keys were) its "Their email:" line. */
async function lpRowOf(env: Env, card: DecideCard): Promise<any | null> {
  const k = /^lp(?:-again)?:(.+)$/.exec(card.key ?? "");
  const who = k?.[1] ?? (!card.key ? /^Their email:\s*(\S+@\S+)\s*$/i.exec(card.details.find((l) => /^Their email:/i.test(l)) ?? "")?.[1] : null);
  if (!who) return null;
  return env.DB.prepare(`SELECT * FROM lp_reply_drafts WHERE id = ? OR address = ? LIMIT 1`).bind(who, who.toLowerCase()).first<any>();
}

const quoted = (words: string) => words.split("\n").map((l) => `> ${l}`.trimEnd());

async function answerLp(env: Env, card: DecideCard, n: number, row: any, words: string, now: number, fetchImpl: typeof fetch) {
  const who = row.name || "the LP";
  if (["sent", "skipped"].includes(row.status) && !card.key?.startsWith("lp-again:")) {
    const note = `Your answer to ${n} was not used: your reply to ${who} has already ${row.status === "sent" ? "gone" : "been skipped"}. Nothing was sent.`;
    await markCard(env, card, { words, answered: true, note }, now);
    return note;
  }
  const held = await holdThreadReply(env, row.reply_from, {
    draftId: row.draft_id, to: row.address, subject: row.subject ?? "", inReplyTo: row.in_reply_to, threadId: row.thread_id, body: words,
  }, fetchImpl);
  if (!held.ok) {
    const note = `I kept your answer to ${n} on that item, but could not put it in ${who}'s thread: ${held.why}. Nothing was sent. You can reply in their thread yourself: ${gmailThreadUrl(row.thread_id, row.reply_from)}`;
    await markCard(env, card, { words, answered: false, note }, now);
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "her_words_not_held", detail: { why: held.why, via: "numbered_reply" } });
    return note;
  }
  const token = row.tap_token || tapToken();
  // `decision = 'edit'`: these are her own words, so the morning read never puts a template over them.
  await env.DB.prepare(
    // Her words replace the held reply: no invite rides on the tap any more (lp/schedule.ts).
    `UPDATE lp_reply_drafts SET draft_id = ?, draft_message_id = ?, draft_body = ?, status = 'drafted', decision = 'edit',
       decided_at = ?, drafted_at = ?, send_error = NULL, tap_token = ?, picked_start = NULL, picked_zone = NULL, updated_at = ? WHERE id = ?`,
  ).bind(held.draftId, held.messageId, words.slice(0, 6000), now, now, token, now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "her_words_held", detail: { via: "numbered_reply", draft_id: held.draftId } });
  const note = [
    `Your reply to ${who} is ready in their thread, word for word. Nothing goes until you tap Send.`,
    "",
    ...quoted(words),
    "",
    `Tap to send it: ${tapUrl(token, "send")}`,
    `Tap to change it in Gmail first: ${gmailDraftUrl(held.messageId, row.reply_from)}`,
  ].join("\n");
  await markCard(env, card, { words, answered: true, note: "Your reply waits in their thread for your tap." }, now);
  return note;
}

/**
 * Her numbered answer, or null when the email is not one. `fromMorning` is true when the email it
 * answers is the morning email (its code in the thread, or its subject); only then is a card that is
 * not an LP's claimed, so a numbered answer to any other email keeps its own reader.
 */
export async function decideAnswerFromMail(
  env: Env,
  input: { text: string; refs: string[]; subject: string; mailId: string; now: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ note: string; outcome: "DECIDE_ANSWERED"; taskId: string | null } | null> {
  const her = ownWords(input.text);
  const m = DECIDE_ANSWER_RE.exec(her);
  if (!m) return null;
  const otherThread = input.refs.some((r) => !r.startsWith("yd_"));
  const day = morningDayOf(input.refs);
  const fromMorning = Boolean(day) || (!otherThread && /^\s*(?:re|fwd?):\s*(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(input.subject));
  if (!fromMorning) return null;
  const n = Number(m[1]);
  const words = m[2]!.trim();
  const card = await decideCardOf(env, n, day);
  if (!card || card.key?.startsWith("prospect-template:")) return null; // templateReply.ts's
  if (commandReplyIn(words)?.verb === "handle_self") {
    let errandId = /^errand:(cmd_[a-z0-9_]+)$/i.exec(card.key ?? "")?.[1] ?? null;
    // Older morning cards predate keys. An exact business address and ONE live errand can still
    // identify theirs; two errands at that business are left for the owner to open explicitly.
    if (!errandId && !card.key) {
      const address = /^([^\s<>]+@[^\s<>]+)\s+(?:wants a card|answered your request)/i.exec(card.title)?.[1];
      if (address) {
        const found = await env.DB.prepare(`SELECT id FROM boss_commands WHERE kind = 'errand' AND state IN ('queued','sent','replied','follow_up','booked','needs_card','cancel_sent') AND lower(json_extract(spec, '$.to')) = ? LIMIT 2`).bind(address.toLowerCase()).all<{ id: string }>();
        if (found.results.length === 1) errandId = found.results[0]!.id;
      }
    }
    const errand = errandId ? await getCommand(env, errandId) : null;
    if (errand?.kind === "errand") {
      const note = await handleErrandSelf(env, errand.id, input.now);
      await markCard(env, card, { words, answered: true, note }, input.now);
      return { outcome: "DECIDE_ANSWERED", taskId: null, note };
    }
  }
  const lp = await lpRowOf(env, card);
  if (lp) return { outcome: "DECIDE_ANSWERED", taskId: null, note: await answerLp(env, card, n, lp, words, input.now, fetchImpl) };

  const task = /^task:(tsk_[a-z0-9]+)$/i.exec(card.key ?? "")?.[1];
  if (task) {
    const r = await answerBlockFromMail(env, { subject: `[${task}]`, text: words, mailId: input.mailId, now: input.now });
    if (r) {
      await markCard(env, card, { words, answered: r.door !== "HELD", note: r.note }, input.now);
      return { outcome: "DECIDE_ANSWERED", taskId: r.taskId, note: r.note };
    }
  }
  const note = `Your answer to ${n} ("${card.title}") is kept on that item in Boss OS. Nothing was sent and no new job was opened.${card.screen ? ` Open it: ${card.screen}` : ""}`;
  await markCard(env, card, { words, answered: false, note }, input.now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "morning_digest", entityId: card.day, action: "decide_answer_kept", detail: { n, key: card.key } });
  return { outcome: "DECIDE_ANSWERED", taskId: task ?? null, note };
}
