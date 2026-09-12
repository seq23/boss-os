/**
 * AN EMPLOYEE WHO DOES NOT UNDERSTAND ASKS. IT DOES NOT GENERATE.
 *
 * Owner, 11 September 2026: "can u make it so that if simone doesnt understand something she emails
 * back for clarity".
 *
 * ─── THE FAILURE THIS IS BUILT FROM ────────────────────────────────────────
 *
 * "#Monique - Please add searching for buyers of Databricks to the weekly list" routed perfectly,
 * reached the right desk, was handed to a language model, and came back with "It appears that you're
 * referring to a set of instructions or a to-do list related to managing a meeting or interaction
 * with a superior, possibly a 'Boss'" — which then sat in her approval queue under her own
 * instruction. Nothing errored. The system was confident and wrong, which is the worst of the three
 * available outcomes: silence, a question, or an invention.
 *
 * So: THE QUESTION IS ASKED BEFORE THE MODEL RUNS, never after. A clarification sent alongside a
 * hallucination is worse than either alone, because she then has to work out which of her own
 * employees to believe.
 *
 * ─── WHERE THE LINE IS DRAWN, AND WHY IT IS DRAWN THERE ────────────────────
 *
 * A system that asks about everything is exactly as useless as one that guesses about everything,
 * and it is worse in one specific way: she stops reading it. So this does not ask "am I sure?" of
 * every message. It asks in two narrow, NAMED situations, both of which are cases where the same
 * words have two different consequences and the machine cannot tell which she meant:
 *
 *   1. AMBIGUOUS AGAINST A STRUCTURED ARTEFACT. She used a change verb — add, remove, drop — at a
 *      desk that owns a structured artefact (the live book), without the grammar that artefact
 *      accepts. "Please add searching for buyers of Databricks" is either `#monique add Databricks`
 *      or a note about the weekly list, and those produce completely different weeks. This is the
 *      exact shape that failed.
 *
 *   2. NOTHING TO ACT ON AT ALL. A tag and no instruction: `#monique`, `#simone ?`, `#zora this`.
 *      There is no sentence to misread, which means anything generated from it is invented whole.
 *
 * EVERYTHING ELSE IS AN ORDINARY INSTRUCTION AND IS WORKED, INCLUDING IMPERFECT ONES. "can you
 * follow up with the $50M guy tomorrow" names no artefact change and is perfectly actionable by a
 * person; a forward with `#monique` above it is her most common message and means "deal with this".
 * Neither asks. Lowering that bar to ask more often would not be caution, it would be the
 * hallucination coming back through a different door: the way to ask fewer stupid questions is not
 * to ask more of them.
 *
 * ─── ONE QUESTION PER MESSAGE, EVER ────────────────────────────────────────
 *
 * A reply to a clarification routes as an ordinary message and can never produce a second question.
 * Without that this is an inbox attack on the owner by her own system: she answers, the answer is
 * short and therefore "nothing to act on", and it asks again forever. A message that is a REPLY —
 * `In-Reply-To`/`References`, or a `Re:` subject — is never questioned.
 *
 * Plain ESM with a hand-written `.d.mts`, like its neighbours, so `scripts/validate` can exercise
 * these rules directly rather than asserting a copy of them.
 */

/** The desks that own a structured artefact whose grammar a prose instruction can collide with. */
const OWNS_THE_BOOK = "Relationships";

/** Words that change an artefact rather than describe one. */
const CHANGE_VERB = /\b(?:add|adding|added|remove|removing|removed|drop|dropping|delete|deleting|take\s+(?:off|out)|put|include|including|take\s+on)\b/i;

/** Words that say the change is about her inventory rather than about her week. */
const BOOK_WORDS = /\b(?:book|inventory|lot|lots|block|blocks|buyers?|sellers?|sell[-\s]?side|position|shares|size|list)\b/i;

/** Openers and pleasantries that are not the name of anything. */
const NOT_A_NAME =
  /^(?:please|pls|hi|hey|hello|thanks|thank|can|could|would|will|i|we|you|they|the|a|an|and|but|so|for|to|of|it|this|that|these|those|my|our|your|his|her|their|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;

/** Text with the employee tags taken out, which is what she actually wrote. */
export function withoutTags(text) {
  return String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * The thing she named, out of a line of prose. Capitalised, not a pleasantry, not the first word of
 * the sentence unless nothing else qualifies. Null when there is no candidate — in which case the
 * question quotes her line instead of guessing at a subject, which is the honest fallback.
 */
export function namedThing(line) {
  const words = withoutTags(line).split(/[\s,;:.!?]+/).filter(Boolean);
  const candidates = words.filter((w, i) =>
    /^[A-Z][A-Za-z0-9.&'’-]{2,}$/.test(w) && !NOT_A_NAME.test(w) && (i > 0 || words.length === 1));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/** Is this message an answer to something rather than a new instruction? */
export function isReplyMessage({ subject, inReplyTo, references }) {
  if (inReplyTo || references) return true;
  return /^\s*re\s*:/i.test(String(subject ?? ""));
}

/**
 * Does this message need a question asked before anything is generated from it?
 *
 * Returns null for the overwhelming majority of messages, and null is the ordinary path untouched.
 * When it returns, `ask` is the whole body of the reply: what it understood, what it could not, and
 * exactly what to send back. "Please clarify" is not a question — it is the absence of one, and she
 * would be right to ignore it.
 */
export function clarificationFor(input) {
  const {
    subject = "", body = "", department = "", seatName = "there", tag = null,
    isReply = false, hasVerb = false, bookFiled = false, forwarded = false, unread = false,
  } = input ?? {};

  // She said exactly what she meant, or she is answering a question. Neither needs one asked.
  if (hasVerb || bookFiled || isReply) return null;

  /*
   * THE SUBJECT COUNTS AS WHAT SHE SAID. She routinely puts the whole instruction there — "#monique
   * have a look" with "please" underneath — and reading only the body would find one word, decide
   * there was nothing to act on, and ask her a question about a message that was perfectly clear.
   */
  const said = withoutTags(`${subject}\n${body}`);
  const seatTag = tag ?? "#" + String(seatName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  /*
   * 1. A CHANGE VERB AT THE DESK THAT OWNS THE BOOK. Two readings, opposite weeks.
   */
  if (department === OWNS_THE_BOOK && CHANGE_VERB.test(said) && BOOK_WORDS.test(said)) {
    const line = `${body ?? ""}\n${subject ?? ""}`.split(/\r?\n/).map((l) => l.trim())
      .find((l) => l && CHANGE_VERB.test(withoutTags(l))) ?? said;
    const thing = namedThing(line);
    return {
      reason: "book_or_note",
      why: `It reads as a change to her live book and does not say so in the grammar the book takes, so ${seatName} asked rather than guessed.`,
      ask: [
        `${seatName} here. I have not done anything with this yet, because it reads two ways and`,
        "they are not the same week's work.",
        "",
        "You wrote:",
        `  ${line}`,
        "",
        thing
          ? `I think you mean ${thing} should be on your live book so I hunt buyers for it — but I cannot`
          : "I think you mean something should change on your live book — but I cannot",
        "tell whether you want a size carried against it, and I will not invent one.",
        "",
        "Reply with one of these and it is done on arrival:",
        thing
          ? `  ${seatTag} add ${thing} — $20M          (any size you like)`
          : `  ${seatTag} add Databricks — $20M       (name it and size it)`,
        thing
          ? `  ${seatTag} add ${thing} — size TBD      (no size yet; I hunt buyers anyway)`
          : `  ${seatTag} add Databricks — size TBD   (no size yet; I hunt buyers anyway)`,
        "",
        `If this was NOT about your book, say so in a reply and I will work it as you wrote it —`,
        "a reply never comes back here as another question.",
      ].join("\n"),
    };
  }

  /*
   * 2. A TAG AND NO INSTRUCTION. A forward is exempt: "here, deal with this" is a complete thought
   * and is her most common message.
   */
  /*
   * AN UNREAD MESSAGE IS NOT AN EMPTY ONE, AND THIS IS WHERE THE TWO GOT CONFUSED.
   *
   * `unread` says the intake CHOSE not to parse — the oversize path streams the message to R2 and
   * never decodes it, so the body it hands over is `""` for a reason that has nothing to do with
   * what she wrote. Reading that as "a tag and no instruction" produced the 12 September 2026
   * failure: her 538,189-byte message was stored intact, asked back "what would you like me to do?",
   * and opened no work, because `nothing_to_act_on` gated out the very branch that was supposed to
   * open a card for an unread message.
   *
   * So this rule is about ABSENCE OF INSTRUCTION, and only the intake knows whether the absence is
   * hers. When it says the text was never read, this rule has no opinion and yields.
   */
  const words = said.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!unread && !forwarded && words.length < 3) {
    return {
      reason: "nothing_to_act_on",
      why: `There was no instruction in it — ${words.length} word(s) — so ${seatName} asked instead of inventing one.`,
      ask: [
        `${seatName} here. This reached me with nothing in it I can act on, so I have not started`,
        "anything and nothing is waiting for your approval.",
        "",
        said ? `All I have is: "${said}"` : "The message had no readable text at all.",
        String(subject ?? "").trim() ? `The subject was: ${String(subject).trim()}` : "",
        "",
        "What would you like me to do? One line is enough — a reply goes straight into work and",
        "never comes back here as another question.",
      ].filter((l) => l !== "").join("\n"),
    };
  }

  return null;
}
