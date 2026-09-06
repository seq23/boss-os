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
    maxFallbackHops: 1,
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
