import { riskAllows, type CostModePolicy } from "../../../shared/boss/governance";

/**
 * Model eligibility.
 *
 * Every rule here can refuse a model, and every refusal carries a reason that
 * ends up in `routing_decisions`. A router that silently picks the next model is
 * a router nobody can audit.
 */

export interface ModelRow {
  id: string;
  slug: string;
  provider_id: string;
  display_name: string;
  in_micros_1k: number;
  out_micros_1k: number;
  base_url: string;
  api_key_var: string;
  enabled: number;
  privacy_class: string;
  capability_tier: string;
  benchmark_status: string;
  approved_task_kinds: string | null;
  forbidden_task_kinds: string | null;
  max_risk: string;
}

export interface PolicyContext {
  policy: CostModePolicy;
  risk: string;
  sensitivity: string;
  intakeKind: string | null;
  /** Enforce "unbenchmarked models are not default execution models" for high risk. */
  requireBenchmarkHighRisk: boolean;
  /** Set by an approved sensitive-routing card. */
  cloudForRestrictedAllowed: boolean;
}

export interface Verdict {
  eligible: boolean;
  reason: string;
  /** True when a human could unblock this by approving a sensitive-routing card. */
  approvable?: boolean;
}

export function evaluateModel(model: ModelRow, ctx: PolicyContext): Verdict {
  if (!model.enabled) return { eligible: false, reason: "model disabled" };

  if (!ctx.policy.allowedTiers.includes(model.capability_tier as never)) {
    return {
      eligible: false,
      reason: `cost mode ${ctx.policy.id} does not allow ${model.capability_tier} models`,
    };
  }

  if (!riskAllows(model.max_risk, ctx.risk)) {
    return {
      eligible: false,
      reason: `model is cleared to ${model.max_risk} risk, task is ${ctx.risk}`,
    };
  }

  if (ctx.risk === "high" && ctx.requireBenchmarkHighRisk && model.benchmark_status !== "benchmarked") {
    return {
      eligible: false,
      reason: `model is ${model.benchmark_status} and this task is high risk`,
    };
  }

  if (ctx.intakeKind) {
    const forbidden = parseList(model.forbidden_task_kinds);
    if (forbidden.includes(ctx.intakeKind)) {
      return { eligible: false, reason: `model is forbidden for ${ctx.intakeKind} work` };
    }
    const approved = parseList(model.approved_task_kinds);
    if (approved.length && !approved.includes(ctx.intakeKind)) {
      return { eligible: false, reason: `model is not approved for ${ctx.intakeKind} work` };
    }
  }

  // Restricted content does not reach a public cloud model on its own authority.
  if (ctx.sensitivity === "restricted" && model.privacy_class === "cloud" && !ctx.cloudForRestrictedAllowed) {
    return {
      eligible: false,
      approvable: true,
      reason: "restricted content cannot go to a cloud model without an approved routing card",
    };
  }

  return { eligible: true, reason: "eligible" };
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Rough cost estimate used to refuse a call before it is made. */
export function estimateCostMicros(model: ModelRow, promptChars: number, maxOutputTokens: number): number {
  // ~4 characters per token is close enough to keep a task from blowing its
  // envelope; the ledger records the real usage the provider reports.
  const inTokens = Math.ceil(promptChars / 4);
  return Math.round((inTokens / 1000) * model.in_micros_1k + (maxOutputTokens / 1000) * model.out_micros_1k);
}

/**
 * A local model may not become a route default until it has been benchmarked on
 * enough real workloads (roadmap MR-3 asks for five).
 */
export const LOCAL_DEFAULT_MIN_BENCHMARKS = 5;

export async function localModelIsProven(db: D1Database, modelId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM model_benchmarks WHERE model_id = ? AND verdict = 'approved'`)
    .bind(modelId)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= LOCAL_DEFAULT_MIN_BENCHMARKS;
}
