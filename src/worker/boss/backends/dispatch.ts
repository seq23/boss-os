import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { conflict, notFound } from "../lib/http";
import { checkBackend, getBackend } from "./registry";
import { recordRefusal } from "./guard";
import type { AiProcessing } from "../policy/airlock";
import type { Sensitivity } from "../../../shared/boss/governance";

/**
 * DISPATCHING A RUN FOR A TASK THAT ALREADY EXISTS.
 *
 * `POST /api/boss/backends/dispatch` creates a task and then a run. That is right for a dispatch
 * the owner types, and useless for the queue consumer, which is handed a task that was already
 * classified, owned and enveloped minutes earlier by a duty. So the half that makes a RUN is here,
 * and the endpoint keeps the half that makes a TASK.
 *
 * WHY THE CONSUMER NEEDS THIS AT ALL. The queue consumer's only move was `routeCompletion` — ask a
 * cloud model. For Camille's Executive Intelligence Report that is not a slower answer, it is a
 * WRONG one: a Cloudflare Worker cannot read this morning's news, and a model asked to recall it
 * produces something that looks exactly like a report and cites sources it never opened. The
 * owner's own success criterion for that duty is "every figure carries a named source and the time
 * it was read", which only a thing that can actually open a page can satisfy.
 *
 * That thing is Claude Code on her Mac, which she confirmed is where the report should run. It
 * reaches this system as `bk_claude_code`, an `agent_executed` backend, and the run sits awaiting a
 * claim until the sync agent takes it.
 *
 * THE GUARD RUNS HERE TOO, AND A REFUSAL IS RECORDED RATHER THAN THROWN AWAY. A backend the
 * boundary would decline must not become a run that quietly fails somewhere nobody is looking.
 */

export interface DispatchInput {
  taskId: string;
  lane: string;
  backendId: string;
  title: string;
  /** The instruction, in words. */
  prompt: string;
  kind: string | null;
  envelopeId: string | null;
  /** Free-form extras the runner understands: repo_path, allowed_paths, verification, model. */
  requested?: Record<string, unknown>;
  actions?: string[];
  requires?: string | null;
  sensitivity?: Sensitivity | null;
  aiProcessing?: AiProcessing | null;
  estimatedCostMicros?: number;
}

export interface DispatchResult {
  run_id: string;
  backend_id: string;
  /** Set when the boundary declined. The run exists, as a refusal. */
  refused: string | null;
}

/**
 * Create the `backend_runs` row a runner can claim.
 *
 * Returns rather than throws on a refusal, because the consumer must be able to fail the TASK with
 * the refusal sentence on it — a thrown error there would land in a generic handler and the owner
 * would see "task failed" with no reason she could act on.
 */
export async function dispatchRunForTask(env: Env, input: DispatchInput): Promise<DispatchResult> {
  const backend = await getBackend(env.DB, input.backendId);
  if (!backend) throw notFound(`No backend is registered as ${input.backendId}`);

  const verdict = await checkBackend(env, input.backendId, input.kind, {
    lane: input.lane,
    actions: input.actions ?? [],
    requires: input.requires ?? null,
    sensitivity: input.sensitivity ?? null,
    aiProcessing: input.aiProcessing ?? null,
    model: null,
    estimatedCostMicros: input.estimatedCostMicros,
  });

  if (verdict.refused) {
    const refusedRunId = await recordRefusal(env, {
      backendId: input.backendId,
      requested: JSON.stringify({ title: input.title, kind: input.kind, task_id: input.taskId }),
      refusal: verdict,
    });
    return { run_id: refusedRunId, backend_id: input.backendId, refused: verdict.sentence };
  }

  const now = Date.now();
  const runId = newId("brn");

  /*
   * THE RECEIPT IS AN AUDIT ROW, NOT A BOOLEAN — the same contract the endpoint uses. The runner
   * refuses an envelope claiming approval with no receipt behind it, because that is what a forged
   * or half-built envelope looks like. Written before the run points at it.
   */
  const receipt = newId("aud");
  await env.DB
    .prepare(
      `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
       VALUES (?,?,'system',?,'backend_run',?,'dispatched',?)`,
    )
    .bind(receipt, now, input.lane, runId,
      JSON.stringify({ backend_id: input.backendId, task_id: input.taskId, kind: input.kind, title: input.title, origin: "queue_consumer" }))
    .run();

  const requested = {
    instruction: input.prompt,
    instruction_origin: "standing_duty",
    kind: input.kind,
    receipt,
    title: input.title,
    ...(input.requested ?? {}),
  };

  await env.DB
    .prepare(
      `INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, cost_micros, started_at, status)
       VALUES (?,?,?,?,?,0,?, 'running')`,
    )
    .bind(runId, input.taskId, input.backendId, input.envelopeId, JSON.stringify(requested), now)
    .run();

  await logEvent(env.DB, {
    level: "info", scope: "backends", event: "dispatched", lane: input.lane, entityId: runId,
    detail: { backend_id: input.backendId, task_id: input.taskId, kind: input.kind, origin: "queue_consumer" },
  });

  return { run_id: runId, backend_id: input.backendId, refused: null };
}

/** Kept so a caller that genuinely wants an exception gets the same sentence. */
export function refusalError(refused: string, runId: string): never {
  throw conflict(refused, `Recorded as run ${runId}. Nothing was queued.`);
}
