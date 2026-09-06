import { newId } from "../lib/id";
import { costPolicy } from "../../../shared/boss/governance";
import type { Classification } from "./classify";

export interface Envelope {
  id: string;
  task_id: string;
  lane: string;
  employee_id: string | null;
  execution_assignment: string;
  cost_mode: string;
  budget_micros: number;
  allowed_models: string | null;
  data_sensitivity: string;
  external_action_allowed: number;
  external_send_allowed: number;
  repo_write_allowed: number;
  provider_mutation_allowed: number;
  financial_action_allowed: number;
  approval_required: number;
  evidence_required: number;
  rollback_required: number;
  cloud_for_restricted_allowed: number;
  expires_at: number | null;
  created_at: number;
}

/**
 * Builds the authority a single task run may exercise.
 *
 * Everything outward-facing defaults to denied. Nothing in this function can
 * grant external send, repo write, provider mutation, or financial action —
 * those stay false and are only ever exercised by an approved payload, which is
 * a separate decision made by a human in the Approval Inbox.
 */
export async function buildEnvelope(
  db: D1Database,
  args: {
    taskId: string;
    lane: string;
    employeeId: string | null;
    classification: Classification;
    costMode: string;
  },
): Promise<Envelope> {
  const policy = costPolicy(args.costMode);
  const now = Date.now();

  // A task may spend a share of what its lane has left, and never more than the
  // employee's own daily allowance if one is set.
  const laneRemaining = await remainingLaneBudget(db, args.lane);
  let budget = Math.max(0, Math.floor(laneRemaining * policy.taskBudgetShare));

  let employeeCap = 0;
  if (args.employeeId) {
    const emp = await db
      .prepare(`SELECT budget_micros_day, spent_micros_day FROM employees WHERE id = ?`)
      .bind(args.employeeId)
      .first<{ budget_micros_day: number; spent_micros_day: number }>();
    if (emp && emp.budget_micros_day > 0) {
      employeeCap = Math.max(0, emp.budget_micros_day - emp.spent_micros_day);
      budget = Math.min(budget, employeeCap);
    }
  }

  const assignment = args.classification.executionAssignment;
  const approvalRequired =
    assignment === "AI_EXECUTE_WITH_NOTICE" && args.classification.risk === "low" ? 0 : 1;

  const envelope: Envelope = {
    id: newId("env"),
    task_id: args.taskId,
    lane: args.lane,
    employee_id: args.employeeId,
    execution_assignment: assignment,
    cost_mode: args.costMode,
    budget_micros: budget,
    allowed_models: null,
    data_sensitivity: args.classification.sensitivity,
    external_action_allowed: 0,
    external_send_allowed: 0,
    repo_write_allowed: 0,
    provider_mutation_allowed: 0,
    financial_action_allowed: 0,
    approval_required: approvalRequired,
    evidence_required: 1,
    rollback_required: args.classification.risk === "high" ? 1 : 0,
    cloud_for_restricted_allowed: 0,
    expires_at: now + 24 * 60 * 60 * 1000,
    created_at: now,
  };

  await db
    .prepare(
      `INSERT INTO permission_envelopes
         (id, task_id, lane, employee_id, execution_assignment, cost_mode, budget_micros,
          allowed_models, data_sensitivity, external_action_allowed, external_send_allowed,
          repo_write_allowed, provider_mutation_allowed, financial_action_allowed,
          approval_required, evidence_required, rollback_required,
          cloud_for_restricted_allowed, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      envelope.id, envelope.task_id, envelope.lane, envelope.employee_id,
      envelope.execution_assignment, envelope.cost_mode, envelope.budget_micros,
      envelope.allowed_models, envelope.data_sensitivity, envelope.external_action_allowed,
      envelope.external_send_allowed, envelope.repo_write_allowed,
      envelope.provider_mutation_allowed, envelope.financial_action_allowed,
      envelope.approval_required, envelope.evidence_required, envelope.rollback_required,
      envelope.cloud_for_restricted_allowed, envelope.expires_at, envelope.created_at,
    )
    .run();

  return envelope;
}

export async function loadEnvelope(db: D1Database, id: string | null): Promise<Envelope | null> {
  if (!id) return null;
  return db.prepare(`SELECT * FROM permission_envelopes WHERE id = ?`).bind(id).first<Envelope>();
}

/** Smallest headroom across every hard-stopped budget row for the lane. */
export async function remainingLaneBudget(db: D1Database, lane: string): Promise<number> {
  const rows = await db
    .prepare(`SELECT limit_micros, spent_micros, hard_stop FROM budgets WHERE lane = ?`)
    .bind(lane)
    .all<{ limit_micros: number; spent_micros: number; hard_stop: number }>();
  const results = rows.results ?? [];
  if (!results.length) return 0;
  let remaining = Number.MAX_SAFE_INTEGER;
  for (const b of results) {
    remaining = Math.min(remaining, Math.max(0, b.limit_micros - b.spent_micros));
  }
  return remaining === Number.MAX_SAFE_INTEGER ? 0 : remaining;
}
