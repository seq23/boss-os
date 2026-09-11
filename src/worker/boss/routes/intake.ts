import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { isLane } from "../../../shared/boss/lanes";
import { classify, KIND_TO_DEPARTMENT } from "../intake/classify";
import { INTAKE_KINDS } from "../../../shared/boss/governance";
import { handleBossInboundMail } from "../intake/inboundMail";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS } from "../../../shared/boss/intake/mail.mjs";

export const intake = new Hono<{ Bindings: Env; Variables: Vars }>();

// ─── Task template library ───────────────────────────────────────────────────

intake.get("/templates", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT t.*, e.name AS owner_name FROM task_templates t
         LEFT JOIN employees e ON e.id = t.owner_employee_id
        WHERE t.enabled = 1 ORDER BY t.name`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

intake.post("/templates", async (c) => {
  const b = await c.req.json<any>();
  for (const field of ["name", "intake_kind", "inputs", "output_contract", "success_criteria"]) {
    if (!b?.[field]) throw badRequest(`A template needs ${field.replace(/_/g, " ")}`);
  }
  if (!INTAKE_KINDS.includes(b.intake_kind)) {
    throw badRequest("That is not a known intake kind", `Use one of: ${INTAKE_KINDS.join(", ")}.`);
  }
  const id = newId("tpl");
  await c.env.DB
    .prepare(
      `INSERT INTO task_templates
         (id, lane, name, intake_kind, owner_employee_id, inputs, output_contract,
          approval_rule, success_criteria, prompt, enabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    )
    .bind(
      id, isLane(b.lane) ? b.lane : "ops", b.name, b.intake_kind, b.owner_employee_id ?? null,
      JSON.stringify(b.inputs), b.output_contract, b.approval_rule ?? "always",
      b.success_criteria, b.prompt ?? null, Date.now(),
    )
    .run();
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "template", entityId: id, action: "created" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM task_templates WHERE id = ?`).bind(id).first(), 201);
});

// ─── Agent Need Classifier — the No Agent Sprawl checklist ───────────────────

intake.get("/assessments", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM agent_need_assessments ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

/**
 * Runs the no-new-agent checklist.
 *
 * A new employee is justified only when the work is recurring, distinct,
 * permission-sensitive, memory-boundary-sensitive, and risk-bearing — all five —
 * and no existing employee or template already covers it. Anything less resolves
 * to an existing employee, a template, or a standing duty.
 */
intake.post("/assessments", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.request) throw badRequest("An assessment needs the request it is assessing");
  const lane = isLane(b.lane) ? b.lane : "ops";

  const classification = classify({ title: b.request, prompt: b.detail ?? null, lane });
  const department = KIND_TO_DEPARTMENT[classification.intakeKind];

  const existingEmployee = await c.env.DB
    .prepare(
      `SELECT id, name FROM employees
        WHERE lane = ? AND department = ? AND lifecycle IN ('active','provisional') AND status = 'active'
        ORDER BY created_at LIMIT 1`,
    )
    .bind(lane, department)
    .first<{ id: string; name: string }>();

  const existingTemplate = await c.env.DB
    .prepare(`SELECT id, name FROM task_templates WHERE lane = ? AND intake_kind = ? AND enabled = 1 LIMIT 1`)
    .bind(lane, classification.intakeKind)
    .first<{ id: string; name: string }>();

  const flags = {
    recurring: Boolean(b.recurring),
    distinct_domain: Boolean(b.distinct_domain),
    permission_sensitive: Boolean(b.permission_sensitive),
    memory_boundary: Boolean(b.memory_boundary),
    risk_bearing: Boolean(b.risk_bearing),
  };
  const allFive = Object.values(flags).every(Boolean);

  let outcome: string;
  let rationale: string;

  if (existingTemplate && !allFive) {
    outcome = "use_template";
    rationale = `The ${existingTemplate.name} template already covers ${classification.intakeKind} work in this lane.`;
  } else if (existingEmployee && !allFive) {
    outcome = "use_existing_employee";
    rationale = `${existingEmployee.name} already owns ${department} work. No new employee is needed.`;
  } else if (allFive && !existingEmployee) {
    outcome = "new_agent_justified";
    rationale = "The work is recurring, distinct, permission-sensitive, memory-bounded, and risk-bearing, and no existing employee covers it.";
  } else if (allFive && existingEmployee) {
    outcome = "use_existing_employee";
    rationale = `Every criterion is met, but ${existingEmployee.name} already covers ${department}. Extend its charter rather than adding an employee.`;
  } else if (flags.recurring) {
    outcome = "new_duty";
    rationale = "Recurring work that an existing employee can carry as a standing duty.";
  } else {
    outcome = "use_existing_employee";
    rationale = "One-off work. It does not justify a new employee.";
  }

  const id = newId("ana");
  await c.env.DB
    .prepare(
      `INSERT INTO agent_need_assessments
         (id, ts, request, lane, existing_employee_id, existing_template_id, recurring,
          distinct_domain, permission_sensitive, memory_boundary, risk_bearing, outcome, rationale)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, Date.now(), b.request, lane, existingEmployee?.id ?? null, existingTemplate?.id ?? null,
      flags.recurring ? 1 : 0, flags.distinct_domain ? 1 : 0, flags.permission_sensitive ? 1 : 0,
      flags.memory_boundary ? 1 : 0, flags.risk_bearing ? 1 : 0, outcome, rationale,
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane, entityType: "agent_need_assessment", entityId: id,
    action: outcome, detail: { request: b.request, flags },
  });

  return ok(c, {
    id, outcome, rationale, classification, flags,
    existing_employee: existingEmployee, existing_template: existingTemplate,
  }, 201);
});

// ─── Agent Creation Gate ─────────────────────────────────────────────────────

intake.get("/proposals", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM agent_proposals ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

const REQUIRED_PROPOSAL_FIELDS = [
  "name", "role", "purpose", "duties", "permissions", "memory_boundary",
  "approval_rules", "model_policy", "success_criteria", "retirement_criteria",
] as const;

/**
 * A proposal cannot exist without a completed assessment that justifies it, and
 * cannot be created at all without every governance field. This is where the No
 * Agent Sprawl law actually bites.
 */
intake.post("/proposals", async (c) => {
  const b = await c.req.json<any>();
  const missing = REQUIRED_PROPOSAL_FIELDS.filter((f) => !b?.[f]);
  if (missing.length) {
    throw badRequest(
      `A new employee needs ${missing.length} more field${missing.length === 1 ? "" : "s"}`,
      `Still missing: ${missing.join(", ")}. An employee without these cannot be governed.`,
    );
  }
  if (!b.assessment_id) {
    throw badRequest(
      "A new employee needs an Agent Need Assessment first",
      "POST /api/intake/assessments and attach its id as assessment_id.",
    );
  }

  const assessment = await c.env.DB
    .prepare(`SELECT * FROM agent_need_assessments WHERE id = ?`).bind(b.assessment_id)
    .first<{ id: string; outcome: string; rationale: string; lane: string }>();
  if (!assessment) throw notFound("No assessment with that id");

  const lane = isLane(b.lane) ? b.lane : assessment.lane;
  const id = newId("agp");
  const now = Date.now();

  // No Agent Sprawl: an assessment that resolved to an existing employee,
  // template, or duty blocks the proposal outright.
  if (assessment.outcome !== "new_agent_justified") {
    await c.env.DB
      .prepare(
        `INSERT INTO agent_proposals
           (id, ts, lane, name, role, purpose, duties, permissions, memory_boundary, approval_rules,
            model_policy, cost_limit_micros, success_criteria, retirement_criteria, assessment_id,
            status, decided_at, block_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'blocked',?,?)`,
      )
      .bind(
        id, now, lane, b.name, b.role, b.purpose, JSON.stringify(b.duties),
        JSON.stringify(b.permissions), b.memory_boundary, b.approval_rules, b.model_policy,
        b.cost_limit_micros ?? 0, b.success_criteria, b.retirement_criteria, assessment.id,
        now, `No Agent Sprawl: the assessment resolved to ${assessment.outcome}. ${assessment.rationale}`,
      )
      .run();

    await audit(c.env.DB, {
      actor: "system", lane, entityType: "agent_proposal", entityId: id,
      action: "blocked_no_agent_sprawl", detail: { assessment_outcome: assessment.outcome },
    });
    await logEvent(c.env.DB, {
      level: "info", scope: "intake", event: "agent_proposal_blocked", lane, entityId: id,
      detail: { outcome: assessment.outcome },
    });

    throw conflict(
      `No Agent Sprawl blocked this: the assessment says ${assessment.outcome.replace(/_/g, " ")}`,
      assessment.rationale,
    );
  }

  const aprId = newId("apr");
  // Approval first — agent_proposals.approval_id is a foreign key onto it.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,'agent_creation','agent_proposals',?,'high',?,'pending',?,?)`,
    ).bind(
      aprId, lane, `Hire ${b.name}?`, b.purpose, id,
      JSON.stringify({ proposal_id: id }), now, now + 7 * 24 * 60 * 60 * 1000,
    ),
    c.env.DB.prepare(
      `INSERT INTO agent_proposals
         (id, ts, lane, name, role, purpose, duties, permissions, memory_boundary, approval_rules,
          model_policy, cost_limit_micros, success_criteria, retirement_criteria, assessment_id,
          approval_id, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed')`,
    ).bind(
      id, now, lane, b.name, b.role, b.purpose, JSON.stringify(b.duties),
      JSON.stringify(b.permissions), b.memory_boundary, b.approval_rules, b.model_policy,
      b.cost_limit_micros ?? 0, b.success_criteria, b.retirement_criteria, assessment.id, aprId,
    ),
  ]);

  await audit(c.env.DB, {
    actor: "boss", lane, entityType: "agent_proposal", entityId: id, action: "proposed",
  });
  return ok(c, { proposal_id: id, approval_id: aprId, status: "proposed" }, 201);
});

// ─── Workload placement matrix ───────────────────────────────────────────────

intake.get("/workloads", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM workload_profiles ORDER BY name`).all();
  return ok(c, rows.results ?? []);
});

// ─── The mailbox, driven from her own session ────────────────────────────────

/**
 * `POST /api/intake/mail` — THE SAME DOOR, OPENED FROM THE INSIDE.
 *
 * ─── Why this exists, given that the book has exactly one way in ───────────
 *
 * `routes/capital.ts` states the rule and it still holds: THERE IS NO SECOND WAY INTO HER BOOK.
 * This is not one. It does not write `capital_book`, does not parse a lot and does not know what a
 * lot is — it hands a message to `handleBossInboundMail`, which is the one intake, and whatever that
 * handler does with it is what it would have done with the same message from her mail client. The
 * alternative, on the night her book had to be filed, was an `INSERT` — and a hand-inserted book
 * proves nothing about whether the feature works, which is the only question worth answering.
 *
 * ─── IT ADDS NO AUTHORISATION SURFACE, AND THAT IS THE TEST IT HAD TO PASS ──
 *
 * The sender is NOT taken from the caller. It is fixed to her own address, and the caller cannot
 * name a different one, so this can never be used to make Boss OS believe a message came from
 * somebody else. What it needs instead is the session every other route on `/api/*` needs — the
 * passcode, which is hers — and anybody holding that can already create tasks, decide approvals and
 * read the book. There is nothing here they did not already have.
 *
 * ─── AND THE ROW SAYS WHICH IT WAS ──────────────────────────────────────────
 *
 * `x-boss-intake-origin: console` makes the handler record "typed into Boss OS from her own
 * authenticated session, not received over SMTP" on the arrival row and in the audit trail. The one
 * thing this must never do is leave a row that looks like a DMARC-verified delivery that never
 * happened, in the table whose entire purpose is saying what was actually proven.
 */
intake.post("/mail", async (c) => {
  const b = await c.req.json<{ subject?: string; body?: string }>().catch(() => null);
  const subject = String(b?.subject ?? "").trim();
  const body = String(b?.body ?? "");
  if (!subject && !body.trim()) {
    throw badRequest("An empty message has nothing to route", "Send a subject, a body, or both — exactly as you would email them.");
  }

  const from = BOSS_INTAKE_SENDERS[0]!;
  const raw = `From: ${from}\r\nTo: ${BOSS_INTAKE_MAILBOX}\r\nSubject: ${subject}\r\n\r\n${body}`;
  const result = await handleBossInboundMail({
    from,
    to: BOSS_INTAKE_MAILBOX,
    headers: new Headers({
      from,
      subject,
      "x-boss-intake-origin": "console",
      /*
       * The authentication that actually happened, named as what it is. The owner was verified by
       * the session gate in front of this route, not by Cloudflare's DMARC evaluation, and the
       * string says so rather than impersonating a delivery.
       */
      "authentication-results": "boss-os-console; dmarc=pass (owner session, not SMTP)",
    }),
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
  }, c.env);

  return ok(c, result, 201);
});
