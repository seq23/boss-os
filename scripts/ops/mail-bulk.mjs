/**
 * WHAT MAKES A MESSAGE NOT A PERSON WRITING TO HER — ONE MODULE, TWO MAILBOX READERS.
 *
 * ─── Why this file exists ─────────────────────────────────────────────────────
 *
 * `interest-ledger.mjs` has filtered bulk structurally since it was written: every legitimate
 * marketing send sets `List-Unsubscribe`, a person does not, and the same goes for `List-Id`,
 * `Precedence: bulk`, `Auto-Submitted`, no-reply senders and out-of-office subjects. These are facts
 * about the message, not guesses about its wording.
 *
 * `lp-positive.mjs` had none of that. It read every inbound message in the LP mailbox, decoded the
 * body and asked whether it contained "book a call". A Google Cloud sales drip contains "book a
 * meeting". A vendor selling a raise-capital programme contains "set up a call". A school's
 * autoresponder contains "keep in touch". Monique's OWN monthly email contains every positive
 * phrase there is, because it quotes them. On 5 October 2026 seven of the thirteen names on her
 * running list were those: a drip, a vendor, two newsletters, an autoresponder, and two of our own
 * system addresses — bucketed as LPs who want a call.
 *
 * THE FIX IS NOT A SECOND COPY OF THE FILTER. The repository's whole history is second copies
 * drifting from first ones, so the structural filter moved HERE and both readers import it. A
 * header that marks bulk for the brokerage mailbox marks bulk for the LP mailbox; there is one
 * definition and one place to strengthen it.
 *
 * ─── Three questions, in order, and why each is structural ───────────────────
 *
 *   1. `bulkReason(headers)`   — is this a list, a machine, a bounce or an autoresponder?
 *   2. `ownDomainReason(addr)` — is this one of our own addresses? System mail is never an LP.
 *   3. `replyEvidence(...)`    — is this a REPLY to something we sent? A message that neither
 *                                threads onto our mail (In-Reply-To / References) nor quotes it
 *                                is not a reply, however friendly its wording.
 *
 * Nothing here calls Gmail, reads a file, or sends anything anywhere. Every function is pure over
 * strings and header maps so the tests can feed it synthetic messages and `validate:gmail` can
 * confirm the readers that import it still ask for nothing more than they did.
 */

/** Our own sending domains. A message FROM any of these is system mail, never a counterparty. */
export const OUR_DOMAINS = Object.freeze(["westpeek.ventures", "sequoiataylor.com", "joinwestpeek.com"]);

/**
 * STAGE 1 — structural bulk. Facts about the message, never a judgement about its wording.
 *
 * Takes a map of LOWER-CASED header names to values. Returns a NAMED REASON or null. The name is
 * what lets a run report what it dropped: "99.9% discarded" is only a bug you can see if the
 * discard is itemised.
 */
export function bulkReason(headers) {
  const h = (name) => headers[name.toLowerCase()] ?? "";
  if (h("list-unsubscribe")) return "bulk_list_unsubscribe";
  if (h("list-id")) return "bulk_list_id";
  if (/\bbulk\b|\blist\b|\bjunk\b/i.test(h("precedence"))) return "bulk_precedence";
  if (h("auto-submitted") && !/^no$/i.test(h("auto-submitted").trim())) return "bulk_auto_submitted";
  if (h("x-autoreply") || h("x-autorespond")) return "bulk_autoresponder";
  const from = h("from").toLowerCase();
  if (/(^|<)\s*(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|postmaster|bounce)[.\-+_a-z0-9]*@/i.test(from)) {
    return "bulk_noreply_sender";
  }
  if (/@(mailchimp|sendgrid|substack|beehiiv|hubspot|constantcontact|mailgun|salesforce|marketo)\b/i.test(from)) {
    return "bulk_marketing_platform";
  }
  const subject = h("subject");
  if (/\b(out of (the )?office|automatic reply|auto.?reply|autoresponder|undeliverable|delivery status notification|undelivered mail|delivery has failed|returned mail|failure notice|address not found)\b/i.test(subject)) {
    return "bulk_auto_subject";
  }
  return null;
}

/** The first address in a header value, lower-cased, or "". */
export const addressIn = (raw) => (String(raw ?? "").match(/[\w.+'-]+@[\w.-]+\.\w+/) ?? [""])[0].toLowerCase();

/** Our own system mail — Monique's monthly note, Porter's replies, her own sends — is never an LP. */
export function ownDomainReason(address) {
  const domain = String(address ?? "").toLowerCase().split("@")[1] ?? "";
  return OUR_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) ? "own_domain" : null;
}

/**
 * The top header block of a raw RFC 822 message as a lower-cased map, continuation lines unfolded.
 * Repeated headers keep the first value except `References`, which is joined — a long thread
 * splits it across lines and every id in it matters.
 */
export function headersFromRaw(raw) {
  const i = String(raw).search(/\r?\n\r?\n/);
  const block = i === -1 ? String(raw) : String(raw).slice(0, i);
  const out = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (name === "references" && out[name]) out[name] += ` ${m[2]}`;
    else if (!(name in out)) out[name] = m[2];
  }
  return out;
}

/** Every message-id a message says it is replying to, from In-Reply-To and References, without brackets. */
export function referencedIds(headers) {
  const ids = new Set();
  for (const name of ["in-reply-to", "references"]) {
    for (const m of String(headers[name] ?? "").matchAll(/<([^<>\s]+)>/g)) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Does the body QUOTE our outreach? Only a line in quoting position counts — a `>` line, an
 * "On … wrote:" line, or a "From:" line of an embedded original — so that a newsletter whose
 * unsubscribe link happens to carry her address does not pass as a reply to her.
 */
export function quotesMailbox(bodyText, mailbox) {
  const needle = String(mailbox).toLowerCase();
  if (!needle) return false;
  for (const line of String(bodyText).split(/\r?\n/)) {
    if (!line.toLowerCase().includes(needle)) continue;
    if (/^\s*>|\bwrote:|^\s*\*?(from|de|von)\s*:\*?|^\s*-{2,}\s*original message/i.test(line)) return true;
  }
  return false;
}

/**
 * STAGE 3 — is this a reply to something WE sent?
 *
 * `sentByUs(messageId)` answers whether a message-id is one of ours; the caller decides how (a
 * Gmail search scoped to the mailbox, or a fixed set in a test). It is only consulted when the body
 * does not already quote the mailbox, so a run makes that call for the few messages that need it.
 *
 * Returns { evidence: "quoted" | "thread" } or { reason: "not_a_reply" }.
 */
export async function replyEvidence({ headers, bodyText, mailbox, sentByUs }) {
  if (quotesMailbox(bodyText, mailbox)) return { evidence: "quoted" };
  for (const id of referencedIds(headers)) {
    if (await sentByUs(id)) return { evidence: "thread" };
  }
  return { reason: "not_a_reply" };
}
