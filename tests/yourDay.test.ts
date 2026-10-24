/**
 * SIMONE'S ONE MORNING EMAIL (owner, 23 Oct 2026, rule 1 of the email fix; mock-up board 1).
 * Built from fixtures shaped like the live reads and the section files D and L write (fake names:
 * the repo is public).
 */
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDay, replyContext, briefingDecision, briefingLines, bounceLine, BRIEFING_CAP } from "../scripts/ops/your-day.mjs";
import { plainProblems } from "../src/shared/boss/mail/plain.mjs";
import { sendersFor, employeeMail } from "../scripts/ops/notify.mjs";
import { writeMorningSection, addMorningLines, readMorningSections, clearToldSections, morningSectionProblems, MORNING_SECTIONS } from "../src/shared/boss/mail/morning.mjs";

// Friday 23 Oct 2026, 07:15 Central (12:15 UTC) — after Camille's report landed.
const NOW = Date.parse("2026-10-23T12:15:00Z");
const at = (iso: string) => Date.parse(iso);
const stamp = new Date(NOW).toISOString();
const G = "https://mail.google.com/mail/u/0/#all/";
const BOSS = "https://boss.sequoiataylor.com/";
const DATA = {
  diary: [{ title: "Call with Example Partners", with: "A. Person", scheduled_at: at("2026-10-23T15:00:00Z"), location: null }],
  tasks: [
    { id: "tsk_a1b2c3d4", title: "2 comments on the channel need your word", status: "awaiting_approval", employee_id: "emp_relationship", employee_name: "Monique", due: null },
    { id: "tsk_b1b2c3d4", title: "Research referral fees", status: "running", employee_id: "emp_research", employee_name: "Camille", due: "2026-10-27T22:00:00Z" },
  ],
  approvals: [{ id: "apr_x1", title: "Renew the example.com domain" }],
  repoChanges: [{ id: "rc_x1", repo: "creator-studios", phase: "asking" }],
  briefing: { for_day: "2026-10-23", headline: "Markets flat", summary: "Markets flat. Rates unchanged.", sections: [
    { key: "top_5_headlines", bullets: ["Not this one."] },
    { key: "one_minute_summary", bullets: ["Rates held.", "A large AI secondary priced up.", "Two IPO filings.", "A launch slipped.", "One ruling on fund disclosure.", "A sixth line never shows."] },
  ] },
  bounceFixes: { replaced: 4, dropped: 0, restarted: ["The Industry Guides"] },
  morning: {
    deals: { section: "deals", at: stamp, rows: [
      { company: "Company A", side: "Buy", size: "$1B", from: "Broker One", tag: "Rainmaker", url: `${G}a1` },
      { company: "Company B", side: "Sell", size: "$300M", price: "$138", from: "Broker Two (Firm X)", url: `${G}b2` },
    ], link: { label: "See the full grid", url: BOSS } },
    monique_found: { section: "monique_found", at: stamp, lines: ["For your $1B Company A buyer: 5 funds hold $310M between them."], link: { label: "See holders and drafts", url: BOSS } },
    lp: { section: "lp", at: stamp, decide: [{ title: "Reply to an LP who wants a call", body: "Replied Tuesday; not sent yet.", buttons: [{ label: "Send as is", url: `${G}d1` }, { label: "Edit, then send", url: `${G}d1e` }, { label: "Skip", url: `${BOSS}tap/${"a".repeat(24)}?do=skip` }], priority: 10 }] },
    prospects: { section: "prospects", at: stamp, lines: ["Prospecting: 12 new buyers found, 3 follow-ups sent, 1 interested."] },
    tail: { section: "tail", at: stamp, lines: ['Your email "Fix the footer": Danielle fixed the footer link and it is live.', "Line four.", "Line five."] },
    catchups: { section: "catchups", at: stamp, decide: [{ title: "Catch up with a past partner", body: "They bought Company A last year and it is moving.", buttons: [{ label: "Send", url: `${G}c1` }, { label: "Skip", url: BOSS }] }] },
    eightraise: { section: "eightraise", at: stamp, credits: { used: 3, budget: 75, kept: 30 } },
  },
  feed: { items: [
    { kind: "deadline", title: "9:00 AM · Riley M. · Party setup", detail: "", due: "2026-10-23" },
    { kind: "money", title: "Jordan P. · Waiting for deposit", detail: "$180 due ($130 + $50 refundable deposit)", due: null },
  ] },
};

describe("the one morning email", () => {
  const e = buildDay(DATA, NOW);
  it("passes the gate and is in her order: Decide, deals, Monique found, briefing, done, catch-ups, Valerie, sign-off; no 8Raise line when nothing is wrong", () => {
    expect(e.problems).toEqual([]);
    expect(plainProblems({ ...e, kind: "morning" })).toEqual([]);
    const heads = ["Decide (4)", "New deals since yesterday (2)", "Monique found", "This morning's briefing (Camille)", "Done for you", "Catch up with", "Porch & Party: To do for Valerie", "— Simone"];
    const idx = heads.map((h) => e.text.indexOf(h));
    expect(idx.every((n) => n >= 0), JSON.stringify(idx)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(e.subject).toBe("Friday: 4 decisions, 2 new deals, Valerie's list");
    expect(e.text.split("\n")[0]).toBe("Good morning. Here is your Friday, October 23. On your calendar: 10 am Call with Example Partners with A. Person.");
    // Owner, 24 Oct 2026: the 8Raise footer only when something is wrong (3 of 75 used is fine).
    expect(e.text).not.toMatch(/8Raise/);
  });
  it("Decide: EVERY decision is shown, the count is the number shown, nothing points at Today, each opens its own screen", () => {
    const decide = e.text.slice(e.text.indexOf("Decide (4)"), e.text.indexOf("New deals"));
    expect(decide).toMatch(/^Decide \(4\)\n1\. Reply to an LP who wants a call\nReplied Tuesday; not sent yet\.\n- Send as is: https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/d1\n- Edit, then send: .*\n- Skip: /);
    expect(decide).toContain("2. Renew the example.com domain");
    expect(decide).toContain("3. Start Danielle's plan for creator-studios?");
    expect(decide).toContain("4. Monique is waiting for your word: 2 comments on the channel need your word");
    expect(decide).not.toMatch(/more on your Today page|5\./);
    expect(decide).not.toContain("past partner");
    const numbered = decide.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered).toHaveLength(4);
    // Every decision carries a link to its own screen, and the digest Boss OS keeps holds the same four.
    const screens = [...decide.matchAll(/See everything about this: (\S+)/g)].map((m) => m[1]);
    expect(screens).toHaveLength(4);
    expect(screens.every((u) => /^https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=decide-[0-9a-f]{10}$/.test(u!))).toBe(true);
    expect(e.digest.decide.map((d: any) => d.screen)).toEqual(screens);
    expect(e.digest.decide.map((d: any) => d.title)).toEqual(numbered.map((l) => l.replace(/^\d+\. /, "")));
    // An Inbox approval opens that approval, never the home page.
    expect(decide).toContain("Open it to approve or decline: https://boss.sequoiataylor.com/?tab=inbox&approval=apr_x1");
    expect(decide).not.toMatch(/: https:\/\/boss\.sequoiataylor\.com\/\n/);
    expect(e.html).toMatch(/<a href="https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/d1" style="display:inline-block[^"]*">Send as is<\/a>/);
  });
  it("deals are grid rows, each opening its own deal screen; the person and firm say who it came from", () => {
    expect(e.text).toMatch(/- Company A · Buy · \$1B · Broker One — Open the deal: https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=deal-[0-9a-f]{10}\n/);
    expect(e.text).toMatch(/- Company B · Sell · \$300M @ \$138 · Broker Two \(Firm X\) — Open the deal: /);
    expect(e.text).not.toMatch(/· Rainmaker — /);
    expect(e.digest.deals.map((d: any) => [d.company, d.email_url])).toEqual([["Company A", `${G}a1`], ["Company B", `${G}b2`]]);
    expect(e.text).toContain(`See the full grid: ${BOSS}`);
    expect(e.html).toMatch(/<table role="presentation"/);
  });
  it("Camille's briefing: the one-minute summary in five lines, then the whole briefing folded under one tap", () => {
    const brief = e.text.slice(e.text.indexOf("This morning's briefing"), e.text.indexOf("Read the full briefing")).split("\n").filter((l) => l.startsWith("- "));
    expect(brief.map((l) => l.replace(/\u2063/g, ""))).toEqual(["- Rates held.", "- A large AI secondary priced up.", "- Two IPO filings.", "- A launch slipped.", "- One ruling on fund disclosure."]);
    expect(e.text).toContain("Read the full briefing: https://boss.sequoiataylor.com/?view=briefing");
    // The rest of the report is in the email: written out in the text, folded in the HTML.
    expect(e.text.replace(/\u2063/g, "")).toContain("- Not this one.");
    expect(e.html).toMatch(/<details[^>]*><summary[^>]*>Show the full briefing ▾<\/summary>[\s\S]*Not this one\.[\s\S]*<\/details>/);
  });
  it("Done for you: the bounce agent's one line first, three lines at most, each opening its screen, the rest on Today", () => {
    const done = e.text.slice(e.text.indexOf("Done for you"), e.text.indexOf("Catch up with")).split("\n").filter((l) => l.startsWith("- "));
    expect(done[0]).toMatch(/^- Replaced 4 outreach addresses that bounced with working ones from each company's own site; outreach restarted \(The Industry Guides\)\. — See it: https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=done-[0-9a-f]{10}$/);
    expect(done.length).toBe(4);
    expect(done[3]).toBe("- And 2 more done for you. — See them all on Today: https://boss.sequoiataylor.com/?view=morning");
    expect(e.digest.done).toHaveLength(5);
  });
  it("Valerie's box is unchanged: the site's own list, boxed", () => {
    expect(e.text).toContain("- 9:00 AM · Riley M. · Party setup");
    expect(e.text).toContain("- Money: Jordan P. · Waiting for deposit — $180 due ($130 + $50 refundable deposit)");
    expect(e.html).toContain("faf6ec");
  });
  it("goes out through employeeMail as laid out, signed by Simone, with its code and its kind in the header", () => {
    process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
    const p = employeeMail(sendersFor("Simone")[0]!, { to: "owner@example.com", subject: e.subject, text: e.text, prelaid: e });
    expect(p.html).toBe(e.html);
    expect(p.headers).toEqual({ "X-Boss-Ref": "yd_20261023", "X-Boss-Kind": "morning" });
    delete process.env.BOSS_OS_MAIL_KEY;
  });
});

describe("an empty or broken morning still reads plainly", () => {
  it("nothing to decide, no sections invented, a feed that did not load is one plain line (never 'I could not read')", () => {
    const empty = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: null, feedError: "the site answered 401", morning: {} }, NOW);
    expect(empty.problems).toEqual([]);
    expect(empty.subject).toBe("Friday: nothing to decide");
    expect(empty.text.split("\n")[2]).toBe("Nothing to decide — this is just so you know.");
    expect(empty.text).not.toMatch(/New deals|Monique found|Done for you|Catch up with|8Raise/);
    expect(empty.text).toContain("Briefing late — it will be on your Today page.");
    expect(empty.text).toContain("Valerie's list did not load this morning; the team is fixing it");
  });
  it("a producer's line that is not plain is dropped and named, never holds the whole email", () => {
    const bad = buildDay({ ...DATA, morning: { ...DATA.morning, monique_found: { section: "monique_found", at: stamp, lines: ["I could not read the filings today.", "Kept line."] } } }, NOW);
    expect(bad.problems).toEqual([]);
    expect(bad.text).toContain("- Kept line.");
    expect(bad.dropped).toEqual([expect.stringMatching(/^monique_found line 1: "I could not read"/)]);
  });
  it("Mondays carry this week's deadlines in the same email — there is no second Monday email", () => {
    const monday = Date.parse("2026-10-26T12:15:00Z");
    const m = buildDay({ ...DATA, briefing: { ...DATA.briefing, for_day: "2026-10-26" } }, monday);
    expect(m.problems).toEqual([]);
    expect(m.text).toContain("This week\n- Tue: Research referral fees (Camille).");
  });
});

describe("Camille's briefing and the send time (coordinator finding, 23 Oct 2026)", () => {
  it("waits from 06:40 for today's report, sends the moment it lands, and at 07:45 Central sends without it", () => {
    expect(BRIEFING_CAP).toEqual({ hour: 7, minute: 45 });
    const at0640 = Date.parse("2026-10-23T11:40:00Z");
    const at0744 = Date.parse("2026-10-23T12:44:00Z");
    const at0745 = Date.parse("2026-10-23T12:45:00Z");
    expect(briefingDecision(null, at0640)).toBe("wait");
    expect(briefingDecision({ ...DATA.briefing, for_day: "2026-10-22" }, at0744)).toBe("wait");
    expect(briefingDecision(DATA.briefing, at0640)).toBe("send");
    expect(briefingDecision(null, at0745)).toBe("send_late");
    // After the clocks change (CST, UTC−6) the cap is still 07:45 on her clock.
    expect(briefingDecision(null, Date.parse("2026-11-02T13:44:00Z"))).toBe("wait");
    expect(briefingDecision(null, Date.parse("2026-11-02T13:45:00Z"))).toBe("send_late");
  });
  it("the five lines come from the one-minute summary, else the report's summary sentences", () => {
    expect(briefingLines(DATA.briefing, "2026-10-23")?.length).toBe(5);
    expect(briefingLines({ for_day: "2026-10-23", summary: "One. Two." }, "2026-10-23")).toEqual(["One.", "Two."]);
    expect(briefingLines({ ...DATA.briefing, for_day: "2026-10-22" }, "2026-10-23")).toBeNull();
  });
  it("the bounce agent's line says nothing when it did nothing", () => {
    expect(bounceLine(null)).toBeNull();
    expect(bounceLine({ replaced: 0, dropped: 0, restarted: [] })).toBeNull();
    expect(bounceLine({ replaced: 1, dropped: 2, restarted: [] })).toBe("Replaced 1 outreach address that bounced with working ones from each company's own site; removed 2 bounced addresses for good (no working address was published).");
  });
});

describe("what her reply carries to Simone's task", () => {
  it("keeps the email she is answering and leaves the calendar (people's names) out", () => {
    const ctx = replyContext(buildDay(DATA, NOW).text);
    expect(ctx).toContain("Start Danielle's plan for creator-studios?");
    expect(ctx).toContain("Porch & Party: To do for Valerie");
    expect(ctx).not.toMatch(/Example Partners|A\. Person/);
  });
});

describe("the morning section files (the interface D and L write)", () => {
  it("names every section the contract lists", () => {
    for (const s of ["deals", "monique_found", "lp", "prospects", "catchups", "eightraise"]) expect(MORNING_SECTIONS).toContain(s);
  });
  it("writes, reads, skips stale and broken files by name, appends without repeats, and clears what was told", () => {
    const dir = mkdtempSync(join(tmpdir(), "morning-"));
    writeMorningSection("deals", { rows: [{ company: "Company A" }] }, { dir, now: NOW });
    writeMorningSection("lp", { lines: ["old"] }, { dir, now: NOW - 40 * 3_600_000 });
    writeFileSync(join(dir, "prospects.json"), "{ not json");
    addMorningLines("tail", { lines: ["one"] }, { dir, now: NOW });
    addMorningLines("tail", { lines: ["one", "two"] }, { dir, now: NOW });
    const { sections, skipped } = readMorningSections({ dir, now: NOW });
    expect(Object.keys(sections).sort()).toEqual(["deals", "tail"]);
    expect(sections.tail!.lines).toEqual(["one", "two"]);
    expect(skipped.join(" | ")).toMatch(/lp: stale/);
    expect(skipped.join(" | ")).toMatch(/prospects: does not parse/);
    clearToldSections(["tail"], { dir });
    expect(readdirSync(dir).filter((f) => f === "tail.json")).toEqual([]);
  });
  it("refuses a Decide item without a one-tap button and a section it does not know", () => {
    expect(morningSectionProblems({ section: "lp", at: stamp, decide: [{ title: "x", buttons: [] }] })).toEqual(["decide[0] has no one-tap button"]);
    expect(morningSectionProblems({ section: "nope", at: stamp })).toEqual(['unknown section "nope"']);
    expect(() => writeMorningSection("lp", { decide: [{ title: "x", buttons: [{ label: "Go", url: "/api/x" }] }] }, { dir: mkdtempSync(join(tmpdir(), "m-")) })).toThrow(/without a real link/);
  });
});
