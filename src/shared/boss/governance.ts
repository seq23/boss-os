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

/* ─────────────────────────────────────────────────────────────────────────────
 * THE TWO AXES, AND WHY THEY ARE TWO.
 *
 * `Sensitivity` above is ONE LINE with four points on it, and two different questions were being
 * read off that line at once:
 *
 *   · WHO MAY RECEIVE THE OUTPUT      — `public` and `internal` answer this
 *   · WHICH MODELS MAY SEE THE INPUT  — `private` and `restricted` answer this
 *
 * A single scale forces them to move together, and the failure that produces is not theoretical:
 * in the sibling repo "internal", which only ever meant the recipient is a partner, was read as
 * "too sensitive to train on". Hiring searches, event kits, room packets and workshop material —
 * none of it private — were barred from every free lane and every run landed on the most expensive
 * model on the account. The owner, seeing it:
 *
 *   "ITS NOT DEAL TERMS OR LP INFORMATION SO IT DOESNT MATTER IF ITS USING THIS DATA TO TRAIN.
 *    WHO CARES ABOUT HIRING SEARCH AND EVENT KITS AND ROOM KITS. THEY ARE NOT PRIVATE INFO."
 *
 *   "WE NEED TO CLASSIFY ON EACH WORK CARD GOING FORWARD — CONFIDENTIAL VS NOT, AND INTERNAL VS
 *    EXTERNAL, SO THERE IS NO CONFUSION. MOST WORK IS INTERNAL AND NOT-CONFIDENTIAL SO CAN USE
 *    FREE TRAINING MODELS WITH REASONING AND CLOSE TO $0."
 *
 * So there are two axes, each with its own default, and NEITHER IS DERIVED FROM THE OTHER. Both
 * off-diagonal corners are real work this firm actually does:
 *
 *   private_model_only  + internal   an LP memo for Sequoia
 *   public_model_approved + external an event kit sent to a guest
 *
 * ─── AND THE WORDING IS HERS, DELIBERATELY ──────────────────────────────────────────────────────
 *
 *   "I'D ALSO LIKE TO CHANGE THE TERMINOLOGY FROM CONFIDENTIAL / NOT — MAYBE JUST LABEL IT
 *    PUBLIC MODEL APPROVED / PRIVATE MODEL ONLY"
 *
 * "Confidential" asks the reader how secret something FEELS. That is a judgement, it has no
 * falsifiable answer, and under uncertainty it pulls every reader toward the cautious-looking box —
 * which is the exact mechanism that produced the sibling's bill. `public_model_approved` names the
 * CONSEQUENCE instead, so the question a person answers is "where may this go", which is a
 * question about routes and has a right answer.
 *
 * THE STORED VALUE IS THE DISPLAYED WORDING. Persisting `confidential` and rendering "Private model
 * only" would put the removed vocabulary straight back into the database for the next reader to
 * find, so there is one spelling and `MODEL_ACCESS_LABEL` is only a capitalisation of it.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/** WHICH MODELS MAY SEE THE INPUT. The only axis that governs routing. */
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
    "Must stay on a route whose terms forbid training. LP names, deal terms, fund figures, diligence material.",
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

/**
 * THE ONE PLACE THE LEGACY SCALE TOUCHES THE NEW ONE, AND IT ONLY EVER TIGHTENS.
 *
 * `restricted` on the old scale did mean "do not send this out", and rows carrying it predate the
 * split, so it must not be silently downgraded. Every other value — `public`, `internal`, `private`
 * — says nothing whatsoever about training and therefore contributes NOTHING here: it returns the
 * default, and a caller's explicit `model_access` still wins over that.
 *
 * READ THE DIRECTION. This maps sensitivity → model access and there is deliberately no function
 * going the other way. `internal` cannot reach in and make something private-model-only, which is
 * the whole defect being removed.
 */
export function modelAccessFromLegacySensitivity(sensitivity: string | null | undefined): ModelAccess {
  return sensitivity === "restricted" ? "private_model_only" : DEFAULT_MODEL_ACCESS;
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
