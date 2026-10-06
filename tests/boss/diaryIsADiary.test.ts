import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { diary } from "../../src/worker/boss/today/diary";
import { parseIcs } from "../../scripts/ops/ics.mjs";

/**
 * THE MEETINGS SECTION IS A DIARY.
 *
 * ─── Her words, with a screenshot ───────────────────────────────────────────
 *
 *   "this meetings tab needs work. it says Nothing in the diary when the meeting tab is closed then
 *    u open to all this stuff. this stuff is unnecessary. this tab is suppose to show what meetings
 *    i have upcoming. i should be able to input what meetings i have and it should check my
 *    calendars for meetings and if there is a packet or deliverable for a meeting i should see that
 *    in a link"
 *
 * ─── The test that matters is the first one ────────────────────────────────
 *
 * `the collapsed line cannot contradict what opening it shows` is the guard. The section said
 * "Nothing in the diary" and opened onto a full agenda because the summary counted the CRM meetings
 * table while the body rendered the packet — two sentences, each true about the thing it was looking
 * at, and a lie together. This asserts they come from the same array.
 */

/*
 * THE SEEDED STANDING WEDNESDAY IS NOT DELETED BETWEEN TESTS. It is the row several of these
 * assertions are about — "im telling u its a standing meeting so this is a manual meeting addition"
 * — and a clean that removed it would have the suite testing a diary she does not have.
 */
async function clean() {
  await env.DB.prepare(`DELETE FROM diary_entries WHERE id != 'dia_standing_scooter'`).run();
}
beforeEach(clean);

describe("the collapsed line and the rows", () => {
  it("cannot contradict what opening it shows", async () => {
    const empty = await diary(env as any);
    /*
     * The standing Wednesday is always in the diary, so "nothing" is never the honest answer while
     * it is there. The invariant asserted is the relationship, not a fixed string: if the summary
     * says nothing is in it, the rows must be empty, and if there are rows the summary must count
     * them. That is exactly what the old screen violated.
     */
    if (empty.rows.length === 0) expect(empty.summary).toMatch(/Nothing in the next three weeks/);
    else expect(empty.summary).toMatch(new RegExp(`${empty.rows.length} in the next three weeks`));

    await apiJson<any>("/api/diary", {
      method: "POST",
      body: { title: "A call about the warehouse", counterpart: "Ray", scheduled_at: Date.now() + 3 * 86_400_000 },
    });

    const after = await diary(env as any);
    expect(after.rows.length).toBe(empty.rows.length + 1);
    expect(after.summary).toMatch(new RegExp(`${after.rows.length} in the next three weeks`));
  });
});

describe("a row", () => {
  it("carries no packet link at all — the Wednesday packet was removed at the owner's instruction (30 Sep 2026)", async () => {
    const standing = (await diary(env as any)).rows.find((r) => r.standing);
    expect(standing).toBeTruthy();
    expect(standing!.with).toBe("Scooter");
    expect(Object.keys(standing!)).not.toContain("packet_url");
    expect(Object.keys(standing!)).not.toContain("packet_day");
  });

  it("keeps the standing Wednesday whether or not any job ran", async () => {
    /*
     * The section was blank on 9 September — a Wednesday — because a standing partner meeting has no
     * calendar row and nothing produced one. It is a manual entry with a weekly rule now, expanded
     * on read: "im telling u its a standing meeting so this is a manual meeting addition." A failed
     * packet job shows as a meeting with no packet rather than as no meeting.
     */
    const rows = (await diary(env as any)).rows;
    const standing = rows.find((r) => r.standing)!;
    /*
     * ASSERTED IN HER ZONE, NOT IN UTC. The meeting is 11:00 America/Chicago, which is 16:00 UTC —
     * still a Wednesday, but the first version of this test asked `getUTCDay()` of a row whose UTC
     * hour had moved and would have gone wrong the moment the time was corrected. A diary row is a
     * wall-clock fact about her week; checking it in UTC is checking a different question.
     */
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long" })
      .format(new Date(standing.scheduled_at));
    expect(weekday).toBe("Wednesday");
    expect(standing.source).toBe("recurring");
  });
});

describe("writing in it", () => {
  it("refuses one with no time, because a diary row without a time is not one", async () => {
    const res = await apiJson<any>("/api/diary", { method: "POST", body: { title: "Sometime" } });
    expect(res.status).toBe(400);
  });

  it("cancels rather than deletes, so a moved meeting is distinguishable from one that never was", async () => {
    /*
     * NEVER ON A WEDNESDAY. The diary merges two rows on the same day within two hours when either
     * has no counterpart — that is how her standing Wednesday, typed once and also in two calendar
     * feeds, shows once. "Tomorrow" on a Tuesday lands beside that standing row and was merged into
     * it, so this test failed every Tuesday around midday (found 6 Oct 2026). The row is placed on
     * a day the standing meeting never occupies; the assertion is unchanged.
     */
    const tomorrow = Date.now() + 86_400_000;
    const at = new Date(tomorrow).getUTCDay() === 3 ? tomorrow + 86_400_000 : tomorrow;
    const added = await apiJson<any>("/api/diary", {
      method: "POST",
      body: { title: "A thing", scheduled_at: at },
    });
    const row = added.body.data.rows.find((r: any) => r.title === "A thing");
    await apiJson<any>(`/api/diary/${row.id}/cancel`, { method: "POST", body: {} });

    const after = await diary(env as any);
    expect(after.rows.some((r) => r.id === row.id)).toBe(false);
    const kept = await env.DB.prepare(`SELECT cancelled_at FROM diary_entries WHERE id = ?`).bind(row.id).first<any>();
    expect(kept.cancelled_at).toBeGreaterThan(0);
  });
});

describe("the calendar feeds", () => {
  it("refuses a sync that read nothing", async () => {
    /*
     * "The calendar is clear" and "the job could not read the calendar" render identically once both
     * are zero rows, and only one of them means she has a clear fortnight.
     */
    const res = await apiJson<any>("/api/diary/sync", { method: "POST", body: { events: [] } });
    expect(res.status).toBe(400);
  });

  it("upserts on the calendar id, so running the job twice does not double the diary", async () => {
    const at = Date.now() + 2 * 86_400_000;
    const body = { events: [{ calendar_uid: "abc123@google.com", title: "Board call", scheduled_at: at }] };
    await apiJson<any>("/api/diary/sync", { method: "POST", body });
    await apiJson<any>("/api/diary/sync", { method: "POST", body });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM diary_entries WHERE calendar_uid = 'abc123@google.com'`).first<any>();
    expect(n.n).toBe(1);
  });

  it("does not show a meeting twice when she typed it and the calendar also has it", async () => {
    /*
     * THE STANDING WEDNESDAY IS IN BOTH SOURCES. She typed it — "im telling u its a standing meeting
     * so this is a manual meeting addition" — and it is also "Sequoia // Scooter Sync" recurring at
     * 11:00 on the West Peek calendar, which nothing could read until the Calendar API was enabled
     * in the GCP project. Showing it twice would make the diary look broken in exactly the place it
     * was most obviously broken this morning.
     *
     * HERS WINS. A calendar entry silently replacing the row she typed is the screen overruling her.
     */
    const before = (await diary(env as any)).rows;
    const standing = before.find((r) => r.standing)!;

    await apiJson<any>("/api/diary/sync", {
      method: "POST",
      body: {
        events: [{
          calendar_uid: "scootersync_abc@google.com",
          title: "Sequoia // Scooter Sync",
          scheduled_at: standing.scheduled_at,
          location: "Google Meet",
        }],
      },
    });

    const after = (await diary(env as any)).rows;
    const atThatHour = after.filter(
      (r) => new Date(r.scheduled_at).toISOString().slice(0, 13) === new Date(standing.scheduled_at).toISOString().slice(0, 13),
    );
    expect(atThatHour).toHaveLength(1);
    // Her title survives; what only the calendar knew is folded in.
    expect(atThatHour[0]!.title).toBe(standing.title);
    expect(atThatHour[0]!.location).toBe("Google Meet");
  });

  it("names which calendars are in here and which are not", async () => {
    const cal = (await diary(env as any)).calendar;
    // A partial calendar presented as complete is worse than manual entry, because she would trust
    // it and stop typing the ones it cannot see.
    // Each feed appears in exactly one of the two lists, and never in neither.
    expect(cal.connected.length + cal.unreadable.length).toBeGreaterThan(0);
    expect(cal.note.length).toBeGreaterThan(20);
  });
});

describe("the ICS parser", () => {
  const now = Date.UTC(2026, 8, 9, 6, 0, 0);

  it("reads a plain event", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT",
      "UID:one@google.com", "SUMMARY:Coffee with Ray",
      "DTSTART:20260910T140000Z", "DTEND:20260910T150000Z",
      "LOCATION:The office",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics, now, 21);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Coffee with Ray");
    expect(events[0]!.duration_min).toBe(60);
    expect(events[0]!.location).toBe("The office");
  });

  it("unfolds a wrapped line instead of truncating the title", () => {
    /*
     * RFC 5545 wraps at 75 octets and continues with a leading space. A parser that reads
     * line-by-line silently truncates every long summary — and a meeting title is the field most
     * likely to be long.
     */
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:two@google.com",
      "SUMMARY:A meeting with a very long name that the calendar wrapped acr",
      " oss two lines",
      "DTSTART:20260911T090000Z", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics, now, 21);
    expect(events[0]!.title).toBe("A meeting with a very long name that the calendar wrapped across two lines");
  });

  it("expands a weekly repeat, which is the one recurring meeting she actually has", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:wk@google.com", "SUMMARY:West Peek partner meeting",
      "DTSTART:20260909T140000Z", "RRULE:FREQ=WEEKLY", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics, now, 21);
    expect(events.length).toBeGreaterThan(2);
    // Distinct ids, or the upsert would collapse the series into one row.
    expect(new Set(events.map((e) => e.calendar_uid)).size).toBe(events.length);
  });

  it("shows a repeat it cannot expand once rather than dropping it", () => {
    // Monthly rules are real work and are not pretended at. Silently losing them would be worse.
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:mo@google.com", "SUMMARY:Monthly review",
      "DTSTART:20260910T140000Z", "RRULE:FREQ=MONTHLY;BYSETPOS=2", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const { events, unexpanded } = parseIcs(ics, now, 21);
    expect(events).toHaveLength(1);
    expect(unexpanded).toBe(1);
  });

  it("drops a cancelled event, because one left in the diary is worse than one that never arrived", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x@google.com", "SUMMARY:Called off",
      "DTSTART:20260910T140000Z", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(ics, now, 21).events).toHaveLength(0);
  });
});
