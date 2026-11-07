/**
 * THE RESEARCH DONE EMAIL CARRIES THE WHOLE REPORT (owner, 6 Nov 2026: the summary email "wasnt
 * helpful it was noting like the artifact"). What her Mac's sender actually posts for a research
 * Done notice: every section of the page in order, its tables, real links, words in their own case,
 * no Decide section, one Boss OS button, and under Gmail's clip size. Synthetic content only.
 */
import { describe, expect, it } from "vitest";
import { researchDoneEmail } from "../scripts/ops/task-notices.mjs";
import { FULL_EMAIL_MAX_HTML } from "../src/shared/boss/research/doneEmail.mjs";

const SECTIONS = ["The answer", "1. What the work is", "2. How it pays", "3. What it needs", "What I could not confirm"];
const page = {
  id: "rpg_synthetic01", state: "delivered", status: "partial",
  title: "Should a synthetic DNA shop open?",
  summary: "Worth a small test first. Start-up is $200 (ABCD course $150 + licence $50).",
  markdown: [
    "## The answer", "", "Worth a small test first. The ABCD course is **$150**.", "",
    "## 1. What the work is", "", "- Swabs, ID checks and paperwork ([ABCD](https://example.com/abcd)).", "",
    "## 2. How it pays", "", "| Route | Fee | Source |", "|---|---|---|", "| Lab work | Not published | [ABCD](https://example.com/abcd) |", "",
    "## 3. What it needs", "", "A DNA kit and a licence.", "",
    "## What I could not confirm", "", "- The fee per visit.",
  ].join("\n"),
  sources: [{ title: "ABCD", url: "https://example.com/abcd" }],
  gaps: ["The fee per visit."],
};
const notice = { kind: "done#3", from_name: "Camille", task_id: "tsk_synthetic01", subject: "Done (partial): Should a synthetic DNA shop open? [tsk_synthetic01]", body: "Open the full report: https://boss.sequoiataylor.com/research/rpg_synthetic01" };

describe("research Done email = the full report", () => {
  const e = researchDoneEmail(notice, page, "Camille");

  it("is the full-report layout, not the summary stub", () => {
    expect(e).not.toBeNull();
    let at = -1;
    for (const s of SECTIONS) {
      const i = e!.html.indexOf(s);
      expect(i, `section "${s}" in the email`).toBeGreaterThan(at);
      at = i;
      expect(e!.text).toContain(s.toUpperCase());
    }
  });

  it("keeps the page's tables and real links", () => {
    expect(e!.html).toMatch(/<table[\s>]/);
    expect(e!.html).toContain('href="https://example.com/abcd"');
    expect(e!.html).toContain('href="https://boss.sequoiataylor.com/research/rpg_synthetic01"');
  });

  it("never shows a Decide section and keeps words in their case", () => {
    expect(e!.html).not.toMatch(/Decide \(/);
    expect(e!.text).not.toMatch(/Decide \(/);
    expect(e!.html).toContain("ABCD");
    expect(e!.html).toContain("DNA");
    expect(e!.subject).toContain("DNA");
  });

  it("lists the gaps once, not twice", () => {
    expect(e!.html.split("The fee per visit.").length - 1).toBe(1);
  });

  it("stays under Gmail's clip size, keeping whole sections and naming what is left out", () => {
    const huge = { ...page, markdown: Array.from({ length: 400 }, (_, i) => `## Part ${i}\n\n${"Plain words about the work. ".repeat(40)}`).join("\n") };
    const big = researchDoneEmail(notice, huge, "Camille");
    expect(big!.html.length).toBeLessThanOrEqual(FULL_EMAIL_MAX_HTML + 4000);
    expect(big!.html).toMatch(/\d+ more sections? in Boss OS/);
  });
});
