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
