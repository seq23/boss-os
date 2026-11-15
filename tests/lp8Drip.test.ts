/**
 * The one-list LP emails (owner, 15 Nov 2026): who is due today, the stop at a whole domain, and
 * the four approved emails rendered with nothing left unfilled. Fake people and example.com
 * addresses only: the repository is public.
 */
import { describe, expect, it } from "vitest";
import { ADDRESS_ONLY_BLOCKED, TEMPLATES, render, dueToday, stopsFor, marksIn, stopKey, verdict, sentLogRow, isWeekday, daysBetween } from "../scripts/ops/lp8-drip.mjs";

const row = (n: string, domain = `firm${n}.example.com`, status = "send: new firm") => ({ lp: `Firm ${n}`, type: "Family office", status, first: `Alex${n}`, name: `Alex${n} Doe`, email: `alex${n}@${domain}`, hook: "you backed a first-time manager in 2025" });
const sent = (...days: string[]) => ({ sent: days.map((day, i) => ({ touch: i + 1, day })), threadId: "t" });

describe("the four approved emails", () => {
  it("render with no placeholder left, the same subject threaded as Re:", () => {
    for (const touch of [1, 2, 3, 4]) {
      const r = render(touch, { first: "Alex", hook: "you backed a first-time manager." });
      expect(`${r.subject}\n${r.body}`).not.toMatch(/\{[a-z_]+\}/i);
      expect(r.body.startsWith("Hi Alex,")).toBe(true);
      expect(r.subject).toBe(touch === 1 ? "Alex, a new manager question" : "Re: Alex, a new manager question");
    }
    expect(render(1, { first: "Alex", hook: "you backed a first-time manager." }).body).toContain("I saw that you backed a first-time manager, which is why");
    expect(TEMPLATES).toHaveLength(4);
  });
  it("refuses a fifth email, a missing first name and an email 1 with no hook", () => {
    expect(() => render(5, { first: "Alex", hook: "x" })).toThrow();
    expect(() => render(2, { first: " ", hook: "x" })).toThrow(/first name/);
    expect(() => render(1, { first: "Alex", hook: "" })).toThrow(/hook/);
    expect(() => render(1, { first: "Alex", hook: "x" }, ["Hi {first}, {unknown}"])).toThrow(/unfilled/);
  });
});

describe("who is due today", () => {
  const rows = [row("1"), row("2"), row("3"), row("4"), row("5", undefined, "portal / no email"), row("6")];
  it("only send rows; firsts for the never-written, follow-ups on day 3, 7 and 14 from the first", () => {
    const state = { people: {
      "alex1@firm1.example.com": sent("2026-11-02"),                                  // day 3 → email 2
      "alex2@firm2.example.com": sent("2026-11-02", "2026-11-04"),                    // email 3 is day 7, not yet
      "alex3@firm3.example.com": sent("2026-10-22", "2026-10-26", "2026-10-29", "2026-11-05"), // four sent: never again
      "alex6@firm6.example.com": { ...sent("2026-11-02"), stopped: { reason: "replied", day: "2026-11-03" } },
    } };
    const d = dueToday(rows, state, "2026-11-05");
    expect(d.firsts.map((x) => x.row.first)).toEqual(["Alex4"]);
    expect(d.followups).toEqual([{ row: rows[0], touch: 2 }]);
  });
  it("never two emails under three days apart after a missed day, and never twice in one day", () => {
    const state = { people: { "alex1@firm1.example.com": sent("2026-11-02", "2026-11-08") } }; // email 2 late (day 6)
    expect(dueToday([row("1")], state, "2026-11-09").followups).toEqual([]);                 // day 7 but 1 day after
    expect(dueToday([row("1")], state, "2026-11-11").followups).toEqual([{ row: row("1"), touch: 3 }]);
    const today = { people: { "alex1@firm1.example.com": sent("2026-11-09") } };
    expect(dueToday([row("1")], today, "2026-11-09")).toEqual({ firsts: [], followups: [] });
  });
  it("weekends and calendar days are Central dates", () => {
    expect(isWeekday("2026-11-14")).toBe(false);
    expect(isWeekday("2026-11-16")).toBe(true);
    expect(daysBetween("2026-11-02", "2026-11-16")).toBe(14);
  });
});

describe("stop at the domain", () => {
  const rows = [row("1", "acme.example.com"), row("2", "acme.example.com"), row("3", "other.example.com"), row("4", "gmail.com"), row("5", "gmail.com")];
  it("a hit on one address stops everyone at that company domain, never a whole public mail domain", () => {
    const s = stopsFor(rows, [{ mark: "someone@acme.example.com", reason: "on \"Reply Log\"" }, { mark: "alex4@gmail.com", reason: "hard bounce" }]);
    expect([...s.keys()].sort()).toEqual(["alex1@acme.example.com", "alex2@acme.example.com", "alex4@gmail.com"]);
    expect(s.get("alex2@acme.example.com")).toBe("on \"Reply Log\"");
    expect(stopsFor(rows, [{ mark: "gmail.com", reason: "x" }]).size).toBe(0);
    expect(stopKey("A@Acme.example.com")).toBe("acme.example.com");
  });
  it("a Blocked row about one address (Twin's sequence done, no reply) stops that address, not the colleague the list chose", () => {
    const s = stopsFor(rows, [{ mark: "alex1@acme.example.com", reason: "on Blocked", only: ADDRESS_ONLY_BLOCKED.test("Completed full sequence — no reply") }]);
    expect([...s.keys()]).toEqual(["alex1@acme.example.com"]);
    expect(ADDRESS_ONLY_BLOCKED.test("Replied")).toBe(false);
    expect(ADDRESS_ONLY_BLOCKED.test("Blocked by Sequoia")).toBe(false);
    expect(ADDRESS_ONLY_BLOCKED.test("Asked to be removed")).toBe(false);
  });
  it("reads addresses and bare domains out of any sheet cell", () => {
    const m = marksIn(["Name <Pat@Blocked.example.com>", "@bare.example.org", "not a domain", 42, null]);
    expect(m.has("pat@blocked.example.com") && m.has("blocked.example.com") && m.has("bare.example.org")).toBe(true);
    expect(m.has("not a domain")).toBe(false);
  });
});

describe("Rule 0 and the Sent Log", () => {
  it("due and none sent is a named stop; nobody sent because everyone was stopped is not", () => {
    expect(verdict({ due: 3, firstsSent: 0, followupsSent: 0, stopped: 0, held: ["Gmail 500"] }).stop).toMatch(/^NAMED STOP \[NOTHING_SENT\] 3 .*Gmail 500/);
    expect(verdict({ due: 0, firstsSent: 0, followupsSent: 0, stopped: 2 }).stop).toBeNull();
    const v = verdict({ due: 4, firstsSent: 3, followupsSent: 1, stopped: 1, reasons: ["1 hard bounce"] });
    expect(v).toMatchObject({ sent: 4, stop: null });
    expect(v.line).toBe("lp8-drip: sent 3 first, 1 follow-ups, stopped 1; 1 hard bounce");
  });
  it("a Sent Log row is in the tab's column order with tier 8fundraising", () => {
    expect(sentLogRow({ day: "2026-11-16", row: row("1"), touch: 2, subject: "Re: s" }))
      .toEqual(["2026-11-16", "Alex1", "Doe", "Firm 1", "Family office", "alex1@firm1.example.com", "8fundraising", 2, "Re: s", "sent"]);
  });
});
