/**
 * THE RESEARCH DONE EMAIL READS ON A PHONE (repair, 6 Nov 2026; review of the real DNA copy).
 * One answer block, at most four key-number lines each whole, the gaps on one line (three named).
 * Synthetic content only.
 */
import { describe, expect, it } from "vitest";
import { keyNumbersOf, gapsLineOf, researchDoneLayout, MAX_KEY_NUMBERS } from "../src/shared/boss/research/doneEmail.mjs";

const LONG = "The long view is that a shop like this could, in a good year with steady referrals and a second van, bring in something close to $90,000 before costs, which nobody has confirmed.";
const page = {
  title: "Should a synthetic shop open?",
  summary: "Worth a small test first. Start-up is $200 all in, but no supplier publishes what it pays per visit.",
  markdown: [
    "## The answer", "", "Worth a small test first. Start-up is $200 all in, but no supplier publishes what it pays per visit.", "",
    "## The numbers", "",
    ...Array.from({ length: 10 }, (_, i) => `- Item ${i + 1} costs **$${(i + 1) * 11}** a month.`),
    `- ${LONG}`,
    "- For example, a rival charges **$999** a visit.",
  ].join("\n"),
  sources: [{ title: "Example", url: "https://example.com/a" }],
  gaps: Array.from({ length: 12 }, (_, i) => `Gap number ${i + 1}: not found.`),
  status: "partial",
};

describe("the research Done email", () => {
  it("has one answer block, and no section repeats another's line", () => {
    const laid = researchDoneLayout({ who: "Camille", subject: "Done (partial): x", page, url: "https://boss.sequoiataylor.com/research/rpg_x" });
    expect(laid.text.match(/The answer/g)).toHaveLength(1);
    expect(laid.text).not.toMatch(/1-minute summary/i);
    const items = laid.text.split("\n").filter((l: string) => l.startsWith("- ")).map((l: string) => l.slice(2));
    expect(new Set(items).size).toBe(items.length);
  });

  it("gives at most four key numbers, each a whole line, never cut, never an example price", () => {
    const lines = keyNumbersOf(page);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(MAX_KEY_NUMBERS);
    for (const l of lines) {
      expect(l).toMatch(/[.!?]$/);
      expect(l).not.toContain("…");
    }
    expect(lines.join(" ")).not.toContain("$90,000");
    expect(lines.join(" ")).not.toContain("$999");
    expect(keyNumbersOf({ summary: "Nothing here has a figure.", markdown: "## The answer\n\nNo figures at all." })).toEqual([]);
  });

  it("names three gaps on one line and counts the rest", () => {
    const line = gapsLineOf(page.gaps);
    expect(line.split("\n")).toHaveLength(1);
    expect(line.split("; ").filter((x) => /gap number/i.test(x))).toHaveLength(3);
    expect(line).toContain("and 9 more in the report");
  });
});
