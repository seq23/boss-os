/**
 * Shared runtime scaffolding — canon §78.15.
 *
 * A runtime run is governed work, not a function call: it is classified through
 * intake, given a permission envelope, resolved to a capability in the Phase 18
 * registry, and it writes an evidence packet on every terminal outcome. That is
 * the whole reason both runtimes go through here rather than each doing it
 * their own way.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { badRequest, conflict } from "../lib/http";
import { writeEvidence } from "../lib/evidence";
import { logEvent } from "../lib/log";
import { classify } from "../intake/classify";
import { buildEnvelope } from "../intake/envelope";
import { getSetting } from "../lib/settings";

export const NO_NETWORK = "DEFERRED — NO NETWORK ACCESS";

export interface RuntimeCapability {
  id: string;
  key: string;
  name: string;
  status: string;
  job_type: string;
}

/**
 * Resolves the capability a runtime executes as, and refuses to run one that
 * has been retired. A benched capability may still be invoked deliberately —
 * benched means "not the default", not "unavailable" — and the job records
 * which it was.
 */
export async function resolveRuntimeCapability(db: D1Database, key: string): Promise<RuntimeCapability> {
  const cap = await db
    .prepare(`SELECT id, key, name, status, job_type FROM capabilities WHERE key = ?`)
    .bind(key)
    .first<RuntimeCapability>();
  if (!cap) throw badRequest(`No capability registered as ${key}`, "The runtime executes as a registered capability.");
  if (cap.status === "retired") {
    throw conflict(`${cap.name} is retired`, "A retired capability does not run. Promote a replacement or reinstate it.");
  }
  return cap;
}

/**
 * Opens the governed task a run happens inside.
 *
 * It goes through the same classifier and envelope builder intake uses, because
 * a runtime that created tasks by hand would be a second door into execution
 * with none of the governance on it.
 */
export async function openRuntimeTask(
  env: Env,
  args: { title: string; kind: string; lane?: string; input: unknown },
): Promise<{ taskId: string; classification: ReturnType<typeof classify>; costMode: string }> {
  const lane = args.lane ?? "ops";
  const classification = classify({
    title: args.title,
    prompt: typeof args.input === "string" ? args.input : JSON.stringify(args.input).slice(0, 2000),
    lane,
    intakeKind: args.kind,
  });

  const taskId = newId("tsk");
  const now = Date.now();
  const costMode = (await getSetting(env.DB, "cost_mode")) ?? "NORMAL";

  await env.DB
    .prepare(
      `INSERT INTO tasks (id, lane, title, input, status, created_at, started_at, intake_kind,
                          execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,'running',?,?,?,?,?,?,?)`,
    )
    .bind(
      taskId, lane, args.title, JSON.stringify(args.input), now, now,
      classification.intakeKind, classification.executionAssignment,
      classification.risk, classification.sensitivity, costMode,
    )
    .run();

  const envelope = await buildEnvelope(env.DB, { taskId, lane, employeeId: null, classification, costMode });
  await env.DB.prepare(`UPDATE tasks SET envelope_id = ? WHERE id = ?`).bind(envelope.id, taskId).run();

  return { taskId, classification, costMode };
}

export interface RuntimeOutcome {
  jobId: string;
  taskId: string;
  evidenceId: string;
  status: "complete" | "failed";
}

/**
 * Closes a run: finishes the task, writes the evidence packet, and stamps the
 * job. A run that produced no evidence is a run nobody can audit, which is the
 * rule the queue consumer already follows.
 */
export async function closeRuntimeJob(
  env: Env,
  args: {
    jobId: string;
    taskId: string;
    lane?: string;
    runtime: string;
    capability: RuntimeCapability;
    costMode: string;
    inputsUsed: unknown;
    sourceMaterials: unknown;
    actionsTaken: unknown;
    artifactsCreated: unknown;
    checksRun: unknown;
    unknowns: unknown;
    deferred: unknown;
    nextHumanAction: string | null;
    status: "complete" | "failed";
    error?: string | null;
  },
): Promise<RuntimeOutcome> {
  const now = Date.now();
  const lane = args.lane ?? "ops";

  const evidenceId = await writeEvidence(env.DB, {
    taskId: args.taskId,
    lane,
    executionAssignment: "AI_EXECUTE_WITH_NOTICE",
    workerUsed: "system",
    costMode: args.costMode,
    inputsUsed: args.inputsUsed,
    sourceMaterials: args.sourceMaterials,
    actionsTaken: args.actionsTaken,
    artifactsCreated: args.artifactsCreated,
    systemsTouched: [args.runtime, `capability:${args.capability.key}`],
    checksRun: args.checksRun,
    unknowns: args.unknowns,
    risksRemaining: args.deferred,
    rollbackAvailable: false,
    nextHumanAction: args.nextHumanAction,
    finalStatus: args.status === "complete" ? "done" : "failed",
  });

  await env.DB.batch([
    env.DB
      .prepare(`UPDATE tasks SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
      .bind(args.status === "complete" ? "done" : "failed", now, args.error ?? null, args.taskId),
    env.DB
      .prepare(
        `UPDATE runtime_jobs SET status = ?, finished_at = ?, evidence_packet_id = ?, error = ?, deferred = ? WHERE id = ?`,
      )
      .bind(args.status, now, evidenceId, args.error ?? null, JSON.stringify(args.deferred), args.jobId),
  ]);

  await logEvent(env.DB, {
    level: args.status === "complete" ? "info" : "error",
    scope: "runtime",
    event: `${args.runtime}_${args.status}`,
    entityId: args.jobId,
    detail: { capability: args.capability.key, task_id: args.taskId },
  });

  return { jobId: args.jobId, taskId: args.taskId, evidenceId, status: args.status };
}

/** Opens the job row itself. */
export async function openRuntimeJob(
  db: D1Database,
  args: { runtime: string; kind: string; title: string; input: unknown; capabilityId: string; taskId: string },
): Promise<string> {
  const id = newId("rjb");
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO runtime_jobs (id, runtime, kind, title, input, capability_id, task_id, status, started_at, created_at)
       VALUES (?,?,?,?,?,?,?,'running',?,?)`,
    )
    .bind(id, args.runtime, args.kind, args.title, JSON.stringify(args.input), args.capabilityId, args.taskId, now, now)
    .run();
  return id;
}
