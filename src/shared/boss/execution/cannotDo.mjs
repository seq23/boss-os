/**
 * A MODEL THAT SAYS IT COULD NOT DO THE WORK HAS NOT PRODUCED A DRAFT.
 *
 * ─── The defect this closes ────────────────────────────────────────────────
 *
 * 22 September 2026, `tsk_m351xejbtekke2cb`. She wrote to `#simone` — the Chief of Staff, `ops`
 * lane, `one_off`, `AI_DRAFT` — and asked her to "dig through the code and figure out what the
 * entire loop is" for `how-we-know`. It ran as ONE ~13-second cloud completion with no filesystem,
 * no repository and no tools, and answered:
 *
 *   "I do not have direct access to..."
 *
 * Then it was filed `awaiting_approval`, in the same list, in the same shape, with the same buttons
 * as a real draft waiting for her word. The system had recorded a success. Nothing anywhere said
 * that the one thing she asked for had not been attempted.
 *
 * `queue/consumer.ts` ALREADY REFUSES TO DO THIS for the one shape of work where it was noticed —
 * a task carrying `input.repo_change.change_id` is parked for her Mac, and the comment there says
 * exactly why: "a cloud model asked to 'do' it would return a paragraph shaped like a PR." That is
 * this failure, named, a lane early. The gate was built for one lane and the rest of the ops lane
 * never got one.
 *
 * ─── Why this reads the ANSWER and not the question ────────────────────────
 *
 * The obvious implementation is to decide up front whether a request needs tools. That is a
 * classifier over her prose, it would be wrong in both directions, and being wrong in the cautious
 * direction means refusing work the model could have done perfectly well.
 *
 * The model's own reply is EVIDENCE rather than a guess. It ran, it had every capability it was
 * going to get, and it said in the first person that it could not. That is the strongest fact
 * available and it costs one completion to obtain — a completion that was being paid for anyway.
 * Deterministic, like `intake/handoff.mjs` next door, and for the same reason: a model asked to
 * grade a model's honesty is a second opinion where a fact already exists.
 *
 * ─── The two gates, and the asymmetry that sets them ───────────────────────
 *
 * A phrase alone is not enough. "I do not have the Q3 close yet" inside a four-page memo is an
 * honest caveat in real work, and filing that as a non-answer would be worse than the bug.
 *
 *   · THE ADMISSION MUST OPEN THE REPLY (within `OPENING_CHARS`). A reply that leads with what it
 *     could not do is telling you what it is. A caveat two pages in is a caveat.
 *   · THE WHOLE REPLY MUST BE SHORT (`NON_ANSWER_MAX_CHARS`). A model that did the work writes the
 *     work. The real failure was a single short paragraph.
 *
 * Both, never either. And when the call is wrong, it is wrong in the cheap direction: the model's
 * text is KEPT IN FULL on the task either way — `cannotDoTask` writes it to `tasks.output` exactly
 * as `awaiting_approval` would have — so a false positive costs her one email and a task filed
 * under the wrong heading with every word still there. A false negative is the silent bug this
 * exists to remove. That asymmetry is why the gates are two plain thresholds and not a cleverer
 * score nobody can predict.
 */

/**
 * How far into the reply the admission may begin and still BE the reply rather than a caveat within it.
 *
 * ~200 characters is the opening breath: a sentence, or two short ones. Measured against the cases
 * in `scripts/validate/a-non-answer-is-not-a-draft.mjs`, every genuine non-answer opens at
 * character ZERO — a model with nothing to give leads with that — while the honest caveat inside a
 * real draft sat at 312. The gate was 400 for one draft of this module and that real draft failed
 * it, which is the whole reason the number is measured rather than chosen.
 */
export const OPENING_CHARS = 200;

/**
 * Above this many characters the model produced work, whatever it said about its limits.
 *
 * The production failure was a single short paragraph; a real ops draft — an agenda, a memo, a
 * digest — runs to several thousand. The number sits deliberately well above the first and well
 * below the second, so it is a shape test rather than a tuned threshold.
 */
export const NON_ANSWER_MAX_CHARS = 2000;

/**
 * FIRST-PERSON STATEMENTS OF MISSING CAPABILITY, AND NOTHING ELSE.
 *
 * Every pattern here is the model talking about ITSELF in the present tense. Deliberately absent:
 * "there is no way to", "this is not possible", "the data is unavailable" — all three are ordinary
 * findings about the world, and a finding is work. The subject of the sentence is the whole test.
 */
export const CANNOT_DO_RULES = [
  {
    why: "it said it has no access to what it was asked to work on",
    re: /\bI\s+(?:do\s+not|don'?t|did\s+not|didn'?t)\s+have\s+(?:direct\s+|the\s+|any\s+|live\s+|real[- ]time\s+)?access\s+to\b/i,
  },
  {
    why: "it said it is unable to reach or open the thing it was asked about",
    /*
     * THE CONTRACTION IS PART OF THE PRONOUN, NOT A WORD AFTER IT. An earlier draft wrote this as
     * `I\s+(?:...|'?m\s+unable...)` and "I'm unable to access the repository" — the single most
     * common phrasing there is — went straight through, because there is no whitespace between
     * `I` and `'m`. Caught by the validator's second case before it ever ran against a real reply.
     */
    re: /\b(?:I\s+(?:cannot|can\s?not|am\s+unable\s+to|am\s+not\s+able\s+to)|I['\u2019]?m\s+(?:unable|not\s+able)\s+to)\s*(?:directly\s+|actually\s+|currently\s+)?(?:access|read|open|browse|fetch|retrieve|download|view|inspect|examine|clone|check\s+out|execute|run|dig\s+through|look\s+(?:at|through|into))\b|\bI\s+can['\u2019]?t\s+(?:directly\s+|actually\s+|currently\s+)?(?:access|read|open|browse|fetch|retrieve|download|view|inspect|examine|clone|check\s+out|execute|run|dig\s+through|look\s+(?:at|through|into))\b/i,
  },
  {
    why: "it said it has no tools or ability for the work it was asked to do",
    re: /\bI\s+(?:do\s+not|don'?t)\s+have\s+(?:the\s+)?(?:ability|capability|capabilities|means|tools?|a\s+way|any\s+way|permission|credentials)\b/i,
  },
  {
    why: "it said it has no access at all",
    re: /\bI\s+have\s+no\s+(?:direct\s+)?(?:access|ability|way|tools?|visibility)\b/i,
  },
  {
    why: "it said it has no visibility into what it was asked about",
    re: /\bI\s+(?:do\s+not|don'?t)\s+have\s+(?:visibility|sight|insight)\s+into\b/i,
  },
  {
    why: "it asked to be given access rather than doing the work",
    re: /\bI\s+(?:would|'?d|will|'?ll)\s+need\s+(?:you\s+to\s+(?:give|grant|provide)\s+me\s+)?access\s+to\b/i,
  },
  {
    why: "it said it has not been given the material it was asked to work from",
    re: /\bI\s+(?:have\s+not|haven'?t)\s+been\s+(?:given|provided(?:\s+with)?)\s+(?:the|any|access)\b/i,
  },
];

/**
 * Is this completion transparently a non-answer?
 *
 * @param {string} text the model's whole reply
 * @returns {{ matched: string, why: string, at: number, chars: number } | null} null is the
 *   ordinary answer, and it is the answer for the overwhelming majority of completions.
 */
export function cannotDoIn(text) {
  const reply = String(text ?? "");
  const trimmed = reply.trim();
  if (!trimmed) return null;
  // A model that produced work produced work. This gate is checked first because it is the cheap one.
  if (trimmed.length > NON_ANSWER_MAX_CHARS) return null;

  for (const rule of CANNOT_DO_RULES) {
    const m = rule.re.exec(trimmed);
    // The admission must OPEN the reply. `m.index` is measured on the trimmed text so leading
    // whitespace from a model that likes a blank first line cannot push it past the gate.
    if (!m || m.index >= OPENING_CHARS) continue;
    return { matched: m[0].replace(/\s+/g, " ").trim(), why: rule.why, at: m.index, chars: trimmed.length };
  }
  return null;
}

/**
 * ─── WHAT SHE IS TOLD, IN ONE PLACE ────────────────────────────────────────
 *
 * The task's error line, the event detail and the subject of the email she gets are all built from
 * this, so the three can never say different things about the same run. "Two components each
 * keeping their own list" is this repository's most-named defect and a message is a list of one.
 */
export function cannotDoSummary(employeeName, finding) {
  const who = String(employeeName ?? "").trim() || "The employee";
  return `${who} could not actually do this: ${finding.why}. The run was one cloud completion with no repository, no filesystem and no tools.`;
}

/** The one sentence that says what would have to change for the work to happen. */
export function cannotDoHint(handedTo) {
  return handedTo
    ? `Nothing here needs you: it has been handed to ${handedTo}, whose lane runs on your Mac and can actually open the repository. Her plan will come to you by email.`
    : "This work needs a seat with a filesystem and tools. Re-raise it on a desk whose lane runs on your Mac, or narrow it to something answerable without opening anything.";
}
