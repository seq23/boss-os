/**
 * The execution backend registry, over HTTP — Stage 1 of `docs/boss/PLAN_v21.md`.
 *
 * Canon: Phase 9 §33, §36, §79.8. Sovereignty Addendum §1, §3.1.
 *
 * NOTHING HERE EXECUTES ANYTHING. This surface reads the registry, changes a backend's status or
 * its sub-cap on the record, answers "would this be permitted", and reads the run ledger. The
 * runner that actually claims and executes work is Stage 2, on the owner's own machine.
 *
 * A REFUSAL IS RENDERED AS A REFUSAL. `outcome_class` comes from one function in `guard.ts` so no
 * screen gets to decide for itself that a deliberate decline is a failure.
 */

import { spentCooldownSeconds } from "../backends/spent";
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound, conflict, AppError } from "../lib/http";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { newId } from "../lib/id";
import { getSetting } from "../lib/settings";
import { classify } from "../intake/classify";
import { deliverExecutiveReport, deliverSourcingCandidates, deliverLinkProspects, deliverToolSuggestions, deliverPracticeWeek } from "../duties/deliverReport";
import { buildEnvelope } from "../intake/envelope";
import { runNeedsHerDecision } from "../backends/needsDecision";
import { setSpendLever, spendLeverState, SPEND_LEVER_POSITIONS, type SpendLeverPosition } from "../router/spend";
import {
  BackendChangeRefused,
  ROUTE_ORDER,
  checkBackend,
  getBackend,
  listBackends,
  setBackendStatus,
  setMonthlyCeiling,
  viewBackend,
  type Backend,
  type BackendStatus,
} from "../backends/registry";
import {
  laneAllowance,
  monthWindowStart,
  outcomeClass,
  recordRefusal,
  formatMicros,
  type BackendRequest,
} from "../backends/guard";
import { eligibleFor } from "../backends/registry";
import type { AiProcessing } from "../policy/airlock";
import type { Sensitivity } from "../../../shared/boss/governance";

export const backends = new Hono<{ Bindings: Env; Variables: Vars }>();

const STATUSES: BackendStatus[] = ["registered", "enabled", "disabled"];

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

/** A `BackendChangeRefused` is a 409: the request was understood and declined, not malformed. */
function asHttp(err: unknown): never {
  if (err instanceof BackendChangeRefused) {
    throw err.code === "backend_unknown" ? notFound(err.message) : conflict(err.message, err.hint);
  }
  throw err;
}

// ─── The registry ────────────────────────────────────────────────────────────

backends.get("/", async (c) => {
  const [rows, lever] = await Promise.all([listBackends(c.env.DB), spendLeverState(c.env.DB)]);
  const now = Date.now();
  return ok(c, {
    backends: rows.map((b: Backend) => viewBackend(c.env, b, lever, now)),
    lever,
    route_order: ROUTE_ORDER,
    note:
      "A ceiling of $0 means genuinely free tiers only — it is neither unlimited nor a stop on everything. " +
      "Each ceiling is a sub-cap inside the lane's own budget, never a second spending authority.",
  });
});

// Registered BEFORE `/:id`, so a request for the run ledger is never read as a backend called
// "runs". Hono matches in registration order and this is the only thing keeping them apart.
backends.get("/runs", async (c) => {
  const status = c.req.query("status");
  const backendId = c.req.query("backend_id");
  const params: unknown[] = [];
  const where: string[] = [];
  if (status) { where.push(`r.status = ?`); params.push(status); }
  if (backendId) { where.push(`r.backend_id = ?`); params.push(backendId); }
  /*
   * `unclaimed=1` — RUNS THAT ARE PARKED AND WAITING FOR A MACHINE (1 Oct 2026). The five-minute poll on her Mac asks this, read-only,
   * BEFORE it refreshes the market and sky data and claims: an idle poll then costs one read and fetches nothing from any feed. Not
   * finished and not claimed is exactly what `/claim` takes; `claimed_at` is returned so a caller can tell the listing honours the filter.
   */
  if (c.req.query("unclaimed") === "1") where.push(`r.claimed_at IS NULL AND r.finished_at IS NULL`);

  const rows = await c.env.DB
    .prepare(
      `SELECT r.id, r.task_id, r.backend_id, r.envelope_id, r.requested, r.summary,
              r.cost_micros, r.started_at, r.claimed_at, r.finished_at, r.status, r.refusal_reason, r.error,
              b.display_name AS backend_name
         FROM backend_runs r
         JOIN execution_backends b ON b.id = r.backend_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY r.started_at DESC LIMIT 100`,
    )
    .bind(...params)
    .all<any>();

  return ok(c, {
    runs: (rows.results ?? []).map((r: any) => ({ ...r, outcome_class: outcomeClass(r.status) })),
    note: "A refused run is a decision, not a fault. `outcome_class` keeps the two apart wherever this is read.",
  });
});

backends.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = await c.env.DB
    .prepare(`SELECT * FROM backend_runs WHERE id = ?`).bind(id).first<any>();
  if (!run) throw notFound("No backend run with that id");

  const [backend, task, evidence] = await Promise.all([
    getBackend(c.env.DB, run.backend_id),
    run.task_id
      ? c.env.DB.prepare(`SELECT id, title, lane, status FROM tasks WHERE id = ?`).bind(run.task_id).first<any>()
      : Promise.resolve(null),
    run.evidence_id
      ? c.env.DB.prepare(`SELECT * FROM evidence_packets WHERE id = ?`).bind(run.evidence_id).first<any>()
      : Promise.resolve(null),
  ]);

  const parse = (raw: string | null) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };

  return ok(c, {
    run: {
      ...run,
      outcome_class: outcomeClass(run.status),
      files_touched: parse(run.files_touched),
      commands: parse(run.commands),
      checks_run: parse(run.checks_run),
      refusal_reason: parse(run.refusal_reason),
    },
    backend,
    task,
    evidence,
  });
});

/**
 * ─── EVERY LITERAL PATH IS DECLARED ABOVE `/:id` ─────────────────────────────
 *
 * Hono matches in registration order, so `candidates`, `dispatch`, `claim` and `report` must be
 * registered before the parameterised route or they are read as a backend id and answered with a
 * confusing 404. This repository has been bitten by that ordering before; the comment stays so the
 * next person to add a route puts it in the right half of the file.
 */

/**
 * What could take this work, and what each would refuse — the Launch screen's first question.
 *
 * RETURNS THE REFUSALS TOO, as first-class results rather than as errors. A screen that shows only
 * the backends that can take a job cannot answer "why can't Fireworks have it", which is the
 * question the owner actually asks. The wording is this server's: the client renders `sentence`
 * and `spend.kind` verbatim and invents no cost number of its own.
 *
 * AN ABSENT KIND IS RECORDED AS ABSENT. If the caller names no task kind, every backend refuses
 * with `task_kind_absent` rather than the server guessing one — a guessed kind is how work reaches
 * a backend that was never allowed to take it.
 */
backends.post("/candidates", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = optionalText(b?.title);
  if (!title) throw badRequest("A launch needs a title", "Send { title, prompt, kind }.");

  const kind = optionalText(b?.kind);
  const result = await eligibleFor(c.env, kind, {
    lane: optionalText(b?.lane) ?? "ops",
    requires: optionalText(b?.requires),
    sensitivity: (optionalText(b?.sensitivity) as Sensitivity | null) ?? null,
    aiProcessing: (optionalText(b?.ai_processing) as AiProcessing | null) ?? null,
    model: optionalText(b?.model),
    estimatedCostMicros:
      b?.estimated_cost_micros === undefined || b?.estimated_cost_micros === null
        ? undefined
        : Number(b.estimated_cost_micros),
  });

  const rows = await listBackends(c.env.DB);
  const named = new Map(rows.map((r: Backend) => [r.id, r]));
  const decorate = (v: any) => ({
    ...v,
    display_name: named.get(v.backend_id)?.display_name ?? v.backend_id,
    class: named.get(v.backend_id)?.class ?? null,
  });

  // One array, permitted first in route order, refusals after — so the client can render the list
  // top to bottom without deciding for itself which half matters.
  return ok(c, {
    candidates: [...result.order.map(decorate), ...result.refused.map(decorate)],
    task_kind: result.task_kind,
    task_kind_known: result.task_kind_known,
    lever: result.lever,
    route_order: result.route_order,
  });
});

/**
 * Send the work.
 *
 * WHAT THIS CREATES: a task, its permission envelope, an audit receipt, and a `backend_runs` row
 * awaiting a runner. WHAT IT DOES NOT DO: execute anything. A `cloud_model` backend is dispatched
 * the same way and waits for the same approval, because "which machine runs it" must not change
 * who authorised it.
 *
 * THE GUARD RUNS FIRST AND A REFUSAL IS RECORDED. Dispatching a backend the boundary would decline
 * is answered with the refusal, written to `backend_runs` as a refused run, and a 409 — never a
 * queued run that fails later somewhere the owner is not looking.
 */
backends.post("/dispatch", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = optionalText(b?.title);
  const prompt = optionalText(b?.prompt);
  const backendId = optionalText(b?.backend_id);
  const kind = optionalText(b?.kind);
  const lane = optionalText(b?.lane) ?? "ops";

  if (!title) throw badRequest("A dispatch needs a title", "Send { title, prompt, kind, backend_id }.");
  if (!backendId) throw badRequest("A dispatch needs a backend", "Ask POST /api/backends/candidates which ones may take it.");
  if (!prompt) throw badRequest("A dispatch needs an instruction", "Send { prompt } — the work, in words.");

  const backend = await getBackend(c.env.DB, backendId);
  if (!backend) throw notFound("No backend is registered with that id");

  const verdict = await checkBackend(c.env, backendId, kind, {
    lane,
    actions: stringList(b?.actions),
    requires: optionalText(b?.requires),
    sensitivity: (optionalText(b?.sensitivity) as Sensitivity | null) ?? null,
    aiProcessing: (optionalText(b?.ai_processing) as AiProcessing | null) ?? null,
    model: optionalText(b?.model),
    estimatedCostMicros:
      b?.estimated_cost_micros === undefined || b?.estimated_cost_micros === null
        ? undefined
        : Number(b.estimated_cost_micros),
  });

  if (verdict.refused) {
    const refusedRunId = await recordRefusal(c.env, {
      backendId,
      requested: JSON.stringify({ title, kind, prompt_chars: prompt.length }),
      refusal: verdict,
    });
    throw conflict(verdict.sentence, `Recorded as run ${refusedRunId}. Nothing was queued.`);
  }

  const classification = classify({ title, prompt, lane, intakeKind: b?.intake_kind, risk: b?.risk, sensitivity: b?.sensitivity });
  const costMode = (await getSetting(c.env.DB, "cost_mode")) ?? "NORMAL";
  const taskId = newId("tsk");
  const runId = newId("brn");
  const now = Date.now();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tasks (id, lane, title, input, status, created_at, intake_kind,
                          execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,'queued',?,?,?,?,?,?)`,
    ).bind(
      taskId, lane, title,
      /*
       * THE DELIVERY CONTRACT TRAVELS ON THE TASK, and it was missing here.
       *
       * `deliverExecutiveReport` reads `input.delivers` off the task to decide whether a run's
       * output becomes a stored report. A duty writes that; this endpoint did not, so a report
       * dispatched BY HAND produced a perfectly good `delivers.json`, reported it, and had it
       * silently dropped — the run succeeded and the Executive Briefing block still said no report
       * had ever been produced. Found by dispatching the real thing rather than by reading the code.
       */
      JSON.stringify({ prompt, backend_id: backendId, kind, ...(optionalText(b?.delivers) ? { delivers: optionalText(b?.delivers) } : {}) }), now,
      classification.intakeKind, classification.executionAssignment,
      classification.risk, classification.sensitivity, costMode,
    ),
    c.env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`)
      .bind(newId("tev"), taskId, now, JSON.stringify({ ...classification, backend_id: backendId })),
  ]);

  const envelope = await buildEnvelope(c.env.DB, {
    taskId, lane, employeeId: null, classification, costMode,
  });
  await c.env.DB.prepare(`UPDATE tasks SET envelope_id = ? WHERE id = ?`).bind(envelope.id, taskId).run();

  /*
   * THE RECEIPT IS AN AUDIT ROW, NOT A BOOLEAN.
   *
   * The runner refuses an envelope carrying `approved: true` with no receipt, because that is what a
   * forged or half-built envelope looks like. So the authorisation is written down first and the
   * envelope points at it: `claim` re-reads this row before it hands anything out, and an envelope
   * whose receipt does not exist is never marked approved.
   */
  const receipt = newId("aud");
  await c.env.DB
    .prepare(
      `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
       VALUES (?,?,'boss',?,'backend_run',?,'dispatched',?)`,
    )
    .bind(receipt, now, lane, runId, JSON.stringify({ backend_id: backendId, task_id: taskId, kind, title }))
    .run();

  const requested = {
    instruction: prompt,
    instruction_origin: optionalText(b?.instruction_origin) ?? "owner",
    kind,
    repo_path: optionalText(b?.repo_path),
    allowed_paths: stringList(b?.allowed_paths),
    verification: stringList(b?.verification),
    // Read-only files copied into the run's own directory, and the read-only web tools it may use.
    // Both are checked by the runner, not here — see the envelope assembly in /claim.
    materials: stringList(b?.materials),
    web_tools: stringList(b?.web_tools),
    required_capability: optionalText(b?.requires),
    model: optionalText(b?.model),
    max_seconds: b?.max_seconds === undefined || b?.max_seconds === null ? null : Number(b.max_seconds),
    receipt,
    title,
  };

  await c.env.DB
    .prepare(
      `INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, cost_micros, started_at, status)
       VALUES (?,?,?,?,?,0,?, 'running')`,
    )
    .bind(runId, taskId, backendId, envelope.id, JSON.stringify(requested), now)
    .run();

  await logEvent(c.env.DB, {
    level: "info", scope: "backends", event: "dispatched", lane, entityId: runId,
    detail: { backend_id: backendId, task_id: taskId, kind },
  });

  return ok(c, {
    run: { id: runId, backend_id: backendId, task_id: taskId, status: "running", awaiting: "a runner to claim it" },
    run_id: runId,
    id: runId,
    verdict,
  }, 201);
});

/**
 * The private runner asking for work — Stage 2, `docs/boss/PLAN_v21.md`.
 *
 * EXCLUSIVE BY CONSTRUCTION. The claim is a conditional UPDATE on the task's own status, so two
 * ticks of the agent, or two devices, cannot take the same run: exactly one UPDATE changes a row
 * and every other caller is told there is nothing to claim. A SELECT followed by an UPDATE would
 * race, and the race would end with one job running twice.
 *
 * WHAT IS HANDED OVER IS AN ENVELOPE AND NOTHING ELSE — the keys the runner recognises, no more.
 * Both halves check it: this side refuses to build an unapproved one, and the runner refuses to
 * execute one whose forbidden list has been narrowed, whose credential is not local, or which
 * carries a key it does not recognise. Neither trusts the other, which is why a widened envelope
 * has nowhere to land.
 */
backends.post("/claim", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const deviceId = optionalText(b?.device_id);
  const backendId = optionalText(b?.backend_id) ?? "bk_claude_code";
  if (!deviceId) throw badRequest("A claim needs a device", "Send { device_id, backend_id }.");
  /*
   * ─── A SEAT MAY TAKE WORK PARKED FOR A SEAT ABOVE IT ON THE SAME LADDER ────
   *
   * `fallback_from` is the list of seats on the claiming machine that failed preflight this cycle.
   * A run parked for one of them whose own `requested.backend_ladder` lists THIS seat later is
   * handed over, re-labelled, and the hand-off recorded. Before this, a Mac whose Claude seat could
   * not authenticate left the briefing unclaimed while its Codex seat sat idle beside it — the
   * ladder existed in a migration comment and nowhere a run could walk.
   *
   * Only seats the CALLER says are down, only runs whose ladder names the caller, only agent
   * seats: a cloud backend never appears here, and a run with no ladder is never re-labelled.
   */
  const fallbackFrom = Array.isArray(b?.fallback_from)
    ? (b.fallback_from as unknown[]).filter((x): x is string => typeof x === "string" && x !== backendId)
    : [];

  const backend = await getBackend(c.env.DB, backendId);
  if (!backend) throw notFound("No backend is registered with that id");
  if (backend.status !== "enabled") {
    // Not an error: a disabled backend simply has nothing for this device, and the runner treats a
    // null run as "nothing to do" rather than as a fault it should retry against.
    return ok(c, { run: null, reason: `${backend.display_name} is ${backend.status}, so it may not take work.` });
  }

  /*
   * THE JOIN USED TO REQUIRE `t.status = 'queued'`, AND THAT IS WHY NOTHING WAS EVER CLAIMED.
   *
   * `queue/consumer.ts` sets the task to `running` — its event is literally named `started` — and
   * THEN dispatches the run. So by the time a runner asks, the task is `running` and the old clause
   * could never match. Every duty routed to `bk_claude_code` produced a run no machine could take,
   * silently, for ever. See migration 0206 for the full account; the symptom reached Today as
   * "fired, but its last task is still running — nothing picked it up", which reads as a broken
   * launchd agent and is not.
   *
   * EXCLUSIVITY MOVED TO THE RUN, WHICH IS THE OBJECT BEING CLAIMED. The old conditional UPDATE on
   * the task was doing double duty as both filter and lock; `claimed_at IS NULL` is a lock that
   * does not also make a claim depend on an unrelated status.
   */
  const seatIds = [backendId, ...fallbackFrom];
  const waiting = await c.env.DB
    .prepare(
      `SELECT r.id, r.task_id, r.envelope_id, r.requested, r.backend_id AS parked_for
         FROM backend_runs r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.backend_id IN (${seatIds.map(() => "?").join(",")}) AND r.status = 'running' AND r.finished_at IS NULL
          AND r.claimed_at IS NULL
          AND t.status IN ('queued', 'running')
        ORDER BY CASE WHEN r.backend_id = ? THEN 0 ELSE 1 END, r.started_at LIMIT 10`,
    )
    .bind(...seatIds, backendId)
    .all<{ id: string; task_id: string; envelope_id: string | null; requested: string; parked_for: string }>();

  for (const run of waiting.results ?? []) {
    let handoff: { from: string } | null = null;
    if (run.parked_for !== backendId) {
      let parkedRequested: any = {};
      try { parkedRequested = JSON.parse(run.requested); } catch { parkedRequested = {}; }
      const ladder: unknown[] = Array.isArray(parkedRequested.backend_ladder) ? parkedRequested.backend_ladder : [];
      const from = ladder.indexOf(run.parked_for);
      const to = ladder.indexOf(backendId);
      // Only a later seat on the run's OWN ladder may take it. Anything else stays where it is.
      if (from === -1 || to === -1 || to <= from) continue;
      handoff = { from: run.parked_for };
    }

    // Exclusive by construction: exactly one UPDATE changes a row whose claimed_at is still null.
    const claimed = await c.env.DB
      .prepare(`UPDATE backend_runs SET claimed_at = ?, claimed_by = ?, backend_id = ? WHERE id = ? AND claimed_at IS NULL`)
      .bind(Date.now(), deviceId, backendId, run.id)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue; // somebody else took it between the read and here

    if (handoff) {
      await c.env.DB
        .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_handoff',?)`)
        .bind(newId("tev"), run.task_id, Date.now(), JSON.stringify({ run_id: run.id, from: handoff.from, to: backendId, device_id: deviceId, why: `${handoff.from} could not authenticate on ${deviceId}` }))
        .run();
      await logEvent(c.env.DB, {
        level: "warn", scope: "backends", event: "ladder_handoff", entityId: run.task_id,
        detail: { run_id: run.id, from: handoff.from, to: backendId, device_id: deviceId },
      });
    }

    await c.env.DB
      .prepare(`UPDATE tasks SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?`)
      .bind(Date.now(), run.task_id)
      .run();

    let requested: any = {};
    try { requested = JSON.parse(run.requested); } catch { requested = {}; }

    const receipt = typeof requested.receipt === "string" ? requested.receipt : null;
    const receiptRow = receipt
      ? await c.env.DB.prepare(`SELECT id FROM audit_log WHERE id = ?`).bind(receipt).first<{ id: string }>()
      : null;
    if (!receiptRow) {
      // No provable authorisation, so no envelope. The task goes back rather than being handed over
      // unapproved, and the refusal is recorded where the owner reads it.
      await c.env.DB.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ?`).bind(run.task_id).run();
      await c.env.DB
        .prepare(`UPDATE backend_runs SET status = 'refused', finished_at = ?, refusal_reason = ? WHERE id = ?`)
        .bind(Date.now(), JSON.stringify({
          code: "unapproved_envelope",
          sentence: "This run carries no authorisation receipt that still exists, so no envelope was built for it.",
        }), run.id)
        .run();
      continue;
    }

    const envelope: Record<string, unknown> = {
      run_id: run.id,
      task_id: run.task_id,
      backend_id: backendId,
      envelope_id: run.envelope_id,
      approved: true,
      approval_receipt: receipt,
      kind: requested.kind ?? null,
      instruction: requested.instruction ?? "",
      instruction_origin: requested.instruction_origin ?? "owner",
      // THE FORBIDDEN LIST IS SENT WHOLE, FROM THE ROW. It is never narrowed here, and the runner
      // refuses an envelope that omits any of the five — so a narrowing bug on this side is caught
      // on the other side rather than obeyed.
      forbidden_actions: backend.forbidden_actions,
      allowed_kinds: backend.allowed_kinds,
      capabilities: backend.capabilities,
      credential_ref: backend.credential_ref ?? "",
    };
    if (requested.repo_path) envelope.repo_path = requested.repo_path;
    if (Array.isArray(requested.allowed_paths) && requested.allowed_paths.length) envelope.allowed_paths = requested.allowed_paths;
    if (Array.isArray(requested.verification) && requested.verification.length) envelope.verification = requested.verification;
    if (requested.required_capability) envelope.required_capability = requested.required_capability;
    /*
     * EACH SEAT GETS ITS OWN MODEL. `model_by_backend` wins over `model`; a null entry means the
     * seat's own default and no `--model` is passed. A hand-off from Claude Code to Codex therefore
     * never carries a Claude model id into a Codex invocation.
     */
    const byBackend = requested.model_by_backend && typeof requested.model_by_backend === "object" ? requested.model_by_backend : null;
    if (byBackend && backendId in byBackend) {
      if (byBackend[backendId]) envelope.model = byBackend[backendId];
    } else if (requested.model) envelope.model = requested.model;
    if (requested.max_seconds) envelope.max_seconds = requested.max_seconds;

    /*
     * MATERIALS AND WEB TOOLS PASS THROUGH UNCHANGED AND UNVALIDATED HERE, ON PURPOSE.
     *
     * This side does not decide what is grantable — the runner does, and it refuses an envelope key
     * it does not know and a web tool outside its own two-item list. Adding a second opinion here
     * would create two vocabularies for one rule, which is the drift this codebase has already been
     * bitten by twice today. Passing them straight through means the runner's refusal is the answer.
     */
    if (Array.isArray(requested.materials) && requested.materials.length) envelope.materials = requested.materials;
    if (Array.isArray(requested.web_tools) && requested.web_tools.length) envelope.web_tools = requested.web_tools;

    await c.env.DB
      .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'claimed',?)`)
      .bind(newId("tev"), run.task_id, Date.now(), JSON.stringify({ device_id: deviceId, run_id: run.id, backend_id: backendId }))
      .run();
    await audit(c.env.DB, {
      actor: deviceId, lane: "ops", entityType: "backend_run", entityId: run.id,
      action: "claimed", detail: { backend_id: backendId, task_id: run.task_id },
    });

    return ok(c, { run: envelope });
  }

  return ok(c, { run: null });
});

/**
 * The runner reporting back — the only path by which a run finishes.
 *
 * IT WRITES EVIDENCE AND NOTHING ELSE. No backend's status, ceiling or envelope can be reached
 * from this body. The one number it may move is `spent_micros`, because a run that cost money and
 * did not say so is how a ledger stops being true.
 *
 * ALL THREE OUTCOMES ARRIVE HERE AND ALL THREE ARE RECORDED. A failure carries its failure rather
 * than an absence; a refusal keeps `error` null and carries `refusal_reason`; and the two are never
 * flattened into one colour.
 *
 * A DETECTED FORBIDDEN ACTION IS A FAILURE, NOT A DECLINE. If the packet carries violations, this
 * side records the run as failed whatever the packet's own status field says — a runner that found
 * a commit attempt and reported it politely would otherwise look like a backend that chose not to
 * bother.
 */
backends.post("/report", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const deviceId = optionalText(b?.device_id);
  const ev = b?.evidence;
  if (!deviceId) throw badRequest("A report needs a device", "Send { device_id, evidence }.");
  if (!ev || typeof ev !== "object") throw badRequest("A report needs an evidence packet", "Send { device_id, evidence }.");

  const runId = optionalText(ev.run_id);
  if (!runId) throw badRequest("The evidence names no run", "Every packet carries the run_id it came from.");

  const run = await c.env.DB
    .prepare(`SELECT id, task_id, backend_id, status, finished_at, requested FROM backend_runs WHERE id = ?`)
    .bind(runId)
    .first<{ id: string; task_id: string | null; backend_id: string; status: string; finished_at: number | null; requested: string | null }>();
  if (!run) throw notFound("No backend run with that id");
  if (run.finished_at !== null || run.status !== "running") {
    throw conflict(`That run is already ${run.status}`, "A finished run is not reported twice.");
  }

  const violations = Array.isArray(ev.violations) ? ev.violations : [];
  const reported = String(ev.status ?? "");
  if (!["succeeded", "failed", "refused"].includes(reported)) {
    throw badRequest(
      `"${reported}" is not a run outcome`,
      "A packet ends succeeded, failed or refused. An unrecognised outcome is refused rather than stored.",
    );
  }

  /*
   * ── A SPENT PLAN HANDS THE RUN TO THE NEXT SEAT, ONCE PER SEAT (29 Sep 2026) ──────────────────
   *
   * The seat that ran this said its plan is out of usage. If the run's OWN ladder names a later seat
   * that has not already been tried, the run is put back in the queue rather than failed: the claim
   * is cleared, the seat is recorded as tried in `requested.ladder_released`, and the next seat to
   * claim it — this machine's other seat, which the agent now reports as `fallback_from` because
   * the spent one is out — takes it, with its own model and a `ladder_handoff` event. Nothing was
   * lost: a run that never produced an answer has nothing to file.
   *
   * BOUNDED BY CONSTRUCTION. A seat can appear in `ladder_released` once, and only seats LATER on
   * the ladder qualify, so a run can move down the ladder and never back up or round: two seats, one
   * release. A run with no ladder, or whose last seat is the one that ran it, is not released; it
   * fails below with the seat's own sentence, as it always did, and both seats are marked spent so
   * the NEXT dispatch walks to the cloud rungs at the door instead of parking on a spent seat.
   *
   * A run with violations is never released: something forbidden happened and a person looks.
   */
  const spentEvidence = ev.seat_exhausted && typeof ev.seat_exhausted === "object" ? (ev.seat_exhausted as Record<string, unknown>) : null;
  if (spentEvidence && reported === "failed" && violations.length === 0) {
    let req: Record<string, unknown> = {};
    try { req = run.requested ? (JSON.parse(run.requested) as Record<string, unknown>) : {}; } catch { req = {}; }
    const ladder: string[] = Array.isArray(req.backend_ladder) ? (req.backend_ladder as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const tried: string[] = Array.isArray(req.ladder_released) ? (req.ladder_released as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const at = ladder.indexOf(run.backend_id);
    const next = at === -1 ? undefined : ladder.slice(at + 1).find((id) => !tried.includes(id) && id !== run.backend_id);
    if (next) {
      const releasedAt = Date.now();
      const until = releasedAt + spentCooldownSeconds(spentEvidence.retry_after_seconds) * 1000;
      const notice = (optionalText(spentEvidence.notice) ?? "").slice(0, 300) || null;
      const released = await c.env.DB
        .prepare(`UPDATE backend_runs SET claimed_at = NULL, claimed_by = NULL, requested = ? WHERE id = ? AND finished_at IS NULL AND status = 'running'`)
        .bind(JSON.stringify({ ...req, ladder_released: [...tried, run.backend_id] }), run.id)
        .run();
      if ((released.meta.changes ?? 0) > 0) {
        await c.env.DB
          .prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = ? WHERE id = ?`)
          .bind(until, notice, run.backend_id)
          .run();
        if (run.task_id) {
          await c.env.DB
            .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_release',?)`)
            .bind(newId("tev"), run.task_id, releasedAt, JSON.stringify({ run_id: run.id, from: run.backend_id, next, why: `${run.backend_id} reported its plan is out of usage${notice ? `: ${notice}` : ""}`, exhausted_until: until }))
            .run();
        }
        await logEvent(c.env.DB, {
          level: "warn", scope: "backends", event: "ladder_release", entityId: run.task_id ?? run.id,
          detail: { run_id: run.id, from: run.backend_id, next, exhausted_until: until },
        });
        return ok(c, { released: true, run_id: run.id, next_seat: next, outcome_class: "released", approval_id: null, exhausted_until: until });
      }
    }
  }

  const status = violations.length > 0 ? "failed" : reported;
  const refusalReason =
    status === "refused"
      ? JSON.stringify({ code: optionalText(ev.refusal_reason) ?? "unstated", sentence: optionalText(ev.refusal_reason) ?? "The runner declined without naming a reason." })
      : null;
  const error =
    status === "failed"
      ? violations.length > 0
        ? `FORBIDDEN_ACTION_DETECTED: ${violations.map((v: any) => String(v?.action ?? "unknown")).join(", ")}`
        : (optionalText(ev.error) ?? "The runner reported a failure and named no error.")
      : null;

  const costMicros = Number.isFinite(Number(ev.cost_micros)) ? Math.max(0, Math.floor(Number(ev.cost_micros))) : 0;
  const now = Date.now();
  const checks = ev.checks_run ?? null;

  await c.env.DB
    .prepare(
      `UPDATE backend_runs
          SET status = ?, summary = ?, files_touched = ?, commands = ?, checks_run = ?,
              remaining_risks = ?, rollback_ref = ?, cost_micros = ?, finished_at = ?,
              refusal_reason = ?, error = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      optionalText(ev.summary),
      JSON.stringify(Array.isArray(ev.files_touched) ? ev.files_touched : []),
      JSON.stringify(Array.isArray(ev.commands) ? ev.commands : []),
      checks === null ? null : JSON.stringify(checks),
      JSON.stringify(Array.isArray(ev.remaining_risks) ? ev.remaining_risks : []),
      optionalText(ev.rollback_ref),
      costMicros,
      now,
      refusalReason,
      error,
      runId,
    )
    .run();

  /*
   * A SEAT WHOSE PLAN IS OUT OF USAGE IS SKIPPED UNTIL IT RESETS (0274, 29 Sep 2026).
   *
   * The runner sets `seat_exhausted` on a packet when the CLI itself said its plan was spent. The
   * fact is written to the backend the run was on, with the time it will be tried again, and the
   * guard refuses that backend with `plan_spent` until then — so a ladder walks past it at dispatch.
   * A run of the same backend that SUCCEEDS proves the plan has usage again and clears it at once,
   * rather than making the seat wait out a cooldown it no longer needs.
   */
  const spentNotice = ev.seat_exhausted && typeof ev.seat_exhausted === "object" ? (ev.seat_exhausted as Record<string, unknown>) : null;
  if (spentNotice) {
    const until = now + spentCooldownSeconds(spentNotice.retry_after_seconds) * 1000;
    await c.env.DB
      .prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = ? WHERE id = ?`)
      .bind(until, (optionalText(spentNotice.notice) ?? "").slice(0, 300) || null, run.backend_id)
      .run();
    await logEvent(c.env.DB, {
      level: "warn", scope: "backends", event: "seat_plan_spent", entityId: run.task_id ?? run.id,
      detail: { run_id: run.id, backend_id: run.backend_id, exhausted_until: until },
    });
  } else if (status === "succeeded") {
    await c.env.DB
      .prepare(`UPDATE execution_backends SET exhausted_until = NULL, exhausted_reason = NULL WHERE id = ? AND exhausted_until IS NOT NULL`)
      .bind(run.backend_id)
      .run();
  }

  /*
   * SPEND ACCRUES AT EVERY LEVER POSITION, INCLUDING OPEN.
   *
   * Uncapped means nothing refuses on money; it has never meant nobody counts it. The window rolls
   * here rather than only on the cron, so the first spend of a new month is measured against a
   * fresh window instead of last month's total.
   */
  if (costMicros > 0) {
    const monthStart = monthWindowStart(now);
    await c.env.DB
      .prepare(
        `UPDATE execution_backends
            SET spent_micros = CASE WHEN window_started_at IS NULL OR window_started_at < ?1 THEN ?2
                                    ELSE spent_micros + ?2 END,
                window_started_at = CASE WHEN window_started_at IS NULL OR window_started_at < ?1 THEN ?1
                                         ELSE window_started_at END
          WHERE id = ?3`,
      )
      .bind(monthStart, costMicros, run.backend_id)
      .run();
  }

  let approvalId: string | null = null;
  if (run.task_id) {
    const task = await c.env.DB
      .prepare(`SELECT id, lane, title, input, cost_micros FROM tasks WHERE id = ?`).bind(run.task_id)
      .first<{ id: string; lane: string; title: string; input: string | null; cost_micros: number }>();

    if (task) {
      // EVERY RUN ENDS AS A PROPOSAL — but only a run that produced something to propose. A failure
      // and a refusal close the task with their reason instead of asking her to approve nothing.
      if (status === "succeeded") {
        const decision = runNeedsHerDecision(task.input, ev, violations);

        if (!decision.needed) {
          /*
           * DELIVERED WORK IS ACCEPTED WHERE IT LANDS. See `runNeedsHerDecision` for the rule and
           * the reason. The task closes as `done` with the acceptance recorded, and the reader's
           * morning contains a report rather than a decision about a report.
           */
          await c.env.DB.batch([
            c.env.DB.prepare(
              `UPDATE tasks SET status = 'done', finished_at = COALESCE(finished_at, ?), cost_micros = cost_micros + ? WHERE id = ?`,
            ).bind(now, costMicros, task.id),
            c.env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'auto_accepted',?)`)
              .bind(
                newId("tev"), task.id, now,
                JSON.stringify({ backend_run_id: runId, backend_id: run.backend_id, reason: decision.reason }),
              ),
          ]);
          await audit(c.env.DB, {
            actor: "system", lane: task.lane, entityType: "backend_run", entityId: runId,
            action: "backend_run_auto_accepted",
            detail: { backend_id: run.backend_id, task_id: task.id, reason: decision.reason, delivers: decision.delivers },
          }).catch(() => {});
        } else {
          approvalId = newId("apr");
          await c.env.DB.batch([
            c.env.DB.prepare(
              `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
               VALUES (?,?,?,?,'backend_run','backend_runs',?,'medium',?,'pending',?,?)`,
            ).bind(
              approvalId, task.lane, task.title,
              // The reason it is HERE leads, because an inbox card that does not say why it needs
              // her is a card she learns to clear without reading.
              `${decision.reason} — ${optionalText(ev.summary) ?? "A backend finished this run and proposes the result."}`,
              runId, JSON.stringify({ run_id: runId, backend_id: run.backend_id, task_id: task.id, why: decision.reason }),
              now, now + 7 * 24 * 60 * 60 * 1000,
            ),
            c.env.DB.prepare(`UPDATE tasks SET status = 'awaiting_approval', approval_id = ?, cost_micros = cost_micros + ? WHERE id = ?`)
              .bind(approvalId, costMicros, task.id),
          ]);
        }
      } else {
        await c.env.DB
          .prepare(`UPDATE tasks SET status = ?, finished_at = ?, error = ?, cost_micros = cost_micros + ? WHERE id = ?`)
          .bind(status === "refused" ? "cancelled" : "failed", now, error ?? optionalText(ev.refusal_reason), costMicros, task.id)
          .run();
      }

      /*
       * THE DELIVERY, WHICH IS SEPARATE FROM THE PROPOSAL. A run contracted to deliver a report
       * writes it here — immediately, whatever the approval does — because the approval is about
       * what the backend did on her machine and the report is a document she reads at 7am. See
       * `duties/deliverReport.ts` for why collapsing the two breaks one of them.
       */
      await deliverToolSuggestions(c.env, {
        taskId: task.id, runId,
        payload: (ev.delivers && typeof ev.delivers === "object" ? ev.delivers : null) as any,
        runStatus: status, now,
      }).catch(() => null);

      await deliverLinkProspects(c.env, {
        taskId: task.id, runId,
        payload: (ev.delivers && typeof ev.delivers === "object" ? ev.delivers : null) as any,
        runStatus: status, now,
      }).catch(() => null);

      // Imani's week of practice. Declared since 0192, handled since 0200 — for the eleven Sundays
      // in between the payload arrived here and matched no handler at all.
      await deliverPracticeWeek(c.env, {
        taskId: task.id, runId,
        payload: (ev.delivers && typeof ev.delivers === "object" ? ev.delivers : null) as any,
        runStatus: status, now,
      }).catch(async (err) => {
        await logEvent(c.env.DB, {
          level: "error", scope: "duties", event: "practice_delivery_failed", entityId: task.id,
          detail: { run_id: runId, error: err instanceof Error ? err.message : String(err) },
        }).catch(() => {});
        return null;
      });

      await deliverSourcingCandidates(c.env, {
        taskId: task.id,
        runId,
        payload: (ev.delivers && typeof ev.delivers === "object" ? ev.delivers : null) as any,
        runStatus: status,
        now,
      }).catch(async (err) => {
        await logEvent(c.env.DB, {
          level: "error", scope: "duties", event: "sourcing_delivery_failed", entityId: task.id,
          detail: { run_id: runId, error: err instanceof Error ? err.message : String(err) },
        }).catch(() => {});
        return null;
      });

      await deliverExecutiveReport(c.env, {
        taskId: task.id,
        runId,
        report: (ev.delivers && typeof ev.delivers === "object" ? ev.delivers : null) as any,
        // MARKETS.json as the runner observed it before the run — the dashboard is built from this,
        // never from figures the model typed. See `briefingSpec.ts`.
        marketData: (ev.market_data && typeof ev.market_data === "object" ? ev.market_data : null) as any,
        runStatus: status,
        now,
      }).catch(async (err) => {
        // A delivery that throws must not lose the run's own evidence, which is the record of what
        // touched her filesystem. Logged loudly and the report path ends there.
        await logEvent(c.env.DB, {
          level: "error", scope: "duties", event: "report_delivery_failed", entityId: task.id,
          detail: { run_id: runId, error: err instanceof Error ? err.message : String(err) },
        }).catch(() => {});
        return null;
      });

      await c.env.DB
        .prepare(
          `INSERT INTO evidence_packets
             (id, task_id, lane, ts, worker_used, estimated_cost_micros, actual_cost_micros,
              inputs_used, source_materials, actions_taken, artifacts_created, records_changed,
              checks_run, risks_remaining, unknowns, approval_needed, approval_id,
              rollback_available, next_human_action, final_status)
           VALUES (?,?,?,?,'human',0,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          newId("evd"), task.id, task.lane, now, costMicros,
          JSON.stringify({ run_id: runId, backend_id: run.backend_id, device_id: deviceId }),
          // The repository the work happened in is named on the run, not re-stated here — one place
          // holds it, so the two cannot drift.
          JSON.stringify([`backend_runs:${runId}`]),
          JSON.stringify(Array.isArray(ev.commands) ? ev.commands : []),
          // Nothing is produced as an artifact: a run ends as a proposal, not as a published thing.
          JSON.stringify([]),
          JSON.stringify(Array.isArray(ev.files_touched) ? ev.files_touched : []),
          checks === null ? null : JSON.stringify(checks),
          // A detected forbidden action is a remaining RISK as well as a failure — it is the thing
          // a person most needs to read before dispatching this backend again.
          JSON.stringify([
            ...(Array.isArray(ev.remaining_risks) ? ev.remaining_risks : []),
            ...violations.map((v: any) => `Forbidden action detected: ${String(v?.action ?? "unknown")} — ${String(v?.evidence ?? "no evidence given")}`),
          ]),
          JSON.stringify([]),
          status === "succeeded" ? 1 : 0,
          approvalId,
          ev.rollback_ref ? 1 : 0,
          status === "succeeded"
            ? "Read the evidence, then approve or reject the proposal."
            : status === "refused"
              ? "The backend declined. Read the reason before dispatching it again."
              : "The run failed. Read the error; nothing was committed, merged or deployed.",
          status,
        )
        .run();
    }
  }

  await audit(c.env.DB, {
    actor: deviceId, lane: "ops", entityType: "backend_run", entityId: runId,
    action: `reported_${status}`,
    detail: { backend_id: run.backend_id, cost_micros: costMicros, violations: violations.length, approval_id: approvalId },
  });

  return ok(c, {
    run_id: runId,
    status,
    outcome_class: outcomeClass(status),
    approval_id: approvalId,
    cost_micros: costMicros,
  });
});

backends.get("/:id", async (c) => {
  const id = c.req.param("id");
  const backend = await getBackend(c.env.DB, id);
  if (!backend) throw notFound("No backend is registered with that id");

  const [lever, lane, runs] = await Promise.all([
    spendLeverState(c.env.DB),
    laneAllowance(c.env.DB, "ops"),
    c.env.DB
      .prepare(
        `SELECT id, task_id, requested, summary, cost_micros, started_at, finished_at, status, refusal_reason
           FROM backend_runs WHERE backend_id = ? ORDER BY started_at DESC LIMIT 25`,
      )
      .bind(id)
      .all<any>(),
  ]);

  return ok(c, {
    backend: viewBackend(c.env, backend, lever),
    lever,
    lane_budget: {
      ...lane,
      // Said in dollars as well as micros, because the number that stops work should not need
      // arithmetic to read.
      remaining: lane.remaining_micros === null ? null : formatMicros(lane.remaining_micros),
    },
    runs: (runs.results ?? []).map((r: any) => ({ ...r, outcome_class: outcomeClass(r.status) })),
    route_order: ROUTE_ORDER,
  });
});

/**
 * "Would this be permitted?" — asked at the boundary, executing nothing.
 *
 * Stage 1's acceptance sentence is that a backend asked for a task kind outside its allowed list
 * is refused at the boundary AND THE REFUSAL IS RECORDED. This is where that becomes reachable: a
 * refusal writes a `backend_runs` row with `status = 'refused'`, so the decision exists in the
 * evidence table rather than only in a response body somebody has already closed.
 *
 * A PERMITTED CHECK RECORDS NOTHING, because nothing ran. A ledger of things that were allowed to
 * happen but did not is a ledger nobody can read.
 */
backends.post("/:id/check", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<any>().catch(() => null);

  const backend = await getBackend(c.env.DB, id);
  if (!backend) throw notFound("No backend is registered with that id");

  const taskKind = optionalText(body?.task_kind);
  const taskId = optionalText(body?.task_id);
  const lane = optionalText(body?.lane) ?? "ops";

  if (taskId) {
    const task = await c.env.DB.prepare(`SELECT id FROM tasks WHERE id = ?`).bind(taskId).first<{ id: string }>();
    if (!task) throw badRequest(`No task with id ${taskId}`, "Omit task_id to check without attaching the result to a task.");
  }

  const req: BackendRequest & { lane: string } = {
    lane,
    actions: stringList(body?.actions),
    requires: optionalText(body?.requires),
    sensitivity: (optionalText(body?.sensitivity) as Sensitivity | null) ?? null,
    aiProcessing: (optionalText(body?.ai_processing) as AiProcessing | null) ?? null,
    cloudForRestrictedAllowed: body?.cloud_for_restricted_allowed === true,
    model: optionalText(body?.model),
    estimatedCostMicros:
      body?.estimated_cost_micros === undefined || body?.estimated_cost_micros === null
        ? undefined
        : Number(body.estimated_cost_micros),
  };

  const verdict = await checkBackend(c.env, id, taskKind, req);

  if (!verdict.refused) {
    return ok(c, { permitted: true, backend_id: id, verdict, recorded_run_id: null });
  }

  const runId = await recordRefusal(c.env, {
    backendId: id,
    taskId,
    envelopeId: optionalText(body?.envelope_id),
    requested: JSON.stringify({ task_kind: taskKind, ...req }),
    refusal: verdict,
  });

  return ok(c, { permitted: false, backend_id: id, verdict, recorded_run_id: runId });
});

/**
 * The two things about a backend the owner may change: whether it may take work, and its sub-cap.
 *
 * Both are audited, and both require a reason — `status_reason` exists for exactly that, and a
 * ceiling moving with no recorded why is the thing this system exists to prevent.
 */
backends.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<any>().catch(() => null);
  const reason = optionalText(body?.reason);
  if (!reason) {
    throw badRequest(
      "A change to a backend needs a reason",
      "Send { reason } saying why. A backend that cannot say why it is in the state it is in reads as broken.",
    );
  }

  const status = optionalText(body?.status);
  const hasCeiling = body?.monthly_ceiling_micros !== undefined && body?.monthly_ceiling_micros !== null;
  if (!status && !hasCeiling) {
    throw badRequest(
      "Nothing to change",
      "Send { status } or { monthly_ceiling_micros }, with a reason. An empty change is not recorded as one.",
    );
  }
  if (status && !STATUSES.includes(status as BackendStatus)) {
    throw badRequest(
      `"${status}" is not a backend status`,
      `Use one of: ${STATUSES.join(", ")}. registered means known but not usable yet.`,
    );
  }

  let backend = await getBackend(c.env.DB, id);
  if (!backend) throw notFound("No backend is registered with that id");

  try {
    if (hasCeiling) {
      backend = await setMonthlyCeiling(c.env, id, Number(body.monthly_ceiling_micros), reason);
    }
    if (status) {
      backend = await setBackendStatus(c.env, id, status as BackendStatus, reason);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    asHttp(err);
  }

  const [lever, lane] = await Promise.all([spendLeverState(c.env.DB), laneAllowance(c.env.DB, "ops")]);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "execution_backend", entityId: id,
    action: "backend_patched",
    detail: { status: status ?? null, monthly_ceiling_micros: hasCeiling ? Number(body.monthly_ceiling_micros) : null, reason },
  });

  return ok(c, {
    backend: viewBackend(c.env, backend!, lever),
    lever,
    // Said back deliberately: a ceiling is a sub-cap, and quoting it alone would let a screen imply
    // the number the owner just set is the whole story about what may be spent.
    caps: {
      backend_ceiling_micros: backend!.monthly_ceiling_micros,
      lane_remaining_micros: lane.remaining_micros,
      note:
        lane.remaining_micros === null
          ? "The ops lane has no budget row, so no metered work runs whatever this ceiling says."
          : `Effective allowance is the tighter of the two: ${formatMicros(Math.min(lane.remaining_micros, backend!.monthly_ceiling_micros))}.`,
    },
  });
});

/**
 * The spend lever, over HTTP — mounted at `/api/system/spend-lever`.
 *
 * THE SERVICE IS NOT HERE. `router/spend.ts` owns the positions, the allowance, and the remedy
 * sentence every refusal quotes; this is transport over it. A second implementation of the lever
 * is the one thing that could make the guard and the router disagree about whether there is money.
 *
 * MOVING IT IS AUDITED BY THE SERVICE ITSELF — actor, lane, `entity_type = 'spend_lever'`,
 * `action = 'moved'`, and a detail carrying from, to, both MODERATE figures and what the lane hard
 * stops were set to. It is the most consequential setting change in this system, so the row is
 * written where every other authority change is written rather than in a log line.
 */
export const spendLeverRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

spendLeverRoutes.get("/", async (c) => {
  const state = await spendLeverState(c.env.DB);
  const lane = await laneAllowance(c.env.DB, "ops");
  /*
   * ─── THE ENVELOPE THE SCREEN READS, FROM THE ROUTE THE SCREEN CALLS ────────
   *
   * CONFIRMED in a browser, 19 September 2026 (hostile sweep): Settings' spend lever read
   * "The spend lever could not be read, so no position is shown above and none should be trusted"
   * on a healthy build, at every position. `api.spendLever()` calls THIS path; `leverView` reads
   * `envelope.lever.position`; this route answered the flat state, so `.lever` was undefined and
   * the panel honestly reported an unreadable lever. The validator that exists for exactly this
   * (`the-lever-she-sees-is-the-lever-that-spends.mjs`) parsed `models.get("/spend-lever")` — a
   * second route at /api/models/spend-lever that nothing in the client calls — and passed.
   *
   * So this answers the same envelope as that route (`lever`, `positions`, `lane_budgets`,
   * `backend_spend`), keeps the flat keys for anything that read them, and the validator now
   * parses the route the client's path resolves to.
   */
  const [budgets, backends] = await Promise.all([
    c.env.DB
      .prepare(`SELECT lane, period, limit_micros, spent_micros, hard_stop FROM budgets ORDER BY lane, period`)
      .all<{ lane: string; period: string; limit_micros: number; spent_micros: number; hard_stop: number }>(),
    c.env.DB
      .prepare(`SELECT id, display_name, monthly_ceiling_micros, spent_micros FROM execution_backends ORDER BY id`)
      .all<{ id: string; display_name: string; monthly_ceiling_micros: number; spent_micros: number }>(),
  ]);
  return ok(c, {
    lever: state,
    positions: SPEND_LEVER_POSITIONS,
    lane_budgets: (budgets.results ?? []).map((b) => ({
      ...b,
      spent: formatMicros(b.spent_micros),
      limit: formatMicros(b.limit_micros),
      enforcing: b.hard_stop === 1,
    })),
    backend_spend: (backends.results ?? []).map((b) => ({
      id: b.id, display_name: b.display_name,
      spent_micros: b.spent_micros, spent: formatMicros(b.spent_micros),
      own_ceiling_micros: b.monthly_ceiling_micros,
    })),
    ...state,
    // Both spellings, because the client accepts either and a rename should not break a screen.
    allowance_micros: state.allowanceMicros,
    moderate_micros: state.moderateMicros,
    moderate_source: state.moderateSource,
    lane_remaining_micros: lane.remaining_micros,
  });
});

spendLeverRoutes.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const current = await spendLeverState(c.env.DB);

  const rawPosition = b?.position === undefined || b?.position === null ? null : String(b.position);
  if (rawPosition !== null && !(SPEND_LEVER_POSITIONS as readonly string[]).includes(rawPosition)) {
    // FAIL CLOSED, LOUDLY. A misspelled position is refused rather than resolved to something —
    // resolving it silently to FREE_ONLY would look like the lever moved when it did not.
    throw badRequest(
      `"${rawPosition}" is not a lever position`,
      `Use one of: ${SPEND_LEVER_POSITIONS.join(", ")}. FREE_ONLY is $0, OPEN has no dollar ceiling at all.`,
    );
  }

  let moderateMicros: number | undefined;
  if (b?.moderate_micros !== undefined && b?.moderate_micros !== null) {
    const n = Number(b.moderate_micros);
    if (!Number.isFinite(n) || n < 0) {
      throw badRequest("A moderate allowance is a whole number of micros, zero or more", "Micros are millionths of a dollar: $25 is 25000000.");
    }
    moderateMicros = Math.floor(n);
  }

  if (rawPosition === null && moderateMicros === undefined) {
    throw badRequest("Nothing to change", "Send { position } or { moderate_micros }.");
  }

  const change = await setSpendLever(
    c.env.DB,
    { position: (rawPosition ?? current.position) as SpendLeverPosition, moderateMicros },
    "boss",
  );

  const state = await spendLeverState(c.env.DB);
  return ok(c, {
    ...state,
    allowance_micros: state.allowanceMicros,
    moderate_micros: state.moderateMicros,
    moderate_source: state.moderateSource,
    change,
  });
});
