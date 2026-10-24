/**
 * WORDS THAT GO OUT IN HER NAME (owner, 24 Oct 2026, via the main session):
 *  1. Her buyers are "LPs" or "LP relationships", never "buyers", in anything outward: prospect
 *     emails, match intro notes, LP replies, deal drafts. (Internal labels such as "Yours: buyer" on
 *     the grid stay; they are hers to read, not outward.)
 *  2. A prospect email never names Anthropic; it alludes ("a leading frontier AI lab"). Other names
 *     are said as they are.
 *  3. Her featured-names edits apply EVERY name in a list ("add OpenAI, Anduril, Databricks").
 * Synthetic names only: the repo is public.
 */
import { describe, expect, it } from "vitest";
import { pairDrafts } from "../scripts/ops/interest-grid.mjs";
import { DEFAULT_PROSPECT_TEMPLATE, renderProspect, namesLine, subjectNames, nameRulesIn, withoutNeverNamed } from "../src/shared/boss/lp/plan.mjs";

const BUYER = /\bbuyers?\b/i;
const g = (o: Record<string, unknown>) => ({ side: "buy", direction: "buy", company: "Company Q", size_usd: 5e6, size_text: "$5M", price_text: "—", from_text: "X", _row: {}, ...o });

describe("her buyers are LPs in anything outward", () => {
  const cases = [
    [g({ _row: { from: "bo@buyer.example", from_name: "Bo Buyer" } }), g({ side: "sell", direction: "sell", size_text: "$25M", _row: { from: "pat@seller.example", from_name: "Pat Seller" } })],
    [g({ size_text: "—", _row: { from: "bo@buyer.example" } }), g({ side: "sell", direction: "sell", price_text: "$100/share", _row: { from: "pat@seller.example" } })],
    [g({ side: "yours", _row: {} }), g({ side: "sell", direction: "sell", _row: { from: "pat@seller.example" } })],
  ];
  it("match intro notes, both sides, every shape, never say buyer", () => {
    let n = 0;
    for (const [buyer, seller] of cases) for (const d of pairDrafts(buyer, seller)) {
      n++;
      expect(`${d.subject}\n${d.body}`, d.body).not.toMatch(BUYER);
    }
    expect(n).toBeGreaterThanOrEqual(5); // Rule 0: a test over no notes is no test
    expect(pairDrafts(cases[0]![0], cases[0]![1])[0]!.body).toContain("I have an LP looking for $5M.");
  });
  it("prospect emails, first touch and follow-up, every names variant, never say buyer", () => {
    for (const touch of [1, 2]) for (const variant of [0, 1, 2]) {
      const r = renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex", names: ["Company A", "Company B", "Company C"], touch, variant });
      expect(`${r.subject}\n${r.body}`).not.toMatch(BUYER);
    }
  });
});

describe("a prospect email never names Anthropic", () => {
  it("alludes to it in the names line, leaves it out of the subject, and sweeps an edited template", () => {
    const names = ["OpenAI", "Anthropic", "Anduril"];
    expect(namesLine(names)).toBe("Names coming across my desk at the moment are: OpenAI, a leading frontier AI lab, Anduril.");
    expect(subjectNames(names)).toBe("OpenAI, Anduril");
    for (const touch of [1, 2]) for (const variant of [0, 1, 2]) {
      const r = renderProspect({ ...DEFAULT_PROSPECT_TEMPLATE, body: `${DEFAULT_PROSPECT_TEMPLATE.body}\nWe also see ANTHROPIC PBC and Anthropic's tender.` }, { first: "Alex", names: ["anthropic", ...names], touch, variant });
      expect(`${r.subject}\n${r.body}`).not.toMatch(/anthropic/i);
      expect(r.body).toContain("OpenAI");
    }
    expect(withoutNeverNamed("Anthropic’s round")).toBe("a leading frontier AI lab round");
  });
});

describe("her featured-names edits apply every name in a list", () => {
  it("commas, 'and' and '&', for add, drop and never feature", () => {
    expect(nameRulesIn("add Company A, Company B, Company C")).toEqual([
      { rule: "add", name: "Company A" }, { rule: "add", name: "Company B" }, { rule: "add", name: "Company C" },
    ]);
    expect(nameRulesIn("Please add Alpha Labs, Beta and Gamma Co. Then drop Delta & Epsilon, and never feature Zeta.")).toEqual([
      { rule: "add", name: "Alpha Labs" }, { rule: "add", name: "Beta" }, { rule: "add", name: "Gamma Co" },
      { rule: "drop", name: "Delta" }, { rule: "drop", name: "Epsilon" }, { rule: "never", name: "Zeta" },
    ]);
    expect(nameRulesIn("add Solo")).toEqual([{ rule: "add", name: "Solo" }]);
    expect(nameRulesIn("happy to talk about what you're looking to add or trim")).toEqual([]);
  });
});
