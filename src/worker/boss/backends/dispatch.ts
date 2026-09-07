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
  /**
   * True when a standing duty produced this, false when she asked directly.
   *
   * The only thing it changes is whether the budget may refuse it — which is the whole distinction
   * she drew, and it has to be explicit rather than inferred from an origin string that a future
   * caller could set to anything.
   */
  scheduled?: boolean;
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

  /*
   * THE BUDGET STOPS SCHEDULED WORK AND NEVER STOPS HER.
   *
   * Her instruction, in full: "if i ask for something they do it regardless and if we are out of
   * budget or dangerously so i get notified."
   *
   * So the ceiling governs duties only. A budget that can refuse the owner makes her system less
   * useful than no system — and it is her plan being spent, so it is her call every time.
   *
   * THE FIGURE IS CLAUDE MAX CAPACITY, NOT A BILL. The employees and she draw on the same
   * subscription, which is why running out matters before any invoice would: it shows up as a week
   * where she cannot use Claude Code for her own work because her staff spent it.
   */
  if (input.scheduled) {
    const ceiling = backend.monthly_ceiling_micros ?? 0;
    if (ceiling > 0) {
      const spent = await monthSpend(env, input.backendId);
      if (spent >= ceiling) {
        await logEvent(env.DB, {
          level: "warn", scope: "backends", event: "duty_skipped_over_budget", lane: input.lane, entityId: input.taskId,
          detail: { backend_id: input.backendId, spent_micros: spent, ceiling_micros: ceiling, title: input.title },
        }).catch(() => {});
        return {
          run_id: "",
          backend_id: input.backendId,
          refused:
            `Skipped: this month's agent budget is spent ($${(spent / 1e6).toFixed(2)} of ` +
            `$${(ceiling / 1e6).toFixed(2)}). Anything you ask for directly still runs.`,
        };
      }
    }
  }

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

/**
 * What this backend has spent inside the current monthly window.
 *
 * Read from `execution_backends` rather than summed from runs, because that column is what
 * `/backends/report` already maintains and rolls at the month boundary. Two counters for one number
 * is how a budget starts disagreeing with itself.
 */
async function monthSpend(env: Env, backendId: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT spent_micros, window_started_at FROM execution_backends WHERE id = ?`)
    .bind(backendId)
    .first<{ spent_micros: number; window_started_at: number | null }>();
  if (!row) return 0;
  // A window that predates this month has not been rolled yet; last month's total is not this
  // month's spend, and treating it as such would stop every duty on the first of the month.
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  if (!row.window_started_at || row.window_started_at < monthStart) return 0;
  return row.spent_micros ?? 0;
}

/** Kept so a caller that genuinely wants an exception gets the same sentence. */
export function refusalError(refused: string, runId: string): never {
  throw conflict(refused, `Recorded as run ${runId}. Nothing was queued.`);
}
