import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classify } from "../../src/worker/boss/intake/classify";
import { buildEnvelope } from "../../src/worker/boss/intake/envelope";
import { apiJson, insertTask, row } from "./helpers";

const post = (path: string, body: unknown) => apiJson(path, { method: "POST", body });

describe("Phase 2 — task intake classification", () => {
  it("routes money to an approval-gated assignment, never to notice", () => {
    const c = classify({ title: "Pay the $400 invoice from the designer" });
    expect(c.risk).toBe("high");
    expect(c.executionAssignment).toBe("AI_EXECUTE_WITH_APPROVAL");
  });

  it("escalates anything that leaves the boundary", () => {
    const c = classify({ title: "Draft and send the reply to the investor" });
    expect(["medium", "high"]).toContain(c.risk);
    expect(c.matched).toContain("outbound");
  });

  it("never lets the trading lane inherit a soft assignment", () => {
    const c = classify({ title: "Write a nice research summary", lane: "trading" });
    expect(c.intakeKind).toBe("trading");
    expect(c.executionAssignment).toBe("USER_ONLY");
    expect(c.sensitivity).toBe("restricted");
  });

  it("treats coaching context as restricted", () => {
    const c = classify({ title: "Help me rebuild my morning practice after burnout" });
    expect(c.intakeKind).toBe("coaching");
    expect(c.sensitivity).toBe("restricted");
  });

  it("honours an explicit override from the caller", () => {
    const c = classify({ title: "Look into the market", intakeKind: "decision_support", risk: "high" });
    expect(c.intakeKind).toBe("decision_support");
    expect(c.risk).toBe("high");
  });
});

describe("Phase 2 — permission envelopes", () => {
  it("denies every outward capability by default", async () => {
    const taskId = await insertTask({ status: "queued" });
    const envelope = await buildEnvelope(env.DB, {
      taskId, lane: "ops", employeeId: null,
      classification: classify({ title: "Draft a note" }), costMode: "NORMAL",
    });
    expect(envelope.external_send_allowed).toBe(0);
    expect(envelope.repo_write_allowed).toBe(0);
    expect(envelope.financial_action_allowed).toBe(0);
    expect(envelope.provider_mutation_allowed).toBe(0);
    expect(envelope.cloud_for_restricted_allowed).toBe(0);
    expect(envelope.evidence_required).toBe(1);
  });

  it("gives a shutdown cost mode no budget at all", async () => {
    const taskId = await insertTask({ status: "queued" });
    const envelope = await buildEnvelope(env.DB, {
      taskId, lane: "ops", employeeId: null,
      classification: classify({ title: "Draft a note" }), costMode: "SHUTDOWN_MANUAL",
    });
    expect(envelope.budget_micros).toBe(0);
  });

  it("caps a task at the employee's remaining daily allowance", async () => {
    await env.DB
      .prepare(`UPDATE employees SET budget_micros_day = 1000, spent_micros_day = 900 WHERE id = 'emp_chief'`)
      .run();
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });
    const envelope = await buildEnvelope(env.DB, {
      taskId, lane: "ops", employeeId: "emp_chief",
      classification: classify({ title: "Draft a note" }), costMode: "HIGH_PERFORMANCE",
    });
    expect(envelope.budget_micros).toBeLessThanOrEqual(100);
  });

  it("requires rollback for high-risk work", async () => {
    const taskId = await insertTask({ status: "queued" });
    const envelope = await buildEnvelope(env.DB, {
      taskId, lane: "ops", employeeId: null,
      classification: classify({ title: "Pay the $900 invoice" }), costMode: "NORMAL",
    });
    expect(envelope.rollback_required).toBe(1);
  });
});

describe("Phase 2 — intake admits work through the right door", () => {
  it("queues an AI_DRAFT task and attaches an envelope", async () => {
    const { status, body } = await post("/api/tasks", { title: "Draft a summary of the quarter" });
    expect(status).toBe(201);
    expect(body.data.created).toBe(true);
    expect(body.data.task.status).toBe("queued");
    expect(body.data.task.envelope_id).toBeTruthy();
    expect(body.data.envelope.approval_required).toBe(1);
  });

  it("holds USER_ONLY work as a decision rather than running it", async () => {
    const { body } = await post("/api/tasks", { title: "Buy 2 BTC", lane: "trading" });
    expect(body.data.task.status).toBe("awaiting_approval");
    expect(body.data.classification.executionAssignment).toBe("USER_ONLY");
    expect(body.data.task.approval_id).toBeTruthy();
  });

  it("refuses to cross lanes when assigning an employee", async () => {
    const { status, body } = await post("/api/tasks", {
      title: "A trading note", lane: "trading", employee_id: "emp_chief",
    });
    expect(status).toBe(409);
    expect(body.error).toContain("lane");
  });

  it("renders a template's owner and kind onto the task", async () => {
    const { body } = await post("/api/tasks", {
      title: "Dossier for Tuesday", template_id: "tpl_meeting_dossier", input: { person: "A founder" },
    });
    expect(body.data.task.template_id).toBe("tpl_meeting_dossier");
    expect(body.data.task.employee_id).toBe("emp_relationship");
  });

  it("classifies without creating anything on the preview endpoint", async () => {
    const before = await row(`SELECT COUNT(*) AS n FROM tasks`);
    const { body } = await post("/api/tasks/classify", { title: "Draft a reply to the LP" });
    const after = await row(`SELECT COUNT(*) AS n FROM tasks`);
    expect(body.data.classification.intakeKind).toBe("drafting");
    expect(after!.n).toBe(before!.n);
  });
});

describe("Phase 2 — No Agent Sprawl", () => {
  it("resolves ordinary work to an employee or template that already exists", async () => {
    const { body } = await post("/api/intake/assessments", {
      request: "Prepare meeting briefs before every call", recurring: true,
    });
    expect(body.data.outcome).not.toBe("new_agent_justified");
    expect(["use_existing_employee", "use_template", "new_duty"]).toContain(body.data.outcome);
  });

  it("blocks a proposal whose assessment did not justify a new employee", async () => {
    const assessment = await post("/api/intake/assessments", {
      request: "Write me weekly research summaries", recurring: true,
    });
    const assessmentId = assessment.body.data.id;

    const { status, body } = await post("/api/intake/proposals", {
      name: "Research Bot", role: "Research", purpose: "Summaries",
      duties: ["summarise"], permissions: { department: "Knowledge + Memory" },
      memory_boundary: "ops only", approval_rules: "always", model_policy: "route default",
      success_criteria: "useful summaries", retirement_criteria: "unused for 30 days",
      assessment_id: assessmentId,
    });

    expect(status).toBe(409);
    expect(body.error).toContain("No Agent Sprawl");
    const blocked = await row(`SELECT status FROM agent_proposals WHERE assessment_id = ?`, assessmentId);
    expect(blocked!.status).toBe("blocked");
  });

  it("refuses a proposal that is missing its governance fields", async () => {
    const { status, body } = await post("/api/intake/proposals", { name: "Half Bot", role: "Something" });
    expect(status).toBe(400);
    expect(body.hint).toContain("missing");
  });

  it("refuses a proposal with no assessment at all", async () => {
    const { status, body } = await post("/api/intake/proposals", {
      name: "Ghost", role: "R", purpose: "P", duties: ["d"], permissions: {},
      memory_boundary: "m", approval_rules: "a", model_policy: "mp",
      success_criteria: "s", retirement_criteria: "r",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("Agent Need Assessment");
  });

  it("raises an approval only when every criterion genuinely holds", async () => {
    // Coaching Faculty has no seeded employee, so the five criteria decide it.
    const assessment = await post("/api/intake/assessments", {
      request: "Rebuild my recovery practice for low energy days",
      recurring: true, distinct_domain: true, permission_sensitive: true,
      memory_boundary: true, risk_bearing: true,
    });
    const a = assessment.body.data;
    expect(a.classification.intakeKind).toBe("coaching");
    expect(a.outcome).toBe("new_agent_justified");

    const { status, body } = await post("/api/intake/proposals", {
      name: "Recovery Coach", role: "Coaching", purpose: "Recovery and energy coaching",
      duties: ["coach"], permissions: { department: "Coaching Faculty" },
      memory_boundary: "ops only", approval_rules: "always", model_policy: "route default",
      cost_limit_micros: 250000,
      success_criteria: "The Boss walks into raises prepared",
      retirement_criteria: "No sessions for 60 days",
      assessment_id: a.id,
    });
    expect(status).toBe(201);
    expect(body.data.approval_id).toBeTruthy();

    const approval = await row(`SELECT kind, risk FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval!.kind).toBe("agent_creation");
    expect(approval!.risk).toBe("high");
  });
});
