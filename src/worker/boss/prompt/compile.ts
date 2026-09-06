/**
 * Prompt compilation — canon §76.3 (enhancement levels), §76.10 (the lens
 * schema), §76.14 (adapters), and §76.8 (the No Pedestal Law).
 *
 * A rough request goes in; a packet comes out with the lens stack that was
 * applied, the counter-lens that argues with it, the points of view it was
 * checked against, an output contract, and a score. Nothing here calls a model:
 * compilation is assembly, and the compiled prompt is what a model would later
 * be given by the existing router.
 *
 * The tier is not a preference. Canon §76.3 lists the work that is always given
 * the full treatment, and a caller asking for a light pass on investor
 * materials is overruled, on the record, with the trigger that overruled it.
 */

import { newId } from "../lib/id";

/** Canon §76.3. Three enhancement levels: 1 is the full treatment. */
export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LENS_COUNT: Record<Tier, number> = { 1: 4, 2: 2, 3: 1 };
export const TIER_POV_COUNT: Record<Tier, number> = { 1: 2, 2: 1, 3: 0 };

/**
 * The work canon names as always Tier 1. These are matched on the request text,
 * the declared task kind and the sensitivity, and every match is recorded on
 * the packet so the escalation can be argued with rather than merely obeyed.
 */
export const TIER_1_TRIGGERS: { key: string; label: string; test: RegExp; kinds?: string[] }[] = [
  { key: "repo_work", label: "Repository work", test: /\b(repo|repository|pull request|merge|refactor|migration|deploy|codebase)\b/i },
  { key: "investor_materials", label: "Investor materials", test: /\b(investors?|lps?|limited partners?|deck|memo to the fund|data room|fundrais\w+)\b/i },
  { key: "outbound_email", label: "Outbound email", test: /\b(email|send to|reply to|outreach|reach out|message to)\b/i },
  { key: "marketing", label: "Marketing", test: /\b(marketing|campaign|landing page|copy for|positioning|launch post)\b/i },
  { key: "legal_adjacent", label: "Legal-adjacent writing", test: /\b(contract|terms|nda|liabilit\w+|counsel|compliance|indemnit\w+|legal)\b/i },
  // Deliberately wide. Canon §76.3 escalates money work automatically, and the
  // cost of one over-escalated packet is a longer prompt; the cost of a missed
  // one is an unexamined financial decision.
  { key: "financial_decision", label: "Financial or trading decision", test: /\b(invest\w*|allocat\w+|capital|valuation|trade|trading|position|hedge|budget|pricing|money|deal|round|term sheet|cheque|wire)\b/i },
  { key: "document_compiler", label: "Document compiler work", test: /\b(compile|document compiler|report generation|assemble the document)\b/i },
  { key: "private_data", label: "Private-data work", test: /\b(personal data|private data|health record|medical|passport|ssn|bank detail)\b/i },
  { key: "external_action", label: "External action", test: /\b(publish|post publicly|file with|submit to|announce|press)\b/i },
  { key: "vendor_change", label: "Vendor change", test: /\b(vendor|supplier|provider switch|contract renewal|procurement)\b/i },
  { key: "canonical_document", label: "Canonical document update", test: /\b(canon|charter|operating manual|policy update|constitution)\b/i },
];

export interface LensRow {
  key: string;
  name: string;
  category: string;
  summary: string;
  method: string;
  questions: string;
  moves: string;
  failure_modes: string;
  counter_lens_key: string | null;
  best_for: string;
  avoid_for: string;
  tier_minimum: number;
  risk_posture: string;
  evidence_required: number;
  output_shape: string;
  origin: string;
  status: string;
}

export interface PovRow {
  key: string;
  name: string;
  stance: string;
  wants: string;
  fears: string;
  questions: string;
  tier_minimum: number;
}

const parse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export interface TriggerHit {
  key: string;
  label: string;
  matched: string;
}

/** Which of canon's always-Tier-1 categories this request falls into. */
export function detectTriggers(request: string, taskKind: string | null, sensitivity: string): TriggerHit[] {
  const hits: TriggerHit[] = [];
  const haystack = `${request} ${taskKind ?? ""}`;

  for (const trigger of TIER_1_TRIGGERS) {
    const match = trigger.test.exec(haystack);
    if (match) hits.push({ key: trigger.key, label: trigger.label, matched: match[0] });
  }
  if (sensitivity === "restricted" && !hits.some((h) => h.key === "private_data")) {
    hits.push({ key: "private_data", label: "Private-data work", matched: "restricted sensitivity" });
  }
  return hits;
}

export interface CompileInput {
  request: string;
  taskKind?: string | null;
  sensitivity?: string;
  requestedTier?: number | null;
  adapter?: string | null;
  taskId?: string | null;
}

export interface CompiledPacket {
  id: string;
  request: string;
  task_kind: string | null;
  sensitivity: string;
  tier: Tier;
  tier_reason: string;
  triggers: TriggerHit[];
  lens_stack: string[];
  counter_lens_key: string | null;
  pov_card_keys: string[];
  adapter: string;
  sections: Record<string, unknown>;
  compiled_prompt: string;
  task_id: string | null;
}

/** How well a lens fits this request. Deterministic, and explainable. */
function scoreLens(lens: LensRow, taskKind: string | null, triggers: TriggerHit[], request: string): number {
  const bestFor = parse<string[]>(lens.best_for, []);
  const avoidFor = parse<string[]>(lens.avoid_for, []);
  let score = 0;

  if (taskKind && bestFor.includes(taskKind)) score += 5;
  if (taskKind && avoidFor.includes(taskKind)) score -= 6;
  for (const trigger of triggers) {
    if (bestFor.includes(trigger.key)) score += 4;
    // The trigger categories and the lens categories overlap by design.
    if (trigger.key === "financial_decision" && ["finance", "risk", "decision"].includes(lens.category)) score += 3;
    if (trigger.key === "legal_adjacent" && ["ethics", "research"].includes(lens.category)) score += 3;
    if (trigger.key === "outbound_email" && ["communication", "writing"].includes(lens.category)) score += 3;
    if (trigger.key === "repo_work" && ["engineering", "systems", "product"].includes(lens.category)) score += 3;
    if (trigger.key === "investor_materials" && ["finance", "analysis", "research"].includes(lens.category)) score += 3;
  }
  // A vague request needs structure more than a detailed one does.
  if (request.trim().split(/\s+/).length < 12 && ["product", "engineering"].includes(lens.category)) score += 2;
  if (lens.evidence_required && /\b(claim|prove|evidence|data|number)\b/i.test(request)) score += 2;

  return score;
}

/**
 * Compiles one packet. Pure assembly over the bench: no model is called, and
 * the same inputs produce the same packet.
 */
export function compilePacket(
  input: CompileInput,
  lenses: LensRow[],
  povCards: PovRow[],
  adapterName: string,
): CompiledPacket {
  const request = input.request.trim();
  const taskKind = input.taskKind ?? null;
  const sensitivity = input.sensitivity ?? "private";
  const triggers = detectTriggers(request, taskKind, sensitivity);

  // §76.3: the trigger list decides, not the caller.
  let tier: Tier;
  let reason: string;
  const requested = input.requestedTier;
  if (triggers.length > 0) {
    tier = 1;
    reason =
      requested && requested !== 1
        ? `Tier 1 required: ${triggers.map((t) => t.label).join(", ")}. A tier ${requested} pass was asked for and overruled.`
        : `Tier 1 required: ${triggers.map((t) => t.label).join(", ")}.`;
  } else if (requested && TIERS.includes(requested as Tier)) {
    tier = requested as Tier;
    reason = `Tier ${tier} as requested; no automatic trigger fired.`;
  } else {
    tier = 2;
    reason = "Tier 2 by default; no automatic trigger fired.";
  }

  const eligible = lenses
    .filter((l) => l.status === "active" && l.tier_minimum >= tier)
    .map((l) => ({ lens: l, fit: scoreLens(l, taskKind, triggers, request) }))
    .sort((a, b) => b.fit - a.fit || a.lens.key.localeCompare(b.lens.key));

  const stack = eligible.slice(0, TIER_LENS_COUNT[tier]).map((e) => e.lens);

  // The counter-lens argues with the top lens and is never already in the stack:
  // a stack that agrees with itself has no counter-argument in it.
  const stackKeys = new Set(stack.map((l) => l.key));
  let counter: LensRow | null = null;
  for (const lens of stack) {
    const candidate = lenses.find((l) => l.key === lens.counter_lens_key && l.status === "active");
    if (candidate && !stackKeys.has(candidate.key)) { counter = candidate; break; }
  }
  if (!counter) {
    counter = eligible.map((e) => e.lens).find((l) => !stackKeys.has(l.key)) ?? null;
  }

  const povs = povCards
    .filter((p) => p.tier_minimum >= tier)
    .slice(0, TIER_POV_COUNT[tier]);

  const evidenceRequired = stack.some((l) => l.evidence_required === 1) || tier === 1;

  const sections = {
    request,
    task_kind: taskKind,
    tier,
    tier_reason: reason,
    triggers,
    method: stack.map((l) => ({
      lens: l.key,
      name: l.name,
      origin: l.origin,
      steps: parse<string[]>(l.method, []),
      moves: parse<string[]>(l.moves, []),
      questions: parse<string[]>(l.questions, []),
    })),
    counter_check: counter
      ? {
          lens: counter.key,
          name: counter.name,
          questions: parse<string[]>(counter.questions, []),
          failure_modes_it_catches: parse<string[]>(stack[0]?.failure_modes ?? null, []),
        }
      : null,
    points_of_view: povs.map((p) => ({
      key: p.key,
      name: p.name,
      stance: p.stance,
      questions: parse<string[]>(p.questions, []),
    })),
    evidence: {
      required: evidenceRequired,
      rule: evidenceRequired
        ? "Every claim is marked observed, cited or inferred, and inferences say so."
        : "Sourcing optional at this tier.",
    },
    output_contract: {
      shape: stack.map((l) => l.output_shape),
      must_include: [
        "The answer first, before the reasoning",
        ...(evidenceRequired ? ["Provenance for every factual claim"] : []),
        ...(counter ? [`An answer to the counter-check (${counter.name})`] : []),
        "What was deliberately left out",
      ],
    },
    refusals: [
      "Do not invent a source, a figure or a quotation.",
      "If an input is missing, say it is missing rather than assuming it.",
    ],
  };

  const compiled = renderPrompt(sections, stack, counter, povs);

  return {
    id: newId("pkt"),
    request,
    task_kind: taskKind,
    sensitivity,
    tier,
    tier_reason: reason,
    triggers,
    lens_stack: stack.map((l) => l.key),
    counter_lens_key: counter?.key ?? null,
    pov_card_keys: povs.map((p) => p.key),
    adapter: adapterName,
    sections,
    compiled_prompt: compiled,
    task_id: input.taskId ?? null,
  };
}

/** §76.14: the adapter decides shape, not content. This is the text form. */
function renderPrompt(
  sections: any,
  stack: LensRow[],
  counter: LensRow | null,
  povs: PovRow[],
): string {
  const lines: string[] = [];

  lines.push(`REQUEST`, sections.request, "");
  if (sections.task_kind) lines.push(`KIND: ${sections.task_kind}`, "");
  lines.push(`TREATMENT: tier ${sections.tier} — ${sections.tier_reason}`, "");

  lines.push("METHOD");
  for (const lens of stack) {
    lines.push(`· ${lens.name} (${lens.origin})`);
    for (const step of parse<string[]>(lens.method, [])) lines.push(`    ${step}`);
  }
  lines.push("");

  if (counter) {
    lines.push("COUNTER-CHECK — answer these before finishing", `· ${counter.name}`);
    for (const q of parse<string[]>(counter.questions, [])) lines.push(`    ${q}`);
    lines.push("");
  }

  if (povs.length) {
    lines.push("READ IT AS");
    for (const p of povs) {
      lines.push(`· ${p.name} — ${p.stance}`);
      for (const q of parse<string[]>(p.questions, [])) lines.push(`    ${q}`);
    }
    lines.push("");
  }

  lines.push("EVIDENCE", `· ${sections.evidence.rule}`, "");
  lines.push("OUTPUT CONTRACT");
  for (const item of sections.output_contract.must_include) lines.push(`· ${item}`);
  for (const shape of sections.output_contract.shape) lines.push(`· ${shape}`);
  lines.push("");
  lines.push("REFUSALS");
  for (const refusal of sections.refusals) lines.push(`· ${refusal}`);

  return lines.join("\n");
}

export interface ScoreDimension {
  key: string;
  points: number;
  max: number;
  why: string;
}

export interface PacketScore {
  dimensions: ScoreDimension[];
  total: number;
  max_total: number;
}

/**
 * Scores the packet on structure. Deterministic on purpose: a score that moves
 * when nothing changed cannot be used to compare two packets.
 */
export function scorePacket(packet: CompiledPacket): PacketScore {
  const sections = packet.sections as any;
  const dimensions: ScoreDimension[] = [
    {
      // Absolute, not normalised by tier. A light packet *should* score below a
      // full one: the score says how much was brought to bear, and a tier-3
      // pass that scored like a tier-1 pass would make the number useless for
      // the only comparison anyone wants to make.
      key: "lens_stack",
      points: Math.min(20, packet.lens_stack.length * 5),
      max: 20,
      why: `${packet.lens_stack.length} lens${packet.lens_stack.length === 1 ? "" : "es"} applied at tier ${packet.tier}.`,
    },
    {
      key: "counter_lens",
      points: packet.counter_lens_key ? 20 : 0,
      max: 20,
      why: packet.counter_lens_key
        ? `Counter-check by ${packet.counter_lens_key}.`
        : "No counter-lens: nothing in the packet argues with it.",
    },
    {
      key: "output_contract",
      points: sections.output_contract?.must_include?.length ? 15 : 0,
      max: 15,
      why: sections.output_contract?.must_include?.length
        ? `${sections.output_contract.must_include.length} required elements named.`
        : "No output contract.",
    },
    {
      key: "evidence",
      points: sections.evidence?.required ? 15 : 5,
      max: 15,
      why: sections.evidence?.required ? "Provenance required." : "Sourcing optional at this tier.",
    },
    {
      key: "points_of_view",
      points: packet.pov_card_keys.length ? 10 : 0,
      max: 10,
      why: packet.pov_card_keys.length
        ? `Read as ${packet.pov_card_keys.join(", ")}.`
        : "No external point of view applied.",
    },
    {
      key: "specificity",
      points: Math.min(10, Math.round(packet.request.trim().split(/\s+/).length / 4)),
      max: 10,
      why: "How much the request itself gave the packet to work with.",
    },
    {
      key: "refusals",
      points: sections.refusals?.length ? 10 : 0,
      max: 10,
      why: sections.refusals?.length ? "Fabrication refusals attached." : "No refusals attached.",
    },
  ].map((d) => ({ ...d, points: Math.round(d.points) }));

  return {
    dimensions,
    total: dimensions.reduce((sum, d) => sum + d.points, 0),
    max_total: dimensions.reduce((sum, d) => sum + d.max, 0),
  };
}
