/**
 * THE GROWTH DIRECTOR'S RULES (pure). Each proven negatively:
 *   - no tests on noise: a test on a channel held "too little data" or "no data" is dropped by code;
 *   - a model answer that is not the shape is null (held), never guessed;
 *   - a spend or account proposal is refused, never a card; a not-approved post is a card;
 *   - HELD_ALL when every active business is held; nothing measured is its own stop;
 *   - the claims prompt carries the brand's rule words from the risk brain, rulings included.
 */
import { describe, expect, it } from "vitest";
import { BACKLINKS, MAX_BACKLINKS_PER_CYCLE, TOPIC_MAX, backlinkOrders, topicOf } from "../src/shared/boss/growth/director.mjs";
import { parseDecision, enforceHolds, routeItem, routeProposal, cycleEnd, ruleText, parseClaims, claimsPrompt, decisionPrompt, parseSpend, claimRules, rulesFor, REQUIRED_RULES, namingProblems, reportSection, reportDue } from "../src/shared/boss/growth/director.mjs";
import { parseRoster } from "../src/shared/boss/growth/roster.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";

const roster = parseRoster(`### Shop A
- key: shop-a
- buyer: b
- offer: o
- money number: m
- channels: instagram [reel] · threads [text-post]
- languages: en
- limits: R-PRF-01
`, "spry");
const summary = { channels: [
  { channel: "instagram", kind: "visits", value: 12, hold: "too little data", label: "x", language: "en" },
  { channel: "threads", kind: "visits", value: 80, hold: null, label: "y", language: "en" },
  { channel: "google-search", kind: "visits", value: null, hold: "no data", unread: "not read: x", label: "z", language: "en" },
] };

describe("decisions", () => {
  const ok = JSON.stringify({ decision: "More Threads.", evidence: ["threads 80 visits"], test: { channel: "instagram", format: "carousel", what: "a carousel", number: "visits", stop: "4 weeks" }, queue: [], proposals: [], next_check: "2026-11-30" });
  it("parses a good answer and refuses a bad one (held, never guessed)", () => {
    expect(parseDecision(`Sure! ${ok}`)?.decision).toBe("More Threads.");
    expect(parseDecision("I think you should post more")).toBeNull();
    expect(parseDecision('{"evidence": []}')).toBeNull();
    expect(parseDecision(null)).toBeNull();
  });
  it("drops a format test on a channel with too little or no data, keeps one on a busy channel", () => {
    const d = parseDecision(ok)!;
    const thin = enforceHolds(d, summary);
    expect(thin.decision.test).toBeNull();
    expect(thin.dropped).toMatch(/^held: too little data/);
    const none = enforceHolds({ ...d, test: { ...d.test!, channel: "google-search" } }, summary);
    expect(none.decision.test).toBeNull();
    expect(none.dropped).toMatch(/^held: no data/);
    const unknown = enforceHolds({ ...d, test: { ...d.test!, channel: "tiktok" } }, summary);
    expect(unknown.dropped).toMatch(/^held: no data/);
    const busy = enforceHolds({ ...d, test: { ...d.test!, channel: "threads" } }, summary);
    expect(busy.decision.test?.channel).toBe("threads");
    expect(busy.dropped).toBeNull();
  });
});

describe("where an item goes", () => {
  it("an approved post goes to the claims check; an unapproved one becomes her card", () => {
    expect(routeItem(roster, "shop-a", { channel: "threads", format: "text-post" })).toEqual({ to: "claims" });
    expect(routeItem(roster, "shop-a", { channel: "instagram", format: "carousel" })).toMatchObject({ to: "card" });
    expect(routeItem(roster, "shop-a", { channel: "tiktok", format: "reel" })).toMatchObject({ to: "card" });
    expect(routeItem(roster, "shop-z", { channel: "threads", format: "text-post" })).toMatchObject({ to: "refused", stop: "NOT_ON_ROSTER" });
  });
  it("spend and accounts: the model's check decides; the backstop only adds refusals; no answer refuses", () => {
    const no = { costs_money: false, creates_account: false };
    // Spends with no listed word are caught by the model's check.
    for (const what of ["Upgrade Buffer to the Essentials plan", "Hire a Fiverr editor for reels", "Canva Pro for the brand kit"])
      expect(routeProposal(roster, "shop-a", { what }, { costs_money: true, creates_account: false })).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    // Honest proposals the old word list refused are cards when the model says they cost nothing.
    for (const what of ["Add a paid add-on: a $50 porch refresh", "Grow email subscribers with a checklist", "A wedding budget planner printable", "Create a Christmas landing page on the site"])
      expect(routeProposal(roster, "shop-a", { what }, no)).toEqual({ to: "card" });
    // The backstop adds a refusal the model missed; it never removes one.
    expect(routeProposal(roster, "shop-a", { what: "Run Meta ads on the Christmas page" }, no)).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    expect(routeProposal(roster, "shop-a", { what: "Boost the best reel for $10" }, no)).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    expect(routeProposal(roster, "shop-a", { what: "Open a new TikTok account for the brand" }, no)).toMatchObject({ to: "refused", stop: "NO_NEW_ACCOUNTS" });
    expect(routeProposal(roster, "shop-a", { what: "Start a Nextdoor business page" }, { costs_money: false, creates_account: true })).toMatchObject({ to: "refused", stop: "NO_NEW_ACCOUNTS" });
    expect(routeProposal(roster, "shop-a", { what: "Partner with a florist", costs_money: true }, no)).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    // No answer from the check: refused, never carded.
    expect(routeProposal(roster, "shop-a", { what: "Try a Christmas bundle" }, null)).toMatchObject({ to: "refused", stop: "NO_SPEND_CHECK" });
    expect(parseSpend('{"costs_money": false, "creates_account": false}')).toEqual(no);
    expect(parseSpend('{"costs_money": "no"}')).toBeNull();
    expect(parseSpend(null)).toBeNull();
  });
});

describe("the cycle's end", () => {
  it("a green end needs one written decision; all held is HELD_ALL with the counts; nothing measured is its own stop", () => {
    expect(cycleEnd([{ key: "a", state: "decided" }, { key: "b", state: "held: no data" }])).toMatchObject({ ok: true, line: expect.stringMatching(/^OUTPUT 1 decisions/) });
    const held = cycleEnd([{ key: "a", state: "held: no data" }, { key: "b", state: "held: no model" }, { key: "c", state: "paused" }]);
    expect(held).toMatchObject({ ok: false, stop: "HELD_ALL" });
    expect(held.line).toMatch(/1 held: no data, 1 held: no model/);
    expect(cycleEnd([{ key: "c", state: "paused" }])).toMatchObject({ ok: false, stop: "GROWTH_NOTHING_MEASURED" });
    expect(cycleEnd([])).toMatchObject({ ok: false, stop: "GROWTH_NOTHING_MEASURED" });
  });
});

describe("the claims check", () => {
  const risk = `| R-END-03 | AI-made video says "Made with AI". | FTC |
| R-PRF-01 | No invented reviews. | 16 CFR 465 |
- 2026-11-19 — **R-END-03 P&P FILLER EXCEPTION.** P&P filler carries no "Made with AI" line; TikTok's switch is set.
- 2026-11-01 — unrelated ruling`;
  it("carries the rule's row and the later ruling that names it", () => {
    const t = ruleText(risk, "R-END-03")!;
    expect(t).toMatch(/Made with AI/);
    expect(t).toMatch(/FILLER EXCEPTION/);
    expect(ruleText(risk, "R-PRF-01")).toMatch(/No invented reviews/);
    expect(ruleText(risk, "R-ADV-99")).toBeNull();
    const p = claimsPrompt({ entry: { label: "Shop A" }, rules: [{ id: "R-END-03", text: t }], draft: "Our new reel" });
    expect(p[1]!.content).toMatch(/R-END-03: .*FILLER EXCEPTION/);
  });
  it("no answer or a bad shape is null (held), never a pass", () => {
    expect(parseClaims('{"pass": true, "broken": []}')).toMatchObject({ pass: true });
    expect(parseClaims('{"pass": "yes"}')).toBeNull();
    expect(parseClaims(null)).toBeNull();
  });
  it("the decision prompt holds counts and the roster, never a row of anyone's data", () => {
    const p = decisionPrompt({ playbook: "PB", entry: roster[0]!, summary, trends: ["a"], today: "2026-11-23", todos: ["t"] });
    expect(p[1]!.content).toMatch(/threads, en\): 80/);
    expect(p[1]!.content).toMatch(/not read: x/);
    expect(p[1]!.content).not.toMatch(/@/);
  });
});

/**
 * ONE TEST PER CLAIMS RULE (the brief's binding list). For each: the brand it binds always carries it
 * (even when its roster entry forgets it), the rule's own words reach that brand's claims prompt, and
 * a rule whose words are missing from the risk brain holds the draft (the cycle test proves a failing
 * verdict blocks). The model reads meaning; code guarantees it is asked about the right rule.
 */
const RISK = [
  ["R-ADV-13", "ApprovalPrep is marketed as self-service, the alternative to paying a credit repair company."],
  ["R-ADV-05", "No income claims in A Player Mode; results are examples, not guarantees."],
  ["R-ADV-06", "No health or weight-loss promises."],
  ["R-PRF-01", "No invented reviews, testimonials or ratings."],
  ["R-PRF-02", "No invented people: no fake reviewers, experts, staff or credentials."],
  ["R-END-01", "Affiliate links are labelled near the link."],
  ["R-END-03", "AI-made clips carry Made with AI."],
].map(([id, t]) => `| ${id} | ${t} | source |`).join("\n");
describe.each([
  ["R-ADV-13", "approvalprep", "We fix your credit for you, guaranteed."],
  ["R-ADV-05", "a-player-mode", "Make $10K a month with this mode."],
  ["R-ADV-06", "a-player-mode", "Lose 20 pounds in 30 days."],
  ["R-PRF-01", "dream-wedding", "★★★★★ 'Best planner ever!' — Jess"],
  ["R-PRF-02", "keepmyproof", "Our in-house CPA, Dr. Mark Hill, recommends it."],
  ["R-END-01", "peace-be-still", "Get the Bible we use (link)."],
  ["R-END-03", "porch-and-party", "An AI-made porch reveal clip with no label."],
])("claims rule %s", (id, key, draft) => {
  const entry = { label: key, key, limits: [] as string[] };
  it("binds its brand even with an empty roster limits line, and its words reach the prompt", () => {
    expect(rulesFor(entry)).toContain(id);
    const { rules, missing } = claimRules(entry, RISK);
    expect(missing).toEqual([]);
    const prompt = claimsPrompt({ entry, rules, draft })[1]!.content;
    expect(prompt).toContain(`${id}: `);
    expect(prompt).toContain(draft);
  });
  it("missing from the risk brain: named as missing, so the draft is held", () => {
    const without = RISK.split("\n").filter((l) => !l.includes(`| ${id} |`)).join("\n");
    expect(claimRules(entry, without).missing).toContain(id);
  });
});
it("every brand on the scoreboard has its required rules written", () => {
  expect(Object.keys(REQUIRED_RULES)).toEqual(expect.arrayContaining(["*", "approvalprep", "a-player-mode", "porch-and-party"]));
});

describe("the naming guard (her ruling, 21 Nov 2026; USPTO sn 98839129)", () => {
  it("blocks Black Bible Stories in any form and a bare Black Bible Chat; passes the approved names and plain posts", () => {
    expect(namingProblems("New: Black Bible Stories for kids")).toHaveLength(1);
    expect(namingProblems("Tonight's story #blackbiblestories")).toHaveLength(1);
    expect(namingProblems("Try Black Bible Chat tonight")).toHaveLength(1);
    expect(namingProblems("Hush Harbor · Black Bible Chat tonight")).toHaveLength(1);
    expect(namingProblems("Black-Bible-Stories for kids")).toHaveLength(1);
    expect(namingProblems("Black–Bible—Stories")).toHaveLength(1);
    expect(namingProblems("Hush Harbor · Black Bible Chat & Stories: a night story")).toEqual([]);
    expect(namingProblems("Bible Stories with Black Faces, every night #blackbiblechat")).toEqual([]);
    // Hashtags and music are judgement, never required: a post with neither is clean.
    expect(namingProblems("Some things you can't tell anyone.")).toEqual([]);
  });
});

describe("older work: the Director's verdicts are shaped, never guessed", () => {
  it("keeps only known verdicts with a reason; a change needs its next step", () => {
    const d = parseDecision(JSON.stringify({ decision: "x", linked: [
      { id: "olp_a1", verdict: "keep", why: "season" }, { id: "olp_b2", verdict: "change", why: "y" },
      { id: "olp_c3", verdict: "maybe", why: "z" }, { id: "olp_d4", verdict: "drop", why: "" }, { id: "not an id", verdict: "drop", why: "w" },
      { id: "olp_e5", verdict: "change", why: "v", next_step: "Do the porch weeks" },
    ] }))!;
    expect(d.linked).toEqual([
      { id: "olp_a1", verdict: "keep", why: "season", next_step: null },
      { id: "olp_e5", verdict: "change", why: "v", next_step: "Do the porch weeks" },
    ]);
  });
});

describe("her fortnightly report: built from the record, plain words, honest line 1", () => {
  const O = { origin: "https://example.test", at: Date.UTC(2026, 10, 23, 12) };
  const SC = { start: "2026-11-23", first: { label: "Porch & Party requests in the last 28 days", by: 30, floor: { value: 4 } }, real: { label: "money in across the growth businesses, last 28 days", unit: "$", by: 60, floor: { value: 1000 } } };
  const sums = [{ key: "porch-and-party", totals: { money: 730, requests: 2, sales: null } }, { key: "approvalprep", totals: { money: null, sales: null } }];
  const queued = (channel: string, format: string) => ({ kind: "queued", loop: "olp_x1", item: { channel, format, draft: "x" } });
  const pnp = { business: "porch-and-party", label: "Porch & Party", state: "decided", decision: "More **instagram-reels** for olp_x1, R-PRF-01 checked. Second sentence.", actions: [queued("instagram", "reel"), queued("facebook-page", "carousel")] };

  it("line 1: cards waiting; else posts queued; else nothing queued, and why below", () => {
    expect(reportSection([pnp], { ...O, cards: 2 }).lines[0]).toBe("2 growth ideas wait for your yes in Decide. Nothing else to do.");
    expect(reportSection([pnp], { ...O, cards: 0 }).lines[0]).toBe("Nothing to do: 2 posts were queued from formats you already approved.");
    const allHeld = reportSection([{ business: "approvalprep", label: "ApprovalPrep", state: "held: no model", decision: "x", actions: [] }, { business: "dream-wedding", label: "Dream Wedding", state: "paused", decision: "x", actions: [] }], { ...O, cards: 0 });
    expect(allHeld.lines[0]).toBe("Nothing to do: nothing new was queued this fortnight. Why, below.");
    expect(allHeld.lines.join("\n")).toContain("ApprovalPrep (no free writer answered; it tries again next Monday)");
    expect(allHeld.lines.join("\n")).toContain("Paused: Dream Wedding.");
    const why = reportSection([{ business: "dream-wedding", label: "Dream Wedding", state: "paused", decision: "Paused: until the app is approved. Nothing measured, queued or posted.", actions: [] }], { ...O, cards: 0 });
    expect(why.lines).toContain("Paused: Dream Wedding (until the app is approved).");
  });

  it.each([
    ["held: no data", "nothing on its scoreboard could be read yet"],
    ["held: no model", "no free writer answered; it tries again next Monday"],
    ["held: roster", "its plan in the brain needs a fix; the team is on it"],
    ["held: error", "the run failed for it; the team is fixing it"],
  ])("a %s business is said in her words", (state, words) => {
    const r = reportSection([{ business: "approvalprep", label: "ApprovalPrep", state, decision: "x", actions: [] }], { ...O, cards: 0 });
    expect(r.lines).toContain(`Held, not guessed: ApprovalPrep (${words}).`);
    for (const l of r.lines) expect(lineProblems(l), l).toEqual([]);
  });

  it("a model's code words never reach her: every line passes the plain-words check", () => {
    const r = reportSection([pnp, { business: "approvalprep", label: "ApprovalPrep", state: "held: roster", decision: "NAMED STOP [X] roster", actions: [] }], { ...O, cards: 0, summaries: sums, scorecard: SC });
    for (const l of r.lines) expect(lineProblems(l), l).toEqual([]);
    const all = r.lines.join("\n");
    expect(all).not.toMatch(/olp_|R-PRF|\*\*|instagram-reels|NAMED STOP|\(roster\)/);
    expect(all).toContain("Porch & Party: $730 in, 2 requests in 28 days; 2 queued.");
    expect(all).toContain("Queued, for example: Porch & Party, Instagram reel; Porch & Party, Facebook Page carousel.");
    // Floors from the Scorecard row; an unread value is "not read", never 0.
    expect(all).toContain("Porch & Party requests in the last 28 days: 2 of 4 by Dec 23");
    // A business whose money was not read is named, never summed as $0.
    expect(all).toContain("money in across the growth businesses, last 28 days: $730 of $1,000 by Jan 22 (ApprovalPrep not read yet)");
  });

  it("the money floor: none read is \"not read yet\", all read sums with no gap, a business with no money number is not counted", () => {
    const line = (summaries: any[]) => reportSection([pnp], { ...O, cards: 0, summaries, scorecard: SC }).lines.find((l) => l.startsWith("Against the floors"))!;
    expect(line([{ key: "porch-and-party", totals: { money: null } }, { key: "a-player-mode", totals: { money: null } }])).toContain("last 28 days: not read yet (the floor is $1,000 by Jan 22)");
    expect(line([{ key: "porch-and-party", totals: { money: 700 } }, { key: "keepmyproof", totals: { money: 30 } }, { key: "how-we-know", totals: {} }])).toContain("last 28 days: $730 of $1,000 by Jan 22.");
    expect(line([{ key: "porch-and-party", totals: { money: 700 } }, { key: "a-player-mode", label: "A Player Mode", totals: { money: null } }, { key: "approvalprep", label: "ApprovalPrep", totals: { money: undefined } }])).toContain("$700 of $1,000 by Jan 22 (A Player Mode and ApprovalPrep not read yet)");
  });

  it("one of a thing is said singular, and a brand keeps its own spelling", () => {
    const r = reportSection([{ ...pnp, actions: [queued("wordpress", "guide-syndication"), queued("tiktok", "screen-video")] }], { ...O, cards: 0, summaries: [{ key: "porch-and-party", totals: { money: null, requests: 1, visits: 1 } }] });
    const all = r.lines.join("\n");
    expect(all).toContain("Porch & Party: 1 request, 1 visit in 28 days; 2 queued.");
    const many = reportSection([pnp], { ...O, cards: 0, summaries: [{ key: "porch-and-party", totals: { money: null, requests: 0, visits: 0 } }] }).lines.join("\n");
    expect(many).toContain("0 requests, 0 visits in 28 days");
    expect(all).toContain("Queued, for example: Porch & Party, WordPress guide syndication; Porch & Party, TikTok screen video.");
  });

  it("a plain model sentence is kept, only its first sentence", () => {
    const r = reportSection([{ ...pnp, decision: "Christmas porches lead, so reels show finished porches. More below." }], { ...O, cards: 0 });
    expect(r.lines[1]).toMatch(/2 queued\. Christmas porches lead, so reels show finished porches\.$/);
  });

  it("every two weeks: day 12 is not due, day 13 is", () => {
    expect(reportDue(null, "2026-11-23")).toBe(true);
    expect(reportDue("2026-11-23", "2026-12-05")).toBe(false);
    expect(reportDue("2026-11-23", "2026-12-06")).toBe(true);
  });
});

describe("backlink orders (22 Nov 2026: the network defers to the Director)", () => {
  const blRoster = parseRoster(`### Shop B
- key: shop-b
- buyer: b
- offer: o
- money number: m
- channels: backlinks [guide] · pinterest [pin]
- languages: en
- limits: R-PRF-01
`, "spry");
  const answer = (queue: unknown[]) => JSON.stringify({ decision: "More guides.", evidence: [], test: null, queue, proposals: [], next_check: "2026-11-30" });
  const at = (n: number) => "t".repeat(n);

  it("a backlinks item needs a topic of 1 to TOPIC_MAX characters: none, blank or too long is dropped and counted; the rest carry on", () => {
    const d = parseDecision(answer([
      { channel: "Backlinks", format: "guide", draft: "A guide lead", why: "w", topic: `  How to keep a rent   receipt ` },
      { channel: "backlinks", format: "guide", draft: "no topic", why: "w" },
      { channel: "backlinks", format: "guide", draft: "blank topic", why: "w", topic: "   " },
      { channel: "backlinks", format: "guide", draft: "long topic", why: "w", topic: at(TOPIC_MAX + 1) },
      { channel: "pinterest", format: "pin", draft: "A pin", why: "w", topic: "ignored off backlinks" },
    ]))!;
    expect(d.noTopic).toBe(3);
    expect(d.queue).toEqual([
      { channel: BACKLINKS, format: "guide", draft: "A guide lead", why: "w", topic: "How to keep a rent receipt" },
      { channel: "pinterest", format: "pin", draft: "A pin", why: "w" },
    ]);
    // The boundary: exactly TOPIC_MAX is kept, one more is not; never cut short.
    expect(topicOf(at(TOPIC_MAX))).toBe(at(TOPIC_MAX));
    expect(topicOf(at(TOPIC_MAX + 1))).toBeNull();
    expect(topicOf(42)).toBeNull();
    // Dropped items do not use up the queue's three places.
    const many = parseDecision(answer([{ channel: "backlinks", format: "guide", draft: "x", why: "w" }, ...[1, 2, 3].map((i) => ({ channel: "backlinks", format: "guide", draft: `d${i}`, why: "w", topic: `t${i}` }))]))!;
    expect(many.queue.map((q) => q.topic)).toEqual(["t1", "t2", "t3"]);
  });

  it("the prompt names the topic limit and the scale/stop rule only for a business with backlinks, with the topics already ordered", () => {
    const p = decisionPrompt({ playbook: "PB", entry: blRoster[0]!, summary, trends: [], today: "2026-11-23", todos: [], topics: ["2026-11-16: Rent receipts"] })[1]!.content;
    expect(p).toContain(`"topic": "backlinks only: the subject one of this business's existing pages answers, at most ${TOPIC_MAX} characters"`);
    expect(p).toMatch(/search visits 8 weeks later/);
    expect(p).toMatch(/rising .*request more topics; no rise 8 weeks after a topic → change topics/);
    // Her words, 22 Nov 2026: the network is not ours, it writes mostly about others, and a request must fit a real page.
    expect(p).toMatch(/OUTSIDE publisher with its own Cloudflare account/);
    expect(p).toMatch(/link REQUEST to it, never a command/);
    expect(p).toMatch(/mostly about other companies and subjects, fits at most 1 in 4 of its articles around requests/);
    expect(p).toMatch(/EXISTING pages genuinely answers/);
    expect(p).toMatch(/NO_FIT; KeepMyProof "cash rent"/);
    expect(p).toMatch(/Never call the network ours/);
    expect(p).toContain(`At most ${MAX_BACKLINKS_PER_CYCLE} "backlinks" item per week`);
    expect(p).toContain("- 2026-11-16: Rent receipts");
    const none = decisionPrompt({ playbook: "PB", entry: roster[0]!, summary, trends: [], today: "2026-11-23", todos: [] })[1]!.content;
    expect(none).not.toMatch(/BACKLINK|"topic"/);
  });

  it("an unapproved backlinks format is refused, never her card; an approved one goes to the claims check", () => {
    expect(routeItem(blRoster, "shop-b", { channel: "backlinks", format: "guide" })).toEqual({ to: "claims" });
    expect(routeItem(blRoster, "shop-b", { channel: "backlinks", format: "listicle" })).toMatchObject({ to: "refused", stop: "NOT_APPROVED" });
    expect(routeItem(roster, "shop-a", { channel: "backlinks", format: "guide" })).toMatchObject({ to: "refused", stop: "NOT_APPROVED" });
  });

  it("orders: ordered backlinks items of each business's newest decided row only, four fields, a broken row skipped", () => {
    const ordered = (topic: string, draft = "lead") => ({ kind: "ordered", item: { channel: "backlinks", format: "guide", draft, why: "visits rose", topic } });
    const rows = [
      { id: "gdc_a1", business: "approvalprep", state: "decided", created_at: 1, actions: JSON.stringify([ordered("old run")]) },
      { id: "gdc_a2", business: "approvalprep", state: "decided", created_at: 2, actions: JSON.stringify([
        ordered("Dispute letters by mail"),
        { kind: "queued", item: { channel: "pinterest", format: "pin", draft: "PIN DRAFT", why: "w" } },
        { kind: "blocked", why: "x", item: { channel: "backlinks", format: "guide", draft: "BLOCKED", why: "w", topic: "blocked topic" } },
        { kind: "ordered", item: { channel: "pinterest", format: "pin", draft: "WRONG CHANNEL", why: "w", topic: "t" } },
        { kind: "ordered", item: { channel: "backlinks", format: "guide", draft: "LONG", why: "w", topic: at(TOPIC_MAX + 1) } },
        null,
      ]) },
      { id: "gdc_k1", business: "keepmyproof", state: "held: no model", created_at: 3, actions: JSON.stringify([ordered("held row")]) },
      { id: "gdc_bad", business: "dream-wedding", state: "decided", created_at: 4, actions: "{not json" },
      { id: "gdc_obj", business: "a-player-mode", state: "decided", created_at: 5, actions: JSON.stringify({ kind: "ordered" }) },
    ];
    const { orders, skipped } = backlinkOrders(rows);
    expect(orders).toEqual([{ business: "approvalprep", topic: "Dispute letters by mail", draft: "lead", why: "visits rose" }]);
    expect(skipped.sort()).toEqual(["gdc_bad", "gdc_obj"]);
    expect(backlinkOrders([])).toEqual({ orders: [], skipped: [] });
  });

  it("her report counts the orders, never as a post queued", () => {
    const rows = [{ label: "ApprovalPrep", business: "approvalprep", state: "decided", decision: "More guides.", actions: [{ kind: "ordered", item: { channel: "backlinks", format: "guide", draft: "d", why: "w", topic: "t" } }] }];
    const r = reportSection(rows, { cards: 0, origin: "https://x", at: 0 });
    expect(r.lines[0]).toMatch(/^Nothing to do: one backlink article was requested/);
    expect(r.lines.join("\n")).toMatch(/ApprovalPrep: numbers not read in 28 days; 1 backlink article requested\./);
  });
});
