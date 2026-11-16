import { describe, expect, it } from "vitest";
import { fromLegacy } from "../src/shared/boss/mail/plain.mjs";

describe("a Got it that says 'reply by number' shows the numbers", () => {
  it("keeps numbered lines numbered in the sent text, and bullets stay bullets", () => {
    const text = [
      "Got it. 2 things for you to answer below (reply by number); Monique has started on everything else.",
      "Monique has: write the drip campaign",
      "2 things I need from you (reply by number; everything else is already being built):",
      "  1. You wrote \"these people\": all three, or specific ones?",
      "  2. You wrote \"a one pager\": what should it cover?",
    ].join("\n");
    const out = fromLegacy({ who: "Simone", subject: "Re: campaign", text }).text as string;
    expect(out).toMatch(/^\s*1\. You wrote "these people"/m);
    expect(out).toMatch(/^\s*2\. You wrote "a one pager"/m);
    expect(out).not.toMatch(/^- You wrote/m);
    expect(out).toMatch(/^- Monique has: write the drip campaign/m);
  });
});
