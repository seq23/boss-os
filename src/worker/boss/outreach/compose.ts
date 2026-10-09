/**
 * ONE OUTREACH EMAIL, AS RFC 5322. CAN-SPAM is built into the shape rather than the copy:
 *   · a working unsubscribe link in the body AND a one-click List-Unsubscribe header;
 *   · the business's physical postal address in the footer;
 *   · an honest From (the business's own address) and a subject that describes the email.
 * `composeEmail` throws rather than produce a message without the unsubscribe link or the address.
 */
import type { Business } from "./catalog";

export const UNSUBSCRIBE_BASE = "https://boss.sequoiataylor.com/api/boss/outreach/u/";

export interface ComposeInput {
  business: Business;
  step: 0 | 1 | 2;
  to: string;
  org: string;
  metro: string;
  unsubToken: string;
  postalAddress: string;
  /** The first email's subject, which follow-ups answer with "Re:". */
  firstSubject?: string | null;
  /** Threading for follow-ups. */
  inReplyTo?: string | null;
  refLink?: string | null;
}

export interface Composed {
  subject: string;
  body: string;
  raw: string;
}

function fill(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
}

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

export function unsubscribeUrl(token: string): string {
  return `${UNSUBSCRIBE_BASE}${encodeURIComponent(token)}`;
}

export function composeEmail(i: ComposeInput): Composed {
  if (!i.unsubToken) throw new Error("Refused: no unsubscribe token, so the email would have no unsubscribe link.");
  const address = (i.postalAddress ?? "").trim();
  if (address.length < 10) throw new Error("Refused: no postal address for this business. CAN-SPAM requires one in every email.");

  const step = i.business.steps[i.step];
  const vars = {
    org: i.org || "there",
    metro: i.metro,
    brand: i.business.brand,
    offer_url: i.refLink || i.business.offerUrl,
    ref_link: i.refLink ?? "",
    subject: i.firstSubject ?? "",
  };
  const subject = fill(step.subject, vars).trim();
  const unsub = unsubscribeUrl(i.unsubToken);
  const body =
    `${fill(step.body, vars)}\n\n— The ${i.business.brand} team\n${i.business.domain}\n\n` +
    `--\nYou are receiving this because ${vars.org} is publicly listed as a business we think we can help. ` +
    `Unsubscribe with one click: ${unsub}\n${i.business.brand}, ${address}\n`;

  const headers = [
    `From: ${i.business.brand} <${i.business.sender}>`,
    `To: ${i.to}`,
    `Subject: ${encodeHeader(subject)}`,
    `List-Unsubscribe: <${unsub}>, <mailto:${i.business.sender}?subject=unsubscribe>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
  ];
  if (i.inReplyTo) headers.push(`In-Reply-To: ${i.inReplyTo}`, `References: ${i.inReplyTo}`);
  const raw = `${headers.join("\r\n")}\r\n\r\n${btoa(unescape(encodeURIComponent(body)))}`;
  return { subject, body, raw };
}

export function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
