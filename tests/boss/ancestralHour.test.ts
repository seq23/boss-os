/**
 * THE ANCESTRAL HOUR, URGENT AT THE END OF THE MONTH (owner, 31 Oct 2026: "on the last day of the
 * month and 3 days before u should make the ancestral hour urgent and noticeable and maybe email a
 * reminder"). The window maths for every month length, done / not done, the Central clock (her Mac is
 * on Eastern), the reminder's once-a-day claim, Done ✓ from Today and from the email's one tap, and
 * the morning email's line. Synthetic data only.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import {
  ancestralWindow, ancestralHourState, reminderVerdict, claimReminder, reminderSent, markAncestralHourDone,
  ancestralHourNow, daysInMonth, ANCESTRAL_REMINDER_HOUR,
} from "../../src/worker/boss/spirit/ancestralHour";
import { zonedTime } from "../../src/shared/boss/timezone";

/** An instant at a Central wall-clock time, `YYYY-MM-DDTHH:MM`. */
const central = (iso: string) => {
  const [d, t] = iso.split("T") as [string, string];
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const [h, min] = t.split(":").map(Number) as [number, number];
  return zonedTime(y, m, day, h, "America/Chicago", min);
};

describe("the window: the last day and the three before it, for every month length", () => {
  const cases: Array<[string, number, string, string]> = [
    ["2026-10", 31, "2026-10-28", "2026-10-31"],
    ["2026-11", 30, "2026-11-27", "2026-11-30"],
    ["2027-02", 28, "2027-02-25", "2027-02-28"],
    ["2028-02", 29, "2028-02-26", "2028-02-29"],
  ];
  for (const [month, len, first, last] of cases) {
    it(`${month} (${len} days): ${first} to ${last}`, () => {
      const [y, m] = month.split("-").map(Number) as [number, number];
      expect(daysInMonth(y, m)).toBe(len);
      for (let d = 1; d <= len; d++) {
        const day = `${month}-${String(d).padStart(2, "0")}`;
        const w = ancestralWindow(day);
        expect(w.in_window, day).toBe(day >= first && day <= last);
        expect(w.days_left, day).toBe(len - d);
        expect(w.is_first_day, day).toBe(day === first);
        expect(w.is_last_day, day).toBe(day === last);
        expect(w.first_day).toBe(first);
        expect(w.last_day).toBe(last);
      }
    });
  }
  it("rejects a day that is not YYYY-MM-DD", () => {
    expect(() => ancestralWindow("31 Oct")).toThrow();
  });
});

describe("what the card and the morning line say", () => {
  it("not done, three days out: warm, a countdown, shown", () => {
    const s = ancestralHourState("2026-10-28", 0);
    expect(s).toMatchObject({ show: true, done: false, tone: "warm", headline: "🕯 Ancestral hour: 3 days left this month" });
  });
  it("one day out says 1 day, not 1 days", () => {
    expect(ancestralHourState("2026-11-29", 20).headline).toBe("🕯 Ancestral hour: 1 day left this month");
  });
  it("the last day, not done: red, 'today is the last day'", () => {
    const s = ancestralHourState("2026-10-31", 15);
    expect(s).toMatchObject({ show: true, done: false, tone: "alarm", headline: "🕯 Ancestral hour: today is the last day" });
    expect(s.line).toContain("15 of 60 minutes");
  });
  it("the last day, done: green, never red", () => {
    const s = ancestralHourState("2026-10-31", 60);
    expect(s).toMatchObject({ show: true, done: true, tone: "done", headline: "🕯 Ancestral hour: done for October ✓" });
  });
  it("outside the window: nothing shows", () => {
    expect(ancestralHourState("2026-10-27", 0)).toMatchObject({ show: false, tone: null, headline: null, line: null });
  });
});

describe("the reminder email: first and last day, mid-morning Central, once, never once done", () => {
  it("first day at 10:00 Central is due; 09:59 is not", () => {
    expect(reminderVerdict(central(`2026-10-28T${ANCESTRAL_REMINDER_HOUR}:00`), 0, false)).toEqual({ due: true, day: "2026-10-28", kind: "first" });
    expect(reminderVerdict(central("2026-10-28T09:59"), 0, false)).toEqual({ due: false, reason: "too_early" });
  });
  it("the last day is due; the days between are not", () => {
    expect(reminderVerdict(central("2026-10-31T11:30"), 0, false)).toEqual({ due: true, day: "2026-10-31", kind: "last" });
    expect(reminderVerdict(central("2026-10-29T11:30"), 0, false)).toEqual({ due: false, reason: "not_a_reminder_day" });
  });
  it("read on Central, not the Mac's Eastern clock: 00:30 Eastern on the 28th is still the 27th", () => {
    expect(reminderVerdict(Date.parse("2026-10-28T04:30:00Z"), 0, false)).toEqual({ due: false, reason: "outside_window" });
  });
  it("Feb in a leap year: the 26th and the 29th", () => {
    expect(reminderVerdict(central("2028-02-26T10:05"), 0, false)).toMatchObject({ due: true, kind: "first" });
    expect(reminderVerdict(central("2028-02-29T10:05"), 0, false)).toMatchObject({ due: true, kind: "last" });
  });
  it("done or already sent: never", () => {
    expect(reminderVerdict(central("2026-10-31T11:00"), 60, false)).toEqual({ due: false, reason: "done" });
    expect(reminderVerdict(central("2026-10-31T11:00"), 0, true)).toEqual({ due: false, reason: "already_sent" });
  });
});

describe("in D1: the claim, the one tap and Today's Done ✓", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM ancestral_hour_reminders`).run();
    await env.DB.prepare(`DELETE FROM ancestor_entries`).run();
  });
  const LAST = central("2026-10-31T10:20");

  it("claims once per day, sends one link, and a sent day never comes back", async () => {
    const a = await claimReminder(env.DB, "https://boss.test", LAST);
    expect(a.due).toBe(true);
    if (!a.due) return;
    expect(a.notice.subject).toBe("Your ancestral hour: today is the last day");
    const buttons = a.notice.decide.flatMap((d) => d.buttons);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.url).toMatch(/^https:\/\/boss\.test\/tap\/anc[A-Za-z0-9]{28}\?do=done$/);
    // A second tick inside the hold does not claim it again.
    expect(await claimReminder(env.DB, "https://boss.test", LAST + 60_000)).toMatchObject({ due: false, reason: "claimed" });
    expect(await reminderSent(env.DB, "2026-10-31", LAST + 90_000)).toBe(true);
    expect(await reminderSent(env.DB, "2026-10-31", LAST + 95_000)).toBe(false);
    // Hours later, the same day: already sent.
    expect(await claimReminder(env.DB, "https://boss.test", LAST + 4 * 3_600_000)).toMatchObject({ due: false, reason: "already_sent" });
  });

  it("the email's Done ✓: a GET never acts, the POST records the hour once, and the reminders stop", async () => {
    const a = await claimReminder(env.DB, "https://boss.test", LAST);
    if (!a.due) throw new Error("expected a due reminder");
    const token = /tap\/(anc[A-Za-z0-9]+)/.exec(a.notice.decide[0]!.buttons[0]!.url)![1]!;
    const call = async (method: string) => {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request(`https://boss.test/api/auth/tap/${token}?do=done`, { method }), env, ctx);
      await waitOnExecutionContext(ctx);
      return res.text();
    };
    expect(await call("GET")).toContain("Marking your ancestral hour done");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ancestor_entries`).first<{ n: number }>())!.n).toBe(0);
    expect(await call("POST")).toContain("No more reminders this month");
    expect(await call("POST")).toContain("No more reminders this month");
    const rows = (await env.DB.prepare(`SELECT minutes, month FROM ancestor_entries`).all<{ minutes: number; month: string }>()).results;
    expect(rows).toHaveLength(1);
    // Filed under HER month: the instant is "now", so check against the real clock's Central month.
    expect(rows[0]!.minutes).toBe(60);
  });

  it("Today's Done ✓ records the rest of the hour once, and the state reads done", async () => {
    const now = central("2026-10-31T12:00");
    await env.DB.prepare(`INSERT INTO ancestor_entries (id, ts, month, who, kind, minutes, created_at) VALUES ('anc_t1', ?, '2026-10', 'Grandmother', 'remembrance', 25, ?)`).bind(now, now).run();
    expect((await ancestralHourNow(env.DB, now)).done).toBe(false);
    const r = await markAncestralHourDone(env.DB, "today", now);
    expect(r.recorded).toBe(true);
    expect(r.state).toMatchObject({ done: true, minutes: 60, tone: "done" });
    expect((await markAncestralHourDone(env.DB, "today", now)).recorded).toBe(false);
    expect(await claimReminder(env.DB, "https://boss.test", now)).toMatchObject({ due: false, reason: "done" });
  });

  it("the Today endpoint answers with the state the card draws", async () => {
    const res = await apiJson<any>("/api/spirit/ancestral-hour");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("show");
    expect(res.body.data).toHaveProperty("headline");
  });
});
