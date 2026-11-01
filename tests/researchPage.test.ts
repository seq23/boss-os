/**
 * CAMILLE'S RESEARCH PAGE (owner, 22 Oct 2026): one question in, one page out. Pins the grammar, the
 * delivery check (Rule 0: no page is a failure by name), the rendering (escaped, https links only)
 * and that admitTask, the seat-run report and the route are wired to the shared module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeResearchPrompt, markdownToHtml, parseResearchPage, readResearchDelivery, renderResearchPageHtml, researchPageUrl, RESEARCH_PAGE_ROUTE,
} from "../src/shared/boss/research/page.mjs";
import { researchPageToBossPath } from "../src/worker/bossMount";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("research page: the ask", () => {
  it("reads the verb in her three shapes", () => {
    expect(parseResearchPage("#camille research: what do Memphis senior homes pay referral services?")?.question).toBe("what do Memphis senior homes pay referral services?");
    expect(parseResearchPage(["research on Pinterest affiliate rules for printables", null])?.question).toBe("Pinterest affiliate rules for printables");
    expect(parseResearchPage("Research page — the best free OCR APIs in 2026")?.question).toBe("the best free OCR APIs in 2026");
  });
  it("leaves an ordinary message ordinary", () => {
    expect(parseResearchPage("thanks for the research yesterday, all good")).toBeNull();
    expect(parseResearchPage("research: ok")).toBeNull();
  });
  it("tells the seat the exact delivery and the page address — a page, never an /api path (repair, 1 Nov 2026 held mail)", () => {
    const p = composeResearchPrompt({ id: "rpg_abc", question: "Q?" });
    expect(p).toContain('"research_page"');
    expect(p).toContain("delivers.json");
    expect(p).toContain(`Page: ${researchPageUrl("rpg_abc")}`);
    expect(researchPageUrl("rpg_abc")).toBe("https://boss.sequoiataylor.com/research/rpg_abc");
    expect(researchPageUrl("rpg_abc")).not.toMatch(/\/api\//);
    // It still maps back to the route the handler is mounted at — a plain address cannot point nowhere.
    expect(researchPageToBossPath("/research/rpg_abc")).toBe(`${RESEARCH_PAGE_ROUTE}/rpg_abc`);
  });
});

describe("research page: the delivery", () => {
  const good = { status: "complete", research_page: { title: "Referral fees in Memphis", summary: "Most pay 50–100% of first month.", markdown: "## Answer\n\n- **Most communities** pay a placement fee.\n- See [the survey](https://example.org/s) for detail and more lines here to pass the bound.", sources: [{ title: "Survey", url: "https://example.org/s" }, { title: "bad", url: "http://insecure" }] }, gaps: [] };
  it("files a real page, keeping https sources only", () => {
    const r = readResearchDelivery(good);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.page.sources).toEqual([{ title: "Survey", url: "https://example.org/s" }]); expect(r.page.status).toBe("complete"); }
  });
  it("a page with gaps is partial, whatever the run called it", () => {
    const r = readResearchDelivery({ ...good, gaps: ["no 2026 figure"] });
    expect(r.ok && r.page.status).toBe("partial");
  });
  it("no page is a failure by name (Rule 0)", () => {
    expect(readResearchDelivery({})).toEqual({ ok: false, why: "the run's delivers.json carried no research_page object" });
    expect(readResearchDelivery({ research_page: { title: "x", markdown: "short" } }).ok).toBe(false);
  });
  it("renders escaped HTML with https links only", () => {
    expect(markdownToHtml("<script>x</script> [a](javascript:alert(1)) [b](https://ok.example)")).toBe('<p>&lt;script&gt;x&lt;/script&gt; [a](javascript:alert(1)) <a href="https://ok.example" rel="noopener noreferrer">b</a></p>');
    const html = renderResearchPageHtml({ title: "T <b>", markdown: "## H\n- **x** y", sources: [{ title: "S", url: "https://e.org" }] });
    expect(html).toContain("<title>T &lt;b&gt;</title>");
    expect(html).toContain("<h3>H</h3>");
    expect(html).toContain("<li><strong>x</strong> y</li>");
    expect(html).toContain("prefers-color-scheme:dark");
  });
});

describe("research page: wired end to end", () => {
  it("admitTask parks it for Camille's seat and writes the row", () => {
    const s = read("src/worker/boss/tasks/admit.ts");
    expect(s).toContain("parseResearchPage(");
    expect(s).toContain("backend_id: RESEARCH_PAGE_BACKEND");
    expect(s).toContain("INSERT INTO research_pages");
    // A duty's composed prompt is never re-read as her ask (the briefing is Camille's and has "Research…" lines).
    expect(s).toContain("input.spec_module === undefined");
    expect(s).toContain("parseResearchPage([b.title, input.body as string | undefined])");
  });
  it("the seat-run report files it, and the route serves it", () => {
    expect(read("src/worker/boss/routes/backends.ts")).toContain("await deliverResearchPage(c.env");
    const r = read("src/worker/boss/routes/research.ts");
    expect(r).toContain('research.get("/pages/:id"');
    expect(r).toContain('research.post("/delivered"');
  });
  it("her ask is not budget-gated like a duty", () => {
    expect(read("src/worker/boss/queue/consumer.ts")).toContain("scheduled: !(input.research_page && typeof input.research_page === \"object\")");
  });
});
