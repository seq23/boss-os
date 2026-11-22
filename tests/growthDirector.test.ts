/**
 * THE GROWTH DIRECTOR'S RULES (pure). Each proven negatively:
 *   - no tests on noise: a test on a channel held "too little data" or "no data" is dropped by code;
 *   - a model answer that is not the shape is null (held), never guessed;
 *   - a spend or account proposal is refused, never a card; a not-approved post is a card;
 *   - HELD_ALL when every active business is held; nothing measured is its own stop;
 *   - the claims prompt carries the brand's rule words from the risk brain, rulings included.
 */
import { describe, expect, it } from "vitest";
import { parseDecision, enforceHolds, routeItem, routeProposal, cycleEnd, ruleText, parseClaims, claimsPrompt, decisionPrompt } from "../src/shared/boss/growth/director.mjs";
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
  it("a spend or new-account proposal is refused, never a card", () => {
    expect(routeProposal(roster, "shop-a", { what: "Boost the best reel for $10" })).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    expect(routeProposal(roster, "shop-a", { what: "Run Meta ads on the Christmas page" })).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
    expect(routeProposal(roster, "shop-a", { what: "Open a new TikTok account for the brand" })).toMatchObject({ to: "refused", stop: "NO_NEW_ACCOUNTS" });
    expect(routeProposal(roster, "shop-a", { what: "Try a Christmas price bundle on the site" })).toEqual({ to: "card" });
    expect(routeProposal(roster, "shop-a", { what: "Add a $50 porch refresh add-on" })).toEqual({ to: "card" });
    expect(routeProposal(roster, "shop-a", { what: "Partner with a florist", costs_money: true })).toMatchObject({ to: "refused", stop: "NEVER_SPEND" });
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
