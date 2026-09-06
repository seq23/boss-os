import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { getBool, getSetting } from "../lib/settings";
import { costPolicy } from "../../../shared/boss/governance";
import { fireworks } from "./fireworks";
import type { ChatMessage, ProviderAdapter } from "./types";
import { evaluateModel, estimateCostMicros, type ModelRow } from "./policy";
import { rollBudgetWindows, laneBudgetState, employeeBudgetState } from "./budget";

const ADAPTERS: Record<string, ProviderAdapter> = {
  prv_fireworks: fireworks,
};

export class BudgetExceeded extends Error {
  constructor(public lane: string, public period: string) {
    super(`The ${lane} lane has spent its ${period} budget`);
  }
}

/**
 * The router refused to run. `approvable` means a human could unblock it by
 * approving a sensitive-routing card rather than by changing configuration.
 */
export class RoutingBlocked extends Error {
  constructor(
    message: string,
    public outcome: string,
    public hint: string,
    public approvable = false,
  ) {
    super(message);
  }
}

/**
 * Every eligible model was actually called and every call failed.
 *
 * Distinct from RoutingBlocked on purpose: a provider outage deserves a queue
 * retry, whereas a policy refusal will fail identically forever and must not be
 * retried. Collapsing the two would either burn retries on a misconfiguration or
 * drop work that a retry would have completed.
 */
export class ProviderFailure extends Error {
  constructor(message: string, public hint: string) {
    super(message);
  }
}

interface RouteRow {
  route_id: string;
  max_output_tokens: number;
  temperature: number;
  primary_model_id: string;
  fallback_model_id: string | null;
}

export interface RouteRequest {
  routeId: string;
  lane: string;
  messages: ChatMessage[];
  taskId?: string | null;
  employeeId?: string | null;
  intakeKind?: string | null;
  risk?: string;
  sensitivity?: string;
  costMode?: string | null;
  /** Hard ceiling from the task's permission envelope. 0 means lane budget only. */
  budgetMicros?: number;
  cloudForRestrictedAllowed?: boolean;
}

export interface RouteResult {
  text: string;
  costMicros: number;
  modelId: string;
  modelName: string;
  usedFallback: boolean;
  decisionId: string;
}

async function loadModel(db: D1Database, modelId: string): Promise<ModelRow | null> {
  return db
    .prepare(
      `SELECT m.id, m.slug, m.provider_id, m.display_name, m.in_micros_1k, m.out_micros_1k,
              m.enabled, m.privacy_class, m.capability_tier, m.benchmark_status,
              m.approved_task_kinds, m.forbidden_task_kinds, m.max_risk,
              p.base_url, p.api_key_var
         FROM models m JOIN providers p ON p.id = m.provider_id
        WHERE m.id = ? AND p.enabled = 1`,
    )
    .bind(modelId)
    .first<ModelRow>();
}

async function recordDecision(
  db: D1Database,
  row: {
    lane: string; taskId?: string | null; employeeId?: string | null; intakeKind?: string | null;
    risk?: string | null; sensitivity?: string | null; costMode?: string | null;
    routeId?: string | null; chosenModelId?: string | null; outcome: string; reason: string;
    candidates: unknown;
  },
): Promise<string> {
  const id = newId("rtd");
  await db
    .prepare(
      `INSERT INTO routing_decisions
         (id, ts, lane, task_id, employee_id, intake_kind, risk, sensitivity, cost_mode,
          route_id, chosen_model_id, outcome, reason, candidates)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, Date.now(), row.lane, row.taskId ?? null, row.employeeId ?? null,
      row.intakeKind ?? null, row.risk ?? null, row.sensitivity ?? null, row.costMode ?? null,
      row.routeId ?? null, row.chosenModelId ?? null, row.outcome, row.reason,
      JSON.stringify(row.candidates),
    )
    .run();
  return id;
}

async function recordUsage(
  db: D1Database,
  row: {
    lane: string; routeId: string | null; modelId: string | null; employeeId?: string | null;
    taskId?: string | null; inTokens: number; outTokens: number; costMicros: number;
    status: string; detail?: string | null;
  },
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, route_id, model_id, employee_id, task_id,
                                   in_tokens, out_tokens, cost_micros, status, detail)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        newId("usg"), Date.now(), row.lane, row.routeId, row.modelId,
        row.employeeId ?? null, row.taskId ?? null, row.inTokens, row.outTokens,
        row.costMicros, row.status, row.detail ?? null,
      ),
  ];

  // Only real spend moves a budget. A blocked or errored call costs nothing and
  // must not eat the day's allowance.
  if (row.costMicros > 0) {
    statements.push(
      db.prepare(`UPDATE budgets SET spent_micros = spent_micros + ? WHERE lane = ?`).bind(row.costMicros, row.lane),
    );
    if (row.employeeId) {
      statements.push(
        db
          .prepare(`UPDATE employees SET spent_micros_day = spent_micros_day + ? WHERE id = ?`)
          .bind(row.costMicros, row.employeeId),
      );
    }
  }

  await db.batch(statements);
}

/**
 * Route a completion.
 *
 * Order matters: budget windows roll first so a stale window cannot block work,
 * then hard stops, then cost mode, then per-model policy. Every exit — including
 * every refusal — writes a `routing_decisions` row.
 */
export async function routeCompletion(env: Env, opts: RouteRequest): Promise<RouteResult> {
  const db = env.DB;
  await rollBudgetWindows(db);

  const risk = opts.risk ?? "low";
  const sensitivity = opts.sensitivity ?? "private";
  const costMode = opts.costMode ?? (await getSetting(db, "cost_mode")) ?? "NORMAL";
  const policy = costPolicy(costMode);
  const base = {
    lane: opts.lane, taskId: opts.taskId, employeeId: opts.employeeId,
    intakeKind: opts.intakeKind, risk, sensitivity, costMode, routeId: opts.routeId,
  };

  if (!policy.autonomousSpendAllowed) {
    await recordDecision(db, {
      ...base, outcome: "blocked_policy",
      reason: `Cost mode ${policy.id} stops autonomous spend`,
      candidates: [],
    });
    throw new RoutingBlocked(
      `Cost mode is ${policy.label}, so nothing runs on its own`,
      "blocked_policy",
      "Change the cost mode in Settings to let queued work run.",
    );
  }

  const laneBudget = await laneBudgetState(db, opts.lane);
  if (laneBudget.blocked) {
    await recordDecision(db, {
      ...base, outcome: "blocked_budget",
      reason: `Lane ${opts.lane} is at its ${laneBudget.blockedPeriod} limit`,
      candidates: [],
    });
    throw new BudgetExceeded(opts.lane, laneBudget.blockedPeriod ?? "day");
  }

  const empBudget = await employeeBudgetState(db, opts.employeeId);
  if (empBudget.blocked) {
    await recordDecision(db, {
      ...base, outcome: "blocked_budget",
      reason: "Employee has spent its daily allowance",
      candidates: [],
    });
    throw new RoutingBlocked(
      "This employee has spent its daily allowance",
      "blocked_budget",
      "Raise the employee's daily budget in Team, or wait for the window to roll at 00:00 UTC.",
    );
  }

  const route = await db
    .prepare(
      `SELECT id AS route_id, max_output_tokens, temperature, primary_model_id, fallback_model_id
         FROM routes WHERE id = ? AND lane = ?`,
    )
    .bind(opts.routeId, opts.lane)
    .first<RouteRow>();
  if (!route) {
    await recordDecision(db, {
      ...base, outcome: "blocked_no_model",
      reason: `Route ${opts.routeId} is not defined for the ${opts.lane} lane`,
      candidates: [],
    });
    throw new RoutingBlocked(
      `Route ${opts.routeId} is not defined for the ${opts.lane} lane`,
      "blocked_no_model",
      "Check the routes table, or point the employee at a route that exists.",
    );
  }

  const requireBenchmarkHighRisk = await getBool(db, "require_benchmark_high_risk", true);
  const ctx = {
    policy, risk, sensitivity,
    intakeKind: opts.intakeKind ?? null,
    requireBenchmarkHighRisk,
    cloudForRestrictedAllowed: opts.cloudForRestrictedAllowed ?? false,
  };

  const ceiling = opts.budgetMicros && opts.budgetMicros > 0
    ? Math.min(opts.budgetMicros, laneBudget.remainingMicros)
    : laneBudget.remainingMicros;
  const promptChars = opts.messages.reduce((n, m) => n + m.content.length, 0);

  const ordered = [route.primary_model_id, route.fallback_model_id].filter(Boolean) as string[];
  const considered: { model_id: string; verdict: string; reason: string }[] = [];
  let approvable = false;
  let lastError: Error | null = null;
  let attemptedCall = false;
  // The hop limit caps how many provider calls a run may make. It deliberately
  // does not cap how many models are screened: in a cheap cost mode the eligible
  // model is often the second one on the route, and refusing to look at it would
  // block work the mode was meant to allow.
  let calls = 0;

  for (const modelId of ordered) {
    const model = await loadModel(db, modelId);
    if (!model) {
      considered.push({ model_id: modelId, verdict: "skipped", reason: "model or provider is disabled or missing" });
      continue;
    }

    const verdict = evaluateModel(model, ctx);
    if (!verdict.eligible) {
      considered.push({ model_id: modelId, verdict: "rejected", reason: verdict.reason });
      if (verdict.approvable) approvable = true;
      continue;
    }

    const estimate = estimateCostMicros(model, promptChars, route.max_output_tokens);
    if (ceiling > 0 && estimate > ceiling) {
      considered.push({
        model_id: modelId, verdict: "rejected",
        reason: `estimated ${estimate} micros exceeds the ${ceiling} micros left for this task`,
      });
      continue;
    }

    const apiKey = (env as unknown as Record<string, string | undefined>)[model.api_key_var];
    if (!apiKey) {
      considered.push({ model_id: modelId, verdict: "skipped", reason: `${model.api_key_var} is not set` });
      lastError = new Error(`${model.api_key_var} is not set`);
      continue;
    }

    const adapter = ADAPTERS[model.provider_id];
    if (!adapter) {
      considered.push({ model_id: modelId, verdict: "skipped", reason: `no adapter for ${model.provider_id}` });
      continue;
    }

    if (calls > policy.maxFallbackHops) {
      considered.push({
        model_id: modelId, verdict: "skipped",
        reason: `cost mode ${policy.id} allows ${policy.maxFallbackHops} fallback hop(s), already used`,
      });
      break;
    }

    calls++;
    attemptedCall = true;
    try {
      const result = await adapter.complete(
        {
          modelSlug: model.slug,
          messages: opts.messages,
          maxOutputTokens: route.max_output_tokens,
          temperature: route.temperature,
        },
        apiKey,
        model.base_url,
      );

      const costMicros = Math.round(
        (result.inTokens / 1000) * model.in_micros_1k + (result.outTokens / 1000) * model.out_micros_1k,
      );
      await recordUsage(db, {
        lane: opts.lane, routeId: route.route_id, modelId: model.id,
        employeeId: opts.employeeId, taskId: opts.taskId,
        inTokens: result.inTokens, outTokens: result.outTokens, costMicros, status: "ok",
      });

      considered.push({ model_id: modelId, verdict: "used", reason: "completed" });
      const isPrimary = modelId === route.primary_model_id;
      const decisionId = await recordDecision(db, {
        ...base, chosenModelId: model.id,
        outcome: isPrimary ? "routed" : "fallback",
        reason: isPrimary ? "primary model accepted the work" : "primary was unavailable or ineligible",
        candidates: considered,
      });

      return {
        text: result.text, costMicros, modelId: model.id, modelName: model.display_name,
        usedFallback: !isPrimary, decisionId,
      };
    } catch (err) {
      lastError = err as Error;
      considered.push({ model_id: modelId, verdict: "failed", reason: (err as Error).message.slice(0, 300) });
      await recordUsage(db, {
        lane: opts.lane, routeId: route.route_id, modelId: model.id,
        employeeId: opts.employeeId, taskId: opts.taskId,
        inTokens: 0, outTokens: 0, costMicros: 0, status: "error",
        detail: (err as Error).message.slice(0, 500),
      });
      await logEvent(db, {
        level: "warn", scope: "router", event: "model_call_failed", lane: opts.lane,
        entityId: opts.taskId ?? null, detail: { model_id: model.id, message: (err as Error).message },
      });
    }
  }

  const outcome = approvable ? "ask_human" : attemptedCall ? "provider_failed" : "blocked_no_model";
  await recordDecision(db, {
    ...base, outcome,
    reason: lastError ? lastError.message.slice(0, 300) : "no model on this route satisfied policy",
    candidates: considered,
  });

  if (approvable) {
    throw new RoutingBlocked(
      "This task holds restricted content and no private model is available",
      "ask_human",
      "Approve the routing card to let it run on a cloud model once, or register a local model.",
      true,
    );
  }

  // A model was eligible and the call itself failed: worth retrying.
  if (attemptedCall && lastError) {
    throw new ProviderFailure(
      `Every model on this route failed: ${lastError.message}`,
      "The provider may be down. The queue will retry; check Diagnostics if it keeps failing.",
    );
  }

  throw new RoutingBlocked(
    lastError ? `No model could run this: ${lastError.message}` : "No model on this route satisfied policy",
    "blocked_no_model",
    "Check the routing decision for why each model was refused.",
  );
}
