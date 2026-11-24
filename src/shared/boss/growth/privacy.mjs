/**
 * DOES A PRIVATE WORD REACH NOELLE? (22 Nov 2026, review of #546: client names and personal mail addresses
 * were in the decision prompts.) Run on every business's rulings when her context is built
 * (src/worker/boss/growth/noelle.ts noelleContext), before any of it leaves the Worker.
 *
 * Text LEAKS when it carries:
 *   - a word her brains hold ONLY inside a confidential span (a capitalised word of 3+ letters, or a
 *     mail address): it is private, so the cut missed it;
 *   - a personal mail address (gmail and the like), marked or not.
 * A hit is a count, never the word.
 *
 * FAILS CLOSED: no private word at all in the brains means a client name cannot be told from any other
 * word, so the check is UNREAD (`termCount` 0), never a pass. The caller holds the business.
 */
import { confidentialSpans, stripConfidential } from "../brains/brain.mjs";

// The provider's own domain ends the address (gmail.com, yahoo.co.uk), so a brand's own host that starts
// with a provider word (hello@live.brand.com, x@mac.brand.co) is not a personal address.
export const PERSONAL_MAIL_RE = /[\w.+-]+@(?:gmail|googlemail|yahoo|ymail|icloud|me|mac|hotmail|outlook|live|aol|proton|protonmail)\.[a-z]{2,3}(?:\.[a-z]{2})?(?![\w-])(?!\.\w)/gi;
const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NAME_RE = /\b[A-Z][a-z]{2,}\b/g;
export const wordsOf = (text) => new Set(String(text).toLowerCase().match(/[a-z]+/g) ?? []);

/** Words found only inside confidential spans of these brains (null = not read), never in their public text or in `alsoPublic`. */
export function privateOnlyTerms(mds, alsoPublic = "") {
  const read = Object.values(mds).filter((md) => typeof md === "string");
  const publicText = [...read.map((md) => stripConfidential(md)), alsoPublic].join("\n");
  const pub = wordsOf(publicText);
  const lowerPublic = publicText.toLowerCase();
  const names = new Set(); const mails = new Set();
  for (const md of read) {
    for (const span of confidentialSpans(md)) {
      for (const m of span.match(MAIL_RE) ?? []) if (!lowerPublic.includes(m.toLowerCase())) mails.add(m.toLowerCase());
      for (const w of span.replace(MAIL_RE, " ").match(NAME_RE) ?? []) if (!pub.has(w.toLowerCase())) names.add(w.toLowerCase());
    }
  }
  return { names: [...names], mails: [...mails] };
}

export const termCount = (terms) => (terms?.names?.length ?? 0) + (terms?.mails?.length ?? 0);

/** How many private terms and personal addresses one text carries; `known` = words its fixed text already has. */
export function leaksIn(text, terms, known = new Set()) {
  const t = String(text); const w = wordsOf(t); const lower = t.toLowerCase();
  return {
    private: terms.names.filter((n) => w.has(n) && !known.has(n)).length + terms.mails.filter((m) => lower.includes(m)).length,
    mail: (t.match(PERSONAL_MAIL_RE) ?? []).length,
  };
}

