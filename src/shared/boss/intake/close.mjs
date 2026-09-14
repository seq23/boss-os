/**
 * "PLEASE CLOSE OUT THE KDP UPLOAD ISSUE" — APPLIED, NOT PARAPHRASED.
 *
 * ─── The failure this is built from ────────────────────────────────────────
 *
 * On 14 September 2026 at 09:23 Central, Simone's case watcher emailed her about a KDP publishing
 * block that had cleared two days earlier: six of the seven titles were Live on the bookshelf. At
 * 09:27 she replied to `boss@sequoiataylor.com`:
 *
 *     #simone please close out the kdp upload issue. The books have been published and the error
 *     resolved. All you need to do going forward is monitor the inbox for kdp emails …
 *
 * It arrived, it was authorised, it routed to Simone — and then it went to a language model, which
 * wrote "The KDP upload issue is now closed since the books have been published" and put THAT
 * paragraph in her approval queue. `owned_deliverables.del_kdp_publication` stayed `blocked`. The
 * watcher would have emailed her again on Wednesday. Her instruction was understood by a model and
 * applied by nothing.
 *
 * ─── Why this is a rule and not a model ────────────────────────────────────
 *
 * The same reason `handoff.mjs` and `liveBook.mjs` are rules: a model given her sentence produced a
 * paragraph ABOUT closing and no row changed. An instruction to stop a commitment is a state change
 * on a specific record, and a state change is either made or it is not. This finds the record by
 * rule, and the caller changes it, and the reply says which row changed and why.
 *
 * ─── What it may and may not do ────────────────────────────────────────────
 *
 *   - It only ever matches deliverables OWNED BY THE SEAT the message routed to. Telling Simone to
 *     close something cannot close Monique's work.
 *   - It fires on an EXPLICIT close verb — "close out", "close", "resolve", "wrap up", "stop
 *     chasing", "call it done". "The error resolved" on its own is a statement of fact, not an
 *     instruction, and does not fire; the same message with "close out" in it does.
 *   - It must find EXACTLY ONE open deliverable. Two matches is a question for her, not a guess.
 *   - It returns null far more often than not, and null is the ordinary path.
 *
 * Plain ESM with a hand-written `.d.mts`, like its neighbours, so `scripts/validate` can exercise
 * the same function the Worker calls.
 */

/** She said to close something. Explicit verbs only. */
export const CLOSE_VERBS = [
  /\bclose\s+(?:out|off|down)\b/i,
  /\bclose\s+(?:the|this|that|it|my|our)\b/i,
  /\bclosed?\s+(?:out\s+)?(?:the|this|that|it)\b/i,
  /\b(?:resolve|wrap\s+up|wrap\s+it\s+up|call\s+(?:it|this|that)\s+(?:done|closed|finished))\b/i,
  /\bstop\s+(?:chasing|working\s+on|tracking|nagging\s+(?:me\s+)?about)\b/i,
  /\bmark\s+(?:it|this|that|the\s+\w+)\s+(?:as\s+)?(?:done|closed|resolved|complete|finished)\b/i,
];

/** Words too common to identify anything. */
const STOP = new Set([
  "every", "each", "with", "from", "that", "this", "into", "have", "been", "their", "your", "when",
  "what", "which", "will", "there", "about", "after", "before", "over", "under", "than", "them",
  "then", "they", "were", "also", "only", "just", "more", "some", "most", "such", "very", "and",
  "the", "for", "are", "not", "but", "she", "her", "his", "its", "all", "any", "one", "two",
]);

/** The text she wrote, with employee tags removed so a tag is never a keyword. */
function said(text) {
  return String(text ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, " ");
}

const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Did she explicitly ask for something to be closed? Returns the sentence that says so — which is
 * the reason recorded on the row — or null.
 */
export function closeSentenceIn(text) {
  const clean = said(text);
  const sentences = clean.split(/(?<=[.!?])\s+|\r?\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (CLOSE_VERBS.some((re) => re.test(s))) return s.slice(0, 500);
  }
  return null;
}

/**
 * The identifying tokens of a deliverable: the words of its id (minus the `del_` prefix) and the
 * meaningful words of its name. `del_kdp_publication` / "Every authored book published" gives
 * `kdp`, `publication`, `authored`, `book`, `published`.
 */
export function tokensOf(deliverable) {
  const id = String(deliverable?.id ?? "").replace(/^del_/, "").split("_").filter((t) => t.length >= 3);
  const name = words(deliverable?.name).filter((w) => w.length >= 4 && !STOP.has(w));
  return { id, name };
}

/**
 * Which of the seat's open deliverables does the text name?
 *
 * A deliverable matches on ANY id token as a whole word (`kdp`), or on at least TWO name tokens by
 * prefix (`book` matches "books", `publish` matches "published"). One name word is not a match —
 * "book" is in half her mail.
 */
export function deliverablesNamedIn(text, deliverables) {
  const have = words(said(text));
  const haveSet = new Set(have);
  const hits = [];
  for (const d of deliverables ?? []) {
    const { id, name } = tokensOf(d);
    const idHits = id.filter((t) => haveSet.has(t));
    const nameHits = name.filter((t) => have.some((w) => w.startsWith(t) || (t.startsWith(w) && w.length >= 4)));
    if (idHits.length >= 1 || nameHits.length >= 2) {
      hits.push({ id: d.id, name: d.name, matched: [...new Set([...idHits, ...nameHits])] });
    }
  }
  return hits;
}

/**
 * The directive, if her message carries one.
 *
 * @returns `{ id, name, matched, reason }` when exactly one open deliverable is named beside a close
 *   verb; `{ ambiguous: [...] }` when more than one is; null otherwise. Null is the ordinary path.
 */
export function closeDirectiveFor({ text = "", subject = "", deliverables = [] } = {}) {
  const haystack = `${subject}\n${text}`;
  const reason = closeSentenceIn(haystack);
  if (!reason) return null;
  const hits = deliverablesNamedIn(haystack, deliverables);
  if (hits.length === 0) return null;
  if (hits.length > 1) return { ambiguous: hits.map((h) => h.id) };
  return { ...hits[0], reason };
}
