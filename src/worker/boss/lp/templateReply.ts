/**
 * ─── HER REPLY TO THE PROSPECT-EMAIL CARD (owner, 25 Oct 2026) ───────────────
 *
 * Her morning email numbers every Decide card and says how to answer it ("Reply '5: your changes'").
 * A reply that names the prospect-email card — by its number in that morning's email, or by the
 * template's id — goes to Monique's template, never to generic intake:
 *
 *   "5: approved"                 approves it (the follow-ups it releases ride with it)
 *   "5: try again" / "5: I don't like this, try again"
 *                                 a structurally different draft (`PROSPECT_VARIANTS`), old one retired
 *   "5: <her changes>"            her words kept on the template; what they say plainly is applied
 *                                 (`applyTemplateNotes`), a general rule ("never …", "always …")
 *                                 becomes a standing template rule; the redraft retires the old one
 *
 * She gets ONE short reply: the new email word for word with Approve / Change / Try again. Nothing
 * goes to a prospect until she taps Approve. Called below the mailbox's sender refusal.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { approveTemplate, redraftTemplate, followUpsReleased, storedTemplate } from "./desk";
import { renderProspect, tapUrl, hasTouchWords } from "../../../shared/boss/lp/plan.mjs";
import { ownWords } from "../../../shared/boss/intake/messageBody.mjs";
import { decideCardOf } from "./decideReply";
import { readMeaning } from "../intake/meaning";
import { logReplyDecision, type ReplyDecision } from "../intake/firstRead";
import { sentencesOf, standingIn, stands, vetoOf } from "../../../shared/boss/text/wholeSentence.mjs";

/** "5: …", "#5 …", "5. …", "5) …" at the start of her reply. */
export const NUMBERED_REPLY_RE = /^\s*#?(\d{1,2})\s*(?::|\.|\)|-|—|\s)\s*([\s\S]*)$/;
const TEMPLATE_ID_RE = /\b(ptp_[a-z0-9]{6,40})\b/i;

/** Her words that are a rule for every future email, not a one-off edit. */
const GENERAL = /\b(?:never|always|every(?:\s+(?:email|template|time))?|from now on|in future|going forward|don't ever)\b/i;

/** The one reply she gets: the new email word for word and the three links. Plain. */
export function redraftReply(tpl: any, opts: { applied?: string[]; kept?: string[]; released?: { count: number; firstSentOn: string | null }; headline?: string }) {
  const names = JSON.parse(tpl.names_json ?? "[]");
  const t = storedTemplate(tpl);
  const first = renderProspect(t, { first: "Alex", names });
  const follow = renderProspect(t, { first: "Alex", names, touch: 2 });
  // Emails 3 and 4 (6 Nov 2026), word for word when the draft has them.
  const later = [3, 4].filter((n) => hasTouchWords(t, n)).map((n) => ({ n, body: renderProspect(t, { first: "Alex", names, touch: n }).body }));
  const day = opts.released?.firstSentOn ? new Date(`${opts.released.firstSentOn}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/^(\w+) (\d+)$/, "$2 $1") : null;
  return [
    opts.headline ?? "Here is the new prospect email, word for word. Nothing goes out until you tap Approve.",
    ...(opts.applied?.length ? [`What I changed: ${opts.applied.join("; ")}.`] : []),
    ...(opts.kept?.length ? [`Kept on record as your note: ${opts.kept.map((k) => `"${k}"`).join("; ")}.`] : []),
    ...(opts.released?.count ? [`Approving this also lets the follow-ups go to the ${opts.released.count} people who got your first email${day ? ` on ${day}` : ""}.`] : []),
    "",
    "The email, word for word:",
    ...[`Subject: ${first.subject}`, ...first.body.split("\n").filter((l) => l.trim())].map((l) => `> ${l}`),
    "",
    later.length ? "Email 2 (day 3), word for word:" : "The follow-up (email 2, day 3), word for word:",
    ...follow.body.split("\n").filter((l) => l.trim()).map((l) => `> ${l}`),
    "",
    ...later.flatMap((l) => [`Email ${l.n} (day ${l.n === 3 ? 7 : 14}), word for word:`, ...l.body.split("\n").filter((x) => x.trim()).map((x) => `> ${x}`), ""]),
    `Tap to approve: ${tapUrl(tpl.tap_token, "approve")}`,
    `Tap to change it: ${tapUrl(tpl.tap_token, "edit")} (or reply with your changes)`,
    `Tap to try again: ${tapUrl(tpl.tap_token, "retry")}`,
  ].join("\n");
}

/** Plainly "yes" and nothing else: what the keywords call an approval. */
const APPROVE_RE = /^(?:approved?|yes|go|ok(?:ay)?)[.!]?$/i;
const TRY_AGAIN_RE = /\btry again\b|\bstart over\b|\bdifferent (?:one|draft|version)\b|\banother (?:go|draft|version)\b/i;
/** An approval word anywhere: never acted on unless it is the whole answer, but it means "ask", never "redraft". */
const APPROVE_WORD_RE = /\bapprov(?:e|ed|es|ing)\b/i;
/** Words that carve something out of an approval. */
const EXCEPT_RE = /\bexcept\b|\bbut not\b|\bother than\b|\bapart from\b|\bexcluding\b/i;

export type TemplateMeaning = "approve" | "try_again" | "change" | "unsure";

/*
 * TRY AGAIN IS JUDGED IN ITS OWN CLAUSE (#510 review, F4a). A negation belongs to the clause it sits in: "I don't
 * like this, try again" asks for a fresh draft; "don't try again, just shorten it" does not. A condition, a report
 * or a question still holds the whole sentence back ("if it's off, try again" is not yet an ask). Only try again is
 * judged this way: a redraft sends nothing. An approval keeps the whole-sentence judge, so "not approved, yes I
 * read it" never approves.
 */
const CLAUSE_BREAK = /,|\s[-—–]\s|\bbut\b/i;
const SENTENCE_SHAPES = ["CONDITIONS", "REPORTS", "ASKS"] as const;
const flat = (t: string) => t.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim();
const clausesOf = (sentence: string) => sentence.split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean);

/** Her words ask for a different draft: the phrase stands in its clause, and nothing holds the sentence back. */
export function tryAgainStands(words: string): boolean {
  return sentencesOf(words).some((x) => standingIn(x.text, TRY_AGAIN_RE, SENTENCE_SHAPES)
    && clausesOf(x.text).some((c) => standingIn(c, TRY_AGAIN_RE, ["NEGATES"]) !== null));
}

/**
 * A model's try-again quote, judged the same way (#510 re-check, F5): its sentence is not held back, and it is judged
 * by the clause that holds the ask. When her sentence names a fresh draft ("try again", "start over"), the quote must
 * cover a clause where that phrase stands: a whole-sentence quote of "I don't like this, try again" passes (the
 * negation sits in another clause), and "just shorten the opening" quoted from "Don't try again, just shorten the
 * opening." does not (it holds no ask). Only when her sentence names no such phrase (the model read a paraphrase)
 * must every clause the quote covers be un-negated.
 */
export function tryAgainQuoteStands(words: string, quote: string): boolean {
  const q = flat(quote);
  if (!q) return false;
  // EVERY sentence the quote covers (#510 re-check, F5b): a quote of her whole reply "I don't like this. Try again."
  // is judged on both sentences, never on the first one alone.
  const covered = sentencesOf(words).map((x) => x.text).filter((t) => flat(t).includes(q) || q.includes(flat(t)));
  if (!covered.length) return !vetoOf(quote);
  const holdingIn = (t: string) => {
    const inside = clausesOf(t).filter((c) => flat(c).includes(q) || q.includes(flat(c)));
    return q.includes(flat(t)) ? clausesOf(t) : inside;
  };
  const asks = covered.filter((t) => TRY_AGAIN_RE.test(t));
  if (asks.length) {
    // A condition, a report or a question on a sentence that holds the ask holds it back ("Can you try again?").
    if (asks.some((t) => vetoOf(t, null, SENTENCE_SHAPES))) return false;
    return asks.some((t) => holdingIn(t).some((c) => standingIn(c, TRY_AGAIN_RE, ["NEGATES"]) !== null));
  }
  // The model read a paraphrase: nothing covered may be held back or negated.
  if (covered.some((t) => vetoOf(t, null, SENTENCE_SHAPES))) return false;
  return covered.every((t) => {
    const holding = holdingIn(t);
    return holding.length === 0 ? !vetoOf(quote, null, ["NEGATES"]) : holding.every((c) => !vetoOf(c, null, ["NEGATES"]));
  });
}

/**
 * Her words, by the keywords alone (the logged last resort and the reading of one numbered answer). Every phrase is
 * judged in its whole sentence (`stands`, the shared judge); try again in its own clause (`tryAgainStands`): "I don't
 * like this, try again" is a fresh draft, "don't try again, just shorten it" is a change. Pure.
 */
export function templateKeywordMeaning(words: string): TemplateMeaning {
  if (APPROVE_RE.test(words.trim())) return "approve";
  if (tryAgainStands(words)) return "try_again";
  if (stands(words, APPROVE_WORD_RE)) return "unsure";
  return words.trim() ? "change" : "unsure";
}

/**
 * What her words to the card MEAN when the email had NO first read: the model (meaning.ts) with the keywords as the
 * logged fallback. Approving sends email to prospects, so a model's approve must quote words that stand in her
 * sentence (`acts`, checked by `quoteStands` in `checkMeaning`); otherwise it is unsure and she is asked.
 */
export async function templateMeaningOf(env: Env, words: string, mailId: string | null = null): Promise<TemplateMeaning> {
  const keyword = templateKeywordMeaning(words);
  const read = await readMeaning<Exclude<TemplateMeaning, "unsure">>(env, {
    what: "her reply to the prospect email",
    about: "This is the owner's reply to a draft prospect email waiting for her approval.",
    options: {
      approve: "she approves the draft as it is, to go out",
      try_again: "she wants a different draft altogether",
      change: "she asks for changes to the draft (her words say what to change)",
    },
    // Approving sends, so its quote must stand in the whole sentence; try again only redrafts, and its quote is
    // judged in its own clause just below (F4a).
    acts: ["approve"],
    text: words, keyword, mailId,
  });
  if (read.value === "try_again" && read.by === "model" && !tryAgainQuoteStands(words, read.quote ?? "")) return "change";
  return read.value;
}

/**
 * WHAT HER REPLY DECIDES, FROM THE EMAIL'S FIRST READ (fresh review of #510, F1). The email was already read once;
 * the card never reads it a second time. It approves only when the first read says the reply is `approved`, or
 * when this card's own numbered answer is a plain approval (a numbered reply the read did not answer is judged on
 * her card words alone, never on the reply's "approved"). Try again or change is told from that answer's
 * words. Anything else that names an approval is asked, never redrafted. Pure.
 */
export function templateMeaningFromRead(read: ReplyDecision, card: number | null, words: string): TemplateMeaning {
  const answer = card === null ? null : read.answers.find((a) => a.n === card)?.text?.trim() || null;
  if (answer) return templateKeywordMeaning(answer);
  // A numbered answer to THIS card that the read did not answer is judged on her card words alone: the reply's
  // "approved" may belong to another card or the batch, and never approves this one (F4b). Only a bare
  // "approved" in her own card words does.
  if (card !== null) return templateKeywordMeaning(words);
  // Approving sends to prospects: the first read's "approved" approves only when her own words hold an approval that
  // stands ("approved", "yes", or an approve word no negation, question or condition holds back); else she is asked.
  // An exception ("approve all except 2", "but not the second") holds it back: what it leaves out would be sent.
  if (read.reply === "approved") return !EXCEPT_RE.test(words) && (APPROVE_RE.test(words.trim()) || stands(words, APPROVE_WORD_RE)) ? "approve" : "unsure";
  if (read.reply === "held") return "unsure";
  const kw = templateKeywordMeaning(words);
  return kw === "approve" ? "unsure" : kw;
}

export async function prospectTemplateFromMail(env: Env, text: string, now = Date.now(), day: string | null = null, mailId: string | null = null, read: ReplyDecision | null = null): Promise<{ note: string; outcome: string } | null> {
  // Her words only: never the quoted morning email under them.
  const her = ownWords(text);
  let templateId: string | null = null;
  let words = her;
  let cardN: number | null = null;
  const numbered = NUMBERED_REPLY_RE.exec(her);
  if (numbered) {
    const card = await decideCardOf(env, Number(numbered[1]), day);
    if (card?.key?.startsWith("prospect-template:")) { templateId = card.key.slice("prospect-template:".length); words = numbered[2]!.trim(); cardN = Number(numbered[1]); }
  }
  if (!templateId) {
    const id = TEMPLATE_ID_RE.exec(her)?.[1];
    if (!id) return null;
    templateId = id.toLowerCase();
    words = her.replace(TEMPLATE_ID_RE, "").replace(/^\s*[:.\-—]\s*/, "").trim();
  }
  const row = await env.DB.prepare(`SELECT * FROM prospect_templates WHERE id = ?`).bind(templateId).first<any>();
  if (!row) return null;
  // A reply to an older draft lands on the one waiting now.
  const live = row.status === "pending" ? row : await env.DB.prepare(`SELECT * FROM prospect_templates WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`).first<any>() ?? row;
  const released = await followUpsReleased(env.DB);

  let meaning: TemplateMeaning;
  if (read) {
    meaning = templateMeaningFromRead(read, cardN, words);
    await logReplyDecision(env, { mailId: mailId ?? "", what: "her reply to the prospect email", firstRead: meaning, keyword: templateKeywordMeaning(words) }).catch(() => undefined);
  } else meaning = await templateMeaningOf(env, words, mailId);
  if (meaning === "unsure") {
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: live.id, action: "asked", detail: { via: "reply", why: "her reply did not plainly approve or change it" } });
    return { outcome: "TEMPLATE_ANSWERED", note: `I could not tell whether that approves the prospect email, so nothing changed and nothing goes out. Reply "approved" to send it as it is, "try again" for a different draft, or tell me what to change.\n\nTap to approve: ${tapUrl(live.tap_token, "approve")}` };
  }
  if (meaning === "approve") {
    if (live.status !== "pending") return { outcome: "TEMPLATE_ANSWERED", note: "That prospect email is already approved; it goes out on the usual schedule." };
    await approveTemplate(env.DB, live.id, now);
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: live.id, action: "approved", detail: { via: "reply" } });
    return { outcome: "TEMPLATE_ANSWERED", note: `Approved. The prospect email goes out in the next sending window${released.count ? `, with one follow-up to the ${released.count} people who already got your first email` : ""}.` };
  }

  const tryAgain = meaning === "try_again";
  const notes = words.replace(/[,.;\s]*\b(?:try again|start over)\b[.!]?\s*$/i, "").trim();
  if (notes && GENERAL.test(notes)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO prospect_template_rules (key, rule, said, created_at) VALUES (?,?,?,?)`)
      .bind(`her_${now}`, notes.slice(0, 600), notes.slice(0, 600), now).run();
  }
  const r = await redraftTemplate(env.DB, live.id, { notes: notes || (tryAgain ? null : words), tryAgain }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "prospect_template", entityId: live.id, action: tryAgain ? "try_again" : "changed", detail: { via: "reply", ok: r.ok, applied: r.applied ?? [], kept: r.kept ?? [] } });
  if (!r.ok) {
    return { outcome: "TEMPLATE_ANSWERED", note: `I kept your note, but that change would break one of your rules for this email (${(r.problems ?? []).join("; ")}). The draft waiting for you is unchanged; reply with another wording, or "try again" for a different draft.` };
  }
  return { outcome: "TEMPLATE_ANSWERED", note: redraftReply(r.template, { applied: r.applied, kept: r.kept, released, headline: tryAgain ? "Here is a different draft, word for word. The old one is retired; nothing goes out until you tap Approve." : undefined }) };
}
