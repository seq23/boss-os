import type {
  ExecutionAssignment,
  IntakeKind,
  RiskLevel,
  Sensitivity,
} from "../../../shared/boss/governance";
import { isIntakeKind } from "../../../shared/boss/governance";

/**
 * The Task Intake Engine, checklist slice.
 *
 * Classification is deterministic and runs before any model is chosen. Calling a
 * model to decide whether to call a model costs money and adds a failure mode,
 * and the roadmap only asks for a checklist here. The caller may always override
 * the classification explicitly.
 */

export interface Classification {
  intakeKind: IntakeKind;
  risk: RiskLevel;
  sensitivity: Sensitivity;
  executionAssignment: ExecutionAssignment;
  reason: string;
  matched: string[];
}

interface Rule {
  kind: IntakeKind;
  /** Lower runs first; the first rule that matches wins. */
  order: number;
  risk: RiskLevel;
  sensitivity: Sensitivity;
  assignment: ExecutionAssignment;
  terms: RegExp;
  reason: string;
}

// Ordered most-specific first. High-consequence categories are matched before
// the general drafting/research buckets so a "wire the money" request can never
// fall through to AI_DRAFT.
const RULES: Rule[] = [
  {
    kind: "trading",
    order: 10,
    risk: "high",
    sensitivity: "restricted",
    assignment: "USER_ONLY",
    terms: /\b(trade|trading|order|position|portfolio|allocation|exchange|broker|ticker|long|short|buy|sell)\b/i,
    reason: "Trading lane work. No model receives execution authority here.",
  },
  {
    kind: "new_agent_proposal",
    order: 20,
    risk: "high",
    sensitivity: "private",
    assignment: "AI_DRAFT",
    terms: /\b(new (ai )?(agent|employee)|hire an? (agent|employee)|create an? (agent|employee)|spin up an? agent)\b/i,
    reason: "Proposes a new employee, so the Agent Creation Gate applies.",
  },
  {
    kind: "west_peek_bridge",
    order: 30,
    risk: "high",
    sensitivity: "restricted",
    assignment: "AI_DRAFT",
    terms: /\bwest ?peek\b/i,
    reason: "Crosses the West Peek boundary. Nothing leaves without approval.",
  },
  {
    kind: "repository",
    order: 40,
    risk: "high",
    sensitivity: "private",
    assignment: "AI_EXECUTE_WITH_APPROVAL",
    terms: /\b(repo|repository|pull request|commit|merge|deploy|codebase|refactor|migration)\b/i,
    reason: "Repository work. Writes stay behind approval.",
  },
  {
    kind: "memory_promotion",
    order: 50,
    risk: "medium",
    sensitivity: "private",
    assignment: "AI_DRAFT",
    terms: /\b(remember|memor(y|ise|ize)|promote to canon|canon|durable fact)\b/i,
    reason: "Touches durable memory, which only the promotion gate can change.",
  },
  {
    kind: "decision_support",
    order: 60,
    risk: "high",
    sensitivity: "private",
    assignment: "AI_DRAFT",
    terms: /\b(should i|decide|decision|red team|invest|term sheet|valuation|offer|negotiat)\w*\b/i,
    reason: "Decision support. The system argues both sides; the Boss decides.",
  },
  {
    kind: "relationship",
    order: 70,
    risk: "medium",
    sensitivity: "private",
    assignment: "AI_DRAFT",
    terms: /\b(meeting|meet with|dossier|intro|follow.?up|call with|dinner with|coffee with)\b/i,
    reason: "Relationship and meeting intelligence.",
  },
  {
    kind: "model_benchmark",
    order: 80,
    risk: "low",
    sensitivity: "internal",
    assignment: "AI_EXECUTE_WITH_NOTICE",
    terms: /\b(benchmark|evaluate the model|model test|eval harness)\b/i,
    reason: "Model bench work. Results gate what may run later.",
  },
  {
    kind: "coaching",
    order: 90,
    risk: "medium",
    sensitivity: "restricted",
    assignment: "AI_DRAFT",
    terms: /\b(coach|habit|discipline|energy|recovery|burnout|identity|practice|ritual)\b/i,
    reason: "Coaching work against personal context.",
  },
  {
    kind: "scheduled_check",
    order: 100,
    risk: "low",
    sensitivity: "internal",
    assignment: "AI_EXECUTE_WITH_NOTICE",
    terms: /\b(check|monitor|watch|alert me|every (morning|day|week)|nightly|daily at)\b/i,
    reason: "A standing check rather than a one-off request.",
  },
  {
    kind: "recurring_duty",
    order: 110,
    risk: "low",
    sensitivity: "internal",
    assignment: "AI_EXECUTE_WITH_NOTICE",
    terms: /\b(recurring|each week|weekly|monthly|standing|routine|always)\b/i,
    reason: "Recurring duty. Belongs to an existing employee, not a new one.",
  },
  {
    kind: "research",
    order: 120,
    risk: "low",
    sensitivity: "internal",
    assignment: "AI_DRAFT",
    terms: /\b(research|find out|look into|compare|survey|scan|summar(y|ise|ize)|brief me)\b/i,
    reason: "Research brief from public or supplied sources.",
  },
  {
    kind: "drafting",
    order: 130,
    risk: "medium",
    sensitivity: "private",
    assignment: "AI_DRAFT",
    terms: /\b(draft|write|reply|respond|email|message|post|copy|outline)\b/i,
    reason: "Drafting. Nothing is sent outward without approval.",
  },
];

/** Anything that would leave the private boundary escalates. */
const OUTBOUND = /\b(send|publish|post to|email (her|him|them|it)|submit|share with|deliver to)\b/i;
const MONEY = /\b(pay|purchase|buy|subscribe|invoice|wire|spend|\$\s?\d)/i;

export function classify(input: {
  title: string;
  prompt?: string | null;
  lane?: string | null;
  intakeKind?: string | null;
  risk?: string | null;
  sensitivity?: string | null;
}): Classification {
  const text = `${input.title} ${input.prompt ?? ""}`;
  const matched: string[] = [];

  let chosen: Rule | null = null;
  for (const rule of [...RULES].sort((a, b) => a.order - b.order)) {
    if (rule.terms.test(text)) {
      chosen = rule;
      matched.push(rule.kind);
      break;
    }
  }

  let intakeKind: IntakeKind = chosen?.kind ?? "one_off";
  let risk: RiskLevel = chosen?.risk ?? "low";
  let sensitivity: Sensitivity = chosen?.sensitivity ?? "private";
  let assignment: ExecutionAssignment = chosen?.assignment ?? "AI_DRAFT";
  let reason = chosen?.reason ?? "No specific category matched, so this is a one-off drafting task.";

  // The trading lane never inherits a softer assignment from a text match.
  if (input.lane === "trading") {
    intakeKind = "trading";
    risk = "high";
    sensitivity = "restricted";
    assignment = "USER_ONLY";
    reason = "Trading lane. Analysis only; execution stays with the Boss.";
    matched.push("lane_trading");
  }

  if (OUTBOUND.test(text)) {
    risk = risk === "low" ? "medium" : "high";
    if (assignment === "AI_EXECUTE_WITH_NOTICE") assignment = "AI_EXECUTE_WITH_APPROVAL";
    reason += " Something leaves the boundary, so approval is required first.";
    matched.push("outbound");
  }

  if (MONEY.test(text)) {
    risk = "high";
    if (assignment !== "USER_ONLY") assignment = "AI_EXECUTE_WITH_APPROVAL";
    reason += " Money is involved, so it cannot execute unapproved.";
    matched.push("spend");
  }

  // Explicit caller overrides win — intake is a default, not a cage.
  if (isIntakeKind(input.intakeKind)) {
    intakeKind = input.intakeKind;
    matched.push("explicit_kind");
  }
  if (input.risk === "low" || input.risk === "medium" || input.risk === "high") {
    risk = input.risk;
    matched.push("explicit_risk");
  }
  if (
    input.sensitivity === "public" || input.sensitivity === "internal" ||
    input.sensitivity === "private" || input.sensitivity === "restricted"
  ) {
    sensitivity = input.sensitivity;
    matched.push("explicit_sensitivity");
  }

  return { intakeKind, risk, sensitivity, executionAssignment: assignment, reason, matched };
}

/**
 * Which existing employee should carry this kind of work.
 * Used by the need classifier before anyone proposes a new one.
 */
export const KIND_TO_DEPARTMENT: Record<IntakeKind, string> = {
  one_off: "Command + Operations",
  recurring_duty: "Command + Operations",
  scheduled_check: "Command + Operations",
  triggered_workflow: "Command + Operations",
  approval_request: "Command + Operations",
  research: "Build / Repo / Document",
  drafting: "Build / Repo / Document",
  coaching: "Coaching Faculty",
  memory_promotion: "Knowledge + Memory",
  relationship: "Relationship + Meeting",
  decision_support: "Command + Operations",
  repository: "Build / Repo / Document",
  model_benchmark: "Continuity + Local Model",
  trading: "Trading Firm Agents",
  west_peek_bridge: "Command + Operations",
  new_agent_proposal: "Command + Operations",
};
