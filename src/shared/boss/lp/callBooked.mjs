/**
 * A CALL ON HER CALENDAR IS THE ANSWER (owner, 15 Nov 2026: "the call is set she should be doing
 * things right and make sure he never gets another outreach email ever").
 *
 * An LP who replied "ping me in mid-October" booked a call through Calendly; the invite landed on her
 * West Peek calendar and Monique still listed him as someone to keep warm. Monique's morning read now
 * looks for every person on the positive list among the attendees of her West Peek calendar's events,
 * past and upcoming. A match moves them out of "wants a call" / "keep warm" into a "Call booked" line
 * (or "Call held" once it is past), takes them out of Decide, and puts them on every do-not-contact
 * list the senders read.
 *
 * Pure, so the test can prove the matching and the words.
 */

const lc = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Is this calendar address the same person as the address on the list? The same address, or the same
 * local part at a sibling domain of the same organisation (one domain's first label begins with the
 * other's: person@examplefound.org and person@examplefoundation.org). Never a different local part.
 */
export function sameContact(a, b) {
  const [la, da = ""] = lc(a).split("@");
  const [lb, db = ""] = lc(b).split("@");
  if (!la || !lb || !da || !db || la !== lb) return false;
  if (da === db) return true;
  const fa = da.split(".")[0];
  const fb = db.split(".")[0];
  if (fa.length < 4 || fb.length < 4) return false;
  return fa.startsWith(fb) || fb.startsWith(fa);
}

/** Every address an event names: its attendees, and any address written in its notes (Calendly puts the invitee there). */
function eventAddresses(e) {
  const out = (e.attendees ?? []).filter((a) => !a.self && a.responseStatus !== "declined").map((a) => lc(a.email)).filter(Boolean);
  for (const m of String(e.description ?? "").match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) out.push(lc(m));
  return out;
}

/**
 * The call with this person, or null. `events` are calendar events with `scheduled_at` (ms),
 * `attendees` and optional `description`, `status`. The next upcoming call wins; with none ahead,
 * the most recent one held. Cancelled events never count.
 */
export function callFor(address, events, now = Date.now()) {
  const hits = (events ?? [])
    .filter((e) => e && e.status !== "cancelled" && Number.isFinite(Number(e.scheduled_at)))
    .filter((e) => eventAddresses(e).some((x) => sameContact(x, address)))
    .map((e) => Number(e.scheduled_at));
  if (!hits.length) return null;
  const ahead = hits.filter((t) => t >= now).sort((x, y) => x - y);
  if (ahead.length) return { start: ahead[0], held: false };
  return { start: Math.max(...hits), held: true };
}

/** "Mon 16 Nov, 12:00 PM CT" — always Central (jobs and her records are in Central). */
export function callWhen(start) {
  const d = new Date(Number(start));
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", weekday: "short", day: "numeric", month: "short" }).format(d).replace(/,/g, "");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${day}, ${time} CT`;
}

/** "Call booked: Mon 16 Nov, 12:00 PM CT", or "Call held: …" once the start has passed. */
export function callLine(start, now = Date.now()) {
  return `${Number(start) < now ? "Call held" : "Call booked"}: ${callWhen(start)}`;
}

/** The named stop written into her email when the calendar could not be read. Never a silent old list. */
export const CALENDAR_UNREAD_STOP = (why) =>
  `NAMED STOP [LP_CALENDAR_UNREAD] your West Peek calendar could not be read (${String(why ?? "unknown").slice(0, 100)}), so calls booked with LPs are not shown and the list below may be out of date. We are fixing it.`;
