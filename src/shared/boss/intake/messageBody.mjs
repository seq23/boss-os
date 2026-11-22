/**
 * THE WORDS SHE ACTUALLY TYPED, TAKEN OUT OF THE MESSAGE SHE ACTUALLY SENT.
 *
 * ─── The bug this exists to end ────────────────────────────────────────────
 *
 * `boss@sequoiataylor.com` went live on 10 September 2026 and her first real message routed
 * perfectly — `#monique`, DMARC pass, `emp_relationship`, a queued task, a reply sent. And the task
 * it opened held this in `input.body`:
 *
 *     Received: from mail-pj1-x102e.google.com (2607:f8b0:4864:20::102e)
 *     ARC-Seal: i=2; a=rsa-sha256; s=cf2024-1; d=cloudflare-email.net; cv=pass;
 *     DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
 *     ... 8,378 bytes of this ...
 *
 * Her instruction — *"#Monique - Please add searching for buyers of Databricks to the weekly list"* —
 * was on line 104, between a multipart boundary and a quoted-printable HTML alternative. The handler
 * had done `await new Response(message.raw).text()` and put the WHOLE RFC 822 MESSAGE where the
 * instruction belonged. An employee picking that card up reads SMTP routing headers.
 *
 * This is the repo's most-named defect in a new costume: the piece that reads the mail and the piece
 * that does the work each held their own idea of what "the body" is, with no link between them.
 *
 * ─── READ BY postal-mime (22 Nov 2026) ─────────────────────────────────────
 *
 * This file used to walk the MIME tree itself: unfold, find the boundary, descend, decode base64 and
 * quoted-printable, a copy of West Peek's walker with its scars. Both walkers are gone; the message is
 * parsed once by `shared/mail/parseMail.mjs` (postal-mime, bounded) and this file keeps what is Boss
 * OS's own: plain text over HTML across the whole message, HTML reduced to words, the signature and
 * the quoted reply taken off, and a client that lied about UTF-8 still read as the windows-1252 it is.
 * A door that also reads the files hands its one parse here (`taskBodyFrom(parsed)`).
 */

import { parseMail } from "../../mail/parseMail.mjs";

/** Enough for any instruction plus a forwarded chain. Beyond this nobody is reading it anyway. */
export const MAX_READABLE_BYTES = 60_000;

/** The named entities a mail client actually emits, plus every numeric one. */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—",
  ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", middot: "·", bull: "•", trade: "™", copy: "©", reg: "®",
};

function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const n = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * HTML reduced to the words in it.
 *
 * A FALLBACK, NEVER THE FIRST CHOICE. `text/plain` is what the sender's own client wrote as the
 * readable version and it is always better than anything derived from markup. This runs when a
 * client sent HTML only — Outlook on the web does, routinely — and the alternative is an empty body.
 */
export function htmlToText(html) {
  const withoutInvisible = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  const broken = withoutInvisible
    .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => `${label} (${url})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<(hr|li)\b[^>]*>/gi, "\n");
  return decodeEntities(broken.replace(/<[^>]*>/g, ""))
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A client that LIED ABOUT UTF-8 (26 Oct 2026 held mail: `charset=utf-8` on windows-1252 bytes, so an
 * em dash and a curly apostrophe came out as U+FFFD). postal-mime honours the label, so when the text
 * it gives back carries a replacement character the message is read once more with every utf-8 label
 * dropped, and each part is then read as UTF-8 when it is valid and windows-1252 when it is not.
 */
const UTF8_LABEL = /(charset\s*=\s*)("?)utf-?8\2/gi;

async function textOf(source) {
  const parsed = source && typeof source === "object" && "mail" in source ? source : await parseMail(String(source ?? ""));
  const { mail } = parsed;
  if (!mail) return { parsed, plain: "", html: "" };
  let plain = mail.text ?? "";
  let html = mail.html ?? "";
  if (parsed.raw && (plain.includes("\uFFFD") || html.includes("\uFFFD")) && UTF8_LABEL.test(parsed.raw)) {
    UTF8_LABEL.lastIndex = 0;
    const again = await parseMail(parsed.raw.replace(UTF8_LABEL, "$1$2x-unlabelled$2"));
    if (again.mail) { plain = again.mail.text ?? ""; html = again.mail.html ?? ""; }
  }
  UTF8_LABEL.lastIndex = 0;
  return { parsed, plain, html, parts: (mail.attachments?.length ?? 0) + (mail.text ? 1 : 0) + (mail.html ? 1 : 0) };
}

/**
 * The readable text of a whole RFC 822 message: the raw text, or a door's one parse (`ParsedMail`).
 *
 * PREFERS `text/plain` OVER `text/html` ACROSS THE WHOLE TREE, not part by part. A `multipart/
 * alternative` carries the same words twice and taking both would hand an employee her instruction
 * followed by a second, uglier copy of her instruction. The plain text wins outright when there is
 * any (postal-mime gives `text` only when a plain part exists).
 *
 * A MESSAGE THAT CANNOT BE TAKEN APART (a forged one, refused by the parse's limits) is never read as
 * empty: its text after the headers is the body, capped, and `format` says "unparsed".
 */
export async function readableText(source, { full = false } = {}) {
  const keep = full ? (text) => text : cap;
  const { parsed, plain, html, parts } = await textOf(source);
  if (!parsed.mail) {
    const raw = parsed.raw;
    const end = raw.search(/\r?\n\r?\n/);
    return { text: keep(end === -1 ? "" : raw.slice(end).trim()), format: "unparsed", parts: 0 };
  }
  const text = plain.trim();
  if (text) {
    // Some booking platforms put the secure link only in their HTML alternative. In a mail
    // viewer, prefer that complete alternative over a plain part that loses the action.
    if (full && html) {
      const alternative = htmlToText(html).trim();
      const links = alternative.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      if (links.some((link) => !text.includes(link))) return { text: alternative, format: "html", parts };
    }
    return { text: keep(text), format: "plain", parts };
  }
  if (html.trim()) return { text: keep(htmlToText(html).trim()), format: "html", parts };
  return { text: "", format: "none", parts };
}

function cap(text) {
  return text.length > MAX_READABLE_BYTES ? `${text.slice(0, MAX_READABLE_BYTES)}\n[…truncated]` : text;
}

/**
 * Lines that end a message and start a signature.
 *
 * `-- ` IS THE ONLY ONE THAT IS ACTUALLY A STANDARD, and almost nobody's client emits it. Hers does
 * not: her block is `*- Sequoia Taylor*` followed by a website, two phone numbers and an alternate
 * address. So the rest of this is a BACKWARDS WALK over trailing lines that look like contact
 * details, which stops at the first line that looks like prose — a conservative rule that cannot eat
 * an instruction, because an instruction is not a phone number.
 */
const SIGNATURE_LINE =
  /^\s*(?:\*?\s*[-–—]{1,2}\s*[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}\s*\*?\s*$|(?:https?:\/\/|www\.)\S+\s*$|[+(]?[0-9][0-9()\s.-]{6,}(?:\([^)]*\))?\s*$|(?:alt\s+email|email|e-mail|mobile|office|direct|cell|tel|phone|fax)\s*[::]\s*\S.*$|sent from my \w+.*$|\S+@\S+\.\S+\s*$)/i;

/** Wrapped in markdown-ish emphasis by a mail client; `*901-355-1050 <901-355-1050> (mobile)*`. */
function unadorn(line) {
  return line.replace(/^\s*[*_]+|[*_]+\s*$/g, "").replace(/<[^>]*>/g, "").trim();
}

/**
 * The instruction, with the signature block and any quoted reply taken off the end.
 *
 * WHY BOTHER, WHEN THE BODY IS ALREADY READABLE. Because the card an employee opens is the whole of
 * what she said, and eleven lines of contact details under a one-line instruction changes what the
 * card looks like it is asking for. The quoted reply matters more: `On Thu, … wrote:` followed by
 * the previous message means a routine reply carries every earlier instruction with it, and an
 * employee acting on the whole card would act on all of them again.
 */
export function stripSignature(text) {
  let out = String(text ?? "").replace(/\r\n/g, "\n");

  // A quoted reply, and everything under it.
  const quote = /^\s*(?:On .{4,120}\s+wrote:|-{2,}\s*Original Message\s*-{2,})\s*$/im.exec(out);
  if (quote) out = out.slice(0, quote.index);

  // The one real standard: `-- ` on a line of its own.
  const delimiter = /^-- \s*$/m.exec(out);
  if (delimiter) out = out.slice(0, delimiter.index);

  /*
   * AND THE SAME DELIMITER WITH ITS TRAILING SPACE GONE, because coming through HTML it always is.
   * `--<br>Sequoia Taylor` renders as a bare `--` line, and the strict rule above leaves the sender's
   * own name sitting under her instruction. Bounded to a SHORT tail: a `--` with three hundred
   * characters under it is a divider inside a message, not the end of one, and cutting there would
   * throw away real content — the failure mode this walk is deliberately built not to have.
   */
  const bare = [...out.matchAll(/^\s*-{2,3}\s*$/gm)].pop();
  if (bare && out.length - bare.index < 500) out = out.slice(0, bare.index);

  const lines = out.split("\n");
  let end = lines.length;
  let sawSignatureLine = false;
  while (end > 0) {
    const line = unadorn(lines[end - 1]);
    if (!line) { end -= 1; continue; }
    if (!SIGNATURE_LINE.test(line)) break;
    sawSignatureLine = true;
    end -= 1;
  }

  /*
   * RULE 0, LOCALLY: NEVER STRIP EVERYTHING. A message that is nothing but a phone number would walk
   * the counter to zero and hand back an empty card — the same silent loss this whole module is
   * being written to end. If nothing survives the walk, nothing was a signature.
   */
  const kept = lines.slice(0, end).join("\n").trim();
  if (sawSignatureLine && !kept) return out.trim();
  return kept || out.trim();
}

/**
 * HER OWN WORDS, NEVER THE EMAIL SHE IS ANSWERING (27 Oct 2026).
 *
 * A reply carries the whole email it answers under "On … wrote:" and `>` lines. On 27 Oct 2026 her
 * "2: Hi …, Tuesday at 9am works" on Simone's morning email was handed to Monique "Matched on:
 * seller, shares" and queued a $200M seller hunt: those words were only in the quoted morning
 * (the new-deals grid), never in hers. Every keyword reader (routing, handoff, hunt, triage, list
 * edits, numbered answers) reads THIS, never `readable`. One rule, used everywhere, so a lane cannot
 * strip one way and its neighbour another. A forwarded message is not a quote: its body stays.
 */
export const QUOTE_START = /\n[ \t]*On [^\n]{4,200}?(?:\n[^\n]{0,200}?){0,2}?wrote:[ \t]*(?=\n|$)|\n[ \t]*-{2,}[ \t]*Original Message|\n[ \t]*>/i;

export function ownWords(text) {
  const t = `\n${String(text ?? "").replace(/\r\n?/g, "\n")}`;
  const m = QUOTE_START.exec(t);
  return (m ? t.slice(0, m.index) : t).trim();
}

/** Where a forwarded message starts: Gmail's "---------- Forwarded message ---------", Apple Mail's "Begin forwarded message:". */
export const FORWARD_START = /\n[ \t]*-{2,}[ \t]*Forwarded message|\n[ \t]*Begin forwarded message:?/i;

/**
 * WHAT SHE HERSELF WROTE (#514 re-check, 22 Nov 2026): `ownWords` cut again at a forward. `ownWords` keeps a
 * forward's body on purpose, because a forward is material she hands over (a broker's book, a deal to route,
 * a thing to research). But a forward is someone else's words, so nothing that CHANGES something of hers is
 * read from it: a list edit, a duty edit, a deadline, a hold. Each of those doors reads this, and only this,
 * so a forwarded "change the frames duty: count the attic too" never edits her duty. ONE boundary for every
 * such door (the list door's `aboveQuote` is this function). Pure.
 */
export function herWords(text) {
  const t = `\n${ownWords(text)}`;
  const m = FORWARD_START.exec(t);
  return (m ? t.slice(0, m.index) : t).trim();
}

/**
 * What goes on the work card: readable, decoded, and without the trailer.
 *
 * ONE FUNCTION, so the intake and the guard that checks the intake can never mean two different
 * things by "the body". `scripts/validate/a-task-body-is-not-a-mime-message.mjs` calls exactly this.
 */
export async function taskBodyFrom(source) {
  const read = await readableText(source);
  const body = stripSignature(read.text);
  return { body, format: read.format, parts: read.parts, readable: read.text };
}

/**
 * The header names that must NEVER appear at the start of a line in a captured body, and the shapes
 * that mean the same thing.
 *
 * EXPORTED SO THE GUARD AND THE FIX SHARE ONE LIST. Written from the real message: `Received:`,
 * `ARC-Seal:`, `DKIM-Signature:`, `X-Gm-Message-State:`, the boundary line, and the `=` soft break
 * that is the tell of undecoded quoted-printable.
 */
export const MIME_TELLS = [
  { name: "an SMTP Received: header", test: /^Received:\s/m },
  { name: "a Return-Path: header", test: /^Return-Path:\s/m },
  { name: "an ARC seal or signature", test: /^ARC-(?:Seal|Message-Signature|Authentication-Results):\s/m },
  { name: "a DKIM-Signature: header", test: /^(?:X-Google-)?DKIM-Signature:\s/m },
  { name: "an Authentication-Results: header", test: /^Authentication-Results:\s/m },
  { name: "a Received-SPF: header", test: /^Received-SPF:\s/m },
  { name: "an X-Gm-* Gmail internal header", test: /^X-Gm-[A-Za-z-]+:\s/m },
  { name: "a MIME-Version: header", test: /^MIME-Version:\s/m },
  { name: "a Content-Type: header", test: /^Content-Type:\s/m },
  { name: "a Content-Transfer-Encoding: header", test: /^Content-Transfer-Encoding:\s/m },
  { name: "a Message-ID: header", test: /^Message-ID:\s/m },
  { name: "a multipart boundary line", test: /^--[A-Za-z0-9'()+_,./:=?-]{8,}(?:--)?\s*$/m },
  { name: "a quoted-printable soft line break", test: /=\r?\n/ },
  { name: "a quoted-printable escape", test: /=[0-9A-F]{2}(?=[A-Za-z0-9=<">\s])/ },
];

/** Every MIME tell in a captured body, named. Empty means the body is readable text. */
export function mimeTellsIn(body) {
  return MIME_TELLS.filter((t) => t.test.test(String(body ?? ""))).map((t) => t.name);
}
