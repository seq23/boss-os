/**
 * TEAM → DUTIES AND THE EMAIL MAP, THE SECOND PASS (the three ship-review FAILs on #591, 27 Nov 2026).
 *
 * What a person reads on the two pages: never a "next" date in the past, one row per job, one clock
 * with its zone, money with cents, plain words for when a path runs, and a details panel that adds
 * something. Every case here runs the real page code, the real manifest and the real owners file.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { centralClockOf, isOverdue, shownNextRun } from "../src/worker/boss/duties/cadence";
import { shownNextFields } from "../src/worker/boss/routes/employees";
import { centralStamp, dollars, dutyWhen, inOneClock, twelveHourTimes } from "../src/shared/boss/words";
import { mapsHealth } from "../src/shared/boss/emailMap/mapsHealth";
import { nextRunWords, pairDutiesWithPaths, type OperationsLedgers, type OperationsRow } from "../src/shared/boss/operations";
import { buildOperations, OWNERS } from "../src/client/boss/operationsSource";
import { EMAIL_MAP, EmailCard } from "../src/client/boss/pages/EmailMap";
import { JobRow, dutyNextWords, dutyPlace } from "../src/client/boss/pages/Team";

const CHI = "America/Chicago";
// Fri 27 Nov 2026, 12:00 Central (CST, UTC-6): the day the reviewer read "next Wed, Sep 23".
const NOV27_NOON = Date.UTC(2026, 10, 27, 18, 0);

describe("a duty's next run is never a date in the past", () => {
  it("a stored clock two months gone is said as missed, with its date, and no next date is promised", () => {
    const monique = { cadence: "weekly" as const, weekday: 3, local_hour: 14, local_minute: 0, timezone: CHI, next_due_at: Date.UTC(2026, 8, 23, 19, 0) };
    const shown = shownNextRun(monique, NOV27_NOON);
    expect(shown).toEqual({ at: null, missedSince: Date.UTC(2026, 8, 23, 19, 0), unknown: false });
    expect(dutyNextWords({ missed_since: shown.missedSince, next_run_at: shown.at }, NOV27_NOON)).toBe("missed since Wed, Sep 23, 2:00 PM Central");
    // Owed only since this morning is "due since", not an alarm: it runs at its next chance.
    expect(dutyNextWords({ missed_since: Date.UTC(2026, 10, 27, 13, 0) }, NOV27_NOON)).toBe("due since Fri, Nov 27, 7:00 AM Central");
    expect(dutyNextWords({ missed_since: Date.UTC(2026, 10, 26, 17, 59) }, NOV27_NOON)).toMatch(/^missed since Thu, Nov 26/);
  });

  it("a stored clock that is not a slot of its own schedule shows the slot that will really run", () => {
    // Zora: daily 7:00 AM Central, ran at 7:01 today, stored Sat 28 Nov 2:16 PM Central; read at 9:00 AM.
    const zora = { cadence: "daily" as const, local_hour: 7, local_minute: 0, timezone: CHI, next_due_at: Date.UTC(2026, 10, 28, 20, 16), last_run_at: Date.UTC(2026, 10, 28, 13, 1) };
    const at = shownNextRun(zora, Date.UTC(2026, 10, 28, 15, 0)).at!;
    expect(at).toBe(Date.UTC(2026, 10, 29, 13, 0));
    expect(centralStamp(at)).toBe("Sun, Nov 29, 7:00 AM Central");
    // Not run today: the scheduler's own repair (clockRepair) owes this morning's slot, so it is missed, not "next 2:16 PM".
    const owed = shownNextRun({ ...zora, last_run_at: Date.UTC(2026, 10, 27, 13, 1) }, Date.UTC(2026, 10, 28, 15, 0));
    expect(owed).toEqual({ at: null, missedSince: Date.UTC(2026, 10, 28, 13, 0), unknown: false });
  });

  it("a stored clock on a slot is that slot; none stored is the next slot from now; switched off has none", () => {
    const slot = Date.UTC(2026, 11, 4, 16, 35); // Fri 4 Dec, 10:35 AM Central
    const audit = { cadence: "weekly" as const, weekday: 5, local_hour: 10, local_minute: 35, timezone: CHI, last_run_at: Date.UTC(2026, 10, 27, 16, 36) };
    expect(shownNextRun({ ...audit, next_due_at: slot }, NOV27_NOON).at).toBe(slot);
    expect(shownNextRun({ ...audit, next_due_at: null }, NOV27_NOON).at).toBe(slot);
    // A seed's 0 is "no clock", never "missed since Wed, Dec 31, 1969".
    expect(shownNextRun({ ...audit, next_due_at: 0 }, NOV27_NOON)).toEqual({ at: slot, missedSince: null, unknown: false });
    expect(shownNextRun({ ...audit, next_due_at: slot, suspended: 1 }, NOV27_NOON)).toEqual({ at: null, missedSince: null, unknown: false });
  });

  it("midnight Central: the right day either side of it, never the UTC day", () => {
    const errands = { cadence: "daily" as const, local_hour: 0, local_minute: 0, timezone: CHI, last_run_at: Date.UTC(2026, 10, 28, 6, 1) };
    const justBefore = Date.UTC(2026, 10, 29, 5, 59, 30); // Sat 28 Nov, 11:59:30 PM Central
    const midnight = Date.UTC(2026, 10, 29, 6, 0);
    const at = shownNextRun({ ...errands, next_due_at: midnight }, justBefore).at!;
    expect(centralStamp(at)).toBe("Sun, Nov 29, 12:00 AM Central");
    // Just after it ran, the next is Monday's midnight, not the one that passed.
    expect(centralStamp(shownNextRun({ ...errands, next_due_at: null }, midnight + 30_000).at!)).toBe("Mon, Nov 30, 12:00 AM Central");
  });

  it("across both clock changes a 6:40 AM duty stays at 6:40 AM Central", () => {
    const morning = { cadence: "daily" as const, local_hour: 6, local_minute: 40, timezone: CHI, next_due_at: null };
    const spring = shownNextRun(morning, Date.UTC(2026, 2, 7, 18, 0)).at!; // Sat 7 Mar noon CST
    expect(spring).toBe(Date.UTC(2026, 2, 8, 11, 40)); // Sun 8 Mar, 6:40 CDT
    expect(centralStamp(spring)).toBe("Sun, Mar 8, 6:40 AM Central");
    const fall = shownNextRun(morning, Date.UTC(2026, 9, 31, 17, 0)).at!; // Sat 31 Oct noon CDT
    expect(fall).toBe(Date.UTC(2026, 10, 1, 12, 40)); // Sun 1 Nov, 6:40 CST
    expect(centralStamp(fall)).toBe("Sun, Nov 1, 6:40 AM Central");
  });

  it("a schedule that cannot be placed is said as unknown, never a guessed date", () => {
    const broken = shownNextRun({ cadence: "daily", local_hour: 7, local_minute: 0, timezone: "Not/AZone", next_due_at: null }, NOV27_NOON);
    expect(broken).toEqual({ at: null, missedSince: null, unknown: true });
    expect(dutyNextWords({ next_run_at: null, missed_since: null, next_unknown: true })).toBe("couldn't work out the next run");
    // A roster that did not say (an older Worker, a failed read) is "couldn't check", never a date.
    expect(dutyNextWords({ next_due_at: Date.UTC(2026, 8, 23, 19, 0) })).toBe("couldn't check the next run");
  });

  it("over many stored clocks and moments, a shown next run is always after now", () => {
    const duty = { cadence: "daily" as const, weekdays: [1, 2, 3, 4, 5], local_hour: 10, local_minute: 40, timezone: CHI };
    for (let i = 0; i < 400; i++) {
      const now = Date.UTC(2026, 0, 1) + i * 21_601_000;
      const stored = now + (i % 7 - 3) * 43_200_000;
      const s = shownNextRun({ ...duty, next_due_at: stored }, now);
      if (s.at !== null) expect(s.at).toBeGreaterThan(now);
      else expect(s.missedSince).toBeLessThanOrEqual(now);
    }
  });

  it("OVERDUE only for a real clock more than a day behind, never for a missing one", () => {
    expect(isOverdue({ next_due_at: null }, NOV27_NOON)).toBe(false);
    expect(isOverdue({ next_due_at: 0 }, NOV27_NOON)).toBe(false);
    expect(isOverdue({ next_due_at: Date.UTC(2026, 8, 23, 19, 0) }, NOV27_NOON)).toBe(true);
    expect(isOverdue({ next_due_at: Date.UTC(2026, 8, 23, 19, 0), suspended: 1 }, NOV27_NOON)).toBe(false);
    expect(isOverdue({ next_due_at: NOV27_NOON - 3_600_000 }, NOV27_NOON)).toBe(false);
  });

  it("the roster route reads the stored row's own columns (weekdays as JSON text)", () => {
    const row = { cadence: "daily", weekdays: "[1,2,3,4,5]", local_hour: 10, local_minute: 40, timezone: CHI, next_due_at: null, suspended: 0 };
    const f = shownNextFields(row, NOV27_NOON);
    expect(centralStamp(f.next_run_at!)).toBe("Mon, Nov 30, 10:40 AM Central");
    expect(f.missed_since).toBeNull();
  });
});

describe("one clock, one set of place names, money with cents", () => {
  it("money always shows cents, and a missing number is said", () => {
    expect(dollars(1.5)).toBe("$1.50");
    expect(dollars(0.22)).toBe("$0.22");
    expect(dollars(9)).toBe("$9.00");
    expect(dollars(0)).toBe("$0.00");
    expect(dollars(51.37)).toBe("$51.37");
    expect(dollars(Number.NaN)).toBe("not known");
  });

  it("a duty's schedule is said in the Email Map's words", () => {
    const at = { local_hour: 10, local_minute: 40 };
    expect(dutyWhen({ cadence: "daily", weekdays: "[1,2,3,4,5]", ...at })).toBe("Weekdays at 10:40 AM Central");
    expect(dutyWhen({ cadence: "daily", weekdays: "[1,3,5]", ...at })).toBe("Mon, Wed and Fri at 10:40 AM Central");
    expect(dutyWhen({ cadence: "daily", weekdays: null, local_hour: 0, local_minute: 0 })).toBe("Daily at 12:00 AM Central");
    expect(dutyWhen({ cadence: "weekly", weekday: 5, local_hour: 10, local_minute: 35 })).toBe("Fridays at 10:35 AM Central");
    expect(dutyWhen({ cadence: "monthly", ...at })).toBe("The 1st of each month at 10:40 AM Central");
  });

  it("a duty on another zone's clock is said on hers, the day moved with it", () => {
    // The errand reminders: midnight New York, every day = 11:00 PM Central the day before.
    const errands = { cadence: "daily" as const, local_hour: 0, local_minute: 0, timezone: "America/New_York" };
    const c = centralClockOf(errands, NOV27_NOON)!;
    expect(c).toEqual({ hour: 23, minute: 0, day_shift: -1 });
    expect(dutyWhen({ ...errands, weekdays: null, central_clock: c })).toBe("Daily at 11:00 PM Central");
    // Weekly Monday midnight New York is Sunday 11 PM on her clock; weekdays move the same way.
    expect(dutyWhen({ cadence: "weekly", weekday: 1, local_hour: 0, local_minute: 0, central_clock: c })).toBe("Sundays at 11:00 PM Central");
    expect(dutyWhen({ cadence: "daily", weekdays: "[1,2,3,4,5]", local_hour: 0, local_minute: 0, central_clock: c })).toBe("Sun, Mon, Tue, Wed and Thu at 11:00 PM Central");
    expect(centralClockOf({ ...errands, timezone: CHI }, NOV27_NOON)).toBeNull();
    // The roster carries it, so the screen never prints the zone's own hour as Central.
    expect(shownNextFields({ ...errands, weekdays: null, next_due_at: null }, NOV27_NOON).central_clock).toEqual(c);
  });

  it("a 24-hour time in a line of prose becomes the one 12-hour clock; a 12-hour one is left alone", () => {
    expect(twelveHourTimes("Mon/Tue/Wed/Thu/Fri 10:45 Central")).toBe("Mon/Tue/Wed/Thu/Fri 10:45 AM Central");
    expect(twelveHourTimes("at 8:17, 13:17 and 18:17 Central")).toBe("at 8:17 AM, 1:17 PM and 6:17 PM Central");
    expect(twelveHourTimes("first try 6:40 AM Central")).toBe("first try 6:40 AM Central");
  });

  it("every time on the Email Map is a 12-hour clock with its zone", () => {
    for (const r of EMAIL_MAP.rows) expect(inOneClock(r.when), `${r.id}: ${r.when}`).toBe(true);
    expect(inOneClock("Mon/Tue 10:40 Central")).toBe(false);
    expect(inOneClock("Daily 7:00 AM")).toBe(false);
    expect(inOneClock("Fridays, dry run")).toBe(true);
    // Production reports the same count, so the next-day check reads what was deployed.
    const h = mapsHealth();
    expect(h.emailMap.inOneClock).toBe(EMAIL_MAP.rows.length);
    expect(h.teamDuties.joinedToDuty).toBe(7);
  });

  it("a path's right-hand words are plain, never the scheduler's labels", () => {
    expect(nextRunWords({ at: null, label: "on event" })).toBe("when it happens");
    expect(nextRunWords({ at: null, label: "every 60 min" })).toBe("checked every hour");
    expect(nextRunWords({ at: null, label: "every 10 min" })).toBe("checked every 10 minutes");
    expect(nextRunWords({ at: null, label: "off" })).toBe("switched off");
    expect(nextRunWords({ at: Date.UTC(2026, 10, 30, 12, 40), label: "" })).toBe("next Mon, Nov 30, 6:40 AM Central");
  });

  it("a path's last result is on her clock, never a UTC stamp", () => {
    const ledgers: OperationsLedgers = {
      outreach: { sent: 0, failed: 0, test: 0, kill_switch: "off", sending: "live", paused_domains: 0, last: null },
      task_notices: { sent: 0, failed: 0, last: null },
      runs: { duty_failed_today: 0, cron_failed_today: 0 },
      named_stops: 0,
      local_jobs: [{ local_job: "archive-audit.mjs", outcome: "ok", finished_at: Date.UTC(2026, 10, 27, 16, 36), reason: null }],
    };
    const ops = buildOperations({ roster: [{ id: "emp_knowledge", name: "Zora", duties: [] }] }, ledgers, NOV27_NOON);
    const audit = ops.bySeat.get("Zora")!.find((r) => r.id === "zora-archive-audit")!;
    expect(audit.lastOutcome).toBe("ok Fri, Nov 27, 10:36 AM Central");
    for (const r of ops.rows) expect(r.lastOutcome ?? "", r.id).not.toMatch(/UTC/);
    // The outreach line in words, never the setting's raw value.
    const testOnly = buildOperations({ roster: [{ id: "emp_relationship", name: "Monique", duties: [] }] }, { ...ledgers, outreach: { ...ledgers.outreach, sending: "test_only" } }, NOV27_NOON);
    expect(testOnly.bySeat.get("Monique")!.find((r) => r.id === "monique-outreach")!.lastOutcome).toBe("nothing sent yet · sending to the test inbox only");
  });

  it("where a duty runs is one of the Email Map's place names", () => {
    expect(dutyPlace({ executor: "local_job" })).toBe("Your Mac");
    expect(dutyPlace({ executor: "worker" })).toBe("Cloud, on a schedule");
    expect(dutyPlace({ executor: "agent", model: "claude-sonnet-4" })).toBe("An AI teammate (Sonnet)");
    expect(dutyPlace({ executor: "agent", model: null })).toBe("An AI teammate (model not set)");
  });
});

describe("one row per job", () => {
  const path = (id: string, duty: string | null): OperationsRow => ({
    id, kind: "path", owner: "Zora", ownerKind: "seat", what: id, business: "personal", cadence: "", next: { at: null, label: "on event" },
    where: "Mac launchd", from: "", footer: "", lastOutcome: null, pause: { kind: "none", label: "no switch" }, inert: false, duty,
  });

  it("a path joins the duty its owners entry names, and only that one", () => {
    const { paired, loose } = pairDutiesWithPaths([{ id: "d1" }, { id: "d2" }], [path("a", "d1"), path("b", null)]);
    expect([...paired.entries()].map(([d, p]) => [d, p.id])).toEqual([["d1", "a"]]);
    expect(loose.map((p) => p.id)).toEqual(["b"]);
  });

  it("two paths naming one duty, or a duty not on the list, are never folded: both stay visible", () => {
    const twice = pairDutiesWithPaths([{ id: "d1" }], [path("a", "d1"), path("b", "d1")]);
    expect(twice.paired.size).toBe(0);
    expect(twice.loose.map((p) => p.id)).toEqual(["a", "b"]);
    const gone = pairDutiesWithPaths([{ id: "d9" }], [path("a", "d1")]);
    expect(gone.loose.map((p) => p.id)).toEqual(["a"]);
  });

  it("every duty link in the owners file names a duty a migration creates, once", () => {
    const sql = readdirSync("migrations").filter((f) => f.endsWith(".sql")).map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n");
    const links = Object.entries(OWNERS.owners).filter(([, e]) => e.duty).map(([id, e]) => [id, e.duty!] as const);
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const [id, duty] of links) expect(sql, `${id} → ${duty}`).toContain(`'${duty}'`);
    expect(new Set(links.map(([, d]) => d)).size).toBe(links.length);
    expect(OWNERS.owners["zora-archive-audit"]!.duty).toBe("duty_archive_audit");
  });

  it("Zora's archive audit renders once: the email's short name, the duty's schedule and cost, one layout", () => {
    const duty = {
      id: "duty_archive_audit", name: "Nothing goes stale quietly, and everything delivered can be found", cadence: "weekly", weekday: 5,
      local_hour: 10, local_minute: 35, executor: "local_job", local_job: "archive-audit.mjs", estimated_per_month_usd: 0.22,
      last_run_at: null, next_run_at: Date.UTC(2026, 11, 4, 16, 35), missed_since: null, suspended: 0,
    };
    const ops = buildOperations({ roster: [{ id: "emp_knowledge", name: "Zora", duties: [duty] }] }, null, NOV27_NOON);
    const { paired, loose } = pairDutiesWithPaths([duty], ops.bySeat.get("Zora")!);
    expect(loose.map((p) => p.id)).not.toContain("zora-archive-audit");
    const html = renderToStaticMarkup(createElement(JobRow, { duty, path: paired.get("duty_archive_audit"), seat: "Zora", onOpenOutreach: () => {} }));
    expect(html.match(/Friday archive audit/g)?.length).toBe(2); // the title, and the description's own words
    expect(html).toContain('data-path-id="zora-archive-audit"');
    expect(html).toContain('data-duty-id="duty_archive_audit"');
    expect(html).toContain("about $0.22 a month");
    expect(html).toContain("next Fri, Dec 4, 10:35 AM Central");
    expect(html).toContain("Fridays at 10:35 AM Central");
    expect(html).not.toMatch(/NO MODEL NAMED|next —|\/mo\b/);
  });

  it("a duty row with a cost under a dollar or a round number still shows cents", () => {
    const duty = { id: "x", name: "Growth scoreboard", cadence: "daily", local_hour: 5, local_minute: 20, executor: "local_job", local_job: "growth-scoreboard.mjs", estimated_per_month_usd: 1.5, next_run_at: null, missed_since: Date.UTC(2026, 8, 23, 19, 0) };
    const html = renderToStaticMarkup(createElement(JobRow, { duty, seat: "Noelle", onOpenOutreach: () => {} }));
    expect(html).toContain("about $1.50 a month");
    expect(html).toContain("missed since Wed, Sep 23, 2:00 PM Central");
    expect(html).not.toContain(">next ");
  });
});

describe("the Email Map's words", () => {
  it("Show details adds what the card does not say: no second When, To or Where it runs", () => {
    for (const row of EMAIL_MAP.rows) {
      const html = renderToStaticMarkup(createElement(EmailCard, { row }));
      const dl = html.slice(html.indexOf("<dl"));
      expect(dl, row.id).not.toMatch(/<dt>(When|To|Where it runs|Sent by)<\/dt>/);
      expect(dl, row.id).toContain("<dt>How to pause it</dt>");
    }
  });

  it("no dated build notes, and no 'None' or 'Nobody' standing in for a person", () => {
    for (const r of EMAIL_MAP.rows) {
      expect(r.what, r.id).not.toMatch(/\(\d{1,2} [A-Z][a-z]{2} 20\d\d\)|^No longer|since \d{1,2} [A-Z][a-z]{2} 20\d\d/);
      expect(r.sender, r.id).not.toMatch(/^(None|Nobody)$/);
      expect(r.to, r.id).not.toMatch(/^(None|Nobody)$/);
    }
  });

  it("the morning email's description agrees with its rule: three headlines, one sentence", () => {
    const morning = EMAIL_MAP.rows.find((r) => r.id === "simone-your-day")!;
    expect(morning.what).toMatch(/three headlines/);
    expect(morning.what).not.toMatch(/five/);
    expect(readFileSync("CLAUDE.md", "utf8")).toMatch(/three one-line headlines/);
  });

  it("a switched-off email says it sends nothing, never 'From No one · to No one'", () => {
    const off = EMAIL_MAP.rows.find((r) => r.runs === "inert")!;
    const html = renderToStaticMarkup(createElement(EmailCard, { row: off }));
    expect(html).toContain("Sends nothing while it is switched off");
    expect(html).not.toMatch(/From No one/);
  });
});
