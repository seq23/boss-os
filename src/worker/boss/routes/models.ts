import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { LOCAL_DEFAULT_MIN_BENCHMARKS, localModelIsProven } from "../router/policy";

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

models.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  const allowed = [
    "display_name", "in_micros_1k", "out_micros_1k", "context_tokens", "enabled",
    "privacy_class", "capability_tier", "max_risk",
  ];
  const fields = allowed.filter((f) => f in b);
  if (!fields.length) throw badRequest("Nothing to change", `Send one of: ${allowed.join(", ")}.`);
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

/** Changing a route default enforces the bench gate for local models. */
models.patch("/routes/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  const route = await c.env.DB.prepare(`SELECT * FROM routes WHERE id = ?`).bind(id).first<any>();
  if (!route) throw notFound("No route with that id");

  if (b.primary_model_id) {
    const model = await c.env.DB
      .prepare(`SELECT id, privacy_class, display_name FROM models WHERE id = ?`).bind(b.primary_model_id)
      .first<{ id: string; privacy_class: string; display_name: string }>();
    if (!model) throw badRequest("No model with that id");
    if (model.privacy_class === "local" && !(await localModelIsProven(c.env.DB, model.id))) {
      throw conflict(
        `${model.display_name} has not earned default status yet`,
        `A local model needs ${LOCAL_DEFAULT_MIN_BENCHMARKS} approved workload benchmarks before it can be a route default.`,
      );
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
