/**
 * WHO HOLDS OR OFFERS THE BLOCK DECIDES THE SIDE (owner, 25 Oct 2026).
 *
 * She forwarded a broker's note and the extractor stored a $1B Anthropic SELL as "Yours: buyer";
 * Monique then hunted sellers "for your $1B Anthropic buyer" and drafted "I have an LP looking for
 * $1B" notes. This pins her exact wording as a SELL that is not hers, and the narrow guard that must
 * leave ordinary buy orders alone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideSide, offeredIn, isRelayedNote } from "../src/shared/boss/deals/side.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { normalise, admissible, recheckRows } from "../scripts/ops/interest-extract.mjs";
import { gridRow, yoursLabel } from "../scripts/ops/interest-grid.mjs";

const IDENTITY = { names: ["sequoia taylor"], addresses: ["staylor@spry.vc", "seq.taylor@example.com"], domains: ["spry.vc"], firmLocal: ["staylor"] };
const MSG = {
  source_message: "1a16e5d53908484b", date: "2026-10-24", from: "staylor@spry.vc", from_name: "Sequoia Taylor",
  to: ["broker@example.com"], cc: [], outbound: true, subject: "Find Spanish merchant bank",
  excerpt: "Hi Sequoia - . \n\nHe's got a $1 billion Anthropic block at 1.35T + 4% sell side fees. We are adding 2% for our buy side group. You need to add your fees on top. \n\nBlock is pre-approved and direct on the cap table. \n———-\nCan u find this seller rep it’s a merchant bank out of Spain \n",
};
// What the model returned on 24 Oct 2026, word for word.
const MODEL_ROW = {
  principal: "your client", principal_email: null, side: "buy", asset: "Anthropic", size_usd: 1000000000, size_shares: null,
  size_text: "$1 billion", price_text: "1.35T valuation", durability: "wants_now", confidence: "high", intermediated_by: null,
  evidence: "Pre-approved block, direct on cap table, specific size and valuation.",
  quote: "He's got a $1 billion Anthropic block at 1.35T + 4% sell side fees", source_message: "1a16e5d53908484b",
  structure_text: "4% sell side fees, 2% buy side fees",
};

describe("the side is the block's, never the sender's (25 Oct 2026)", () => {
  it("her exact wording is a SELL", () => {
    expect(offeredIn(MODEL_ROW.quote).side).toBe("sell");
    expect(offeredIn("Block is pre-approved and direct on the cap table. 4% sell side fees").side).toBe("sell");
    const d = decideSide(MODEL_ROW);
    expect(d.side).toBe("sell");
    expect(d.side_note).toMatch(/corrected from buy/);
  });

  it("the forwarded note is the broker's order: not hers, not \"your client\", never \"Yours\"", () => {
    expect(isRelayedNote(MSG)).toBe(true);
    expect(admissible(MODEL_ROW, MSG)).toBeNull();
    const row = normalise(MODEL_ROW, MSG);
    expect(row.side).toBe("sell");
    expect(row.hers).toBe(false);
    expect(row.relayed).toBe(true);
    expect(row.principal).not.toMatch(/your client/i);
    const g = gridRow({ ...row, date: "2026-10-24" }, { identity: IDENTITY, lists: {} });
    expect(g.side).toBe("sell");
    expect(g.direction).toBe("sell");
    expect(g.from_text).not.toMatch(/^You$|Sequoia/);
    expect(g.from_text).toMatch(/a note you passed on/);
    // The re-check corrects the stored row the same way, without the model.
    const { rows, changes } = recheckRows([{ ...MODEL_ROW, via: "model", date: "2026-10-24", outbound: true, hers: true, from: MSG.from, from_name: MSG.from_name }], new Map([[MSG.source_message, MSG]]), IDENTITY);
    expect(rows[0].side).toBe("sell");
    expect(rows[0].hers).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it("her own direct order still reads \"Yours\"", () => {
    const own = { ...MSG, source_message: "own1", to: ["rrlist@rainmakersecurities.com"], excerpt: "anyone have $30M+ of Higgsfield" };
    const row = normalise({ ...MODEL_ROW, source_message: "own1", principal: "your client", side: "buy", asset: "Higgsfield", quote: "anyone have $30M+ of Higgsfield" }, own);
    expect(row.side).toBe("buy");
    expect(row.hers).toBe(true);
    expect(yoursLabel("buy")).toBe("Yours: buyer");
  });

  it("an ambiguous side stays UNSET with its reason — never a default buy", () => {
    const r = { ...MODEL_ROW, side: null, side_note: "the note names a block and a buyer", quote: "Anthropic, $1B, call me" };
    expect(admissible(r, { ...MSG, outbound: false, excerpt: "" })).toBeNull();
    expect(decideSide(r)).toEqual({ side: null, side_note: "the note names a block and a buyer" });
    expect(decideSide({ ...r, side_note: null }).side).toBeNull();
    expect(admissible({ ...r, side_note: null }, MSG)).toBe("no side");
  });

  it("the guard leaves buy orders and questions alone", () => {
    for (const q of [
      "I have a buyer for $50 million of SpaceX Series E.",
      "Is your $4.3m block still available at $189?",
      "I have a couple of buyers who want to talk. If you have a new block available then I will call.",
      "Janelle has confirmed up to 450m of interest in the block",
      "We have finally closed the final $2MM Didi block.",
      "I have a funded buyer looking for $10M of Physical Intelligence",
    ]) expect(offeredIn(q).side, q).toBeNull();
    expect(decideSide({ side: "buy", quote: "I have a buyer for $50 million of SpaceX Series E." }).side).toBe("buy");
  });

  it("the prompt carries the rule, so the model reads it the same way", () => {
    const p = readFileSync("scripts/ops/interest-extract-prompt.md", "utf8");
    expect(p).toMatch(/who holds or offers the block decides it/i);
    expect(p).toMatch(/Never\s+default to buy/);
    expect(p).toMatch(/"relayed": true/);
  });
});
