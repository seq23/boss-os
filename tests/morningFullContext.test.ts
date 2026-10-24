/**
 * THE MORNING EMAIL IN FULL (owner, 24 Oct 2026). Her review of that day's email, item by item:
 * "6 decisions" with 3 shown and an empty Today; LP replies with no address, no history and no draft;
 * "2 comments on the channel" over one row; "Yours · You"; "166 funds … vs the $100M buyer"; a
 * briefing cut to five lines with broken markdown and lower-cased WTI; a $25M seller and a $5M buyer
 * of the same company, neither priced, never surfaced. Synthetic data only: the repo is public.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDay, briefingFull, prospectSection, prospectDecisions, eightRaiseLine } from "../scripts/ops/your-day.mjs";
import { moniqueFound, morningDeals, yoursLabel } from "../scripts/ops/interest-grid.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";
import { lpMorning } from "../scripts/ops/lp-daily.mjs";
import { plainProblems, proseRuns, layoutEmail } from "../src/shared/boss/mail/plain.mjs";
import { rankMatches, parsePrice, gapWords, ageWords, DEFAULT_TOLERANCE } from "../src/shared/boss/deals/match.mjs";
import { archiveRows } from "../src/shared/boss/capital/partyLists.mjs";

const NOW = Date.parse("2026-10-24T12:15:00Z"); // Saturday 07:15 Central
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const NO_LISTS = { same_firm: [], do_not_suggest: [] };
const grow = (o: Record<string, unknown>) => ({
  side: "buy", direction: "buy", size_usd: null, size_text: "—", price_text: "—", structure_text: "—",
  rainmaker: 0, received_on: day(2), email_url: null, _row: {}, from_text: "—", ...o,
});
const EMPTY = { diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {} };

describe("matches: size, price and age (owner, 24 Oct 2026)", () => {
  // The shape of her golden example, with invented names: a $25M seller and a $5M buyer of one
  // company, neither priced, neither Rainmaker, neither new since yesterday. Before this change
  // `moniqueFound` looked only at pairs touching a new row, so this pair was never told.
  const sell = grow({ id: "s25", company: "Company Q", side: "sell", direction: "sell", size_usd: 25e6, size_text: "$25M", from_text: "Pat Seller, Seller Co", received_on: day(11), email_url: "https://mail.google.com/mail/u/0/#all/s25", _row: { from: "pat@sellerco.example", from_name: "Pat Seller" } });
  const buy = grow({ id: "b5", company: "Company Q", size_usd: 5e6, size_text: "$5M", from_text: "Bo Buyer, Buyer Co", received_on: day(11), email_url: "https://mail.google.com/mail/u/0/#all/b5", _row: { from: "bo@buyerco.example", from_name: "Bo Buyer" } });

  it("an unpriced $25M seller and $5M buyer are a match in the email, with both contacts and a note to each", () => {
    const out = moniqueFound({ newRows: [], grid: [sell, buy], lists: NO_LISTS, now: NOW });
    const line = out.lines.find((l: any) => /^Match, Company Q/.test(l.text));
    expect(line?.text).toBe("Match, Company Q: seller Pat Seller, Seller Co (pat@sellerco.example) has $25M, no price; buyer Bo Buyer, Buyer Co (bo@buyerco.example) wants $5M, no price. The $25M seller can fill all of the $5M buyer; price unknown on both sides — worth asking. Seller: 11 days ago · buyer: 11 days ago.");
    expect(line.links[0].label).toBe("Write to the seller (draft ready)");
    expect(line.match.drafts.map((d: any) => d.to)).toEqual(["pat@sellerco.example", "bo@buyerco.example"]);
    expect(line.match.drafts[0].body).toContain("What price are they looking for?");
    // And it is on the Matches screen.
    expect(out.matches.map((m: any) => m.key)).toEqual(["b5|s25"]);
  });

  it("a missing price never hides a match; a priced pair too far apart is left out; closest first", () => {
    const deal = grow({ id: "b", company: "Co", size_usd: 15e6, price_text: "$1.25T valuation", received_on: day(1) });
    const near = grow({ id: "n", company: "Co", side: "sell", direction: "sell", size_usd: 100e6, price_text: "$1.4T valuation", received_on: day(3) });
    const far = grow({ id: "f", company: "Co", side: "sell", direction: "sell", size_usd: 100e6, price_text: "$2T valuation", received_on: day(3) });
    const blank = grow({ id: "u", company: "Co", side: "sell", direction: "sell", size_usd: 5e6, received_on: day(2) });
    const { matches, stack } = rankMatches(deal, [blank, far, near], { tolerance: DEFAULT_TOLERANCE, now: NOW });
    expect(matches.map((m: any) => m.other.id)).toEqual(["n", "u"]);
    expect(matches[0].gap_words).toBe("seller asks $1.4T valuation, buyer bids $1.25T valuation: 11% apart");
    expect(matches[0].fill_words).toBe("fills all $15M of this order (they have $100M)");
    expect(matches[1].gap_words).toBe("seller's price unknown — worth asking");
    expect(stack).toBeNull();
    expect(parsePrice("$197.29/sh")).toEqual({ kind: "share", value: 197.29 });
    expect(parsePrice("$188bn valuation")).toEqual({ kind: "valuation", value: 188e9 });
    expect(parsePrice("952.65 per share")).toEqual({ kind: "share", value: 952.65 });
    expect(gapWords({ price_text: "$10/share" }, { price_text: "$1B valuation" })).toMatch(/different terms/);
  });

  it("small orders stack against one big one", () => {
    const big = grow({ id: "B", company: "Co", size_usd: 30e6, received_on: day(1) });
    const s1 = grow({ id: "1", company: "Co", side: "sell", direction: "sell", size_usd: 10e6, received_on: day(1) });
    const s2 = grow({ id: "2", company: "Co", side: "sell", direction: "sell", size_usd: 15e6, received_on: day(2) });
    expect(rankMatches(big, [s1, s2], { now: NOW }).stack).toBe("2 orders together fill $25M of the $30M");
  });

  it("age: fresher first, over 60 days flagged stale, over 6 months off the email and labelled old", () => {
    expect(ageWords(day(3), NOW)).toBe("3 days ago");
    expect(ageWords(day(35), NOW)).toBe("5 weeks ago");
    const b = grow({ id: "b", company: "Co", size_usd: 5e6, received_on: day(1) });
    const fresh = grow({ id: "f", company: "Co", side: "sell", direction: "sell", size_usd: 5e6, received_on: day(5), from_text: "F" });
    const stale = grow({ id: "s", company: "Co", side: "sell", direction: "sell", size_usd: 5e6, received_on: day(90), from_text: "S" });
    const old = grow({ id: "o", company: "Co", side: "sell", direction: "sell", size_usd: 5e6, received_on: day(200), from_text: "O" });
    const r = rankMatches(b, [old, stale, fresh], { now: NOW }).matches;
    expect(r.map((m: any) => [m.other.id, m.stale, m.old])).toEqual([["f", false, false], ["s", true, false], ["o", true, true]]);
    const out = moniqueFound({ newRows: [], grid: [b, stale, old], lists: NO_LISTS, now: NOW });
    // A stale match never takes an email slot; it is counted, once, in the line to the Matches screen.
    expect(out.lines.map((l: any) => l.text)).toEqual(["1 possible trade in all, on 1 company, each buyer and seller counted once; 1 has an order over 60 days old (may be stale — check it's still live)."]);
    expect(out.lines[0].links).toEqual([{ label: "See the match →", url: "https://boss.sequoiataylor.com/?tab=capital&view=matches" }]);
    expect(out.counts).toEqual({ within: 1, companies: 1, stale: 1, live: 0 });
    expect(out.matches.find((m: any) => m.key === "b|o")?.old).toBe(true);
  });

  it("never matches two Rainmaker sides", () => {
    const lists = { same_firm: [{ kind: "domain", value: "rm.example" }], do_not_suggest: [] };
    const a = grow({ id: "a", company: "Co", size_usd: 5e6, rainmaker: 1, _row: { from: "x@rm.example" } , from_text: "X" });
    const b = grow({ id: "b", company: "Co", side: "sell", direction: "sell", size_usd: 5e6, rainmaker: 1, _row: { from: "y@rm.example" }, from_text: "Y" });
    expect(moniqueFound({ newRows: [a, b], grid: [a, b], lists: lists as any, now: NOW }).matches).toHaveLength(0);
  });

  it("her own deals read 'Yours: buyer' / 'Yours: seller' everywhere", () => {
    expect([yoursLabel("buy"), yoursLabel("sell"), yoursLabel("")]).toEqual(["Yours: buyer", "Yours: seller", "Yours: side unclear — open the email"]);
    const mine = grow({ id: "m", company: "Co", side: "yours", direction: "sell", from_text: "You" });
    expect(morningDeals([mine], 1, NOW).rows[0]).toMatchObject({ side: "Yours: seller", from: "You, on the deal list" });
  });
});

describe("the archive: a view by date, never a deletion", () => {
  it("6–12 months is the archive, older leaves it, and a newer email brings an order back", () => {
    const r = (id: string, d: number, from = "A") => ({ id, company: "Co", direction: "buy", from_text: from, received_on: day(d) });
    const rows = [r("open", 10), r("arch", 200, "B"), r("gone", 400, "C"), r("back-old", 220), r("back-new", 3, "A")];
    expect(archiveRows(rows, NOW).map((x) => x.id)).toEqual(["arch"]);
  });
});

describe("LP replies: who, what they said, the history, and the reply word for word", () => {
  const base = { id: "l1", status: "drafted", tap_token: "t".repeat(24), drafted_at: NOW - 3_600_000, name: "Lee Example", firm: null,
    address: "lee@foundation.example", reply_from: "owner@westpeek.example", bucket: "call", quote: "I'm happy to connect.",
    said: "Thanks for reaching out. I'm happy to connect. Jo on our team should join.", first_seen: "2026-10-20",
    subject: "Exploring a small LP group", thread_id: "th1", draft_message_id: "m1", draft_body: "Hi Lee,\n\nThank you for getting back to me." };
  it("shows the address, their words, the history and the draft; Send as is only when the words are on the row", () => {
    const d = lpDecideItems([base], NOW)[0]!;
    expect(d.details).toEqual([
      "Their email: lee@foundation.example",
      'What they wrote: "Thanks for reaching out. I\'m happy to connect. Jo on our team should join."',
      'History: they answered your outreach on 2026-10-20 ("Exploring a small LP group"); you have not replied yet.',
      "Your reply goes from owner@westpeek.example, in their thread.",
    ]);
    expect(d.body).toBe("They want a call. Who: an LP you wrote to in West Peek's fundraising outreach (foundation.example).");
    expect(d.draft?.text).toBe(base.draft_body);
    expect(d.buttons.map((b: any) => b.label)).toEqual(["Send as is", "Edit in Gmail, then send", "Open their email", "Skip"]);
    const edited = lpDecideItems([{ ...base, draft_body: null }], NOW)[0]!;
    expect(edited.buttons.map((b: any) => b.label)).not.toContain("Send as is");
    expect(JSON.stringify(lpDecideItems([base], NOW))).not.toMatch(/\.\.|\."\./);
  });
  it("someone who wrote back after her reply is a decision with their words; the tracker names everyone", () => {
    const again = { ...base, id: "l2", status: "replied_again", name: "Kim Example", address: "kim@endow.example", last_reply_text: "Next Tuesday works.", sent_at: NOW - 5 * 86_400_000 };
    const m = lpMorning([base, again, { ...base, id: "l3", status: "sent", name: "Sam Example" }], NOW);
    expect(m.decide.map((d: any) => d.title)).toEqual(["Reply to Lee Example", "Answer Kim Example: they wrote back after your reply"]);
    expect(m.decide[1].details[1]).toBe('What they wrote: "Next Tuesday works."');
    expect(m.lines[0].text).toBe("LP replies: waiting for your reply (in Decide above): Lee Example; wrote back after your reply (in Decide above): Kim Example; you replied: Sam Example.");
  });
});

describe("Rule 0: everything awaiting her is in Decide, and only there once", () => {
  it("every producer's waiting item and Boss OS's own reach the email's Decide list, counted exactly", () => {
    const stamp = new Date(NOW).toISOString();
    const btn = [{ label: "Open", url: "https://boss.sequoiataylor.com/tap/" + "x".repeat(24) + "?do=skip" }];
    const data = {
      ...EMPTY,
      approvals: [{ id: "apr_1", title: "Approve a thing" }],
      repoChanges: [{ id: "rc_1", repo: "repo-a", phase: "asking" }, { id: "rc_2", repo: "repo-b", phase: "previewing" }, { id: "rc_3", repo: "repo-c", phase: "done" }],
      tasks: [
        { id: "tsk_1", title: "1 comment on the channel needs your word", status: "awaiting_approval", employee_name: "Monique", input: JSON.stringify({ kind: "youtube_comment_watch", digest_id: "cw_1" }) },
        { id: "tsk_2", title: "Something held", status: "awaiting_approval", employee_name: "Toni", input: "{}" },
        { id: "tsk_3", title: "Running", status: "running", input: "{}" },
      ],
      commentWatch: [{ id: "cw_1", task_id: "tsk_1", created_at: NOW, items: [{ n: 1, video_title: "Video A", author: "@viewer", text: "Wrong date in this one.", proposed_action: "reply", proposed_reply: "Thanks, fixed." }] }],
      prospects: { totals: {}, sent: [], replies: [], stops: ["No prospect email is approved yet."], approved: null, pending: null, next: [{ name: "P One", email: "p1@x.example", next_touch: 2, next_at: NOW - 86_400_000 }] },
      morning: {
        lp: { section: "lp", at: stamp, decide: [{ title: "Reply to an LP", buttons: btn }] },
        monique_found: { section: "monique_found", at: stamp, decide: [{ title: "Co: a buyer and a seller who could trade", buttons: btn }] },
        prospects: { section: "prospects", at: stamp, decide: [{ title: "A prospect wants to talk", buttons: btn }] },
        catchups: { section: "catchups", at: stamp, decide: [{ title: "Catch up with someone", buttons: btn }] },
      },
    };
    const e = buildDay(data, NOW);
    const awaiting = ["Approve a thing", "Start Danielle's plan for repo-a?", "Make Danielle's preview of repo-b live?",
      "How We Know on YouTube: 1 comment needs your word", "Toni is waiting for your word: Something held",
      "Reply to an LP", "Co: a buyer and a seller who could trade", "A prospect wants to talk",
      "1 prospect follow-up is due and cannot go out"];
    expect(e.digest.decide.map((d: any) => d.title).sort()).toEqual([...awaiting].sort());
    expect(e.text).toContain(`Decide (${awaiting.length})`);
    for (const t of awaiting) expect(e.text, t).toContain(t);
    expect(e.subject).toBe(`Saturday: ${awaiting.length} decisions`);
    // The comment is named: the channel, the video, who wrote it, their words, the proposal.
    expect(e.text).toContain('1. On the video "Video A", @viewer wrote: "Wrong date in this one.". Monique suggests: answer it in public as the channel, with: "Thanks, fixed.".');
    expect(e.problems).toEqual([]);
  });
  it("an answered comment digest waits for nothing; one Monique left alone is a done line", () => {
    const e = buildDay({
      ...EMPTY,
      tasks: [{ id: "tsk_1", title: "1 comment on the channel needs your word", status: "awaiting_approval", input: JSON.stringify({ kind: "youtube_comment_watch", digest_id: "cw_1" }) }],
      commentWatch: [
        { id: "cw_1", task_id: "tsk_1", created_at: NOW, items: [{ n: 1, text: "x", proposed_action: "ignore", instructed_at: NOW }] },
        { id: "cw_2", task_id: null, created_at: NOW - 3_600_000, items: [{ n: 1, text: "Mispronounced a word.", proposed_action: "ignore", product_note: "pronunciation: a word" }] },
      ],
    }, NOW);
    expect(e.digest.decide).toHaveLength(0);
    expect(e.digest.done[0].text).toBe("What happened: 1 new comment on How We Know on YouTube, 1 pointing at a fault in a video (pronunciation: a word). What we did: Monique left it alone, as none needed an answer, and Danielle has the fault to fix for future videos. Status: done, nothing needed from you.");
  });
});

describe("Camille's briefing, whole and readable", () => {
  const briefing = {
    for_day: "2026-10-24", headline: "h",
    sources: [{ name: "Feed", url: "file:///Users/x/MARKETS.json" }, { name: "A Wire", url: "https://news.example/a" }],
    sections: [
      { key: "one_minute_summary", bullets: ["**WTI settled at $103** [1]. *Crude crossed the 2025 high** on shipping routes [2]."] },
      { key: "ai", heading: "AI & Technology", so_what: "Spending under scrutiny.", bullets: ["A CVSS 9.2 PHP flaw in the UAE [2]."] },
    ],
    corrections: ["Yesterday's figure was wrong."],
  };
  it("keeps capitals, drops stray asterisks, links citations to their sources; the rest is on its screen, never in the email", () => {
    const runs = proseRuns(briefing.sections[0]!.bullets[0]!, (n: number) => (n === 2 ? "https://news.example/a" : null));
    expect(runs.map((r: any) => r.text).join("")).not.toMatch(/\*/);
    const e = buildDay({ ...EMPTY, briefing }, NOW);
    const text = e.text.replace(/⁣/g, "");
    expect(text).toContain("- WTI settled at $103 [1]. Crude crossed the 2025 high on shipping routes [2].");
    // Owner, 24 Oct 2026 ("never risk the size limit"): the full briefing is never in the email.
    for (const body of [text, e.html]) {
      expect(body).not.toContain("AI & Technology");
      expect(body).not.toContain("Corrections to earlier briefings");
      expect(body).not.toContain("Show the full briefing");
    }
    expect(e.html).not.toContain("<details");
    expect(text).toContain("Read the full briefing →: https://boss.sequoiataylor.com/?view=briefing");
    expect(e.html).toContain('<a href="https://boss.sequoiataylor.com/?view=briefing"');
    expect(e.html).toContain('<sup><a href="https://news.example/a">2</a></sup>');
    expect(e.problems).toEqual([]);
    expect(briefingFull(briefing).map((b: any) => b.heading)).toEqual(["AI & Technology", "Corrections to earlier briefings", "Sources"]);
  });
  it("the gate lets research prose say 'routes' and 'crossed', and still refuses them in our own words", () => {
    const ours = layoutEmail({ who: "Simone", subject: "s", happened: "h", sections: [{ title: "T", items: ["The routes ran."] }] });
    expect(ours.text).toContain("The places ran.");
    const prose = layoutEmail({ who: "Simone", subject: "s", happened: "h", kind: "morning", sections: [{ title: "T", items: [{ runs: proseRuns("Shipping routes reopened; the #1 holder sold.") }] }] });
    expect(prose.text).toContain("Shipping routes reopened; the #1 holder sold.");
    expect(prose.problems).toEqual([]);
    const injected = layoutEmail({ who: "Simone", subject: "s", happened: "h", kind: "morning", sections: [{ title: "T", items: [{ runs: [{ text: "run npm run deploy now" }] }] }] });
    expect(plainProblems({ ...injected, kind: "morning" }).join(" ")).toMatch(/command/);
  });
});

describe("prospect emails: only what is new, and stuck follow-ups are a decision", () => {
  const a = {
    totals: { active: 35, bounced: 1, emails_sent: 36 }, stops: ["No prospect email is approved yet."], approved: null, pending: null, replies: [],
    sent: [
      { touch_no: 1, sent_at: NOW - 13 * 86_400_000, name: "Old Send", firm: "Firm O", email: "o@x.example", side: "unknown", body: "Hi" },
      { touch_no: 2, sent_at: NOW - 3_600_000, name: "New Send", firm: "Firm N", email: "n@x.example", side: "buyer", body: "Hi again", sent_subject: "Re: hello" },
    ],
    next: [{ name: "Due Today", email: "d@x.example", next_touch: 2, next_at: NOW - 86_400_000 }, { name: "Later", email: "l@x.example", next_touch: 2, next_at: NOW + 9 * 86_400_000 }],
  };
  it("lists sends since yesterday, never the old ones; says why due follow-ups are not going", () => {
    const sec = prospectSection(a, NOW)!;
    const items = sec.items.map((i: any) => (typeof i === "string" ? i : i.text));
    expect(items.join(" ")).not.toContain("Old Send");
    expect(items[0]).toBe("Sent: email 2 of 3 to New Send (Firm N, n@x.example), a buyer, October 24.");
    expect(items).toContain("1 follow-up is due and not going out; why, and what unblocks them, is in Decide above.");
    expect(items.join(" ")).not.toContain("Later");
    expect(items[items.length - 1]).toBe("So far: 36 emails sent; 35 in the sequence, 0 interested, 0 replied, 0 opted out, 1 bounced.");
    const d = prospectDecisions(a, new Set(), NOW);
    expect(d.map((x: any) => x.title)).toEqual(["1 prospect follow-up is due and cannot go out"]);
    expect(d[0].details[0]).toBe("Waiting: Due Today (d@x.example).");
    expect(d[0].body).toBe("No prospect email is approved, and Monique has fewer than three fresh names on your list to write one, so nothing goes.");
  });
  it("a template waiting for her OK is a decision with its full text and Approve / Change", () => {
    const pending = { id: "pt1", tap_token: "p".repeat(24), subject: "Up to $1B secondary inquiry: {subject_names}", body: "Hi {first},\n\n{names_line}\n\nSequoia Taylor", follow_up: "Hi {first}, again.", names_json: JSON.stringify([{ name: "Co A" }, { name: "Co B" }, { name: "Co C" }]) };
    const d = prospectDecisions({ ...a, pending }, new Set(), NOW);
    expect(d[0].title).toBe("Approve the prospect email before it goes out");
    expect(d[0].draft.text).toContain("Hi Alex,");
    expect(d[0].buttons.map((b: any) => b.label)).toEqual(["Approve", "Change"]);
    expect(prospectDecisions({ ...a, pending }, new Set(["prospect-template:pt1"]), NOW)).toHaveLength(0);
  });
});

describe("the 8Raise line only when something is wrong", () => {
  it("is silent at 3 of 75, speaks when Monique's share is spent", () => {
    expect(eightRaiseLine({ used: 3, budget: 75, kept: 30 })).toBeNull();
    expect(eightRaiseLine({ used: 45, budget: 75, kept: 30 })).toBe("8Raise: Monique has used 45 of her 75 credits this month, so she has stopped searching; the last 30 stay kept for you.");
  });
});

describe("the comment digest is written whole or not at all", () => {
  it("drops repeats inside one sweep and writes digest, task and rows in one batch", () => {
    const src = readFileSync(join(__dirname, "..", "src/worker/boss/routes/commentWatch.ts"), "utf8");
    expect(src).toMatch(/if \(inBatch\.has\(it\.comment_id\)\) continue;/);
    expect(src).toMatch(/await c\.env\.DB\.batch\(stmts\);/);
    // No digest, task or row is written one statement at a time any more.
    expect(src.match(/INSERT INTO comment_watch_items[\s\S]{0,400}?\.run\(\)/g)).toBeNull();
  });
});

describe("their words, readable (24 Oct 2026: mojibake and signature blocks in the email)", () => {
  it("decodes quoted-printable as UTF-8 and drops the signature", async () => {
    const { decodedBody, withoutSignature } = await import("../scripts/ops/lp-positive.mjs");
    const raw = "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHappy to connect =E2=80=94 next week works.\r\n";
    expect(decodedBody(raw).trim()).toBe("Happy to connect — next week works.");
    expect(withoutSignature("Hi, I'm happy to connect. What did you have in mind? — Pat Example Managing Partner 555-0100")).toBe("Hi, I'm happy to connect. What did you have in mind?");
    expect(withoutSignature("November may work. I'm tied up in October. Best Regards, Pat Pat Example Jr. Managing Partner")).toBe("November may work. I'm tied up in October.");
  });
});

describe("their words are re-read every run", () => {
  it("a newly decoded reply replaces the stored one", async () => {
    const { reconcileList } = await import("../scripts/ops/lp-positive.mjs");
    const was = [{ address: "a@x.example", name: "A", bucket: "call", first_seen: "2026-10-01", quote: "q", said: "garbled \u00e2 text" }];
    const found = new Map([["a@x.example", { address: "a@x.example", name: "A", bucket: "call", first_seen: "2026-10-01", quote: "q", said: "clean — text" }]]);
    const out = reconcileList(was as any, { found: found as any, accepted: new Set(["a@x.example"]), rejected: new Map() });
    expect(out.people[0]!.said).toBe("clean — text");
  });
});
