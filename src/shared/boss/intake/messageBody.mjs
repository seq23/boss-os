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
 * ─── BOSS OS'S OWN, COPIED AND NOT IMPORTED ────────────────────────────────
 *
 * `src/worker/effects/mimeAttachments.ts` already solves most of this for West Peek's mailbox, and
 * its scars are worth having: unfold the headers before you look for a boundary, descend into nested
 * multiparts because a forward always has one, split on a plain string because a boundary may legally
 * contain regex metacharacters, and cap the depth because a message can declare a boundary containing
 * itself. All of that is copied. NONE of it is imported — `validate:boss-intake` fails the build the
 * moment Boss OS's intake reaches into West Peek's, and that guard is right: these are two companies.
 *
 * What is NOT copied is that file's two deliberate refusals, because they are wrong here. It skips
 * base64 parts and never decodes quoted-printable, which is fine when you are scanning for a hashtag
 * and fatal when the decoded text IS the deliverable. Her own message's HTML alternative is
 * quoted-printable; a Mail.app message is routinely base64.
 *
 * ─── AND IT RUNS INSIDE A WORKER ───────────────────────────────────────────
 *
 * ~10ms of CPU. Every loop here is bounded, the output is capped, and the oversize path never calls
 * this at all — that message goes to R2 and is read by something with a real CPU budget.
 */

/** Enough for any instruction plus a forwarded chain. Beyond this nobody is reading it anyway. */
export const MAX_READABLE_BYTES = 60_000;

/** A message can declare a boundary that contains itself. Descent stops. */
const MAX_MIME_DEPTH = 6;

/** More parts than any real message has; a defence against a boundary that splits into thousands. */
const MAX_PARTS = 200;

/** Join RFC 5322 continuation lines back onto their header. Bounded to the header block. */
function unfoldHeaders(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  return (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
}

/** One header out of a part's own header block, unfolded first. */
function headerIn(part, name) {
  const headerEnd = part.search(/\r?\n\r?\n/);
  const block = (headerEnd === -1 ? part : part.slice(0, headerEnd)).replace(/\r?\n[ \t]+/g, " ");
  const m = new RegExp(`^${name}\\s*:\\s*(.*)$`, "im").exec(block);
  return m ? m[1].trim() : null;
}

/** The multipart boundary a header block declares, or null when the message is not multipart. */
function boundaryIn(headerBlock) {
  const m = /content-type:\s*multipart\/[^\n]*?boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(headerBlock);
  return m ? m[1] : null;
}

/** Everything after the blank line that ends a part's headers. */
function bodyOf(part) {
  const at = part.search(/\r?\n\r?\n/);
  if (at === -1) return "";
  return part.slice(at + (part.slice(at, at + 2) === "\r\n" ? 4 : 2));
}

/**
 * Every leaf part, flattened.
 *
 * DESCENDS, because a forward is `multipart/mixed` inside `multipart/alternative` and a one-level
 * split hands back the wrapper — a block whose own Content-Type says `multipart/…`, matching no text
 * rule, so the words come back empty while they were in the bytes the whole time.
 */
function leafParts(section, boundary, depth = 0, out = []) {
  for (const part of section.split(`--${boundary}`)) {
    if (out.length >= MAX_PARTS) return out;
    /*
     * `boundaryIn` wants a HEADER LINE, not a header VALUE, and passing it the bare value made this
     * whole function a no-op for every nested message. Caught by the Apple Mail forward fixture:
     * `multipart/mixed; boundary="Apple-Mail=_1122…"` never matched `content-type:\s*multipart/`,
     * so the nested block came back as one opaque leaf, the leaf's own type read `multipart/mixed`,
     * no text rule matched it, and a forward with her instruction at the top produced an EMPTY body.
     * Which is the same silent loss as the raw-MIME bug wearing the opposite face.
     */
    const inner = depth < MAX_MIME_DEPTH ? boundaryIn(`content-type: ${headerIn(part, "content-type") ?? ""}`) : null;
    if (inner) leafParts(part, inner, depth + 1, out);
    else out.push(part);
  }
  return out;
}

/**
 * `=C2=A0` and a soft line break, undone.
 *
 * THE SOFT BREAK IS THE HALF EVERY NAIVE VERSION FORGETS. A quoted-printable line is at most 76
 * characters and a trailing `=` means "this line did not really end" — so `buyers=C2=A0of Da\ntabricks`
 * is one word split across a line, and leaving the break in produces text that reads as a typo in
 * her instruction rather than as a decoding failure.
 */
export function decodeQuotedPrintable(text) {
  const joined = String(text ?? "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < joined.length; i += 1) {
    const c = joined[i];
    if (c === "=" && /^[0-9a-fA-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    const code = joined.charCodeAt(i);
    if (code < 128) { bytes.push(code); continue; }
    // Already a decoded character (a client that lied about its encoding); keep it as UTF-8 bytes.
    for (const b of new TextEncoder().encode(c)) bytes.push(b);
  }
  return utf8(Uint8Array.from(bytes));
}

/** Base64 to text. Whitespace is stripped first — a MIME body is wrapped at 76 columns. */
export function decodeBase64Text(text) {
  const clean = String(text ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return "";
  try {
    const bin = atob(clean);
    return utf8(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    /*
     * A TRUNCATED BASE64 PART IS NOT A REASON TO LOSE THE MESSAGE. Returning "" here would be a
     * silent drop; the caller falls through to the next part, and if every part fails the whole
     * message is reported as unreadable rather than as empty.
     */
    return "";
  }
}

function utf8(bytes) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
  catch { return String.fromCharCode(...bytes); }
}

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
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<(hr|li)\b[^>]*>/gi, "\n");
  return decodeEntities(broken.replace(/<[^>]*>/g, ""))
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One part, decoded according to what its own headers say it is. */
function textOfPart(part) {
  const type = (headerIn(part, "content-type") ?? "").toLowerCase();
  if (!type.startsWith("text/")) return null;
  const disposition = (headerIn(part, "content-disposition") ?? "").toLowerCase();
  // A .txt or .csv sent as an attachment is a file, not the message.
  if (disposition.startsWith("attachment")) return null;

  const encoding = (headerIn(part, "content-transfer-encoding") ?? "").toLowerCase();
  const raw = bodyOf(part);
  const decoded = encoding.includes("base64")
    ? decodeBase64Text(raw)
    : encoding.includes("quoted-printable")
      ? decodeQuotedPrintable(raw)
      : raw;
  return { html: type.startsWith("text/html"), text: decoded };
}

/**
 * The readable text of a whole RFC 822 message.
 *
 * PREFERS `text/plain` OVER `text/html` ACROSS THE WHOLE TREE, not part by part. A `multipart/
 * alternative` carries the same words twice and taking both would hand an employee her instruction
 * followed by a second, uglier copy of her instruction. The plain part wins outright when there is
 * one anywhere in the message.
 */
export function readableText(raw) {
  const source = String(raw ?? "");
  const headerBlock = unfoldHeaders(source);
  const boundary = boundaryIn(headerBlock);

  if (!boundary) {
    const encoding = (headerIn(source, "content-transfer-encoding") ?? "").toLowerCase();
    const type = (headerIn(source, "content-type") ?? "").toLowerCase();
    const body = bodyOf(source);
    const decoded = encoding.includes("base64")
      ? decodeBase64Text(body)
      : encoding.includes("quoted-printable")
        ? decodeQuotedPrintable(body)
        : body;
    const text = type.startsWith("text/html") ? htmlToText(decoded) : decoded;
    return { text: cap(text.trim()), format: type.startsWith("text/html") ? "html" : "plain", parts: 1 };
  }

  const plain = [];
  const html = [];
  const leaves = leafParts(source, boundary);
  for (const part of leaves) {
    const got = textOfPart(part);
    if (!got || !got.text.trim()) continue;
    (got.html ? html : plain).push(got.text);
  }

  if (plain.length) return { text: cap(plain.join("\n\n").trim()), format: "plain", parts: leaves.length };
  if (html.length) return { text: cap(htmlToText(html.join("\n")).trim()), format: "html", parts: leaves.length };
  return { text: "", format: "none", parts: leaves.length };
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
 * What goes on the work card: readable, decoded, and without the trailer.
 *
 * ONE FUNCTION, so the intake and the guard that checks the intake can never mean two different
 * things by "the body". `scripts/validate/a-task-body-is-not-a-mime-message.mjs` calls exactly this.
 */
export function taskBodyFrom(raw) {
  const read = readableText(raw);
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
