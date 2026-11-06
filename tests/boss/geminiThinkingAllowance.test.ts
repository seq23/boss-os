import { describe, expect, it } from "vitest";
import { generationConfig, THINKING_ALLOWANCE } from "../../src/worker/boss/router/gemini";

/**
 * A grounded search on a famous founder thought ~1,700 tokens against a 1,500 cap, stopped at
 * MAX_TOKENS, and came back with no grounding pages (6 Nov 2026). The caller's cap is the answer's;
 * thinking gets its own bounded budget on top.
 */
describe("Gemini thinking never eats the answer's token cap", () => {
  it("adds a bounded thinking budget on thinking models and leaves older ones alone", () => {
    for (const slug of ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.6-flash"]) {
      const g = generationConfig(slug, 1500, 0.2) as any;
      expect(g.maxOutputTokens - g.thinkingConfig.thinkingBudget).toBe(1500);
      expect(g.thinkingConfig.thinkingBudget).toBe(THINKING_ALLOWANCE);
    }
    expect(generationConfig("gemini-1.5-flash", 1500, 0.2)).toEqual({ maxOutputTokens: 1500, temperature: 0.2 });
  });
});
