/**
 * What may cross the Firm OS boundary, and what never may — canon §48, §79.10.
 *
 * The forbidden list is hardcoded here on purpose. A forbidden list that lives
 * in a table is a forbidden list somebody can edit at 2am, and the whole point
 * of this boundary is that it does not move when someone is in a hurry.
 *
 * The rule applies in both directions. Personal life does not flow to the firm,
 * and the firm's client material does not flow into the personal system — the
 * second direction matters as much as the first, because a personal system
 * holding client confidences is a liability neither side agreed to.
 */

export type Direction = "outbound" | "inbound";

/** Categories that may cross, with what each one actually is. */
export const ALLOWED_CATEGORIES: { key: string; label: string; directions: Direction[] }[] = [
  { key: "engagement_scope", label: "The scope of a piece of work", directions: ["outbound", "inbound"] },
  { key: "deliverable", label: "A finished deliverable or its reference", directions: ["outbound", "inbound"] },
  { key: "schedule_slot", label: "Availability, or a booked slot", directions: ["outbound", "inbound"] },
  { key: "invoice_reference", label: "An invoice number or payment reference — not the account", directions: ["outbound", "inbound"] },
  { key: "public_material", label: "Anything already published", directions: ["outbound", "inbound"] },
  { key: "capability_note", label: "What either side can or cannot take on", directions: ["outbound", "inbound"] },
];

/**
 * Categories that never cross, in either direction. The reason is stored with
 * each one because a refusal that cannot say why teaches nobody anything.
 */
export const FORBIDDEN_CATEGORIES: { key: string; label: string; reason: string }[] = [
  { key: "personal_health", label: "Health and medical", reason: "It is the Boss's body, and the firm has no business in it." },
  { key: "personal_finance", label: "Personal finances and net worth", reason: "The firm bills for work; it does not see the balance sheet behind it." },
  { key: "family", label: "Family and household", reason: "Nothing about the people at home is a firm matter." },
  { key: "journal", label: "Journal and private reflection", reason: "A journal that could be subpoenaed through a firm is not a journal." },
  { key: "spirit_practice", label: "Spirit, ritual and ancestors", reason: "Private practice does not become a work artefact." },
  { key: "relationship_notes", label: "Relationship dossiers and meeting captures", reason: "What someone said in confidence stays on this side." },
  { key: "restricted_memory", label: "Anything classed restricted", reason: "Restricted content does not leave the system at all, and the bridge is no exception." },
  { key: "trading_position", label: "Trading positions and the trading lane", reason: "The lane is isolated from Boss OS itself; it is certainly isolated from the firm." },
  { key: "credentials", label: "Keys, passcodes and tokens", reason: "A credential that crosses a boundary has left it." },
  { key: "client_confidential", label: "Client confidential material", reason: "Inbound: the personal system must not become a store of client confidences." },
  { key: "client_pii", label: "Client personal data", reason: "Inbound: other people's personal data does not belong in a personal system." },
  { key: "firm_payroll", label: "Firm payroll and staff records", reason: "Inbound: staff records stay in the firm's own system, under its own controls." },
];

const FORBIDDEN = new Map(FORBIDDEN_CATEGORIES.map((c) => [c.key, c]));
const ALLOWED = new Map(ALLOWED_CATEGORIES.map((c) => [c.key, c]));

export interface CategoryVerdict {
  allowed: boolean;
  category: string;
  direction: Direction;
  reason: string | null;
}

/**
 * The check itself. Unknown categories are refused rather than waved through:
 * an allowlist that falls open on an unrecognised value is not an allowlist.
 */
export function checkCategory(category: string, direction: Direction): CategoryVerdict {
  const forbidden = FORBIDDEN.get(category);
  if (forbidden) {
    return {
      allowed: false,
      category,
      direction,
      reason: `${forbidden.label} never crosses the firm boundary, in either direction. ${forbidden.reason}`,
    };
  }

  const allowed = ALLOWED.get(category);
  if (!allowed) {
    return {
      allowed: false,
      category,
      direction,
      reason:
        `"${category}" is not on the approved list, so it does not cross. ` +
        `The bridge is an allowlist: an unrecognised category is a refusal, not a question.`,
    };
  }

  if (!allowed.directions.includes(direction)) {
    return {
      allowed: false,
      category,
      direction,
      reason: `${allowed.label} may cross, but not ${direction === "outbound" ? "outbound" : "inbound"}.`,
    };
  }

  return { allowed: true, category, direction, reason: null };
}

/**
 * The separation this phase maintains, stated so it can be read rather than
 * assumed — and stated with what actually backs each line.
 *
 * The distinction in `proof` is the honest part. This repository can prove what
 * it does and does not contain; it cannot prove anything about the other
 * system's repository, account or deployment, because that system is not here
 * to be inspected. Canon requires that a separation claim which is not directly
 * proven stays labelled unproven rather than being rounded up, so:
 *
 *   locally_enforced   — this build enforces it, and a test can fail on it.
 *   locally_absent     — proven by absence: the thing simply does not exist here.
 *   externally_unproven — depends on the firm system or an account, which this
 *                         repository cannot inspect. Believed, not proven.
 *
 * "One Worker holds no firm credential" is a fact about this repository.
 * "The firm runs somewhere else under its own account" is a statement about a
 * system this code has never seen, and it is labelled accordingly.
 */
export type SeparationProof = "locally_enforced" | "locally_absent" | "externally_unproven";

export const SEPARATION: {
  dimension: string;
  kept_by: string;
  proof: SeparationProof;
  unproven_because?: string;
}[] = [
  {
    dimension: "Repositories",
    kept_by: "Nothing in this repository imports, vendors or references the firm's codebase.",
    proof: "locally_absent",
    unproven_because:
      "That the firm's system exists as a separate repository under separate control is a fact about another " +
      "repository. This one can only prove it does not contain it.",
  },
  {
    dimension: "Permissions",
    kept_by: "This system's envelopes grant capabilities inside this system only; there is no firm credential here.",
    proof: "locally_absent",
  },
  {
    dimension: "Memory",
    kept_by: "No firm tables exist here. A handoff carries a reference and a summary, never a body.",
    proof: "locally_enforced",
  },
  {
    dimension: "Governance",
    kept_by:
      "Decision rights, compliance flags and the emotional-state gate are this system's own tables and bind " +
      "this system's actions only. No firm policy is read here, and nothing here governs the firm.",
    proof: "locally_enforced",
  },
  {
    dimension: "Budgets",
    kept_by: "Lane budgets are this system's own. No firm spend is charged here and none can be.",
    proof: "locally_enforced",
  },
  {
    dimension: "Approvals",
    kept_by: "Every crossing raises an approval in this inbox; the firm cannot approve its own request.",
    proof: "locally_enforced",
  },
  {
    dimension: "Audit logs",
    kept_by: "Every handoff, including every refusal, is written to this system's audit log.",
    proof: "locally_enforced",
  },
  {
    dimension: "Deployment scopes",
    kept_by: "One Worker, one D1, one R2, one bucket path, declared in this repository's wrangler config.",
    proof: "locally_absent",
    unproven_because:
      "Which Cloudflare account each system deploys into, and who holds deploy authority on each, is an account " +
      "fact outside this repository. This build can only show it declares no firm resource.",
  },
  {
    dimension: "Runtime environments",
    kept_by:
      "This system runs as its own Worker with its own bindings. No firm process runs in it and it runs in no " +
      "firm process.",
    proof: "externally_unproven",
    unproven_because:
      "Whether the firm's runtime is genuinely a separate environment — separate Worker, separate account, " +
      "separate secrets — can only be established by inspecting that deployment, which is not in this repository.",
  },
];

/** The honest one-line summary of what the separation disclosure above proves. */
export const SEPARATION_NOTE =
  "Separation is the default state and the bridge is the exception. What this build can prove, it proves: " +
  "what does not exist here, and what it refuses at the boundary. What depends on the firm's own repository, " +
  "account or runtime is marked externally unproven rather than rounded up — writing " +
  '"separate repositories" in a response is not evidence that two systems are separate.';
