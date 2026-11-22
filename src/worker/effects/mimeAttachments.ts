/**
 * The files and text in an email, read by postal-mime (eng sweep row 9, 22 Nov 2026).
 *
 * This file used to be a 402-line MIME parser of its own: boundary splitting, header unfolding, nested
 * multiparts, quoted-printable, each fixed after a real deck went missing (Apple Mail's folded boundary,
 * a `+` in a boundary, a forward's nested multipart). postal-mime does all of that, and more (RFC 2231
 * filenames, encoded words, message/rfc822 forwards, every transfer encoding), in a parser built for
 * Workers. What stays here is what is ours: which files each reader takes, the caps, and the rule this
 * file has always kept: ANYTHING NOT TAKEN IS SAID (`unread`), never silence.
 *
 *   · ONE PARSE PER MESSAGE, HELD BY THE CALLER. `parseMail` is called once at each door and the
 *     `ParsedMail` is handed to every reader; nothing is cached here, so a message (and its files) is
 *     gone from memory when the request that read it is (review of #517, F2: a module-level cache kept
 *     the last message, up to 30 MB, in the isolate between requests).
 *   · FILES AS BYTES. postal-mime hands each part over as an ArrayBuffer; base64 is made only for a
 *     part a reader takes, in slices joined once (F1: postal-mime's own base64 mode built each file
 *     as a string of joined pieces that V8 kept whole, 257 MB held for one 16 MB file, so a Worker's
 *     128 MB ran out at a 12 MB voice note). `tests/mimeMemory.test.ts` runs the readers under a
 *     128 MB heap.
 *   · BOUNDED. A forged message (parts nested hundreds deep, thousands of parts, megabytes of headers)
 *     is refused by postal-mime's own limits, set tight below; the refusal is flagged, never thrown.
 *   · A PARSE THAT FAILS KEEPS THE MESSAGE. The caller has already stored it; every reader returns the
 *     failure as an `unread` line naming why, so the card says it, and `messageText` falls back to the
 *     raw text so a trigger tag is still found.
 */
import type { Attachment as MimePart } from "postal-mime";
import { parseMail, mimeParseCount, MIME_LIMITS, type ParsedMail } from "../../shared/mail/parseMail.mjs";

export { parseMail, mimeParseCount, MIME_LIMITS, type ParsedMail };

/** A file as bytes: what Boss intake reads (a recording is made base64 only when it is heard). */
export interface FilePart {
  filename: string;
  mediaType: string;
  content: Uint8Array;
  bytes: number;
}

/**
 * A voice note up to this size is heard (15 Nov 2026: was 3 MB). Whisper takes it as base64; a phone's
 * few minutes of m4a is 1 to 20 MB; Email Routing refuses anything over 25 MB before it arrives.
 */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;

/** What the card says when the message itself could not be taken apart. */
const PARSE_FAILED_NAME = "the message";
/** postal-mime's refusal in plain words: this line reaches her Got it, so no error code is ever in it. */
const PLAIN_REFUSAL: Record<string, string> = {
  EMAXNESTINGDEPTH: "its parts are nested deeper than any real email",
  EMAXPARTCOUNT: "it holds more parts than any real email",
  EMAXHEADERSIZE: "its headers are larger than any real email's",
  EMAXFORWARDEDADDRESSES: "its forwards carry more addresses than any real email",
};
const failedLine = (why: string) => `${PARSE_FAILED_NAME} (it could not be taken apart, ${PLAIN_REFUSAL[why] ?? "it is not a well-formed email"}; it is kept as it arrived)`;

function filenameOf(part: MimePart): string {
  if (part.filename) return part.filename.trim().slice(0, 200);
  // No name: called by what it is, so a picture is never announced as "attachment.pdf".
  const sub = /^[a-z]+\/([a-z0-9.+-]+)/i.exec(part.mimeType)?.[1]?.toLowerCase();
  return !part.mimeType || sub === "pdf" ? "attachment.pdf" : `attachment.${(sub ?? "bin").replace(/^x-|\+.*$/g, "").slice(0, 8)}`;
}

function partsOf(
  parsed: ParsedMail, accept: (part: MimePart, filename: string) => boolean, mediaTypeOf: (type: string) => string,
  max: number, maxBytes: number,
): { files: FilePart[]; unread: string[] } {
  const files: FilePart[] = [];
  const unread: string[] = [];
  const { mail, failed } = parsed;
  if (!mail) return { files, unread: failed ? [failedLine(failed)] : [] };

  for (const part of mail.attachments) {
    const filename = filenameOf(part);
    if (!accept(part, filename)) continue;
    if (files.length >= max) {
      unread.push(`${filename} (only the first ${max} were taken)`);
      continue;
    }
    const content = typeof part.content === "string" ? new TextEncoder().encode(part.content) : new Uint8Array(part.content);
    if (!content.byteLength) {
      unread.push(`${filename} (it was empty)`);
      continue;
    }
    if (content.byteLength > maxBytes) {
      unread.push(`${filename} (${(content.byteLength / 1024 / 1024).toFixed(1)}MB — too large to read here)`);
      continue;
    }
    files.push({ filename, mediaType: mediaTypeOf(part.mimeType), content, bytes: content.byteLength });
  }
  return { files, unread };
}

/** EVERY FILE IN THE MESSAGE (15 Nov 2026): every part that is not the message's own text, as bytes. */
export function fileAttachments(parsed: ParsedMail, max = 40): { attachments: FilePart[]; unread: string[] } {
  const { files, unread } = partsOf(parsed, () => true, (type) => type || "application/octet-stream", max, 30 * 1024 * 1024);
  return { attachments: files, unread };
}

/** Base64 to bytes in one pass, without a per-byte callback. Throws on bad base64. */
export function bytesOfBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[\r\n\s]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bytes to base64, one 96 KB slice at a time, joined once. A slice is a multiple of 3 bytes so only
 * the last carries padding; the binary string of the whole file is never built, and `join` gives one
 * flat string rather than a rope V8 keeps every piece of.
 */
export function base64OfBytes(bytes: Uint8Array): string {
  const SLICE = 0x8000 * 3;
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += SLICE) {
    const slice = bytes.subarray(i, i + SLICE);
    let bin = "";
    for (let j = 0; j < slice.length; j += 0x8000) bin += String.fromCharCode(...slice.subarray(j, j + 0x8000));
    out.push(btoa(bin));
  }
  return out.join("");
}
