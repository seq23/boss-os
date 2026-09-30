import type { Env } from "../env";

/**
 * WHAT SHE HAS COMING UP. That is the whole question this answers.
 *
 * ─── Her correction ────────────────────────────────────────────────────────
 *
 *   "this tab is suppose to show what meetings i have upcoming. i should be able to input what
 *    meetings i have and it should check my calendars for meetings and if there is a packet or
 *    deliverable for a meeting i should see that in a link"
 *
 * The section had become a packet reader: it rendered the entire Wednesday document inline while
 * its collapsed summary line — computed from a different source — said "Nothing in the diary". A
 * row is now four things and no more: what it is, when, who with, and a link if there is one.
 *
 * ─── One list, assembled from three places ─────────────────────────────────
 *
 *   · `diary_entries` — what she typed, and what a connected calendar supplied.
 *   · `meetings` — the relationship CRM, which has a person, a brief and a capture. Real meetings
 *     live there too and she should not have to check two screens.
 *   · The standing Wednesday, DERIVED rather than stored, so it is in the diary whether or not any
 *     job ran. A fixture that depends on a generator disappears the week the generator breaks.
 *
 * ─── The summary is computed from the rows it summarises ───────────────────
 *
 * `summary` is returned beside `rows` and derived from them, because the defect that started this
 * was a collapsed line saying one thing while the body showed another. They cannot disagree now:
 * there is one array and the sentence counts it.
 */

export interface DiaryRow {
  id: string;
  title: string;
  /** In her words. Not a foreign key, and never derived from reading her mail. */
  with: string | null;
  scheduled_at: number;
  duration_min: number | null;
  location: string | null;
  /** manual · calendar · recurring · crm — so she can tell what she typed from what was read. */
  source: string;
  /** True only for the derived standing fixture, which has no row and cannot be edited or deleted. */
  standing: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Every occurrence of a weekly entry inside the window.
 *
 * ONE ROW AND A RULE, EXPANDED ON READ. "every Wednesday, Scooter" is typed once; materialising a
 * year of it would mean a generator that can fall behind, rows to backfill when she moves it, and a
 * fixture that vanishes the week the generator breaks. Expanding here cannot go stale.
 *
 * Bounded hard at the window rather than by a count, so a row with a bad `scheduled_at` cannot spin.
 */
function occurrences(startAt: number, from: number, until: number, recurUntil: number | null): number[] {
  const stop = Math.min(until, recurUntil ?? until);
  const out: number[] = [];
  if (startAt > stop) return out;

  // Wind forward to the first occurrence at or after the window's start, in whole weeks so the
  // weekday and the time of day are preserved exactly as she entered them.
  let at = startAt;
  if (at < from) at += Math.ceil((from - at) / (7 * DAY_MS)) * 7 * DAY_MS;
  while (at <= stop && out.length < 60) {
    out.push(at);
    at += 7 * DAY_MS;
  }
  return out;
}

export async function diary(env: Env, now = Date.now(), horizonDays = 21): Promise<{
  rows: DiaryRow[];
  summary: string;
  calendar: { connected: string[]; unreadable: string[]; note: string };
}> {
  const until = now + horizonDays * DAY_MS;
  const from = now - DAY_MS;

  const [entries, crm, calProbes] = await Promise.all([
    /*
     * A WEEKLY ROW IS NOT FILTERED BY ITS OWN START DATE. The standing Wednesday was entered once,
     * so its `scheduled_at` recedes into the past for ever; a `BETWEEN` on it would drop the one
     * recurring meeting she actually has from the moment the second week began.
     */
    env.DB
      .prepare(
        `SELECT id, title, counterpart, scheduled_at, duration_min, location, source,
                recurrence, recur_until, note
           FROM diary_entries
          WHERE cancelled_at IS NULL
            AND (recurrence = 'weekly' OR scheduled_at BETWEEN ? AND ?)
          ORDER BY scheduled_at`,
      )
      .bind(from, until)
      .all<any>(),
    env.DB
      .prepare(
        `SELECT m.id, m.title, m.scheduled_at, m.duration_min, m.location, p.full_name
           FROM meetings m LEFT JOIN people p ON p.id = m.person_id
          WHERE m.status != 'cancelled' AND m.scheduled_at BETWEEN ? AND ?
          ORDER BY m.scheduled_at`,
      )
      .bind(from, until)
      .all<any>(),
    env.DB
      .prepare(
        `SELECT id, label, state, detail FROM credential_probes WHERE id LIKE 'cred_cal_%' ORDER BY id`,
      )
      .all<{ id: string; label: string; state: string; detail: string | null }>()
      .catch(() => ({ results: [] as any[] })),
  ]);

  const rows: DiaryRow[] = [];

  /*
   * ── WHAT SHE TYPED, WEEKLY ONES EXPANDED ─────────────────────────────────
   *
   * "im telling u its a standing meeting so this is a manual meeting addition." The Wednesday
   * partner meeting is a row in this table like any other, entered once with a weekly rule, and it
   * is in the diary whether or not the packet job ran — so a failed packet reads as a meeting with
   * no packet rather than as no meeting, which is what the screen showed on 9 September.
   */
  for (const e of entries.results ?? []) {
    const times =
      e.recurrence === "weekly"
        ? occurrences(e.scheduled_at, from, until, e.recur_until ?? null)
        : [e.scheduled_at];
    for (const at of times) {
      rows.push({
        // The row id stays the entry's for a one-off so Cancel works, and carries the date for a
        // repeat so two occurrences are not the same key on the screen.
        id: times.length > 1 ? `${e.id}@${new Date(at).toISOString().slice(0, 10)}` : e.id,
        title: e.title,
        with: e.counterpart,
        scheduled_at: at,
        duration_min: e.duration_min,
        location: e.location,
        source: e.recurrence === "weekly" ? "recurring" : e.source,
        standing: e.recurrence === "weekly",
      });
    }
  }

  for (const m of crm.results ?? []) {
    rows.push({
      id: m.id,
      title: m.title,
      with: m.full_name ?? null,
      scheduled_at: m.scheduled_at,
      duration_min: m.duration_min,
      location: m.location,
      source: "crm",
      standing: false,
    });
  }

  rows.sort((a, b) => a.scheduled_at - b.scheduled_at);

  /*
   * ── ONE MEETING, ONE ROW, WHICHEVER SOURCE FOUND IT ───────────────────────
   *
   * The standing Wednesday is BOTH a manual entry she typed and "Sequoia // Scooter Sync" recurring
   * at 11:00 on the West Peek calendar — which nothing could read until the Calendar API was enabled
   * in the GCP project. Now that both sources see it, showing it twice would make the diary look
   * broken in the one place it was most obviously broken this morning.
   *
   * MATCHED ON DAY AND HOUR, AND WHAT SHE TYPED WINS. Two meetings genuinely an hour apart are
   * different meetings; the same meeting recorded twice differs by minutes and by wording, and the
   * hour is the coarsest key that separates those. Hers wins because she chose the title, and
   * because a calendar entry silently replacing the row she typed is the screen overruling her.
   */
  const merged: DiaryRow[] = [];
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

  for (const r of rows) {
    /*
     * ── ONE MEETING CAN ARRIVE THREE TIMES, AT THREE DIFFERENT HOURS ─────────
     *
     * Her standing Wednesday exists as a row she typed, as an event on the Calendar API, and as the
     * same event in the iCal feed. Matching on the exact hour caught none of them, and the reason is
     * worth writing down because it is not a bug anyone would guess at:
     *
     *     "start": { "dateTime": "2026-09-09T11:00:00-05:00", "timeZone": "America/New_York" }
     *
     * THE OFFSET AND THE LABEL DISAGREE. New York is at -04:00 in September; the stored offset is
     * -05:00. RFC 3339 makes the offset authoritative, so the API's instant is right — and the iCal
     * feed carries only `TZID=America/New_York`, so honouring the label faithfully lands an hour
     * away from the same meeting. Both readings are defensible and they differ.
     *
     * So the merge is tolerant on TIME and strict on IDENTITY: same calendar day, and either a
     * recognisably similar title or compatible counterparts within two hours. Two genuinely
     * different meetings do not share a day AND a title.
     */
    const existing = merged.find((m) => {
      if (day(m.scheduled_at) !== day(r.scheduled_at)) return false;
      const [ta, tb] = [norm(m.title), norm(r.title)];
      if (ta && tb && (ta === tb || ta.includes(tb) || tb.includes(ta))) return true;
      const [a, b] = [(m.with ?? "").toLowerCase(), (r.with ?? "").toLowerCase()];
      const compatible = a === b || a === "" || b === "";
      return compatible && Math.abs(m.scheduled_at - r.scheduled_at) <= 2 * 3_600_000;
    });
    if (!existing) { merged.push(r); continue; }
    // Keep the one she typed; fold in anything only the calendar knew.
    /*
     * WHAT SHE TYPED WINS ON WORDING; THE CALENDAR WINS ON TIME. She chose the title and a feed
     * silently replacing it is the screen overruling her — but she typed "Wednesday" and the
     * calendar knows it is 11:00, and of the two sources the API is the one with an unambiguous
     * instant. Everything only one of them knew is folded in rather than dropped.
     */
    if (existing.source === "calendar" && r.source !== "calendar") {
      const when = existing.scheduled_at;
      Object.assign(existing, r, {
        scheduled_at: when,
        location: r.location ?? existing.location,
        duration_min: r.duration_min ?? existing.duration_min,
      });
    } else if (r.source === "calendar") {
      existing.scheduled_at = r.scheduled_at;
      existing.location = existing.location ?? r.location;
      existing.duration_min = existing.duration_min ?? r.duration_min;
    }
  }
  // Sorted again: the merge can move a row's time to the calendar's, which can reorder the day.
  merged.sort((a, b) => a.scheduled_at - b.scheduled_at);
  rows.length = 0;
  rows.push(...merged);

  /*
   * ── THE SUMMARY, COMPUTED FROM THE ROWS ABOVE AND NOTHING ELSE ────────────
   *
   * The line that read "Nothing in the diary" over a full agenda was counting a different table
   * from the one the body rendered. There is one array now and this sentence counts it, so the
   * collapsed state cannot contradict what opening it shows.
   */
  const today = new Date(now).toISOString().slice(0, 10);
  const todays = rows.filter((r) => new Date(r.scheduled_at).toISOString().slice(0, 10) === today);
  const next = rows.find((r) => r.scheduled_at >= now);
  const summary =
    rows.length === 0
      ? "Nothing in the next three weeks. Add one below."
      : todays.length > 0
        ? `${todays.length} today. ${rows.length} in the next three weeks.`
        : `Nothing today. Next: ${next?.title ?? "—"} on ${new Date(next?.scheduled_at ?? now).toISOString().slice(0, 10)}. ${rows.length} in the next three weeks.`;

  /*
   * ── WHICH CALENDARS ARE ACTUALLY IN HERE ──────────────────────────────────
   *
   * A PARTIAL CALENDAR PRESENTED AS COMPLETE IS WORSE THAN MANUAL ENTRY, because she would trust it
   * and stop typing the ones it cannot see. So the screen names what is connected and what is not,
   * and the personal one is named as permanently unreachable rather than as pending — domain-wide
   * delegation cannot leave a Workspace domain, which is the same wall the KDP mail hit.
   */
  /*
   * ── WHAT IS CONNECTED, AND WHAT IT ACTUALLY HOLDS ─────────────────────────
   *
   * CONNECTED IS NOT THE SAME AS USEFUL, and saying only the first would be the reassuring half of
   * a true sentence. Her three connected feeds hold 4,527, 835 and 0 events, and between them ONE
   * is dated today or later. They are records of what happened; her forward schedule is not in
   * Google at all. A screen that said "3 calendars connected" and stopped would imply a completeness
   * that does not exist, and she would stop typing the meetings it cannot see — which is how the
   * original defect gets rebuilt on better plumbing.
   */
  const probes = (calProbes as { results?: any[] }).results ?? [];
  const connected = probes.filter((p) => p.state === "live");
  const notConnected = probes.filter((p) => p.state !== "live");
  const fromFeeds = rows.filter((r) => r.source === "calendar").length;

  return {
    rows,
    summary,
    calendar: {
      connected: connected.map((p) => p.label),
      unreadable: notConnected.map((p) => `${p.label} — ${p.detail ?? "not connected yet"}`),
      note:
        connected.length === 0
          ? "No calendar feed is connected, so this diary holds exactly what you type. That is the primary route rather than a fallback."
          : `${connected.length} calendar feed(s) are connected and they contributed ${fromFeeds} of the entries below. ` +
            "They are mostly archives — your forward schedule is not really in Google — so what you type is still the spine of this, not the backup.",
    },
  };
}
