/**
 * Phase 18 — Capability Intelligence.
 *
 * Canon §78. The registry answers one question per job type: what actually runs
 * this? Exactly one capability is active per job type, the alternatives sit on
 * the bench, and nothing on the bench executes — that distinction is the whole
 * difference between a bench and a rotation nobody is tracking.
 *
 * Two more rules are enforced here rather than described:
 *
 * §79.6 — search is trigger-based. A discovery with no trigger is tool-chasing
 *   and is refused, by name.
 * §78 — a core capability cannot be patched without an approved review. The
 *   patch is recorded either way; only the applying is gated.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { INTAKE_KINDS } from "../../shared/governance";

export const capability = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

/**
 * Roadmap §79.6's nine triggers. Search happens when one of these fires, and
 * not otherwise — the alternative is continuous tool-chasing, which canon names
 * as the failure mode.
 */
export const DISCOVERY_TRIGGERS = [
  { key: "repeated_failure", label: "The current default failed repeatedly" },
  { key: "high_value", label: "The job is high enough value to justify looking" },
  { key: "high_risk", label: "The job carries risk the default does not cover" },
  { key: "new_link_provided", label: "Something specific was put in front of the Boss" },
  { key: "scheduled_window", label: "The monthly scan or quarterly review" },
  { key: "cost_too_high", label: "The default costs more than the job is worth" },
  { key: "better_benchmark", label: "A benchmark says something else is better" },
  { key: "no_default", label: "The job type has no active default" },
  { key: "bloat", label: "Too many capabilities for one job" },
] as const;

const TRIGGER_KEYS: Set<string> = new Set(DISCOVERY_TRIGGERS.map((t) => t.key));

/**
 * The job types this build can actually run. `west_peek_bridge` is deliberately
 * absent: the Firm OS bridge lands in Phase 21, and a default pointing at
 * nothing would read as coverage.
 */
export const DEFERRED_JOB_TYPES: Record<string, { phase: number; reason: string }> = {
  west_peek_bridge: {
    phase: 21,
    reason: "The Firm OS bridge lands in Phase 21. Nothing in this build can carry a handoff across it.",
  },
};

export const SERIOUS_JOB_TYPES = INTAKE_KINDS.filter((k) => !(k in DEFERRED_JOB_TYPES));

/** How many failures in a window before a review proposes a change. */
export const FAILURE_THRESHOLD = 3;

const CRITICALITIES = new Set(["core", "standard", "experimental"]);
const PATCHABLE_FIELDS = new Set([
  "summary", "how_it_works", "cost_model", "latency_profile", "risk_class", "privacy_class",
  "criticality", "maturity", "benchmark_score", "benchmark_note", "limits", "failure_modes",
  "evidence", "inputs", "outputs", "dependencies", "name", "category",
]);

function requiredText(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(`${what} is required`);
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// ─── The registry ─────────────────────────────────────────────────────────────

capability.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT c.*, (d.job_type IS NOT NULL) AS is_default
         FROM capabilities c
    LEFT JOIN active_defaults d ON d.capability_id = c.id
        WHERE c.status <> 'retired'
        ORDER BY c.job_type, c.name`,
    )
    .all<any>();
  return ok(c, (rows.results ?? []).map((r) => ({ ...r, is_default: Boolean(r.is_default) })));
});

capability.get("/triggers", async (c) =>
  ok(c, {
    triggers: DISCOVERY_TRIGGERS,
    rule: "Roadmap §79.6: capability search runs when one of these fires. Looking without one is tool-chasing, and it is refused.",
  }),
);

/**
 * Coverage. Every serious job type either has an active default or is recorded
 * as deferred with the phase that fills it; nothing is silently uncovered.
 */
capability.get("/coverage", async (c) => {
  const defaults = await c.env.DB
    .prepare(
      `SELECT d.job_type, d.capability_id, d.reason, d.set_at, c.key, c.name, c.criticality, c.maturity
         FROM active_defaults d JOIN capabilities c ON c.id = d.capability_id`,
    )
    .all<any>();

  const byJob = Object.fromEntries((defaults.results ?? []).map((d) => [d.job_type, d]));
  const covered = SERIOUS_JOB_TYPES.filter((j) => byJob[j]);
  const uncovered = SERIOUS_JOB_TYPES.filter((j) => !byJob[j]);

  const benched = await c.env.DB
    .prepare(
      `SELECT b.job_type, b.status, c.key, c.name FROM bench_candidates b
         JOIN capabilities c ON c.id = b.capability_id WHERE b.status = 'benched'`,
    )
    .all<any>();

  return ok(c, {
    job_types: SERIOUS_JOB_TYPES.map((job) => ({
      job_type: job,
      default: byJob[job] ?? null,
      benched: (benched.results ?? []).filter((b) => b.job_type === job),
    })),
    covered: covered.length,
    uncovered,
    deferred: Object.entries(DEFERRED_JOB_TYPES).map(([job_type, d]) => ({ job_type, ...d })),
    rule: "Exactly one capability is active per job type. Everything else is benched, and nothing benched executes.",
  });
});

/** What actually runs this job. Reads the defaults only; the bench is not a fallback. */
capability.get("/resolve/:job_type", async (c) => {
  const jobType = c.req.param("job_type");

  if (jobType in DEFERRED_JOB_TYPES) {
    return ok(c, {
      job_type: jobType,
      capability: null,
      deferred: DEFERRED_JOB_TYPES[jobType],
      note: "No capability runs this yet, and none is pretended.",
    });
  }

  const row = await c.env.DB
    .prepare(
      `SELECT c.*, d.reason AS default_reason, d.set_at
         FROM active_defaults d JOIN capabilities c ON c.id = d.capability_id
        WHERE d.job_type = ?`,
    )
    .bind(jobType)
    .first<any>();

  if (!row) {
    return ok(c, {
      job_type: jobType,
      capability: null,
      note: "No active default. That is itself one of the nine discovery triggers.",
      trigger: "no_default",
    });
  }

  const benched = await c.env.DB
    .prepare(
      `SELECT c.key, c.name, b.status FROM bench_candidates b JOIN capabilities c ON c.id = b.capability_id
        WHERE b.job_type = ? AND b.status = 'benched'`,
    )
    .bind(jobType)
    .all<any>();

  return ok(c, {
    job_type: jobType,
    capability: row,
    benched: benched.results ?? [],
    note: "The benched alternatives are listed for visibility. They do not run.",
  });
});

capability.get("/:key", async (c) => {
  const cap = await c.env.DB.prepare(`SELECT * FROM capabilities WHERE key = ?`).bind(c.req.param("key")).first<any>();
  if (!cap) throw notFound("No capability with that key");

  const [isDefault, patches, reviews] = await Promise.all([
    c.env.DB.prepare(`SELECT job_type FROM active_defaults WHERE capability_id = ?`).bind(cap.id).first<{ job_type: string }>(),
    c.env.DB.prepare(`SELECT * FROM capability_patches WHERE capability_id = ? ORDER BY ts DESC LIMIT 20`).bind(cap.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM after_action_reviews WHERE capability_id = ? ORDER BY ts DESC LIMIT 10`).bind(cap.id).all<any>(),
  ]);

  return ok(c, {
    capability: {
      ...cap,
      inputs: JSON.parse(cap.inputs), outputs: JSON.parse(cap.outputs), dependencies: JSON.parse(cap.dependencies),
      limits: JSON.parse(cap.limits), failure_modes: JSON.parse(cap.failure_modes), evidence: JSON.parse(cap.evidence),
    },
    active_for: isDefault?.job_type ?? null,
    patches: patches.results ?? [],
    reviews: reviews.results ?? [],
  });
});

capability.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = requiredText(b?.key, "A key");
  const jobType = requiredText(b?.job_type, "A job type");
  if (!INTAKE_KINDS.includes(jobType as (typeof INTAKE_KINDS)[number])) {
    throw badRequest(`"${jobType}" is not a canonical job type`, `One of: ${INTAKE_KINDS.join(", ")}.`);
  }
  const criticality = optionalText(b?.criticality) ?? "standard";
  if (!CRITICALITIES.has(criticality)) throw badRequest(`"${criticality}" is not a criticality`, `One of: ${[...CRITICALITIES].join(", ")}.`);

  const existing = await c.env.DB.prepare(`SELECT key FROM capabilities WHERE key = ?`).bind(key).first();
  if (existing) throw conflict("A capability with that key already exists");

  const id = newId("cap");
  const now = Date.now();
  const jsonField = (value: unknown) => JSON.stringify(Array.isArray(value) ? value.map(String) : []);

  await c.env.DB
    .prepare(
      `INSERT INTO capabilities
         (id, key, name, category, job_type, summary, how_it_works, inputs, outputs, dependencies,
          cost_model, latency_profile, risk_class, privacy_class, criticality, maturity,
          benchmark_score, benchmark_note, limits, failure_modes, evidence, status, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'benched',1,?,?)`,
    )
    .bind(
      id, key, requiredText(b?.name, "A name"), optionalText(b?.category) ?? "tool", jobType,
      requiredText(b?.summary, "A summary"), requiredText(b?.how_it_works, "How it works"),
      jsonField(b?.inputs), jsonField(b?.outputs), jsonField(b?.dependencies),
      requiredText(b?.cost_model, "A cost model"), requiredText(b?.latency_profile, "A latency profile"),
      optionalText(b?.risk_class) ?? "low", optionalText(b?.privacy_class) ?? "private",
      criticality, optionalText(b?.maturity) ?? "candidate",
      b?.benchmark_score === undefined || b?.benchmark_score === null ? null : Number(b.benchmark_score),
      optionalText(b?.benchmark_note),
      // §78 wants the limits and the failure modes stated. A package that
      // claims no limits is a package nobody has used yet.
      JSON.stringify(Array.isArray(b?.limits) && b.limits.length ? b.limits.map(String) : (() => {
        throw badRequest("A capability states what it cannot do", "A package with no limits has not been used yet.");
      })()),
      JSON.stringify(Array.isArray(b?.failure_modes) && b.failure_modes.length ? b.failure_modes.map(String) : (() => {
        throw badRequest("A capability states how it fails");
      })()),
      jsonField(b?.evidence), now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "capability", entityId: id, action: "registered", detail: { key, job_type: jobType } });
  return ok(
    c,
    {
      capability: await c.env.DB.prepare(`SELECT * FROM capabilities WHERE id = ?`).bind(id).first(),
      note: "Registered on the bench. Nothing becomes the default by being registered.",
    },
    201,
  );
});

// ─── Defaults and the bench ───────────────────────────────────────────────────

capability.get("/defaults/all", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT d.*, c.key, c.name, c.criticality FROM active_defaults d
         JOIN capabilities c ON c.id = d.capability_id ORDER BY d.job_type`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

/** Benching an alternative. Explicitly not making it run. */
capability.post("/bench", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const jobType = requiredText(b?.job_type, "A job type");
  const key = requiredText(b?.capability_key, "A capability key");

  const cap = await c.env.DB.prepare(`SELECT id, key FROM capabilities WHERE key = ?`).bind(key).first<{ id: string; key: string }>();
  if (!cap) throw badRequest("No capability with that key");

  const current = await c.env.DB
    .prepare(`SELECT job_type FROM active_defaults WHERE capability_id = ?`).bind(cap.id).first<{ job_type: string }>();
  if (current?.job_type === jobType) throw conflict("That capability is already the active default for this job type");

  const existing = await c.env.DB
    .prepare(`SELECT id, status FROM bench_candidates WHERE job_type = ? AND capability_id = ?`)
    .bind(jobType, cap.id)
    .first<{ id: string; status: string }>();
  if (existing) throw conflict(`That capability is already ${existing.status} for this job type`);

  const id = newId("bch");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO bench_candidates (id, job_type, capability_id, status, benchmark_score, note, benched_at) VALUES (?,?,?,'benched',?,?,?)`)
    .bind(id, jobType, cap.id, b?.benchmark_score === undefined ? null : Number(b.benchmark_score), optionalText(b?.note), now)
    .run();

  return ok(c, { bench: await c.env.DB.prepare(`SELECT * FROM bench_candidates WHERE id = ?`).bind(id).first(), note: "Benched. It does not run." }, 201);
});

/**
 * Promoting a benched candidate to the default. The outgoing capability is
 * recorded, so "what did this used to be" survives the change.
 */
capability.post("/bench/:id/promote", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = requiredText(b?.reason, "A reason");

  const candidate = await c.env.DB
    .prepare(`SELECT * FROM bench_candidates WHERE id = ?`).bind(id)
    .first<{ id: string; job_type: string; capability_id: string; status: string }>();
  if (!candidate) throw notFound("No bench candidate with that id");
  if (candidate.status !== "benched") throw conflict(`That candidate was already ${candidate.status}`);

  const previous = await c.env.DB
    .prepare(`SELECT capability_id FROM active_defaults WHERE job_type = ?`).bind(candidate.job_type)
    .first<{ capability_id: string }>();

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO active_defaults (job_type, capability_id, previous_capability_id, reason, set_by, set_at)
         VALUES (?,?,?,?,'boss',?)
         ON CONFLICT(job_type) DO UPDATE SET
           capability_id = excluded.capability_id,
           previous_capability_id = excluded.previous_capability_id,
           reason = excluded.reason,
           set_by = excluded.set_by,
           set_at = excluded.set_at`,
      )
      .bind(candidate.job_type, candidate.capability_id, previous?.capability_id ?? null, reason, now),
    c.env.DB.prepare(`UPDATE bench_candidates SET status = 'promoted', decided_at = ? WHERE id = ?`).bind(now, id),
    c.env.DB.prepare(`UPDATE capabilities SET status = 'active', updated_at = ? WHERE id = ?`).bind(now, candidate.capability_id),
  ]);

  // The one it replaced goes back to the bench rather than disappearing.
  if (previous?.capability_id && previous.capability_id !== candidate.capability_id) {
    await c.env.DB
      .prepare(
        `INSERT INTO bench_candidates (id, job_type, capability_id, status, note, benched_at)
         VALUES (?,?,?,'benched',?,?)
         ON CONFLICT(job_type, capability_id) DO UPDATE SET status = 'benched', decided_at = NULL`,
      )
      .bind(newId("bch"), candidate.job_type, previous.capability_id, `Replaced as the default: ${reason}`, now)
      .run();
    await c.env.DB.prepare(`UPDATE capabilities SET status = 'benched', updated_at = ? WHERE id = ?`).bind(now, previous.capability_id).run();
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "capability", entityId: candidate.capability_id, action: "promoted_to_default",
    detail: { job_type: candidate.job_type, previous: previous?.capability_id ?? null, reason },
  });

  return ok(c, {
    job_type: candidate.job_type,
    default: await c.env.DB.prepare(`SELECT * FROM active_defaults WHERE job_type = ?`).bind(candidate.job_type).first(),
  });
});

capability.post("/bench/:id/reject", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const res = await c.env.DB
    .prepare(`UPDATE bench_candidates SET status = 'rejected', decided_at = ?, note = COALESCE(?, note) WHERE id = ? AND status = 'benched'`)
    .bind(Date.now(), optionalText(b?.reason), id)
    .run();
  if (!res.meta.changes) throw conflict("That candidate is not on the bench");
  return ok(c, await c.env.DB.prepare(`SELECT * FROM bench_candidates WHERE id = ?`).bind(id).first());
});

// ─── Discovery ────────────────────────────────────────────────────────────────

capability.get("/discovery/all", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(`SELECT * FROM discovery_inbox ${status ? "WHERE status = ?" : ""} ORDER BY ts DESC LIMIT 100`)
    .bind(...(status ? [status] : []))
    .all();
  return ok(c, rows.results ?? []);
});

/** §79.6: no trigger, no search. */
capability.post("/discovery", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const trigger = optionalText(b?.trigger);
  if (!trigger) {
    throw badRequest(
      "A capability search needs a trigger",
      `Roadmap §79.6: looking without one is continuous tool-chasing. One of: ${[...TRIGGER_KEYS].join(", ")}.`,
    );
  }
  if (!TRIGGER_KEYS.has(trigger)) {
    throw badRequest(`"${trigger}" is not one of the nine triggers`, `One of: ${[...TRIGGER_KEYS].join(", ")}.`);
  }
  const note = requiredText(b?.note, "A note");

  const id = newId("dsc");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO discovery_inbox (id, ts, trigger_key, job_type, source, link, note, evidence, status) VALUES (?,?,?,?,?,?,?,?,'new')`)
    .bind(id, now, trigger, optionalText(b?.job_type), optionalText(b?.source), optionalText(b?.link), note,
      b?.evidence === undefined ? null : JSON.stringify(b.evidence))
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM discovery_inbox WHERE id = ?`).bind(id).first(), 201);
});

capability.post("/discovery/:id/review", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const outcome = optionalText(b?.outcome) ?? "reviewed";
  if (!["reviewed", "dismissed", "actioned"].includes(outcome)) {
    throw badRequest(`"${outcome}" is not an outcome`, "One of: reviewed, dismissed, actioned.");
  }

  const res = await c.env.DB
    .prepare(`UPDATE discovery_inbox SET status = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = 'new'`)
    .bind(outcome, Date.now(), optionalText(b?.note), id)
    .run();
  if (!res.meta.changes) throw conflict("That discovery item is not new");
  return ok(c, await c.env.DB.prepare(`SELECT * FROM discovery_inbox WHERE id = ?`).bind(id).first());
});

// ─── After-action review ──────────────────────────────────────────────────────

capability.get("/reviews/all", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM after_action_reviews ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, (rows.results ?? []).map((r: any) => ({ ...r, findings: JSON.parse(r.findings), evidence: JSON.parse(r.evidence) })));
});

/**
 * Runs a review against real task traces — the tasks themselves, their events
 * and their evidence packets. It reads what happened; it does not ask anyone how
 * it went. When failures cross the threshold it proposes a patch and raises a
 * discovery item under the repeated-failure trigger.
 */
export async function runAfterActionReview(
  env: Env,
  jobType: string,
  windowStart: number,
  windowEnd: number,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const current = await env.DB
    .prepare(
      `SELECT c.id, c.key, c.name, c.criticality FROM active_defaults d
         JOIN capabilities c ON c.id = d.capability_id WHERE d.job_type = ?`,
    )
    .bind(jobType)
    .first<{ id: string; key: string; name: string; criticality: string }>();

  const tasks = await env.DB
    .prepare(
      `SELECT id, status, error, created_at, finished_at FROM tasks
        WHERE intake_kind = ? AND created_at >= ? AND created_at <= ?
        ORDER BY created_at ASC LIMIT 500`,
    )
    .bind(jobType, windowStart, windowEnd)
    .all<{ id: string; status: string; error: string | null; created_at: number; finished_at: number | null }>();

  const rows = tasks.results ?? [];
  const failures = rows.filter((t) => t.status === "failed");
  const deadLettered = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM dead_letters d
         JOIN tasks t ON t.id = d.task_id
        WHERE t.intake_kind = ? AND d.ts >= ? AND d.ts <= ?`,
    )
    .bind(jobType, windowStart, windowEnd)
    .first<{ n: number }>();

  const findings: { text: string; evidence: string[] }[] = [];
  if (failures.length > 0) {
    findings.push({
      text: `${failures.length} of ${rows.length} ${jobType} tasks failed in the window.`,
      evidence: failures.map((f) => f.id).slice(0, 20),
    });
    const errors = [...new Set(failures.map((f) => (f.error ?? "unrecorded").slice(0, 120)))];
    findings.push({ text: `Distinct failure messages: ${errors.length}.`, evidence: errors });
  }
  if ((deadLettered?.n ?? 0) > 0) {
    findings.push({ text: `${deadLettered!.n} ${jobType} task(s) exhausted their retries.`, evidence: [] });
  }
  if (rows.length === 0) {
    findings.push({ text: `No ${jobType} tasks ran in the window. Nothing to conclude.`, evidence: [] });
  }

  const reviewId = newId("aar");
  const overThreshold = failures.length >= FAILURE_THRESHOLD;
  let patchId: string | null = null;
  let discoveryId: string | null = null;

  /*
   * The write order follows the foreign keys, not the narrative: the discovery
   * item is referenced by the review, and the review is referenced by the
   * patch. Foreign keys are enforced per statement, so a row cannot be written
   * before the row it points at.
   */
  if (overThreshold && current) {
    discoveryId = newId("dsc");
    await env.DB
      .prepare(`INSERT INTO discovery_inbox (id, ts, trigger_key, job_type, source, note, evidence, status) VALUES (?,?,'repeated_failure',?,?,?,?,'new')`)
      .bind(
        discoveryId, now, jobType, "after_action_review",
        `${failures.length} failures for ${current.name} in this window. Look for an alternative.`,
        JSON.stringify({ review: reviewId, task_ids: failures.map((f) => f.id).slice(0, 20) }),
      )
      .run();
  }

  await env.DB
    .prepare(
      `INSERT INTO after_action_reviews
         (id, ts, job_type, capability_id, window_start, window_end, tasks_examined, failures, findings, evidence, outcome, patch_id, discovery_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    )
    .bind(
      reviewId, now, jobType, current?.id ?? null, windowStart, windowEnd,
      rows.length, failures.length, JSON.stringify(findings),
      JSON.stringify({ task_ids: rows.map((t) => t.id).slice(0, 50) }),
      discoveryId ? "discovery_raised" : "no_action",
      discoveryId,
    )
    .run();

  if (overThreshold && current) {
    patchId = newId("cpt");
    await env.DB
      .prepare(
        `INSERT INTO capability_patches (id, capability_id, ts, proposed_by, changes, reason, status, requires_approval, review_id)
         VALUES (?,?,?,'after_action_review',?,?,'proposed',?,?)`,
      )
      .bind(
        patchId, current.id, now,
        JSON.stringify({ maturity: "candidate" }),
        `Repeated failure: ${failures.length} failed ${jobType} tasks between ${new Date(windowStart).toISOString().slice(0, 10)} and ${new Date(windowEnd).toISOString().slice(0, 10)}.`,
        current.criticality === "core" ? 1 : 0, reviewId,
      )
      .run();

    await env.DB
      .prepare(`UPDATE after_action_reviews SET patch_id = ?, outcome = 'patch_proposed' WHERE id = ?`)
      .bind(patchId, reviewId)
      .run();
  }

  return {
    id: reviewId, job_type: jobType, capability: current ?? null,
    tasks_examined: rows.length, failures: failures.length, findings,
    outcome: patchId ? "patch_proposed" : "no_action",
    patch_id: patchId, discovery_id: discoveryId,
  };
}

capability.post("/reviews/run", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const jobType = requiredText(b?.job_type, "A job type");
  const end = b?.window_end === undefined ? Date.now() : Number(b.window_end);
  const start = b?.window_start === undefined ? end - 30 * DAY_MS : Number(b.window_start);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw badRequest("The window is two epoch millisecond timestamps");

  const review = await runAfterActionReview(c.env, jobType, start, end);
  await logEvent(c.env.DB, { level: "info", scope: "capability", event: "after_action_review", detail: { job_type: jobType, failures: review.failures } });
  return ok(c, review, 201);
});

// ─── Patches ──────────────────────────────────────────────────────────────────

capability.get("/patches/all", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.*, c.key, c.name, c.criticality FROM capability_patches p
         JOIN capabilities c ON c.id = p.capability_id ORDER BY p.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, (rows.results ?? []).map((p: any) => ({ ...p, changes: JSON.parse(p.changes) })));
});

/**
 * Proposing a patch. A core capability's patch is raised as an approval and
 * waits; anything else is applied immediately and recorded. Either way the
 * patch row is the history of what the package used to say.
 */
capability.post("/patches", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = requiredText(b?.capability_key, "A capability key");
  const reason = requiredText(b?.reason, "A reason");
  const changes = b?.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
    throw badRequest("A patch changes something", "Send { changes: { field: value } }.");
  }
  for (const field of Object.keys(changes)) {
    if (!PATCHABLE_FIELDS.has(field)) {
      throw badRequest(`"${field}" is not a patchable field`, `One of: ${[...PATCHABLE_FIELDS].join(", ")}.`);
    }
  }

  const cap = await c.env.DB
    .prepare(`SELECT id, key, name, criticality FROM capabilities WHERE key = ?`).bind(key)
    .first<{ id: string; key: string; name: string; criticality: string }>();
  if (!cap) throw badRequest("No capability with that key");

  const patchId = newId("cpt");
  const now = Date.now();
  const requiresApproval = cap.criticality === "core";

  if (requiresApproval) {
    const approvalId = newId("apr");
    // The approval is written first: the patch row references it.
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
           VALUES (?,'ops',?,?,'capability_patch','capability_patches',?,'high',?,'pending',?,?)`,
        )
        .bind(
          approvalId, `Patch a core capability: ${cap.name}`, reason, patchId,
          JSON.stringify({ patch_id: patchId, capability_id: cap.id, changes }),
          now, now + 14 * DAY_MS,
        ),
      c.env.DB
        .prepare(
          `INSERT INTO capability_patches (id, capability_id, ts, proposed_by, changes, reason, status, requires_approval, approval_id)
           VALUES (?,?,?,'boss',?,?,'proposed',1,?)`,
        )
        .bind(patchId, cap.id, now, JSON.stringify(changes), reason, approvalId),
    ]);

    await audit(c.env.DB, {
      actor: "boss", lane: "ops", entityType: "capability", entityId: cap.id, action: "patch_proposed",
      detail: { patch_id: patchId, approval_id: approvalId, criticality: cap.criticality },
    });

    return ok(
      c,
      {
        patch: await c.env.DB.prepare(`SELECT * FROM capability_patches WHERE id = ?`).bind(patchId).first(),
        approval_id: approvalId,
        note: `${cap.name} is a core capability. The patch waits for an approved review; nothing has changed yet.`,
      },
      201,
    );
  }

  await c.env.DB
    .prepare(
      `INSERT INTO capability_patches (id, capability_id, ts, proposed_by, changes, reason, status, requires_approval, applied_at)
       VALUES (?,?,?,'boss',?,?,'applied',0,?)`,
    )
    .bind(patchId, cap.id, now, JSON.stringify(changes), reason, now)
    .run();
  await applyPatchChanges(c.env, cap.id, changes, now);

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "capability", entityId: cap.id, action: "patched", detail: { patch_id: patchId, changes } });
  return ok(
    c,
    {
      patch: await c.env.DB.prepare(`SELECT * FROM capability_patches WHERE id = ?`).bind(patchId).first(),
      capability: await c.env.DB.prepare(`SELECT * FROM capabilities WHERE id = ?`).bind(cap.id).first(),
    },
    201,
  );
});

/** Applying a proposed patch by hand. A core one is refused without its approval. */
capability.post("/patches/:id/apply", async (c) => {
  const id = c.req.param("id");
  const patch = await c.env.DB
    .prepare(`SELECT * FROM capability_patches WHERE id = ?`).bind(id)
    .first<{ id: string; capability_id: string; changes: string; status: string; requires_approval: number; approval_id: string | null }>();
  if (!patch) throw notFound("No patch with that id");
  if (patch.status !== "proposed") throw conflict(`That patch is already ${patch.status}`);

  if (patch.requires_approval) {
    const approval = patch.approval_id
      ? await c.env.DB.prepare(`SELECT status FROM approvals WHERE id = ?`).bind(patch.approval_id).first<{ status: string }>()
      : null;
    if (approval?.status !== "approved") {
      throw conflict(
        "That patch changes a core capability and has not been approved",
        "Canon §78: a critical capability does not change on somebody's say-so. Decide the approval in the inbox.",
      );
    }
  }

  const now = Date.now();
  await applyPatchChanges(c.env, patch.capability_id, JSON.parse(patch.changes), now);
  await c.env.DB
    .prepare(`UPDATE capability_patches SET status = 'applied', applied_at = ? WHERE id = ?`)
    .bind(now, id)
    .run();

  return ok(c, {
    patch: await c.env.DB.prepare(`SELECT * FROM capability_patches WHERE id = ?`).bind(id).first(),
    capability: await c.env.DB.prepare(`SELECT * FROM capabilities WHERE id = ?`).bind(patch.capability_id).first(),
  });
});

/** Writes the fields a patch changes, and bumps the package version. */
export async function applyPatchChanges(
  env: Env,
  capabilityId: string,
  changes: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  const fields = Object.keys(changes).filter((f) => PATCHABLE_FIELDS.has(f));
  if (fields.length === 0) return;

  const values = fields.map((f) => {
    const value = changes[f];
    return Array.isArray(value) ? JSON.stringify(value) : (value as string | number | null);
  });

  await env.DB
    .prepare(
      `UPDATE capabilities SET ${fields.map((f) => `${f} = ?`).join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(...values, now, capabilityId)
    .run();
}

// ─── The standing cadence ─────────────────────────────────────────────────────

/**
 * The monthly scan and the quarterly review.
 *
 * Canon puts these on Phase 10's standing duties. The surviving artifact has no
 * `standing_duties` table — Phase 10's migration is not in this repository — so
 * the cadence is carried by the nightly cron, which knows the date. When Phase
 * 10's substrate exists, these become two duty rows and this function becomes
 * their handler; the behaviour does not change.
 */
export async function runCapabilityCadence(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  const date = new Date(now);
  const isMonthStart = date.getUTCDate() === 1;
  const isQuarterStart = isMonthStart && [0, 3, 6, 9].includes(date.getUTCMonth());

  if (!isMonthStart) return { ran: false, reason: "Not the first of the month" };

  const scanned: string[] = [];
  const raised: string[] = [];

  // The monthly scan: any serious job type without a default is one of the nine
  // triggers, by name.
  const defaults = await env.DB.prepare(`SELECT job_type FROM active_defaults`).all<{ job_type: string }>();
  const covered = new Set((defaults.results ?? []).map((d) => d.job_type));

  for (const jobType of SERIOUS_JOB_TYPES) {
    scanned.push(jobType);
    if (covered.has(jobType)) continue;
    const already = await env.DB
      .prepare(`SELECT id FROM discovery_inbox WHERE trigger_key = 'no_default' AND job_type = ? AND status = 'new'`)
      .bind(jobType)
      .first();
    if (already) continue;

    const id = newId("dsc");
    await env.DB
      .prepare(`INSERT INTO discovery_inbox (id, ts, trigger_key, job_type, source, note, status) VALUES (?,?,'no_default',?,'monthly_scan',?,'new')`)
      .bind(id, now, jobType, `No active default for ${jobType}. The monthly scan raised it.`)
      .run();
    raised.push(jobType);
  }

  const reviews: unknown[] = [];
  if (isQuarterStart) {
    // The quarterly review reads the last ninety days of real traces, per job
    // type that has a default.
    for (const jobType of SERIOUS_JOB_TYPES) {
      if (!covered.has(jobType)) continue;
      reviews.push(await runAfterActionReview(env, jobType, now - 90 * DAY_MS, now, now));
    }
  }

  return {
    ran: true,
    monthly_scan: { scanned: scanned.length, discoveries_raised: raised },
    quarterly_review: isQuarterStart ? { reviews: reviews.length } : null,
  };
}

capability.post("/cadence/run", async (c) => ok(c, await runCapabilityCadence(c.env), 201));
