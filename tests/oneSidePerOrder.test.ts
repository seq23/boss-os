/** ONE ORDER IS ONE SIDE (26 Oct 2026): a broker relaying an offer to "my buyers" is not a Buy. */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs with no types
import { oneSidePerOrder } from "../scripts/ops/interest-grid.mjs";

const g = (direction: string, quote: string, msg = "m1", size = 6e6) => ({ company: "Company K", direction, size_usd: size, source_message: msg, _row: { quote } });

describe("the grid shows one side per order", () => {
  it("the relay ('I'll take both to my buyers') is dropped; the offer stays", () => {
    const out = oneSidePerOrder([g("sell", "Company K: $6M, single-layer SPV at $40B"), g("buy", "I'll take both to my buyers")]);
    expect(out.map((r: any) => r.direction)).toEqual(["sell"]);
  });
  it("a real buy and a real sell, each stating its size, both stay; different emails both stay", () => {
    expect(oneSidePerOrder([g("sell", "selling $6M"), g("buy", "buying $6M")])).toHaveLength(2);
    expect(oneSidePerOrder([g("sell", "selling $6M"), g("buy", "I'll take it to my buyers", "m2")])).toHaveLength(2);
  });
});
