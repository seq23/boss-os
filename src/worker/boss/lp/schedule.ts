/**
 * LP SCHEDULING, ONE TAP — THE WORKER HALF (owner, 31 Oct 2026).
 *
 * The Mac's 06:15 LP run (scripts/ops/lp-followups.mjs) holds the reply in the LP's own thread: 2–3
 * open times when they wrote back warmly about meeting, or a short confirmation when they picked one
 * of her times (`picked_start`). Nothing is sent there. Here, on HER tap only:
 *
 *   before the send   a picked time must still be ahead and still free on the calendar of the
 *                     mailbox the reply goes from; otherwise NOTHING is sent (the reply says an
 *                     invite is coming, so it never goes without one) — fail closed.
 *   after the send    the calendar invite, from that same mailbox, with a video link, the LP the only
 *                     guest (`createInvite`, sendUpdates=all is the invite). Once per picked time.
 *
 * Both taps reach this: the morning email's one-tap page (routes/lpTap.ts) and Today's "✓ Send as is"
 * (lp/heldReply.ts). No model is called anywhere here.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { clashes, createInvite } from "../commands/google";
import { AWAY_CITY_KEY, AWAY_UNTIL_KEY } from "../today/food";
import { INVITE_MINUTES, INVITE_TITLE, slotText } from "../../../shared/boss/lp/schedule.mjs";

/** Where she is, as Boss OS keeps it ("where I am until", the same setting the food row reads). */
export async function whereSheIs(db: D1Database): Promise<{ away_city: string | null; away_until: string | null }> {
  const s = await getSettings(db, [AWAY_CITY_KEY, AWAY_UNTIL_KEY]).catch(() => ({} as Record<string, string>));
  return { away_city: s[AWAY_CITY_KEY] || null, away_until: s[AWAY_UNTIL_KEY] || null };
}

/** True when this row's held reply confirms a time whose invite has not gone yet. */
export function inviteDue(row: any): boolean {
  return Number.isFinite(Number(row?.picked_start)) && Number(row.picked_start) > 0
    && Number(row.invite_for_start ?? 0) !== Number(row.picked_start);
}

/** The picked time as she reads it. */
export function pickedText(row: any): string {
  return slotText({ start: Number(row.picked_start), zone: String(row.picked_zone || "America/Chicago") });
}

/**
 * Before the send: refuses (ok: false, a plain line) when the picked time has passed, is no longer
 * free, or the calendar cannot be read. A row with no pick passes untouched.
 */
export async function inviteGate(env: Env, row: any, now = Date.now()): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!inviteDue(row)) return { ok: true };
  const start = Number(row.picked_start);
  const end = start + INVITE_MINUTES * 60_000;
  if (start <= now + 30 * 60_000) return { ok: false, why: `${pickedText(row)} has passed or is too close, so nothing was sent; tomorrow's reply offers new times` };
  const c = await clashes(env, row.reply_from, start, end);
  if (!c.ok) return { ok: false, why: `your calendar could not be checked (${c.why}), so nothing was sent` };
  if (c.busy.length) return { ok: false, why: `${pickedText(row)} is no longer free on your calendar, so nothing was sent; tomorrow's reply offers new times` };
  return { ok: true };
}

/** After the send: the invite, once per picked time. Returns the line she sees. */
export async function sendInvite(env: Env, row: any, now = Date.now()): Promise<{ ok: boolean; line: string }> {
  if (!inviteDue(row)) return { ok: true, line: "" };
  const start = Number(row.picked_start);
  const r = await createInvite(env, {
    mailbox: row.reply_from, title: INVITE_TITLE, start, minutes: INVITE_MINUTES, guests: [String(row.address)],
    requestId: `lp-${row.id}-${start}`, description: "A short call. The video link is on this invite.",
  });
  if (!r.ok) {
    await env.DB.prepare(`UPDATE lp_reply_drafts SET send_error = ?, updated_at = ? WHERE id = ?`).bind(`invite: ${r.why}`.slice(0, 300), now, row.id).run();
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "invite_failed", detail: { why: r.why } });
    return { ok: false, line: ` The calendar invite could not be made (${r.why}); send it from your calendar for ${pickedText(row)}.` };
  }
  await env.DB.prepare(
    `UPDATE lp_reply_drafts SET status = 'scheduled', invite_event_id = ?, invite_for_start = ?, invite_sent_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(r.eventId, start, now, now, row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "lp_reply_drafts", entityId: row.id, action: "invite_sent", detail: { start, event: r.eventId } });
  return { ok: true, line: ` The calendar invite for ${pickedText(row)} went too.` };
}
