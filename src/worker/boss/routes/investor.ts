/**
 * Phase 14 — Investor OS.
 *
 * Canon §41. The load-bearing pair is the Decision Journal and the Prediction
 * Vault: a decision is challenged before it is committed, it carries a
 * falsifiable prediction, and when that prediction resolves it moves a real
 * calibration score rather than a chart.
 *
 * Deal Energy Protection is enforced here and not only in the UI. A rule that
 * only the screen keeps is a rule a curl can break.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { isLane } from "../../shared/lanes";
import { BPS, brierBps, runCalibration } from "../investor/calibration";
import { assertProtectedAction } from "../governance/gate";

export const investor = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

/** Canon §41: the pipeline is the primary object; one deal may hold focus. */
export const FOCUS_FATIGUE_MS = 30 * DAY_MS;
export const THIN_PIPELINE = 3;

export const RED_TEAM_TEMPLATE_ID = "tpl_deal_red_team";

const DEAL_KINDS = new Set(["venture", "secondary", "acquisition", "real_estate", "credit", "other"]);
const DEAL_STAGES = ["sourced", "screening", "diligence", "committed", "closed", "passed", "dead"] as const;
const ACTIVE_STAGES = ["sourced", "screening", "diligence"];
const DECISION_KINDS = new Set(["invest", "pass", "allocate", "hire", "strategic", "other"]);
const STAKES = new Set(["low", "medium", "high"]);
const VERDICTS = new Set(["proceed", "proceed_with_changes", "kill"]);
const LP_STATUSES = new Set(["prospect", "soft_circled", "committed", "closed", "passed"]);
const OPPORTUNITY_STATUSES = new Set(["open", "pursuing", "won", "lost", "dropped"]);
const EFFORTS = new Set(["low", "medium", "high"]);

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

function micros(value: unknown, what: string): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${what} is an integer number of USD micros`);
  return n;
}

function bps(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > BPS) throw badRequest(`${what} is between 0 and ${BPS} basis points`);
  return Math.round(n);
}

function stringList(value: unknown, what: string, min = 1): string[] {
  if (!Array.isArray(value)) throw badRequest(`${what} is a list`);
  const list = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (list.length < min) throw badRequest(`${what} needs at least ${min} entr${min === 1 ? "y" : "ies"}`);
  return list;
}

function renderTemplate(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? `(${key} not given)`);
}

// ─── Theses ───────────────────────────────────────────────────────────────────

investor.get("/theses", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM deals d WHERE d.thesis_id = t.id) AS deals_count
         FROM theses t ORDER BY t.created_at DESC LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

investor.post("/theses", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A thesis title");
  const statement = requiredText(b?.statement, "The thesis itself");
  // A thesis nobody can disprove is a mood. What would invalidate it is written
  // down at the same time as the claim, not after it fails.
  const invalidatedBy = requiredText(b?.invalidated_by, "What would prove this thesis wrong");

  const conviction = Number(b?.conviction ?? 50);
  if (!Number.isFinite(conviction) || conviction < 0 || conviction > 100) {
    throw badRequest("Conviction is between 0 and 100");
  }

  const id = newId("ths");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO theses (id, title, statement, domain, conviction, status, invalidated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, title, statement, optionalText(b?.domain), Math.round(conviction), b?.status === "draft" ? "draft" : "active", invalidatedBy, now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "thesis", entityId: id, action: "created", detail: { title } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM theses WHERE id = ?`).bind(id).first(), 201);
});

investor.post("/theses/:id/retire", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = requiredText(b?.reason, "A reason");
  const status = b?.invalidated ? "invalidated" : "retired";

  const res = await c.env.DB
    .prepare(`UPDATE theses SET status = ?, retired_at = ?, retired_reason = ?, updated_at = ? WHERE id = ? AND status IN ('draft','active')`)
    .bind(status, Date.now(), reason, Date.now(), id)
    .run();
  if (!res.meta.changes) throw conflict("That thesis is not live", "It may already be retired or invalidated.");

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "thesis", entityId: id, action: status, detail: { reason } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM theses WHERE id = ?`).bind(id).first());
});

// ─── Deals, and Deal Energy Protection ────────────────────────────────────────

/**
 * The pipeline first, the focused deal second. Canon §41 is explicit that this
 * ordering is the protection: a Boss reading one deal at the top of the screen
 * every morning is a Boss whose pipeline quietly emptied.
 */
investor.get("/deals", async (c) => {
  const now = Date.now();
  const [rows, byStage] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT d.*, o.name AS organization_name, p.full_name AS contact_name, t.title AS thesis_title
           FROM deals d
      LEFT JOIN organizations o ON o.id = d.organization_id
      LEFT JOIN people p ON p.id = d.person_id
      LEFT JOIN theses t ON t.id = d.thesis_id
          ORDER BY d.updated_at DESC LIMIT 200`,
      )
      .all<any>(),
    c.env.DB.prepare(`SELECT stage, COUNT(*) AS n FROM deals GROUP BY stage`).all<{ stage: string; n: number }>(),
  ]);

  const deals = rows.results ?? [];
  const stages = Object.fromEntries((byStage.results ?? []).map((r) => [r.stage, r.n]));
  const active = deals.filter((d) => ACTIVE_STAGES.includes(d.stage));
  const focus = deals.find((d) => d.energy === "focus") ?? null;
  const overdueSteps = deals.filter((d) => d.next_step_due_at && d.next_step_due_at < now && !["closed", "passed", "dead"].includes(d.stage));

  const warnings: { text: string; deal_id: string | null }[] = [];
  if (focus && active.length < THIN_PIPELINE) {
    warnings.push({
      text: `The pipeline holds ${active.length} active deal${active.length === 1 ? "" : "s"} while ${focus.name} has focus. That is single-deal dependence, not conviction.`,
      deal_id: focus.id,
    });
  }
  if (focus?.focus_since && now - focus.focus_since > FOCUS_FATIGUE_MS) {
    warnings.push({
      text: `${focus.name} has held focus for ${Math.floor((now - focus.focus_since) / DAY_MS)} days. Focus is a sprint, not a residence.`,
      deal_id: focus.id,
    });
  }
  for (const d of overdueSteps) {
    warnings.push({ text: `${d.name}: "${d.next_step}" was due ${new Date(d.next_step_due_at).toISOString().slice(0, 10)}.`, deal_id: d.id });
  }

  return ok(c, {
    // Order matters: the pipeline is the object, the focused deal hangs off it.
    pipeline: {
      by_stage: stages,
      active: active.length,
      total: deals.length,
      committed_micros: deals
        .filter((d) => ["committed", "closed"].includes(d.stage))
        .reduce((sum, d) => sum + d.check_size_micros, 0),
    },
    focus,
    energy: {
      protected: true,
      rule: "One deal may hold focus. The pipeline is read first, and a thin pipeline behind a focused deal is reported as a risk.",
      warnings,
    },
    deals,
  });
});

investor.post("/deals", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "A deal name");
  const kind = optionalText(b?.kind) ?? "venture";
  if (!DEAL_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of deal`, `One of: ${[...DEAL_KINDS].join(", ")}.`);
  const lane = isLane(b?.lane) && b.lane === "ops" ? "ops" : "ops";

  for (const [field, table] of [["organization_id", "organizations"], ["person_id", "people"], ["thesis_id", "theses"]] as const) {
    const value = optionalText(b?.[field]);
    if (!value) continue;
    const found = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(value).first();
    if (!found) throw badRequest(`No ${table.slice(0, -1)} with that id`, `Check ${field}.`);
  }

  const id = newId("del");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO deals
         (id, lane, name, kind, stage, organization_id, person_id, thesis_id,
          check_size_micros, valuation_micros, ownership_bps, energy, next_step, next_step_due_at,
          notes, opened_at, created_at, updated_at)
       VALUES (?,?,?,?,'sourced',?,?,?,?,?,?,'pipeline',?,?,?,?,?,?)`,
    )
    .bind(
      id, lane, name, kind,
      optionalText(b?.organization_id), optionalText(b?.person_id), optionalText(b?.thesis_id),
      micros(b?.check_size_micros, "check_size_micros"), micros(b?.valuation_micros, "valuation_micros"),
      b?.ownership_bps === undefined ? 0 : bps(b.ownership_bps, "ownership_bps"),
      optionalText(b?.next_step),
      b?.next_step_due_at === undefined || b?.next_step_due_at === null ? null : Number(b.next_step_due_at),
      optionalText(b?.notes), now, now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "deal", entityId: id, action: "sourced", detail: { name, kind } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first(), 201);
});

investor.patch("/deals/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");

  const deal = await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first<any>();
  if (!deal) throw notFound("No deal with that id");

  if (b.energy !== undefined) {
    throw badRequest(
      "Focus is not a field",
      "Use POST /api/investor/deals/:id/focus and /release, so the one-focused-deal rule is checked.",
    );
  }

  const updates: Record<string, string | number | null> = {};
  if (b.stage !== undefined) {
    const stage = String(b.stage);
    if (!DEAL_STAGES.includes(stage as (typeof DEAL_STAGES)[number])) {
      throw badRequest(`"${stage}" is not a deal stage`, `One of: ${DEAL_STAGES.join(", ")}.`);
    }
    updates.stage = stage;
    if (["closed", "passed", "dead"].includes(stage)) updates.decided_at = Date.now();
  }
  if (b.name !== undefined) updates.name = requiredText(b.name, "A deal name");
  if (b.next_step !== undefined) updates.next_step = optionalText(b.next_step);
  if (b.next_step_due_at !== undefined) {
    updates.next_step_due_at = b.next_step_due_at === null ? null : Number(b.next_step_due_at);
  }
  if (b.check_size_micros !== undefined) updates.check_size_micros = micros(b.check_size_micros, "check_size_micros");
  if (b.valuation_micros !== undefined) updates.valuation_micros = micros(b.valuation_micros, "valuation_micros");
  if (b.ownership_bps !== undefined) updates.ownership_bps = bps(b.ownership_bps, "ownership_bps");
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);
  if (b.thesis_id !== undefined) updates.thesis_id = optionalText(b.thesis_id);

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE deals SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), now, id)
    .run();

  // A deal that is over cannot keep the Boss's focus.
  if (typeof updates.stage === "string" && ["closed", "passed", "dead"].includes(updates.stage) && deal.energy === "focus") {
    await c.env.DB
      .prepare(`UPDATE deals SET energy = 'pipeline', focus_since = NULL, updated_at = ? WHERE id = ?`)
      .bind(now, id)
      .run();
  }

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "deal", entityId: id, action: "updated", detail: { changed: keys } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first());
});

investor.post("/deals/:id/focus", async (c) => {
  const id = c.req.param("id");
  const deal = await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first<any>();
  if (!deal) throw notFound("No deal with that id");
  if (["closed", "passed", "dead"].includes(deal.stage)) {
    throw conflict(`That deal is ${deal.stage}`, "A finished deal cannot hold your attention.");
  }
  if (deal.energy === "focus") return ok(c, deal);

  const holder = await c.env.DB
    .prepare(`SELECT id, name FROM deals WHERE energy = 'focus'`)
    .first<{ id: string; name: string }>();
  if (holder) {
    throw conflict(
      `${holder.name} already has focus`,
      "Deal Energy Protection: one deal at a time. Release that one first, and notice what releasing it costs.",
    );
  }

  const now = Date.now();
  try {
    await c.env.DB
      .prepare(`UPDATE deals SET energy = 'focus', focus_since = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id)
      .run();
  } catch (err) {
    // Two requests in the same moment both pass the check above; the partial
    // unique index is what actually decides. The loser is a refusal, not a 500.
    const holder = await c.env.DB
      .prepare(`SELECT id, name FROM deals WHERE energy = 'focus'`)
      .first<{ id: string; name: string }>();
    if (holder) {
      throw conflict(
        `${holder.name} already has focus`,
        "Deal Energy Protection: one deal at a time. Release that one first, and notice what releasing it costs.",
      );
    }
    throw err;
  }
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "deal", entityId: id, action: "focused" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first());
});

investor.post("/deals/:id/release", async (c) => {
  const id = c.req.param("id");
  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE deals SET energy = 'pipeline', focus_since = NULL, updated_at = ? WHERE id = ? AND energy = 'focus'`)
    .bind(now, id)
    .run();
  if (!res.meta.changes) throw conflict("That deal does not have focus");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "deal", entityId: id, action: "released" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM deals WHERE id = ?`).bind(id).first());
});

// ─── LPs ──────────────────────────────────────────────────────────────────────

investor.get("/lps", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT l.*, o.name AS organization_name, p.full_name AS contact_name
         FROM lps l
    LEFT JOIN organizations o ON o.id = l.organization_id
    LEFT JOIN people p ON p.id = l.person_id
        ORDER BY l.commitment_micros DESC, l.name ASC LIMIT 200`,
    )
    .all<any>();
  const list = rows.results ?? [];
  return ok(c, {
    lps: list,
    committed_micros: list.filter((l) => ["committed", "closed"].includes(l.status)).reduce((s, l) => s + l.commitment_micros, 0),
    called_micros: list.reduce((s, l) => s + l.called_micros, 0),
    distributed_micros: list.reduce((s, l) => s + l.distributed_micros, 0),
  });
});

investor.post("/lps", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "An LP name");
  const status = optionalText(b?.status) ?? "prospect";
  if (!LP_STATUSES.has(status)) throw badRequest(`"${status}" is not an LP status`, `One of: ${[...LP_STATUSES].join(", ")}.`);

  const id = newId("lp");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO lps (id, name, organization_id, person_id, status, commitment_micros, called_micros, distributed_micros, last_contact_at, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, name, optionalText(b?.organization_id), optionalText(b?.person_id), status,
      micros(b?.commitment_micros, "commitment_micros"), micros(b?.called_micros, "called_micros"),
      micros(b?.distributed_micros, "distributed_micros"),
      b?.last_contact_at === undefined || b?.last_contact_at === null ? null : Number(b.last_contact_at),
      optionalText(b?.notes), now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "lp", entityId: id, action: "created", detail: { name, status } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM lps WHERE id = ?`).bind(id).first(), 201);
});

investor.patch("/lps/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");
  const lp = await c.env.DB.prepare(`SELECT id FROM lps WHERE id = ?`).bind(id).first();
  if (!lp) throw notFound("No LP with that id");

  const updates: Record<string, string | number | null> = {};
  if (b.status !== undefined) {
    const status = String(b.status);
    if (!LP_STATUSES.has(status)) throw badRequest(`"${status}" is not an LP status`);
    updates.status = status;
  }
  if (b.commitment_micros !== undefined) updates.commitment_micros = micros(b.commitment_micros, "commitment_micros");
  if (b.called_micros !== undefined) updates.called_micros = micros(b.called_micros, "called_micros");
  if (b.distributed_micros !== undefined) updates.distributed_micros = micros(b.distributed_micros, "distributed_micros");
  if (b.last_contact_at !== undefined) updates.last_contact_at = b.last_contact_at === null ? null : Number(b.last_contact_at);
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");
  await c.env.DB
    .prepare(`UPDATE lps SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), Date.now(), id)
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM lps WHERE id = ?`).bind(id).first());
});

// ─── Opportunities ────────────────────────────────────────────────────────────

investor.get("/opportunities", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM opportunities ${status ? "WHERE status = ?" : ""}
        ORDER BY (expected_value_micros * probability_bps) DESC, created_at DESC LIMIT 200`,
    )
    .bind(...(status ? [status] : []))
    .all<any>();
  const list = rows.results ?? [];
  return ok(c, {
    opportunities: list,
    // Expected value is the point of the pipeline: a big number at 5% is not a
    // bigger opportunity than a small number that is nearly certain.
    weighted_value_micros: list
      .filter((o) => ["open", "pursuing"].includes(o.status))
      .reduce((sum, o) => sum + Math.round((o.expected_value_micros * o.probability_bps) / BPS), 0),
  });
});

investor.post("/opportunities", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "An opportunity title");
  const effort = optionalText(b?.effort) ?? "medium";
  if (!EFFORTS.has(effort)) throw badRequest(`"${effort}" is not an effort level`, `One of: ${[...EFFORTS].join(", ")}.`);

  const id = newId("opp");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO opportunities
         (id, title, kind, source, deal_id, thesis_id, expected_value_micros, probability_bps,
          effort, status, next_step, next_step_due_at, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`,
    )
    .bind(
      id, title, optionalText(b?.kind) ?? "other", optionalText(b?.source),
      optionalText(b?.deal_id), optionalText(b?.thesis_id),
      micros(b?.expected_value_micros, "expected_value_micros"),
      b?.probability_bps === undefined ? 0 : bps(b.probability_bps, "probability_bps"),
      effort, optionalText(b?.next_step),
      b?.next_step_due_at === undefined || b?.next_step_due_at === null ? null : Number(b.next_step_due_at),
      optionalText(b?.notes), now, now,
    )
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM opportunities WHERE id = ?`).bind(id).first(), 201);
});

investor.patch("/opportunities/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");
  const existing = await c.env.DB.prepare(`SELECT id FROM opportunities WHERE id = ?`).bind(id).first();
  if (!existing) throw notFound("No opportunity with that id");

  const updates: Record<string, string | number | null> = {};
  if (b.status !== undefined) {
    const status = String(b.status);
    if (!OPPORTUNITY_STATUSES.has(status)) throw badRequest(`"${status}" is not an opportunity status`);
    updates.status = status;
    if (["won", "lost", "dropped"].includes(status)) updates.closed_at = Date.now();
  }
  if (b.probability_bps !== undefined) updates.probability_bps = bps(b.probability_bps, "probability_bps");
  if (b.expected_value_micros !== undefined) updates.expected_value_micros = micros(b.expected_value_micros, "expected_value_micros");
  if (b.next_step !== undefined) updates.next_step = optionalText(b.next_step);
  if (b.next_step_due_at !== undefined) updates.next_step_due_at = b.next_step_due_at === null ? null : Number(b.next_step_due_at);
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");
  await c.env.DB
    .prepare(`UPDATE opportunities SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), Date.now(), id)
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM opportunities WHERE id = ?`).bind(id).first());
});

// ─── Decision Journal ─────────────────────────────────────────────────────────

investor.get("/decisions", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(
      `SELECT d.*, dl.name AS deal_name,
              (SELECT COUNT(*) FROM predictions p WHERE p.decision_id = d.id) AS predictions_count,
              (SELECT COUNT(*) FROM predictions p WHERE p.decision_id = d.id AND p.status = 'open') AS predictions_open,
              (SELECT COUNT(*) FROM red_team_reviews r WHERE r.decision_id = d.id) AS challenges
         FROM decisions d
    LEFT JOIN deals dl ON dl.id = d.deal_id
        ${status ? "WHERE d.status = ?" : ""}
        ORDER BY d.created_at DESC LIMIT 200`,
    )
    .bind(...(status ? [status] : []))
    .all();
  return ok(c, rows.results ?? []);
});

investor.post("/decisions", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A decision title");
  const context = requiredText(b?.context, "The context");

  // Two options minimum. One option is not a decision, it is a plan with a
  // justification attached.
  if (!Array.isArray(b?.options) || b.options.length < 2) {
    throw badRequest("A decision needs at least two options", "One option is not a decision. Write down what you are not doing.");
  }
  const options = b.options.map((o: any) => {
    const option = String(typeof o === "string" ? o : o?.option ?? "").trim();
    if (!option) throw badRequest("An empty option is not an option");
    return { option, why: optionalText(o?.why), why_not: optionalText(o?.why_not) };
  });

  const kind = optionalText(b?.kind) ?? "other";
  if (!DECISION_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of decision`, `One of: ${[...DECISION_KINDS].join(", ")}.`);
  const stakes = optionalText(b?.stakes) ?? "medium";
  if (!STAKES.has(stakes)) throw badRequest(`"${stakes}" is not a stakes level`, `One of: ${[...STAKES].join(", ")}.`);

  if (b?.deal_id) {
    const deal = await c.env.DB.prepare(`SELECT id FROM deals WHERE id = ?`).bind(String(b.deal_id)).first();
    if (!deal) throw badRequest("No deal with that id");
  }

  const id = newId("dec");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO decisions
         (id, lane, title, context, options, kind, stakes, reversible, deal_id, thesis_id, status, review_at, created_at, updated_at)
       VALUES (?,'ops',?,?,?,?,?,?,?,?,'draft',?,?,?)`,
    )
    .bind(
      id, title, context, JSON.stringify(options), kind, stakes,
      b?.reversible === false ? 0 : 1,
      optionalText(b?.deal_id), optionalText(b?.thesis_id),
      b?.review_at === undefined || b?.review_at === null ? null : Number(b.review_at),
      now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "decision", entityId: id, action: "opened", detail: { title, stakes } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first(), 201);
});

investor.get("/decisions/:id", async (c) => {
  const id = c.req.param("id");
  const decision = await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first<any>();
  if (!decision) throw notFound("No decision with that id");

  const [reviews, predictions] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM red_team_reviews WHERE decision_id = ? ORDER BY ts DESC`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM predictions WHERE decision_id = ? ORDER BY resolves_at ASC`).bind(id).all<any>(),
  ]);

  return ok(c, {
    decision: {
      ...decision,
      options: JSON.parse(decision.options ?? "[]"),
      outcome: decision.outcome ? JSON.parse(decision.outcome) : null,
      red_team_override: decision.red_team_override ? JSON.parse(decision.red_team_override) : null,
    },
    red_team: (reviews.results ?? []).map((r) => ({
      ...r,
      ways_this_loses: JSON.parse(r.ways_this_loses ?? "[]"),
      disconfirming_evidence: JSON.parse(r.disconfirming_evidence ?? "[]"),
      changes_required: r.changes_required ? JSON.parse(r.changes_required) : [],
    })),
    predictions: predictions.results ?? [],
  });
});

/**
 * The precommit red-team challenge — canon §41.
 *
 * It runs against a decision that has not been committed, because a challenge
 * after the money moved is a post-mortem. Its three fields are the output
 * contract `tpl_deal_red_team` already names, and the template is recorded as
 * the generator.
 */
investor.post("/decisions/:id/red-team", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("A red-team review needs a body");

  const decision = await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first<any>();
  if (!decision) throw notFound("No decision with that id");
  if (decision.status !== "draft") {
    throw conflict(
      `That decision is already ${decision.status}`,
      "The red team challenges a decision before it is committed. After that it is a post-mortem, and belongs in the outcome.",
    );
  }

  const ways = stringList(b.ways_this_loses, "The ways this loses", 3);
  const evidence = stringList(b.disconfirming_evidence, "Disconfirming evidence", 1);
  const walkAway = requiredText(b.walk_away_line, "The walk-away line");
  const verdict = requiredText(b.verdict, "A verdict");
  if (!VERDICTS.has(verdict)) throw badRequest(`"${verdict}" is not a verdict`, `One of: ${[...VERDICTS].join(", ")}.`);
  const changes = b.changes_required === undefined ? [] : stringList(b.changes_required, "Changes required", 0);
  if (verdict === "proceed_with_changes" && changes.length === 0) {
    throw badRequest("Proceeding with changes needs the changes", "Name them, or the verdict is just 'proceed'.");
  }

  const template = await c.env.DB
    .prepare(`SELECT id, prompt FROM task_templates WHERE id = ? AND enabled = 1`)
    .bind(RED_TEAM_TEMPLATE_ID)
    .first<{ id: string; prompt: string | null }>();

  const id_ = newId("rtr");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO red_team_reviews
         (id, decision_id, template_id, challenger, ts, ways_this_loses, disconfirming_evidence,
          walk_away_line, verdict, changes_required, prompt, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id_, id, template?.id ?? null, optionalText(b.challenger) ?? "boss", now,
      JSON.stringify(ways), JSON.stringify(evidence), walkAway, verdict,
      JSON.stringify(changes),
      template?.prompt ? renderTemplate(template.prompt, { deal: `${decision.title} — ${decision.context}` }) : null,
      now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "decision", entityId: id, action: "red_teamed", detail: { verdict } });
  await logEvent(c.env.DB, { level: "info", scope: "investor", event: "red_team_recorded", entityId: id, detail: { verdict } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM red_team_reviews WHERE id = ?`).bind(id_).first(), 201);
});

/**
 * Commitment. Three gates, all of them canon §41's:
 *
 * - it has been challenged, and a `kill` verdict may only be overridden in
 *   writing, on the record;
 * - anything above low stakes carries a falsifiable prediction, because the
 *   Decision Journal and the Prediction Vault only compound as a pair;
 * - the option chosen is one of the options that were actually written down.
 */
investor.post("/decisions/:id/commit", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Committing needs a body", "Send { chosen_option, rationale }.");

  const decision = await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first<any>();
  if (!decision) throw notFound("No decision with that id");
  if (decision.status !== "draft") throw conflict(`That decision is already ${decision.status}`);

  // Canon §18: committing judgement is a protected action.
  await assertProtectedAction(c.env, "decision_commit", { type: "decision", id });

  const chosen = requiredText(b.chosen_option, "The option you are choosing");
  const rationale = requiredText(b.rationale, "The rationale");
  const options: { option: string }[] = JSON.parse(decision.options ?? "[]");
  if (!options.some((o) => o.option === chosen)) {
    throw badRequest(
      `"${chosen}" is not one of the options`,
      `The options recorded were: ${options.map((o) => o.option).join(", ")}.`,
    );
  }

  const latest = await c.env.DB
    .prepare(`SELECT id, verdict FROM red_team_reviews WHERE decision_id = ? ORDER BY ts DESC LIMIT 1`)
    .bind(id)
    .first<{ id: string; verdict: string }>();
  if (!latest) {
    throw conflict(
      "That decision has not been challenged",
      "Canon §41: the red team runs before commitment. POST /api/investor/decisions/:id/red-team first.",
    );
  }

  let override: { verdict: string; reason: string; review_id: string } | null = null;
  if (latest.verdict === "kill") {
    const reason = optionalText(b.override_reason);
    if (!reason) {
      throw conflict(
        "The red team's verdict was to kill this",
        "You can still commit, but the override goes on the record: send override_reason.",
      );
    }
    override = { verdict: latest.verdict, reason, review_id: latest.id };
  }

  const predictions = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM predictions WHERE decision_id = ?`)
    .bind(id)
    .first<{ n: number }>();
  if ((predictions?.n ?? 0) === 0 && decision.stakes !== "low") {
    throw conflict(
      `A ${decision.stakes}-stakes decision commits with a prediction`,
      "Write down what you expect to be true, by when, and how you will know. POST /api/investor/predictions.",
    );
  }

  const now = Date.now();
  await c.env.DB
    .prepare(
      `UPDATE decisions
          SET status = 'committed', chosen_option = ?, rationale = ?, committed_at = ?,
              review_at = COALESCE(?, review_at), red_team_override = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      chosen, rationale, now,
      b.review_at === undefined || b.review_at === null ? null : Number(b.review_at),
      override ? JSON.stringify(override) : null, now, id,
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "decision", entityId: id, action: "committed",
    detail: { chosen, red_team_verdict: latest.verdict, overridden: Boolean(override) },
  });
  await logEvent(c.env.DB, {
    level: override ? "warn" : "info", scope: "investor", event: "decision_committed", entityId: id,
    detail: { overridden: Boolean(override) },
  });

  return ok(c, await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first());
});

investor.post("/decisions/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  const summary = requiredText(b?.summary, "What actually happened");
  const lesson = optionalText(b?.lesson);

  const decision = await c.env.DB.prepare(`SELECT status FROM decisions WHERE id = ?`).bind(id).first<{ status: string }>();
  if (!decision) throw notFound("No decision with that id");
  if (decision.status !== "committed") {
    throw conflict(`That decision is ${decision.status}`, "Only a committed decision has an outcome to record.");
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE decisions SET status = 'resolved', outcome = ?, outcome_recorded_at = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify({ summary, lesson }), now, now, id)
    .run();

  const open = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM predictions WHERE decision_id = ? AND status = 'open'`)
    .bind(id)
    .first<{ n: number }>();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "decision", entityId: id, action: "resolved" });
  return ok(c, {
    decision: await c.env.DB.prepare(`SELECT * FROM decisions WHERE id = ?`).bind(id).first(),
    // Recording the outcome does not settle the forecasts. Saying so beats
    // letting a resolved decision imply its predictions were scored.
    predictions_still_open: open?.n ?? 0,
  });
});

// ─── Prediction Vault ─────────────────────────────────────────────────────────

investor.get("/predictions", async (c) => {
  const status = c.req.query("status") ?? "open";
  const rows = await c.env.DB
    .prepare(
      `SELECT p.*, d.title AS decision_title FROM predictions p
    LEFT JOIN decisions d ON d.id = p.decision_id
        WHERE p.status = ? ORDER BY p.resolves_at ASC LIMIT 200`,
    )
    .bind(status)
    .all();
  return ok(c, rows.results ?? []);
});

investor.post("/predictions", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const statement = requiredText(b?.statement, "The prediction");
  const criteria = requiredText(b?.resolution_criteria, "How this will be settled");
  const probability = bps(b?.probability_bps, "probability_bps");
  if (probability === 0 || probability === BPS) {
    throw badRequest(
      "A forecast of 0% or 100% is a claim of certainty",
      "Certainty is not a forecast, and it scores as badly as it should when it is wrong. Use a number in between.",
    );
  }

  const resolvesAt = Number(b?.resolves_at);
  if (!Number.isFinite(resolvesAt)) throw badRequest("resolves_at is an epoch millisecond timestamp");
  if (resolvesAt <= Date.now()) {
    throw badRequest("A prediction resolves in the future", "A forecast about the past is a memory.");
  }

  const decisionId = optionalText(b?.decision_id);
  if (decisionId) {
    const decision = await c.env.DB
      .prepare(`SELECT id, status FROM decisions WHERE id = ?`).bind(decisionId)
      .first<{ id: string; status: string }>();
    if (!decision) throw badRequest("No decision with that id");
    if (decision.status === "resolved" || decision.status === "abandoned") {
      throw conflict(`That decision is ${decision.status}`, "Predictions are made before the fact, not attached after it.");
    }
  }

  const id = newId("prd");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO predictions
         (id, decision_id, statement, probability_bps, resolution_criteria, resolves_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'open',?,?)`,
    )
    .bind(id, decisionId, statement, probability, criteria, resolvesAt, now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "prediction", entityId: id, action: "recorded", detail: { probability_bps: probability } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM predictions WHERE id = ?`).bind(id).first(), 201);
});

/**
 * Resolution. This is where the vault earns its keep: the Brier contribution is
 * computed and stored, and the calibration score is recomputed from every
 * resolved prediction, so the number on the screen moved because this forecast
 * moved it.
 */
investor.post("/predictions/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  const outcome = String(b?.outcome ?? "");
  if (!["true", "false", "ambiguous"].includes(outcome)) {
    throw badRequest(`"${outcome}" is not an outcome`, "One of: true, false, ambiguous.");
  }

  const prediction = await c.env.DB.prepare(`SELECT * FROM predictions WHERE id = ?`).bind(id).first<any>();
  if (!prediction) throw notFound("No prediction with that id");
  if (prediction.status !== "open") throw conflict(`That prediction is already ${prediction.status}`);

  const now = Date.now();
  const brier = outcome === "ambiguous" ? null : brierBps(prediction.probability_bps, outcome as "true" | "false");

  await c.env.DB
    .prepare(
      `UPDATE predictions
          SET status = 'resolved', outcome = ?, resolved_at = ?, resolution_note = ?, brier_bps = ?, updated_at = ?
        WHERE id = ? AND status = 'open'`,
    )
    .bind(outcome, now, optionalText(b?.note), brier, now, id)
    .run();

  const calibration = await runCalibration(c.env.DB, {}, now);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "prediction", entityId: id, action: "resolved",
    detail: { outcome, brier_bps: brier },
  });
  await logEvent(c.env.DB, {
    level: "info", scope: "investor", event: "prediction_resolved", entityId: id,
    detail: { outcome, brier_bps: brier, brier_score_bps: calibration.brier_score_bps },
  });

  return ok(c, {
    prediction: await c.env.DB.prepare(`SELECT * FROM predictions WHERE id = ?`).bind(id).first(),
    calibration,
  });
});

// ─── Calibration ──────────────────────────────────────────────────────────────

investor.get("/calibration", async (c) => {
  const [latest, open, overdue] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM calibrations ORDER BY ts DESC LIMIT 1`).first<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM predictions WHERE status = 'open'`).first<{ n: number }>(),
    c.env.DB
      .prepare(`SELECT * FROM predictions WHERE status = 'open' AND resolves_at < ? ORDER BY resolves_at ASC LIMIT 20`)
      .bind(Date.now())
      .all<any>(),
  ]);

  return ok(c, {
    latest: latest
      ? { ...latest, buckets: JSON.parse(latest.buckets ?? "[]"), detail: latest.detail ? JSON.parse(latest.detail) : null }
      : null,
    note: latest
      ? null
      : "Nothing has been scored yet. A calibration score appears when the first prediction resolves.",
    open_predictions: open?.n ?? 0,
    // A prediction past its date and unresolved is the failure mode of a
    // prediction vault: it quietly stops being scored.
    due_for_resolution: overdue.results ?? [],
  });
});

investor.post("/calibration/run", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const start = b?.window_start === undefined || b?.window_start === null ? undefined : Number(b.window_start);
  const end = b?.window_end === undefined || b?.window_end === null ? undefined : Number(b.window_end);
  const calibration = await runCalibration(c.env.DB, { start, end });
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "calibration", entityId: calibration.id, action: "run", detail: { scored: calibration.predictions_scored } });
  return ok(c, calibration, 201);
});
