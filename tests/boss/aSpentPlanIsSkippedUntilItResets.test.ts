import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { executeRun, REQUIRED_FORBIDDEN } from "../../scripts/sync-agent/runner.mjs";
import { claudeCodeExecutor } from "../../scripts/sync-agent/backends/claudeCode.mjs";
// @ts-expect-error — codex.mjs ships no declaration file, like the tests that import it elsewhere.
import { codexExecutor } from "../../scripts/sync-agent/backends/codex.mjs";
import { createSeatExhaustion, cooldownSeconds } from "../../scripts/sync-agent/seatExhaustion.mjs";
import { DEFAULT_COOLDOWN_SECONDS, MAX_COOLDOWN_SECONDS, MIN_COOLDOWN_SECONDS } from "../../scripts/lib/seat-usage-limit.mjs";
import { evaluateBackend } from "../../src/worker/boss/backends/guard";
import { getBackend } from "../../src/worker/boss/backends/registry";
import {
  SEAT_SPENT_DEFAULT_COOLDOWN_S,
  SEAT_SPENT_MAX_COOLDOWN_S,
  SEAT_SPENT_MIN_COOLDOWN_S,
  isPlanSpent,
  spentCooldownSeconds,
} from "../../src/worker/boss/backends/spent";
import { orderBriefingCandidates } from "../../src/worker/boss/duties/briefingLadder";
import type { Envelope } from "../../scripts/sync-agent/runner.d.mts";

/**
 * A SEAT WHOSE PLAN IS OUT OF USAGE IS NOT AN ANSWER, AND IS SKIPPED UNTIL IT RESETS (29 Sep 2026).
 *
 * The same defect west-peek-os had, found in this repository by reading it: the runner graded a run
 * by the CLI's JSON error flag and its exit code, so a "usage limit reached" sentence printed on a
 * normal exit was filed as the answer; and the only "capped" a seat could be was against this
 * system's OWN ledger, which cannot see the usage the owner spends interactively on the same plan.
 *
 * NOTHING HERE STARTS A CLI. The spawn is faked the way agentRunner.test.ts fakes it, so the parts
 * that matter — the adapters, the runner's grade, the agent's memory, the route, the guard and the
 * printed ladder — are exercised end to end with no model called and nothing spent.
 *
 * WHAT THIS DOES NOT PROVE: that the live Claude Code and Codex CLIs print the sentences the
 * detector reads. That needs a Mac that has actually run out. The ledger says UNPROVEN.
 */

function fakeSpawn({ stdout = "", stderr = "", code = 0 }: { stdout?: string; stderr?: string; code?: number }) {
  return (_bin?: string, _args?: string[], _opts?: unknown) => {
    const stream = (text: string) => ({
      on(event: string, cb: (chunk: string) => void) { if (event === "data" && text) queueMicrotask(() => cb(text)); return this; },
    });
    return {
      stdout: stream(stdout),
      stderr: stream(stderr),
      stdin: { end(_v: string) { return true; } },
      kill() { return true; },
      on(event: string, cb: (...a: any[]) => void) {
        if (event === "close") setTimeout(() => cb(code), 1);
        return this;
      },
    };
  };
}

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
  run_id: "run_spent",
  task_id: "task_spent",
  backend_id: "bk_claude_code",
  envelope_id: "env_spent",
  approved: true,
  approval_receipt: "rcpt_spent",
  kind: "research",
  repo_path: "/Users/owner/GitHub/example",
  allowed_paths: ["**"],
  instruction: "Write this morning's report.",
  instruction_origin: "owner",
  verification: [],
  forbidden_actions: [...REQUIRED_FORBIDDEN],
  allowed_kinds: ["research"],
  capabilities: ["agentic_coding"],
  credential_ref: "local:claude-code-session",
  max_seconds: 60,
  ...over,
});

const CLEAN = { head: "aaa", branch: "work", upstream: "bbb", dirty: false, changed_files: [] as string[] };
const LIMIT_JSON = JSON.stringify({ type: "result", is_error: false, result: "Claude AI usage limit reached|1759071600", total_cost_usd: 0 });

const claudeRun = (stdout: string, code = 0) =>
  claudeCodeExecutor(
    { envelope: envelope(), prompt: "p", sentinel: "s", forbidden: REQUIRED_FORBIDDEN, cwd: "/work" },
    { spawnImpl: fakeSpawn({ stdout, code }), readDelivers: async () => null },
  ) as Promise<any>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the adapters do not accept a limit notice as the answer", () => {
  it("Claude Code: a usage-limit reply that EXITS 0 is a spent plan, not a summary", async () => {
    const out = await claudeRun(LIMIT_JSON, 0);
    expect(out.seat_exhausted).toBeTruthy();
    expect(out.seat_exhausted.notice).toContain("usage limit reached");
    expect(out.error).toContain("Claude Code has run out of usage");
  });

  it("Claude Code: an ordinary answer, and a long answer that talks about limits, are answers", async () => {
    expect((await claudeRun(JSON.stringify({ result: "Done. Three callers updated.", total_cost_usd: 0 }))).seat_exhausted).toBeNull();
    const long = `The usage limit reached message is what the CLI prints. ${"detail ".repeat(200)}`;
    expect((await claudeRun(JSON.stringify({ result: long, total_cost_usd: 0 }))).seat_exhausted).toBeNull();
  });

  it("Claude Code: a COMPLETE deliverable is never a spent plan, whatever else was printed", async () => {
    const out = (await claudeCodeExecutor(
      { envelope: envelope(), prompt: "p", sentinel: "s", forbidden: REQUIRED_FORBIDDEN, cwd: "/work" },
      { spawnImpl: fakeSpawn({ stdout: LIMIT_JSON, code: 0 }), readDelivers: async () => JSON.stringify({ status: "complete", sections: [] }) },
    )) as any;
    expect(out.seat_exhausted).toBeNull();
    expect(out.error).toBeNull();
  });

  it("Codex: the same rule for the second seat, on stderr or stdout, and the benign line is not a notice", async () => {
    const run = (stdout: string, stderr: string, code = 0) =>
      codexExecutor(
        { envelope: envelope({ backend_id: "bk_codex" }), prompt: "p", cwd: "/work" },
        { spawnImpl: fakeSpawn({ stdout, stderr, code }), readDelivers: async () => null },
      ) as Promise<any>;
    const spent = await run("", "You've hit your usage limit. Try again in 3 hours.", 1);
    expect(spent.seat_exhausted).toBeTruthy();
    expect(spent.seat_exhausted.retry_after_seconds).toBe(3 * 3600);
    expect(spent.error).toContain("Codex has run out of usage");
    const benign = await run("The reserve ratio is 0.35.", "ERROR: failed to refresh available models: unknown variant `max`", 0);
    expect(benign.seat_exhausted).toBeNull();
    expect(benign.error).toBeNull();
  });
});

describe("the runner fails a run on a spent plan, whatever the exit code said", () => {
  it("files it failed, with the seat's notice on the packet and nothing delivered", async () => {
    const out: any = await executeRun(envelope(), {
      backend: {},
      gitProbe: async () => CLEAN,
      execute: async () => ({
        summary: "Claude AI usage limit reached|1759071600",
        exit_code: 0,
        commands: [],
        files_touched: [],
        cost_micros: 0,
        remaining_risks: [],
        error: "Claude Code has run out of usage and said: usage limit reached",
        seat_exhausted: { notice: "usage limit reached", retry_after_seconds: 600 },
      }),
    });
    expect(out.status).toBe("failed");
    expect(out.seat_exhausted).toEqual({ notice: "usage limit reached", retry_after_seconds: 600 });
    expect(out.error).toContain("run out of usage");
  });

  it("and an ordinary success carries no seat_exhausted", async () => {
    const out: any = await executeRun(envelope(), {
      backend: {},
      gitProbe: async () => CLEAN,
      execute: async () => ({ summary: "done", exit_code: 0, commands: [], files_touched: [], cost_micros: 0, remaining_risks: [], error: null }),
    });
    expect(out.status).toBe("succeeded");
    expect(out.seat_exhausted).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the agent remembers a spent seat, and forgets it on its own", () => {
  it("skips the seat until the time passes, then offers it again with nobody flipping anything", () => {
    let t = 1_000_000;
    const ex = createSeatExhaustion({ now: () => t });
    expect(ex.activeUntil("bk_claude_code")).toBeNull();
    const until = ex.mark("bk_claude_code", 600);
    expect(until).toBe(t + 600_000);
    expect(ex.activeUntil("bk_claude_code")).toBe(until);
    expect(ex.activeUntil("bk_codex"), "the other seat is a different plan").toBeNull();
    t = until + 1;
    expect(ex.activeUntil("bk_claude_code")).toBeNull();
  });

  it("a success clears it at once, and the state survives a restart through load/save", () => {
    let stored: Record<string, number> = {};
    let t = 5_000;
    const a = createSeatExhaustion({ now: () => t, load: () => stored, save: (s) => { stored = s; } });
    a.mark("bk_codex", 900);
    const b = createSeatExhaustion({ now: () => t, load: () => stored, save: (s) => { stored = s; } });
    expect(b.activeUntil("bk_codex")).not.toBeNull();
    b.clear("bk_codex");
    expect(createSeatExhaustion({ now: () => t, load: () => stored }).activeUntil("bk_codex")).toBeNull();
  });

  it("bounds the cooldown both ways and defaults when the notice names no time; a broken store is empty, not fatal", () => {
    expect(cooldownSeconds(undefined)).toBe(DEFAULT_COOLDOWN_SECONDS);
    expect(cooldownSeconds(5)).toBe(MIN_COOLDOWN_SECONDS);
    expect(cooldownSeconds(10 * 86_400)).toBe(MAX_COOLDOWN_SECONDS);
    const ex = createSeatExhaustion({ load: () => { throw new Error("db locked"); }, save: () => { throw new Error("db locked"); } });
    expect(ex.activeUntil("bk_claude_code")).toBeNull();
    expect(() => ex.mark("bk_claude_code", 60)).not.toThrow();
  });

  it("the Worker's bounds are the Mac's bounds — two lists with one link", () => {
    expect(SEAT_SPENT_DEFAULT_COOLDOWN_S).toBe(DEFAULT_COOLDOWN_SECONDS);
    expect(SEAT_SPENT_MIN_COOLDOWN_S).toBe(MIN_COOLDOWN_SECONDS);
    expect(SEAT_SPENT_MAX_COOLDOWN_S).toBe(MAX_COOLDOWN_SECONDS);
    expect(spentCooldownSeconds(undefined)).toBe(SEAT_SPENT_DEFAULT_COOLDOWN_S);
    expect(spentCooldownSeconds(1)).toBe(SEAT_SPENT_MIN_COOLDOWN_S);
    expect(spentCooldownSeconds(1e9)).toBe(SEAT_SPENT_MAX_COOLDOWN_S);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the cloud records a spent seat and the guard refuses it until it resets", () => {
  const DISPATCH = {
    title: "Write the morning report",
    prompt: "Read the news and write the report.",
    kind: "research",
    backend_id: "bk_claude_code",
    repo_path: "/Users/owner/GitHub/boss-os",
    allowed_paths: ["**"],
    verification: [],
    requires: "agentic_coding",
  };

  async function enableSeat(id: string) {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', monthly_ceiling_micros = 0, exhausted_until = NULL, exhausted_reason = NULL WHERE id = ?`).bind(id).run();
  }

  async function claimedRun(): Promise<string> {
    await enableSeat("bk_claude_code");
    const dispatched = await apiJson("/api/backends/dispatch", { method: "POST", body: DISPATCH });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBeLessThan(300);
    await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_mac" } });
    return dispatched.body.data.run_id as string;
  }

  const packet = (runId: string, over: Record<string, unknown> = {}) => ({
    device_id: "dev_mac",
    evidence: {
      run_id: runId, status: "failed", summary: "Claude AI usage limit reached|1759071600",
      files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] },
      remaining_risks: [], violations: [], rollback_ref: null, refusal_reason: null,
      error: "Claude Code has run out of usage and said: usage limit reached", cost_micros: 0,
      seat_exhausted: { notice: "usage limit reached", retry_after_seconds: 3600 },
      ...over,
    },
  });

  it("a report that says the plan is spent stamps the backend, and the guard then refuses it with a sentence", async () => {
    const runId = await claimedRun();
    const before = Date.now();
    const res = await apiJson("/api/backends/report", { method: "POST", body: packet(runId) });
    expect(res.status).toBe(200);

    const backend = (await getBackend(env.DB, "bk_claude_code"))!;
    expect(isPlanSpent(backend, Date.now())).toBe(true);
    expect(backend.exhausted_until!).toBeGreaterThanOrEqual(before + 3600_000 - 5_000);
    expect(backend.exhausted_reason).toContain("usage limit reached");

    const verdict: any = evaluateBackend(env as any, backend, "research", { requires: "agentic_coding" });
    expect(verdict.refused).toBe(true);
    expect(verdict.code).toBe("plan_spent");
    expect(verdict.sentence).toContain("out of usage");
    expect(verdict.sentence).toMatch(/tried again in about/);
  });

  it("a NEW dispatch to the spent seat is refused at dispatch — which is where a ladder walks to the next seat", async () => {
    await claimedRun().then((id) => apiJson("/api/backends/report", { method: "POST", body: packet(id) }));
    const again = await apiJson("/api/backends/dispatch", { method: "POST", body: DISPATCH });
    // The sentence is what the owner reads; the code is what a ladder branches on, and it is on the recorded refusal.
    expect(JSON.stringify(again.body)).toContain("out of usage");
    const refused = await row<any>(`SELECT status, refusal_reason FROM backend_runs WHERE status = 'refused' ORDER BY started_at DESC LIMIT 1`);
    expect(refused.status).toBe("refused");
    expect(JSON.parse(refused.refusal_reason).code).toBe("plan_spent");
  });

  it("the other seat is a different plan and is not refused", async () => {
    await claimedRun().then((id) => apiJson("/api/backends/report", { method: "POST", body: packet(id) }));
    const codex = (await getBackend(env.DB, "bk_codex"))!;
    expect(isPlanSpent(codex, Date.now())).toBe(false);
  });

  it("the cooldown expires by itself, and a success from the seat clears it at once", async () => {
    const runId = await claimedRun();
    await apiJson("/api/backends/report", { method: "POST", body: packet(runId, { seat_exhausted: { notice: "limit", retry_after_seconds: 60 } }) });
    const spent = (await getBackend(env.DB, "bk_claude_code"))!;
    expect(isPlanSpent(spent, Date.now())).toBe(true);
    expect(isPlanSpent(spent, spent.exhausted_until! + 1), "past the stamp it is offered again").toBe(false);
    expect((evaluateBackend(env as any, spent, "research", { requires: "agentic_coding", now: spent.exhausted_until! + 1 }) as any).code).not.toBe("plan_spent");

    // A later run of the same seat that SUCCEEDS proves the plan has usage again.
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ? WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = NULL WHERE id = 'bk_claude_code'`).run();
    const second = await claimedRun();
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'x' WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    const ok = await apiJson("/api/backends/report", {
      method: "POST",
      body: packet(second, { status: "succeeded", error: null, seat_exhausted: null, summary: "Done." }),
    });
    expect(ok.status).toBe(200);
    expect((await row<any>(`SELECT exhausted_until, exhausted_reason FROM execution_backends WHERE id = 'bk_claude_code'`)).exhausted_until).toBeNull();
  });

  it("the printed briefing ladder marks a spent seat ineligible and says why", async () => {
    const backends = [
      { id: "bk_claude_code", status: "enabled", class: "agent_executed", monthly_ceiling_micros: 0, exhausted_until: Date.now() + 25 * 60_000, exhausted_reason: "usage limit reached" },
      { id: "bk_codex", status: "enabled", class: "agent_executed", monthly_ceiling_micros: 0 },
    ];
    const list = orderBriefingCandidates({ backends: backends as any, models: [] });
    const claude = list.find((c) => c.backend_id === "bk_claude_code")!;
    const codex = list.find((c) => c.backend_id === "bk_codex")!;
    expect(claude.eligible).toBe(false);
    expect(claude.why).toContain("out of usage");
    expect(codex.eligible).toBe(true);
  });
});
