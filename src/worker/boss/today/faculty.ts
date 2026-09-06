import type { Env } from "../env";

/**
 * TODAY BLOCKS 08 AND 09 — Coaching Focus, and the Daily Thinking Lens.
 *
 * Both had been rendering "awaiting substrate — the coaching faculty lands in Phase 12" since the
 * port. The substrate existed the whole time and was on paper rather than in the repository: §10's
 * five Tracks and §11's three Modes, which are not a curriculum to be invented but a fixed set she
 * has already written down.
 *
 * NEITHER BLOCK CALLS A MODEL. A rotating lens and a named mode are decidable from the day's own
 * state, and spending an inference call to pick one from a list of five would be cost with no
 * judgement in it. The whole faculty runs at $0 by construction, not by policy.
 */

// ─── Block 09 · the Daily Thinking Lens ──────────────────────────────────────
//
// §10: "Tracks are always-on background filters. They shape interpretation, prioritization, and
// decision-making. They are NOT daily task lists." So the lens is a question to hold, never a thing
// to do — and the block renders one track's own filters, in her words, not a paraphrase.

export interface Track {
  key: string;
  title: string;
  purpose: string;
  /** Her own filters and rules, verbatim from §10. */
  prompts: string[];
  background?: boolean;
}

export const TRACKS: Track[] = [
  {
    key: "billionaire_mindset",
    title: "Billionaire Mindset",
    purpose: "Ownership over income. Leverage, compounding, long-horizon correctness.",
    prompts: [
      "Does this create ownership?",
      "Does it scale without me?",
      "Is the upside asymmetric?",
      "Is the downside survivable?",
      "Is this compounding, or just labor?",
      "Is this 10-year correct?",
    ],
  },
  {
    key: "operator_discipline",
    title: "Operator Discipline",
    purpose: "Reduce renegotiation. Follow through under pressure. Refuse the all-or-nothing reset.",
    prompts: [
      "Plans execute unless reality changes.",
      "Renegotiation must be explicit.",
      "Consistency beats intensity.",
      "Completion beats emotion.",
      "The bad-day move is floor execution, not reset fantasy.",
    ],
  },
  {
    key: "strategic_patience",
    title: "Strategic Patience",
    purpose: "Prevent premature pivots. Protect compounding. Stay in the lane long enough to get signal.",
    prompts: [
      "No pivot before gates.",
      "Volatility is data, not a command.",
      "Impatience must be named.",
      "Slow progress does not equal failure.",
    ],
  },
  {
    key: "manifestation_mastery",
    title: "Manifestation Mastery",
    purpose: "Identity alignment, belief quality, expectancy. Hold the outcome without collapsing into doubt.",
    prompts: [
      "Is the belief congruent, or performed?",
      "Am I holding this, or gripping it?",
      "What would expectancy look like here?",
      // Her constraint, carried into the block itself so the lens cannot quietly become an excuse.
      "This filter may not override evidence, execution, arbitration, recovery rules, or continuity laws.",
    ],
  },
  {
    key: "investor_ai_leverage",
    title: "Investor + AI Leverage",
    purpose: "Sharper investor judgement and higher-leverage use of AI, in the background.",
    prompts: [
      "What did I see today that most people would misread?",
      "Where is the capital actually going?",
      "What am I doing by hand that should be leverage?",
    ],
    background: true,
  },
];

/**
 * Which lens today.
 *
 * ROTATES ON THE DATE, NOT AT RANDOM. The same day always shows the same lens, so reloading Today
 * does not reshuffle her thinking, and a week visibly cycles rather than landing on one track three
 * times by chance.
 *
 * THE BACKGROUND TRACK STAYS BACKGROUND. §10.6 is explicit that Investor + AI Leverage "remains
 * background unless explicitly promoted", so it is excluded from the rotation rather than given an
 * equal fifth of her mornings — promoting it silently would be this system changing her contract.
 */
export function lensFor(dayId: string): Track {
  const foreground = TRACKS.filter((t) => !t.background);
  const days = Math.floor(Date.parse(`${dayId}T00:00:00Z`) / 86_400_000);
  // Modulo of a non-empty array always lands in range; the assertion is for the type, and TRACKS is
  // a module constant so an empty foreground set would be a build-time mistake, not a runtime one.
  return foreground[((days % foreground.length) + foreground.length) % foreground.length]!;
}

// ─── Block 08 · Coaching Focus ───────────────────────────────────────────────

export interface Mode {
  key: string;
  title: string;
  trigger: string;
  rules: string[];
}

/** §11's three modes, with her trigger phrases and rules. */
export const MODES: Mode[] = [
  {
    key: "high_pressure",
    title: "High-Pressure Coaching",
    trigger: "High-Pressure Coaching.",
    rules: [
      "Assume the stated problem may be a symptom.",
      "Hunt for blind spots, avoidance, artificial constraints, self-deception.",
      "First principles, leverage, compounding, expected value, A-player standards.",
      "No therapy talk. No fluff. No excessive questions.",
      "One question at a time. End with one stabilizing directive.",
    ],
  },
  {
    key: "executive_review",
    title: "Executive Review",
    trigger: "Executive Review.",
    rules: [
      "Opens: “Here’s what you already know that still makes you better:”",
      "No new insights. No re-diagnosis. No new ideas.",
      "Organize existing strategy only, in 3–7 numbered items.",
      "Closes: “None of this is new — you’re just being reminded.”",
    ],
  },
  {
    key: "recovery",
    title: "Recovery Mode",
    trigger: "Activate Recovery Mode.",
    rules: [
      "Continuity over intensity. No catch-up.",
      "No performance evaluation during recovery.",
      "Scope reduction is strategic.",
      "Protect manifestation and meaningful work from zero. Preserve the Body floor.",
      "Close the loop early. A Recovery Day is not a failed day.",
    ],
  },
];

/** §12's ten laws, so the focus can name the one under pressure rather than describing a mood. */
export const LAWS = [
  { n: 1, title: "Never Miss Twice", text: "One miss is data. Two misses is drift. Restart immediately." },
  { n: 2, title: "Continuity Over Intensity", text: "A small day that happens beats a perfect day that collapses." },
  { n: 3, title: "No Catch-Up", text: "Yesterday is closed. The system moves forward only." },
  { n: 4, title: "No Mid-Day Renegotiation", text: "The day is an execution environment. Emotional spikes do not rewrite the morning plan." },
  { n: 5, title: "Zeros Are Allowed", text: "A day can be minimal. It cannot become identity collapse." },
  { n: 6, title: "Minimum Viable Day", text: "When capacity collapses, reduce to floor execution and close cleanly." },
  { n: 7, title: "Cognitive Load Reduction", text: "The OS determines, simplifies, sequences, and operationalizes." },
  { n: 8, title: "Documents Before Inference", text: "When source documents exist, follow them instead of reconstructing from memory." },
  { n: 9, title: "Truth Over Completion", text: "Do not claim certainty or completion when unsupported." },
  { n: 10, title: "Resume, Don’t Rebuild", text: "After drift, resume from the current system. Do not restart it." },
];

export interface CoachingFocus {
  mode: Mode;
  /** Why this mode, in a sentence, from the day's own state. */
  because: string;
  law: (typeof LAWS)[number];
  law_because: string;
}

/**
 * Today's coaching focus: which mode the day is in, and which law is under the most pressure.
 *
 * READ FROM STATE, NOT ASKED OF A MODEL, and every branch names its evidence. A focus that cannot
 * say why it chose is a horoscope.
 */
export async function coachingFocus(env: Env, dayId: string, dayMode: string | null): Promise<CoachingFocus> {
  const law = (n: number) => LAWS.find((l) => l.n === n)!;

  // Yesterday's verdict is what Law 1 turns on, so it is read before anything else.
  const previous = await env.DB
    .prepare(`SELECT id, verdict FROM days WHERE id < ? AND verdict IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .bind(dayId)
    .first<{ id: string; verdict: string }>();

  const openLoops = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`)
    .first<{ n: number }>();

  if (dayMode === "recovery") {
    return {
      mode: MODES.find((m) => m.key === "recovery")!,
      because: "You named today a Recovery Day. Recovery Mode is what that means in practice.",
      law: law(2),
      law_because: "Recovery is continuity protection, not a failed day.",
    };
  }

  if (previous?.verdict === "miss") {
    return {
      mode: MODES.find((m) => m.key === "high_pressure")!,
      because: `${previous.id} scored a Miss. Today is the one that decides whether that was data or drift.`,
      law: law(1),
      law_because: "One miss is data. Two is drift. This is the day that settles it.",
    };
  }

  if (dayMode === "mvd") {
    return {
      mode: MODES.find((m) => m.key === "recovery")!,
      because: "You set today to minimum viable. Floor execution, closed cleanly, is the whole job.",
      law: law(6),
      law_because: "Reduce scope deliberately and close it. That is the law working, not a concession.",
    };
  }

  if ((openLoops?.n ?? 0) >= 5) {
    return {
      mode: MODES.find((m) => m.key === "executive_review")!,
      because: `${openLoops!.n} loops are open. That is an organizing problem, not a new-ideas problem.`,
      law: law(7),
      law_because: "The system should be reducing load here, and right now it is carrying more than it is closing.",
    };
  }

  return {
    mode: MODES.find((m) => m.key === "high_pressure")!,
    because: "A normal day. Default coaching is direct and unsentimental.",
    law: law(4),
    law_because: "The plan was made this morning by the version of you with the most capacity. Today's job is to execute it.",
  };
}
