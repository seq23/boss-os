/**
 * LPs, PROSPECTS, 8RAISE AND CATCH-UPS — THE PURE HALF (Boss fix L, 23 Oct 2026).
 *
 * Owner rulings 10, 11, 12 and 14 of the email + deals fix. Everything here is a pure function so
 * the Worker routes, the Mac scripts and the tests all use the same rule, and breaking one fails a
 * test (tests/boss/lpProspects.test.ts) and `npm run validate:lp-rules`.
 *
 * NO NAMES LIVE HERE. Templates carry placeholders; the names come from D1 at runtime.
 */
import { quotedSentence } from "../mail/plain.mjs";
import { isRoleMailbox } from "../people/role.mjs";

export const LP_MAILBOX = "sequoia@westpeek.ventures";
/**
 * How far back her inbox is read for buyers and sellers (owner, 23 Oct 2026: "a rough 6-month
 * cut-off"). Inbox-sourced prospects and catch-up reasons only; LP replies keep the full backfill.
 */
export const INBOX_LOOKBACK_DAYS = 183;
export const ORIGIN = "https://boss.sequoiataylor.com";
const DAY = 86_400_000;

/* ─── Rule 10: LP replies ────────────────────────────────────────────────────── */

/** The tracker words she sees, keyed by the stored status. */
export const LP_STATUS_LABEL = Object.freeze({
  drafted: "Drafted",
  sent: "Sent",
  scheduled: "Scheduled",
  skipped: "Skipped",
  not_answered: "Not answered yet",
  replied_again: "They replied again",
});

/** First name for the greeting, or "there". */
export function firstName(name) {
  const w = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(w) ? w : "there";
}

/**
 * Her outreach voice for an LP who answered warmly: "we", "more than $100M in secondary
 * transactions", never a fund size, a short call ask. A FIXED TEMPLATE — no model writes any part of
 * it, so an LP's name never reaches a route that might train on it.
 */
export function lpReplyBody({ name, bucket }) {
  const opener = bucket === "call"
    ? "Thank you for getting back to me. I'd love to find a time to talk."
    : "Thank you for the reply, and for being open to staying in touch.";
  return [
    `Hi ${firstName(name)},`,
    "",
    `${opener} We've done more than $100M in secondary transactions and are exploring what comes next with a small group of LPs.`,
    "",
    "Would you have 20 minutes in the next couple of weeks for a short call? Send me a couple of times that suit and we'll make it work.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/**
 * THE REPLY HELD FOR SOMEONE WHO WROTE BACK AGAIN (owner, Today v4, 31 Oct 2026: "every waiting reply
 * has a ready draft in that person's own Gmail thread, redrafted if they write again"). A fixed
 * template — no model, no name to a model — that she sends as is or changes in her own words.
 */
export function lpAgainBody({ name }) {
  return [
    `Hi ${firstName(name)},`,
    "",
    "Thank you for your patience, and for your note. I wanted to come back to you properly: would you have 20 minutes in the next week or so? Send me a couple of times that suit and we'll make it work.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/** A held reply that has sat this long goes to the top of Decide. */
export const LP_UNSENT_URGENT_DAYS = 2;
/** Days after her reply with no answer before ONE gentle nudge is drafted for her yes (26 Oct 2026). */
export const LP_NUDGE_DAYS = 7;

/** The nudge, a fixed template (no model, no names to a model). */
export function lpNudgeBody({ name }) {
  return [
    `Hi ${firstName(name)},`,
    "",
    "Just floating this back up in case it got buried. Happy to find 20 minutes whenever suits you.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/**
 * ONE GENTLE NUDGE, FOR HER YES (owner, 26 Oct 2026). Her reply went and nothing came back in
 * LP_NUDGE_DAYS: a Decide item with the nudge word for word and their thread. Once only: a row that
 * has been nudged (`nudged_at`) or that wrote back is never nudged again.
 */
export function lpNudgeItems(rows, now = Date.now()) {
  return (rows ?? [])
    // Shown for one week from day 7, then dropped: one nudge offered once, never a nag.
    .filter((r) => { const d = daysSince(r.sent_at, now) ?? 0; return r.status === "sent" && !r.nudged_at && d >= LP_NUDGE_DAYS && d < 2 * LP_NUDGE_DAYS; })
    .map((r) => ({
      key: `lpnudge:${r.id ?? r.address}`,
      title: `No answer in ${daysSince(r.sent_at, now)} days: nudge ${r.name || "an LP"}${r.firm ? ` at ${r.firm}` : ""}?`,
      body: `You replied on ${new Date(Number(r.sent_at)).toISOString().slice(0, 10)} and nothing has come back. One gentle nudge, only if you say yes.`,
      details: [`Their email: ${r.address}`, `Who: ${lpWho(r)}.`],
      draft: { heading: "The nudge, word for word", text: lpNudgeBody(r) },
      priority: 4,
      buttons: [
        ...(r.thread_id ? [{ label: "Open their thread to send it", url: gmailThreadUrl(r.thread_id, r.reply_from ?? LP_MAILBOX) }] : []),
      ],
    }));
}

export function tapUrl(token, action, origin = ORIGIN) {
  // A page path, never /api (the plain-email gate holds a link to an API path); bossMount.ts serves it.
  return `${origin}/tap/${encodeURIComponent(token)}?do=${action}`;
}

/** A real Gmail link into the West Peek mailbox — the draft itself, or the thread. Never a bare id. */
export function gmailDraftUrl(draftMessageId, mailbox = LP_MAILBOX) {
  return draftMessageId
    ? `https://mail.google.com/mail/u/${mailbox}/#drafts?compose=${encodeURIComponent(draftMessageId)}`
    : `https://mail.google.com/mail/u/${mailbox}/#drafts`;
}
export function gmailThreadUrl(threadId, mailbox = LP_MAILBOX) {
  return `https://mail.google.com/mail/u/${mailbox}/#all/${encodeURIComponent(threadId ?? "")}`;
}

const daysSince = (ms, now) => (ms ? Math.floor((now - ms) / DAY) : null);

const domainOf = (address) => String(address ?? "").split("@")[1] ?? "";
const trimEnd = (t) => String(t ?? "").trim().replace(/[\s.!?…]+$/, "");

/** Who an LP row is, in one plain phrase: "an LP you wrote to (Example Foundation, example.org)". */
export function lpWho(r) {
  const org = r.firm ? `${r.firm}, ${domainOf(r.address)}` : domainOf(r.address);
  return `an LP you wrote to in West Peek's fundraising outreach${org ? ` (${org})` : ""}`;
}

/**
 * Decide items for held LP replies, oldest-unsent first (owner, 24 Oct 2026: who they are, their
 * address, what they said, the history, and the reply WORD FOR WORD). "Send as is" is offered only
 * when the held draft's words are on the row (`draft_body`, pinned to `draft_message_id`): the tap
 * sends nothing the email did not show.
 */
export function lpDecideItems(rows, now = Date.now(), origin = ORIGIN) {
  const held = (rows ?? []).filter((r) => r.status === "drafted" && r.tap_token);
  const aged = held.map((r) => ({ r, days: daysSince(r.drafted_at, now) ?? 0 }))
    .sort((a, b) => b.days - a.days);
  const items = aged.map(({ r, days }) => {
    const said0 = r.said || r.quote;
    const said = trimEnd(said0);
    const showable = Boolean(r.draft_body && r.draft_message_id);
    return {
      key: `lp:${r.id ?? r.address}`,
      title: `${days >= LP_UNSENT_URGENT_DAYS ? "Waiting " + days + " days: " : ""}Reply to ${r.name || "an LP"}${r.firm ? ` at ${r.firm}` : ""}`,
      body: `${r.bucket === "call" ? "They want a call" : "They want to stay in touch"}. Who: ${lpWho(r)}.`,
      details: [
        `Their email: ${r.address}`,
        ...(said ? [`What they wrote: ${quotedSentence(said0)}`] : []),
        `History: they answered your outreach on ${r.first_seen}${r.subject ? ` ("${trimEnd(r.subject)}")` : ""}; you have not replied yet.`,
        `Your reply goes from ${r.reply_from ?? LP_MAILBOX}, in their thread.`,
      ],
      draft: showable ? { heading: "Your reply, word for word (Send as is sends exactly this)", text: r.draft_body } : null,
      urgent: days >= LP_UNSENT_URGENT_DAYS,
      // E's renderer ranks Decide by priority; ≥10 puts a reply unsent for two days at the top.
      priority: days >= LP_UNSENT_URGENT_DAYS ? 10 + days : 5,
      buttons: [
        ...(showable ? [{ label: "Send as is", url: tapUrl(r.tap_token, "send", origin) }] : []),
        { label: showable ? "Edit in Gmail, then send" : "Open the draft in Gmail (you changed it there)", url: gmailDraftUrl(r.draft_message_id, r.reply_from ?? LP_MAILBOX) },
        ...(r.thread_id ? [{ label: "Open their email", url: gmailThreadUrl(r.thread_id, r.reply_from ?? LP_MAILBOX) }] : []),
        { label: "Skip", url: tapUrl(r.tap_token, "skip", origin) },
      ],
    };
  });
  // Someone who wrote back after her reply: answering is hers (it goes in her name), so it is a
  // decision with their words and the thread, never a "done" line.
  for (const r of (rows ?? []).filter((x) => x.status === "replied_again")) {
    const said0 = r.last_reply_text || r.said || r.quote;
    const said = trimEnd(said0);
    // A reply to their new message held in the thread (Today v4): shown word for word, one tap sends it.
    const ready = Boolean(r.draft_body && r.draft_message_id && r.tap_token);
    /*
     * IT STAYS IN DECIDE EVERY DAY UNTIL SHE ANSWERS, AND GETS LOUDER (owner, 25 Oct 2026): "Waiting
     * N days:" counts from their last message, and the card carries NO Skip or Dismiss — answering
     * is the only way it leaves.
     */
    const waited = daysSince(r.last_reply_at ?? r.updated_at, now) ?? 0;
    items.push({
      key: `lp-again:${r.id ?? r.address}`,
      title: `${waited >= 1 ? `Waiting ${waited} day${waited === 1 ? "" : "s"}: ` : ""}Answer ${r.name || "an LP"}${r.firm ? ` at ${r.firm}` : ""}: they wrote back after your reply`,
      noDismiss: true,
      body: `Who: ${lpWho(r)}.`,
      details: [
        `Their email: ${r.address}`,
        ...(said ? [`What they wrote: ${quotedSentence(said0)}`] : []),
        `History: they answered your outreach on ${r.first_seen}; you replied${r.sent_at ? ` on ${new Date(Number(r.sent_at)).toISOString().slice(0, 10)}` : ""}; they wrote again${r.last_reply_at ? ` on ${new Date(Number(r.last_reply_at)).toISOString().slice(0, 10)}` : ""}.`,
        ready ? `Your reply goes from ${r.reply_from ?? LP_MAILBOX}, in their thread.` : "No reply is drafted for this one yet: it needs your own words.",
      ],
      draft: ready ? { heading: "Your reply, word for word (Send as is sends exactly this)", text: r.draft_body } : null,
      priority: 4 + Math.min(waited, 60),
      buttons: [
        ...(ready ? [{ label: "Send as is", url: tapUrl(r.tap_token, "send", origin) }, { label: "Change it", url: `${origin}/?tab=today` }] : []),
        { label: ready ? "Open their email" : "Open the thread and reply", url: gmailThreadUrl(r.thread_id, r.reply_from ?? LP_MAILBOX) },
      ],
    });
  }
  return items;
}

/** The status a row should carry given what the mailbox shows. Pure, so the order is pinned. */
export function lpStatusFrom({ current, sentAfterReply, scheduled, theirLatest, sentAt, hasDraft, decision }) {
  if (sentAfterReply) {
    return theirLatest && sentAt && theirLatest > sentAt ? "replied_again" : "sent";
  }
  if (scheduled) return "scheduled";
  if (decision === "skip" || current === "skipped") return "skipped";
  if (hasDraft) return "drafted";
  return "not_answered";
}

/* ─── Rule 11: prospects ─────────────────────────────────────────────────────── */

// Owner, 24 Oct 2026: ONE follow-up at most — the first email and one more, never a third.
export const MAX_TOUCHES = 2;              // the first email and ONE follow-up, then the sequence is complete
export const TOUCH_DAYS = Object.freeze([0, 5]); // days after the first send
export const MAX_NEW_PER_DAY = 20;
export const MIN_TOUCH_GAP_DAYS = 5;
export const FEATURED_MIN = 3;
export const FEATURED_MAX = 5;
export const FEATURE_FRESH_DAYS = 30;
export const FEATURE_STALE_DAYS = 45;
export const PROSPECT_KINDS = Object.freeze([
  "family_office", "sovereign_wealth", "fund_of_funds", "pension_endowment_foundation",
  "secondary_fund", "crossover_growth", "spv_manager", "inbox_buyer", "other",
]);

/**
 * Her tone rules (23 Oct 2026): "i dont want to say 'do u want to buy secondary' i like to be more
 * soft in my approach and request to chat because I have some names im working on".
 */
export const PROSPECT_BANNED = Object.freeze([
  /\bdo (you|u) want to buy\b/i,
  /\bare you (a )?buyers?\b/i,
  /\binterested in buying\b/i,
  /\bwant to buy\b/i,
  /\bblocks? on offer\b/i,
  /\$\s?\d[\d,.]*\s?(m|mm|b|bn|million|billion)?\s*(per share|\/share)/i,
  /\bper share\b/i,
  /\bfund (size|of \$)/i,
  /\$\d[\d,.]*\s?(m|mm|b|bn|million|billion)\s+fund\b/i,
  /\bLP interest of\b/i,
  /\bup to \$1b\b/i,
  // Side-neutral (23 Oct 2026: "some times can be sellers"): never call them a buyer or assume a side.
  /\bbuyers?\b/i,
  /\bbuy[- ]side\b/i,
  /\blooking to (buy|acquire)\b/i,
  /\byour (purchase|buying)\b/i,
]);
/** The ask must invite either direction. */
export const EITHER_SIDE = /\badd or trim\b|\beither side\b|\bbuying or selling\b/i;
export const CHAT_ASK = /\b(15|20) minutes\b.*\b(compare notes|chat|catch up)\b|\b(compare notes|quick chat)\b/i;
export const PROSPECT_WORD_CAP = 90;
export const OPT_OUT_LINE = "If this isn't relevant, just reply \"no thanks\" and I won't write again.";
export const SIGNATURE = "Sequoia Taylor\nWest Peek Ventures";

/**
 * NEVER ANTHROPIC BY NAME (owner, 24 Oct 2026): a prospect email alludes to it instead. Every other
 * name is said as it is (OpenAI stays named). `NEVER_NAMED` is the list; `allude` is the words used;
 * `renderProspect` also sweeps the finished subject and body, so an edited template cannot say it.
 */
export const NEVER_NAMED = Object.freeze([{ re: /\banthropic(?:'s|’s)?\b(?:\s*(?:PBC|Inc\.?))?/gi, allude: "a leading frontier AI lab" }]);
const neverNamed = (n) => NEVER_NAMED.find((x) => { x.re.lastIndex = 0; return x.re.test(String(n)); });
export const sayName = (n) => neverNamed(n)?.allude ?? n;
export function withoutNeverNamed(text) {
  let t = String(text ?? "");
  for (const x of NEVER_NAMED) t = t.replace(x.re, x.allude);
  return t;
}

/**
 * ─── THE FEATURED NAMES ARE EXAMPLES OF A WIDER BOOK (owner, 25 Oct 2026) ───
 *
 * "I don't like that you make it seem like those are the only 3 companies I'm working on." Every
 * names line reads as examples — "Some of the names crossing my desk right now include OpenAI,
 * Anduril and Databricks, among others" — never as the full list; the subject never lists them as
 * if they were everything, and a cold email never starts "Re:" (a fake reply). A standing rule for
 * every future template: `featuredNamesProblems` enforces both, `prospectProblems` refuses a draft
 * that breaks them, and `PROSPECT_TEMPLATE_RULES` is the record of her words.
 */
export const EXAMPLES_QUALIFIER = /\b(?:among (?:many )?others|including|such as|and (?:many )?others|and more)\b/i;
export const FAKE_REPLY_SUBJECT = /^\s*(?:re|fwd?|fw)\s*:/i;
export const PROSPECT_TEMPLATE_RULES = Object.freeze([
  { key: "names_are_examples", said: "I don't like that you make it seem like those are the only 3 companies I'm working on.", rule: "Featured names read as examples of a wider book (\"including …, among others\"), never as the full list; the subject does not list them as everything." },
  { key: "no_fake_reply_subject", said: "Drop the \"Re:\" prefix: a fake reply on a cold email.", rule: "A cold subject never starts with Re: or Fwd:." },
]);

/** What breaks the two standing rules in a rendered email. Pure; part of `prospectProblems`. */
export function featuredNamesProblems({ subject, body }, names = []) {
  const out = [];
  if (FAKE_REPLY_SUBJECT.test(String(subject ?? ""))) out.push('the subject starts with "Re:" or "Fwd:" (a fake reply on a cold email)');
  const list = (names ?? []).map((n) => (typeof n === "string" ? n : n?.name)).filter(Boolean).map((n) => String(sayName(n)).toLowerCase());
  if (list.length >= 2) {
    for (const sentence of String(body ?? "").split(/(?<=[.!?])\s+|\n+/)) {
      const hits = list.filter((n) => sentence.toLowerCase().includes(n)).length;
      if (hits >= 2 && !EXAMPLES_QUALIFIER.test(sentence)) out.push(`lists the featured names as if they were all of them ("${sentence.trim().slice(0, 80)}")`);
    }
    const subjHits = list.filter((n) => String(subject ?? "").toLowerCase().includes(n)).length;
    if (subjHits >= list.length && list.length >= 2 && !EXAMPLES_QUALIFIER.test(String(subject ?? ""))) out.push("the subject lists every featured name as if that were everything");
  }
  return out;
}

/** The names line, always as examples. Her phrasing is primary; others rotate in lightly. */
export function namesLine(names, variant = 0) {
  const list = (names ?? []).map((n) => (typeof n === "string" ? n : n.name)).filter(Boolean).map(sayName);
  const join = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (list.length === 0) return "";
  return variant % 3 === 2
    ? `We've been working on a range of names, including ${join(list.slice(0, 2))}.`
    : variant % 3 === 1
      ? `A few of the names on my desk right now include ${join(list)}, among many others.`
      : `Some of the names crossing my desk right now include ${join(list)}, among others.`;
}

/**
 * The templates Monique drafts from. A is the default; "try again" moves to the next one, so a new
 * draft has a genuinely different opening and structure, never a reworded copy. Every one passes
 * `prospectProblems` (tests/prospectTemplateReplies.test.ts renders each).
 */
export const PROSPECT_VARIANTS = Object.freeze([
  Object.freeze({
    subject: "Late-stage secondaries: {subject_names} and others",
    body: [
      "Hi {first},",
      "",
      "I hope you don't mind the direct note. We've done more than $100M in secondary transactions, and I've been wanting to meet more people who think about late-stage private companies the way you do.",
      "",
      "{names_line} Would love to find 15 minutes to compare notes, and I'm happy to talk about what you're looking to add or trim.",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
    follow_up: [
      "Hi {first},",
      "",
      "Just floating this back up. {names_line} We've done more than $100M in secondary transactions, and I'd love to find 15 minutes to compare notes on what you're looking to add or trim.",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
  }),
  Object.freeze({
    subject: "Comparing notes on late-stage names",
    body: [
      "Hi {first},",
      "",
      "Would you be open to 15 minutes to compare notes on late-stage private companies? {names_line}",
      "",
      "We've done more than $100M in secondary transactions, so if you're thinking about what to add or trim, we may be able to help.",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
    follow_up: [
      "Hi {first},",
      "",
      "A quick nudge on this. We've done more than $100M in secondary transactions, and I'd value 15 minutes to compare notes on what you're looking to add or trim. {names_line}",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
  }),
  Object.freeze({
    subject: "A short hello from West Peek",
    body: [
      "Hi {first},",
      "",
      "{names_line} That's part of a wider book we work across; we've done more than $100M in secondary transactions.",
      "",
      "If you're weighing what to add or trim, could we find 15 minutes to compare notes?",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
    follow_up: [
      "Hi {first},",
      "",
      "Circling back once. If it's useful, I'd be glad to find 15 minutes to compare notes on what you're looking to add or trim. We've done more than $100M in secondary transactions. {names_line}",
      "",
      SIGNATURE,
      "",
      OPT_OUT_LINE,
    ].join("\n"),
  }),
]);
/** The default template: variant A. */
export const DEFAULT_PROSPECT_TEMPLATE = PROSPECT_VARIANTS[0];

/**
 * WHAT HER WORDS SAY PLAINLY, APPLIED (owner, 25 Oct 2026). Two shapes are read and applied to the
 * subject, the email and the follow-up: "say 'X' not 'Y'" (also "instead of", "rather than") and
 * "drop / remove / cut the … line" (the sentence that carries those words). Anything else is kept
 * on the row as her note, and the reply says so; nothing is guessed. Pure.
 */
export function applyTemplateNotes(template, note) {
  const t = { subject: String(template.subject), body: String(template.body), follow_up: String(template.follow_up) };
  const applied = [];
  const kept = [];
  const Q = `['"‘’“”]`;
  const clauses = String(note ?? "").split(/\s*(?:;|,\s*(?=(?:and\s+)?(?:say|drop|remove|cut|delete)\b)|\band\s+(?=(?:say|drop|remove|cut|delete)\b)|\n)\s*/i).map((c) => c.trim()).filter(Boolean);
  for (const c of clauses) {
    const swap = new RegExp(`^(?:please\\s+)?(?:say|use|write)\\s+${Q}(.+?)${Q}\\s+(?:not|instead of|rather than)\\s+${Q}(.+?)${Q}`, "i").exec(c);
    if (swap) {
      const [, want, was] = swap;
      const re = new RegExp(was.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const hit = ["subject", "body", "follow_up"].filter((k) => re.test(t[k]));
      for (const k of ["subject", "body", "follow_up"]) t[k] = t[k].replace(re, want);
      (hit.length ? applied : kept).push(hit.length ? `said "${want}" instead of "${was}"` : swap[0]);
      const rest = c.slice(swap[0].length).replace(/^[\s,.;]*(?:and\s+)?/i, "").trim();
      if (rest) kept.push(rest);
      continue;
    }
    const drop = /^(?:please\s+)?(?:drop|remove|cut|delete)\s+(?:the\s+)?(.+?)\s+(?:line|sentence|bit|part)\b/i.exec(c);
    if (drop) {
      const words = drop[1].toLowerCase().split(/[\s-]+/).filter((w) => w.length > 2 && !["the", "and", "that", "this"].includes(w));
      let done = false;
      for (const k of ["body", "follow_up"]) {
        // Paragraph by paragraph, so the greeting, signature and opt-out keep their places.
        t[k] = t[k].split("\n\n").map((para) => {
          if (/^Hi \{first\},$|Sequoia Taylor|no thanks/.test(para)) return para;
          return para.split(/(?<=[.!?])\s+/).filter((sentence) => {
            const low = sentence.toLowerCase();
            const hit = words.length > 0 && words.every((w) => low.includes(w.replace(/s$/, "")));
            if (hit) done = true;
            return !hit;
          }).join(" ");
        }).filter((para) => para.trim()).join("\n\n");
      }
      (done ? applied : kept).push(done ? `dropped the ${drop[1]} line` : drop[0]);
      const rest = c.slice(drop[0].length).replace(/^[\s,.;]*(?:and\s+)?/i, "").trim();
      if (rest) kept.push(rest);
      continue;
    }
    kept.push(c);
  }
  return { template: t, applied, kept };
}

/** Subject line names: the first two approved names, said as examples ("… and others" in the template). */
export function subjectNames(names) {
  // A never-named company is left out of the subject (its allusion is in the body's names line).
  const list = (names ?? []).map((n) => (typeof n === "string" ? n : n.name)).filter((n) => n && !neverNamed(n)).slice(0, 2);
  return list.join(", ");
}

export function renderProspect(template, { first, names, touch = 1, variant = 0 }) {
  const fill = (s) => s
    .replaceAll("{first}", firstName(first))
    .replaceAll("{names_line}", namesLine(names, variant))
    .replaceAll("{subject_names}", subjectNames(names));
  const subject = withoutNeverNamed(fill(template.subject)).replace(/:\s*$/, "");
  const body = withoutNeverNamed(fill(touch === 1 ? template.body : template.follow_up)).replace(/\n{3,}/g, "\n\n");
  return { subject, body };
}

/** Words she reads before the signature (the opt-out line and signature do not count). */
export function wordCount(body) {
  const main = String(body).split(SIGNATURE)[0];
  return main.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

/**
 * Everything wrong with a rendered prospect email. Empty = it may be shown to her for approval.
 * Pinned by tests: banned sales phrases, the chat ask, the $100M line, "we", the word cap, the opt-out.
 */
export function prospectProblems({ subject, body }, names = null) {
  const out = [];
  const text = `${subject}\n${body}`;
  for (const re of PROSPECT_BANNED) if (re.test(body)) out.push(`uses a sales phrase (${re.source})`);
  if (!CHAT_ASK.test(body)) out.push("has no soft chat ask");
  if (!EITHER_SIDE.test(body)) out.push("does not invite either side (add or trim)");
  if (!/more than \$100M in secondary transactions/.test(body)) out.push('is missing "more than $100M in secondary transactions"');
  if (!/\b[Ww]e('ve|'re| have| are)?\b/.test(body)) out.push('does not speak as "we"');
  if (wordCount(body) > PROSPECT_WORD_CAP) out.push(`is ${wordCount(body)} words (cap ${PROSPECT_WORD_CAP})`);
  if (!body.includes(OPT_OUT_LINE)) out.push("has no opt-out line");
  if (/\{[a-z_]+\}/.test(text)) out.push("has an unfilled placeholder");
  out.push(...featuredNamesProblems({ subject, body }, names));
  return out;
}

/** A stable short hash of the template and its names; a change is a new template that re-asks. */
export function templateHash(template, names) {
  const s = JSON.stringify([template.subject, template.body, template.follow_up, (names ?? []).map((n) => (typeof n === "string" ? n : n.name))]);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Which touch is due for a prospect today, if any. 1 = the first email (subject to the daily cap),
 * 2 ≈ day 5 (the one follow-up), then the sequence is complete. Replies, opt-outs and bounces end it.
 */
/**
 * When a prospect's next email is due (ms), by the same rule `dueTouch` sends on: touch 1 as soon as
 * the email is approved (`null`), then TOUCH_DAYS after the first, never under MIN_TOUCH_GAP_DAYS
 * after the last. `null` also when the sequence is over.
 */
export function nextTouchAt(p) {
  const touches = Number(p?.touches ?? 0);
  if (!p || touches >= MAX_TOUCHES || touches === 0 || !p.first_sent_at) return null;
  const byFirst = Number(p.first_sent_at) + TOUCH_DAYS[touches] * DAY;
  const byLast = Number(p.last_touch_at ?? p.first_sent_at) + MIN_TOUCH_GAP_DAYS * DAY;
  return Math.max(byFirst, byLast);
}

export function dueTouch(p, now = Date.now()) {
  if (!p || !["new", "active"].includes(p.status)) return null;
  const touches = Number(p.touches ?? 0);
  if (touches >= MAX_TOUCHES) return null;
  if (touches === 0) return 1;
  if (!p.first_sent_at) return null;
  const days = (now - Number(p.first_sent_at)) / DAY;
  const next = touches + 1;
  // Each touch is at least five days after the one before it.
  const sinceLast = p.last_touch_at ? (now - Number(p.last_touch_at)) / DAY : days;
  return days >= TOUCH_DAYS[next - 1] && sinceLast >= MIN_TOUCH_GAP_DAYS ? next : null;
}

/**
 * The featured names Monique proposes: her supply ("Yours" rows) ranked by buyer demand seen in her
 * inbox, then freshness (≤30 days), then size, then how well known. Never-feature names are out.
 */
export function proposeFeatured(supply, { never = [], add = [], drop = [] } = {}, now = Date.now()) {
  const banned = new Set([...never, ...drop].map((n) => String(n).toLowerCase()));
  const byName = new Map();
  for (const r of supply ?? []) {
    const name = String(r.company ?? r.name ?? "").trim();
    if (!name || banned.has(name.toLowerCase())) continue;
    const age = r.seen_at ? (now - Number(r.seen_at)) / DAY : 999;
    const prev = byName.get(name.toLowerCase());
    const row = {
      name,
      demand: Number(r.demand ?? 0) + (prev?.demand ?? 0),
      fresh: Math.min(age, prev?.fresh ?? 999),
      size: Math.max(Number(r.size_usd ?? 0), prev?.size ?? 0),
      known: Number(r.known ?? 0),
    };
    byName.set(name.toLowerCase(), row);
  }
  for (const a of add) if (!banned.has(String(a).toLowerCase()) && !byName.has(String(a).toLowerCase())) byName.set(String(a).toLowerCase(), { name: String(a), demand: 0, fresh: 0, size: 0, known: 1, asked: true });
  const rows = [...byName.values()].filter((r) => r.asked || r.fresh <= FEATURE_FRESH_DAYS);
  rows.sort((a, b) => Number(!!b.asked) - Number(!!a.asked) || b.demand - a.demand || a.fresh - b.fresh || b.size - a.size || b.known - a.known);
  return rows.slice(0, FEATURED_MAX).map((r) => ({
    name: r.name,
    why: r.asked ? "you asked for it" : [
      r.demand ? `${r.demand} buyer ask${r.demand === 1 ? "" : "s"} in your inbox` : null,
      r.fresh < 999 ? `on your list ${Math.round(r.fresh)} day${Math.round(r.fresh) === 1 ? "" : "s"} ago` : null,
      r.size ? `${fmtUsd(r.size)} available` : null,
    ].filter(Boolean).join(", ") || "on your current list",
  }));
}

/** Featured names whose supply row is gone or older than ~45 days: each becomes a swap proposal. */
export function staleFeatured(featured, supply, now = Date.now()) {
  const fresh = new Map();
  for (const r of supply ?? []) {
    const k = String(r.company ?? r.name ?? "").toLowerCase();
    const age = r.seen_at ? (now - Number(r.seen_at)) / DAY : 999;
    fresh.set(k, Math.min(age, fresh.get(k) ?? 999));
  }
  return (featured ?? []).filter((f) => {
    const age = fresh.get(String(f.name).toLowerCase());
    return age === undefined || age > FEATURE_STALE_DAYS;
  }).map((f) => f.name);
}

/** Which side a prospect's reply puts them on: Buyer / Seller / Both / Unknown. */
export function sideFromReply(text) {
  const t = String(text ?? "");
  const sell = /\b(sell(ing)?|trim(ming)?|liquidity|offload|exit (some|part)|have (some )?(shares|stock|a position))\b/i.test(t);
  const buy = /\b(buy(ing)?|add(ing)? to|looking for (exposure|allocation)|acquire|interested in (adding|getting into))\b/i.test(t);
  return sell && buy ? "both" : sell ? "seller" : buy ? "buyer" : "unknown";
}

/** Her plain-words edits to the names list: "add X", "drop Y", "never feature Z". */
/**
 * Her plain-words edits to the featured names. EVERY name in a list counts (24 Oct 2026: "add OpenAI,
 * Anduril, Databricks" applied only OpenAI — and her own email tells her to reply that way): names
 * are split on commas, "and" and "&" after one verb, and a name keeps up to four capitalised words.
 */
const NAME = "[A-Z0-9][\\w&.'’-]*(?:\\s+[A-Z0-9][\\w&.'’-]*){0,3}";
const NAME_LIST_RE = new RegExp(`\\b(never feature|add|drop)\\s+(${NAME}(?:\\s*(?:,\\s*(?:and\\s+|&\\s*)?|\\s+(?:and|&)\\s+)${NAME})*)`, "g");
export function nameRulesIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(NAME_LIST_RE)) {
    const rule = m[1] === "never feature" ? "never" : m[1];
    for (const raw of m[2].split(/\s*,\s*(?:and\s+|&\s*)?|\s+(?:and|&)\s+/)) {
      // A sentence ends a name ("add Gamma Co. Then drop …" is Gamma Co).
      const name = raw.split(/[.!?]\s+/)[0].trim().replace(/[.,;:!?]+$/, "");
      if (name && !out.some((r) => r.rule === rule && r.name.toLowerCase() === name.toLowerCase())) out.push({ rule, name });
    }
  }
  return out;
}

export function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

/** Blur a person for anything that might leave her screen (tests, previews): "A. P." + domain. */
export function blur(name, email) {
  const initials = String(name ?? "").split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(" ");
  const dom = String(email ?? "").split("@")[1] ?? "";
  return `${initials || "—"}${dom ? ` (${dom.replace(/^[^.]+/, (s) => s[0] + "•••")})` : ""}`;
}

/* ─── Rule 12: the 8Raise budget ─────────────────────────────────────────────── */

export const EIGHTRAISE_BUDGET = Object.freeze({
  plan: 165,
  prospecting: 60,
  buyers_for_supply: 15,
  floor: 30,
  per_search_contacts: 5,
});
export const MONIQUE_MONTHLY = EIGHTRAISE_BUDGET.prospecting + EIGHTRAISE_BUDGET.buyers_for_supply;

/** Calendar month in America/Chicago, YYYY-MM. */
export function monthOf(ms = Date.now()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(new Date(ms));
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
}

/**
 * May this 8Raise call go ahead? Every refusal names its reason. Never buys; never upgrades — there
 * is no purpose that could.
 */
export function canSpend({ purpose, credits, contacts = 0, company = null, ledger = [], balance = null, month = monthOf() }) {
  if (!["prospecting", "buyers_for_supply"].includes(purpose)) return { ok: false, why: `unknown purpose ${purpose}` };
  if (!(credits > 0)) return { ok: false, why: "a spend must state its credits up front" };
  if (contacts > EIGHTRAISE_BUDGET.per_search_contacts) return { ok: false, why: `asks for ${contacts} contacts; the cap is ${EIGHTRAISE_BUDGET.per_search_contacts} per search` };
  const thisMonth = ledger.filter((l) => l.month === month && l.purpose !== "balance_read");
  const spent = thisMonth.filter((l) => l.purpose === purpose).reduce((a, l) => a + Number(l.credits), 0);
  if (spent + credits > EIGHTRAISE_BUDGET[purpose]) return { ok: false, why: `${purpose} has ${EIGHTRAISE_BUDGET[purpose] - spent} of ${EIGHTRAISE_BUDGET[purpose]} left this month` };
  if (company && thisMonth.some((l) => l.company && l.company.toLowerCase() === String(company).toLowerCase())) {
    return { ok: false, why: `${company} was already searched this month` };
  }
  if (balance === null || balance === undefined) return { ok: false, why: "the account balance could not be read, so the floor cannot be checked" };
  if (balance - credits < EIGHTRAISE_BUDGET.floor) return { ok: false, why: `the balance would fall below ${EIGHTRAISE_BUDGET.floor}` };
  return { ok: true, why: null };
}

export function monthSpent(ledger, month = monthOf()) {
  return ledger.filter((l) => l.month === month && l.purpose !== "balance_read").reduce((a, l) => a + Number(l.credits), 0);
}

/** The morning email footer line (rule 1). */
export function eightRaiseFooter(used) {
  const n = Math.round(Number(used) * 100) / 100;
  return `8Raise: Monique used ${n} of her ${MONIQUE_MONTHLY} credits this month (${EIGHTRAISE_BUDGET.floor} always kept for you)`;
}

/* ─── Rule 14: catch-ups (opportunistic, never a tracker) ────────────────────── */

export const CATCHUP_MAX_PER_DAY = 3;
export const CATCHUP_MAX_EVER = 2;
export const CATCHUP_REASON_TYPES = Object.freeze(["holds_or_wants", "past_partner_moving", "unfilled_ask_matched"]);

/** Is this person on her do-not-suggest list or at her own firm? Matches address, domain or name. */
export function excluded(person, { doNotSuggest = [], rainmaker = [] } = {}) {
  const email = String(person.email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const name = String(person.name ?? "").toLowerCase();
  const hit = (list) => list.some((e) => {
    const v = String(e.value ?? e).toLowerCase().trim();
    if (!v) return false;
    if (v.includes("@")) return v === email;
    if (v.includes(".")) return v === domain;
    return name && name.includes(v);
  });
  if (hit(doNotSuggest)) return "do_not_suggest";
  if (hit(rainmaker)) return "rainmaker";
  return null;
}

/**
 * 0–3 people, each with a live reason. Nobody twice in a week; nobody more than twice ever unless
 * they wrote to her again after the last suggestion (that resets the count); reason types rotate.
 */
export function pickCatchups(candidates, history, lists, now = Date.now()) {
  const byPerson = new Map();
  for (const h of history ?? []) {
    const k = String(h.person_key).toLowerCase();
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(h);
  }
  const lastTypes = [...(history ?? [])].sort((a, b) => b.suggested_at - a.suggested_at).slice(0, 3).map((h) => h.reason_type);
  const ok = [];
  for (const c of candidates ?? []) {
    if (!c.reason || !CATCHUP_REASON_TYPES.includes(c.reason_type)) continue;
    if (c.reason_at && now - Number(c.reason_at) > INBOX_LOOKBACK_DAYS * DAY) continue;
    if (excluded(c, lists)) continue;
    if (isRoleMailbox(c.email, c.name)) continue; // a team mailbox is never someone to catch up with
    const k = String(c.email).toLowerCase();
    const past = (byPerson.get(k) ?? []).filter((h) => !c.last_wrote_at || h.suggested_at > c.last_wrote_at);
    if (past.length >= CATCHUP_MAX_EVER) continue;
    if (past.some((h) => now - h.suggested_at < 7 * DAY)) continue;
    ok.push(c);
  }
  ok.sort((a, b) => Number(lastTypes.includes(a.reason_type)) - Number(lastTypes.includes(b.reason_type)) || (b.score ?? 0) - (a.score ?? 0));
  const out = [];
  const typesUsed = new Set();
  for (const c of ok) {
    if (out.length >= CATCHUP_MAX_PER_DAY) break;
    if (typesUsed.has(c.reason_type) && ok.some((o) => !typesUsed.has(o.reason_type) && !out.includes(o))) continue;
    out.push(c);
    typesUsed.add(c.reason_type);
  }
  return out;
}

export function catchupNote({ name, reason }) {
  return [`Hi ${firstName(name)},`, "", `It's been a while. ${reason} Would love to catch up for 15 minutes if you have time in the next couple of weeks.`, "", "Best,", "Sequoia"].join("\n");
}

/* ─── Her NeverBounce, before every touch, and what Approve will do (24 Oct 2026) ───────────
 *
 * The bounce brake paused every prospect email, so the email waiting for her Approve would have sent
 * nothing and she could not see it (Rule 0). Now each touch needs a NeverBounce verdict on record
 * (`prospects.nb_result`, checked by the Mac within a per-run credit cap). Brake off: valid,
 * catch-all and unknown go. Brake on: only valid goes; the rest wait until the rate recovers.
 * Invalid / disposable never go (the address is suppressed when the verdict is posted).
 */
export const NB_FRESH_DAYS = 90;

/** "go" | "invalid" | "risky" | "unverified" for one prospect row. Pure. */
export function verdictGate(p, { paused = false, now = Date.now() } = {}) {
  const r = String(p?.nb_result ?? "").toLowerCase();
  const fresh = r && Number(p?.nb_checked_at) > 0 && now - Number(p.nb_checked_at) < NB_FRESH_DAYS * DAY;
  if (!fresh) return "unverified";
  if (r === "invalid" || r === "disposable") return "invalid";
  if (r === "valid") return "go";
  if (r === "catchall" || r === "unknown") return paused ? "risky" : "go";
  return "unverified";
}

const plural2 = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What tapping Approve does, in her words, from the plan's `forecast`
 * ({ go, first, follow, invalid, risky, unverified, bounced, paused, blocked }). Never an Approve
 * that silently does nothing: when nothing would go, the first line says so and why. Pure.
 */
export function approveOutcome(f) {
  if (!f) return { headline: "Approve → Monique checks every address with NeverBounce, then sends on the next weekday, 9 to 5 Central.", lines: [] };
  const lines = [];
  const what = f.first && f.follow ? `the first email (${f.first}) and the follow-up (${f.follow})` : f.first ? "the first email" : "the follow-up";
  let headline;
  if ((f.blocked ?? []).length) headline = `Approve → nothing goes yet: ${f.blocked[0]}`;
  else if (f.go > 0) headline = `Approve → ${what} goes to the ${plural2(f.go, "address", "addresses")} NeverBounce confirmed, on the next weekday, 9 to 5 Central.`;
  else if (f.paused && f.risky) headline = "Approve → nothing goes yet: the bounce brake is on and none of the waiting addresses is confirmed valid.";
  else if (f.unverified) headline = "Approve → nothing goes yet: NeverBounce checks the waiting addresses on Monique's next run, then the confirmed ones go.";
  else headline = "Approve → nothing goes yet: no one is due an email today.";
  if (f.invalid) lines.push(`${plural2(f.invalid, "address", "addresses")} skipped: NeverBounce says ${f.invalid === 1 ? "it does not exist, so it is" : "they do not exist, so they are"} off the list.`);
  if (f.risky) lines.push(`${plural2(f.risky, "address", "addresses")} held: NeverBounce could not confirm ${f.risky === 1 ? "it (catch-all or unknown); it waits" : "them (catch-all or unknown); they wait"} until the bounce rate is back under 3%.`);
  if (f.unverified) lines.push(`${plural2(f.unverified, "address", "addresses")} not checked yet: NeverBounce checks ${f.unverified === 1 ? "it" : "them"} on Monique's next run, before anything goes.`);
  if (f.bounced) lines.push(`${plural2(f.bounced, "address", "addresses")} already bounced: never written to again.`);
  if (f.follow) lines.push("This is the one follow-up: after it, the sequence is complete for them and they get no more emails.");
  if (f.paused) lines.push(`Why only confirmed addresses: ${String(f.paused).replace(/^Paused automatically:\s*/i, "")}`);
  return { headline, lines };
}
