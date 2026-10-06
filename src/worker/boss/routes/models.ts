import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { LOCAL_DEFAULT_MIN_BENCHMARKS, localModelIsProven } from "../router/policy";
import { WIRING_BY_BACKEND, adapterCredential } from "../router/backends";
import {
  SPEND_LEVER_POSITIONS, setSpendLever, spendLeverState, formatMicros,
  type SpendLeverPosition,
} from "../router/spend";
import { breakerStates, resetBreaker } from "../router/breaker";
import { BenchRefused, runBench } from "../router/bench";
import { bypassFor, isLive, predictSpend, type BypassRow } from "../router/bypass";
import { getNumber } from "../lib/settings";
import { laneAllowance } from "../backends/guard";

export const models = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Model Registry. Benchmark status is shown because it decides what may run. */
models.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT m.*, p.name AS provider_name, p.enabled AS provider_enabled,
              (SELECT COUNT(*) FROM model_benchmarks b WHERE b.model_id = m.id AND b.verdict = 'approved') AS approved_benchmarks
         FROM models m JOIN providers p ON p.id = m.provider_id
        ORDER BY p.name, m.display_name`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

models.get("/providers", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, name, base_url, api_key_var, enabled FROM providers ORDER BY name`).all();
  return ok(c, rows.results ?? []);
});

models.get("/routes", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT r.*, pm.display_name AS primary_model_name, fm.display_name AS fallback_model_name
         FROM routes r
         LEFT JOIN models pm ON pm.id = r.primary_model_id
         LEFT JOIN models fm ON fm.id = r.fallback_model_id
        ORDER BY r.lane, r.name`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

models.post("/", async (c) => {
  const b = await c.req.json<any>();
  for (const f of ["provider_id", "slug", "display_name"]) {
    if (!b?.[f]) throw badRequest(`A model needs ${f.replace(/_/g, " ")}`);
  }
  const provider = await c.env.DB
    .prepare(`SELECT id FROM providers WHERE id = ?`).bind(b.provider_id).first();
  if (!provider) throw badRequest("No provider with that id", "Register the provider first.");

  const id = b.id ?? newId("mdl");
  await c.env.DB
    .prepare(
      `INSERT INTO models (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k,
                           context_tokens, enabled, privacy_class, capability_tier, benchmark_status,
                           approved_task_kinds, forbidden_task_kinds, max_risk)
       VALUES (?,?,?,?,?,?,?,?,?,?,'unbenchmarked',?,?,?)`,
    )
    .bind(
      id, b.provider_id, b.slug, b.display_name, b.in_micros_1k ?? 0, b.out_micros_1k ?? 0,
      b.context_tokens ?? null, b.enabled === false ? 0 : 1,
      b.privacy_class ?? "cloud", b.capability_tier ?? "general",
      b.approved_task_kinds ? JSON.stringify(b.approved_task_kinds) : null,
      b.forbidden_task_kinds ? JSON.stringify(b.forbidden_task_kinds) : null,
      b.max_risk ?? "medium",
    )
    .run();
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "model", entityId: id, action: "registered" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM models WHERE id = ?`).bind(id).first(), 201);
});

/**
 * Edit a model row — and RAISING `max_risk` is a PROMOTION, gated here.
 *
 * ─── The guard that could not reach what it governed ───────────────────────
 *
 * `max_risk` is the single column that decides whether her work may run: a task classified `medium`
 * needs a model cleared to `medium`, and on 12 September 2026 none existed, so `tsk_m2bk7zfffhjatvsf`
 * failed four times without ever reaching a model. `router/index.ts` states the rule twice —
 * "raising a model's risk clearance is a PROMOTION, and §3.1 says a promotion needs benchmark
 * evidence and an approved card, not a quiet UPDATE by whoever hit the wall first" — and that rule
 * was enforced in exactly ONE place: `PATCH /routes/:id`, which governs ROUTE DEFAULTS and never
 * reads `max_risk` at all.
 *
 * So the column the rule is about was in this handler's freely-updatable list, with no gate of any
 * kind. The sentence existed; the enforcement did not reach it.
 *
 * ─── Raising is gated. LOWERING NEVER IS, and that is deliberate ───────────
 *
 * Tightening a clearance removes capability and can never widen anything, so it must stay available
 * without ceremony — a gate that made it hard to REVOKE a clearance would be a gate that keeps a bad
 * model in service. Only an increase asks for the card.
 */
const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

models.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  const allowed = [
    "display_name", "in_micros_1k", "out_micros_1k", "context_tokens", "enabled",
    "privacy_class", "capability_tier", "max_risk",
  ];
  const fields = allowed.filter((f) => f in b);
  if (!fields.length) throw badRequest("Nothing to change", `Send one of: ${allowed.join(", ")}.`);

  if ("max_risk" in b) {
    const want = String(b.max_risk);
    if (!(want in RISK_RANK)) throw badRequest("max_risk must be low, medium or high");
    const current = await c.env.DB
      .prepare(`SELECT id, display_name, max_risk FROM models WHERE id = ?`).bind(id)
      .first<{ id: string; display_name: string; max_risk: string }>();
    if (!current) throw notFound("No model with that id");

    if (RISK_RANK[want]! > (RISK_RANK[current.max_risk] ?? 0)) {
      /*
       * BOTH HALVES, THE SAME WAY THE ROUTE-DEFAULT GATE ASKS FOR THEM. Evidence that a harness
       * cannot forge — `router/bench.ts` writes `needs_review` and a test proves it can never write
       * `approved` — and a human decision recorded as a card that names this model, this column and
       * this level. Either alone is not enough, for the reasons `PATCH /routes/:id` sets out.
       */
      const distinct = await c.env.DB
        .prepare(
          `SELECT COUNT(DISTINCT workload_id) AS n FROM model_benchmarks
            WHERE model_id = ? AND verdict = 'approved'`,
        )
        .bind(id)
        .first<{ n: number }>();
      if ((distinct?.n ?? 0) < LOCAL_DEFAULT_MIN_BENCHMARKS) {
        throw conflict(
          `${current.display_name} has ${distinct?.n ?? 0} approved workload benchmark(s) and cannot be cleared to ${want} risk`,
          `A risk promotion needs ${LOCAL_DEFAULT_MIN_BENCHMARKS} approved results across distinct workloads. ` +
            "Score real runs through POST /api/models/benchmarks; the bench harness records latency and cost and never scores quality.",
        );
      }
      const card = await c.env.DB
        .prepare(
          `SELECT id FROM approvals
            WHERE kind = 'model_promotion' AND status = 'approved'
              AND json_extract(payload, '$.model_id') = ? AND json_extract(payload, '$.change') = 'max_risk'
              AND json_extract(payload, '$.to') = ?`,
        )
        // EQUALITY ON JSON FIELDS, NEVER LIKE (6 Oct 2026). `LIKE '%"model_id":"<id>"%'` built a pattern
        // longer than D1 allows for a long model id ("LIKE or GLOB pattern too complex") — the defect
        // West Peek OS #228 found in its deferrals. The payload is JSON, so it is read as JSON.
        .bind(id, want)
        .first<{ id: string }>();
      if (!card) {
        throw conflict(
          `No approved promotion card clears ${current.display_name} to ${want} risk`,
          "Raising a risk clearance is a promotion: it needs an approved card naming the model, " +
            "the change `max_risk`, and the level. Raise one and approve it in the Approval Inbox.",
        );
      }
    }
  }

  const res = await c.env.DB
    .prepare(`UPDATE models SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...fields.map((f) => b[f]), id)
    .run();
  if (!res.meta.changes) throw notFound("No model with that id");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "model", entityId: id, action: "updated", detail: fields });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM models WHERE id = ?`).bind(id).first());
});

// ─── Local Inference Bench ───────────────────────────────────────────────────

models.get("/benchmarks", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT b.*, m.display_name AS model_name, w.name AS workload_name
         FROM model_benchmarks b
         JOIN models m ON m.id = b.model_id
         JOIN workload_profiles w ON w.id = b.workload_id
        ORDER BY b.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

/**
 * Records a real benchmark result.
 *
 * A model is promoted to `benchmarked` only once it has enough approved results
 * across distinct workloads. Nothing here invents a score — the numbers come
 * from the operator scoring an actual run.
 */
models.post("/benchmarks", async (c) => {
  const b = await c.req.json<any>();
  for (const f of ["model_id", "workload_id", "quality_score", "verdict"]) {
    if (b?.[f] === undefined || b?.[f] === null) throw badRequest(`A benchmark needs ${f.replace(/_/g, " ")}`);
  }
  if (!["approved", "rejected", "needs_review"].includes(b.verdict)) {
    throw badRequest("Verdict must be approved, rejected, or needs_review");
  }
  const model = await c.env.DB.prepare(`SELECT id, privacy_class FROM models WHERE id = ?`).bind(b.model_id)
    .first<{ id: string; privacy_class: string }>();
  if (!model) throw notFound("No model with that id");
  const workload = await c.env.DB.prepare(`SELECT id FROM workload_profiles WHERE id = ?`).bind(b.workload_id).first();
  if (!workload) throw notFound("No workload profile with that id");

  const id = newId("bmk");
  await c.env.DB
    .prepare(
      `INSERT INTO model_benchmarks
         (id, ts, model_id, workload_id, quality_score, edit_burden, latency_ms, cost_micros, verdict, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, Date.now(), b.model_id, b.workload_id, b.quality_score, b.edit_burden ?? 0,
      b.latency_ms ?? 0, b.cost_micros ?? 0, b.verdict, b.note ?? null,
    )
    .run();

  const distinct = await c.env.DB
    .prepare(
      `SELECT COUNT(DISTINCT workload_id) AS n FROM model_benchmarks
        WHERE model_id = ? AND verdict = 'approved'`,
    )
    .bind(b.model_id)
    .first<{ n: number }>();

  const proven = (distinct?.n ?? 0) >= LOCAL_DEFAULT_MIN_BENCHMARKS;
  if (proven) {
    await c.env.DB.prepare(`UPDATE models SET benchmark_status = 'benchmarked' WHERE id = ?`).bind(b.model_id).run();
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "model_benchmark", entityId: id,
    action: "recorded", detail: { model_id: b.model_id, verdict: b.verdict, distinct_workloads: distinct?.n ?? 0 },
  });

  return ok(c, {
    id,
    distinct_approved_workloads: distinct?.n ?? 0,
    required: LOCAL_DEFAULT_MIN_BENCHMARKS,
    benchmark_status: proven ? "benchmarked" : "unbenchmarked",
  }, 201);
});

/**
 * Changing a route default is a PROMOTION, and a promotion is gated twice.
 *
 * Evidence AND a card. A model becomes what runs by default only when it has
 * been benchmarked — an operator-scored `approved` verdict, never a harness
 * number — and when a human has approved a `model_promotion` card naming this
 * model and this route. Either alone is not enough: evidence without approval is
 * an implementation deciding what she runs on, and approval without evidence is
 * a decision made on nothing.
 */
models.patch("/routes/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  const route = await c.env.DB.prepare(`SELECT * FROM routes WHERE id = ?`).bind(id).first<any>();
  if (!route) throw notFound("No route with that id");

  if (b.primary_model_id) {
    const model = await c.env.DB
      .prepare(`SELECT id, privacy_class, display_name, benchmark_status FROM models WHERE id = ?`)
      .bind(b.primary_model_id)
      .first<{ id: string; privacy_class: string; display_name: string; benchmark_status: string }>();
    if (!model) throw badRequest("No model with that id");
    if (model.privacy_class === "local" && !(await localModelIsProven(c.env.DB, model.id))) {
      throw conflict(
        `${model.display_name} has not earned default status yet`,
        `A local model needs ${LOCAL_DEFAULT_MIN_BENCHMARKS} approved workload benchmarks before it can be a route default.`,
      );
    }
    if (model.id !== route.primary_model_id) {
      if (model.benchmark_status !== "benchmarked") {
        throw conflict(
          `${model.display_name} is ${model.benchmark_status} and cannot become a route default`,
          "Score real benchmark runs through POST /api/models/benchmarks until the model is benchmarked. " +
            "A harness run records latency and cost; it never scores quality and never promotes.",
        );
      }
      const card = await c.env.DB
        .prepare(
          `SELECT id FROM approvals
            WHERE kind = 'model_promotion' AND status = 'approved'
              AND json_extract(payload, '$.model_id') = ? AND json_extract(payload, '$.route_id') = ?`,
        )
        .bind(model.id, id)
        .first<{ id: string }>();
      if (!card) {
        throw conflict(
          `No approved promotion card for ${model.display_name} on this route`,
          "Raise one with POST /api/models/promotions, then approve it in the Approval Inbox.",
        );
      }
    }
  }

  const allowed = ["primary_model_id", "fallback_model_id", "max_output_tokens", "temperature", "name"];
  const fields = allowed.filter((f) => f in b);
  if (!fields.length) throw badRequest("Nothing to change", `Send one of: ${allowed.join(", ")}.`);
  await c.env.DB
    .prepare(`UPDATE routes SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...fields.map((f) => b[f]), id)
    .run();
  await audit(c.env.DB, { actor: "boss", lane: route.lane, entityType: "route", entityId: id, action: "updated", detail: fields });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM routes WHERE id = ?`).bind(id).first());
});

/** Raise the promotion card. Approving it is a separate, human act. */
models.post("/promotions", async (c) => {
  const b = await c.req.json<any>();
  for (const f of ["model_id", "route_id"]) {
    if (!b?.[f]) throw badRequest(`A promotion card needs ${f.replace(/_/g, " ")}`);
  }
  const model = await c.env.DB
    .prepare(`SELECT id, display_name, benchmark_status FROM models WHERE id = ?`).bind(b.model_id)
    .first<{ id: string; display_name: string; benchmark_status: string }>();
  if (!model) throw notFound("No model with that id");
  const route = await c.env.DB.prepare(`SELECT id, lane, name FROM routes WHERE id = ?`).bind(b.route_id)
    .first<{ id: string; lane: string; name: string }>();
  if (!route) throw notFound("No route with that id");

  const id = newId("apr");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                              payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,'model_promotion','models',?,?,?,'pending',?,?)`,
    )
    .bind(
      id, route.lane, `Make ${model.display_name} the default on ${route.name}`,
      `Benchmark status: ${model.benchmark_status}. Approving this card permits the change; it does not make it.`,
      model.id, "high",
      JSON.stringify({ model_id: model.id, route_id: route.id }),
      now, now + 7 * 24 * 60 * 60 * 1000,
    )
    .run();
  await audit(c.env.DB, {
    actor: "boss", lane: route.lane, entityType: "model_promotion", entityId: id,
    action: "requested", detail: { model_id: model.id, route_id: route.id },
  });
  return ok(c, { approval_id: id, model_id: model.id, route_id: route.id }, 201);
});

// ─── Stage 4 · provisioning, the breaker, and the spend lever ────────────────
//
// THE BACKEND REGISTRY ITSELF LIVES AT /api/backends, not here. Listing them,
// commissioning one and setting a per-backend ceiling are that route's job and
// this file does not offer a second way to do any of it. What is here is what
// belongs to the model registry and the router: turning a registered backend
// into provider and model ROWS, the router's own circuit breaker, and the lever.

/**
 * Provision a backend's provider and models.
 *
 * THE HOST COMES FROM CODE, NEVER FROM THE REQUEST. `providers.base_url` is a
 * column, and a column is something a request could one day set; reading it from
 * the registry instead is what keeps the single OpenRouter egress allowlist
 * entry honest. This endpoint accepts an id and nothing else.
 */
models.post("/provision/:backendId", async (c) => {
  const id = c.req.param("backendId");
  const def = WIRING_BY_BACKEND.get(id);
  if (!def) throw notFound("No cloud backend with that id");
  const row = await c.env.DB.prepare(`SELECT id, status FROM execution_backends WHERE id = ?`).bind(id)
    .first<{ id: string; status: string }>();
  if (!row) throw notFound("That backend is not in the registry");
  if (row.status === "disabled") {
    throw conflict(
      "That backend is disabled and will not be provisioned",
      "A disabled backend is off on purpose. Change its status first if that is wrong.",
    );
  }

  await c.env.DB
    .prepare(`INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled) VALUES (?,?,?,?,1)`)
    .bind(def.providerId, def.providerName, def.baseUrl, def.credential.name)
    .run();
  /*
   * THE PROVIDER ROW MAY ALREADY EXIST, DISABLED (`prv_openai` and `prv_anthropic` are seeded off by
   * 0211/0153 until a key exists), and INSERT OR IGNORE leaves it that way — so a provisioned,
   * key-holding backend would still never be routed to. Provisioning is only reachable for a backend
   * she has already enabled, so turning its provider on is the same decision, not a new one.
   */
  await c.env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = ?`).bind(def.providerId).run();

  const written: string[] = [];
  for (const m of def.models) {
    const res = await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO models
           (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens,
            enabled, privacy_class, capability_tier, benchmark_status, max_risk)
         VALUES (?,?,?,?,?,?,?,1,'cloud',?, 'unbenchmarked','low')`,
      )
      .bind(
        m.id, def.providerId, m.slug, m.displayName, m.inMicros1k, m.outMicros1k,
        m.contextTokens, m.capabilityTier,
      )
      .run();
    if (res.meta.changes) written.push(m.id);
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "execution_backend", entityId: id,
    action: "provisioned", detail: { provider_id: def.providerId, models_added: written },
  });
  return ok(c, {
    provider_id: def.providerId,
    base_url: def.baseUrl,
    models_added: written,
    note:
      "Models arrive unbenchmarked and cleared only to low risk. They can carry continuity work and " +
      "cannot become a route default until they are benchmarked and a promotion card is approved.",
  }, 201);
});

/** Close a circuit breaker deliberately, rather than waiting out the cooldown. */
models.post("/breaker/:backendId/reset", async (c) => {
  const id = c.req.param("backendId");
  const row = await c.env.DB.prepare(`SELECT id FROM execution_backends WHERE id = ?`).bind(id).first();
  if (!row) throw notFound("No execution backend with that id");
  await resetBreaker(c.env.DB, id);
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "execution_backend", entityId: id, action: "breaker_reset",
  });
  return ok(c, { id, circuit_breaker: (await breakerStates(c.env.DB))[id] ?? null });
});

/** The spend lever, and the spend it is measured against. */
models.get("/spend-lever", async (c) => {
  const lever = await spendLeverState(c.env.DB);
  const budgets = await c.env.DB
    .prepare(`SELECT lane, period, limit_micros, spent_micros, hard_stop FROM budgets ORDER BY lane, period`)
    .all<{ lane: string; period: string; limit_micros: number; spent_micros: number; hard_stop: number }>();
  const backends = await c.env.DB
    .prepare(`SELECT id, display_name, monthly_ceiling_micros, spent_micros FROM execution_backends ORDER BY id`)
    .all<{ id: string; display_name: string; monthly_ceiling_micros: number; spent_micros: number }>();

  return ok(c, {
    lever,
    positions: SPEND_LEVER_POSITIONS,
    // Spend is readable at every position, INCLUDING OPEN. Nothing refuses on
    // these numbers while the lever is open; she still gets to see them.
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
  });
});

/**
 * Move the lever. Instantly reversible, audited, and never retroactive: dropping
 * back stops the NEXT spend and does not fail work already completed.
 */
models.put("/spend-lever", async (c) => {
  const b = await c.req.json<any>();
  const position = b?.position;
  if (!(SPEND_LEVER_POSITIONS as readonly string[]).includes(position)) {
    throw badRequest(
      `Position must be one of ${SPEND_LEVER_POSITIONS.join(", ")}`,
      "FREE_ONLY allows only routes that cost nothing. MODERATE allows paid work up to a figure you set. OPEN applies no ceiling.",
    );
  }
  let moderate: number | undefined;
  if (b.moderate_micros !== undefined) {
    const n = Number(b.moderate_micros);
    if (!Number.isFinite(n) || n < 0) {
      throw badRequest("MODERATE's figure must be a number of micros, zero or more");
    }
    moderate = Math.floor(n);
  }
  const change = await setSpendLever(c.env.DB, { position: position as SpendLeverPosition, moderateMicros: moderate }, "boss");
  return ok(c, { change, lever: await spendLeverState(c.env.DB) });
});

// ─── The per-run ceiling, and the bypass that is hers ────────────────────────

/**
 * WHAT THE CAPS ARE AND WHAT IS CURRENTLY LIFTED.
 *
 * One read, so a surface never has to assemble "what may this spend" from three places and get a
 * different answer from the router's. Every figure here is the same figure `routeCompletion`
 * consults.
 */
models.get("/caps", async (c) => {
  const perRunDefault = await getNumber(c.env.DB, "per_run_cap_micros", 750_000);
  const perRun = await bypassFor(c.env.DB, "per_run", null);
  const lanes = await c.env.DB.prepare(`SELECT id FROM lanes ORDER BY id`).all<{ id: string }>();

  const byLane = [];
  for (const l of lanes.results ?? []) {
    const allowance = await laneAllowance(c.env.DB, l.id);
    byLane.push({
      lane: l.id,
      remaining_micros: allowance.remaining_micros,
      blocked: allowance.blocked,
      blocked_period: allowance.blocked_period,
      day_bypass: (await bypassFor(c.env.DB, "day", l.id)).active,
      month_bypass: (await bypassFor(c.env.DB, "month", l.id)).active,
    });
  }

  return ok(c, {
    per_run: {
      cap_micros: perRun.active ? perRun.active.amount_micros : perRunDefault,
      default_micros: perRunDefault,
      lifted_by: perRun.active,
      note: perRun.active ? perRun.note : `Every single run stops at ${formatMicros(perRunDefault)}.`,
    },
    lanes: byLane,
  });
});

/**
 * WILL THIS PIECE OF WORK FIT? — asked BEFORE it is queued, not discovered when it dies.
 *
 * "Predict, do not just block" was half her request, and it is the half that is easy to leave out.
 * A surface can call this with what a task is estimated to cost and show "this is going to be
 * short by $0.40, and here is the bypass that would cover it" while the work is still hers to
 * change. It decides nothing and writes nothing.
 */
models.post("/caps/predict", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const estimate = Number(b?.estimate_micros);
  if (!Number.isFinite(estimate) || estimate < 0) {
    throw badRequest("estimate_micros must be a number of micros, zero or more");
  }
  const lane = typeof b?.lane === "string" && b.lane.trim() ? b.lane.trim() : "ops";
  const what = typeof b?.what === "string" && b.what.trim() ? b.what.trim() : `a run in the ${lane} lane`;

  const perRunDefault = await getNumber(c.env.DB, "per_run_cap_micros", 750_000);
  const perRun = await bypassFor(c.env.DB, "per_run", null);
  const allowance = await laneAllowance(c.env.DB, lane);

  return ok(c, {
    prediction: predictSpend({
      what,
      estimateMicros: Math.floor(estimate),
      perRunCapMicros: perRun.active ? perRun.active.amount_micros : perRunDefault,
      dayRemainingMicros: allowance.remaining_micros,
      monthRemainingMicros: null,
    }),
  });
});

models.get("/caps/bypasses", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at,
              revoked_at, revoked_reason
         FROM spend_bypass ORDER BY created_at DESC LIMIT 100`,
    )
    .all<BypassRow & { revoked_reason: string | null }>();
  const now = Date.now();
  // LIVE IS COMPUTED, NEVER STORED. A stored flag would need something to switch it off at the
  // right moment, and the thing that forgot to run is how an expired bypass outlives its reason.
  return ok(c, (rows.results ?? []).map((r) => ({ ...r, live: isLive(r, now) })));
});

/**
 * RAISE ONE. The only way over a cap, and the only place it can be done.
 *
 * ─── WHY THE ACTOR IS A CONSTANT AND NOT A PARAMETER ────────────────────────
 *
 * `raised_by` is not read from the request. It is the literal string `'owner'`, and the column
 * CHECKs that it is. The failure this shape exists to prevent is an automation granting itself
 * headroom — a duty hits a cap, something helpful writes a bypass, and the cap is decorative from
 * then on. If the actor were a field, that automation would simply put "owner" in it.
 *
 * Everything under `/api/boss` is already behind her passcode and there is exactly one human who
 * holds it (STATUS.md: "One passcode is the whole perimeter"). So the honest encoding of "only she
 * may raise one" is: this endpoint, behind that passcode, with no way to attribute the decision to
 * anybody else. A duty or a cron reaching this route would have had to steal the passcode first,
 * and at that point the bypass is not the problem.
 *
 * EVERY FIELD IS REQUIRED. There is no partial bypass, no default amount and no default expiry — a
 * missing field is a refusal, because every one of them is the thing that makes it bounded.
 */
models.post("/caps/bypass", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));

  const scope = b?.scope;
  if (scope !== "per_run" && scope !== "day" && scope !== "month") {
    throw badRequest(
      "scope must be per_run, day or month",
      "Name the cap you are lifting. A bypass that silently covered all three would be the open-ended switch this is designed not to be.",
    );
  }

  const lane = scope === "per_run" ? null : String(b?.lane ?? "").trim();
  if (scope !== "per_run") {
    if (!lane) throw badRequest("A day or month bypass must name a lane", "ops or trading.");
    const known = await c.env.DB.prepare(`SELECT id FROM lanes WHERE id = ?`).bind(lane).first();
    if (!known) throw notFound(`There is no ${lane} lane`);
  }

  const amount = Number(b?.amount_micros);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest(
      "amount_micros must be a positive number of micros",
      "A bypass names a ceiling that moved. Spending past the number you give is refused exactly as it would have been without one.",
    );
  }

  const reason = String(b?.reason ?? "").trim();
  if (reason.length < 12) {
    throw badRequest(
      "Say why, in a sentence",
      "\"urgent\" satisfies a non-empty check and tells you nothing in November. This is the same minimum a pass reason carries.",
    );
  }

  const expiresAt = Number(b?.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw badRequest(
      "expires_at must be a millisecond timestamp in the future",
      "Every bypass ends. A switch with no end is the one shape this cannot express.",
    );
  }

  const id = newId("byp");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO spend_bypass (id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at)
       VALUES (?,?,?,?,?, 'owner', ?,?)`,
    )
    .bind(id, scope, lane, Math.floor(amount), reason, now, Math.floor(expiresAt))
    .run();

  await audit(c.env.DB, {
    actor: "owner", lane: lane ?? "ops", entityType: "spend_bypass", entityId: id,
    action: "raised",
    detail: { scope, lane, amount_micros: Math.floor(amount), reason, expires_at: Math.floor(expiresAt) },
  });

  const row = await c.env.DB
    .prepare(`SELECT * FROM spend_bypass WHERE id = ?`).bind(id).first<BypassRow>();
  return ok(c, { bypass: row, note: (await bypassFor(c.env.DB, scope, lane)).note });
});

/**
 * REVOKE ONE, because she changed her mind.
 *
 * Marked rather than deleted: a decision withdrawn is still a decision taken, and the ledger rows
 * it already authorised still point at it. Effective immediately — `isLive` refuses any row with a
 * `revoked_at`, so the next spend decision is back under the cap.
 */
models.post("/caps/bypass/:id/revoke", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = String(b?.reason ?? "").trim() || "Revoked by the owner.";

  const row = await c.env.DB.prepare(`SELECT * FROM spend_bypass WHERE id = ?`).bind(id).first<BypassRow>();
  if (!row) throw notFound(`No bypass ${id}`);
  if (row.revoked_at !== null) throw conflict("That bypass was already revoked");

  await c.env.DB
    .prepare(`UPDATE spend_bypass SET revoked_at = ?, revoked_reason = ? WHERE id = ?`)
    .bind(Date.now(), reason.slice(0, 600), id)
    .run();

  await audit(c.env.DB, {
    actor: "owner", lane: row.lane ?? "ops", entityType: "spend_bypass", entityId: id,
    action: "revoked", detail: { reason },
  });

  return ok(c, { revoked: id });
});

// ─── Stage 7 · the bench ─────────────────────────────────────────────────────

/**
 * Run the golden task set.
 *
 * It runs at $0 by default and REFUSES to spend rather than quietly buying an
 * answer. Anything it cannot run for free comes back as NOT RUN with a reason,
 * and no number is written for it anywhere.
 */
models.post("/bench/run", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  try {
    const report = await runBench(c.env, {
      modelIds: Array.isArray(b?.model_ids) ? b.model_ids.map(String) : undefined,
      workloadIds: Array.isArray(b?.workload_ids) ? b.workload_ids.map(String) : undefined,
    });
    return ok(c, report, 201);
  } catch (err) {
    // A harness that examined nothing is not a passing harness.
    if (err instanceof BenchRefused) throw conflict(err.message, err.hint);
    throw err;
  }
});

/** Routing decisions, including every refusal. */
models.get("/decisions", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT d.*, m.display_name AS model_name FROM routing_decisions d
         LEFT JOIN models m ON m.id = d.chosen_model_id
        ORDER BY d.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});
