/**
 * HER TAP ON A "GO?" CARD: Yes, go · No · Not sure (owner-approved plan, 8 Nov 2026).
 *
 * HER TAP IS THE OK TO SEND, AND THE ONLY ONE. A GET never acts (mail scanners fetch every link): it
 * renders a page that POSTs itself, with a button for a phone without script. The POST claims the row
 * atomically (`claimTap`: open or unsure → her answer) BEFORE anything is sent, so a second tap, a
 * replayed link or a scanner changes nothing. Only after the claim:
 *   Yes  · calendar invite → accepted on that calendar (Google tells the organizer); not on a calendar
 *          Simone may write (Spry Ventures, read-only) → put on her calendar, and she answers in Gmail.
 *        · platform event → put on her calendar; the RSVP page is a button for HER. Boss OS never
 *          fetches an outside RSVP link.
 *        · personal email → the yes the card showed word for word, on their thread; and her calendar.
 *   No   · the card goes away. A decline only when the invitation asks for an answer: a calendar
 *          decline, or the "can't make it" the card showed. Never from Spry Ventures.
 *   Not sure → held; asked again 3 days before (or the day after, under 3 days away), exactly once.
 */
import type { Context } from "hono";
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { answerInvite, putOnCalendar, sendOne, mailboxAllowed } from "../commands/google";
import { HER_CALENDAR, centralDay, unsureAskDay, dayWords, gmailLink } from "../../../shared/boss/invitations/invitations.mjs";

export const isInviteToken = (t: string) => /^iv[A-Za-z0-9]{30}$/.test(t);

const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(title: string, line: string, opts: { form?: { action: string; label: string }; link?: { label: string; url: string } } = {}) {
  const auto = opts.form
    ? `<form id="f" method="post" action="${esc(opts.form.action)}"><button type="submit">${esc(opts.form.label)}</button></form><script>document.getElementById("f").submit();</script>`
    : "";
  const link = opts.link ? `<p><a class="b" href="${esc(opts.link.url)}" rel="noopener">${esc(opts.link.label)}</a></p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#222;margin:0;padding:48px 20px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}
button,.b{font:inherit;display:inline-block;padding:14px 28px;border-radius:10px;border:0;background:#1f4d3a;color:#fff;text-decoration:none;min-height:44px}
</style></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p>${auto}${link}</body></html>`;
}

const ANSWERS: Record<string, string> = { yes: "Saying yes…", no: "Saying no…", unsure: "Holding it for later…" };
const byToken = (db: D1Database, t: string) => db.prepare(`SELECT * FROM owner_invitations WHERE tap_token = ?`).bind(t).first<any>();

export async function inviteTapGet(c: Context<any>, token: string): Promise<Response> {
  const row = await byToken(c.env.DB, token);
  const d = c.req.query("do") ?? "";
  if (!row || !ANSWERS[d]) return c.html(page("This link has done its job", "Nothing else to do here."));
  if (!["open", "unsure"].includes(row.status)) return c.html(page("Already answered", `You already answered "${row.title}". Nothing else to do here.`));
  return c.html(page(ANSWERS[d]!, "One moment.", { form: { action: `?do=${d}`, label: "Tap to confirm" } }));
}

/** Her tap, claimed once: open/unsure → her answer. Returns the row as it was, or null if already answered. */
export async function claimTap(db: D1Database, token: string, answer: "yes" | "no" | "unsure", now: number): Promise<any | null> {
  const row = await byToken(db, token);
  if (!row) return null;
  const today = centralDay(now);
  const r = answer === "unsure"
    ? await db.prepare(`UPDATE owner_invitations SET status = 'unsure', next_ask_day = ?, answered_at = ?, updated_at = ? WHERE tap_token = ? AND status IN ('open','unsure')`)
      .bind(unsureAskDay(row.starts_at, today), now, now, token).run()
    : await db.prepare(`UPDATE owner_invitations SET status = ?, answered_at = ?, answered_before_event = ?, updated_at = ? WHERE tap_token = ? AND status IN ('open','unsure')`)
      .bind(answer, now, now < row.starts_at ? 1 : 0, now, token).run();
  return (r.meta?.changes ?? 0) > 0 ? row : null;
}

/** After her claimed tap only. Every send is the exact words the card showed. */
async function act(env: Env, row: any, answer: "yes" | "no"): Promise<{ line: string; link?: { label: string; url: string } }> {
  const writable = mailboxAllowed(row.inbox);
  const note = "You said yes from your Go? card in Boss OS.";
  const onHerCalendar = () => putOnCalendar(env, { mailbox: HER_CALENDAR, title: row.title, start: row.starts_at, end: row.ends_at, allDay: row.all_day === 1, where: row.location, note });
  const reply = (text: string) => sendOne(env, {
    from: row.inbox, to: row.from_address, subject: /^re:/i.test(row.subject ?? "") ? row.subject : `Re: ${row.subject ?? row.title}`,
    text, inReplyTo: row.rfc_message_id, threadId: row.gmail_thread_id,
  });
  if (answer === "yes") {
    if (row.kind === "calendar" && writable && row.ics_uid) {
      const r = await answerInvite(env, { mailbox: row.inbox, uid: row.ics_uid, response: "accepted" });
      if (r.ok) return { line: `You're going. ${row.title} is accepted and on your calendar.` };
      if (!r.notOnCalendar) return { line: `Simone could not accept it (${r.why}). Open the invite in Gmail and tap Yes there.`, link: { label: "Open it in Gmail ›", url: gmailLink(row) } };
    }
    const cal = await onHerCalendar();
    const placed = cal.ok ? `${row.title} is on your calendar.` : `It could not be put on your calendar (${cal.why}).`;
    if (row.kind === "platform") return { line: `${placed} Now say yes on ${row.platform ?? "their"} page yourself.`, ...(row.rsvp_url ? { link: { label: "Open the RSVP page ›", url: row.rsvp_url } } : {}) };
    if (row.kind === "personal" && writable && row.reply_text && row.from_address) {
      const s = await reply(row.reply_text);
      return { line: s.ok ? `Your yes is sent. ${placed}` : `Your yes was not sent (${s.why}). ${placed}`, ...(s.ok ? {} : { link: { label: "Write back in Gmail ›", url: gmailLink(row) } }) };
    }
    return { line: `${placed} Answer them yourself in Gmail; Spry Ventures mail is never sent from here.`, link: { label: "Answer in Gmail ›", url: gmailLink(row) } };
  }
  // No.
  if (!writable) return { line: "The card is gone. Nothing was sent." };
  if (row.kind === "calendar" && row.ics_uid) {
    const r = await answerInvite(env, { mailbox: row.inbox, uid: row.ics_uid, response: "declined" });
    return { line: r.ok ? "Declined. The organizer has your no and the card is gone." : `The card is gone, but the decline did not go (${r.why}).` };
  }
  if (row.kind === "personal" && row.asks_answer === 1 && row.decline_text && row.from_address) {
    const s = await reply(row.decline_text);
    return { line: s.ok ? "Your note is sent and the card is gone." : `The card is gone, but your note was not sent (${s.why}).` };
  }
  return { line: "The card is gone. Nothing was sent." };
}

export async function inviteTapPost(c: Context<any>, token: string): Promise<Response> {
  const env = c.env as Env;
  const d = c.req.query("do") ?? "";
  if (!ANSWERS[d]) return c.html(page("This link has done its job", "Nothing else to do here."));
  const now = Date.now();
  const row = await claimTap(env.DB, token, d as "yes" | "no" | "unsure", now);
  if (!row) {
    const known = await byToken(env.DB, token);
    return c.html(known ? page("Already answered", `You already answered "${known.title}". Nothing else to do here.`) : page("This link has done its job", "Nothing else to do here."));
  }
  if (d === "unsure") {
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "owner_invitations", entityId: row.id, action: "invitation_unsure", detail: { via: "one_tap" } });
    const back = unsureAskDay(row.starts_at, centralDay(now));
    return c.html(page("Held for later", row.unsure_asks >= 1 ? "It will not be asked again; it goes away on the day." : `Simone will ask again on ${dayWords(back)}.`));
  }
  const done = await act(env, row, d as "yes" | "no");
  // The card is closed: the outgoing words and links are not kept past it.
  await env.DB.prepare(`UPDATE owner_invitations SET act_result = ?, reply_text = NULL, decline_text = NULL, subject = NULL, rsvp_url = NULL, updated_at = ? WHERE id = ?`)
    .bind(done.line.slice(0, 300), Date.now(), row.id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "owner_invitations", entityId: row.id, action: `invitation_${d}`, detail: { via: "one_tap", kind: row.kind } });
  return c.html(page(d === "yes" ? "You're going ✓" : "No ✓", done.line, done.link ? { link: done.link } : {}));
}
