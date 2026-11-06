/**
 * A PAGE THE SEAT DELIVERS SAYS DONE (repair, 6 Nov 2026). The deep research for Valerie was filed by
 * the Claude seat after the free rungs, and no Done notice was written: only the free rung wrote one.
 * Every filed page, whoever wrote it, writes exactly one Done notice; a partial one says so and names
 * its gaps. Synthetic content only.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deliverResearchPage } from "../../src/worker/boss/duties/deliverReport";
import { insertTask, uid } from "./helpers";

describe("a seat-delivered research page", () => {
  it("writes one Done notice with the answer, the gaps in one line and the page link, once", async () => {
    const pageId = uid("rpg");
    const taskId = await insertTask({
      title: "Deep research: a synthetic question", status: "running", intake_kind: "research",
      input: JSON.stringify({ delivers: "research_page", research_page: { page_id: pageId } }),
    });
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`)
      .bind(pageId, taskId, "A synthetic question", now, now).run();
    const payload = {
      research_page: {
        title: "Should a synthetic shop open?",
        summary: "Worth a small test first.",
        markdown: "## The answer\n\n**Yes, as a small test.** Start-up is cheap.\n\n## The numbers\n\n- Start-up is **$179** all in.\n- Rent is not published.\n",
        sources: [{ title: "Example", url: "https://example.com/a" }],
      },
      gaps: ["Fee per visit (any lab): not published.", "Insurance price: no source found."],
      status: "partial",
    };
    const run = (runId: string) => deliverResearchPage(env as any, { taskId, runId, payload, runStatus: "succeeded", now });
    expect((await run("brn_seat_one"))?.state).toBe("delivered");
    await run("brn_seat_two");

    const rows = (await env.DB.prepare(`SELECT kind, subject, body FROM boss_task_notices WHERE task_id = ?`).bind(taskId).all<any>()).results ?? [];
    expect(rows).toHaveLength(1);
    const n = rows[0];
    expect(n.kind).toMatch(/^done#\d+$/);
    expect(n.subject).toMatch(/partial/i);
    expect(n.body).toContain(`https://boss.sequoiataylor.com/research/${pageId}`);
    expect(n.body).toContain("Worth a small test first.");
    expect(n.body).toContain("$179");
    const gapLines = String(n.body).split("\n").filter((l: string) => /fee per visit/i.test(l));
    expect(gapLines).toHaveLength(1);
    expect(gapLines[0]).toMatch(/partial/i);
    expect(gapLines[0]).toMatch(/insurance price/i);
  });
});
