/**
 * DOES A PRIVATE WORD REACH THE GROWTH DIRECTOR'S MODEL? (22 Nov 2026, review of #546: client names and
 * personal mail addresses were in the decision prompts.) One check, run on every prompt the Monday cycle
 * builds, before any model call (run.ts), and by `npm run growth:privacy` on a brain copy.
 *
 * A prompt LEAKS when it carries:
 *   - a word her brains hold ONLY inside a confidential span (a capitalised word of 3+ letters, or a
 *     mail address): it is private, so the cut missed it;
 *   - a personal mail address (gmail and the like), marked or not.
 * The prompt's own fixed words (its instructions, the playbook, the roster entry, the counts: the
 * prompt built without her rulings) are public by origin, so only what her rulings add can leak.
 * A hit names the ruling headings and a count, never the word.
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

/**
 * The check on one built prompt. `fit` = fitDecisionPrompt with her rulings, `bare` = the same prompt
 * built without them, `rulings` = what rulingsFor gave. `where` = the headings of the ruling groups in
 * the prompt that carry the hit. `unread` = no private word is known, so nothing can be told apart.
 */
export function promptLeak({ fit, bare, rulings, terms }) {
  if (!termCount(terms)) return { unread: true, private: 0, mail: 0, where: [] };
  const known = wordsOf(bare.messages.map((m) => m.content).join("\n"));
  const hit = leaksIn(fit.messages.map((m) => m.content).join("\n"), terms, known);
  const sent = [...(rulings?.own ?? []), ...(rulings?.shared ?? []).filter((g) => !(fit.left ?? []).includes(g.heading))];
  const where = sent.filter((g) => { const h = leaksIn(g.body, terms, known); return h.private || h.mail; }).map((g) => g.heading);
  return { unread: false, private: hit.private, mail: hit.mail, where };
}
