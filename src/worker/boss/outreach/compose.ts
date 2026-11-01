/**
 * ONE OUTREACH EMAIL, AS RFC 5322. CAN-SPAM is built into the shape rather than the copy:
 *   · a working unsubscribe link in the body AND a one-click List-Unsubscribe header;
 *   · the business's physical postal address in the footer — one short line in the plain-text
 *     part, and in the HTML part in very small muted type (10px grey) beside the unsubscribe line;
 *   · an honest From (the business's own address) and a subject that describes the email.
 * `composeEmail` throws rather than produce a message without the unsubscribe link or the address.
 */
import { GUIDES_SIGNER, UMBRELLA_COMPANY, UMBRELLA_CONTACT, type Business } from "./catalog";
import { seatEndMonth, type Pitch } from "./seat";
import { GROUPS_KEY, outboundProblems } from "../../../shared/boss/t2rGroups/rules.mjs";

/** The umbrella company and its one address live in catalog.ts (the senders use it); re-exported here. */
export { UMBRELLA_COMPANY, UMBRELLA_CONTACT } from "./catalog";

/** The company the footer names: the umbrella for a local guide, otherwise the brand itself. */
export function footerCompany(b: Business): string {
  return b.kind === "local_guide" ? UMBRELLA_COMPANY : b.brand;
}

/** The footer's company line, e.g. "USCIS Exam Guides is a property of <the umbrella company>." + address. */
function companyLines(b: Business, address: string): string[] {
  const company = footerCompany(b);
  return company === b.brand ? [`${b.brand}, ${address}`] : [`${b.brand} is a property of ${company}.`, `${company}, ${address} · ${UMBRELLA_CONTACT}`];
}

/**
 * The sign-off above the CAN-SPAM footer. A local guide is signed by a person over the umbrella
 * company and the guide's domain (owner, 16 Oct 2026: "it should always be S.L. Taylor"); every
 * other business by its brand's team.
 */
export function signatureFor(b: Business): string {
  return b.kind === "local_guide" ? `${GUIDES_SIGNER}\n${UMBRELLA_COMPANY}\n${b.domain}` : `— The ${b.brand} team\n${b.domain}`;
}

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
  /** A seat business's pitch (seat.ts): A = the seat is open (default), B = it is taken. */
  pitch?: Pitch;
  /** The taken seat's end, YYYY-MM-DD. Pitch B names its month and refuses without it. */
  seatEnd?: string | null;
  /** A Time-2-Read group's own trial code ({code}). Absent = the placeholder stays and the email is refused. */
  groupCode?: string | null;
}

export interface Composed {
  subject: string;
  body: string;
  /** The HTML alternative: the same words, with the CAN-SPAM footer in 10px muted grey. */
  html: string;
  raw: string;
}

/** The footer's type: the smallest that still reads, muted. Pinned by the test. */
export const FOOTER_STYLE = "font-size:10px;line-height:14px;color:#8a8a8a;";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fill(t: string, v: Record<string, string>): string {
  // An unknown placeholder is left in place, so the refusal below catches it rather than sending a gap.
  return t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
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

  if (i.pitch === "B" && !i.business.seat) throw new Error(`Refused: ${i.business.brand} has no seat, so it has no pitch B.`);
  if (i.pitch === "B" && !(i.seatEnd && /^\d{4}-\d{2}-\d{2}$/.test(i.seatEnd))) {
    throw new Error("Refused: pitch B names the month the exclusive seat ends, and no end date was given.");
  }
  const steps = i.pitch === "B" && i.business.seat ? i.business.seat.taken : i.business.steps;
  const step = steps[i.step];
  if (!step) throw new Error(`Refused: ${i.business.brand} has no email number ${i.step + 1}; its sequence is ${steps.length} emails.`);
  const vars: Record<string, string> = {
    org: i.org || "there",
    metro: i.metro,
    brand: i.business.brand,
    offer_url: i.refLink || i.business.offerUrl,
    ref_link: i.refLink ?? "",
    subject: i.firstSubject ?? "",
    seat_end_month: i.seatEnd ? seatEndMonth(i.seatEnd) : "",
    ...(i.groupCode ? { code: i.groupCode } : {}),
  };
  const subject = fill(step.subject, vars).trim();
  const unsub = unsubscribeUrl(i.unsubToken);
  const message = `${fill(step.body, vars)}\n\n${signatureFor(i.business)}`;
  const isGroup = i.business.key === GROUPS_KEY;
  const why = isGroup
    ? `You are receiving this because ${vars.org} publishes this address for its families and members.`
    : `You are receiving this because ${vars.org} is publicly listed as a business we think we can help.`;
  const body =
    `${message}\n\n--\n${why} Unsubscribe with one click: ${unsub}\n${companyLines(i.business, address).join("\n")}\n`;
  const html =
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#222222;">` +
    `<div>${esc(message).replace(/\n/g, "<br>")}</div>` +
    `<p style="${FOOTER_STYLE}margin-top:24px;">${esc(why)} ` +
    `<a href="${esc(unsub)}" style="color:#8a8a8a;">Unsubscribe with one click</a>.<br>` +
    `${companyLines(i.business, address).map(esc).join("<br>")}</p></body></html>`;
  // THE REFUSAL, CHECKED ON WHAT WAS BUILT: no unfilled placeholder, and both footers carry the
  // unsubscribe link and the company lines (for a local guide, the umbrella company and its contact).
  const left = /\{\w+\}/.exec(`${subject}\n${message}`);
  if (left) throw new Error(`Refused: ${left[0]} was left unfilled in ${i.business.brand}'s email.`);
  // Time-2-Read groups (owner, 31 Oct 2026): no price, no call ask, no claim we never make.
  if (isGroup) {
    // Their own name is theirs, never our claim ("Reading Therapy Co-op" is not a medical claim).
    const bad = outboundProblems(`${subject}\n${message}`.split(i.org || "there").join(""));
    if (bad.length) throw new Error(`Refused: the Time2Read group email ${bad.join("; ")}.`);
  }
  const footerLines = companyLines(i.business, address);
  if (!body.includes(unsub) || !html.includes(`href="${esc(unsub)}"`) || footerLines.some((l) => !body.includes(l) || !html.includes(esc(l)))) {
    throw new Error(`Refused: ${i.business.brand}'s email is missing its unsubscribe link or footer company line.`);
  }
  if (i.business.kind === "local_guide" && !footerLines.some((l) => l.includes(UMBRELLA_CONTACT))) {
    throw new Error(`Refused: a local guide's email must name its company and ${UMBRELLA_CONTACT} in the footer.`);
  }
  const boundary = `=_outreach_${crypto.randomUUID().replace(/-/g, "")}`;
  const b64 = (t: string) => btoa(unescape(encodeURIComponent(t))).replace(/(.{76})/g, "$1\r\n");

  const headers = [
    `From: ${i.business.brand} <${i.business.sender}>`,
    `To: ${i.to}`,
    `Subject: ${encodeHeader(subject)}`,
    `List-Unsubscribe: <${unsub}>, <mailto:${i.business.sender}?subject=unsubscribe>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  // Every Industry Guides email answers to the umbrella address (owner, 13 Oct 2026).
  if (i.business.kind === "local_guide") headers.splice(2, 0, `Reply-To: ${UMBRELLA_CONTACT}`);
  if (i.inReplyTo) headers.push(`In-Reply-To: ${i.inReplyTo}`, `References: ${i.inReplyTo}`);
  const part = (type: string, content: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(content)}\r\n`;
  const raw = `${headers.join("\r\n")}\r\n\r\n${part("text/plain", body)}${part("text/html", html)}--${boundary}--\r\n`;
  return { subject, body, html, raw };
}

export function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
