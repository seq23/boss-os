import { describe, it, expect } from "vitest";
import { CHECKS, hardFloor, visibleText, wordCount } from "../src/shared/boss/searchReadiness/audit.mjs";

/*
 * Owner ruling, 2 Nov 2026 (personal brain): "over a word limit never fails; under one fails only
 * below 75% of it". On 7 Nov the checker still failed dentistryguides.com guides at 1,679-1,796
 * words against the 1,800 target and queued them as fix work (brief sr-dentistryguides.com-j3).
 */
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const cta = '<a href="https://dentistryguides.com/request-assistance/?vertical=dentistry&kind=guide&slug=x">Get help</a>';
// Fixed parts of the guide page contribute their own words; pad the body to land on an exact total.
const guideAt = (total: number) => {
  const shell = (body: string) => `<html><body><h1>Guide</h1><h2>Quick answer</h2><p>${body}</p>${cta}</body></html>`;
  const fixed = wordCount(visibleText(shell("")));
  const html = shell(words(total - fixed));
  expect(wordCount(visibleText(html))).toBe(total);
  return { url: "https://dentistryguides.com/guides/x/", status: 200, html };
};
const run = (check: string, pages: any[], params?: any) => CHECKS[check]!({ host: "dentistryguides.com", pages, files: {}, portfolio: [] } as any, params);

describe("word limits fail only below 75% of the target, and never over it", () => {
  it("the cushion is 75%, rounded up", () => {
    expect(hardFloor(1800)).toBe(1350);
    expect(hardFloor(300)).toBe(225);
    expect(hardFloor(40)).toBe(30);
  });

  it("j3 guide_shape: the three brief guides (1,679 / 1,767 / 1,796 words) pass with a note", () => {
    for (const n of [1679, 1767, 1796]) {
      const r = run("guide_shape", [guideAt(n)]);
      expect(r.status).toBe("pass");
      expect(r.detail).toMatch(/1 under the 1,800-word target/);
    }
  });

  it("j3 guide_shape: still fails a real stub, at the boundary", () => {
    expect(run("guide_shape", [guideAt(1349)]).status).toBe("fail");
    expect(run("guide_shape", [guideAt(1350)]).status).toBe("pass");
    expect(run("guide_shape", [guideAt(900)]).detail).toMatch(/900 words/);
  });

  it("j3 guide_shape: the cushion never excuses a missing Quick answer or CTA", () => {
    const g = guideAt(1700);
    expect(run("guide_shape", [{ ...g, html: g.html.replace("Quick answer", "Overview") }]).status).toBe("fail");
    expect(run("guide_shape", [{ ...g, html: g.html.replace(cta, "") }]).status).toBe("fail");
  });

  it("word_count: thin pages fail below 225 of 300, near-misses are a note", () => {
    const pg = (n: number) => ({ url: "https://dentistryguides.com/a/", status: 200, html: `<p>${words(n)}</p>` });
    expect(run("word_count", [pg(224)]).status).toBe("fail");
    const near = run("word_count", [pg(260)]);
    expect(near.status).toBe("pass");
    expect(near.detail).toMatch(/1 under the 300-word target/);
  });

  it("definition_paragraph: fails under 30 words, a long or slightly short definition is a note", () => {
    const def = (n: number) => ({ url: "https://dentistryguides.com/guides/x/", status: 200,
      html: `<h1>X</h1><p>An implant is ${words(n - 3)}</p>` });
    expect(run("definition_paragraph", [def(25)]).status).toBe("fail");
    for (const n of [32, 50, 95]) expect(run("definition_paragraph", [def(n)]).status).toBe("pass");
    expect(run("definition_paragraph", [def(95)]).detail).toMatch(/outside the 40–60 word target/);
  });

  it("llms_txt: over the word limit never fails", () => {
    const files = { "/llms.txt": { status: 200, type: "text/plain", text: words(4000) } };
    expect(CHECKS.llms_txt!({ host: "dentistryguides.com", files } as any).status).toBe("pass");
  });
});
