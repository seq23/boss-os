/**
 * THE MORNING EMAIL FITS, AND ITS MATCH NUMBERS ADD UP (owner, 24 Oct 2026).
 *
 *  - Gmail clips an email over ~102KB behind "View entire message"; hers was 93KB. A heavy day must
 *    render under EMAIL_HTML_BUDGET (80KB). The full briefing is never in the email; past the budget
 *    the email cuts in CUT_ORDER; decisions are never cut.
 *  - "1,305 matches in all; 1,359 within the 15% limit": a count that contradicted itself. A buyer
 *    and seller are one match however many times either re-sends the order; the email carries the
 *    best few (≤5, one per company, freshest then closest price) and "See all N matches →".
 *  - A quoted question ended in "." instead of "?".
 * Synthetic data only: the repo is public.
 */
import { describe, expect, it } from "vitest";
import { buildDay, EMAIL_HTML_BUDGET, CUT_ORDER } from "../scripts/ops/your-day.mjs";
import { allMatches, moniqueFound, matchCounts, emailMatches, MAX_EMAIL_MATCHES } from "../scripts/ops/interest-grid.mjs";
import { quotedSentence } from "../src/shared/boss/mail/plain.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";

const NOW = Date.parse("2026-10-24T12:15:00Z"); // Saturday 07:15 Central
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const stamp = new Date(NOW).toISOString();
const NO_LISTS = { same_firm: [], do_not_suggest: [] };
const G = "https://mail.google.com/mail/u/0/#all/";
const BOSS = "https://boss.sequoiataylor.com/";
const row = (o: Record<string, unknown>) => ({
  side: "buy", direction: "buy", size_usd: 5e6, size_text: "$5M", price_text: "—", structure_text: "—",
  rainmaker: 0, received_on: day(2), email_url: null, _row: {}, from_text: "—", ...o,
});
const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 7 === 0 ? "," : ""}`).join(" ");

/** A heavy day, every section past its usual size. */
function heavyDay() {
  const decide = Array.from({ length: 14 }, (_, i) => ({
    key: `lp:${i}`, title: `Reply to Person ${i} at Example Firm ${i}`, body: `They wrote back on Thursday about a call. ${words(30, "context")}.`,
    details: [`Who: Person ${i} (person${i}@firm${i}.example)`, `What they said: "${words(40, "said")}?"`, `History: ${words(30, "history")}.`],
    draft: { heading: "The reply, word for word", text: `Hi Person,\n\n${words(140, "reply")}.\n\nSequoia` },
    buttons: [{ label: "Send as is", url: `${G}d${i}` }, { label: "Edit, then send", url: `${G}e${i}` }, { label: "Skip", url: `${BOSS}tap/${String(i).padStart(24, "a")}?do=skip` }],
    priority: 10,
  }));
  return {
    diary: [], tasks: [], approvals: [], repoChanges: [], feed: { items: Array.from({ length: 20 }, (_, i) => ({ kind: "deadline", title: `9:00 AM · Guest ${i} · Party setup`, detail: words(12, "detail"), due: "2026-10-24" })) },
    briefing: { for_day: "2026-10-24", headline: "h", sources: Array.from({ length: 40 }, (_, i) => ({ name: `Wire ${i}`, url: `https://news${i}.example/story/${i}` })), sections: [
      { key: "one_minute_summary", bullets: Array.from({ length: 5 }, (_, i) => `${words(45, "summary")} [${i + 1}].`) },
      ...Array.from({ length: 12 }, (_, s) => ({ key: `s${s}`, heading: `Section ${s}`, so_what: words(30, "sowhat"), bullets: Array.from({ length: 8 }, (_, i) => `${words(70, "bullet")} [${(i % 40) + 1}].`) })),
    ] },
    prospects: {
      sent: Array.from({ length: 40 }, (_, i) => ({ touch_no: 1, sent_at: NOW - 3_600_000, name: `Prospect ${i}`, firm: `Fund ${i}`, email: `p${i}@fund${i}.example`, side: "unknown", subject: "Re: hello", body: words(110, "prospectword") })),
      replies: [], next: [], totals: { emails_sent: 40, new: 10, active: 30 }, approved: true, pending: null, stops: [],
    },
    morning: {
      lp: { section: "lp", at: stamp, decide },
      deals: { section: "deals", at: stamp, rows: Array.from({ length: 60 }, (_, i) => ({ company: `Company ${i}`, side: i % 2 ? "Sell" : "Buy", size: "$25M", price: "$1.2T", from: `Broker ${i} (Firm ${i})`, url: `${G}deal${i}`, received_on: day(0) })), link: { label: "See the full grid", url: BOSS } },
      monique_found: { section: "monique_found", at: stamp, lines: Array.from({ length: 30 }, (_, i) => ({ text: `For the $25M Company ${i} buyer, outside your email. ${words(35, "holders")}.`, links: [{ label: "See the funds", url: `${BOSS}?tab=capital&view=holders&company=${i}` }] })), link: { label: "See every match", url: BOSS } },
      tail: { section: "tail", at: stamp, lines: Array.from({ length: 10 }, (_, i) => `Done ${i}: ${words(25, "done")}.`) },
      catchups: { section: "catchups", at: stamp, decide: Array.from({ length: 6 }, (_, i) => ({ title: `Catch up with Partner ${i}`, body: words(40, "catch"), buttons: [{ label: "Send", url: `${G}c${i}` }, { label: "Skip", url: BOSS }] })) },
    },
  };
}

describe("the morning email stays under Gmail's clip (owner, 24 Oct 2026: never risk the size limit)", () => {
  const e = buildDay(heavyDay(), NOW);
  const bytes = Buffer.byteLength(e.html, "utf8");
  it(`a heavy day renders under ${EMAIL_HTML_BUDGET} bytes, every decision still in full`, () => {
    expect(bytes, `${bytes} bytes`).toBeLessThanOrEqual(80_000);
    expect(EMAIL_HTML_BUDGET).toBeLessThanOrEqual(80_000);
    expect(e.text).toContain("Decide (14)");
    for (let i = 0; i < 14; i++) expect(e.html).toContain(`Reply to Person ${i} at Example Firm ${i}`);
    expect((e.html.match(/The reply, word for word/g) ?? []).length).toBe(14);
    expect(e.problems).toEqual([]);
  });
  it("the full briefing is never in the email: five lines and one link to its screen", () => {
    expect(e.html).not.toContain("Section 0");
    expect(e.text).not.toContain("Section 0");
    expect(e.html).toMatch(/<a href="https:\/\/boss\.sequoiataylor\.com\/\?view=briefing"[^>]*>Read the full briefing →<\/a>/);
  });
  it("long lists stop with 'see all N' on their screen", () => {
    expect(e.text).toContain("New deals since yesterday (60)");
    expect((e.text.match(/Open the deal:/g) ?? []).length).toBeLessThanOrEqual(10);
    expect(e.text).toMatch(/all 60 are on the Deals screen/);
    expect(e.text).toMatch(/And \d+ more from Monique\./);
    expect(e.text).not.toContain("Sent: email 1 of 3 to Prospect 39");
  });
  it("cuts go in a fixed order, and a day under the budget keeps everything it carries", () => {
    expect(CUT_ORDER.map(([n]) => n)).toEqual(["prospect email words", "Monique's lines to three", "deal rows to five"]);
    const light = buildDay({ ...heavyDay(), prospects: null, morning: { deals: { section: "deals", at: stamp, rows: [{ company: "Company A", side: "Buy", size: "$1B", from: "Broker One", url: `${G}a` }] } } }, NOW);
    expect(Buffer.byteLength(light.html, "utf8")).toBeLessThan(EMAIL_HTML_BUDGET);
    expect(light.text).toContain("- Company A · Buy · $1B · Broker One");
  });
  it("styles are not repeated on every paragraph and link (they come from the wrapper)", () => {
    expect(e.html).not.toMatch(/<p style="margin:0 0 8px;font-size:14px/);
    expect(e.html).not.toMatch(/<a href="[^"]*" style="color:#1F4E8C">/);
  });
});

describe("matches are counted once and the email carries the best few", () => {
  // One seller re-sent the same order three times; one buyer twice: ONE match, not six.
  const repeats = [
    ...[3, 10, 20].map((d, i) => row({ id: `s${i}`, company: "Company R", side: "sell", direction: "sell", size_usd: 25e6, size_text: "$25M", from_text: "Pat Seller", received_on: day(d), _row: { from: "pat@seller.example" } })),
    ...[2, 9].map((d, i) => row({ id: `b${i}`, company: "company r", from_text: "Bo Buyer", received_on: day(d), _row: { from: "bo@buyer.example" } })),
  ];
  it("a buyer and a seller are one match however often either re-sends, whatever the company's case", () => {
    const all = allMatches(repeats, NO_LISTS, { now: NOW });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ orders: 6, pair: "company r|bo@buyer.example|pat@seller.example" });
    // The freshest order pair stands for them.
    expect(all[0].key).toBe("b0|s0");
    expect(matchCounts(all)).toEqual({ within: 1, companies: 1, stale: 0, live: 1 });
  });
  it("within-the-limit can never exceed the total, and the totals come from one pass", () => {
    const grid = Array.from({ length: 12 }, (_, i) => row({ id: `x${i}`, company: `Co ${i % 4}`, side: i % 2 ? "sell" : "buy", direction: i % 2 ? "sell" : "buy", from_text: `P${i}`, price_text: i % 3 ? "$100/share" : "$140/share", _row: { from: `p${i}@x.example` }, received_on: day(i * 7) }));
    const out = moniqueFound({ newRows: [], grid, lists: NO_LISTS, now: NOW });
    const c = out.counts;
    expect(c.within).toBeLessThanOrEqual(out.matches.length);
    expect(c.live + c.stale).toBe(c.within);
    expect(new Set(out.matches.map((m: any) => m.pair)).size).toBe(out.matches.length);
  });
  it("the email: at most five new matches, one per company, freshest then closest price; then 'See all N matches →'", () => {
    const grid: any[] = [];
    for (let c = 0; c < 8; c++) {
      grid.push(row({ id: `b${c}`, company: `Co ${c}`, from_text: `Buyer ${c}`, received_on: day(c + 1), price_text: "$100/share", _row: { from: `b${c}@x.example` } }));
      for (const [k, price] of [["near", "$101/share"], ["far", "$110/share"]]) grid.push(row({ id: `s${c}${k}`, company: `Co ${c}`, side: "sell", direction: "sell", from_text: `Seller ${c}${k}`, received_on: day(c + 1), price_text: price, _row: { from: `s${c}${k}@x.example` } }));
    }
    const out = moniqueFound({ newRows: [], grid, lists: NO_LISTS, now: NOW });
    const match = out.lines.filter((l: any) => /^Match, /.test(l.text));
    expect(match).toHaveLength(MAX_EMAIL_MATCHES);
    expect(match.map((l: any) => l.deal)).toEqual(["Co 0", "Co 1", "Co 2", "Co 3", "Co 4"]);
    expect(match[0].text).toMatch(/^Match, Co 0: seller Seller 0near .*1 more possible trade on Co 0\.$/);
    const last = out.lines[out.lines.length - 1];
    expect(last.text).toBe("16 possible trades in all, on 8 companies, each buyer and seller counted once.");
    expect(last.links).toEqual([{ label: "See all 16 matches →", url: "https://boss.sequoiataylor.com/?tab=capital&view=matches" }]);
    expect(out.link).toBeNull(); // one button to the Matches screen, not two
  });
  it("a pair already told yesterday is not new; one first seen today is; a stale one never takes a slot", () => {
    const sell = row({ id: "s", company: "Company Q", side: "sell", direction: "sell", size_usd: 25e6, size_text: "$25M", from_text: "Pat", received_on: day(11), _row: { from: "pat@q.example" } });
    const buy = row({ id: "b", company: "Company Q", from_text: "Bo", received_on: day(11), _row: { from: "bo@q.example" } });
    const all = allMatches([sell, buy], NO_LISTS, { now: NOW });
    const within = all;
    expect(emailMatches(within, { firstSeen: { [all[0].pair]: NOW - 3 * 86_400_000 }, now: NOW })).toHaveLength(0);
    expect(emailMatches(within, { firstSeen: { [all[0].pair]: NOW - 3_600_000 }, now: NOW })).toHaveLength(1);
    expect(emailMatches(within, { firstSeen: {}, now: NOW })).toHaveLength(1); // first seen this run
    expect(emailMatches(within.map((m: any) => ({ ...m, stale: true })), { now: NOW })).toHaveLength(0);
  });
  it("the email never lists hundreds: a grid of 300 pairs still shows five and one count line", () => {
    const grid: any[] = [];
    for (let i = 0; i < 300; i++) {
      grid.push(row({ id: `b${i}`, company: `Co ${i % 40}`, from_text: `B${i}`, _row: { from: `b${i}@x.example` } }));
      grid.push(row({ id: `s${i}`, company: `Co ${i % 40}`, side: "sell", direction: "sell", from_text: `S${i}`, _row: { from: `s${i}@x.example` } }));
    }
    const out = moniqueFound({ newRows: [], grid, lists: NO_LISTS, now: NOW });
    expect(out.lines.length).toBe(MAX_EMAIL_MATCHES + 1);
    expect(out.lines[MAX_EMAIL_MATCHES].links[0].label).toMatch(/^See all \d[\d,]* matches →$/);
  });
});

describe("their words, quoted, end as they ended", () => {
  it("a question keeps its question mark, inside the quote", () => {
    expect(quotedSentence("Can we talk next week?")).toBe('"Can we talk next week?"');
    expect(quotedSentence("Can we talk next week?.")).toBe('"Can we talk next week?"');
    expect(quotedSentence("Great news!")).toBe('"Great news!"');
    expect(quotedSentence("Sounds good")).toBe('"Sounds good."');
    expect(quotedSentence("Sounds good...")).toBe('"Sounds good."');
    expect(quotedSentence('"Already quoted?"')).toBe('"Already quoted?"');
    expect(quotedSentence("")).toBe("");
  });
  it("an LP's question in Decide keeps its question mark (24 Oct 2026: 'What did you have in mind.')", () => {
    const [item] = lpDecideItems([{ address: "a@lp.example", name: "A Person", bucket: "call", status: "drafted", tap_token: "t", said: "Happy to connect. What did you have in mind?", first_seen: "2026-09-09", drafted_at: NOW }], NOW);
    expect(item!.details).toContain('What they wrote: "Happy to connect. What did you have in mind?"');
  });
  it("the prospect section's reply line ends with their question mark", () => {
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {},
      prospects: { sent: [], replies: [{ name: "Alex Example", firm: "Fund", email: "alex@fund.example", status: "replied", reply_note: "Can we talk Tuesday?" }], next: [], totals: {}, approved: true } }, NOW);
    expect(e.text).toContain('Alex Example (Fund, alex@fund.example) answered: "Can we talk Tuesday?"');
    expect(e.text).not.toContain('Tuesday."');
  });
});
