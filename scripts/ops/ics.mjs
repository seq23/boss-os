/**
 * ICS, parsed to the four fields a diary row needs.
 *
 * ─── Why this is its own module ────────────────────────────────────────────
 *
 * The sync script that fetches the feeds needs a vault, a network and her secret URLs. The PARSING
 * needs none of those, and it is the half most likely to be quietly wrong — a naive reader loses
 * every wrapped title and every repeat. Separating it is what lets the tests cover the ICS handling
 * without a feed, and the script imports this rather than keeping a second copy.
 *
 * ─── The two things a naive parser gets wrong ──────────────────────────────
 *
 * FOLDED LINES. RFC 5545 wraps at 75 octets and continues with a leading space, so reading
 * line-by-line truncates exactly the field most likely to be long: the title.
 *
 * RECURRENCE. Her personal feed holds 4,527 events and a plain DTSTART read reports ZERO upcoming —
 * measured, on the real feed. The standing weekly is the case that matters, so DAILY and WEEKLY are
 * expanded and anything else is emitted ONCE and counted, rather than silently dropped.
 */

import { civilIn, instantAt, validZone } from "../../src/shared/boss/ownerTime.mjs";

/**
 * ICS unfolding, which is the one thing a naive parser always gets wrong.
 *
 * RFC 5545 wraps long lines at 75 octets and continues them with a leading space or tab. A parser
 * that reads line-by-line without joining those silently truncates every long summary — and a
 * meeting title is exactly the field most likely to be long.
 */
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

/**
 * `20260909T140000Z`, `20260909T110000` with a TZID, or `20260909` → epoch ms.
 *
 * ─── THE APPROXIMATION THAT WAS HERE, AND WHY IT HAD TO GO ─────────────────
 *
 * This used to treat a floating or TZID-qualified time as UTC, with a comment saying so. It looked
 * harmless and it was not: her standing Wednesday is `DTSTART;TZID=America/New_York:20260909T110000`,
 * and reading that as UTC put it in the diary at the wrong hour — beside the SAME meeting read
 * correctly from the Calendar API, so the screen showed one meeting twice, hours apart. A documented
 * approximation is still a wrong answer on a screen.
 *
 * The zone's clock is turned into an instant by the one shared rule (`instantAt`, ownerTime.mjs), which
 * reads the offset in force on that date. An unknown zone is treated as UTC rather than losing the event.
 */
function icsTime(value, params) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh = "09", mi = "00", ss = "00", z] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
  if (z) return naive;

  const tzid = /TZID=([^;:]+)/.exec(params ?? "")?.[1];
  // A date with no time and no zone is an all-day event; 09:00 UTC keeps it on the right day
  // everywhere she is likely to be, and an all-day event has no hour to be wrong about.
  if (!tzid) return naive;

  const zone = validZone(tzid);
  if (!zone) return naive;
  return instantAt(zone, Number(y), Number(mo), Number(d), Number(hh), Number(mi)) + Number(ss) * 1000;
}

/**
 * The events in a feed, within the horizon.
 *
 * RECURRENCE IS EXPANDED FOR DAILY AND WEEKLY ONLY, and anything else is emitted as its first
 * instance with a note. The standing Wednesday partner meeting is exactly the WEEKLY case, so
 * dropping repeats would have quietly lost the one recurring meeting she actually has. Monthly and
 * yearly rules, BYSETPOS, EXDATE and the rest are real work and are not pretended at: a repeat this
 * does not understand appears once rather than disappearing.
 */
/** An ICS TEXT value unescaped: \\n → newline, \\, \\; \\\\ → the character. */
/** An attendee's answer in a feed (PARTSTAT), in the Calendar API's words, so both readers agree. */
const PARTSTAT = { ACCEPTED: "accepted", TENTATIVE: "tentative", DECLINED: "declined", "NEEDS-ACTION": "needsAction" };

export function icsText(v) {
  return v == null ? v : String(v).replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

export function parseIcs(text, now = Date.now(), horizonDays = 28, backDays = 1) {
  const until = now + horizonDays * 86_400_000;
  const from = now - backDays * 86_400_000;
  const out = [];
  let unexpanded = 0;

  const blocks = unfold(text).split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0] ?? "");
  /*
   * ONE DAY OF A SERIES CHANGED ON ITS OWN WINS OVER THE SERIES (18 Nov 2026: she declined one
   * Wednesday of "Sequoia // Scooter Sync"; the feed carried that day's copy (RECURRENCE-ID) AND the
   * series' rule, so the day came out twice, once "accepted"). The series skips every start that has
   * its own copy, and every EXDATE (a day deleted from it).
   */
  const own = new Set();
  for (const b of blocks) {
    const uid = /^UID(?:;[^:\n]*)?:(.*)$/m.exec(b)?.[1]?.trim();
    const rid = /^RECURRENCE-ID(;[^:\n]*)?:(.*)$/m.exec(b);
    if (uid && rid) { const t = icsTime(rid[2].trim(), rid[1] ?? ""); if (t !== null) own.add(`${uid}|${t}`); }
    for (const ex of b.matchAll(/^EXDATE(;[^:\n]*)?:(.*)$/gm)) for (const v of ex[2].split(",")) { const t = icsTime(v.trim(), ex[1] ?? ""); if (uid && t !== null) own.add(`${uid}|${t}`); }
  }

  for (const body of blocks) {
    const isOverride = /^RECURRENCE-ID[;:]/m.test(body);
    const field = (name) => {
      const m = new RegExp(`^${name}(;[^:\\n]*)?:(.*)$`, "m").exec(body);
      return m ? { params: m[1] ?? "", value: m[2] ?? "" } : null;
    };

    const uid = field("UID")?.value?.trim();
    // RFC 5545 escapes "," ";" and "\\" in text (6 Nov 2026: a title reached her prep as "Ned <> Sequoia Taylor\\, West Peek").
    const summary = icsText(field("SUMMARY")?.value)?.trim();
    const dtstart = field("DTSTART");
    if (!uid || !summary || !dtstart) continue;
    // A cancelled event that stays in the diary is worse than one that never arrived.
    if (/^STATUS:CANCELLED$/m.test(body)) continue;

    const start = icsTime(dtstart.value, dtstart.params);
    if (start === null) continue;
    const dtend = field("DTEND");
    const end = dtend ? icsTime(dtend.value, dtend.params) : null;
    const duration = end && end > start ? Math.round((end - start) / 60000) : null;
    const location = icsText(field("LOCATION")?.value)?.trim() || null;
    // For Simone's meeting prep: who is invited, the notes, a join link (never posted to the diary).
    const attendees = [...body.matchAll(/^ATTENDEE([^:\n]*):(?:mailto:)?([^\s]+)$/gim)].map((m) => ({
      email: m[2].toLowerCase(), name: (/CN="?([^;":]+)"?/.exec(m[1])?.[1] ?? null), self: false, organizer: false,
      response: PARTSTAT[(/PARTSTAT=([A-Z-]+)/i.exec(m[1])?.[1] ?? "").toUpperCase()] ?? null,
    }));
    const description = (field("DESCRIPTION")?.value ?? "").replace(/\\n/g, "\n").replace(/\\([,;])/g, "$1").slice(0, 4000) || null;
    const joinUrl = /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com)\/[^\s"<>\\]+/.exec(`${location ?? ""} ${description ?? ""}`)?.[0] ?? null;
    const allDay = /^\d{8}$/.test(dtstart.value.trim());

    const rrule = field("RRULE")?.value ?? "";
    const push = (at, suffix = "") => {
      if (at < from || at > until) return;
      if (rrule && !isOverride && own.has(`${uid}|${at}`)) return;
      out.push({
        calendar_uid: `${uid}${suffix}`,
        title: summary.slice(0, 200),
        scheduled_at: at,
        duration_min: duration,
        location,
        ical_uid: uid,
        all_day: allDay,
        // The zone the meeting was set in (meeting prep shows it in brackets when hers differs).
        time_zone: /TZID=([^;:]+)/.exec(dtstart.params ?? "")?.[1] ?? null,
        attendees,
        description,
        join_url: joinUrl,
      });
    };

    if (!rrule) { push(start); continue; }

    const freq = /FREQ=([A-Z]+)/.exec(rrule)?.[1];
    const interval = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1) || 1;
    const untilRule = /UNTIL=([0-9TZ]+)/.exec(rrule)?.[1];
    const stopAt = untilRule ? (icsTime(untilRule, "") ?? until) : until;
    const count = Number(/COUNT=(\d+)/.exec(rrule)?.[1] ?? 0);

    if (freq !== "DAILY" && freq !== "WEEKLY") {
      // Emitted once rather than dropped, and counted so the run can say how many it did not expand.
      unexpanded += 1;
      push(start, "");
      continue;
    }

    const step = (freq === "DAILY" ? 1 : 7) * interval * 86_400_000;
    // A repeat keeps its WALL CLOCK in the zone it was set in (6 Nov 2026: a weekly 8am Central
    // sync set in October came out at 7am after the clocks went back, so the prep said 7am).
    const zone = validZone(/TZID=([^;:]+)/.exec(dtstart.params ?? "")?.[1] ?? null);
    const next = (t) => {
      if (!zone) return t + step;
      const w = civilIn(t, zone);
      return instantAt(zone, w.y, w.m, w.d + step / 86_400_000, w.h, w.min) + (t % 60_000);
    };
    let at = start;
    let n = 0;
    // Bounded hard: a malformed or infinite rule must not spin. The horizon is four weeks, so a
    // daily event is at most ~28 instances and this ceiling is never reached by a real feed.
    while (at <= Math.min(stopAt, until) && n < 400) {
      if (count && n >= count) break;
      push(at, n === 0 ? "" : `#${n}`);
      at = next(at);
      n += 1;
    }
  }

  return { events: out, unexpanded };
}

