#!/usr/bin/env node
/**
 * CALLS BOOKED WITH LPs: the one place that reads her calendar's events with their guests.
 * Kept apart from lp-calendar.mjs, which reads free/busy only and feeds the reply drafter.
 * What this reads is matched by code (src/shared/boss/lp/callBooked.mjs) and never sent to a model.
 */
import { CAL_SUBJECTS, calendarToken } from "./calendar-sync.mjs";

const CAL = "https://www.googleapis.com/calendar/v3";
const DAY = 86_400_000;

async function json(tok, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  if (!r.ok) throw new Error(`the calendar answered ${r.status}`);
  return r.json();
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
