/**
 * WHAT A REPLY MEANS. Deterministic rules, no model: a reply decides whether an address is
 * suppressed for ever, so the rule must be the same every time and readable in a test.
 *
 * Precedence is the safety order: anything that could be a complaint or an unsubscribe is treated as
 * one before anything else is considered. "Not interested" must never read as "interested".
 */

export type ReplyClass =
  | "bounce"
  | "auto_reply"
  | "complaint"
  | "unsubscribe"
  | "wrong_person"
  | "not_now"
  | "interested";

export interface ReplyInput {
  from: string;
  subject: string;
  body: string;
  /** Lower-cased header names → values, as Gmail returned them. */
  headers?: Record<string, string>;
}

const BOUNCE_FROM = /mailer-daemon@|postmaster@|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|undelivered mail|delivery (has )?failed|returned mail|address not found|failure notice/i;
const AUTO = /out of (the )?office|auto(matic|-)?\s?reply|autoreply|on (annual )?leave|vacation|away from (my|the) (desk|office)|will be back on|limited access to email|this mailbox is not monitored|thank you for (your email|contacting)[^.]{0,60}(we will|we'll) (respond|get back)/i;
const COMPLAINT = /\bspam(ming)?\b|report(ed|ing)? (you|this)|harass|\billegal\b|how did you get (my|this) (email|address)|reported as junk|cease and desist/i;
const UNSUBSCRIBE = /unsubscribe|remove (me|us|this (email|address))|take (me|us) off|stop (emailing|e-mailing|contacting|sending)|do not (contact|email)|don'?t (contact|email)|opt(-| )?out|no more emails/i;
const WRONG = /wrong (person|contact|address|email)|not the (right|correct) (person|contact)|no longer (works|with|at)|(has )?left the (company|firm|practice)|not (the|a) (decision maker|right fit for this inbox)|please (contact|reach out to|email) [a-z]|forward(ed|ing)? (this|your (email|note)) to/i;
const NOT_NOW = /not (interested|now|at this time|right now|a fit|for us)|no,? thank(s| you)|maybe (later|next)|(circle|check) back|next (quarter|year|month)|too busy|we('| a)re (all set|good|covered)|pass on this|not looking/i;
const INTERESTED = /\byes\b|interested|tell me more|sounds (good|great|interesting)|let'?s (talk|chat|do it)|sign (us|me) up|how (do|does|much|can)|send (me|us) (the|more|details|your code|it)|call me|set (it|us|me) up|i'?d like|we'?d like|count (us|me) in|happy to|more info/i;

/** Strip the quoted original so the classifier reads only what the person wrote. */
export function ownWords(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^On .{4,200} wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s/.test(line.trim()) && out.length > 0) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function classifyReply(r: ReplyInput): ReplyClass {
  const h = r.headers ?? {};
  if (BOUNCE_FROM.test(r.from) || BOUNCE_SUBJECT.test(r.subject)) return "bounce";
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return "auto_reply";
  if (h["x-autoreply"] || h["x-autorespond"] || /^(auto|bulk|junk)$/i.test(h["precedence"] ?? "")) return "auto_reply";

  const words = `${r.subject}\n${ownWords(r.body)}`;
  if (AUTO.test(words)) return "auto_reply";
  if (COMPLAINT.test(words)) return "complaint";
  if (UNSUBSCRIBE.test(words)) return "unsubscribe";
  if (WRONG.test(words)) return "wrong_person";
  if (NOT_NOW.test(words)) return "not_now";
  if (INTERESTED.test(words)) return "interested";
  // A human wrote back and none of the rules matched. A question is treated as interest — a missed
  // lead costs a sale, a mis-filed one costs her one glance at a card. Anything else is "not now".
  return /\?/.test(ownWords(r.body)) ? "interested" : "not_now";
}

/** The address a bounce says failed, read from the DSN text. */
export function bouncedAddress(body: string, headers: Record<string, string> = {}): string | null {
  const fromHeader = headers["x-failed-recipients"];
  if (fromHeader) return (fromHeader.split(",")[0] ?? "").trim().toLowerCase();
  const m = /Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i.exec(body)
    ?? /(?:wasn'?t delivered to|could not be delivered to|delivery to the following recipient[s]? failed[^:]*:)\s*<?([^\s<>]+@[^\s<>]+?)>?[\s.]/i.exec(body);
  return m?.[1] ? m[1].toLowerCase().replace(/[.,;]$/, "") : null;
}
