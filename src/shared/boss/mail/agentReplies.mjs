/**
 * EVERY REAL REPLY TO AN AGENT'S EMAIL REACHES HER (owner, 28 Nov 2026: "Replies reach her: P&P office
 * replies never arrived, and no check caught it"). Three office replies to Camille's Christmas outreach
 * (9, 10 and 16 Nov) were stored by the Porch & Party mailer and marked "forwarded" to her Gmail; none
 * was ever found there and nothing said so.
 *
 * Now each stored reply becomes a Decide card in Simone's morning email (and so on Today's Decide list),
 * with their own words and a Reply button. The forward stays as a spare copy only. Simone writes the
 * cards on every tick into the `agent_replies` morning section (scripts/ops/lib/agent-replies.mjs); the
 * morning email's existing rules then show a card in full once, as a thin "still yours" line after that,
 * and keep it on Today until she answers or drops it.
 *
 * A reply counts only from a person (never a no-reply, bounce or social-network notice: 12 of the 15
 * "forwarded" rows were TikTok's own mail). A reply the receiving server could not tie to the company it
 * claims to be from is still shown, never dropped, but is never shown as if it were real: its card says
 * so first and asks her to check before she shares anything. Pure.
 */
import { cleanText, lineProblems } from "./plain.mjs";
import { formatIn } from "../schedule/clock.mjs";

/** Never a person: no-reply and system addresses, and the social networks' own notices. */
export const SYSTEM_SENDER = /^(?:no-?reply|do-?not-?reply|register|notifications?|mailer-daemon|postmaster|bounces?\b|bounces\+)|@(?:[a-z0-9-]+\.)*(?:tiktok|facebookmail|google|linkedin|instagram)\.com$/i;

/** "caddison@thememphian.com" → "The Memphian". */
export const orgOf = (email) => {
  const d = String(email).split("@")[1] ?? "";
  const base = d.replace(/^(?:mail|www)\./, "").split(".").slice(0, -1).join(" ");
  return base.replace(/(foundation|security|group|law|company|church|school)$/i, " $1").replace(/\bthe(?=[a-z])/i, "the ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || d;
};

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_WORDS = 900;

/** The Decide key of one stored reply: the same reply is one card however many times it is read. */
export const replyKey = (source, r) => `reply:${source}:${String(r.message_id || r.id)}`;

/** Only people's replies, each once (by Message-ID, else by its stored id), oldest first. Pure. */
export function realReplies(replies) {
  const seen = new Set();
  const out = [];
  for (const r of [...(replies ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const email = String(r?.email ?? "").trim().toLowerCase();
    if (r?.kind !== "reply" || !EMAIL.test(email) || SYSTEM_SENDER.test(email)) continue;
    const id = String(r.message_id || r.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...r, email });
  }
  return out;
}

/**
 * Their words as one line her email can show. The morning email drops any line that fails the plain
 * check (ids, file names, tags), so a reply's words are cleaned as prose first, and anything that still
 * fails is cut out word by word: a card is never lost because of what someone typed.
 */
export function theirWords(text) {
  // What a mail client leaves behind when it turns HTML into text: "<https://…>" after a link and
  // "[Company Logo]" / "[image: …]" where a picture was. Structure, never their words.
  // The quoted email starts at its client's attribution line ("On Mon, Nov 16, 2026 at 10:34 AM … wrote:"),
  // which a narrow client wraps over two lines, so the mailer's own cut can miss it.
  const own = String(text ?? "").split(/\s(?=On (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (?:[A-Z][a-z]{2,8} \d{1,2}|\d{1,2} [A-Z][a-z]{2,8}),? \d{4}\b)/)[0];
  const plain = own.replace(/<(?:https?:|mailto:)[^>\s]*>/gi, " ").replace(/\[(?:image:[^\]]*|[^\]]{0,80}\b(?:logo|image|icon|photo)\b[^\]]{0,40})\]/gi, " ");
  let words = cleanText(plain.replace(/\s+/g, " ").trim(), { prose: true });
  for (let i = 0; i < 8 && words; i++) {
    const problems = lineProblems(words);
    if (!problems.length) break;
    for (const p of problems) {
      const hit = /: "(.+)"$/.exec(p)?.[1];
      words = hit ? words.split(hit).join(" ").replace(/\s{2,}/g, " ").trim() : "";
    }
  }
  if (words && lineProblems(words).length) words = "";
  return words.length > MAX_WORDS ? `${words.slice(0, MAX_WORDS).replace(/\s+\S*$/, "")}…` : words;
}

/** Gmail's compose window to them, subject "Re: …". She sends it from the Porch & Party address. */
export function replyUrl(r) {
  const subject = String(r.subject ?? "").replace(/^\s*(?:re|fw|fwd)\s*:\s*/i, "").trim();
  const q = new URLSearchParams({ view: "cm", fs: "1", to: r.email, su: `Re: ${subject || "your note"}` });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

/**
 * One Decide card per real reply. `source` names where the copy is kept ("pnp" = the Porch & Party
 * mailer), `fromAddress` the agent address they answered, `agent` who wrote to them. Pure.
 */
export function replyCards(replies, { source = "pnp", agent = "Camille", fromAddress = "sequoia@porchandparty901.com", tz = "America/Chicago" } = {}) {
  return realReplies(replies).map((r) => {
    const org = orgOf(r.email);
    const name = String(r.from_name ?? "").replace(/["“”<>]/g, "").trim();
    const who = name && name.toLowerCase() !== org.toLowerCase() ? `${name} at ${org}` : org;
    const verified = r.auth === "pass";
    const when = Number.isFinite(Date.parse(r.at)) ? formatIn(Date.parse(r.at), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, tz) : null;
    const words = r.text == null ? "" : theirWords(r.text);
    const said = words ? `They wrote: “${words}”` : r.unread
      ? "Their words could not be read from the stored copy, so open the forwarded copy in your Gmail or ask Simone for it."
      : "Their reply had no words of its own (only the quoted email).";
    return {
      key: replyKey(source, r),
      title: verified ? `${who} answered ${agent}'s email` : `Check first: a reply that says it is from ${org}`,
      body: verified ? said : `The mail server could not confirm it really came from ${org}, so check it before you share anything. ${said}`,
      details: [
        `${when ? `Received ${when} at ` : "Received at "}${fromAddress}${r.subject ? `, on "${String(r.subject).slice(0, 120)}"` : ""}.`,
        `Reply sends from your Gmail: choose ${fromAddress} in the From line.`,
      ],
      buttons: [{ label: "Reply", url: replyUrl(r) }],
      priority: verified ? 3 : 1,
      fresh_at: Date.parse(r.at) || null,
    };
  });
}
