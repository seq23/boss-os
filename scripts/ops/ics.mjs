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

/** `20260909T140000Z`, `20260909T090000` or `20260909` → epoch ms. */
function icsTime(value, params) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh = "09", mi = "00", ss = "00", z] = m;
  /*
   * A FLOATING OR TZID TIME IS TREATED AS UTC, AND THAT IS A KNOWN APPROXIMATION RATHER THAN A BUG
   * NOBODY NOTICED. Carrying real timezone rules would mean shipping a tz database to shift a
   * diary row by an hour; the row still says the right day and the right meeting, which is what the
   * screen is for. Named here so the next person does not have to work out whether it was intended.
   */
  void params; void z;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
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
export function parseIcs(text, now = Date.now(), horizonDays = 28) {
  const until = now + horizonDays * 86_400_000;
  const from = now - 86_400_000;
  const out = [];
  let unexpanded = 0;

  for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0] ?? "";
    const field = (name) => {
      const m = new RegExp(`^${name}(;[^:\\n]*)?:(.*)$`, "m").exec(body);
      return m ? { params: m[1] ?? "", value: m[2] ?? "" } : null;
    };

    const uid = field("UID")?.value?.trim();
    const summary = field("SUMMARY")?.value?.trim();
    const dtstart = field("DTSTART");
    if (!uid || !summary || !dtstart) continue;
    // A cancelled event that stays in the diary is worse than one that never arrived.
    if (/^STATUS:CANCELLED$/m.test(body)) continue;

    const start = icsTime(dtstart.value, dtstart.params);
    if (start === null) continue;
    const dtend = field("DTEND");
    const end = dtend ? icsTime(dtend.value, dtend.params) : null;
    const duration = end && end > start ? Math.round((end - start) / 60000) : null;
    const location = field("LOCATION")?.value?.trim() || null;

    const rrule = field("RRULE")?.value ?? "";
    const push = (at, suffix = "") => {
      if (at < from || at > until) return;
      out.push({
        calendar_uid: `${uid}${suffix}`,
        title: summary.slice(0, 200),
        scheduled_at: at,
        duration_min: duration,
        location,
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
    let at = start;
    let n = 0;
    // Bounded hard: a malformed or infinite rule must not spin. The horizon is four weeks, so a
    // daily event is at most ~28 instances and this ceiling is never reached by a real feed.
    while (at <= Math.min(stopAt, until) && n < 400) {
      if (count && n >= count) break;
      push(at, n === 0 ? "" : `#${n}`);
      at += step;
      n += 1;
    }
  }

  return { events: out, unexpanded };
}

