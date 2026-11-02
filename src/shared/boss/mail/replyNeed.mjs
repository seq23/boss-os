/**
 * ─── DOES THIS EMAIL NEED A REPLY? WHO DOES THE REPLY GO TO? (owner, 2 Nov 2026) ─────────────────
 *
 * Her words, for West Peek's TLC agent first: "Every email doesn't need a fucking reply". Then: "Make
 * sure this is the case for boss os - Simone too". One helper, read by every Boss OS path that drafts
 * or proposes a reply to someone outside (the LP replies on her Mac, Monique's outreach replies, the
 * answer Simone sends on an errand thread):
 *
 *   1. `replyNeed(words)` is the FIRST decision. A draft is made only when their message asks for
 *      something or invites something (a question, "send me…", "happy to chat", a time, a yes). A
 *      message that passes the note on, loops someone in, says they are reviewing or will get back,
 *      says thanks / got it, is an auto-reply, or is only for information gets NO draft: the thread
 *      waits on them. Their own words only (quoted history and links are not read).
 *   2. `replyAllRecipients(latest)` is who a draft goes to: everyone on the other side of their
 *      latest message (From, To and Cc, including people they newly copied), minus our own
 *      addresses. To = whoever wrote (their Reply-To when they set one); Cc = everyone else.
 *   3. `recipientLines(r)` is how her approval email shows it: "To: …" and, when anyone is copied,
 *      "Cc: …".
 *
 * Pure and deterministic: no model reads anything here (LP names never reach a model route).
 * Drafts never auto-send and one follow-up max still hold where each caller already enforces them.
 */
import { ownWords } from "../intake/messageBody.mjs";

/** Our own mail domains: never a recipient of a reply-all, never "the other side". */
export const OUR_MAIL_DOMAINS = Object.freeze([
  "westpeek.ventures", "joinwestpeek.com", "westpeek.live", "sequoiataylor.com", "spry.vc", "time-2-read.com",
]);

const AUTO_HEADERS = (h) => (h["auto-submitted"] && h["auto-submitted"] !== "no") || h["x-autoreply"] || h["x-autorespond"]
  || /^(auto|bulk|junk)$/i.test(h["precedence"] ?? "");
const AUTO = /\b(?:out of (?:the )?office|automatic reply|auto.?reply|autoresponder|currently out of|on (?:annual |parental |maternity |paternity )?leave|away from (?:my|the) (?:desk|office)|limited access to (?:my )?email|this mailbox is not monitored|i will be back (?:on|in)|i(?:'ll| will) (?:have limited|be out)|we have received your (?:email|message)|thank you for (?:your email|contacting)[^.]{0,60}(?:we will|we'll) (?:respond|get back))\b/i;

/** They passed it on or looped someone in. */
const PASS_ALONG = /\b(?:forward(?:ed|ing)?|pass(?:ed|ing)?|send(?:ing)?|sent|shar(?:ed|ing)|flagg(?:ed|ing)|refer(?:red|ring)?)\b[^.!?\n]{0,60}\b(?:along|on to|onto|over to|to (?:the|our|my|a) [\w -]{0,30}?(?:team|person|people|colleagues?|department|group|folks|partners?|desk)|with (?:the|our|my) [\w -]{0,30}?(?:team|colleagues?|partners?))\b|\b(?:loop(?:ed|ing)?|cc'?(?:ed|'d|ing)?|copied|copying|adding|added|introducing)\b[^!?\n]{0,80}?\b(?:in|here|to this|on this|who)\b|\(cc'?(?:ed|'d|d)?\)|\b(?:the right|best) (?:team|person|people|contact)\b|\bover to (?:you|him|her|them)\b|\btake (?:it|this) from here\b/i;
/** They are reviewing, or will come back to us. */
const REVIEWING = /\b(?:i(?:'m| am)|we(?:'re| are)|i(?:'ll| will)|we(?:'ll| will)|let me|let us|will)\s+(?:be\s+)?(?:review(?:ing)?|tak(?:e|ing) a look|look(?:ing)? (?:at|into|over|through)|go(?:ing)? (?:through|over)|discuss(?:ing)?(?: (?:it|this|internally|with))?|think(?:ing)? (?:about|it over)|consider(?:ing)?|digest(?:ing)?|run (?:it|this) by|check(?:ing)? (?:internally|with))\b|\b(?:get|come|circle) back to you\b|\b(?:be|get) in touch\b|\b(?:they|she|he|someone|the team)(?:'ll| will) (?:reach out|follow up|contact you|be in touch)\b|\bwill revert\b|\bunder review\b/i;
/** Thanks / got it, and nothing else. */
const THANKS = /^\W*(?:many |thanks?|thank you|thx|ty|cheers|got it|received|noted|perfect|great|sounds good|will do|appreciate (?:it|you)|much appreciated)\b/i;
/** Only for information. */
const FYI = /\b(?:fyi|for your (?:information|records|reference)|just so you know|no (?:action|reply|response) (?:needed|required)|no need to (?:reply|respond))\b/i;

/** A sentence spoken to the person they looped in, not to us ("Jane, can you take it from here?"). */
const TO_THEIR_COLLEAGUE = /\btake (?:it|this) from here\b|\bover to you\b|\b(?:can|could|would) you (?:help|assist|follow up|respond|reply|connect|handle|pick (?:this|it) up)\b/i;
/** A pleasantry that offers nothing new ("let me know if you need anything"). */
const PLEASANTRY = /\blet (?:me|us) know if (?:you (?:need|have)|there(?:'s| is)) (?:anything|any (?:questions?|thing))(?: (?:else|further))?\b|\bhope (?:you(?:'re| are)|this finds you) well\b|\bhow are you\b/i;

/** Something they asked us for. */
const ASKS = /\?|\b(?:please (?:send|share|forward|provide|let (?:me|us) know (?:when|what|which|if (?:you|the))|confirm)|send (?:me|us|over|through|the|your|it|them|a|more)|share (?:the|your|more|a)|could you|can you|would you|do you have|what (?:is|are|would|time)|when (?:is|are|works|would|can)|which (?:day|time)|let me know (?:when|what|which|your)|i(?:'d| would) (?:like|love) (?:to see|the|a copy|more)|we(?:'d| would) (?:like|love) (?:to see|the|a copy|more))\b/i;
/** Something they invited outright: a call, a meeting, a time. Answered even beside a hand-off. */
const INVITES = /\b(?:let'?s (?:talk|chat|connect|meet|set|find|schedule)|happy to (?:chat|connect|talk|speak|meet|hop on)|(?:would|'d) (?:love|be glad|be happy) to (?:chat|connect|talk|speak|meet)|open to (?:a )?(?:call|chat|conversation|meeting)|set up (?:a )?(?:call|time|meeting)|book a (?:call|time)|find (?:a )?time|jump on a call|(?:mon|tues|wednes|thurs|fri)day (?:at|works|is good|could work)|(?:can|could|would) work for (?:me|us)|works for (?:me|us)|i(?:'m| am) (?:free|available)|available (?:on|at|this|next)|\d{1,2}(?::\d{2})?\s*(?:am|pm)\b[^.!?\n]{0,30}\b(?:works|work|can work|is good|is fine))\b/i;
/** A yes or warmth: a reply on its own, but not beside a hand-off or "we'll review" (the thread waits on them). */
const WARM = /\b(?:interested|sounds (?:good|great|interesting)|count (?:us|me) in|sign (?:us|me) up|let'?s do it|happy to (?:review|take a look)|(?:would|'d) (?:love|be glad|be happy) to (?:learn|hear) more|keep (?:me|us) (?:posted|in the loop|updated)|stay in touch|keep in touch|yes)\b/i;

const sentences = (t) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/**
 * Does their message need a reply from us? `{ needed, kind, why }`.
 *   kind: "asks" | "invites" (needed) · "auto_reply" | "pass_along" | "reviewing" | "thanks" | "fyi" |
 *         "nothing_asked" (not needed: the thread waits on them).
 * `text` may carry the quoted history under it: only their own new words are read.
 */
export function replyNeed(text, { subject = "", headers = {} } = {}) {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v ?? "")]));
  if (AUTO_HEADERS(h)) return { needed: false, kind: "auto_reply", why: "an automatic reply" };
  const words = ownWords(String(text ?? "")).replace(/https?:\/\/\S+|www\.\S+|\S+\.(?:com|net|org|io|co)\/\S*/gi, " ");
  if (AUTO.test(`${subject}\n${words}`) && !/\?/.test(words)) return { needed: false, kind: "auto_reply", why: "an automatic reply" };
  const passAlong = PASS_ALONG.test(words);
  // What is left to read as a request to us: not a line to the person they looped in, not a pleasantry.
  const toUs = sentences(words).filter((s) => !(passAlong && TO_THEIR_COLLEAGUE.test(s))).map((s) => s.replace(PLEASANTRY, " ")).join("\n");
  if (ASKS.test(toUs)) return { needed: true, kind: "asks", why: "they asked for something" };
  if (INVITES.test(toUs)) return { needed: true, kind: "invites", why: "they invited something (a call or a time)" };
  const reviewing = REVIEWING.test(words);
  if (WARM.test(toUs) && !passAlong && !reviewing) return { needed: true, kind: "invites", why: "they said yes or asked to stay in touch" };
  if (passAlong) return { needed: false, kind: "pass_along", why: "they passed it on or looped someone in; the thread waits on them" };
  if (reviewing) return { needed: false, kind: "reviewing", why: "they are reviewing it or will get back; the thread waits on them" };
  if (FYI.test(words)) return { needed: false, kind: "fyi", why: "it was only for information" };
  if (THANKS.test(words)) return { needed: false, kind: "thanks", why: "a thank-you or a got-it" };
  return { needed: false, kind: "nothing_asked", why: "it asks for nothing and invites nothing" };
}

/** Every address in a header value, as `{ address, display }`, in order. */
export function addressesIn(value) {
  const out = [];
  const s = String(value ?? "");
  // Split on commas that are not inside a quoted display name.
  const parts = s.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const raw of parts) {
    const m = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(raw);
    if (!m) continue;
    out.push({ address: m[0].toLowerCase(), display: raw.trim().replace(/\s+/g, " ") });
  }
  return out;
}

/** One of ours: our domains (and their subdomains), or an extra address or domain the caller names. */
export function isOurs(address, extra = []) {
  const a = String(address ?? "").toLowerCase().trim();
  const domain = a.split("@")[1] ?? "";
  const list = [...OUR_MAIL_DOMAINS, ...(extra ?? []).map((x) => String(x).toLowerCase().trim()).filter(Boolean)];
  return list.some((d) => (d.includes("@") ? a === d : domain === d || domain.endsWith(`.${d}`)));
}

/**
 * Reply-all to their latest message, minus us. `latest` is that message's headers (From, To, Cc,
 * Reply-To; any case). Returns `{ to: string[], cc: string[] }` as "Name <address>" or bare address,
 * deduplicated by address. `to` is empty only when every address on it is ours.
 */
export function replyAllRecipients(latest, { ours = [] } = {}) {
  const h = Object.fromEntries(Object.entries(latest ?? {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  const seen = new Set();
  const take = (list) => list.filter((x) => !isOurs(x.address, ours) && !seen.has(x.address) && seen.add(x.address));
  const writer = addressesIn(h["reply-to"]).length ? addressesIn(h["reply-to"]) : addressesIn(h.from);
  const to = take(writer);
  const cc = take([...addressesIn(h.from), ...addressesIn(h.to), ...addressesIn(h.cc)]);
  if (!to.length && cc.length) to.push(cc.shift());
  return { to: to.map((x) => x.display), cc: cc.map((x) => x.display) };
}

/** The lines her approval email shows: "To: …" and, when anyone is copied, "Cc: …". */
export function recipientLines(r) {
  const to = (r?.to ?? []).filter(Boolean);
  const cc = (r?.cc ?? []).filter(Boolean);
  return [`To: ${to.length ? to.join(", ") : "(nobody: check the thread)"}`, ...(cc.length ? [`Cc: ${cc.join(", ")}`] : [])];
}
