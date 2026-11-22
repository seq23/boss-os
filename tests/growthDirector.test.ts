/**
 * THE GROWTH DIRECTOR'S RULES (pure). Each proven negatively:
 *   - no tests on noise: a test on a channel held "too little data" or "no data" is dropped by code;
 *   - a model answer that is not the shape is null (held), never guessed;
 *   - a spend or account proposal is refused, never a card; a not-approved post is a card;
 *   - HELD_ALL when every active business is held; nothing measured is its own stop;
 *   - the claims prompt carries the brand's rule words from the risk brain, rulings included.
 */
import { describe, expect, it } from "vitest";
import { parseDecision, enforceHolds, routeItem, routeProposal, cycleEnd, ruleText, parseClaims, claimsPrompt, decisionPrompt, parseSpend, claimRules, rulesFor, REQUIRED_RULES, namingProblems } from "../src/shared/boss/growth/director.mjs";
import { parseRoster } from "../src/shared/boss/growth/roster.mjs";

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
    expect(namingProblems("Hush Harbor · Black Bible Chat & Stories: a night story")).toEqual([]);
    expect(namingProblems("Bible Stories with Black Faces, every night #blackbiblechat")).toEqual([]);
    // Hashtags and music are judgement, never required: a post with neither is clean.
    expect(namingProblems("Some things you can't tell anyone.")).toEqual([]);
  });
});
