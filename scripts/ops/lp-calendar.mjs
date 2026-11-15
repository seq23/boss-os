/**
 * HER FREE TIME FOR AN LP REPLY — BOTH CALENDARS, ONE LIST, HER ZONE (owner, 31 Oct 2026).
 *
 * Read by Monique's 06:15 LP run (lp-followups.mjs) before it holds a reply offering times:
 *
 *   busy      free/busy from EVERY Workspace calendar she keeps (`CAL_SUBJECTS`, calendar-sync.mjs:
 *             westpeek.ventures and spry.vc), each through its own delegated token, merged once
 *             (`mergeBusy`) so a meeting on both is one block, never two.
 *   homeZone  the zone her Google Calendar is set to (settings/timezone), the zone she is in when
 *             no "where I am until" setting says otherwise.
 *
 * FAIL CLOSED. If any one calendar cannot be read, no time is offered at all (`busy: null`): a time
 * offered off half her calendar could be a double booking. The reply then asks for their times.
 *
 * Free/busy only: no event title, guest or note is read here. No model, no name.
 */
import { CAL_SUBJECTS, calendarToken } from "./calendar-sync.mjs";
import { mergeBusy } from "../../src/shared/boss/lp/schedule.mjs";

const CAL = "https://www.googleapis.com/calendar/v3";
const DAY = 86_400_000;

async function json(tok, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  if (!r.ok) throw new Error(`the calendar answered ${r.status}`);
  return r.json();
}

/** One calendar's busy blocks (and, for the first, its zone). Throws a plain sentence on failure. */
async function busyOf(creds, subject, now, days) {
  const tok = await calendarToken(creds, subject);
  const j = await json(tok, `${CAL}/freeBusy`, {
    method: "POST",
    body: JSON.stringify({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + days * DAY).toISOString(), items: [{ id: subject }] }),
  });
  const cal = j?.calendars?.[subject];
  if (!cal || cal.errors?.length) throw new Error(`free/busy for ${subject.split("@")[1]} not readable`);
  const zone = await json(tok, `${CAL}/users/me/settings/timezone`).then((z) => z?.value ?? null).catch(() => null);
  return { busy: (cal.busy ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)]), zone };
}

/**
 * `{ busy, homeZone, read, why }` — busy is null (and why says which) when any calendar failed.
 * The home zone is the first calendar's setting (westpeek.ventures, the LP mailbox's own).
 */
export async function herBusyAndZone(creds, { now = Date.now(), days = 21, subjects = CAL_SUBJECTS } = {}) {
  const lists = [];
  let homeZone = null;
  for (const subject of subjects) {
    try {
      const r = await busyOf(creds, subject, now, days);
      lists.push(r.busy);
      homeZone = homeZone ?? r.zone;
    } catch (e) {
      return { busy: null, homeZone, read: lists.length, why: String(e?.message ?? e).slice(0, 120) };
    }
  }
  if (!lists.length) return { busy: null, homeZone, read: 0, why: "no calendar is configured" };
  return { busy: mergeBusy(lists), homeZone, read: lists.length, why: null };
}

/**
 * CALLS BOOKED WITH LPs (owner, 15 Nov 2026: "the call is set she should be doing things right").
 * Every event on her West Peek calendar from `since` to `aheadDays` out, with its attendees and notes
 * (a Calendly booking names the invitee in both), for `callFor` (src/shared/boss/lp/callBooked.mjs).
 * Read-only (calendar.readonly). Throws a plain sentence on failure: the caller writes a NAMED STOP
 * into her email, never a silent old list.
 */
export async function herEvents(creds, { now = Date.now(), since = Date.parse("2026-07-01T00:00:00Z"), aheadDays = 180, subject = CAL_SUBJECTS[0] } = {}) {
  const tok = await calendarToken(creds, subject);
  const out = [];
  let page = null;
  do {
    const u = new URL(`${CAL}/calendars/primary/events`);
    u.searchParams.set("timeMin", new Date(since).toISOString());
    u.searchParams.set("timeMax", new Date(now + aheadDays * DAY).toISOString());
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("maxResults", "2500");
    if (page) u.searchParams.set("pageToken", page);
    const j = await json(tok, u.toString());
    for (const e of j.items ?? []) {
      const at = Date.parse(e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T15:00:00Z` : ""));
      if (!Number.isFinite(at)) continue;
      out.push({ scheduled_at: at, status: e.status ?? null, description: e.description ? String(e.description).slice(0, 4000) : null,
        attendees: (e.attendees ?? []).map((a) => ({ email: a.email ?? null, self: Boolean(a.self), responseStatus: a.responseStatus ?? null })) });
    }
    page = j.nextPageToken ?? null;
  } while (page && out.length < 20_000);
  return out;
}
