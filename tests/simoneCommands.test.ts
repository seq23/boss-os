/**
 * SIMONE DOES IT BY EMAIL — the grammar and the Mac half, pure (owner, 25 Oct 2026).
 * The end-to-end arc through the real intake is tests/boss/simoneDoesItByEmail.test.ts.
 *
 * The access-code half is pinned to time-2-read's REAL table: the shape is read from its own
 * migration (a copy in tests/fixtures/dailystory/), so a renamed table, column or view fails here
 * rather than at her next "make a code" email. Fixtures only: no real person, address or code.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commandsIn, whenIn, minutesIn, commandReplyIn, accessCodeIn, ACCESS_CODE_SHAPE, renderUrl, confirmLine, lookupIn, ownWords,
} from "../src/shared/boss/commands/parse.mjs";
import { codeCalls, runCode, lookupPrompt, draftPrompt, noticeArgs, SUPABASE_KEY_NAME } from "../scripts/ops/simone-commands.mjs";
import { mailGate, employeeMail } from "../scripts/ops/notify.mjs";

const NOW = Date.parse("2026-10-25T17:00:00Z"); // Sunday, noon Central
const iso = (t: number) => new Date(t).toISOString();

describe("time words", () => {
  it("relative days, her zone for the day, the named zone for the clock", () => {
    expect(iso((whenIn("Tuesday this week 10am ET", NOW) as any).start)).toBe("2026-10-27T14:00:00.000Z");
    expect(iso((whenIn("tomorrow at 3pm", NOW) as any).start)).toBe("2026-10-26T20:00:00.000Z");
    expect(iso((whenIn("Friday 9:30am PT", NOW) as any).start)).toBe("2026-10-30T16:30:00.000Z");
    expect(iso((whenIn("Oct 30 at noon CT", NOW) as any).start)).toBe("2026-10-30T17:00:00.000Z");
    // 1 Nov is the clock change: 10am Central is 15:00 UTC after it.
    expect(iso((whenIn("Nov 2 10am", NOW) as any).start)).toBe("2026-11-02T16:00:00.000Z");
  });
  it("NEGATIVE: no time, no day, or a past time is an error, never a guess", () => {
    expect(whenIn("Tuesday", NOW)).toHaveProperty("error");
    expect(whenIn("at 10am", NOW)).toHaveProperty("error");
    expect(whenIn("today at 9am", NOW)).toHaveProperty("error");
  });
  it("durations default to 30 minutes; a 15-day trial is not a duration", () => {
    expect(minutesIn("a call")).toBe(30);
    expect(minutesIn("for 45 minutes")).toBe(45);
    expect(minutesIn("for an hour")).toBe(60);
    expect(minutesIn("a 90-minute review")).toBe(90);
    expect(minutesIn("a 15-day trial")).toBe(30);
  });
  it("the confirmation says who, both zones and the Meet link; the Add link carries the guest", () => {
    const start = Date.parse("2026-10-27T14:00:00Z");
    expect(confirmLine({ guestName: "Avery", guestEmail: "a@example.com", start, minutes: 30, tz: "America/New_York", meet: "https://meet.google.com/x" }))
      .toBe("Invite sent to Avery (a@example.com) for Tue 27 Oct, 9:00–9:30 am Central (10:00–10:30 am Eastern for them). Meet: https://meet.google.com/x.");
    const u = new URL(renderUrl({ title: "Call", start, minutes: 30, guests: ["a@example.com"] }));
    expect(u.searchParams.get("add")).toBe("a@example.com");
    expect(u.searchParams.get("dates")).toBe("20261027T140000Z/20261027T143000Z");
  });
});

describe("the asks in one email", () => {
  it("the two real shapes", () => {
    const inv = commandsIn({ text: "Send a calendar invite to Avery at Example Law for Tuesday this week 10am ET, a@example.com.", now: NOW });
    expect(inv.map((c) => c.kind)).toEqual(["invite"]);
    expect(inv[0]!.spec).toMatchObject({ guest_email: "a@example.com", guest_name: "Avery", org: "Example Law", minutes: 30, tz: "America/New_York" });
    const three = commandsIn({ text: "Find my cousin Rowan's email; it's one of the addresses shared on the Smith family reunion Drive files. Create a time-2-read code TESTCODE15 for a 15-day trial, and email her the code with a short explainer.", now: NOW });
    expect(three.map((c) => [c.kind, c.waits_on])).toEqual([["lookup", []], ["access_code", []], ["email", [0, 1]]]);
    expect(three[0]!.spec).toMatchObject({ name: "Rowan", relation: "cousin", hints: ["Smith family reunion"] });
    expect(three[2]!.spec).toMatchObject({ to: null, pronoun: "her", from_mailbox: "st@time-2-read.com", code: "TESTCODE15", recipient_name: "Rowan" });
  });
  it("the calendar's brand comes from her words, never from an address (live proof, 25 Oct 2026)", () => {
    expect(commandsIn({ text: "Send a calendar invite to Avery for Oct 31 at 6am CT, avery@time-2-read.com", now: NOW })[0]!.spec.calendar).toBe("sequoia@westpeek.ventures");
    expect(commandsIn({ text: "Send a time-2-read calendar invite to Avery for Oct 31 at 6am CT, a@example.com", now: NOW })[0]!.spec.calendar).toBe("st@time-2-read.com");
  });
  it("an invite with no address finds it first", () => {
    const c = commandsIn({ text: "Schedule a call with Avery Example tomorrow at 2pm", now: NOW });
    expect(c.map((x) => [x.kind, x.waits_on])).toEqual([["lookup", []], ["invite", [0]]]);
  });
  it("NEGATIVE: ordinary mail is no command", () => {
    for (const t of ["What are the cheapest ways to host a static site?", "Please archive these receipts", "every friday, write me a report"]) expect(commandsIn({ text: t, now: NOW })).toEqual([]);
    expect(lookupIn("find the receipts")).toBeNull();
  });
  it("her replies, and the quoted email below them is never read", () => {
    expect(commandReplyIn("send", NOW)).toEqual({ verb: "send" });
    expect(commandReplyIn("2", NOW)).toEqual({ verb: "pick", n: 2 });
    expect(commandReplyIn("it's new@example.com", NOW)).toEqual({ verb: "address", email: "new@example.com" });
    expect(commandReplyIn("try again", NOW)).toEqual({ verb: "retry" });
    expect(ownWords("ok\n\nOn Sun, Oct 25, 2026 at 1:00 PM Simone wrote:\n> send")).toBe("ok");
    expect(commandReplyIn("ok\n\nOn Sun, Oct 25, 2026 at 1:00 PM Simone wrote:\n> send", NOW)).toEqual({ verb: "note", note: "ok" });
  });
});

describe("time-2-read codes: pinned to the real table", () => {
  const MIGRATION = "tests/fixtures/dailystory/20261025120000_access_codes.sql";
  it("the migration exists and names the table, columns and view Simone writes (fails, never skips)", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = readFileSync(MIGRATION, "utf8");
    const table = new RegExp(`create table if not exists public\\.${ACCESS_CODE_SHAPE.table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    expect(table, `public.${ACCESS_CODE_SHAPE.table} is not created by the migration`).not.toBeNull();
    for (const col of ACCESS_CODE_SHAPE.columns) expect(table![1]).toMatch(new RegExp(`^\\s+${col}\\s`, "m"));
    expect(table![1]).toMatch(/trial_days integer not null check \(trial_days between 1 and 730\)/);
    expect(ACCESS_CODE_SHAPE.max_days).toBe(730);
    const view = new RegExp(`create or replace view public\\.${ACCESS_CODE_SHAPE.view}[\\s\\S]*?group by`).exec(sql);
    expect(view, `public.${ACCESS_CODE_SHAPE.view} is not created by the migration`).not.toBeNull();
    for (const col of ACCESS_CODE_SHAPE.view_columns) expect(view![0]).toMatch(new RegExp(`\\b${col}\\b`));
  });
  it("NEGATIVE: the same check fails on a renamed table", () => {
    const sql = readFileSync(MIGRATION, "utf8").replace(/public\.access_codes\b/g, "public.trial_codes");
    expect(new RegExp(`create table if not exists public\\.${ACCESS_CODE_SHAPE.table} \\(`).test(sql)).toBe(false);
  });
  it("the grammar", () => {
    expect(accessCodeIn("make a time-2-read code TEACHERS30 for 30 days for the teachers group")).toEqual({ op: "create", code: "TEACHERS30", trial_days: 30, label: "teachers group" });
    expect(accessCodeIn("How many used FIXTURE15?")).toEqual({ op: "count", code: "FIXTURE15" });
    expect(accessCodeIn("Turn off code OLDCODE9")).toEqual({ op: "off", code: "OLDCODE9" });
    expect(accessCodeIn("make a time-2-read code BIGCODE1 for 999 days")).toHaveProperty("error");
    expect(accessCodeIn("how many people came to dinner?")).toBeNull();
  });
  it("the calls go to the migration's own names, with the service key, and always end on the counts", async () => {
    const make = codeCalls({ op: "create", code: "TEACHERS30", trial_days: 30, label: "teachers group" }, "https://x.supabase.co");
    expect(make.map((c: any) => [c.method, c.url])).toEqual([
      ["POST", "https://x.supabase.co/rest/v1/access_codes"],
      ["GET", "https://x.supabase.co/rest/v1/access_code_signups?select=code,label,trial_days,active,checkouts_started,signups&order=code"],
    ]);
    expect(make[0]!.body).toEqual({ code: "TEACHERS30", trial_days: 30, label: "teachers group", active: true });
    expect(codeCalls({ op: "off", code: "OLDCODE9" }, "https://x.supabase.co")[0]).toMatchObject({ method: "PATCH", url: "https://x.supabase.co/rest/v1/access_codes?code=eq.OLDCODE9", body: { active: false } });

    const seen: Array<{ url: string; headers: any }> = [];
    const fake = (async (url: string, init: any) => {
      seen.push({ url, headers: init.headers });
      if (init.method === "POST") return new Response("{}", { status: 409 });
      return Response.json([{ code: "TEACHERS30", trial_days: 30, label: "teachers group", active: true, checkouts_started: 3, signups: 2 }]);
    }) as any;
    const r = await runCode({ op: "create", code: "TEACHERS30", trial_days: 30 }, { key: "fixture-key", fetchImpl: fake });
    expect(r).toMatchObject({ ok: true, already: true, codes: [{ code: "TEACHERS30", signups: 2 }] });
    expect(seen.every((s) => s.headers.apikey === "fixture-key")).toBe(true);
  });
  it("NEGATIVE: no key in the vault is a sentence naming the key, and no call is made", async () => {
    let called = false;
    const r = await runCode({ op: "count", code: null }, { key: undefined, fetchImpl: (async () => { called = true; return new Response("[]"); }) as any });
    expect(r).toEqual({ ok: false, why: `time-2-read's Supabase service key (${SUPABASE_KEY_NAME}) is not in the vault` });
    expect(called).toBe(false);
    expect(SUPABASE_KEY_NAME).toMatch(/^DAILYSTORY_/);
  });
});

describe("the Mac seat's instructions", () => {
  it("a lookup searches Drive names, then sharing lists, then Gmail, and never guesses", () => {
    const p = lookupPrompt({ name: "Rowan", relation: "cousin", hints: ["Smith family reunion"] });
    expect(p).toMatch(/search file NAMES for "Smith family reunion"/);
    expect(p).toMatch(/get_file_permissions/);
    expect(p).toMatch(/Gmail: search for "Rowan"/);
    expect(p).toMatch(/Never construct or guess an address/);
    expect(p).toMatch(/never send, share or change anything/);
  });
  it("a draft for her product reads its facts from the product's own repo", () => {
    const p = draftPrompt({ recipient_name: "Rowan", to: "r@example.com", ask: "x", purpose: "email her the code", code: "TESTCODE15", brand: "time-2-read" });
    expect(p).toContain("~/GitHub/dailystory/README.md");
    expect(p).toContain("exactly: TESTCODE15");
    expect(p).toMatch(/Never invent a feature/);
  });
  it("a notice is a plain Simone email that passes the gate and carries its command's code", () => {
    const sender = { name: "Simone", from: "Simone <simone@sequoiataylor.com>", reply_to: "simone@sequoiataylor.com", key: "k" };
    const payload = employeeMail(sender as any, noticeArgs("cmd_0abc1def2", { subject: "Rowan's email", happened: "I found 2 addresses that could be Rowan's. Which one? Reply with the number.", details: ["1. a@example.com: shared on a file"] }));
    expect(payload.headers!["X-Boss-Ref"]).toBe("cmd_0abc1def2");
    expect(payload.text).not.toContain("cmd_");
    expect(mailGate(payload)).toEqual([]);
  });
});
