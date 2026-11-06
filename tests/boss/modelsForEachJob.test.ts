/**
 * A MODEL LIST FOR EACH JOB (owner approved, 4 Nov 2026). model_job_policies is one more FILTER in the
 * router, after privacy: it only removes candidates, every refusal is in routing_decisions, and a
 * `stop` job ends in a named stop, never a weaker model's output.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion, RoutingBlocked } from "../../src/worker/boss/router";
import { setSpendLever } from "../../src/worker/boss/router/spend";
import { JOB_POLICY_DEFAULTS } from "../../src/shared/boss/router/jobPolicy.mjs";
import { api, apiJson, row, stubFetch, completionResponse } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const req = (jobKey: string | null, taskId: string) => ({
  routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", taskId, jobKey,
  messages: [{ role: "user" as const, content: "Say something short." }],
});

function withAi(text = "Free tier answer.") {
  const calls: string[] = [];
  const bound = Object.create(env) as typeof env;
  (bound as any).AI = { async run(model: string) { calls.push(model); return { response: text, usage: { prompt_tokens: 20, completion_tokens: 10 } }; } };
  return { bound, calls };
}

async function setJob(job: string, p: { allowed?: string[]; paid?: 0 | 1; tier?: string; onNo?: string }) {
  await env.DB.prepare(
    `INSERT INTO model_job_policies (job_key, label, allowed_model_ids, paid_allowed, min_capability_tier, on_no_model) VALUES (?,?,?,?,?,?)
     ON CONFLICT(job_key) DO UPDATE SET allowed_model_ids = excluded.allowed_model_ids, paid_allowed = excluded.paid_allowed,
       min_capability_tier = excluded.min_capability_tier, on_no_model = excluded.on_no_model`,
  ).bind(job, "Test job", JSON.stringify(p.allowed ?? []), p.paid ?? 1, p.tier ?? "fast", p.onNo ?? "stop").run();
}

const candidates = async (taskId: string) => JSON.parse((await row<any>(`SELECT candidates FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC LIMIT 1`, taskId))!.candidates);

beforeEach(async () => {
  // Free Workers AI (8B fast, 70B general) AND paid Fireworks (the route's primary), lever MODERATE.
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id IN ('bk_workers_ai', 'bk_fireworks')`).run();
  expect((await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} })).status).toBe(201);
  await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
  await setSpendLever(env.DB, { position: "MODERATE" }, "test");
});

describe("the job's model list is one more filter", () => {
  it("without a job, the paid primary runs (the baseline the filters below change)", async () => {
    restore = stubFetch(() => completionResponse("Paid answer."));
    const { bound } = withAi();
    const r = await routeCompletion(bound, req(null, "tsk_job_base"));
    expect(r.providerId).toBe("prv_fireworks");
  });

  it("a model not on the job's list is never chosen, and the refusal is recorded", async () => {
    await setJob("job_only_8b", { allowed: ["mdl_cf_llama31_8b"], paid: 1 });
    let fetched = 0;
    restore = stubFetch(() => { fetched += 1; return completionResponse("Paid answer."); });
    const { bound, calls } = withAi();
    const r = await routeCompletion(bound, req("job_only_8b", "tsk_job_list"));
    expect(r.modelId).toBe("mdl_cf_llama31_8b");
    expect(calls).toEqual(["@cf/meta/llama-3.1-8b-instruct-fp8"]);
    expect(fetched).toBe(0);
    const c = await candidates("tsk_job_list");
    for (const id of ["mdl_kimi_k2", "mdl_cf_llama33_70b"]) {
      expect(c.find((x: any) => x.model_id === id)).toMatchObject({ stage: "job", verdict: "rejected" });
      expect(c.find((x: any) => x.model_id === id).reason).toMatch(/not on the model list for Test job/);
    }
  });

  it("paid_allowed = 0 never routes a paid model, even with the spend lever at MODERATE", async () => {
    await setJob("job_free", { paid: 0 });
    let fetched = 0;
    restore = stubFetch(() => { fetched += 1; return completionResponse("Paid answer."); });
    const { bound } = withAi();
    const r = await routeCompletion(bound, req("job_free", "tsk_job_free"));
    expect(r.providerId).toBe("prv_workers_ai");
    expect(fetched).toBe(0);
    const c = await candidates("tsk_job_free");
    expect(c.find((x: any) => x.model_id === "mdl_kimi_k2")).toMatchObject({ stage: "job", verdict: "rejected" });
    expect(c.find((x: any) => x.model_id === "mdl_kimi_k2").reason).toMatch(/free models only/);
  });

  it("min_capability_tier removes weaker models", async () => {
    // Only the free 8B (fast) is left: a fast job runs on it, a general job never does.
    await env.DB.prepare(`UPDATE models SET enabled = 0 WHERE id = 'mdl_cf_llama33_70b'`).run();
    try {
      await setJob("job_fast_free", { paid: 0, tier: "fast", onNo: "skip" });
      await setJob("job_general_free", { paid: 0, tier: "general", onNo: "skip" });
      const a = withAi();
      expect((await routeCompletion(a.bound, req("job_fast_free", "tsk_job_tier_a"))).modelId).toBe("mdl_cf_llama31_8b");
      const b = withAi();
      const err = await routeCompletion(b.bound, req("job_general_free", "tsk_job_tier_b")).catch((e) => e);
      expect(err).toBeInstanceOf(RoutingBlocked);
      expect(b.calls).toEqual([]);
      expect((await candidates("tsk_job_tier_b")).find((x: any) => x.model_id === "mdl_cf_llama31_8b")).toMatchObject({ stage: "job", verdict: "rejected" });
      expect((await candidates("tsk_job_tier_b")).find((x: any) => x.model_id === "mdl_cf_llama31_8b").reason).toMatch(/needs at least general/);
    } finally {
      await env.DB.prepare(`UPDATE models SET enabled = 1 WHERE id = 'mdl_cf_llama33_70b'`).run();
    }
  });

  it("'stop': no model fits → a named stop, and no model's output at all", async () => {
    await setJob("job_stop", { allowed: ["mdl_cf_llama31_8b"], tier: "general", onNo: "stop" });
    let fetched = 0;
    restore = stubFetch(() => { fetched += 1; return completionResponse("Paid answer."); });
    const { bound, calls } = withAi("A weak answer that must never be used.");
    const err = await routeCompletion(bound, req("job_stop", "tsk_job_stop")).catch((e) => e);
    expect(err).toBeInstanceOf(RoutingBlocked);
    expect(err.message).toMatch(/^NAMED STOP \[NO_MODEL_FOR_JOB\] No model allowed for Test job could run/);
    expect(calls).toEqual([]);
    expect(fetched).toBe(0);
    expect((await row<any>(`SELECT outcome FROM routing_decisions WHERE task_id = 'tsk_job_stop'`))!.outcome).toBe("blocked_no_model");
  });

  it("'skip': the job sits the run out, with its own outcome", async () => {
    await setJob("job_skip", { tier: "frontier", onNo: "skip" });
    const { bound } = withAi();
    const err = await routeCompletion(bound, req("job_skip", "tsk_job_skip")).catch((e) => e);
    expect(err).toBeInstanceOf(RoutingBlocked);
    expect(err.outcome).toBe("skipped_by_job");
  });
});

describe("Settings → Models for each job", () => {
  it("lists the seeded jobs as Default, in plain words; a change is saved and can go back to default", async () => {
    const r = await apiJson<any>("/api/models/job-policies");
    expect(r.status).toBe(200);
    const jobs = r.body.data.jobs;
    for (const [key, d] of Object.entries(JOB_POLICY_DEFAULTS)) {
      expect(jobs.find((j: any) => j.job_key === key)).toMatchObject({ ...d, is_default: true });
    }
    expect(r.body.data.models.every((m: any) => typeof m.display_name === "string")).toBe(true);
    const put = await apiJson<any>("/api/models/job-policies/meeting_prep", { method: "PUT", body: { min_capability_tier: "frontier" } });
    expect(put.body.data).toMatchObject({ min_capability_tier: "frontier", is_default: false });
    expect((await apiJson<any>("/api/models/job-policies/meeting_prep", { method: "PUT", body: { on_no_model: "explode" } })).status).toBe(400);
    const back = await apiJson<any>("/api/models/job-policies/meeting_prep", { method: "PUT", body: { reset: true } });
    expect(back.body.data.is_default).toBe(true);
  });
});

describe("her time zone (owner_timezone)", () => {
  it("defaults to Central; the authenticated endpoint sets it and refuses a non-zone", async () => {
    expect((await apiJson<any>("/api/system/owner-timezone")).body.data.tz).toBe("America/Chicago");
    expect((await apiJson<any>("/api/system/owner-timezone", { method: "PUT", body: { tz: "America/New_York", via: "mac" } })).status).toBe(200);
    expect((await apiJson<any>("/api/system/owner-timezone")).body.data.tz).toBe("America/New_York");
    expect((await apiJson<any>("/api/system/owner-timezone", { method: "PUT", body: { tz: "Mars/Olympus" } })).status).toBe(400);
    const worker = (await import("../../src/worker/boss/index")).default;
    const { createExecutionContext } = await import("cloudflare:test");
    const res = await worker.fetch(new Request("https://boss.test/api/system/owner-timezone", { method: "PUT", body: JSON.stringify({ tz: "America/Denver" }) }), env as any, createExecutionContext());
    expect(res.status).toBe(401);
  });
});
