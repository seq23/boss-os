import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_VERDICT, BenchRefused, GOLDEN_TASKS, runBench } from "../../src/worker/boss/router/bench";
import { setSpendLever } from "../../src/worker/boss/router/spend";
import { all, api, apiJson, row, stubFetch, completionResponse } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

/**
 * STAGE 7 — THE BENCH.
 *
 * Every test here is really the same test asked from a different angle: DOES IT
 * REFUSE RATHER THAN INVENT. `DECISIONS.md` BD-003 deferred this work with the
 * reason that matters — "a harness run against stubs would write numbers that
 * look like benchmarks into the table the router trusts. An empty bench refuses
 * honestly; a fabricated one routes work on fiction." So the assertions below
 * are mostly about rows that must NOT exist.
 */

function withAi(text = "A benchmark answer.") {
  const calls: string[] = [];
  const bound = Object.create(env) as typeof env;
  (bound as any).AI = {
    async run(model: string) {
      calls.push(model);
      return { response: text, usage: { prompt_tokens: 40, completion_tokens: 25 } };
    },
  };
  return { bound, calls };
}

async function provisionWorkersAi() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
  const res = await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });
  expect(res.status).toBe(201);
}

async function benchmarkRows() {
  return all(`SELECT id, model_id, workload_id, verdict, quality_score, latency_ms, cost_micros, note FROM model_benchmarks`);
}

/**
 * THE TABLE STARTS EMPTY FOR THESE TESTS, AND THAT IS A FIXTURE, NOT THE RULE.
 *
 * Every assertion in this file is about what THIS HARNESS RUN wrote — "no row", "exactly one row",
 * "never an approved verdict". Migration 0231 seeds seven operator-scored rows as the evidence
 * behind a §3.1 risk promotion, so the table is no longer empty on a freshly migrated database and
 * counting all rows would measure the migration instead of the harness.
 *
 * They are cleared rather than filtered out by id, because a filter would silently stop counting
 * any future seeded row too, and then a harness that DID write an approved verdict could hide
 * behind the exclusion. What is preserved is exactly the thing being pinned: a run of `runBench`
 * against an empty table can only add `needs_review`, and often adds nothing at all.
 */
beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM model_benchmarks`).run();
});

describe("Stage 7 — the bench refuses to spend rather than guessing", () => {
  it("records every paid pair as NOT RUN at FREE_ONLY, and writes no benchmark row", async () => {
    /*
     * THE LEVER IS SET, NOT INHERITED — a contract change from migration 0253, written down rather
     * than worked around. `settings.spend_lever` had never been seeded, so this test's posture came
     * from an ABSENCE that `spendLeverState` resolved to FREE_ONLY. 0253 seeds the live default as
     * MODERATE, because an unseeded row meant every paid backend commissioned in 0247 was
     * unreachable and nothing said so. The fail-closed CODE default is unchanged and still
     * FREE_ONLY. A test about the FREE_ONLY posture now asks for it, which is also what production
     * would take.
     */
    await setSpendLever(env.DB, { position: "FREE_ONLY" }, "test");
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_fireworks'`).run();
    /*
     * THE PROVIDER, NOT JUST THE BACKEND. Migration 0247 disabled `prv_fireworks` because enabling
     * follows the key and there is no FIREWORKS_API_KEY, and `loadBenchModels` joins `providers` on
     * `enabled = 1` — so with the shipped seed this model is not a candidate at all and the bench
     * refuses with "examined nothing" before reaching the lever it is here to test. Asking for the
     * paid path explicitly is a fair description of what it would take in production.
     */
    await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("must not run"); });

    const report = await runBench(env, { modelIds: ["mdl_kimi_k2"], workloadIds: ["wl_research", "wl_drafting"] });

    expect(called).toBe(false);
    expect(report.examined).toBe(2);
    expect(report.ran).toBe(0);
    expect(report.not_run).toBe(2);
    expect(report.lever_position).toBe("FREE_ONLY");
    // The reason is a sentence a person can act on, and it names the lever.
    for (const r of report.results) {
      expect(r.status).toBe("not_run");
      expect(r.reason).toContain("spend lever is at $0");
    }
    // NOTHING was written to the table the router trusts.
    expect(await benchmarkRows()).toHaveLength(0);
  });

  it("still refuses a paid model when the lever is up but the backend is not commissioned", async () => {
    await setSpendLever(env.DB, { position: "OPEN" }, "test");
    await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = 'bk_fireworks'`).run();
    // The provider is enabled so the model is a CANDIDATE; the backend stays uncommissioned, which is
    // the thing this test is about. See 0247.
    await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("must not run"); });

    const report = await runBench(env, { modelIds: ["mdl_kimi_k2"], workloadIds: ["wl_research"] });

    expect(called).toBe(false);
    expect(report.ran).toBe(0);
    expect(report.results[0]!.reason).toContain("not enabled");
    expect(await benchmarkRows()).toHaveLength(0);
  });

  it("runs on a free tier and records ONLY what it measured", async () => {
    await provisionWorkersAi();
    const { bound, calls } = withAi("Measured answer.");

    const report = await runBench(bound, { modelIds: ["mdl_cf_llama31_8b"], workloadIds: ["wl_drafting"] });

    expect(calls).toHaveLength(1);
    expect(report.ran).toBe(1);
    expect(report.results[0]!.free).toBe(true);
    expect(report.results[0]!.cost_micros).toBe(0);
    expect(report.results[0]!.latency_ms).not.toBeNull();

    const rows = await benchmarkRows();
    expect(rows).toHaveLength(1);
    // QUALITY IS NOT SCORED AND NOT INVENTED.
    expect(rows[0]!.verdict).toBe(BENCH_VERDICT);
    expect(rows[0]!.verdict).toBe("needs_review");
    expect(rows[0]!.quality_score).toBe(0);
    expect(rows[0]!.note).toContain("quality is UNSCORED");
  });

  it("cannot write an approved verdict, so it cannot promote anything", async () => {
    await provisionWorkersAi();
    const { bound } = withAi();

    await runBench(bound, { workloadIds: ["wl_drafting", "wl_research", "wl_coaching"] });

    const approved = await all(`SELECT id FROM model_benchmarks WHERE verdict = 'approved'`);
    expect(approved).toHaveLength(0);
    const model = await row(`SELECT benchmark_status FROM models WHERE id = 'mdl_cf_llama31_8b'`);
    expect(model!.benchmark_status).toBe("unbenchmarked");
  });

  it("records a failed call as NOT RUN and writes no row for it", async () => {
    await provisionWorkersAi();
    const bound = Object.create(env) as typeof env;
    (bound as any).AI = { async run() { throw new Error("model is cold"); } };

    const report = await runBench(bound, { modelIds: ["mdl_cf_llama31_8b"], workloadIds: ["wl_drafting"] });

    expect(report.ran).toBe(0);
    expect(report.results[0]!.reason).toContain("the call failed");
    // A failure is real evidence, and it belongs in the report — not in a table
    // the router reads as a result.
    expect(await benchmarkRows()).toHaveLength(0);
  });

  it("reports a missing binding as absent rather than skipping quietly", async () => {
    await provisionWorkersAi();
    // `env` has no AI binding: the honest state until wrangler.toml declares one.
    const report = await runBench(env, { modelIds: ["mdl_cf_llama31_8b"], workloadIds: ["wl_drafting"] });
    expect(report.ran).toBe(0);
    expect(report.results[0]!.reason).toMatch(/AI binding/);
  });

  it("says NOT RUN when a workload has no golden task, instead of inventing one", async () => {
    await provisionWorkersAi();
    await env.DB
      .prepare(
        `INSERT INTO workload_profiles (id, name, intake_kind, recommendation, note)
         VALUES ('wl_unmapped','Unmapped','west_peek_bridge','hybrid','No golden task exists for this kind.')`,
      )
      .run();
    const { bound } = withAi();

    const report = await runBench(bound, { modelIds: ["mdl_cf_llama31_8b"], workloadIds: ["wl_unmapped"] });
    expect(report.ran).toBe(0);
    expect(report.results[0]!.reason).toContain("no golden task is defined");
    expect(Object.keys(GOLDEN_TASKS)).not.toContain("west_peek_bridge");
  });

  it("HARD FAILS rather than passing when it examines nothing", async () => {
    // A loop over an empty list that returns "all good" is the defect this
    // repository names: a stage that exits 0 having done nothing.
    await expect(runBench(env, { modelIds: ["mdl_does_not_exist"] })).rejects.toBeInstanceOf(BenchRefused);
    await expect(runBench(env, { workloadIds: ["wl_does_not_exist"] })).rejects.toBeInstanceOf(BenchRefused);

    const { status, body } = await apiJson("/api/models/bench/run", {
      method: "POST", body: { model_ids: ["mdl_does_not_exist"] },
    });
    expect(status).toBe(409);
    expect(body.error).toContain("examined nothing");
  });

  it("logs the run, including every reason nothing ran", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_fireworks'`).run();
    /*
     * THE PROVIDER, NOT JUST THE BACKEND. Migration 0247 disabled `prv_fireworks` because enabling
     * follows the key and there is no FIREWORKS_API_KEY, and `loadBenchModels` joins `providers` on
     * `enabled = 1` — so with the shipped seed this model is not a candidate at all and the bench
     * refuses with "examined nothing" before reaching the lever it is here to test. Asking for the
     * paid path explicitly is a fair description of what it would take in production.
     */
    await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
    await runBench(env, { modelIds: ["mdl_kimi_k2"], workloadIds: ["wl_research"] });
    const logged = await row(`SELECT level, detail FROM system_events WHERE event = 'bench_run' ORDER BY ts DESC LIMIT 1`);
    expect(logged!.level).toBe("warn");
    expect(JSON.parse(logged!.detail).not_run_reasons[0]).toContain("wl_research");
  });
});

describe("Stage 7 — promotion needs evidence AND a card", () => {
  it("refuses a route default for an unbenchmarked model, whatever the bench recorded", async () => {
    await provisionWorkersAi();
    const { bound } = withAi();
    await runBench(bound, { modelIds: ["mdl_cf_llama31_8b"], workloadIds: ["wl_drafting"] });

    const { status, body } = await apiJson("/api/models/routes/rt_ops_default", {
      method: "PATCH", body: { primary_model_id: "mdl_cf_llama31_8b" },
    });
    expect(status).toBe(409);
    expect(body.error).toContain("unbenchmarked");
    expect(body.hint).toContain("never scores quality");
  });

  it("still refuses a benchmarked model with no approved card, and accepts one with", async () => {
    await provisionWorkersAi();
    // Operator-scored approved verdicts across five distinct workloads. This is
    // the only path to `benchmarked`, and a human types every one of them.
    for (const wl of ["wl_research", "wl_drafting", "wl_coaching", "wl_decision", "wl_memory"]) {
      const res = await apiJson("/api/models/benchmarks", {
        method: "POST",
        body: { model_id: "mdl_cf_llama31_8b", workload_id: wl, quality_score: 0.7, verdict: "approved" },
      });
      expect(res.status).toBe(201);
    }
    const model = await row(`SELECT benchmark_status FROM models WHERE id = 'mdl_cf_llama31_8b'`);
    expect(model!.benchmark_status).toBe("benchmarked");

    // Evidence alone is not enough.
    const withoutCard = await apiJson("/api/models/routes/rt_ops_default", {
      method: "PATCH", body: { primary_model_id: "mdl_cf_llama31_8b" },
    });
    expect(withoutCard.status).toBe(409);
    expect(withoutCard.body.error).toContain("No approved promotion card");

    // A card that is merely REQUESTED is not enough either.
    const card = await apiJson("/api/models/promotions", {
      method: "POST", body: { model_id: "mdl_cf_llama31_8b", route_id: "rt_ops_default" },
    });
    expect(card.status).toBe(201);
    const pending = await apiJson("/api/models/routes/rt_ops_default", {
      method: "PATCH", body: { primary_model_id: "mdl_cf_llama31_8b" },
    });
    expect(pending.status).toBe(409);

    // Approved by a human, and only then.
    await env.DB
      .prepare(`UPDATE approvals SET status = 'approved', decided_at = ?, decided_by = 'boss' WHERE id = ?`)
      .bind(Date.now(), card.body.data.approval_id)
      .run();
    const allowed = await apiJson("/api/models/routes/rt_ops_default", {
      method: "PATCH", body: { primary_model_id: "mdl_cf_llama31_8b" },
    });
    expect(allowed.status).toBe(200);
    const route = await row(`SELECT primary_model_id FROM routes WHERE id = 'rt_ops_default'`);
    expect(route!.primary_model_id).toBe("mdl_cf_llama31_8b");
  });
});
