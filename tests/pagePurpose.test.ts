import { describe, expect, it } from "vitest";
import { PAGE_PURPOSES, pagePurpose } from "../src/shared/help/pagePurpose";

/**
 * How each page explains itself. The nav coverage checks read the copied West Peek fund screens'
 * App.tsx, which was retired on 22 Nov 2026; the registry goes in the next step of the retirement.
 */

describe("how each one is written", () => {
  it("says what the page is, in a sentence a person would say out loud", () => {
    for (const [key, p] of Object.entries(PAGE_PURPOSES)) {
      expect(p.purpose.length, key).toBeGreaterThan(30);
      expect(p.purpose.trim().endsWith("."), key).toBe(true);
    }
  });

  it("gives two to four things you can actually do", () => {
    for (const [key, p] of Object.entries(PAGE_PURPOSES)) {
      expect(p.youCan.length, key).toBeGreaterThanOrEqual(2);
      expect(p.youCan.length, key).toBeLessThanOrEqual(4);
    }
  });

  it("uses no system vocabulary", () => {
    // If a line needs a schema term to make sense, it is written for the wrong reader.
    const jargon = /\b(payload|schema|endpoint|CRUD|idempoten|foreign key|migration|D1|JSON|API)\b/i;
    for (const [key, p] of Object.entries(PAGE_PURPOSES)) {
      expect(jargon.test(p.purpose), `${key} purpose`).toBe(false);
      for (const c of p.youCan) expect(jargon.test(c), `${key}: ${c}`).toBe(false);
    }
  });

  it("does not start every 'you can' line with the same verb", () => {
    // A list of four lines all starting "View…" tells the reader nothing they could not guess.
    for (const [key, p] of Object.entries(PAGE_PURPOSES)) {
      const verbs = p.youCan.map((c) => c.split(" ")[0]!.toLowerCase());
      expect(new Set(verbs).size, key).toBeGreaterThan(1);
    }
  });
});
