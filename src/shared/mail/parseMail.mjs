/**
 * ONE EMAIL PARSE FOR THE WHOLE REPO (eng sweep row 9, 22 Nov 2026): postal-mime, with limits tighter
 * than its defaults so a forged message (parts nested hundreds deep, thousands of parts, megabytes of
 * headers) is refused at once. West Peek's readers (`worker/effects/mimeAttachments.ts`) and Boss OS's
 * body reader (`shared/boss/intake/messageBody.mjs`) both call this, so the two companies share a
 * library, never each other's code.
 *
 * FILES COME BACK AS ArrayBuffers, never as postal-mime's base64 strings: those are built from joined
 * pieces V8 keeps whole while the string is held (review of #517: 257 MB held for one 16 MB file, so
 * a Worker's 128 MB ran out at a 12 MB voice note). `tests/mimeMemory.test.ts` holds this.
 *
 * Nothing is cached: the caller parses once and hands the result to each reader, and it is gone with
 * the request. Never throws: a refused or broken message is `failed`, with postal-mime's code.
 */
import PostalMime, { decodeWords } from "postal-mime";
import { repairMojibake } from "../boss/mail/subject.mjs";

/** Tight for real mail: a forward of a forward is a handful of levels and a few dozen parts. Its defaults
 * (256 levels, 10,000 parts, 2 MiB of headers) are for a mail client, not a Worker. */
export const MIME_LIMITS = Object.freeze({
  maxNestingDepth: 24,
  maxPartCount: 400,
  maxHeadersSize: 512 * 1024,
  maxRfc822NestingDepth: 6,
  maxForwardedAddresses: 2000,
});

/** How many times a message was parsed. Exposed for the tests that pin one parse per message at a door. */
export const mimeParseCount = { n: 0 };

export async function parseMail(raw) {
  mimeParseCount.n += 1;
  const text = String(raw ?? "");
  try {
    return { raw: text, mail: await PostalMime.parse(text, { ...MIME_LIMITS, attachmentEncoding: "arraybuffer" }), failed: null };
  } catch (e) {
    return { raw: text, mail: null, failed: String(e?.code ?? e?.message ?? e).slice(0, 80) };
  }
}

/**
 * A header's encoded words (RFC 2047: `=?UTF-8?Q?=23monique_=E2=80=94?=`), decoded by postal-mime in their own charset,
 * then repaired where the sender's client had already garbled them (4 Nov 2026: "Ã¢Â€Â”" subjects). The one header
 * decoder for both companies: a subject tag survives a dash or a curly quote. Never throws: a header it cannot read is
 * returned as it came, because a subject we cannot decode is still a subject.
 */
export function decodeHeader(value) {
  const text = String(value ?? "");
  let decoded = text;
  try { decoded = text.includes("=?") ? decodeWords(text) : text; } catch { decoded = text; }
  return repairMojibake(decoded);
}
