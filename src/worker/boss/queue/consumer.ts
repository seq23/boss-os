import type { Env, TaskMessage } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { writeEvidence } from "../lib/evidence";
import { getSetting } from "../lib/settings";
import { loadEnvelope } from "../intake/envelope";
import { routeCompletion, BudgetExceeded, RoutingBlocked, ProviderFailure } from "../router";
import { dispatchRunForTask } from "../backends/dispatch";

/**
 * Workers cap CPU per request, so employee work never runs inside an HTTP
 * handler — it runs here, off the queue, where it can take its time.
 *
 * Every terminal outcome writes an evidence packet. A run nobody can audit is
 * indistinguishable from a run that never happened.
 */
export async function handleTask(env: Env, msg: TaskMessage): Promise<void> {
  const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(msg.taskId).first<any>();
  if (!task) {
    await logEvent(env.DB, {
      level: "warn", scope: "queue", event: "task_missing", entityId: msg.taskId,
      detail: { reason: "Message referenced a task that no longer exists" },
    });
    return;
  }
  if (task.status === "cancelled" || task.status === "done") return;

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'running', started_at = COALESCE(started_at, ?), attempts = attempts + 1 WHERE id = ?`)
      .bind(now, task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'started',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ attempt: (task.attempts ?? 0) + 1 })),
  ]);

  const employee = task.employee_id
    ? await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(task.employee_id).first<any>()
    : null;
  const envelope = await loadEnvelope(env.DB, task.envelope_id);
  const input = task.input ? safeJson(task.input) : {};
  const costMode = task.cost_mode ?? (await getSetting(env.DB, "cost_mode")) ?? "NORMAL";

  // A suspended or retired employee does not get to run work.
  if (employee && employee.lifecycle && ["retired", "suspended", "merged"].includes(employee.lifecycle)) {
    await failTask(env, task, employee, envelope, costMode,
      `${employee.name} is ${employee.lifecycle} and cannot run work`,
      "Reassign the task to an active employee, or reinstate this one in Team.");
    return;
  }

  /*
   * WORK THAT MUST HAPPEN ON HER MACHINE LEAVES HERE, RATHER THAN BEING ASKED OF A CLOUD MODEL.
   *
   * The consumer's only move used to be `routeCompletion`. For a task like the Executive
   * Intelligence Report that is not a slower answer, it is a WRONG one: a Cloudflare Worker cannot
   * read this morning's news, and a model asked to recall it returns something shaped exactly like
   * a report, citing sources it never opened. The duty's own success criterion — "every figure
   * carries a named source and the time it was read" — can only be met by something that can open
   * a page. That is Claude Code on her Mac, reached as `bk_claude_code`.
   *
   * THE BACKEND IS NAMED ON THE TASK, NOT INFERRED FROM ITS TITLE. `input.backend_id` is written by
   * whoever created the work — for a standing duty, by the duty row itself. Guessing from the kind
   * would mean a task silently changing where it runs because its wording changed, and "which
   * machine runs it" is exactly the decision that must not drift.
   *
   * The task then stays 'running' with nothing more happening in the cloud: the run sits awaiting a
   * claim, the sync agent takes it, and `POST /api/boss/backends/report` closes both.
   */
  const backendId = typeof input.backend_id === "string" ? input.backend_id : null;
  if (backendId) {
    const dispatched = await dispatchRunForTask(env, {
      taskId: task.id,
      lane: task.lane,
      backendId,
      title: task.title,
      prompt: await buildPrompt(env, task, input),
      kind: task.intake_kind ?? null,
      envelopeId: task.envelope_id ?? null,
      requested: typeof input.requested === "object" && input.requested ? (input.requested as Record<string, unknown>) : {},
      sensitivity: task.sensitivity ?? null,
      estimatedCostMicros: envelope?.budget_micros ?? 0,
    });

    if (dispatched.refused) {
      /*
       * A REFUSAL FAILS THE TASK WITH THE REFUSAL SENTENCE ON IT. The alternative — a run recorded
       * as refused while the task sits 'running' for ever — is the shape where the report simply
       * stops appearing and nothing anywhere says why.
       */
      await failTask(env, task, employee, envelope, costMode, dispatched.refused,
        "The boundary declined this backend. Change the backend on the duty, or lift what blocked it.");
      return;
    }

    await env.DB
      .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'dispatched',?)`)
      .bind(newId("tev"), task.id, Date.now(), JSON.stringify({ run_id: dispatched.run_id, backend_id: backendId }))
      .run();
    await logEvent(env.DB, {
      level: "info", scope: "queue", event: "task_dispatched_to_backend", lane: task.lane, entityId: task.id,
      detail: { run_id: dispatched.run_id, backend_id: backendId },
    });
    return;
  }

  const routeId = employee?.route_id ?? (task.lane === "trading" ? "rt_trading_default" : "rt_ops_default");
  const prompt = await buildPrompt(env, task, input);

  try {
    const result = await routeCompletion(env, {
      routeId,
      lane: task.lane,
      taskId: task.id,
      employeeId: employee?.id ?? null,
      intakeKind: task.intake_kind ?? null,
      risk: task.risk ?? "low",
      sensitivity: task.sensitivity ?? "private",
      costMode,
      budgetMicros: envelope?.budget_micros ?? 0,
      cloudForRestrictedAllowed: Boolean(envelope?.cloud_for_restricted_allowed),
      messages: [
        {
          role: "system",
          content: employee?.charter ??
            "You are an operator inside a private executive OS. Be brief and concrete. Say what you do not know.",
        },
        { role: "user", content: prompt },
      ],
    });

    const finishedAt = Date.now();
    // The envelope decides, and the employee's own autonomy can only tighten it.
    const needsApproval =
      envelope ? envelope.approval_required === 1 : (!employee || employee.autonomy === "ask");

    if (needsApproval) {
      const aprId = newId("apr");
      // The approval row is inserted before the task points at it: tasks.approval_id
      // is a foreign key, and the reverse order fails the constraint.
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
           VALUES (?,?,?,?,'task_output','tasks',?,?,?,'pending',?,?)`,
        ).bind(
          aprId, task.lane, task.title, result.text.slice(0, 400), task.id,
          task.risk ?? "low", JSON.stringify({ task_id: task.id }), finishedAt,
          finishedAt + 7 * 24 * 60 * 60 * 1000,
        ),
        env.DB.prepare(
          `UPDATE tasks SET status = 'awaiting_approval', output = ?, cost_micros = cost_micros + ?,
                            approval_id = ?, finished_at = ? WHERE id = ?`,
        ).bind(JSON.stringify({ text: result.text, model: result.modelName }), result.costMicros, aprId, finishedAt, task.id),
        env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'awaiting_approval',?)`)
          .bind(newId("tev"), task.id, finishedAt, JSON.stringify({ approval_id: aprId })),
      ]);

      await writeEvidence(env.DB, {
        taskId: task.id, lane: task.lane,
        executionAssignment: task.execution_assignment, employeeId: employee?.id ?? null,
        workerUsed: "model_router", modelId: result.modelId, costMode,
        estimatedCostMicros: envelope?.budget_micros ?? 0, actualCostMicros: result.costMicros,
        inputsUsed: { title: task.title, prompt_chars: prompt.length },
        sourceMaterials: input.sources ?? null,
        actionsTaken: [`Generated a draft with ${result.modelName}`, "Raised an approval for release"],
        artifactsCreated: [{ kind: "task_output", task_id: task.id }],
        systemsTouched: ["model_router", "approvals"],
        recordsChanged: [{ table: "tasks", id: task.id }],
        checksRun: ["budget", "cost_mode", "model_policy"],
        risksRemaining: result.usedFallback ? ["Primary model was unavailable; a fallback produced this"] : [],
        unknowns: ["Output has not been fact-checked against a source"],
        approvalNeeded: true, approvalId: aprId, rollbackAvailable: true,
        nextHumanAction: "Review the draft in the Approval Inbox",
        finalStatus: "awaiting_approval",
      });
    } else {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE tasks SET status = 'done', output = ?, cost_micros = cost_micros + ?, finished_at = ? WHERE id = ?`,
        ).bind(JSON.stringify({ text: result.text, model: result.modelName }), result.costMicros, finishedAt, task.id),
        env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'completed',NULL)`)
          .bind(newId("tev"), task.id, finishedAt),
      ]);

      await writeEvidence(env.DB, {
        taskId: task.id, lane: task.lane,
        executionAssignment: task.execution_assignment, employeeId: employee?.id ?? null,
        workerUsed: "model_router", modelId: result.modelId, costMode,
        actualCostMicros: result.costMicros,
        inputsUsed: { title: task.title, prompt_chars: prompt.length },
        actionsTaken: [`Completed under notice with ${result.modelName}`],
        artifactsCreated: [{ kind: "task_output", task_id: task.id }],
        systemsTouched: ["model_router"],
        recordsChanged: [{ table: "tasks", id: task.id }],
        checksRun: ["budget", "cost_mode", "model_policy"],
        risksRemaining: result.usedFallback ? ["Primary model was unavailable; a fallback produced this"] : [],
        approvalNeeded: false, rollbackAvailable: false,
        nextHumanAction: "None. Executed under notice.",
        finalStatus: "done",
      });
    }

    await logEvent(env.DB, {
      level: "info", scope: "queue", event: "task_completed", lane: task.lane, entityId: task.id,
      detail: { model: result.modelId, cost_micros: result.costMicros, fallback: result.usedFallback },
    });
  } catch (err) {
    // Budget and sensitive-routing blocks are not failures — they are the system
    // holding the task at a gate that only a human can open.
    if (err instanceof BudgetExceeded) {
      await holdForApproval(env, task, employee, envelope, costMode, {
        kind: "spend",
        title: `Budget hold: ${task.title}`,
        summary: err.message,
        hint: "Approving releases the task back onto the queue.",
        risk: "medium",
      });
      return;
    }
    if (err instanceof RoutingBlocked && err.approvable) {
      await holdForApproval(env, task, employee, envelope, costMode, {
        kind: "model_route",
        title: `Routing card: ${task.title}`,
        summary: err.message,
        hint: err.hint,
        risk: "high",
      });
      return;
    }
    if (err instanceof RoutingBlocked) {
      // A policy refusal fails identically on every retry, so it is terminal.
      await failTask(env, task, employee, envelope, costMode, err.message, err.hint);
      return;
    }

    const hint = err instanceof ProviderFailure
      ? err.hint
      : "Check Diagnostics for the failure, then requeue the task.";
    await failTask(env, task, employee, envelope, costMode, `Run failed: ${(err as Error).message}`, hint);
    throw err; // let the queue retry genuine transient failures
  }
}

/** Renders the task's template if it has one, otherwise uses the raw prompt. */
async function buildPrompt(env: Env, task: any, input: Record<string, any>): Promise<string> {
  if (task.template_id) {
    const tpl = await env.DB
      .prepare(`SELECT prompt FROM task_templates WHERE id = ? AND enabled = 1`)
      .bind(task.template_id)
      .first<{ prompt: string | null }>();
    if (tpl?.prompt) {
      return tpl.prompt.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const v = input[key];
        return v === undefined || v === null || v === "" ? `(not supplied: ${key})` : String(v);
      });
    }
  }
  return input.prompt ?? task.title;
}

async function holdForApproval(
  env: Env, task: any, employee: any, envelope: any, costMode: string,
  card: { kind: string; title: string; summary: string; hint: string; risk: string },
): Promise<void> {
  const aprId = newId("apr");
  const now = Date.now();

  // Approval first — tasks.approval_id is a foreign key onto it.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,?,'tasks',?,?,?,'pending',?,?)`,
    ).bind(
      aprId, task.lane, card.title, `${card.summary} ${card.hint}`, card.kind, task.id,
      card.risk, JSON.stringify({ task_id: task.id }), now, now + 7 * 24 * 60 * 60 * 1000,
    ),
    env.DB.prepare(`UPDATE tasks SET status = 'awaiting_approval', approval_id = ?, error = ? WHERE id = ?`)
      .bind(aprId, card.summary.slice(0, 500), task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'held',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ approval_id: aprId, kind: card.kind })),
  ]);

  await writeEvidence(env.DB, {
    taskId: task.id, lane: task.lane,
    executionAssignment: task.execution_assignment, employeeId: employee?.id ?? null,
    workerUsed: "model_router", costMode,
    actionsTaken: ["Refused to run and raised a gate card"],
    systemsTouched: ["model_router"],
    checksRun: ["budget", "cost_mode", "model_policy"],
    risksRemaining: [card.summary],
    approvalNeeded: true, approvalId: aprId, rollbackAvailable: true,
    nextHumanAction: card.hint,
    finalStatus: "held",
  });

  await audit(env.DB, {
    actor: "system", lane: task.lane, entityType: "task", entityId: task.id,
    action: "held", detail: { kind: card.kind, approval_id: aprId },
  });
  await logEvent(env.DB, {
    level: "info", scope: "queue", event: "task_held", lane: task.lane, entityId: task.id,
    detail: { kind: card.kind, reason: card.summary },
  });
}

async function failTask(
  env: Env, task: any, employee: any, envelope: any, costMode: string,
  message: string, hint: string,
): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
      .bind(message.slice(0, 500), now, task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'failed',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ message, hint })),
  ]);

  await writeEvidence(env.DB, {
    taskId: task.id, lane: task.lane,
    executionAssignment: task.execution_assignment, employeeId: employee?.id ?? null,
    workerUsed: "model_router", costMode,
    actionsTaken: ["Attempted the run and failed"],
    systemsTouched: ["model_router"],
    checksRun: ["budget", "cost_mode", "model_policy"],
    risksRemaining: [message],
    approvalNeeded: false, rollbackAvailable: false,
    nextHumanAction: hint,
    finalStatus: "failed",
  });

  await logEvent(env.DB, {
    level: "error", scope: "queue", event: "task_failed", lane: task.lane, entityId: task.id,
    detail: { message },
  });
}

function safeJson(raw: string): Record<string, any> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Dead-letter triage. A message that exhausted its retries is written down with
 * enough context to requeue it by hand instead of vanishing.
 */
export async function handleDeadLetter(env: Env, msg: TaskMessage, error?: string): Promise<void> {
  const task = msg.taskId
    ? await env.DB.prepare(`SELECT id, lane, attempts, error FROM tasks WHERE id = ?`).bind(msg.taskId).first<any>()
    : null;

  await env.DB
    .prepare(
      `INSERT INTO dead_letters (id, ts, queue, task_id, lane, attempts, payload, error, status)
       VALUES (?,?,?,?,?,?,?,?,'open')`,
    )
    .bind(
      newId("dlq"), Date.now(), "boss-os-tasks", msg.taskId ?? null,
      msg.lane ?? task?.lane ?? null, task?.attempts ?? msg.attempt ?? 0,
      JSON.stringify(msg), error ?? task?.error ?? "Retries exhausted",
    )
    .run();

  if (task) {
    await env.DB
      .prepare(`UPDATE tasks SET status = 'failed', error = COALESCE(error, ?) WHERE id = ? AND status != 'done'`)
      .bind("Retries exhausted; see dead letters", task.id)
      .run();
  }

  await logEvent(env.DB, {
    level: "error", scope: "queue", event: "dead_letter",
    lane: msg.lane ?? null, entityId: msg.taskId ?? null, detail: { error },
  });
}
