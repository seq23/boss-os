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

  const file = async (payload: Record<string, unknown>) => {
    const pageId = uid("rpg");
    const taskId = await insertTask({
      title: "Deep research: another synthetic question", status: "running", intake_kind: "research",
      input: JSON.stringify({ delivers: "research_page", research_page: { page_id: pageId }, from: "owner@example.com" }),
    });
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`)
      .bind(pageId, taskId, "Another synthetic question", now, now).run();
    const run = (runId: string) => deliverResearchPage(env as any, { taskId, runId, payload, runStatus: "succeeded", now });
    const notices = async () => (await env.DB.prepare(`SELECT kind, needs_her, sent_at FROM boss_task_notices WHERE task_id = ?`).bind(taskId).all<any>()).results ?? [];
    return { taskId, run, notices };
  };
  const BODY = "## The answer\n\n**Yes, as a small test.** Start-up is cheap and the first month tells you most of what you need.\n";

  it("is emailed once, however many attempts the report took", async () => {
    const { taskId, run, notices } = await file({ research_page: { title: "A synthetic report", summary: "Worth a small test.", markdown: BODY, sources: [{ title: "Example", url: "https://example.com/a" }] }, gaps: [], status: "complete" });
    await run("brn_try_one");
    expect(await notices()).toMatchObject([{ needs_her: 1 }]);
    // The first email goes; then the task is retried and files the report again on a later attempt.
    await env.DB.prepare(`UPDATE boss_task_notices SET sent_at = ? WHERE task_id = ?`).bind(Date.now(), taskId).run();
    await env.DB.prepare(`UPDATE tasks SET attempts = COALESCE(attempts, 0) + 2 WHERE id = ?`).bind(taskId).run();
    await run("brn_try_three");
    expect(await notices()).toHaveLength(1);
  });

  it("a report with no source, or with no findings, is filed and not emailed", async () => {
    const bare = await file({ research_page: { title: "A synthetic report", summary: "Worth a small test.", markdown: BODY, sources: [] }, gaps: [], status: "complete" });
    expect((await bare.run("brn_no_sources"))?.state).toBe("delivered");
    expect(await bare.notices()).toMatchObject([{ needs_her: 0 }]);
    const hollow = await file({ research_page: { title: "A synthetic report", summary: "", markdown: `## Notes\n\n${"- \n".repeat(60)}`, sources: [{ title: "Example", url: "https://example.com/a" }] }, gaps: [], status: "complete" });
    await hollow.run("brn_no_findings");
    expect(await hollow.notices()).toMatchObject([{ needs_her: 0 }]);
  });
});
