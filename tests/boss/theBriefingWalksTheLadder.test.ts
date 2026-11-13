import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBriefingCandidates, BRIEFING_SEATS, orderBriefingCandidates } from "../../src/worker/boss/duties/briefingLadder";
import { handleTask, parseDeliversFromText } from "../../src/worker/boss/queue/consumer";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { BRIEFING_PROMPT_VERSION, composeBriefingPrompt, ctDayLabel, repoAuthoredBriefingText } from "../../src/worker/boss/duties/briefingSpec";
import { scanForModelAccess, type PrivateLexicon } from "../../src/worker/boss/router/modelAccess";
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
  it("reads bk_claude_code (Sonnet 4.5) → bk_codex, and NOTHING below the seats is reachable (owner, 13 Nov 2026: the briefing is hard work)", async () => {
    await seatsReset();
    const c = await resolveBriefingCandidates(env.DB, NOW);
    expect(c.length, "Rule 0: an empty ladder is a failure").toBeGreaterThan(4);

    expect(c[0]).toMatchObject({ position: 1, kind: "seat", backend_id: "bk_claude_code", model: "claude-sonnet-4-5-20250929", eligible: true });
    expect(c[1]).toMatchObject({ position: 2, kind: "seat", backend_id: "bk_codex", model: null, eligible: true });
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
    await seatCapped("bk_claude_code");
    const c = await resolveBriefingCandidates(env.DB, NOW);
    expect(c[0]).toMatchObject({ backend_id: "bk_claude_code", eligible: false });
    expect(c[0]!.why).toMatch(/ceiling spent/);
    expect(c[1]).toMatchObject({ backend_id: "bk_codex", eligible: true });
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
      "bk_claude_code:claude-sonnet-4-5-20250929", "bk_codex:default", "bk_openrouter:nvidia/nemotron-3-ultra-550b-a55b:free", "bk_openrouter:openai/gpt-5-mini",
    ]);
    expect(c.filter((x) => x.kind !== "seat").every((x) => !x.eligible)).toBe(true);
    expect(BRIEFING_SEATS.map((s) => s.backend_id)).toEqual(["bk_claude_code", "bk_codex"]);
  });
});

describe("the duty row carries the ladder, stamped by the materialiser from the module", () => {
  beforeEach(seatsReset);

  it("fires with backend_ladder, cloud_fallback and a model per seat", async () => {
    const { input } = await briefingTask();
    expect(input.backend_ladder).toEqual(["bk_claude_code", "bk_codex"]);
    expect(input.cloud_fallback).toBe(false);
    expect(input.requested.model_by_backend).toEqual({ bk_codex: null, bk_claude_code: "claude-sonnet-4-5-20250929" });
    expect(input.delivers).toBe("executive_reports");
  });
});

describe("scenario (a): the briefing starts on Claude's seat; Claude capped or unavailable → Codex serves the same spec at $0", () => {
  beforeEach(seatsReset);
  afterEach(seatsReset);

  // 13 Nov 2026: the briefing is HARD work (aiRoles.mjs HARD_DELIVERS): it reaches her unchecked, and
  // the briefs Codex wrote from 25 Oct to 1 Nov ran at half depth. Claude's seat first, Codex's as the
  // backup. Its spec is this repository's own text, so the privacy screen does not read it as deal material.
  it("Claude capped: the briefing walks to Codex's seat on Codex's own default with the same spec; Claude's step is its ceiling, never the privacy screen", async () => {
    await seatCapped("bk_claude_code");
    const { taskId } = await briefingTask();
    let calls = 0;
    restore = stubFetch(() => { calls++; return completionResponse("should not be called"); });

    await handleTask(env as any, { taskId, lane: "ops" });

    const runs = await all<any>(`SELECT id, backend_id, status, requested FROM backend_runs WHERE task_id = ? ORDER BY started_at`, taskId);
    expect(runs.map((r) => r.backend_id), "a capped Claude seat was handed the briefing").not.toContain("bk_claude_code");
    const parked = runs.filter((r) => r.status === "running");
    expect(parked, "no run was parked for a seat").toHaveLength(1);
    expect(parked[0]!.backend_id).toBe("bk_codex");
    const requested = JSON.parse(parked[0]!.requested);
    expect(requested.model, "a Claude model id reached the Codex seat").toBeUndefined();
    expect(requested.backend_ladder).toEqual(["bk_claude_code", "bk_codex"]);
    expect(requested.job_class).toBe("hard");
    expect(requested.instruction).toMatch(/EXECUTIVE INTELLIGENCE ENGINE/);
    expect(requested.instruction).toMatch(/Never invent/);

    const steps = await all<any>(`SELECT event, detail FROM task_events WHERE task_id = ? AND event IN ('ladder_step','dispatched') ORDER BY ts`, taskId);
    expect(steps.map((s) => s.event)).toEqual(["ladder_step", "dispatched"]);
    expect(JSON.parse(steps[0]!.detail)).toMatchObject({ backend_id: "bk_claude_code", next: "bk_codex" });
    expect(JSON.parse(steps[0]!.detail).refused).not.toMatch(/privacy screen/);
    expect(calls, "the walk went to the cloud while Codex's seat was available").toBe(0);
  });

  it("both seats free: the briefing's FIRST route is Claude's seat, on Claude's model, with no privacy refusal (owner, 13 Nov 2026)", async () => {
    const { taskId } = await briefingTask();
    await handleTask(env as any, { taskId, lane: "ops" });
    const first = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(first.backend_id, "the briefing started on Codex's seat").toBe("bk_claude_code");
    expect(JSON.parse(first.requested).model).toBe("claude-sonnet-4-5-20250929");
    expect(JSON.parse(first.requested).backend_ladder, "Codex is no longer the backup").toEqual(["bk_claude_code", "bk_codex"]);
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId)).toHaveLength(0);
  });

  it("Claude capped, Codex free: Codex claims the briefing and its report lands under the grader, signed by Codex", async () => {
    await seatCapped("bk_claude_code");
    const { taskId } = await briefingTask();
    await handleTask(env as any, { taskId, lane: "ops" });
    const parked = await row<any>(`SELECT id, backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id).toBe("bk_codex");

    const res = await api("/api/backends/claim", { method: "POST", body: { device_id: "dev_test", backend_id: "bk_codex" } });
    const envelope = (await res.json() as any).data.run;
    expect(envelope?.run_id).toBe(parked.id);
    expect(envelope.web_tools).toEqual(["WebSearch", "WebFetch"]);

    const report = await api("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: {
          run_id: parked.id, task_id: taskId, backend_id: "bk_codex", status: "succeeded", summary: "done",
          files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
          rollback_ref: null, refusal_reason: null, error: null, cost_micros: 0, started_at: NOW, finished_at: NOW + 1000,
          delivers: { status: "partial", headline: "Codex wrote this morning.", summary: "A short one.", sections: [{ key: "key_events", heading: "Key Events Today", so_what: "Nothing scheduled.", bullets: ["Markets closed.", "Nothing scheduled."] }], sources: [], gaps: [{ wanted: "everything else", why: "test" }] },
          market_data: null,
        },
      },
    });
    expect(report.status, await report.text()).toBe(200);
    const stored = await row<any>(`SELECT written_by FROM executive_reports WHERE task_id = ?`, taskId);
    const by = JSON.parse(stored.written_by);
    expect(by).toMatchObject({ kind: "seat", backend_id: "bk_codex" });
    expect(by.label).toMatch(/Codex CLI on her ChatGPT Plus seat/);
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
    await seatCapped("bk_claude_code");
    await seatDisabled("bk_codex");
    const { taskId } = await briefingTask();
    const seen: string[] = [];
    restore = stubFetch((req) => { seen.push(new URL(req.url).hostname); return completionResponse("must not be reached"); });
    const withKey = Object.create(env) as typeof env;
    (withKey as any).OPENROUTER_API_KEY = "test-key";
    (withKey as any).OPENAI_API_KEY = "sk-test";

    await handleTask(withKey as any, { taskId, lane: "ops" });

    expect(seen, "a request left the Worker for a cloud rung").toEqual([]);
    const steps = await all<any>(`SELECT event, detail FROM task_events WHERE task_id = ? AND event = 'ladder_step' ORDER BY ts`, taskId);
    expect(steps.map((s) => JSON.parse(s.detail).backend_id)).toEqual(["bk_claude_code", "bk_codex"]);
    expect(JSON.parse(steps[0]!.detail).refused, "the briefing's own wording was read as deal material").not.toMatch(/privacy screen/);
    expect(JSON.parse(steps[1]!.detail).next).toBeNull();
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/bk_codex: /);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ?`, taskId)).toHaveLength(0);
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

/**
 * 13 NOV 2026: THE BRIEFING FAILED AT 06:03 AND THE MORNING EMAIL WENT WITHOUT IT. The privacy screen
 * read the spec's own words ("commitments", "subscription", "valuation", "allocation", "%") as deal
 * material, so the two-seat ladder collapsed to Claude's seat, which was out of weekly usage. The fix
 * exempts ONLY the repository's own composed spec from the pattern tiers. These prove it cannot fail
 * open: the lexicon, a private brain span, a fund-instrument phrase, her edited prompt and an altered
 * prompt are each still Claude-only.
 */
describe("the briefing's own spec is not deal material; nothing else is exempt (13 Nov 2026)", () => {
  const lex: PrivateLexicon = { names: ["ottoline vandermeer"], established: true, note: "test lexicon" } as PrivateLexicon;
  const spec = composeBriefingPrompt({ dayLabel: ctDayLabel(NOW), hasMarketData: true });
  const stamped = { spec_module: "executive_briefing", prompt_version: BRIEFING_PROMPT_VERSION, prompt: spec };
  const scan = (content: string, own: string[]) => scanForModelAccess([{ role: "user", content }], lex, { modelAccess: "public_model_approved", sensitivity: "public", repoAuthoredText: own });

  it("the composed spec reads as deal material on its own (the 13 Nov failure), and as public once it is known to be the repository's text", () => {
    expect(scan(spec, []).privateOnly, "the spec no longer trips the screen: this test lost its reason to exist").toBe(true);
    const own = repoAuthoredBriefingText(stamped, NOW);
    expect(own).toEqual([spec]);
    expect(scan(`deadline line\n${spec}`, own).privateOnly).toBe(false);
  });

  it("with the exemption applied, a private name, a private brain span and a fund-instrument phrase around the spec are each still Claude-only", () => {
    const own = repoAuthoredBriefingText(stamped, NOW);
    expect(scan(`Firm context: Ottoline Vandermeer\n${spec}`, own).privateOnly).toBe(true);
    expect(scan(`<!-- confidential -->x<!-- /confidential -->\n${spec}`, own).privateOnly).toBe(true);
    expect(scan(`Notes: the carried interest on Fund II\n${spec}`, own).privateOnly).toBe(true);
  });

  it("exempts nothing that is not the repository's exact spec: her edit, an altered prompt, another version or another module", () => {
    expect(repoAuthoredBriefingText({ ...stamped, prompt_source: "owner_edit" }, NOW)).toEqual([]);
    expect(repoAuthoredBriefingText({ ...stamped, prompt: `${spec}\nAlso summarise the $40M valuation and allocation.` }, NOW)).toEqual([]);
    expect(repoAuthoredBriefingText({ ...stamped, prompt_version: "1999-01-01.1" }, NOW)).toEqual([]);
    expect(repoAuthoredBriefingText({ ...stamped, spec_module: "something_else" }, NOW)).toEqual([]);
    expect(repoAuthoredBriefingText({ ...stamped, prompt: spec }, NOW - 5 * 86_400_000), "a stale day label was accepted").toEqual([]);
  });

  it("her own edited briefing prompt carrying deal terms is still private work on the shipped consumer: Claude's seat first, never a free or cloud route", async () => {
    await seatsReset();
    const edited = "Summarise the capital commitment, the allocation and the Fund II subscription at a $40M valuation, 2% fee.";
    await env.DB.prepare(`UPDATE standing_duties SET owner_prompt = ? WHERE id = 'duty_exec_intel'`).bind(edited).run();
    try {
      const { taskId, input } = await briefingTask();
      expect(input.prompt_source).toBe("owner_edit");
      await handleTask(env as any, { taskId, lane: "ops" });
      const runs = await all<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ?`, taskId);
      expect(runs.map((r) => r.backend_id), "her edited deal wording reached Codex").not.toContain("bk_codex");
      expect(runs.map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
      const step = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId);
      expect(JSON.parse(step.detail).refused).toMatch(/privacy screen keeps this prompt off every free and cloud route/);
      expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud route was asked").toHaveLength(0);
    } finally {
      await env.DB.prepare(`UPDATE standing_duties SET owner_prompt = NULL WHERE id = 'duty_exec_intel'`).run();
    }
  });
});
