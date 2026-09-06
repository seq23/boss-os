import type {
  CostMode, ExecutionAssignment, IntakeKind, PrivacyClass, CapabilityTier, Sensitivity,
} from "./governance";

export type LaneId = "ops" | "trading";

export type ApprovalStatus =
  | "pending" | "approved" | "rejected" | "deferred" | "expired";

/**
 * Approval kinds. Each one has an executor in `server/approvals/execute.ts`;
 * adding a kind here without adding an executor there means approving it will
 * record the decision and do nothing, which is the exact failure Phase 1 fixed.
 */
export type ApprovalKind =
  | "task_output"
  | "spend"
  | "memory_promotion"
  | "trade"
  | "model_route"
  | "agent_creation"
  | "manual";

export type Risk = "low" | "medium" | "high";
export type ExecutionStatus = "executed" | "failed" | "not_applicable" | "reverted";

export interface Approval {
  id: string;
  lane: LaneId;
  title: string;
  summary: string | null;
  kind: ApprovalKind;
  origin_type: string | null;
  origin_id: string | null;
  risk: Risk;
  payload: string | null;
  status: ApprovalStatus;
  requested_at: number;
  expires_at: number | null;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
  executed_at: number | null;
  execution_status: ExecutionStatus | null;
  execution_detail: string | null;
}

export interface ApprovalEvent {
  id: string;
  approval_id: string;
  ts: number;
  event: string;
  detail: string | null;
}

export type EmployeeLifecycle =
  | "proposed" | "provisional" | "active" | "under_review" | "merged" | "retired" | "suspended";

export interface Employee {
  id: string;
  lane: LaneId;
  name: string;
  role: string;
  charter: string | null;
  route_id: string | null;
  autonomy: "ask" | "notify" | "auto";
  status: "active" | "paused" | "retired";
  created_at: number;
  department: string | null;
  lifecycle: EmployeeLifecycle;
  risk_level: Risk;
  budget_micros_day: number;
  spent_micros_day: number;
  review_at: number | null;
  merged_into: string | null;
}

export type TaskStatus =
  | "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  lane: LaneId;
  employee_id: string | null;
  title: string;
  input: string | null;
  output: string | null;
  status: TaskStatus;
  approval_id: string | null;
  cost_micros: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  intake_kind: IntakeKind | null;
  template_id: string | null;
  envelope_id: string | null;
  execution_assignment: ExecutionAssignment | null;
  risk: Risk;
  sensitivity: Sensitivity;
  cost_mode: CostMode | null;
  attempts: number;
}

export interface EvidencePacket {
  id: string;
  task_id: string;
  lane: LaneId;
  ts: number;
  worker_used: string;
  model_id: string | null;
  cost_mode: CostMode | null;
  actual_cost_micros: number;
  actions_taken: string | null;
  checks_run: string | null;
  risks_remaining: string | null;
  unknowns: string | null;
  approval_needed: number;
  approval_id: string | null;
  rollback_available: number;
  next_human_action: string | null;
  final_status: string;
}

export type RoutingOutcome =
  | "routed" | "fallback" | "blocked_budget" | "blocked_policy"
  | "blocked_no_model" | "provider_failed" | "ask_human";

export interface RoutingDecision {
  id: string;
  ts: number;
  lane: LaneId;
  task_id: string | null;
  chosen_model_id: string | null;
  outcome: RoutingOutcome;
  reason: string;
  candidates: string | null;
}

export interface ModelRecord {
  id: string;
  provider_id: string;
  slug: string;
  display_name: string;
  in_micros_1k: number;
  out_micros_1k: number;
  context_tokens: number | null;
  enabled: number;
  privacy_class: PrivacyClass;
  capability_tier: CapabilityTier;
  benchmark_status: "unbenchmarked" | "benchmarked" | "failed";
  max_risk: Risk;
}

export type MemoryTier = "capture" | "working" | "canon";

export interface MemoryItem {
  id: string;
  lane: LaneId;
  tier: MemoryTier;
  title: string;
  body: string;
  confidence: number;
  hits: number;
  created_at: number;
  promoted_at: number | null;
  status: "active" | "archived" | "rejected";
  last_hit_at: number | null;
}

export interface VaultEntry {
  id: string;
  lane: LaneId;
  key: string;
  kind: string;
  bytes: number;
  sha256: string;
  note: string | null;
  created_at: number;
}

export interface VaultSnapshot {
  id: string;
  ts: number;
  label: string;
  bytes: number;
  sha256: string | null;
  status: "pending" | "complete" | "failed";
  table_counts: string | null;
}

export interface VaultRestore {
  id: string;
  ts: number;
  source: string;
  mode: "verify" | "merge" | "replace";
  declared_sha: string | null;
  computed_sha: string | null;
  status: "verified" | "applied" | "failed";
  error: string | null;
}

export type TradingStage =
  | "research" | "backtest" | "paper" | "micro_live_1" | "micro_live_2"
  | "small_live" | "production_candidate" | "retired";

export interface TradingStrategy {
  id: string;
  name: string;
  thesis: string;
  market: string;
  timeframe: string;
  risk_controls: string;
  intake_complete: number;
  backtest_note: string | null;
  stage: TradingStage;
  status: "active" | "retired" | "cemetery";
  created_at: number;
}

export interface TradingOrder {
  id: string;
  ts: number;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  order_type: string;
  limit_price: number | null;
  ref_price: number | null;
  notional_micros: number;
  mode: "paper" | "live";
  status: "draft" | "awaiting_approval" | "sent" | "filled" | "rejected" | "cancelled";
  approval_id: string | null;
  filled_qty: number;
  avg_price: number | null;
  error: string | null;
}

export interface TradingFill {
  id: string;
  ts: number;
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  mode: "paper" | "live";
  /** 1 means no real money moved. Paper fills are always 1. */
  simulated: number;
}

export interface TradingPosition {
  id: string;
  symbol: string;
  qty: number;
  avg_cost: number;
  realized_micros: number;
  closed_at: number | null;
}

export interface Budget {
  id: string;
  lane: LaneId;
  period: "day" | "month";
  limit_micros: number;
  spent_micros: number;
  window_started_at: number;
  hard_stop: number;
}

export interface DeadLetter {
  id: string;
  ts: number;
  queue: string;
  task_id: string | null;
  attempts: number;
  error: string | null;
  status: "open" | "requeued" | "dismissed";
}

export interface SystemStatus {
  version: string;
  phase: string;
  now: number;
  lanes: { id: LaneId; name: string; isolated: number }[];
  counts: Record<string, number>;
  budgets: Budget[];
  cost_mode: CostMode;
}

/** USD micros -> "$1.23" */
export function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}
