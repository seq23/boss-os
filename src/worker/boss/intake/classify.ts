import type {
  Audience,
  ExecutionAssignment,
  IntakeKind,
  ModelAccess,
  RiskLevel,
  Sensitivity,
} from "../../../shared/boss/governance";
import {
  DEFAULT_AUDIENCE,
  DEFAULT_MODEL_ACCESS,
  isAudience,
  isIntakeKind,
  isModelAccess,
  modelAccessFromLegacySensitivity,
} from "../../../shared/boss/governance";

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
  /**
   * WHICH MODELS MAY SEE THE INPUT. Decided by `classifyModelAccess` alone.
   *
   * Her ruling, and the reason this is a field on every work card rather than a judgement made
   * later at the router: "WE NEED TO CLASSIFY ON EACH WORK CARD GOING FORWARD ... SO THERE IS NO
   * CONFUSION. MOST WORK IS INTERNAL AND NOT-CONFIDENTIAL SO CAN USE FREE TRAINING MODELS WITH
   * REASONING AND CLOSE TO $0."
   */
  modelAccess: ModelAccess;
  /** WHO MAY RECEIVE THE OUTPUT. Decided by `classifyAudience` alone. Never touches routing. */
  audience: Audience;
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
    /*
     * `allocation` LEFT THIS LIST, AND IT IS THE SAME DEFECT THIS RULE ALREADY CARRIES A PARAGRAPH
     * ABOUT BELOW.
     *
     * "Build the event kit: run of show, room layout, and the ALLOCATION of seats" matched here.
     * The card came out classified as high-risk trading work, USER_ONLY, awaiting an approval
     * nobody knew to give — and once intake started labelling model access, it also came out
     * `private_model_only`, which is precisely the over-restriction the owner overruled: "WHO CARES
     * ABOUT HIRING SEARCH AND EVENT KITS AND ROOM KITS. THEY ARE NOT PRIVATE INFO."
     *
     * NOTHING REAL IS LOST. The trading LANE still forces this classification below whatever the
     * wording, `portfolio`, `ticker`, `broker`, `trade` and `position` all remain, and the router's
     * own scan still treats allocation wording as a signal — it simply asks for a second one before
     * acting on it (`router/modelAccess.ts`). A seating plan has no second signal; a real
     * allocation next to a figure does.
     */
    terms: /\b(trade|trading|order|position|portfolio|exchange|broker|ticker|long|short|buy|sell)\b/i,
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
    terms: /\b(recurring|each week|weekly|monthly|standing|routine|always|new duty|standing duty)\b/i,
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


/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO AXES, CLASSIFIED BY TWO FUNCTIONS THAT CANNOT SEE EACH OTHER'S ANSWER.
 *
 * Both take the same text and neither takes the other's verdict. That is not a stylistic choice —
 * it is the guarantee, expressed as a signature. A function that received the audience could be
 * made to read `internal` as "keep it off the public models", which is the exact mistake the
 * sibling repo made and the exact thing the owner overruled:
 *
 *   "ITS NOT DEAL TERMS OR LP INFORMATION SO IT DOESNT MATTER IF ITS USING THIS DATA TO TRAIN."
 *
 * `scripts/validate/two-axes-are-independent.mjs` proves the independence by exhaustion rather than
 * by reading this comment: it drives both functions over a matrix of inputs and fails if either
 * axis moves when only the other axis's signals change.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * THE PRIVATE SIDE OF THE FUND, and nothing else.
 *
 * Deliberately narrow. Everything not named here — hiring, events, rooms, workshops, market
 * research, tool scouting, backlink prospecting, site audits, Kindle work, community material,
 * Productions, the executive brief's public inputs — is `public_model_approved` and may use a free
 * reasoning lane. THIS LIST IS A FLOOR, NOT A CEILING: the router scans the outgoing prompt as well
 * (`router/modelAccess.ts`) and can raise a run this missed. Intake labels the card; the router
 * still reads the content.
 */
const PRIVATE_MODEL_ONLY_TERMS =
  /\b(lp|lps|limited partner|capital call|drawdown|side letter|term sheet|cap ?table|carried interest|preferred return|clawback|data ?room|diligence|fund (figures?|financials?|ledger)|capital account|subscription agreement|investment memo)\b/i;

/** Intake kinds whose subject matter is the fund's private side whatever words the title uses. */
const PRIVATE_MODEL_ONLY_KINDS = new Set<string>(["trading", "west_peek_bridge", "coaching"]);

/**
 * Which models may see this work.
 *
 * NOTHING ABOUT THE RECIPIENT IS READ HERE. There is no `audience` parameter and no lane check that
 * stands in for one.
 */
export function classifyModelAccess(input: {
  text: string;
  intakeKind: IntakeKind;
  /** The legacy scale, which may only ever TIGHTEN this. See `modelAccessFromLegacySensitivity`. */
  sensitivity?: Sensitivity | null;
  /** An explicit label from the caller. Wins outright — this is the field she fills in. */
  declared?: string | null;
}): { access: ModelAccess; matched: string[] } {
  if (isModelAccess(input.declared)) {
    return { access: input.declared, matched: ["explicit_model_access"] };
  }
  const matched: string[] = [];
  let access: ModelAccess = DEFAULT_MODEL_ACCESS;

  if (PRIVATE_MODEL_ONLY_KINDS.has(input.intakeKind)) {
    access = "private_model_only";
    matched.push(`private_kind_${input.intakeKind}`);
  }
  if (PRIVATE_MODEL_ONLY_TERMS.test(input.text)) {
    access = "private_model_only";
    matched.push("private_terms");
  }
  if (modelAccessFromLegacySensitivity(input.sensitivity) === "private_model_only") {
    access = "private_model_only";
    matched.push("legacy_restricted");
  }
  return { access, matched };
}

/**
 * EXTERNAL MEANS A PERSON OUTSIDE THE FIRM IS THE READER.
 *
 * Internal is Sequoia or Scooter. Everyone else — a candidate, a founder, a guest, a journalist, an
 * LP — is external. Note that an LP is external AND private model only, and a coaching note is
 * internal AND private model only: the two axes genuinely do land in all four corners, which is why
 * there are two of them.
 *
 * NOTHING ABOUT TRAINING TERMS IS READ HERE. There is no `modelAccess` parameter.
 */
const EXTERNAL_RECIPIENTS =
  /\b(candidate|applicant|founder|guest|attendee|journalist|press|investor|prospect|client|customer|vendor|supplier|subscriber|audience|public|member|community|reader|viewer|lp|lps|limited partner)\b/i;
const EXTERNAL_VERBS =
  /\b(send|publish|post to|submit|share with|deliver to|announce|newsletter|outreach|invite|pitch to|reply to)\b/i;

export function classifyAudience(input: {
  text: string;
  /** An explicit label from the caller. Wins outright. */
  declared?: string | null;
}): { audience: Audience; matched: string[] } {
  if (isAudience(input.declared)) {
    return { audience: input.declared, matched: ["explicit_audience"] };
  }
  const recipient = EXTERNAL_RECIPIENTS.test(input.text);
  const verb = EXTERNAL_VERBS.test(input.text);
  /*
   * BOTH, NOT EITHER. "Research what founders are saying" names an external party and produces a
   * partner-only brief; "send the summary" names a verb with no outside reader. Requiring the
   * recipient AND the act of reaching them is what keeps the default — internal — where the owner
   * says most work sits, while still catching the thing that genuinely leaves the building.
   */
  if (recipient && verb) return { audience: "external", matched: ["external_recipient_and_verb"] };
  return { audience: DEFAULT_AUDIENCE, matched: [] };
}

export function classify(input: {
  title: string;
  prompt?: string | null;
  lane?: string | null;
  intakeKind?: string | null;
  risk?: string | null;
  sensitivity?: string | null;
  /** `public_model_approved` or `private_model_only`. Governs routing and nothing else. */
  model_access?: string | null;
  /** `internal` or `external`. Governs approval and nothing else. */
  audience?: string | null;
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

  /*
   * A DECLARED KIND BEATS AN INFERRED ONE, INCLUDING ITS VERDICT.
   *
   * This function already said "explicit caller overrides win — intake is a default, not a cage",
   * and then applied that to the KIND alone: the caller's kind was recorded while the keyword
   * rule's risk and execution assignment stayed in force. So a task whose owner had named it
   * `research` could still be classified USER_ONLY by a word in its prompt.
   *
   * THAT IS NOT HYPOTHETICAL. The trading rule matches `position`, and the Executive Intelligence
   * Report's instruction gained the phrase "every planetary position". The duty declared itself
   * `research`; intake called it high-risk trading work, assigned USER_ONLY, and the task would
   * have sat awaiting an approval nobody knew to give — at 06:30, unattended, every morning. The
   * same rule matches `order`, `long`, `short` and `buy`, so "in order to" and "a short summary"
   * carry the same consequence.
   *
   * WHAT IS NOT RELAXED. The trading LANE still forces USER_ONLY below, and outbound and money
   * still escalate, because those are facts about the work rather than guesses about its wording.
   * A caller naming a kind cannot escape any of them — it only stops a keyword outvoting a
   * declaration.
   */
  const declared = isIntakeKind(input.intakeKind) ? input.intakeKind : null;
  const declaredRule = declared ? RULES.find((r) => r.kind === declared) ?? null : null;
  const base = declared && declared !== chosen?.kind ? declaredRule : chosen;
  if (declared) matched.push("explicit_kind");
  if (base !== chosen && chosen) matched.push(`inferred_${chosen.kind}_overridden`);

  let intakeKind: IntakeKind = declared ?? chosen?.kind ?? "one_off";
  let risk: RiskLevel = base?.risk ?? "low";
  let sensitivity: Sensitivity = base?.sensitivity ?? "private";
  /*
   * WAS THE SENSITIVITY DECLARED, OR GUESSED FROM A WORD?
   *
   * It matters because only a DECLARED `restricted` may tighten model access. A keyword rule's
   * verdict is a guess about wording, and this file already documents what those guesses cost: the
   * Executive Intelligence Report was classified as trading work by the phrase "every planetary
   * position". Letting a guess like that decide which models may see the work would put the
   * sibling repo's over-restriction back, one rule-table row at a time.
   *
   * The content scan in `router/modelAccess.ts` is the backstop, and it reads the real prompt
   * rather than the title, so nothing is left unguarded by this.
   */
  let sensitivityWasDeclared = false;
  let assignment: ExecutionAssignment = base?.assignment ?? "AI_DRAFT";
  let reason = base?.reason ?? "No specific category matched, so this is a one-off drafting task.";

  // The trading lane never inherits a softer assignment from a text match — or from a declared kind.
  if (input.lane === "trading") {
    intakeKind = "trading";
    risk = "high";
    sensitivity = "restricted";
    assignment = "USER_ONLY";
    reason = "Trading lane. Analysis only; execution stays with the Boss.";
    // THE LANE IS A FACT, NOT A GUESS. A caller that put this in the trading lane said so.
    sensitivityWasDeclared = true;
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

  if (input.risk === "low" || input.risk === "medium" || input.risk === "high") {
    risk = input.risk;
    matched.push("explicit_risk");
  }
  if (
    input.sensitivity === "public" || input.sensitivity === "internal" ||
    input.sensitivity === "private" || input.sensitivity === "restricted"
  ) {
    sensitivity = input.sensitivity;
    sensitivityWasDeclared = true;
    matched.push("explicit_sensitivity");
  }

  /*
   * THE TWO AXES ARE DECIDED LAST AND SIDE BY SIDE, each from its own function, neither given the
   * other's answer. `sensitivity` reaches the model-access call because `restricted` on the legacy
   * scale really did mean "do not train on this" and those rows must not be downgraded — it is a
   * one-way, tighten-only input, and `internal` contributes nothing through it.
   */
  const accessVerdict = classifyModelAccess({
    text, intakeKind,
    sensitivity: sensitivityWasDeclared ? sensitivity : null,
    declared: input.model_access ?? null,
  });
  const audienceVerdict = classifyAudience({ text, declared: input.audience ?? null });
  matched.push(...accessVerdict.matched, ...audienceVerdict.matched);

  return {
    intakeKind, risk, sensitivity,
    modelAccess: accessVerdict.access,
    audience: audienceVerdict.audience,
    executionAssignment: assignment, reason, matched,
  };
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
