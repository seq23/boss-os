import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { estimateCostMicros, type ModelRow } from "./policy";
import { WIRING_BY_PROVIDER, adapterCredential, backendKindFor } from "./backends";
import { spendLeverState, formatMicros } from "./spend";
import { checkBackend } from "../backends/registry";
import { laneAllowance, type Refusal } from "../backends/guard";
import { breakerState, recordFailure, recordSuccess } from "./breaker";
import { recordUsage } from "./index";
import { ProviderCallError } from "./types";

/**
 * STAGE 7 — THE MODEL BENCH.
 *
 * THE RULE THAT SHAPES EVERY LINE HERE: never fabricate a benchmark. A harness
 * run against stubs that writes numbers into the table the ROUTER TRUSTS is far
 * worse than an empty bench. An empty bench refuses honestly; a fabricated one
 * routes her work on fiction. So:
 *
 *   - a pair that cannot be run for free, and has no allowance, is recorded as
 *     NOT RUN with the reason — never as a zero, a default, or a guess;
 *   - NOT RUN is never written to `model_benchmarks`. It goes to the report and
 *     to `system_events`, because the benchmarks table is the one the router
 *     reads and an absence must not look like a result there;
 *   - a pair that DID run records only what was measured — latency, the tokens
 *     the provider reported, the cost that follows from them;
 *   - QUALITY IS NOT MEASURED BY THIS HARNESS AND IS NOT INVENTED BY IT. Every
 *     row it writes is `needs_review` with a quality score of 0, which promotes
 *     nothing. A model becomes a default only through an operator-scored
 *     `approved` verdict and an approved promotion card. This harness cannot
 *     promote anything, and a test proves it cannot write `approved`.
 *
 * AND IT RUNS AT $0 BY DEFAULT. With the spend lever at FREE_ONLY only free
 * routes are eligible: Workers AI inside its included allowance, and OpenRouter
 * models the provider publishes as free. Benchmarking a paid model requires the
 * lever to be moved first — the harness refuses rather than spending.
 */

export const BENCH_VERDICT = "needs_review" as const;

/**
 * The golden task set, in code and fixed.
 *
 * PUBLIC AND SYNTHETIC BY CONSTRUCTION. Not one prompt contains an owner record,
 * a name, or anything from the database, so a bench run cannot become the way
 * private material reaches a cloud model. That is a property of this constant,
 * which is why the tasks live here rather than being drawn from real work.
 */
export const GOLDEN_TASKS: Record<string, { title: string; prompt: string }> = {
  research: {
    title: "Summarise a claim and name what would falsify it",
    prompt: "In under 120 words: state the strongest argument that a four-day work week raises output, then name the single piece of evidence that would most cleanly disprove it.",
  },
  drafting: {
    title: "Draft a short decline",
    prompt: "Write a three-sentence reply declining a speaking invitation for a date that is already booked, offering one alternative month. Plain, warm, no apology stacking.",
  },
  coaching: {
    title: "Turn a vague intention into one next action",
    prompt: "Someone says: 'I should get better at finishing things.' Reply in under 80 words with one concrete next action and the question you would ask to check it is the right one.",
  },
  decision_support: {
    title: "Lay out a decision without making it",
    prompt: "Two options: rent a warehouse for 12 months at a fixed price, or take month-to-month at 30% more. List the three facts that decide it and say which you would need first. Do not choose.",
  },
  memory_promotion: {
    title: "Separate a durable fact from a passing one",
    prompt: "Given: 'We moved the weekly review to Thursdays because Wednesday clashes with the board call, at least until March.' Say which part is durable, which is temporary, and what you would store.",
  },
  repository: {
    title: "Read a diff and say what it breaks",
    prompt: "A function that returned `null` for a missing record now throws. Name the three call-site patterns that break, and the one that silently keeps working but is now wrong.",
  },
  trading: {
    title: "State a rule, not a prediction",
    prompt: "Write one position-sizing rule for a strategy with a 45% win rate and a 2:1 payoff. State the assumption it depends on. Make no forecast.",
  },
};

export interface BenchPairResult {
  model_id: string;
  model_name: string;
  backend_id: string | null;
  workload_id: string;
  intake_kind: string;
  status: "ran" | "not_run";
  reason: string;
  latency_ms: number | null;
  cost_micros: number | null;
  free: boolean;
  benchmark_id: string | null;
}

export interface BenchReport {
  started_at: number;
  finished_at: number;
  lever_position: string;
  lever_label: string;
  examined: number;
  ran: number;
  not_run: number;
  /** Always `needs_review`. Stated in the report so nobody has to read the code. */
  verdict_written: string;
  results: BenchPairResult[];
  note: string;
}

/** The harness had nothing to examine. A loop over nothing is not a pass. */
export class BenchRefused extends Error {
  constructor(message: string, public hint: string) {
    super(message);
  }
}

interface BenchOptions {
  modelIds?: string[];
  workloadIds?: string[];
  lane?: string;
  maxOutputTokens?: number;
}

export async function runBench(env: Env, opts: BenchOptions = {}): Promise<BenchReport> {
  const db = env.DB;
  const started = Date.now();
  const lever = await spendLeverState(db);
  const lane = opts.lane ?? "ops";
  const laneBudget = await laneAllowance(db, lane);
  const maxOutputTokens = opts.maxOutputTokens ?? 512;

  const models = await loadBenchModels(db, opts.modelIds);
  const workloads = await loadBenchWorkloads(db, opts.workloadIds);

  if (models.length === 0) {
    throw new BenchRefused(
      "No model matched, so the bench examined nothing",
      "Register a model on a cloud backend first — Systems → Backends provisions the free ones.",
    );
  }
  if (workloads.length === 0) {
    throw new BenchRefused(
      "No workload profile matched, so the bench examined nothing",
      "Name an existing workload id, or leave the list empty to run the whole golden set.",
    );
  }

  const results: BenchPairResult[] = [];

  for (const model of models) {
    const def = WIRING_BY_PROVIDER.get(model.provider_id);
    const cred = def ? adapterCredential(env, def) : { available: false, detail: "no cloud backend is wired for this model" };
    const breaker = def ? await breakerState(db, def.backendId) : null;

    for (const workload of workloads) {
      const golden = GOLDEN_TASKS[workload.intake_kind];
      const pair = (status: "ran" | "not_run", reason: string, extra: Partial<BenchPairResult> = {}): BenchPairResult => ({
        model_id: model.id, model_name: model.display_name,
        backend_id: def?.backendId ?? null, workload_id: workload.id,
        intake_kind: workload.intake_kind, status, reason,
        latency_ms: null, cost_micros: null, free: false, benchmark_id: null, ...extra,
      });

      if (!golden) {
        results.push(pair("not_run", `no golden task is defined for ${workload.intake_kind} work`));
        continue;
      }
      if (!def) {
        results.push(pair("not_run", `${model.display_name} has no registered execution backend`));
        continue;
      }

      const promptChars = golden.prompt.length;
      const estimate = estimateCostMicros(model, promptChars, maxOutputTokens);

      // THE SAME GUARD THE ROUTER USES, ASKED THE SAME WAY.
      //
      // The bench does not get its own opinion about what may run or what may be
      // spent — it asks `backends/guard.ts`, which owns the enabled check, the
      // credential presence, the free-tier proof and min(lane, lever, ceiling).
      // A harness with a second copy of that arithmetic is a harness that can
      // spend money the router would have refused.
      const verdict = await checkBackend(env, def.backendId, backendKindFor(workload.intake_kind), {
        model: model.slug,
        estimatedCostMicros: estimate,
        laneBudget,
        lever,
      });
      if (verdict.refused) {
        const refusal = verdict as Refusal;
        results.push(pair("not_run", refusal.sentence, { cost_micros: estimate > 0 ? estimate : null }));
        continue;
      }
      const free = verdict.cost_basis.free;

      if (!cred.available) {
        results.push(pair("not_run", cred.detail, { free }));
        continue;
      }
      if (breaker?.open) {
        results.push(pair(
          "not_run",
          `circuit breaker is open for ${def.providerName}: ${breaker.reason ?? "repeated failures"}`,
          { free },
        ));
        continue;
      }

      const callStarted = Date.now();
      try {
        const out = await def.adapter.complete(
          {
            modelSlug: model.slug,
            messages: [
              { role: "system", content: "You are being benchmarked. Answer the task directly and stop." },
              { role: "user", content: golden.prompt },
            ],
            maxOutputTokens,
            temperature: 0.2,
          },
          { baseUrl: model.base_url, apiKey: cred.apiKey, ai: (cred as any).ai },
        );
        const latency = Date.now() - callStarted;
        const cost = free
          ? 0
          : Math.round((out.inTokens / 1000) * model.in_micros_1k + (out.outTokens / 1000) * model.out_micros_1k);

        await recordSuccess(db, def.backendId);
        await recordUsage(db, {
          lane, routeId: null, modelId: model.id, backendId: def.backendId,
          inTokens: out.inTokens, outTokens: out.outTokens, costMicros: cost, status: "ok",
          detail: `Bench run on ${workload.id}`,
        });

        const benchmarkId = newId("bmk");
        await db
          .prepare(
            `INSERT INTO model_benchmarks
               (id, ts, model_id, workload_id, quality_score, edit_burden, latency_ms, cost_micros, verdict, note)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            benchmarkId, Date.now(), model.id, workload.id,
            // QUALITY IS NOT MEASURED HERE AND IS NOT INVENTED HERE.
            0, 0, latency, cost, BENCH_VERDICT,
            `Harness run on ${def.providerName}. Latency and cost are measured; quality is UNSCORED and this row promotes nothing. ` +
              `Output (first 400 chars): ${out.text.slice(0, 400)}`,
          )
          .run();

        results.push(pair("ran", `completed in ${latency}ms for ${cost === 0 ? "$0.00 (free route)" : formatMicros(cost)}`, {
          latency_ms: latency, cost_micros: cost, benchmark_id: benchmarkId, free,
        }));
      } catch (err) {
        const message = err instanceof ProviderCallError || err instanceof Error ? err.message : String(err);
        await recordFailure(db, def.backendId, message);
        // A FAILED CALL PRODUCES NO BENCHMARK ROW. The failure is real evidence
        // and it belongs in the report, but a benchmark table that records
        // failures as results is a table the router would misread.
        results.push(pair("not_run", `the call failed: ${message.slice(0, 240)}`, { free }));
      }
    }
  }

  const ran = results.filter((r) => r.status === "ran").length;
  const report: BenchReport = {
    started_at: started,
    finished_at: Date.now(),
    lever_position: lever.position,
    lever_label: lever.label,
    examined: results.length,
    ran,
    not_run: results.length - ran,
    verdict_written: BENCH_VERDICT,
    results,
    note:
      ran === 0
        ? "Nothing ran. Every pair is recorded as NOT RUN with its reason; no benchmark row was written, because an empty bench refuses honestly and a fabricated one routes work on fiction."
        : `${ran} of ${results.length} pairs ran. Every row written is ${BENCH_VERDICT} with an unscored quality of 0: it is evidence that a real call happened, not a judgement that the model is good.`,
  };

  await logEvent(db, {
    level: ran === 0 ? "warn" : "info", scope: "bench", event: "bench_run", lane,
    detail: {
      lever: lever.position, examined: report.examined, ran, not_run: report.not_run,
      not_run_reasons: results.filter((r) => r.status === "not_run").map((r) => `${r.model_id}/${r.workload_id}: ${r.reason}`),
    },
  });

  return report;
}

async function loadBenchModels(db: D1Database, ids?: string[]): Promise<ModelRow[]> {
  const base =
    `SELECT m.id, m.slug, m.provider_id, m.display_name, m.in_micros_1k, m.out_micros_1k,
            m.enabled, m.privacy_class, m.capability_tier, m.benchmark_status,
            m.approved_task_kinds, m.forbidden_task_kinds, m.max_risk,
            p.base_url, p.api_key_var
       FROM models m JOIN providers p ON p.id = m.provider_id
      WHERE m.enabled = 1 AND p.enabled = 1`;
  if (ids && ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const res = await db.prepare(`${base} AND m.id IN (${placeholders})`).bind(...ids).all<ModelRow>();
    return res.results ?? [];
  }
  const res = await db.prepare(base).all<ModelRow>();
  return (res.results ?? []).filter((m) => WIRING_BY_PROVIDER.has(m.provider_id));
}

async function loadBenchWorkloads(
  db: D1Database,
  ids?: string[],
): Promise<{ id: string; intake_kind: string; name: string }[]> {
  const base = `SELECT id, intake_kind, name FROM workload_profiles`;
  if (ids && ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const res = await db.prepare(`${base} WHERE id IN (${placeholders})`).bind(...ids)
      .all<{ id: string; intake_kind: string; name: string }>();
    return res.results ?? [];
  }
  const res = await db.prepare(base).all<{ id: string; intake_kind: string; name: string }>();
  return res.results ?? [];
}
