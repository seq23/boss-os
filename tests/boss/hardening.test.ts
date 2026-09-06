import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { logEvent } from "../../src/worker/boss/lib/log";
import { MAX_UNLOCK_ATTEMPTS } from "../../src/worker/boss/auth";
import { api, apiJson, insertTask, row } from "./helpers";

const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });

describe("Phase 5 — the door is actually locked", () => {
  it("refuses an API call with no session", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/system/status"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error).toBe("Locked");
  });

  it("answers liveness without a passcode", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.data.status).toBe("ok");
  });

  it("locks the deep health check behind a session", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/system/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

/**
 * The unlock endpoint is the only door, and it is unauthenticated by nature.
 * These cover the two things that keep it from being a free guessing machine:
 * a per-caller attempt budget, and sessions that die when the signing secret
 * is rotated rather than outliving it.
 */
describe("Phase 5 — the door does not allow unlimited guessing", () => {
  const unlock = async (passcode: string, ip: string) => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://boss.test/api/auth/unlock", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ passcode }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: res.status, body: await res.json<any>(), cookie: res.headers.get("set-cookie") };
  };

  it("locks a caller out after the attempt budget and says so", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < MAX_UNLOCK_ATTEMPTS; i++) {
      const attempt = await unlock("wrong-guess", ip);
      expect(attempt.status).toBe(401);
    }

    const locked = await unlock("wrong-guess", ip);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many wrong passcodes/);

    // The lockout is not a bypass either: the right passcode is still refused
    // while the window is open, so guessing cannot be laundered into a success.
    const rightButLocked = await unlock(env.BOSS_PASSCODE, ip);
    expect(rightButLocked.status).toBe(429);
  });

  it("counts per caller rather than globally, and forgives on success", async () => {
    const attacker = "203.0.113.20";
    for (let i = 0; i < MAX_UNLOCK_ATTEMPTS; i++) await unlock("wrong-guess", attacker);
    expect((await unlock("wrong-guess", attacker)).status).toBe(429);

    // A different caller is unaffected by someone else's spent budget.
    const boss = await unlock(env.BOSS_PASSCODE, "203.0.113.21");
    expect(boss.status).toBe(200);
    expect(boss.cookie).toMatch(/boss_session=/);
  });

  it("clears a caller's failures once they get it right", async () => {
    const ip = "203.0.113.30";
    for (let i = 0; i < MAX_UNLOCK_ATTEMPTS - 1; i++) expect((await unlock("wrong", ip)).status).toBe(401);
    expect((await unlock(env.BOSS_PASSCODE, ip)).status).toBe(200);
    // The budget is back: a fresh wrong guess is a 401, not a 429.
    expect((await unlock("wrong", ip)).status).toBe(401);
  });

  it("ends every session when the signing secret is rotated", async () => {
    const issued = await unlock(env.BOSS_PASSCODE, "203.0.113.40");
    const token = /boss_session=([^;]+)/.exec(issued.cookie ?? "")?.[1];
    expect(token).toBeTruthy();

    const { readSession } = await import("../../src/worker/boss/auth");
    expect(await readSession(env as any, token)).not.toBeNull();

    // Rotate the secret. The stored record is untouched; it simply no longer
    // matches, which is the difference between a real rotation control and a
    // variable nothing reads.
    const rotated = { ...env, SESSION_SECRET: "a-new-secret-after-a-lost-phone" };
    expect(await readSession(rotated as any, token)).toBeNull();

    // And the leftover is cleaned up rather than left behind in KV.
    expect(await env.SESSIONS.get(`session:${token}`)).toBeNull();
  });

  it("refuses a session record that carries no fingerprint at all", async () => {
    // The shape a pre-rotation build would have written. It is not a session.
    const forged = "ses_forged_no_fingerprint";
    await env.SESSIONS.put(`session:${forged}`, JSON.stringify({ id: forged, issuedAt: Date.now() }));
    const { readSession } = await import("../../src/worker/boss/auth");
    expect(await readSession(env as any, forged)).toBeNull();
  });

  it("answers a malformed unlock body with a 401 rather than a crash", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://boss.test/api/auth/unlock", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" },
        body: "{not json",
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("Phase 5 — diagnostics", () => {
  it("stores structured events that outlive a log tail", async () => {
    await logEvent(env.DB, {
      level: "warn", scope: "test", event: "something_happened",
      lane: "ops", entityId: "x", detail: { a: 1 }, durationMs: 12,
    });
    const stored = await row(`SELECT * FROM system_events WHERE event = 'something_happened'`);
    expect(stored!.level).toBe("warn");
    expect(JSON.parse(stored!.detail).a).toBe(1);
    expect(stored!.duration_ms).toBe(12);
  });

  it("surfaces events and cron history together", async () => {
    await logEvent(env.DB, { level: "error", scope: "test", event: "boom" });
    const { body } = await apiJson("/api/system/diagnostics?level=error");
    expect(body.data.events.some((e: any) => e.event === "boom")).toBe(true);
    expect(Array.isArray(body.data.cron_runs)).toBe(true);
  });

  it("reports what is broken rather than failing on the first problem", async () => {
    const { body } = await apiJson("/api/system/health");
    const names = body.data.checks.map((c: any) => c.name);
    expect(names).toContain("d1");
    expect(names).toContain("r2_vault");
    expect(names).toContain("kv_sessions");
    expect(names).toContain("secrets");
    expect(body.data.checks.find((c: any) => c.name === "r2_vault").ok).toBe(true);
    expect(body.data.checks.find((c: any) => c.name === "kv_sessions").ok).toBe(true);
  });
});

describe("Phase 5 — dead letter triage", () => {
  it("requeues a dead-lettered task and closes the record", async () => {
    const taskId = await insertTask({ status: "failed" });
    await env.DB
      .prepare(
        `INSERT INTO dead_letters (id, ts, queue, task_id, lane, attempts, error, status)
         VALUES ('dlq_t1', ?, 'boss-os-tasks', ?, 'ops', 3, 'boom', 'open')`,
      )
      .bind(Date.now(), taskId)
      .run();

    const { status, body } = await post("/api/system/dead-letters/dlq_t1/requeue");
    expect(status).toBe(200);
    expect(body.data.requeued).toBe(true);
    expect((await row(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("queued");
    expect((await row(`SELECT status FROM dead_letters WHERE id = 'dlq_t1'`))!.status).toBe("requeued");
  });

  it("dismisses one that is not worth retrying", async () => {
    await env.DB
      .prepare(
        `INSERT INTO dead_letters (id, ts, queue, lane, attempts, error, status)
         VALUES ('dlq_t2', ?, 'boss-os-tasks', 'ops', 3, 'boom', 'open')`,
      )
      .bind(Date.now())
      .run();
    const { status } = await post("/api/system/dead-letters/dlq_t2/dismiss");
    expect(status).toBe(200);
    expect((await row(`SELECT status FROM dead_letters WHERE id = 'dlq_t2'`))!.status).toBe("dismissed");
  });
});

describe("Phase 5 — cost governor", () => {
  it("rejects a cost mode that does not exist", async () => {
    const { status } = await apiJson("/api/system/settings/cost_mode", { method: "PUT", body: { value: "TURBO" } });
    expect(status).toBe(400);
  });

  it("accepts a real cost mode and reports its policy on status", async () => {
    await apiJson("/api/system/settings/cost_mode", { method: "PUT", body: { value: "EMERGENCY_LOW_COST" } });
    const { body } = await apiJson("/api/system/status");
    expect(body.data.cost_mode).toBe("EMERGENCY_LOW_COST");
    expect(body.data.cost_mode_policy.allowedTiers).toEqual(["fast"]);
  });

  it("breaks spend down by lane, model, and intake kind", async () => {
    await env.DB
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, model_id, in_tokens, out_tokens, cost_micros, status)
         VALUES ('usg_c1', ?, 'ops', 'mdl_kimi_k2', 100, 100, 1234, 'ok')`,
      )
      .bind(Date.now())
      .run();
    const { body } = await apiJson("/api/system/cost?days=7");
    expect(body.data.by_lane.find((l: any) => l.lane === "ops").cost).toBeGreaterThanOrEqual(1234);
    expect(body.data.by_model.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 5 — the nightly cron records what it did", () => {
  it("writes a per-step record instead of claiming success wholesale", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();

    await worker.scheduled!({ cron: "0 3 * * *", scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
    await waitOnExecutionContext(ctx);

    const run = await row(`SELECT status, steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    expect(run).toBeTruthy();
    const steps = JSON.parse(run!.steps);
    expect(steps.map((s: any) => s.name)).toEqual([
      "roll_budgets", "roll_day", "surface_follow_ups", "roll_almanac",
      "capability_cadence", "compliance_sentinel", "expiry_sweep", "promotion_sweep", "snapshot",
    ]);
    expect(run!.status).toBe("complete");
  });
});

describe("Phase 5 — employee lifecycle", () => {
  it("reports sprawl signals from real roster data", async () => {
    const { body } = await apiJson("/api/employees/review/sprawl");
    expect(body.data.roster_size).toBeGreaterThan(0);
    expect(Array.isArray(body.data.duplicate_departments)).toBe(true);
    expect(Array.isArray(body.data.reviews_due)).toBe(true);
  });

  it("retires an employee through a recorded review", async () => {
    const { status, body } = await post("/api/employees/emp_continuity/review", {
      outcome: "retire", note: "Duties absorbed by the Chief of Staff",
    });
    expect(status).toBe(201);
    expect(body.data.outcome).toBe("retire");
    const emp = await row(`SELECT lifecycle FROM employees WHERE id = 'emp_continuity'`);
    expect(emp!.lifecycle).toBe("retired");
  });

  it("merges a duplicate and moves its open work", async () => {
    const taskId = await insertTask({ status: "queued", employee_id: "emp_knowledge" });
    const { status } = await post("/api/employees/emp_knowledge/merge", { into: "emp_chief", note: "Overlap" });
    expect(status).toBe(200);

    expect((await row(`SELECT employee_id FROM tasks WHERE id = ?`, taskId))!.employee_id).toBe("emp_chief");
    const merged = await row(`SELECT lifecycle, merged_into FROM employees WHERE id = 'emp_knowledge'`);
    expect(merged!.lifecycle).toBe("merged");
    expect(merged!.merged_into).toBe("emp_chief");
  });

  it("refuses to merge across lanes", async () => {
    const { status, body } = await post("/api/employees/emp_risk/merge", { into: "emp_chief" });
    expect(status).toBe(409);
    expect(body.hint).toContain("isolation");
  });

  it("refuses to hire an employee with no charter", async () => {
    const { status, body } = await post("/api/employees", { name: "Vague", role: "Stuff" });
    expect(status).toBe(400);
    expect(body.error).toContain("charter");
  });
});

describe("Phase 5 — model registry gates", () => {
  it("keeps an unproven local model out of a route default", async () => {
    await post("/api/models", {
      id: "mdl_local_test", provider_id: "prv_fireworks", slug: "local/test",
      display_name: "Local Test", privacy_class: "local", capability_tier: "general",
    });
    const { status, body } = await apiJson("/api/models/routes/rt_ops_default", {
      method: "PATCH", body: { primary_model_id: "mdl_local_test" },
    });
    expect(status).toBe(409);
    expect(body.hint).toContain("approved workload benchmarks");
  });

  it("promotes a model to benchmarked only after enough distinct workloads", async () => {
    const workloads = ["wl_research", "wl_drafting", "wl_coaching", "wl_decision", "wl_memory"];
    let last: any;
    for (const wl of workloads) {
      last = await post("/api/models/benchmarks", {
        model_id: "mdl_qwen_fast", workload_id: wl, quality_score: 0.8, verdict: "approved",
      });
    }
    expect(last.body.data.distinct_approved_workloads).toBe(5);
    expect(last.body.data.benchmark_status).toBe("benchmarked");
    const model = await row(`SELECT benchmark_status FROM models WHERE id = 'mdl_qwen_fast'`);
    expect(model!.benchmark_status).toBe("benchmarked");
  });

  it("does not count the same workload five times", async () => {
    let last: any;
    for (let i = 0; i < 5; i++) {
      last = await post("/api/models/benchmarks", {
        model_id: "mdl_kimi_k2", workload_id: "wl_research", quality_score: 0.8, verdict: "approved",
      });
    }
    expect(last.body.data.distinct_approved_workloads).toBe(1);
    expect(last.body.data.benchmark_status).toBe("unbenchmarked");
  });
});
