import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { claimSimone, fileSimoneMessage } from "../../src/worker/boss/agents/simone";
import { simoneTool } from "../../src/worker/boss/agents/simoneTools";
import { storeOperatingReport } from "../../src/worker/boss/agents/simoneOperations";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { buildEnvelope } from "../../src/worker/boss/intake/envelope";
import { classify } from "../../src/worker/boss/intake/classify";
import { recordOutcome } from "../../src/worker/boss/router/experience";
import { GEMINI_HOST } from "../../src/worker/boss/router/backends";
import { routeCompletion } from "../../src/worker/boss/router";
import { routeCounts, routeCountsLine } from "../../src/worker/boss/router/routeCounts";
import { runCapabilityCadence } from "../../src/worker/boss/routes/capability";
import { ROUTE_TABLE, jobClassOf, jobClassFor, routeOrder, afterCodexLimit } from "../../src/shared/boss/aiRoles.mjs";
import { all, completionResponse, insertTask, row, stubFetch, uid } from "./helpers";

/**
 * ROUTES BY ABILITY (owner, 13 Nov 2026: "all private stuff can go through codex i need a backup to
 * claude", "its more about model ability too", "there needs to be no standing rule about any … model").
 *
 * A job has a class (hard / clear_brief / short); a route has a tier (free / Codex / Claude). These
 * tests speak only of those and of the privacy limit, never of a model. Placeholders only: "an LP".
 */
const DEAL = "Summarise the capital commitment, the carried interest and the allocation of the Fund II subscription at a $40M valuation for an LP.";
const seats = () => env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
const spend = (seat: string, until = Date.now() + 3600_000) => env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit' WHERE id = ?`).bind(until, seat).run();
const runsOn = (taskId: string) => all<any>(`SELECT backend_id, status, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
const cloudAsked = (taskId: string) => all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId);
/** Every provider key present, so "no free route was called" is proven by the network, not by a missing key. */
const withKeys = () => { const e = Object.create(env); for (const k of ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) (e as any)[k] = "test-key-not-a-real-credential"; return e as typeof env; };

let restore: (() => void) | null = null;
beforeEach(async () => { await seats(); });
afterEach(async () => { restore?.(); restore = null; await seats(); });

describe("the table: class × tier, and nothing names a model", () => {
  it("routes by required ability without a content lane", () => {
    expect(ROUTE_TABLE).toEqual({ hard: ["claude", "codex"], clear_brief: ["codex", "claude"], short: ["free", "codex", "claude"] });
    expect(JSON.stringify(ROUTE_TABLE)).not.toMatch(/opus|sonnet|haiku|gpt|gemini|llama/i);
  });

  it("a job with no class is hard, and a hard flag beats a short kind", () => {
    expect(jobClassOf({})).toBe("hard");
    expect(jobClassOf({ intakeKind: "a kind nobody decided" })).toBe("hard");
    expect(routeOrder({ jobClass: null }).routes).toEqual(["claude", "codex"]);
    expect(jobClassOf({ intakeKind: "research" })).toBe("short");
    expect(jobClassOf({ intakeKind: "recurring_duty" })).toBe("clear_brief");
    // Her daily briefing reaches her unchecked: hard whatever kind its duty was filed under (13 Nov 2026).
    expect(jobClassOf({ intakeKind: "recurring_duty", delivers: "executive_reports" })).toBe("hard");
    expect(jobClassOf({ intakeKind: "research", delivers: "executive_reports" })).toBe("hard");
    expect(jobClassOf({ intakeKind: "research", delivers: "tool_suggestions" })).toBe("short");
    for (const flag of ["repair", "repoChange", "chromeJob"]) expect(jobClassOf({ intakeKind: "research", [flag]: true })).toBe("hard");
    // The free tier is for short work only: a public job with no class never falls to it.
    expect(afterCodexLimit()).toBe("claude_seat");
    expect(afterCodexLimit({ jobClass: "clear_brief" })).toBe("claude_seat");
    expect(afterCodexLimit({ jobClass: "short" })).toBe("free_rung");
    expect(afterCodexLimit({ jobClass: jobClassOf({ intakeKind: "research", repoChange: true }) })).toBe("claude_seat");
  });

  it("a brain edit: recording is short, interpreting (or not saying which) is hard", () => {
    expect(jobClassOf({ intakeKind: "one_off", brainEdit: "record" })).toBe("short");
    expect(jobClassOf({ intakeKind: "research", brainEdit: "interpret" })).toBe("hard");
    expect(jobClassOf({ intakeKind: "research", brainEdit: true })).toBe("hard");
    expect(jobClassFor("brain.record")).toBe("short");
    expect(jobClassFor("brain.interpret")).toBe("hard");
    expect(jobClassFor("brain.write")).toBe("hard");
  });

  it("a demoted tier is dropped only while a stronger one is left", () => {
    expect(routeOrder({ jobClass: "clear_brief", demoted: ["codex"] }).routes).toEqual(["claude"]);
    expect(routeOrder({ jobClass: "short", demoted: ["codex"] }).routes).toEqual(["free", "claude"]);
    expect(routeOrder({ jobClass: "hard", demoted: ["claude"] }).routes).toEqual(["claude", "codex"]);
  });
});


describe("a route that fails the same kind of job twice in a row stops getting it", () => {
  const codexRan = (jobClass: string, status: "succeeded" | "failed", at: number) => env.DB
    .prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status) VALUES (?, NULL, 'bk_codex', ?, ?, ?, ?)`)
    .bind(uid("brn"), JSON.stringify({ job_class: jobClass }), at - 1000, at, status).run();
  const duty = () => insertTask({
    status: "queued", title: "Tidy the docs", intake_kind: "recurring_duty", sensitivity: "public",
    input: JSON.stringify({ backend_ladder: ["bk_codex", "bk_claude_code"], prompt: "List the lighthouses in this file, one per line." }),
  });

  it("clear-brief work starts on Codex; after Codex fails two of them in a row the next one moves up to Claude by itself", async () => {
    await env.DB.prepare(`DELETE FROM backend_runs WHERE task_id IS NULL`).run();
    const before = await duty();
    await handleTask(env as any, { taskId: before, lane: "ops" });
    expect((await runsOn(before)).map((r) => r.backend_id)).toEqual(["bk_codex"]);

    await codexRan("clear_brief", "succeeded", Date.now() - 3 * 3600_000);
    await codexRan("clear_brief", "failed", Date.now() - 2 * 3600_000);
    // One failure is not two: still Codex.
    const once = await duty();
    await handleTask(env as any, { taskId: once, lane: "ops" });
    expect((await runsOn(once)).map((r) => r.backend_id)).toEqual(["bk_codex"]);

    await codexRan("clear_brief", "failed", Date.now() - 3600_000);
    const after = await duty();
    await handleTask(env as any, { taskId: after, lane: "ops" });
    const runs = await runsOn(after);
    expect(runs.map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
    expect(JSON.parse(runs[0].requested).backend_ladder).toEqual(["bk_claude_code"]);
    const step = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, after);
    expect(step!.detail).toMatch(/ROUTE_DEMOTED/);

    // Only that kind moved: short work still starts on Codex's seat.
    const short = await insertTask({ status: "queued", title: "Lighthouses", intake_kind: "research", sensitivity: "public", input: JSON.stringify({ backend_ladder: ["bk_codex", "bk_claude_code"], delivers: "tool_suggestions", prompt: "In two sentences, explain what a lighthouse does." }) });
    await handleTask(env as any, { taskId: short, lane: "ops" });
    expect((await runsOn(short)).map((r) => r.backend_id)).toEqual(["bk_codex"]);

    // One good run puts the seat back.
    await codexRan("clear_brief", "succeeded", Date.now() - 60_000);
    const back = await duty();
    await handleTask(env as any, { taskId: back, lane: "ops" });
    expect((await runsOn(back)).map((r) => r.backend_id)).toEqual(["bk_codex"]);
  });
});

it("moves a checked draft to its proven free model, then returns it to the seat and includes both reasons in Simone’s daily note", async () => {
  const employee = await row<{ id: string }>("SELECT id FROM employees WHERE lane = 'ops' AND id <> 'emp_chief' AND lifecycle = 'active' AND status = 'active' ORDER BY id LIMIT 1");
  expect(employee).toBeTruthy();
  const managed = employee!.id;
  const kind = "drafting";
  const modelId = "mdl_gemini_38_flash_free";
  const dispatch = async (reviewed = true, intakeKind = kind) => {
    const title = "Summarise the workshop notes";
    const input = JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], job_key: "summarise", prompt: "Summarise these notes for internal review." });
    const taskId = await insertTask({ title, input, status: "queued", employee_id: managed, intake_kind: intakeKind });
    if (reviewed) {
      const envelope = await buildEnvelope(env.DB, {
        taskId, lane: "ops", employeeId: managed, costMode: "NORMAL",
        classification: { ...classify({ title, intakeKind }), executionAssignment: "AI_DRAFT" },
      });
      await env.DB.prepare("UPDATE tasks SET envelope_id = ?, audience = 'internal' WHERE id = ?").bind(envelope.id, taskId).run();
    }
    await handleTask(withKeys(), { taskId, lane: "ops" });
    return taskId;
  };
  await env.DB.prepare("DELETE FROM model_job_outcome WHERE task_kind = ?").bind(kind).run();
  for (let n = 0; n < 5; n++) {
    expect(await recordOutcome(env.DB, { taskKind: kind, modelId, outcome: "succeeded", source: n < 2 ? "human" : "benchmark" })).toBe(true);
  }
  await fileSimoneMessage(env, { source: "simone_daily", subject: "Routing fixture", body: "Review measured draft routing." });
  const simone = (await claimSimone(env))!;
  const choose = (task: Record<string, string>) => simoneTool(env, { id: simone.id, lease: simone.lease, tool: "model_routing", task: JSON.stringify(task) });
  expect(await choose({ employee: "emp_chief", kind, model: modelId })).toMatchObject({ ok: false, code: "MANAGED_AGENT_REQUIRED" });
  expect(await choose({ employee: managed, kind, model: "mdl_gemini_25_flash_free" })).toMatchObject({ ok: false, code: "FREE_MODEL_NOT_PROVEN" });
  expect(await choose({ employee: managed, kind })).toMatchObject({ ok: true, models: [{ id: modelId }] });
  expect(await choose({ employee: managed, kind, model: modelId })).toMatchObject({ ok: true, changed: true });
  expect(await choose({ employee: managed, kind, model: modelId })).toMatchObject({ ok: true, changed: false });

  let calls = 0;
  restore = stubFetch((req) => {
    expect(req.url.startsWith(GEMINI_HOST + "/models/gemini-3.8-flash:")).toBe(true);
    calls++;
    return Response.json({ candidates: [{ content: { parts: [{ text: "The workshop meets Thursday." }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
  });
  const first = await dispatch();
  expect(calls).toBe(1);
  expect(await runsOn(first)).toEqual([]);
  expect(await row("SELECT chosen_model_id FROM routing_decisions WHERE task_id = ?", first)).toEqual({ chosen_model_id: modelId });
  expect(await row("SELECT status FROM tasks WHERE id = ?", first)).toEqual({ status: "awaiting_approval" });

  const unchecked = await dispatch(false);
  const judgement = await dispatch(true, "decision_support");
  expect(await runsOn(unchecked)).toHaveLength(1);
  expect((await runsOn(judgement)).map((r) => r.backend_id)).toEqual(["bk_claude_code"]);

  for (let n = 0; n < 2; n++) {
    expect(await recordOutcome(env.DB, { taskKind: kind, modelId, outcome: "rejected", source: "router" })).toBe(true);
  }
  const back = await dispatch();
  expect(await runsOn(back)).toHaveLength(1);
  expect(await cloudAsked(back)).toEqual([]);
  expect(await choose({ employee: managed, kind })).toMatchObject({ ok: true, current: "subscription", models: [] });
  expect(calls).toBe(1);

  const now = Date.now();
  await storeOperatingReport(env, { day: dayIdInZone(now), rows: [{ id: "fixture", name: "Fixture", kind: "duty",
    aim: "Verify delivery", evidence: "Verified fixture", coverage: "listed", state: "verified" }], issues: [], proposal: null }, now);
  const moves = await row<{ body: string }>("SELECT body FROM morning_sections WHERE section = 'operations'");
  expect(JSON.parse(moves!.body).lines).toEqual([
    expect.stringMatching(/Simone moved .* to .* after 5 of 5 measured outputs passed/),
    expect.stringMatching(/moved to a subscription seat because recent checked results no longer support a free route/),
  ]);
});

describe("the free tier finds a model that can do the job, and remembers it", () => {
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const answer = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
  const routine = (taskId: string) => ({
    routeId: "rt_ops_default", lane: "ops", intakeKind: "research", sensitivity: "private", risk: "low", jobKey: "summarise", taskId,
    onlyProviderId: "prv_gemini", freeOnly: true,
    // The job's own check: this routine job requires a source line.
    accept: (text: string) => (/^SOURCE: /m.test(text) ? null : "no source where a source is required"),
    messages: [{ role: "user" as const, content: "Summarise this public article about rooftop gardens, with its source." }],
  });

  it("a routine job whose first free model fails its check is completed by a second free model without touching Codex, and the next run starts on the one that worked", async () => {
    const calls: string[] = [];
    let failing: string | null = null;
    restore = stubFetch(async (req) => {
      if (!req.url.startsWith(GEMINI)) return new Response("not here", { status: 500 });
      const model = decodeURIComponent(/models\/([^:]+):generateContent/.exec(req.url)![1]!);
      calls.push(model);
      failing ??= model; // whichever free candidate is asked first gives an answer with no source
      return answer(model === failing ? "Rooftop gardens are nice." : "Rooftop gardens cool buildings.\nSOURCE: the article");
    });
    const seatRunsBefore = (await all<any>(`SELECT 1 FROM backend_runs`)).length;

    const first = await routeCompletion(withKeys(), routine("tsk_free_first"));
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toBe(calls[0]);
    expect(first.freeTier).toBe(true);
    expect(first.text).toMatch(/^SOURCE: /m);
    const worked = calls[1]!;
    expect((await all<any>(`SELECT 1 FROM backend_runs`)).length, "a seat was touched").toBe(seatRunsBefore);

    // The next run of that kind starts on the model that worked.
    calls.length = 0;
    await routeCompletion(withKeys(), routine("tsk_free_second"));
    expect(calls).toEqual([worked]);

    // What the run log now says, per model, for this kind of job.
    const log = await all<any>(`SELECT m.slug, o.outcome FROM model_job_outcome o JOIN models m ON m.id = o.model_id WHERE o.task_id IN ('tsk_free_first','tsk_free_second') ORDER BY o.ts, o.rowid`);
    expect(log).toEqual([{ slug: failing, outcome: "rejected" }, { slug: worked, outcome: "succeeded" }, { slug: worked, outcome: "succeeded" }]);
  });

  it("running out of a free allowance is a note and a move to the next candidate, never a failure of that model", async () => {
    const calls: string[] = [];
    let capped: string | null = null;
    restore = stubFetch(async (req) => {
      if (!req.url.startsWith(GEMINI)) return new Response("not here", { status: 500 });
      const model = decodeURIComponent(/models\/([^:]+):generateContent/.exec(req.url)![1]!);
      calls.push(model);
      capped ??= model;
      return model === capped ? new Response(JSON.stringify({ error: { code: 429, message: "quota exceeded" } }), { status: 429 }) : answer("Fine.\nSOURCE: the article");
    });
    const r = await routeCompletion(withKeys(), routine("tsk_free_quota"));
    expect(r.freeTier).toBe(true);
    expect(new Set(calls).size).toBeGreaterThan(1);
    expect(await all<any>(`SELECT 1 FROM model_job_outcome WHERE task_id = 'tsk_free_quota' AND outcome = 'rejected'`)).toHaveLength(0);
  });
});

describe("the monthly measured line", () => {
  it("counts completed, failed and redone per route from the run logs, and says so when there is nothing to count", async () => {
    const t0 = Date.UTC(2031, 0, 1), t1 = Date.UTC(2031, 1, 1), mid = Date.UTC(2031, 0, 15);
    expect(routeCountsLine(await routeCounts(env.DB, t0, t1))).toMatch(/NAMED STOP \[NO_RUNS_COUNTED\]/);
    const run = (seat: string, status: string) => env.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status) VALUES (?, NULL, ?, '{}', ?, ?, ?)`).bind(uid("brn"), seat, mid, mid, status).run();
    await run("bk_claude_code", "succeeded"); await run("bk_claude_code", "succeeded"); await run("bk_codex", "failed"); await run("bk_codex", "refused");
    const taskId = await insertTask({ status: "queued" });
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_release',?)`).bind(uid("tev"), taskId, mid, JSON.stringify({ from: "bk_codex", next: "bk_claude_code" })).run();
    const counts = await routeCounts(env.DB, t0, t1);
    expect(counts.routes).toEqual([
      { route: "bk_claude_code", completed: 2, failed: 0, redone: 0 },
      { route: "bk_codex", completed: 0, failed: 1, redone: 1 },
    ]);
    expect(routeCountsLine(counts)).toBe("Routes 2031-01-01 to 2031-02-01: bk_claude_code 2 completed, 0 failed, 0 redone; bk_codex 0 completed, 1 failed, 1 redone.");
    // It rides the existing first-of-the-month step and lands on the Systems list.
    const out = await runCapabilityCadence(env as any, t1 + 4 * 3600_000);
    expect(out.route_month).toBe(routeCountsLine(counts));
    expect((await row<any>(`SELECT detail FROM system_events WHERE event = 'route_month' ORDER BY ts DESC LIMIT 1`))!.detail).toContain("bk_codex 0 completed, 1 failed, 1 redone");
  });
});
