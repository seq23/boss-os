/**
 * Governance vocabulary shared by the Worker and the SPA.
 *
 * These lists are closed on purpose. Task intake must classify every request as
 * one of the canonical kinds, and the Personal AI Workforce law says every task
 * gets an execution assignment — neither is a free-text field.
 */

export const INTAKE_KINDS = [
  "one_off",
  "recurring_duty",
  "scheduled_check",
  "triggered_workflow",
  "approval_request",
  "research",
  "drafting",
  "coaching",
  "memory_promotion",
  "relationship",
  "decision_support",
  "repository",
  "model_benchmark",
  "trading",
  "west_peek_bridge",
  "new_agent_proposal",
] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

export function isIntakeKind(v: unknown): v is IntakeKind {
  return typeof v === "string" && (INTAKE_KINDS as readonly string[]).includes(v);
}

/** Boss OS must not assume the Boss is the default executor. */
export const EXECUTION_ASSIGNMENTS = [
  "USER_ONLY",
  "AI_DRAFT",
  "AI_EXECUTE_WITH_APPROVAL",
  "AI_EXECUTE_WITH_NOTICE",
  "HUMAN_CONTRACTOR",
  "DEFER",
  "DELETE",
] as const;
export type ExecutionAssignment = (typeof EXECUTION_ASSIGNMENTS)[number];

export const COST_MODES = [
  "SHUTDOWN_MANUAL",
  "EMERGENCY_LOW_COST",
  "NORMAL",
  "HIGH_PERFORMANCE",
  "FRONTIER_BURST",
  "DELEGATION_SPRINT",
] as const;
export type CostMode = (typeof COST_MODES)[number];

export type CapabilityTier = "fast" | "general" | "frontier";
export type PrivacyClass = "local" | "private_cloud" | "cloud";
export type RiskLevel = "low" | "medium" | "high";
export type Sensitivity = "public" | "internal" | "private" | "restricted";

/** Labels retained so historical work cards can still be read. */
export const MODEL_ACCESSES = ["public_model_approved", "private_model_only"] as const;
export type ModelAccess = (typeof MODEL_ACCESSES)[number];

/** Most work. The default, and it is a default because most work really is this. */
export const DEFAULT_MODEL_ACCESS: ModelAccess = "public_model_approved";

export const MODEL_ACCESS_LABEL: Record<ModelAccess, string> = {
  public_model_approved: "Public model approved",
  private_model_only: "Private model only",
};

export const MODEL_ACCESS_NOTE: Record<ModelAccess, string> = {
  public_model_approved:
    "May go to any capable model, including free reasoning lanes whose terms permit training on prompts.",
  private_model_only:
    "Historical routing label. Current Boss OS runs use capability and spending settings.",
};

export function isModelAccess(v: unknown): v is ModelAccess {
  return typeof v === "string" && (MODEL_ACCESSES as readonly string[]).includes(v);
}

/** WHO MAY RECEIVE THE OUTPUT. Governs approval, never routing. */
export const AUDIENCES = ["internal", "external"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const DEFAULT_AUDIENCE: Audience = "internal";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  internal: "Internal",
  external: "External",
};

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

export interface CostModePolicy {
  id: CostMode;
  label: string;
  /** Capability tiers a model may have to be eligible in this mode. */
  allowedTiers: CapabilityTier[];
  /** How many times the router may try another model after a failure. */
  maxFallbackHops: number;
  /** SHUTDOWN_MANUAL stops autonomous spend outright. */
  autonomousSpendAllowed: boolean;
  /** Share of the remaining lane budget a single task may consume. */
  taskBudgetShare: number;
  note: string;
}

export const COST_MODE_POLICY: Record<CostMode, CostModePolicy> = {
  SHUTDOWN_MANUAL: {
    id: "SHUTDOWN_MANUAL",
    label: "Shutdown",
    allowedTiers: [],
    maxFallbackHops: 0,
    autonomousSpendAllowed: false,
    taskBudgetShare: 0,
    note: "No agent spend. Work queues but does not run until you change the mode.",
  },
  EMERGENCY_LOW_COST: {
    id: "EMERGENCY_LOW_COST",
    label: "Low cost",
    allowedTiers: ["fast"],
    maxFallbackHops: 0,
    autonomousSpendAllowed: true,
    taskBudgetShare: 0.05,
    note: "Cheapest acceptable model only. No frontier calls.",
  },
  NORMAL: {
    id: "NORMAL",
    label: "Normal",
    allowedTiers: ["fast", "general"],
    /*
     * RAISED FROM 1 TO 3 BY MIGRATION 0256, and this is the line that makes the ladder real.
     *
     * The paid half of the ladder is six rungs, cheapest first — $0.10/$0.40 up to $2.00/$10.00.
     * At one hop a run could try exactly ONE of them and then stop, so five registered, priced,
     * probed lanes could never be reached on any single run however hard the earlier ones failed.
     * Thirteen lanes under a limit of one is decoration.
     *
     * IT BOUNDS SPEND, NOT ATTEMPTS, which is why three is safe. The hop counter only increments
     * for a route that is actually billed, and every rung is screened against the per-run cap
     * ($0.75), the lane budget, the $5.00 OpenRouter sub-cap and the month line before it is
     * called — so three hops cannot cost more than one hop was already allowed to. What it buys is
     * the ability to fall PAST a cheap lane that is down to the next cheap lane, instead of
     * stopping at the first outage. Three is the depth at which a run reaches the third-cheapest
     * paid rung; going deeper trades latency for lanes the breaker has usually removed anyway.
     */
    maxFallbackHops: 3,
    autonomousSpendAllowed: true,
    taskBudgetShare: 0.15,
    note: "Balanced default.",
  },
  HIGH_PERFORMANCE: {
    id: "HIGH_PERFORMANCE",
    label: "High performance",
    allowedTiers: ["fast", "general", "frontier"],
    maxFallbackHops: 2,
    autonomousSpendAllowed: true,
    taskBudgetShare: 0.3,
    note: "Stronger models and deeper review for work that matters.",
  },
  FRONTIER_BURST: {
    id: "FRONTIER_BURST",
    label: "Frontier burst",
    allowedTiers: ["general", "frontier"],
    maxFallbackHops: 2,
    autonomousSpendAllowed: true,
    taskBudgetShare: 0.5,
    note: "Best available models for a short, deliberate push.",
  },
  DELEGATION_SPRINT: {
    id: "DELEGATION_SPRINT",
    label: "Delegation sprint",
    allowedTiers: ["fast", "general"],
    maxFallbackHops: 1,
    autonomousSpendAllowed: true,
    taskBudgetShare: 0.1,
    note: "Move many tasks off the Boss quickly, inside the budget.",
  },
};

export function isCostMode(v: unknown): v is CostMode {
  return typeof v === "string" && (COST_MODES as readonly string[]).includes(v);
}

export function costPolicy(mode: string | null | undefined): CostModePolicy {
  return isCostMode(mode) ? COST_MODE_POLICY[mode] : COST_MODE_POLICY.NORMAL;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/** True when `have` is at least as permissive as `need`. */
export function riskAllows(have: string, need: string): boolean {
  const h = RISK_ORDER[have as RiskLevel];
  const n = RISK_ORDER[need as RiskLevel];
  if (h === undefined || n === undefined) return false;
  return h >= n;
}

export const LIVE_TRADING_GATES = [
  "human_approval_recorded",
  "exchange_security_ok",
  "withdrawals_disabled",
  "monitoring_ok",
  "incident_runbook_ok",
  "ledger_export_tested",
] as const;
export type LiveTradingGate = (typeof LIVE_TRADING_GATES)[number];

export const LIVE_GATE_LABELS: Record<LiveTradingGate, string> = {
  human_approval_recorded: "Explicit human approval recorded",
  exchange_security_ok: "Exchange MFA and withdrawal protections active",
  withdrawals_disabled: "API key is trading-only, withdrawals disabled",
  monitoring_ok: "A critical alert was received successfully",
  incident_runbook_ok: "Incident runbook written",
  ledger_export_tested: "Trade export path tested",
};
