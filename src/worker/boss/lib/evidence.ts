import { newId } from "./id";

/**
 * Evidence packet.
 *
 * Field order follows the canonical schema in the Cost Governor addendum and the
 * Mobile-First addendum so a packet can be read against either document. A run
 * that produced no evidence is a run nobody can audit, so the queue consumer
 * writes one on every terminal outcome, success or failure.
 */
export interface EvidenceInput {
  taskId: string;
  lane: string;
  executionAssignment?: string | null;
  employeeId?: string | null;
  workerUsed: string;
  modelId?: string | null;
  costMode?: string | null;
  estimatedCostMicros?: number;
  actualCostMicros?: number;
  inputsUsed?: unknown;
  sourceMaterials?: unknown;
  actionsTaken?: unknown;
  artifactsCreated?: unknown;
  systemsTouched?: unknown;
  recordsChanged?: unknown;
  checksRun?: unknown;
  risksRemaining?: unknown;
  unknowns?: unknown;
  approvalNeeded?: boolean;
  approvalId?: string | null;
  rollbackAvailable?: boolean;
  nextHumanAction?: string | null;
  finalStatus: string;
}

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function writeEvidence(db: D1Database, input: EvidenceInput): Promise<string> {
  const id = newId("evd");
  await db
    .prepare(
      `INSERT INTO evidence_packets
         (id, task_id, lane, ts, execution_assignment, employee_id, worker_used, model_id,
          cost_mode, estimated_cost_micros, actual_cost_micros, inputs_used, source_materials,
          actions_taken, artifacts_created, systems_touched, records_changed, checks_run,
          risks_remaining, unknowns, approval_needed, approval_id, rollback_available,
          next_human_action, final_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, input.taskId, input.lane, Date.now(),
      input.executionAssignment ?? null, input.employeeId ?? null,
      input.workerUsed, input.modelId ?? null, input.costMode ?? null,
      input.estimatedCostMicros ?? 0, input.actualCostMicros ?? 0,
      j(input.inputsUsed), j(input.sourceMaterials), j(input.actionsTaken),
      j(input.artifactsCreated), j(input.systemsTouched), j(input.recordsChanged),
      j(input.checksRun), j(input.risksRemaining), j(input.unknowns),
      input.approvalNeeded ? 1 : 0, input.approvalId ?? null,
      input.rollbackAvailable ? 1 : 0, input.nextHumanAction ?? null,
      input.finalStatus,
    )
    .run();
  return id;
}
