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
import { BRAVE_SEARCH_HOST } from "../../src/worker/effects/braveSearchClient";
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
beforeEach(async () => { sent = []; await reset(); await env.DB.prepare(`DELETE FROM free_search_quota_days`).run(); await env.DB.prepare(`DELETE FROM sync_device`).run(); });
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

  it("free first: a research page that names its seat goes to free Google search even with both seats free and her Mac seen", async () => {
    await macSeenNow();
    const calls = stubGoogle();
    await env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES ('rpg_test_seat', NULL, 'q', 'queued', 0, 0)`).run().catch(() => null);
    const taskId = await researchTask({ input: JSON.stringify({ instruction: BRIEF, research_page: { page_id: "rpg_test_seat", question: "Lighthouses?" }, delivers: "research_page", backend_id: "bk_claude_code", prompt: "In two sentences, explain what a lighthouse does." }) });
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId), "a seat was used while a free tier could answer").toHaveLength(0);
    expect(calls.some((c) => c.grounded)).toBe(true);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("done");
  });
});

/** Her Mac's agent polled just now (the heartbeat routes/backends.ts stamps). */
const macSeenNow = () => env.DB.prepare(`INSERT OR REPLACE INTO sync_device (device_id, kind, label, last_seen_at) VALUES ('dev_test_mac', 'private', 'test mac', ?)`).bind(Date.now()).run();
const capGoogle = () => env.DB.prepare(`INSERT OR REPLACE INTO free_search_quota_days (service, day, used, updated_at) VALUES ('svc_gemini_grounded', ?, 20, ?)`).bind(centralDay(Date.now()), Date.now()).run();
/** Brave's month used up: 900 searches across earlier days of this calendar month (or today, on the 1st). */
const capBraveMonth = async () => {
  const today = centralDay(Date.now());
  const earlier = today.endsWith("-01") ? today : `${today.slice(0, 7)}-01`;
  await env.DB.prepare(`INSERT OR REPLACE INTO free_search_quota_days (service, day, used, updated_at) VALUES ('svc_brave_search', ?, 900, ?)`).bind(earlier, Date.now()).run();
};
const withAllKeys = () => {
  const e = withKey() as any;
  e.OPENROUTER_API_KEY = "test-or-key-not-a-real-credential";
  e.BRAVE_SEARCH_API_KEY = "test-brave-key-not-real";
  return e as typeof env;
};
const BRAVE_URLS = ["https://brave-one.example/collector-fees", "https://brave-two.example/custody-rules"];
/** Google answers nothing (capped); Brave returns two pages; OpenRouter's free model writes from them. */
function stubFree(o: { braveStatus?: number } = {}) {
  const hits = { brave: 0, openrouter: 0, google: 0 };
  restore = stubFetch(async (req) => {
    if (req.url.startsWith(BRAVE_SEARCH_HOST)) {
      hits.brave++;
      if (o.braveStatus) return new Response("nope", { status: o.braveStatus });
      return new Response(JSON.stringify({ web: { results: BRAVE_URLS.map((url, i) => ({ url, title: `Result ${i + 1}`, description: `Collectors are paid about $40 per collection, page ${i + 1}.` })) } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (req.url.startsWith("https://openrouter.ai/")) {
      hits.openrouter++;
      const body = await req.json() as any;
      const prompt = String(body.messages?.at(-1)?.content ?? "");
      const text = /search phrase/.test(prompt) ? "mobile DNA collector pay per collection"
        : /THE SEARCH RESULTS/.test(prompt) ? ["Collectors are paid about $40 per collection. [1]", "Chain of custody is signed at every step. [2]", "Most collectors earn $10,000 a month.", "A made-up source says otherwise. [7]", "Not found: Memphis prices."].join("\n")
        : JSON.stringify({ title: "Mobile DNA collection", summary: "Collectors are paid about $40 per collection [1]." });
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (req.url.startsWith(GEMINI_HOST)) { hits.google++; return new Response("{}", { status: 429 }); }
    return new Response("not here", { status: 500 });
  });
  return hits;
}

describe("the chain after a Codex limit: free tiers first, then her seats, then a named stop (owner, 6 Nov 2026)", () => {
  it("Google capped → OpenRouter free with Brave Search files the page; every cited source is a URL Brave returned", async () => {
    await spendCodex(); await macSeenNow(); await capGoogle();
    const hits = stubFree();
    const taskId = await researchTask();
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect(hits.brave).toBeGreaterThan(0);
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId), "a seat was used while rung 2 could answer").toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("done");
    const page = await row<any>(`SELECT state, markdown, sources FROM research_pages WHERE task_id = ?`, taskId);
    expect(page.state).toBe("delivered");
    const cited = JSON.parse(page.sources).map((x: any) => x.url);
    expect(cited.length).toBeGreaterThan(0);
    for (const u of cited) expect(BRAVE_URLS, `cited a URL Brave never returned: ${u}`).toContain(u);
    expect(page.markdown).toMatch(/\$40 per collection\. \[1\]/);
    expect(page.markdown, "an uncited line reached the page").not.toMatch(/\$10,000/);
    expect(page.markdown, "a line citing a result that does not exist reached the page").not.toMatch(/made-up source/);
  });

  it("Google capped + Brave's month at 900 → NAMED STOP [BRAVE_MONTHLY_CAP] on rung 2, then the Claude seat (Codex spent, Mac seen)", async () => {
    await spendCodex(); await macSeenNow(); await capGoogle(); await capBraveMonth();
    const hits = stubFree();
    const taskId = await researchTask();
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect(hits.brave, "a Brave search past the monthly cap").toBe(0);
    const steps = (await all<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId)).map((r) => r.detail).join(" ");
    expect(steps).toMatch(/BRAVE_MONTHLY_CAP/);
    const runs = await all<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ?`, taskId);
    expect(runs.map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
    const t = await row<any>(`SELECT input FROM tasks WHERE id = ?`, taskId);
    const input = JSON.parse(t.input);
    expect(input.delivers, "the seat run would deliver no page").toBe("research_page");
    expect(await row(`SELECT 1 AS x FROM research_pages WHERE id = ?`, input.research_page.page_id)).toBeTruthy();
  });

  it("Brave answering 429 is a capped rung, not a failure: the walk reaches the Claude seat", async () => {
    await spendCodex(); await macSeenNow(); await capGoogle();
    stubFree({ braveStatus: 429 });
    const taskId = await researchTask();
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect((await all<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ?`, taskId)).map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).not.toBe("failed");
  });

  it("free tiers capped + Codex spent + no Mac seen → NAMED STOP with the reset, never parked on a seat", async () => {
    await spendCodex(); await capGoogle(); await capBraveMonth();
    stubFree();
    const taskId = await researchTask();
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect(await all(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId), "parked on a seat nobody can claim").toHaveLength(0);
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop'`, taskId)).detail);
    expect(["FREE_SEARCH_CAP", "BRAVE_MONTHLY_CAP"]).toContain(stop.code);
    expect(stop.resume_at).toBeGreaterThan(Date.now());
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    expect(sent.filter((m) => m.taskId === taskId)).toHaveLength(1);
  });

  it("Codex not spent, free tiers capped, Mac seen → Codex's seat before the Claude seat", async () => {
    await macSeenNow(); await capGoogle(); await capBraveMonth();
    stubFree();
    const taskId = await researchTask();
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect((await all<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ?`, taskId)).map((r) => r.backend_id)).toEqual(["bk_codex"]);
  });

  it("NEGATIVE: private research goes to the Claude seat only, never a free tier, never Codex", async () => {
    await spendCodex(); await macSeenNow();
    const hits = stubFree();
    const taskId = await researchTask({ model_access: "private_model_only", input: JSON.stringify({ instruction: BRIEF, research_page: { page_id: "rpg_test_private", question: "q" }, delivers: "research_page", backend_id: "bk_claude_code", prompt: BRIEF }) });
    await handleTask(withAllKeys(), { taskId, lane: "ops" });
    expect(hits.google + hits.brave + hits.openrouter, "private research reached a free route").toBe(0);
    expect((await all<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ?`, taskId)).map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
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
