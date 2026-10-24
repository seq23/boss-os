import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBriefingCandidates, BRIEFING_SEATS, orderBriefingCandidates } from "../../src/worker/boss/duties/briefingLadder";
import { handleTask, parseDeliversFromText } from "../../src/worker/boss/queue/consumer";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
// @ts-expect-error — plain ESM adapter with no declaration file; the args are asserted as strings below.
import { buildArgs as codexArgs } from "../../scripts/sync-agent/backends/codex.mjs";
import { all, api, completionResponse, insertTask, row, stubFetch, uid } from "./helpers";

/**
 * "THE BOSS OS BRIEFING IS RUN USING MY TWO $0 LANES FIRST, RIGHT — CLAUDE AND OPENAI? THE LADDER
 * IS WORKING?" — the owner, 19 September 2026.
 *
 * Before this file the honest answer was no. The duty named one seat; a refusal failed the task;
 * `/claim` handed a run only to the seat it was parked for. Each test below is one rung of the
 * answer becoming yes, proven by running the shipped consumer, the shipped claim route and the
 * shipped delivery — never by reading a comment.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const NOW = Date.now();
const monthStart = Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), 1);

/**
 * A capped seat, the way production reaches one: `bk_claude_code` takes its ceiling from the plan
 * (`ceiling_source = 'plan'`, migration 0239), and a test database has no plan chosen, so the
 * stored figure is pinned here instead. The gate is the same `monthSpend >= ceiling` either way.
 */
async function seatCapped(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET ceiling_source = 'stored', monthly_ceiling_micros = 50000000, spent_micros = 50000000, window_started_at = ? WHERE id = ?`).bind(monthStart + 1000, id).run();
}
async function seatDisabled(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'disabled' WHERE id = ?`).bind(id).run();
}
async function seatsReset() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 50000000, ceiling_source = 'plan' WHERE id = 'bk_claude_code'`).run();
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 0 WHERE id = 'bk_codex'`).run();
}

/** The briefing task exactly as the materialiser stamps it — read back from the shipped duty row. */
async function briefingTask(): Promise<{ taskId: string; input: Record<string, any> }> {
  await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
  const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
  expect(out.fired, `the duty did not fire: ${JSON.stringify(out.skipped)}`).toHaveLength(1);
  // An `agent` duty ALWAYS materialises a task. `task_id` is null only for a `worker` duty (0263),
  // and the briefing is not one; a null here would mean the briefing ran nowhere.
  const taskId = out.fired[0]!.task_id;
  expect(taskId, "an agent duty fired without a task").toBeTypeOf("string");
  const t = await row<any>(`SELECT input, status FROM tasks WHERE id = ?`, taskId!);
  return { taskId: taskId!, input: JSON.parse(t.input) };
}

describe("the ordered candidate list, from the rows as migrated", () => {
  it("reads bk_codex → bk_claude_code (Sonnet 4.5), and NOTHING below the seats is reachable (owner, 24 Oct 2026)", async () => {
    await seatsReset();
    const c = await resolveBriefingCandidates(env.DB, NOW);
    expect(c.length, "Rule 0: an empty ladder is a failure").toBeGreaterThan(4);

    expect(c[0]).toMatchObject({ position: 1, kind: "seat", backend_id: "bk_codex", model: null, eligible: true });
    expect(c[1]).toMatchObject({ position: 2, kind: "seat", backend_id: "bk_claude_code", model: "claude-sonnet-4-5-20250929", eligible: true });
    expect(c[0]!.cost).toBe("$0 (subscription)");
    expect(c[1]!.cost).toBe("$0 (subscription)");

    // The rungs are still listed, so the printout shows what exists — and every one is unreachable.
    const rungs = c.slice(2);
    expect(rungs.some((r) => r.kind === "paid_rung")).toBe(true);
    expect(rungs.filter((r) => r.eligible), "a cloud rung is reachable for the briefing").toEqual([]);
    expect(rungs.every((r) => /unreachable: the briefing never falls to a cloud rung/.test(r.why))).toBe(true);
  });

  it("marks a capped seat ineligible and keeps it on the list, so the printed ladder shows where the walk starts today", async () => {
    await seatsReset();
    await seatCapped("bk_codex");
    const c = await resolveBriefingCandidates(env.DB, NOW);
    expect(c[0]).toMatchObject({ backend_id: "bk_codex", eligible: false });
    expect(c[0]!.why).toMatch(/ceiling spent/);
    expect(c[1]).toMatchObject({ backend_id: "bk_claude_code", eligible: true });
    await seatsReset();
  });

  it("is a pure order over rows, so the script and the validator print the same list the Worker walks", () => {
    const c = orderBriefingCandidates({
      backends: [
        { id: "bk_claude_code", status: "enabled", class: "agent_executed", monthly_ceiling_micros: 50_000_000 },
        { id: "bk_codex", status: "enabled", class: "agent_executed", monthly_ceiling_micros: 0 },
        { id: "bk_openrouter", status: "enabled", class: "cloud_model", monthly_ceiling_micros: 5_000_000 },
      ],
      models: [
        { id: "paid", provider_id: "prv_openrouter", slug: "openai/gpt-5-mini", display_name: "GPT-5 mini", capability_tier: "general", enabled: 1, provider_enabled: 1, in_micros_1k: 250, out_micros_1k: 2000, ladder_rung: 210 },
        { id: "free", provider_id: "prv_openrouter", slug: "nvidia/nemotron-3-ultra-550b-a55b:free", display_name: "Nemotron", capability_tier: "general", enabled: 1, provider_enabled: 1, in_micros_1k: 0, out_micros_1k: 0, ladder_rung: 100 },
      ],
    }, NOW);
    expect(c.map((x) => x.backend_id + ":" + (x.model ?? "default"))).toEqual([
      "bk_codex:default", "bk_claude_code:claude-sonnet-4-5-20250929", "bk_openrouter:nvidia/nemotron-3-ultra-550b-a55b:free", "bk_openrouter:openai/gpt-5-mini",
    ]);
    expect(c.filter((x) => x.kind !== "seat").every((x) => !x.eligible)).toBe(true);
    expect(BRIEFING_SEATS.map((s) => s.backend_id)).toEqual(["bk_codex", "bk_claude_code"]);
  });
});

describe("the duty row carries the ladder, stamped by the materialiser from the module", () => {
  beforeEach(seatsReset);

  it("fires with backend_ladder, cloud_fallback and a model per seat", async () => {
    const { input } = await briefingTask();
    expect(input.backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
    expect(input.cloud_fallback).toBe(false);
    expect(input.requested.model_by_backend).toEqual({ bk_codex: null, bk_claude_code: "claude-sonnet-4-5-20250929" });
    expect(input.delivers).toBe("executive_reports");
  });
});

describe("scenario (a): Codex capped or unavailable → Claude Code serves the same spec at $0", () => {
  beforeEach(seatsReset);
  afterEach(seatsReset);

  it("walks past a capped bk_codex to bk_claude_code at dispatch, and records the step on the task", async () => {
    await seatCapped("bk_codex");
    const { taskId } = await briefingTask();
    let calls = 0;
    restore = stubFetch(() => { calls++; return completionResponse("should not be called"); });

    await handleTask(env as any, { taskId, lane: "ops" });

    const runs = await all<any>(`SELECT id, backend_id, status, requested FROM backend_runs WHERE task_id = ? ORDER BY started_at`, taskId);
    const parked = runs.filter((r) => r.status === "running");
    expect(parked, "no run was parked for a seat").toHaveLength(1);
    expect(parked[0]!.backend_id).toBe("bk_claude_code");
    const requested = JSON.parse(parked[0]!.requested);
    expect(requested.model, "Claude's seat lost its model").toBe("claude-sonnet-4-5-20250929");
    expect(requested.backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
    // The prompt Codex gets is the same specification, verbatim.
    expect(requested.instruction).toMatch(/EXECUTIVE INTELLIGENCE ENGINE/);
    expect(requested.instruction).toMatch(/Never invent/);

    const steps = await all<any>(`SELECT event, detail FROM task_events WHERE task_id = ? AND event IN ('ladder_step','dispatched') ORDER BY ts`, taskId);
    expect(steps.map((s) => s.event)).toEqual(["ladder_step", "dispatched"]);
    expect(JSON.parse(steps[0]!.detail)).toMatchObject({ backend_id: "bk_codex", next: "bk_claude_code" });
    expect(JSON.parse(steps[0]!.detail).refused).toMatch(/budget is spent/);
    expect(calls, "the walk went to the cloud while a seat was still available").toBe(0);
  });

  it("lets the Claude Code seat claim a run parked for Codex when the Mac says that seat is down, with its own model and a hand-off event", async () => {
    const { taskId } = await briefingTask();
    await handleTask(env as any, { taskId, lane: "ops" });
    const parked = await row<any>(`SELECT id, backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id).toBe("bk_codex");

    // Claude alone, without saying Codex is down: nothing. A seat never takes another's work unasked.
    const alone = await api("/api/backends/claim", { method: "POST", body: { device_id: "dev_test", backend_id: "bk_claude_code" } });
    expect(alone.status).toBe(200);
    expect((await alone.json() as any).data.run).toBeNull();

    // Claude, reporting that the Codex seat failed preflight: it takes the run, re-labelled.
    const res = await api("/api/backends/claim", { method: "POST", body: { device_id: "dev_test", backend_id: "bk_claude_code", fallback_from: ["bk_codex"] } });
    expect(res.status).toBe(200);
    const envelope = (await res.json() as any).data.run;
    expect(envelope, "the fallback claim returned nothing").not.toBeNull();
    expect(envelope.run_id).toBe(parked.id);
    expect(envelope.backend_id).toBe("bk_claude_code");
    expect(envelope.model, "Claude's seat did not get its own model").toBe("claude-sonnet-4-5-20250929");
    expect(envelope.instruction).toMatch(/EXECUTIVE INTELLIGENCE ENGINE/);
    expect(envelope.web_tools).toEqual(["WebSearch", "WebFetch"]);

    const run = await row<any>(`SELECT backend_id, claimed_by FROM backend_runs WHERE id = ?`, parked.id);
    expect(run.backend_id).toBe("bk_claude_code");
    const handoff = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_handoff'`, taskId);
    expect(JSON.parse(handoff.detail)).toMatchObject({ from: "bk_codex", to: "bk_claude_code" });

    // And the report Codex delivers lands under the same grader, saying who wrote it.
    const report = await api("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: {
          run_id: parked.id, task_id: taskId, backend_id: "bk_claude_code", status: "succeeded", summary: "done",
          files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
          rollback_ref: null, refusal_reason: null, error: null, cost_micros: 0, started_at: NOW, finished_at: NOW + 1000,
          delivers: { status: "partial", headline: "Codex wrote this morning.", summary: "A short one.", sections: [{ key: "key_events", heading: "Key Events Today", so_what: "Nothing scheduled.", bullets: ["Markets closed.", "Nothing scheduled."] }], sources: [], gaps: [{ wanted: "everything else", why: "test" }] },
          market_data: null,
        },
      },
    });
    expect(report.status, await report.text()).toBe(200);
    const stored = await row<any>(`SELECT written_by, status FROM executive_reports WHERE task_id = ?`, taskId);
    const by = JSON.parse(stored.written_by);
    expect(by).toMatchObject({ kind: "seat", backend_id: "bk_claude_code", refused_seats: ["bk_codex"] });
    expect(by.label).toMatch(/Claude Code on her Max seat/);
  });

  it("never hands a run to a seat that is not below the parked seat on the run's own ladder", async () => {
    const taskId = await insertTask({ status: "queued", title: "Not the briefing", input: JSON.stringify({ backend_id: "bk_codex", delivers: "tool_suggestions" }), intake_kind: "research" });
    await handleTask(env as any, { taskId, lane: "ops" });
    const parked = await row<any>(`SELECT id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    // Claude Code asks, claiming Codex is down: the run has no ladder, so it stays where it is.
    const res = await api("/api/backends/claim", { method: "POST", body: { device_id: "dev_test", backend_id: "bk_claude_code", fallback_from: ["bk_codex"] } });
    const data = (await res.json() as any).data;
    expect(data.run?.run_id ?? null).not.toBe(parked.id);
    const still = await row<any>(`SELECT backend_id, claimed_at FROM backend_runs WHERE id = ?`, parked.id);
    expect(still.backend_id).toBe("bk_codex");
    expect(still.claimed_at).toBeNull();
  });

  it("gives Codex a sandbox it can write the report in and the web it was asked to open", () => {
    const research = codexArgs({ kind: "research", web_tools: ["WebSearch", "WebFetch"], repo_path: "/x" } as any, "p");
    expect(research).toContain("workspace-write");
    // The form proven on her Mac (1 Oct 2026): JSON events, so the searches can be counted, and web_search=live.
    // `--search` is not used: it is a flag of `codex`, not `codex exec`, and was never run through to a finished briefing.
    expect(research.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(research.join(" ")).toContain("-c web_search=live");
    expect(research).not.toContain("--search");
    expect(research.join(" ")).toContain("sandbox_workspace_write.network_access=true");
    expect(research).not.toContain("--model");
    const plain = codexArgs({ kind: "repo_work" } as any, "p");
    expect(plain).toContain("read-only");
    expect(plain).not.toContain("--search");
    expect(plain).not.toContain("--json");
    expect(plain.join(" ")).not.toContain("web_search");
    expect(plain.join(" ")).not.toContain("network_access");
  });
});

describe("scenario (b): both seats unavailable → the briefing stops by name; it never falls to a cloud rung (owner, 24 Oct 2026: nothing paid)", () => {
  beforeEach(seatsReset);
  afterEach(seatsReset);

  it("makes no network call, writes no report, and fails with every seat's refusal on it", async () => {
    await seatCapped("bk_codex");
    await seatDisabled("bk_claude_code");
    const { taskId } = await briefingTask();
    const seen: string[] = [];
    restore = stubFetch((req) => { seen.push(new URL(req.url).hostname); return completionResponse("must not be reached"); });
    const withKey = Object.create(env) as typeof env;
    (withKey as any).OPENROUTER_API_KEY = "test-key";
    (withKey as any).OPENAI_API_KEY = "sk-test";

    await handleTask(withKey as any, { taskId, lane: "ops" });

    expect(seen, "a request left the Worker for a cloud rung").toEqual([]);
    const steps = await all<any>(`SELECT event, detail FROM task_events WHERE task_id = ? AND event = 'ladder_step' ORDER BY ts`, taskId);
    expect(steps.map((s) => JSON.parse(s.detail).backend_id)).toEqual(["bk_codex", "bk_claude_code"]);
    expect(JSON.parse(steps[1]!.detail).next).toBeNull();
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/bk_codex: .*bk_claude_code: /);
    expect(await row(`SELECT 1 FROM executive_reports WHERE task_id = ?`, taskId)).toBeNull();
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId)).toHaveLength(0);
  });

  it("reads the delivers object out of a rung's reply, and nothing out of prose", () => {
    expect(parseDeliversFromText('Sure. {"status":"partial","sections":[{"key":"x","bullets":["a {b} c"]}]} Done.')).toMatchObject({ status: "partial" });
    expect(parseDeliversFromText("No JSON here.")).toBeNull();
    expect(parseDeliversFromText('{"broken": ')).toBeNull();
    expect(parseDeliversFromText('[1,2]')).toBeNull();
  });
});

describe("scenario (c): both seats unavailable and OpenAI provisioned → the research rung writes it, with web search and sources", () => {
  beforeEach(async () => {
    await seatsReset();
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL WHERE id = 'bk_openai'`).run();
    await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_openai'`).run();
    await env.DB.prepare(`UPDATE models SET enabled = 1 WHERE id = 'mdl_openai_research'`).run();
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever','OPEN',?) ON CONFLICT(key) DO UPDATE SET value = 'OPEN'`).bind(Date.now()).run();
  });
  afterEach(async () => {
    await seatsReset();
    await env.DB.prepare(`UPDATE providers SET enabled = 0 WHERE id = 'prv_openai'`).run();
    await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = 'bk_openai'`).run();
    await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run();
  });

  const report = {
    status: "complete",
    headline: "Yields and the Fed decide the week.",
    summary: "A research rung searched and wrote this.",
    sections: [
      { key: "key_events", heading: "Key Events Today", so_what: "Watch PCE.", bullets: ["PCE inflation prints at 7:30 AM CT [1].", "ADP payrolls follow [1]."], sources: [1] },
    ],
    sources: [
      { name: "Reuters", url: "https://www.reuters.com/markets/a", read_at: "1999-01-01T00:00:00Z" },
      { name: "Invented", url: "https://example.com/never-searched", read_at: "1999-01-01T00:00:00Z" },
    ],
    gaps: [],
  };

  it("never calls the research rung for the briefing, even provisioned with the lever open", async () => {
    await seatCapped("bk_codex");
    await seatDisabled("bk_claude_code");
    const { taskId } = await briefingTask();
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("{}", 10, 10); });
    const withKey = Object.create(env) as typeof env;
    (withKey as any).OPENAI_API_KEY = "sk-test";
    (withKey as any).OPENROUTER_API_KEY = "test-key";
    await handleTask(withKey as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("failed");
    expect(await row(`SELECT 1 FROM executive_reports WHERE task_id = ?`, taskId)).toBeNull();
  });
});
