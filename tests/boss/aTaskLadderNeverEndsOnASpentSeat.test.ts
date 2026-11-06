/**
 * A TASK'S LADDER NEVER ENDS ON A SPENT SEAT (owner, 6 Nov 2026: "why is Boss handing it to codex?
 * what about google? what about the chain?").
 *
 * The deep research for Valerie named no seat, sat "running" from 07:00 with no run anywhere, and
 * Codex — the only seat anything walked to — was out until 10 Nov. These prove the behaviour:
 *   · public research with Codex spent walks to the free Google-grounded rung and is DELIVERED
 *     (page filed, task done, a Done notice written), keeping only lines Google tied to a page;
 *   · the free allowance gone is NAMED STOP [FREE_SEARCH_CAP], re-queued for the reset — not a loop;
 *   · a request's 30-second tail never runs it; private work never reaches Gemini;
 *   · a drain that died does not strand its task (the orphan reaper).
 * Synthetic content only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { reapOrphanedRuns } from "../../src/worker/bossMount";
import { GEMINI_HOST } from "../../src/worker/boss/router/backends";
import { keepSupported, groundedSections } from "../../src/worker/boss/research/grounded";
import { centralDay } from "../../src/worker/boss/research/searchQuota";
import { all, insertTask, row, stubFetch } from "./helpers";

let restore: (() => void) | null = null;
/** Every message the run puts back on the queue, with its delay (production's TASKS is the D1 queue). */
let sent: { taskId: string; delaySeconds: number }[] = [];
const withKey = () => {
  const e = Object.create(env);
  (e as any).GEMINI_API_KEY = "test-key-not-a-real-credential";
  (e as any).TASKS = { send: async (b: { taskId: string }, o?: { delaySeconds?: number }) => { sent.push({ taskId: b.taskId, delaySeconds: o?.delaySeconds ?? 0 }); } };
  return e as typeof env;
};
const reset = () => env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
const spendCodex = () => env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'try again at Nov 10th' WHERE id = 'bk_codex'`).bind(Date.now() + 4 * 86400_000).run();
beforeEach(async () => { sent = []; await reset(); await env.DB.prepare(`DELETE FROM free_search_quota_days`).run(); });
afterEach(async () => { restore?.(); restore = null; await reset(); });

const enc = new TextEncoder();
const LINES = [
  "A legal DNA test keeps a signed chain of custody from swab to lab.",
  "Collectors are paid about $40 per collection by the lab network.",
  "Most collectors earn $10,000 a month in their first year.",
  "Not found: prices charged by collectors in Memphis.",
];
const TEXT = LINES.join("\n");
const span = (i: number) => {
  const start = enc.encode(LINES.slice(0, i).join("\n") + (i ? "\n" : "")).length;
  return { startIndex: start, endIndex: start + enc.encode(LINES[i]!).length };
};
const groundedAnswer = () => new Response(JSON.stringify({
  candidates: [{
    content: { parts: [{ text: TEXT }] },
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa", title: "chain.example" } },
        { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb", title: "fees.example" } },
      ],
      // Line 0 and line 1 are backed; line 2 ($10,000 a month) is not, and must not reach the page.
      groundingSupports: [{ segment: span(0), groundingChunkIndices: [0] }, { segment: span(1), groundingChunkIndices: [1] }],
    },
  }],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
}), { status: 200, headers: { "content-type": "application/json" } });

function stubGoogle() {
  const calls: { model: string; grounded: boolean }[] = [];
  restore = stubFetch(async (req) => {
    if (req.url.startsWith("https://vertexaisearch.cloud.google.com/")) {
      return new Response(null, { status: 302, headers: { location: req.url.endsWith("aaa") ? "https://chain.example/custody" : "https://fees.example/collector-pay" } });
    }
    if (!req.url.startsWith(GEMINI_HOST)) return new Response("not here", { status: 500 });
    const model = decodeURIComponent(/models\/([^:]+):generateContent/.exec(req.url)![1]!);
    const body = await req.json() as any;
    const grounded = Boolean(body.tools?.some((t: any) => t.google_search));
    calls.push({ model, grounded });
    if (grounded) return groundedAnswer();
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Mobile DNA collection: worth starting", summary: "Yes, with a lab partner first. Collectors are paid about $40 per collection [1]. Most earn $9,000 a month." }) }] } }],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const BRIEF = "Deep research: should a parent start a mobile DNA collection business?\nCover, with a source for every fact:\n1. What the work is: legal vs peace-of-mind tests.\n2. How collectors get paid.\nOutput: one plain-English report, answer first.";
const researchTask = (over: Record<string, unknown> = {}) => insertTask({
  status: "queued", title: "Deep research: a mobile DNA collection business", intake_kind: "research", sensitivity: "internal",
  employee_id: "emp_research", input: JSON.stringify({ instruction: BRIEF }), ...over,
}).then(async (id) => { await env.DB.prepare(`UPDATE tasks SET model_access = ? WHERE id = ?`).bind((over.model_access as string) ?? "public_model_approved", id).run(); return id; });

describe("the research ladder walks past a spent Codex seat to free Google search", () => {
  it("a single-seat research task with Codex spent is researched on the grounded free rung and delivered", async () => {
    await spendCodex();
    const calls = stubGoogle();
    const taskId = await researchTask();
    await handleTask(withKey(), { taskId, lane: "ops" });

    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId), "a seat was parked").toHaveLength(0);
    expect(calls.filter((c) => c.grounded).map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-flash"]); // one per part
    const task = await row<any>(`SELECT status, output FROM tasks WHERE id = ?`, taskId);
    expect(task.status).toBe("done");
    const page = await row<any>(`SELECT state, markdown, sources, summary FROM research_pages WHERE task_id = ?`, taskId);
    expect(page.state).toBe("delivered");
    expect(page.markdown).toMatch(/chain of custody from swab to lab\. \[1\]/);
    expect(page.markdown).toMatch(/\$40 per collection by the lab network\. \[2\]/);
    expect(page.markdown, "a line no page backed reached her").not.toMatch(/\$10,000/);
    expect(page.markdown).toMatch(/What I could not confirm[\s\S]*prices charged by collectors in Memphis/);
    expect(JSON.parse(page.sources).map((s: any) => s.url)).toEqual(["https://chain.example/custody", "https://fees.example/collector-pay"]);
    expect(page.summary, "an uncited figure in the summary").not.toMatch(/\$9,000/);
    expect(page.summary).toMatch(/\$40 per collection \[1\]/);
    const notice = await row<any>(`SELECT from_name, subject, body FROM boss_task_notices WHERE task_id = ? AND kind LIKE 'done#%'`, taskId);
    expect(notice.subject).toMatch(/^Done: Mobile DNA collection/);
    expect(notice.body).toMatch(/\/research\/rpg_/);
    expect(await row(`SELECT 1 AS x FROM delivered_work WHERE location LIKE '%' || ? || '%'`, JSON.parse(task.output).research_page_id)).toBeTruthy();
  });

  it("the free allowance used up is NAMED STOP [FREE_SEARCH_CAP], re-queued for the reset, not a loop", async () => {
    await spendCodex();
    const calls = stubGoogle();
    await env.DB.prepare(`INSERT INTO free_search_quota_days (service, day, used, updated_at) VALUES ('svc_gemini_grounded', ?, 20, ?)`).bind(centralDay(Date.now()), Date.now()).run();
    const taskId = await researchTask();
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(calls, "a search was made past the cap").toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    const stop = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop'`, taskId);
    expect(JSON.parse(stop.detail).code).toBe("FREE_SEARCH_CAP");
    expect(sent.filter((m) => m.taskId === taskId)).toHaveLength(1);
    expect(sent[0]!.delaySeconds, "re-queued to run again at once: a loop").toBeGreaterThan(60);
    expect(await row(`SELECT 1 AS x FROM system_events WHERE entity_id = ? AND event = 'named_stop' AND scope = 'systems'`, taskId), "not on Kendra's list").toBeTruthy();
  });

  it("a drain inside a request's 30-second tail hands it to the hourly tick and searches nothing", async () => {
    await spendCodex();
    const calls = stubGoogle();
    const taskId = await researchTask();
    await handleTask(withKey(), { taskId, lane: "ops", fromRequest: true });
    expect(calls).toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    // Queued for the hourly tick ONLY, visible by the next top of the hour when the tick fires.
    const q = await row<any>(`SELECT visible_at, last_error FROM boss_task_queue WHERE task_id = ? AND state = 'pending'`, taskId);
    expect(q.last_error, "a request's drain could take it again").toMatch(/^tick-only/);
    expect(q.visible_at, "due after the tick fires").toBeLessThanOrEqual(Math.ceil(Date.now() / 3600_000) * 3600_000);
  });

  it("NEGATIVE: private-model-only research never reaches Gemini and is never parked on a seat", async () => {
    await spendCodex();
    const calls = stubGoogle();
    const taskId = await researchTask({ model_access: "private_model_only" });
    await handleTask(withKey(), { taskId, lane: "ops" }).catch(() => null);
    expect(calls, "private research reached a training route").toHaveLength(0);
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId)).toHaveLength(0);
  });

  it("with Codex free, a bare research ask still goes to free Google search: it needs no Mac", async () => {
    const calls = stubGoogle();
    const taskId = await researchTask();
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId), "parked on a seat nobody may claim").toHaveLength(0);
    expect(calls.some((c) => c.grounded)).toBe(true);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("done");
  });

  it("no Gemini key and no model behind it: the bare research ask ends by name, never 'running' (the e2e machine)", async () => {
    restore = stubFetch(async () => new Response("no model here", { status: 500 }));
    const taskId = await researchTask();
    await handleTask(env as any, { taskId, lane: "ops" }).catch(() => null);
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId)).toHaveLength(0);
    const t = await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId);
    expect(t.status, "left running with nothing that will finish it").not.toBe("running");
  });

  it("NEGATIVE: a research page that names its seat still goes to Codex's seat first", async () => {
    const calls = stubGoogle();
    const taskId = await researchTask({ input: JSON.stringify({ research_page: { page_id: "rpg_test_seat", question: "Lighthouses?" }, delivers: "research_page", backend_id: "bk_claude_code", prompt: "In two sentences, explain what a lighthouse does." }) });
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(calls).toHaveLength(0);
    const run = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ?`, taskId);
    expect(run.backend_id).toBe("bk_codex");
    expect(JSON.parse(run.requested).codex_limit_free_rung, "a mid-run limit would not hand it to the free rung").toBe(true);
  });
});

describe("an empty Google answer is not an answer (Rule 0)", () => {
  it("a part recorded empty is redone, and a part Google leaves empty is named under what could not be confirmed", async () => {
    await spendCodex();
    let grounded = 0;
    restore = stubFetch(async (req) => {
      if (req.url.startsWith("https://vertexaisearch.cloud.google.com/")) return new Response(null, { status: 302, headers: { location: "https://chain.example/custody" } });
      if (!req.url.startsWith(GEMINI_HOST)) return new Response("not here", { status: 500 });
      const body = await req.json() as any;
      if (body.tools?.some((t: any) => t.google_search)) {
        grounded++;
        // Part 1 answers; part 2 comes back empty.
        if (grounded === 1) return groundedAnswer();
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] } }], usageMetadata: {} }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const taskId = await researchTask();
    // A part recorded with nothing in it by an earlier run.
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES ('tev_empty_part', ?, ?, 'grounded_section', ?)`)
      .bind(taskId, Date.now() - 60_000, JSON.stringify({ n: 1, ask: "x", lines: [], sources: [], dropped: 0, notFound: [] })).run();
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(grounded, "the empty part 1 was kept as answered").toBe(2);
    const page = await row<any>(`SELECT markdown, gaps FROM research_pages WHERE task_id = ?`, taskId);
    expect(page.markdown).toMatch(/chain of custody from swab to lab/);
    expect(JSON.parse(page.gaps).join(" ")).toMatch(/Part 2: Google search gave no answer for this part/);
  });
});

describe("a drain that died does not strand its task", () => {
  it("a 'running' row with no progress for 20 minutes is re-queued; a fresh one is left alone", async () => {
    const old = Date.now() - 3 * 3600_000;
    const stuck = await insertTask({ status: "running", title: "Stranded" });
    const fresh = await insertTask({ status: "running", title: "Working" });
    await env.DB.prepare(`INSERT INTO boss_task_queue (id, task_id, lane, attempt, state, visible_at, enqueued_at) VALUES ('q_stuck', ?, 'ops', 0, 'running', ?, ?), ('q_fresh', ?, 'ops', 0, 'running', ?, ?)`)
      .bind(stuck, old, old, fresh, old, old).run();
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES ('tev_fresh_progress', ?, ?, 'ladder_step', '{}')`).bind(fresh, Date.now()).run();
    expect(await reapOrphanedRuns(env as any, env.DB, Date.now())).toBe(1);
    expect((await row<any>(`SELECT state, attempt FROM boss_task_queue WHERE id = 'q_stuck'`))).toEqual({ state: "pending", attempt: 1 });
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, stuck)).status).toBe("queued");
    expect((await row<any>(`SELECT state FROM boss_task_queue WHERE id = 'q_fresh'`)).state).toBe("running");
  });
});

describe("only what a page backs is kept", () => {
  it("splits a numbered brief into parts and keeps the output line out of them", () => {
    const b = groundedSections(BRIEF);
    expect(b.sections.map((s) => s.n)).toEqual([1, 2]);
    expect(b.output).toMatch(/^Output:/);
  });
  it("drops a table whose rows no page backs, header and all", () => {
    const text = "| Fee | Amount |\n|---|---|\n| Visit | $40 |";
    expect(keepSupported(text, []).lines.join("\n")).toBe("");
    const s = enc.encode("| Fee | Amount |\n|---|---|\n").length;
    expect(keepSupported(text, [{ start: s, end: s + 5, sources: [0] }]).lines.join("\n")).toMatch(/\| Visit \| \$40 \[\[s:0\]\] \|/);
  });
});
