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
 *   · ONE PARSE PER MESSAGE. Several readers read one message in a row (the deck, voice notes, every
 *     other file); the last parse is kept and handed back for the same string (`mimeParseCount`).
 *   · BOUNDED. A forged message (parts nested hundreds deep, thousands of parts, megabytes of headers)
 *     is refused by postal-mime's own limits, set tight below; the refusal is flagged, never thrown.
 *   · A PARSE THAT FAILS KEEPS THE MESSAGE. The caller has already stored it; every reader returns the
 *     failure as an `unread` line naming why, so the card says it, and `messageText` falls back to the
 *     raw text so a trigger tag is still found.
 */
import PostalMime from "postal-mime";
import type { Email, Attachment as MimePart } from "postal-mime";

export interface Attachment {
  filename: string;
  mediaType: string;
  /** Base64, exactly as `readDeck` and the transcriber want it. */
  dataBase64: string;
  bytes: number;
}

/** More than this and the firm is being sent a library, not a deck. */
export const MAX_ATTACHMENTS = 3;

/** A deck bigger than this is not going to be read inside one invocation. */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

/**
 * A voice note up to this size is heard (15 Nov 2026: was 3 MB). Whisper takes it as base64; a phone's
 * few minutes of m4a is 1 to 20 MB; Email Routing refuses anything over 25 MB before it arrives.
 */
export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;

/**
 * postal-mime's limits, tight for real mail: a forward of a forward is a handful of levels and a few dozen
 * parts. Its defaults (256 levels, 10,000 parts, 2 MiB of headers) are for a mail client, not a Worker.
 */
export const MIME_LIMITS = {
  maxNestingDepth: 24,
  maxPartCount: 400,
  maxHeadersSize: 512 * 1024,
  maxRfc822NestingDepth: 6,
  maxForwardedAddresses: 2000,
} as const;

export interface ParsedMail {
  mail: Email | null;
  /** Why the message could not be taken apart (postal-mime's error code), or null. */
  failed: string | null;
}

let lastParse: { raw: string; parsed: Promise<ParsedMail> } | null = null;
/** How many times a message was actually parsed. Exposed for the test that pins one parse per message. */
export const mimeParseCount = { n: 0 };

/** The message, parsed once. Never throws: a refused or broken message is `failed`. */
export function parseMail(raw: string): Promise<ParsedMail> {
  if (lastParse && lastParse.raw === raw) return lastParse.parsed;
  mimeParseCount.n += 1;
  const parsed = PostalMime.parse(raw, { ...MIME_LIMITS, attachmentEncoding: "base64" })
    .then((mail): ParsedMail => ({ mail, failed: null }))
    .catch((e: unknown): ParsedMail => ({ mail: null, failed: String((e as { code?: string })?.code ?? (e as Error)?.message ?? e).slice(0, 80) }));
  lastParse = { raw, parsed };
  return parsed;
}

/** What the card says when the message itself could not be taken apart. */
export const PARSE_FAILED_NAME = "the message";
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

async function attachmentsOf(
  raw: string, accept: (part: MimePart, filename: string) => boolean, mediaTypeOf: (type: string) => string,
  max: number, maxBytes = MAX_ATTACHMENT_BYTES,
): Promise<{ attachments: Attachment[]; unread: string[] }> {
  const attachments: Attachment[] = [];
  const unread: string[] = [];
  const { mail, failed } = await parseMail(raw);
  if (!mail) return { attachments, unread: failed ? [failedLine(failed)] : [] };

  for (const part of mail.attachments) {
    const filename = filenameOf(part);
    if (!accept(part, filename)) continue;
    if (attachments.length >= max) {
      unread.push(`${filename} (only the first ${max} were taken)`);
      continue;
    }
    const dataBase64 = typeof part.content === "string" ? part.content : "";
    if (!dataBase64) {
      unread.push(`${filename} (it was empty)`);
      continue;
    }
    const bytes = Math.floor((dataBase64.length * 3) / 4);
    if (bytes > maxBytes) {
      unread.push(`${filename} (${(bytes / 1024 / 1024).toFixed(1)}MB — too large to read here)`);
      continue;
    }
    attachments.push({ filename, mediaType: mediaTypeOf(part.mimeType), dataBase64, bytes });
  }
  return { attachments, unread };
}

/**
 * The PDFs in a raw MIME message. `unread` names what looked like one and could not be taken, so the
 * caller can SAY so on the work card. Silence about a dropped attachment is how the Sensori deck went missing.
 */
export function pdfAttachments(raw: string): Promise<{ attachments: Attachment[]; unread: string[] }> {
  return attachmentsOf(raw, (p) => p.mimeType.includes("application/pdf"), () => "application/pdf", MAX_ATTACHMENTS);
}

const SOUND_FILE = /\.(?:m4a|mp3|wav|aac|ogg|oga|opus|caf|amr|webm)$/i;

/** The audio files a person attached (a phone's "New Recording 4.m4a"), by type or by a sound file's name. */
export function audioAttachments(raw: string): Promise<{ attachments: Attachment[]; unread: string[] }> {
  return attachmentsOf(raw, (p, name) => p.mimeType.startsWith("audio/") || SOUND_FILE.test(name),
    (type) => type || "audio/mp4", 5, MAX_VOICE_NOTE_BYTES);
}

/** EVERY FILE IN THE MESSAGE (15 Nov 2026): every part that is not the message's own text, base64 as it is. */
export function fileAttachments(raw: string, max = 40): Promise<{ attachments: Attachment[]; unread: string[] }> {
  return attachmentsOf(raw, () => true, (type) => type || "application/octet-stream", max, 30 * 1024 * 1024);
}

/** Base64 to bytes in one pass, without a per-byte callback. Throws on bad base64. */
export function bytesOfBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[\r\n\s]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes to base64 in 32 KB slices (a single String.fromCharCode over megabytes overflows the stack). */
export function base64OfBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Enough to carry a forwarded chain and its tags; not so much that scanning it costs real time. */
const MAX_SCANNED_BODY = 256 * 1024;

/**
 * The readable text of a message: its subject (decoded), and its text and HTML bodies. Used by the
 * scheduled reader to find a `#wpdeck` written in the body of a message too big to read at the door.
 * A message that cannot be taken apart falls back to its raw text after the headers, so a tag in it is
 * still found; `unread` says so.
 */
export async function messageText(raw: string): Promise<{ subject: string; body: string; unread?: string }> {
  const { mail, failed } = await parseMail(raw);
  if (!mail) {
    const end = raw.search(/\r?\n\r?\n/);
    const head = (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
    return {
      subject: /^subject\s*:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? "",
      body: end === -1 ? "" : raw.slice(end).trim().slice(0, MAX_SCANNED_BODY),
      unread: failedLine(failed ?? "unknown"),
    };
  }
  return { subject: mail.subject ?? "", body: [mail.text ?? "", mail.html ?? ""].filter(Boolean).join("\n").slice(0, MAX_SCANNED_BODY) };
}

/**
 * A deck that arrived as something this cannot open, named precisely, never as silence (operator, 24 Aug
 * 2026: decks also arrive as .pptx, Keynote, and Docsend or Google Slides links). Nothing is converted.
 */
const DECK_LIKE_TYPES: ReadonlyArray<{ match: RegExp; called: string }> = [
  { match: /presentationml|\.pptx?$/i, called: "a PowerPoint file" },
  { match: /keynote|\.key$/i, called: "a Keynote file" },
  { match: /opendocument\.presentation|\.odp$/i, called: "an OpenDocument presentation" },
  { match: /msword|wordprocessingml|\.docx?$/i, called: "a Word document" },
];

export async function unreadableDeckAttachments(raw: string): Promise<string[]> {
  const { mail } = await parseMail(raw);
  if (!mail) return [];
  const found: string[] = [];
  for (const part of mail.attachments) {
    const type = part.mimeType;
    if (!type || type.includes("application/pdf") || type.startsWith("text/")) continue;
    const filename = filenameOf(part);
    const known = DECK_LIKE_TYPES.find((k) => k.match.test(type) || k.match.test(filename));
    if (known) found.push(`${filename} (${known.called})`);
  }
  return found.slice(0, MAX_ATTACHMENTS);
}

/**
 * Deck links in the body, which is how a lot of decks travel now. SURFACED, NOT FETCHED: Docsend gates
 * on an email address and Google Slides needs paging through slides.
 */
const DECK_HOSTS = /https:\/\/(?:www\.)?(docsend\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|notion\.so|figma\.com|canva\.com|pitch\.com)\/[^\s"'<>)\]]+/gi;

export function deckLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(DECK_HOSTS)) {
    const url = m[0].replace(/[.,;:]+$/, "");
    seen.add(url.slice(0, 300));
    if (seen.size >= 5) break;
  }
  return [...seen];
}
