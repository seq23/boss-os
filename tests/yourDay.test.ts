/**
 * SIMONE'S ONE MORNING EMAIL (owner, 23 Oct 2026, rule 1 of the email fix; mock-up board 1).
 * Built from fixtures shaped like the live reads and the section files D and L write (fake names:
 * the repo is public).
 */
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDay, replyContext, briefingDecision, briefingLines, bounceLine, BRIEFING_CAP, briefingInProgress, bossDecisions, selfStartedWaiting, selfWaitingRepairs } from "../scripts/ops/your-day.mjs";
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
    // Owner layout (7 Nov 2026): line 1 says whether she must act, then her calendar, above the fold.
    expect(e.text.split("\n").slice(0, 2)).toEqual(["Good morning. Here is your Friday, October 23. 4 things to decide, below.", "On your calendar: 10 am CT Call with Example Partners with A. Person."]);
    // Owner, 24 Oct 2026: the 8Raise footer only when something is wrong (3 of 75 used is fine).
    expect(e.text).not.toMatch(/8Raise/);
  });
  it("Decide: EVERY decision is shown, the count is the number shown, nothing points at Today, each opens its own screen", () => {
    const decide = e.text.slice(e.text.indexOf("Decide (4)"), e.text.indexOf("New deals"));
    expect(decide).toMatch(/^Decide \(4\)\n1\. Reply to an LP who wants a call\nReplied Tuesday; not sent yet\.\n- Reply "1: …" to this email to answer this one\.\n- Send as is: https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/d1\n- Edit, then send: .*\n- Skip: /);
    expect(decide).toContain("2. Renew the example.com domain");
    // Every card says how to answer it by reply, by its own number (25 Oct 2026).
    for (const n of [1, 2, 3, 4]) expect(decide).toContain(`Reply "${n}: …" to this email to answer this one.`);
    expect(decide).toContain("3. Start Danielle's plan for creator-studios?");
    expect(decide).toContain("4. Monique is waiting for your word: 2 comments on the channel need your word");
    expect(decide).not.toMatch(/more on your Today page|5\./);
    expect(decide).not.toContain("past partner");
    const numbered = decide.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered).toHaveLength(4);
    // Every decision carries a link to its own screen, and the digest Boss OS keeps holds the same four.
    const screens = [...decide.matchAll(/See everything ›: (\S+)/g)].map((m) => m[1]);
    expect(screens).toHaveLength(4);
    expect(screens.every((u) => /^https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=decide-[0-9a-f]{10}$/.test(u!))).toBe(true);
    expect(e.digest.decide.map((d: any) => d.screen)).toEqual(screens);
    expect(e.digest.decide.map((d: any) => d.title)).toEqual(numbered.map((l) => l.replace(/^\d+\. /, "")));
    // Each kept card carries its key, so her "N: …" reply reaches the card it numbers (27 Oct 2026:
    // without it no numbered answer could ever resolve, src/worker/boss/lp/decideReply.ts).
    expect(e.digest.decide.map((d: any) => d.key)).toContain("approval:apr_x1");
    expect(e.digest.decide.some((d: any) => String(d.key).startsWith("rc:"))).toBe(true);
    // An Inbox approval opens that approval, never the home page.
    expect(decide).toContain("Open it to approve or decline: https://boss.sequoiataylor.com/?tab=inbox&approval=apr_x1");
    expect(decide).not.toMatch(/: https:\/\/boss\.sequoiataylor\.com\/\n/);
    expect(e.html).toMatch(/<a href="https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/d1" style="display:inline-block[^"]*">Send as is<\/a>/);
  });
  it("deals are grid rows, each opening its own deal screen; the person and firm say who it came from", () => {
    expect(e.text).toMatch(/- Company A · Buy · \$1B · Broker One — Open ›: https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=deal-[0-9a-f]{10}\n/);
    expect(e.text).toMatch(/- Company B · Sell · \$300M @ \$138 · Broker Two \(Firm X\) — Open ›: /);
    expect(e.text).not.toMatch(/· Rainmaker — /);
    expect(e.digest.deals.map((d: any) => [d.company, d.email_url])).toEqual([["Company A", `${G}a1`], ["Company B", `${G}b2`]]);
    expect(e.text).toContain(`See the full grid: ${BOSS}`);
    expect(e.html).toMatch(/<table role="presentation"/);
  });
  it("Camille's briefing: three one-line headlines, then one link to the whole briefing on its screen", () => {
    const brief = e.text.slice(e.text.indexOf("This morning's briefing"), e.text.indexOf("Read the full briefing")).split("\n").filter((l) => l.startsWith("- "));
    expect(brief.map((l) => l.replace(/\u2063/g, ""))).toEqual(["- Rates held.", "- A large AI secondary priced up.", "- Two IPO filings."]);
    expect(e.text.replace(/\u2063/g, "")).not.toContain("A launch slipped.");
    expect(e.text).toContain("Read the full briefing →: https://boss.sequoiataylor.com/?view=briefing");
    // The rest of the report is on its screen, never in the email (owner, 24 Oct 2026: "never risk the size limit").
    expect(e.text.replace(/\u2063/g, "")).not.toContain("Not this one.");
    expect(e.html).not.toContain("Not this one.");
    expect(e.html).not.toMatch(/<details|Show the full briefing/);
    expect(e.html).toMatch(/<a href="https:\/\/boss\.sequoiataylor\.com\/\?view=briefing"[^>]*>Read the full briefing →<\/a>/);
  });
  it("Done for you: the bounce agent's one line first, three lines and nothing after them, each opening its screen", () => {
    const done = e.text.slice(e.text.indexOf("Done for you"), e.text.indexOf("Catch up with")).split("\n").filter((l) => l.startsWith("- "));
    expect(done[0]).toMatch(/^- Replaced 4 outreach addresses that bounced with working ones from each company's own site; outreach restarted \(The Industry Guides\)\. — See it: https:\/\/boss\.sequoiataylor\.com\/\?morning=2026-10-23&item=done-[0-9a-f]{10}$/);
    // Owner, 13 Nov 2026: three lines; no "+N more" and no count of the Updates page. The rest is on Today.
    expect(done.length).toBe(3);
    expect(e.text).not.toMatch(/\+\d+ more on Today/);
    const counted = buildDay({ ...DATA, updates: { line: "7 updates, 13 reminders on your Updates page, all just so you know." } } as any, NOW);
    expect(counted.text).not.toContain("Updates page");
    expect(e.digest.done).toHaveLength(5);
  });
  it("Valerie's box: one calm line per customer from the site's own list, boxed (25 Oct 2026)", () => {
    expect(e.text).toContain("- Riley M. · 9:00 AM party setup\n");
    expect(e.text).toContain("- Jordan P. · waiting for deposit, $180 due ($130 + $50 refundable deposit)\n");
    expect(e.text).not.toContain("Money: ");
    expect(e.html).toContain("faf6ec");
  });
  it("goes out through employeeMail as laid out, signed by Simone, with its code and its kind in the header", () => {
    process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
    const p = employeeMail(sendersFor("Simone")[0]!, { to: "owner@example.com", subject: e.subject, text: e.text, prelaid: e });
    expect(p.html).toBe(e.html);
    expect(p.headers).toEqual({ "X-Boss-Ref": "yd_20261023", "X-Boss-Kind": "morning", "X-Boss-Layout": "digest", "X-Boss-Owner-Line": "1" });
    // The digest shows no REF: each of its cards has its own reply form.
    expect(p.subject).not.toMatch(/REF BOS-/);
    delete process.env.BOSS_OS_MAIL_KEY;
  });
});

describe("an empty or broken morning still reads plainly", () => {
  it("nothing to decide and no empty blocks: a section with nothing in it is left out, a feed that did not load included", () => {
    const empty = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: null, feedError: "the site answered 401", morning: {} }, NOW);
    expect(empty.problems).toEqual([]);
    expect(empty.subject).toBe("Friday: nothing to decide");
    expect(empty.text.split("\n")[0]).toBe("Good morning. Here is your Friday, October 23. Nothing to do.");
    expect(empty.text).not.toMatch(/^Decide \(\d+\)$/m);
    expect(empty.text).not.toMatch(/New deals|Monique found|Done for you|Catch up with|8Raise/);
    expect(empty.text).toContain("Briefing late — it will be on your Today page.");
    // Owner, 13 Nov 2026: no "nothing here" lines. Valerie's block shows only when her list holds something.
    expect(empty.text).not.toMatch(/Valerie|No new deals|All clear|did not load|No deadlines/);
    const quiet = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: { deals: { section: "deals", at: stamp, rows: [] }, monique_found: { section: "monique_found", at: stamp, lines: [], grid: [] }, open_loops: { section: "open_loops", at: stamp, title: "Your open loops: 3, none overdue", lines: [] } }, prospects: { replies: [], sent: [], next: [], totals: {}, stops: [] } } as any, Date.parse("2026-10-26T12:00:00Z"));
    expect(quiet.text).not.toMatch(/Valerie|New deals|Monique found|Prospect emails|Done for you|open loops|This week|Codex/i);
    // The seat-order footer is gone, whatever the setting says.
    const seat = buildDay({ ...DATA, settings: [{ key: "seat_order_openai_first", value: "on", updated_at: NOW }] } as any, NOW);
    expect(seat.text).not.toMatch(/Codex|ChatGPT/);
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
  it("the three headlines come from the one-minute summary, else the report's summary sentences; each is one line", async () => {
    const { headline, HEADLINE_CHARS } = await import("../scripts/ops/your-day.mjs");
    expect(briefingLines(DATA.briefing, "2026-10-23")?.length).toBe(3);
    // A long line stops at its last whole sentence that fits, citation kept; a short one is untouched.
    const long = "Rates were held again by a committee that split seven to five on the vote [1]. Markets now expect the first cut in March, and the two-year yield fell eleven basis points on the day, its largest move since the summer.";
    expect(headline(long)).toBe("Rates were held again by a committee that split seven to five on the vote [1].");
    expect(headline("Two filings.")).toBe("Two filings.");
    const noStop = headline("a".repeat(30) + " " + "word ".repeat(60));
    expect(noStop.length).toBeLessThanOrEqual(HEADLINE_CHARS + 1);
    expect(noStop).toMatch(/word…$/);
    expect(briefingLines({ for_day: "2026-10-23", sections: [{ key: "one_minute_summary", bullets: [long, "Two filings."] }] }, "2026-10-23")).toEqual([headline(long), "Two filings."]);
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

describe("a duty-change approval and its task are one plain decision (2 Nov 2026)", () => {
  it("renders once, says who wants what and what yes does, and leaks no system words", () => {
    const title = 'Change how Robin duty "Example listings: renew and keep them true" works';
    const task = {
      id: "tsk_dc1", title, status: "awaiting_approval", approval_id: "apr_dc1", employee_id: "emp_repo", employee_name: "Danielle", due: null,
      input: JSON.stringify({ prompt: "The owner asked for a change to the standing duty duty_x. Her words: Renew the listings every Monday instead. Thanks." }),
    };
    const approval = { id: "apr_dc1", title, summary: "Intake assigned this USER_ONLY. Trading lane work. No model receives execution authority here.", risk: "high", origin_type: "tasks", origin_id: "tsk_dc1", payload: JSON.stringify({ task_id: "tsk_dc1" }) };
    const e = buildDay({ ...DATA, tasks: [task], approvals: [approval], repoChanges: [], morning: {} }, NOW);
    const decide = e.text.slice(e.text.indexOf("Decide ("), e.text.indexOf("\n\n", e.text.indexOf("Decide (") + 1 + 200));
    expect(e.text.match(/Example listings: renew and keep them true/g)?.length).toBe(1); // named once, in the title (7 Nov 2026)
    expect(decide).toMatch(/^Decide \(1\)/);
    // The change itself, in one line (7 Nov 2026): she can say yes or no to it.
    expect(e.text).toContain("The change: Renew the listings every Monday instead. Danielle makes it as you asked.");
    expect(e.text).toMatch(/Yes lets Danielle make it; no keeps Robin's duty as it is\./);
    expect(e.text).not.toMatch(/Intake assigned|execution authority|USER_ONLY|Risk: high|is waiting for your word/i);
    expect(plainProblems({ subject: e.subject, text: e.text, layout: e.layout })).toEqual([]);
  });
});

// Times follow her Mac's zone, Central in brackets when away (6 Nov 2026; was Central with no label).
describe("the morning email's times are in her zone", () => {
  it("in New York: Eastern first, Central in brackets", () => {
    expect(buildDay({ ...DATA, ownerTz: "America/New_York" }, NOW).text.split("\n")[1]).toContain("On your calendar: 11 am ET (10 am CT) Call with Example Partners");
  });
  it("at home, or unread: Central", () => {
    expect(buildDay({ ...DATA, ownerTz: "America/Chicago" }, NOW).text.split("\n")[1]).toContain("On your calendar: 10 am CT Call");
    expect(buildDay({ ...DATA, ownerTz: null }, NOW).text.split("\n")[1]).toContain("On your calendar: 10 am CT Call");
  });
});

describe("a task title on her card says you, not her (7 Nov 2026 live read)", () => {
  it("her own things and what she does turn to the second person; another woman's do not", async () => {
    const { toYou } = await import("../src/shared/boss/mail/plain.mjs");
    expect(toYou("senders in her personal Gmail she never opens")).toBe("senders in your personal Gmail you never open");
    expect(toYou("Valerie gets her own copy")).toBe("Valerie gets her own copy");
  });
});

describe("a duty-change card names the change, not its label (7 Nov 2026 live read)", () => {
  it("skips the label and the keep-as-now line; keeps what changes", async () => {
    const { theChange } = await import("../scripts/ops/your-day.mjs");
    expect(theChange("Change to Robin's listings duty (my ruling, 1 Nov). Your call, no need to ask me back. The listings work well; keep doing them as now. Add this: the listings should show more real work.")).toBe("The listings should show more real work.");
    expect(theChange("Change to Robin's duty.")).toBeNull();
    expect(theChange("Add this: show more of OUR REAL WORK.")).toBe("Show more of our real work.");
  });
});

describe("your open loops: hers only, the same row once, five at most, three mornings each (owner, 13 Nov 2026)", () => {
  const PAGE = "https://boss.sequoiataylor.com/?tab=loops";
  const row = (n: number, id = `olp_syn${n}`) => ({ text: `Loop ${n} (due Mon 2 Nov). Did this happen?`, links: [{ label: "Open ›", url: `${PAGE}&loop=${id}` }] });
  const day = (lines: any[], told: any = {}) => buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, told, morning: { open_loops: { section: "open_loops", at: new Date(NOW).toISOString(), title: "Your open loops: 47, 31 overdue", lines, link: { label: "See every open loop →", url: PAGE } } } } as any, NOW);
  it("a long list is five rows, with no count, no '+N more' and no team line", () => {
    const e = day([...Array.from({ length: 17 }, (_, i) => row(i + 1)), { text: "+12 more of yours on Open Loops.", links: [{ label: "Open ›", url: PAGE }] }, { text: "The team has 9 more, 2 past their date, and is working on them.", links: [{ label: "Open ›", url: PAGE }] }]);
    expect(e.problems).toEqual([]);
    expect(e.text).toContain("Loop 5 (due");
    expect(e.text).not.toContain("Loop 6 (due");
    expect(e.text).not.toMatch(/more of yours|more overdue|The team has|47|31 overdue/);
  });
  it("the same row posted five times is one line", () => {
    const e = day([1, 2, 3, 4, 5].map((n) => ({ ...row(1, `olp_syndup${n}`) })).concat([row(2)]));
    expect(e.text.split("Loop 1 (due").length - 1).toBe(1);
    expect(e.text).toContain("Loop 2 (due");
  });
  it("a row shows on three mornings, then leaves the email; with none left the block is gone", () => {
    let told: any = {};
    for (let morning = 1; morning <= 3; morning++) {
      const e = day([row(1)], told);
      expect(e.text, `morning ${morning}`).toContain("Loop 1 (due");
      told = e.memory;
    }
    const fourth = day([row(1), row(2)], told);
    expect(fourth.text).not.toContain("Loop 1 (due");
    expect(fourth.text).toContain("Loop 2 (due");
    expect(day([row(1)], told).text).not.toMatch(/open loops/i);
  });
});

describe("still yours to answer: three showings, and never an answered approval (owner, 13 Nov 2026)", () => {
  const card = { key: "lp:syn1", title: "Reply to An LP at Example Fund", body: "They wrote back.", buttons: [{ label: "Open", url: "https://boss.sequoiataylor.com/?tab=capital" }] };
  const base = { diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] } };
  it("a card she has seen is a thin line on three later mornings, then leaves the email", () => {
    const first = buildDay({ ...base, morning: { lp: { section: "lp", at: new Date(NOW).toISOString(), decide: [card] } } } as any, NOW);
    expect(first.text).toMatch(/^Decide \(1\)$/m);
    let told: any = first.memory;
    for (let d = 1; d <= 4; d++) {
      const at = NOW + d * 86_400_000;
      const e = buildDay({ ...base, told, morning: { lp: { section: "lp", at: new Date(at).toISOString(), decide: [card] } } } as any, at);
      expect(e.text).not.toMatch(/^Decide \(\d+\)$/m);
      if (d <= 3) expect(e.text, `day ${d}`).toMatch(/Still yours to answer\n- An LP at Example Fund \(LP\)/);
      else expect(e.text, "the fourth later morning").not.toContain("Still yours to answer");
      told = e.memory;
    }
  });
  it("a carried card whose approval she already answered, or whose job no longer waits, is not carried", () => {
    const carried = [
      { id: "decide-synanswered", key: "approval:apr_synanswered", title: "A synthetic library check", days: 4 },
      { id: "decide-synopen", key: "approval:apr_synopen", title: "A synthetic renewal", days: 1 },
      { id: "decide-syntask", key: "task:tsk_syngone", title: "A synthetic held job", days: 2 },
      { id: "decide-synother", key: null, title: "Go to the synthetic dinner?", days: 3 },
    ];
    const e = buildDay({ ...base, carried, approvals: [{ id: "apr_synopen", title: "A synthetic renewal" }], morning: {} } as any, NOW);
    const still = e.text.slice(e.text.indexOf("Still yours to answer"));
    expect(still).toContain("Go to the synthetic dinner?");
    expect(still).not.toContain("A synthetic library check");
    expect(still).not.toContain("A synthetic held job");
  });
});

describe("no card prints a model's own words (owner, 13 Nov 2026)", () => {
  const RAW = "Based on the provided information, I will outline the tasks and responsibilities for each business.\n\n**Businesses:**\n\n1. **A synthetic brokerage**";
  it("a finished result's summary is never printed; a run's keeps only the reason; a plain one-line reason stays", async () => {
    const { plainSummary } = await import("../scripts/ops/your-day.mjs");
    expect(plainSummary({ kind: "task_output", summary: RAW })).toBeNull();
    expect(plainSummary({ kind: "task_output", summary: "A short line that an old writer took from a model." })).toBeNull();
    expect(plainSummary({ kind: "backend_run", summary: `The run asked for your decision before this is used — ${RAW}` })).toBe("The run asked for your decision before this is used.");
    expect(plainSummary({ kind: "manual", summary: RAW })).toBeNull();
    expect(plainSummary({ kind: "judgement_call", summary: "A synthetic guide is drafted and ready to publish" })).toBe("A synthetic guide is drafted and ready to publish.");
    const e = buildDay({ ...DATA, tasks: [], approvals: [{ id: "apr_synraw", kind: "task_output", title: "A synthetic library: pages indexed", summary: RAW, origin_type: "tasks", origin_id: "tsk_synraw" }], repoChanges: [], morning: {} } as any, NOW);
    expect(e.problems).toEqual([]);
    expect(e.text).toContain("A synthetic library: pages indexed");
    expect(e.text).not.toMatch(/Based on the provided|I will outline|\*\*/);
  });
});

describe("new deals: one row per company and side (owner, 13 Nov 2026)", () => {
  it("'Fireworks' and 'Fireworks AI' are one row; the other side and other companies stay their own", async () => {
    const { mergeDealRows, companyKey } = await import("../scripts/ops/your-day.mjs");
    expect(companyKey("Fireworks AI, Inc.")).toBe(companyKey("fireworks"));
    expect(companyKey("Fireworks")).not.toBe(companyKey("Fireside"));
    const rows = [
      { company: "Fireworks", side: "Sell", size: "—", price: "—", from: "Broker One (Firm X)" },
      { company: "Fireworks AI", side: "Sell", size: "$5M", price: "$40", from: "Broker Two (Firm Y)" },
      { company: "Fireworks AI", side: "Buy", size: "$2M", price: "—", from: "Broker One (Firm X)" },
      { company: "Company B", side: "Sell", size: "$1M", price: "—", from: "Broker One (Firm X)" },
    ];
    const merged = mergeDealRows(rows);
    expect(merged.map((r: any) => [r.company, r.side, r.size, r.price, r.from])).toEqual([
      ["Fireworks AI", "Sell", "$5M", "$40", "Broker One (Firm X) (+1 more)"],
      ["Fireworks AI", "Buy", "$2M", "—", "Broker One (Firm X)"],
      ["Company B", "Sell", "$1M", "—", "Broker One (Firm X)"],
    ]);
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: { deals: { section: "deals", at: new Date(NOW).toISOString(), rows } } } as any, NOW);
    expect(e.subject).toBe("Friday: 3 new deals");
    expect(e.text).toContain("New deals since yesterday (3)");
    expect(e.digest.deals).toHaveLength(3);
  });
});

describe("the email never waits for a briefing nobody is writing (13 Nov 2026)", () => {
  // 06:44 Central, Friday 13 Nov: the report's job had stopped at 06:10, out of usage; the email sat an hour.
  const at0644 = Date.parse("2026-11-13T12:44:00Z");
  const job = (status: string, created = at0644 - 34 * 60_000) => ({ id: "tsk_synbrief01", status, created_at: created, input: JSON.stringify({ spec_module: "executive_briefing", delivers: "executive_reports" }) });
  it("it waits only while today's briefing job is running", () => {
    expect(briefingInProgress([job("running")], at0644)).toBe(true);
    for (const status of ["queued", "failed", "cancelled", "done"]) expect(briefingInProgress([job(status)], at0644), status).toBe(false);
    expect(briefingInProgress([], at0644), "no briefing job today").toBe(false);
    expect(briefingInProgress([job("running", at0644 - 26 * 3_600_000)], at0644), "yesterday's job").toBe(false);
    expect(briefingInProgress([{ id: "tsk_synother01", status: "running", created_at: at0644, input: "{}" }], at0644), "another job").toBe(false);
  });
  it("not in progress → send now without it; in progress → wait until the cap, as before", () => {
    expect(briefingDecision(null, at0644, { inProgress: false })).toBe("send_late");
    expect(briefingDecision(null, at0644, { inProgress: true })).toBe("wait");
    expect(briefingDecision({ ...DATA.briefing, for_day: "2026-11-13" }, at0644, { inProgress: false })).toBe("send");
  });
});

describe("the held jobs are read whole, never only the newest 100 (13 Nov 2026)", () => {
  it("a held job older than the newest 100 is still read, once", async () => {
    const { read } = await import("../scripts/ops/your-day.mjs");
    const newest = Array.from({ length: 100 }, (_, i) => ({ id: `tsk_synnew${i}`, title: `Synthetic job ${i}`, status: i === 0 ? "awaiting_approval" : "done", input: "{}" }));
    const old = { id: "tsk_synold001", title: "An old held synthetic job", status: "awaiting_approval", approval_id: null, input: JSON.stringify({ from: "o@example.com", mail_id: "iml_syn" }) };
    const api = { get: async (p: string) => {
      if (p === "/tasks") return newest.map((t) => ({ ...t }));
      if (p === "/tasks?status=awaiting_approval") return [{ ...newest[0] }, old];
      if (p === "/today") return { blocks: [] };
      if (p === "/approvals") return [];
      if (p === "/lp/replies") return { rows: [] };
      return {};
    } };
    const data = await read(api, NOW);
    expect(data.tasks.filter((t: any) => t.id === "tsk_synold001")).toHaveLength(1);
    expect(data.tasks.filter((t: any) => t.id === "tsk_synnew0")).toHaveLength(1);
    expect(bossDecisions(data).map((c) => c.key)).toContain("task:tsk_synold001");
  });
});

describe("work Boss OS started itself is never a Decide card (owner, 2 Nov and 13 Nov 2026)", () => {
  const duty = { id: "tsk_synduty001", title: "A synthetic sweep", status: "awaiting_approval", employee_id: "emp_relationship", employee_name: "Monique", approval_id: null, input: JSON.stringify({ duty_id: "duty_synthetic" }) };
  const hers = { ...duty, id: "tsk_synhers001", title: "Draft a synthetic note", input: JSON.stringify({ from: "o@example.com", mail_id: "iml_syn" }) };
  it("a duty's run held with no approval of hers is no card, one Done line and one repair; her own ask is still a card", () => {
    const data = { ...DATA, tasks: [duty, hers], approvals: [], repoChanges: [], morning: {} };
    const cards = bossDecisions(data);
    expect(cards.map((c) => c.key)).toEqual(["task:tsk_synhers001"]);
    expect(selfStartedWaiting(data).map((t) => t.id)).toEqual(["tsk_synduty001"]);
    const e = buildDay(data, NOW);
    expect(e.problems).toEqual([]);
    expect(e.text).not.toContain("waiting for your word: A synthetic sweep");
    expect(e.text).toMatch(/Done for you[\s\S]*A synthetic sweep[\s\S]*Danielle/);
    const repairs = selfWaitingRepairs(selfStartedWaiting(data), data.tasks);
    expect(repairs).toHaveLength(1);
    // None while a repair for it is still open.
    expect(selfWaitingRepairs(selfStartedWaiting(data), [...data.tasks, { title: repairs[0]!.title, status: "queued" }])).toEqual([]);
  });
  it("a job whose approval she already answered is no card again: it is held up, one Done line and one repair", () => {
    const answered = { ...hers, id: "tsk_synansw01", title: "Change a synthetic duty", approval_id: "apr_synanswered" };
    const data = { ...DATA, tasks: [answered], approvals: [], repoChanges: [], morning: {} };
    expect(bossDecisions(data)).toEqual([]);
    expect(selfStartedWaiting(data).map((t) => t.id)).toEqual(["tsk_synansw01"]);
    const text = buildDay(data, NOW).text;
    expect(text).not.toContain("waiting for your word");
    expect(text).toContain("A job you already answered was held up, and Danielle is getting it moving again.");
    expect(selfWaitingRepairs(selfStartedWaiting(data), data.tasks)).toHaveLength(1);
  });
  it("a real approval on a duty's run (money, a send in her name) still reaches Decide", () => {
    const data = { ...DATA, tasks: [{ ...duty, approval_id: "apr_synpay" }], approvals: [{ id: "apr_synpay", title: "Pay the synthetic invoice", origin_type: "tasks", origin_id: duty.id }], repoChanges: [], morning: {} };
    expect(bossDecisions(data).map((c) => c.key)).toEqual(["approval:apr_synpay"]);
    expect(selfStartedWaiting(data)).toEqual([]);
  });
});

describe("a repair's approval is never a card, however old its task (13 Nov 2026)", () => {
  // The task list is the newest 100 only; the nested card printed because the repair had left it.
  const approval = { id: "apr_synrepair", title: "Kendra's alarm: \"Kendra's alarm: a synthetic alarm\"", origin_type: "tasks", origin_id: "tsk_synoldfix1" };
  const repair = { id: "tsk_synoldfix1", title: "Fix Kendra's alarm: a synthetic alarm", status: "awaiting_approval", employee_id: "emp_repo", input: JSON.stringify({ origin: "repair", repair_kind: "kendra_alarm" }) };
  it("its task read by id (approvalTasks) keeps it out of Decide; without that read it would print", () => {
    const base = { ...DATA, tasks: [], approvals: [approval], repoChanges: [], morning: {} };
    expect(bossDecisions({ ...base, approvalTasks: [repair] })).toEqual([]);
    expect(bossDecisions(base).map((c) => c.key), "negative proof: the task unknown").toEqual(["approval:apr_synrepair"]);
    // An approval on her own old task is still hers.
    expect(bossDecisions({ ...base, approvalTasks: [{ ...repair, input: "{}" }] })).toHaveLength(1);
  });
});
