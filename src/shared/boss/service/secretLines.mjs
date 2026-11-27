/**
 * SECRETS BY EMAIL — THE PURE HALF (R3, 6 Oct 2026).
 *
 * The owner, 6 Oct 2026, for West Peek OS: "we should be able to email them and u should look them
 * up in the vault when necessary without approval" — and today, for every Boss OS employee: "same
 * capabilities and friction reduction". A COPY of West Peek OS's door, never an import.
 *
 * She writes `SECRET RUNWARE_API_KEY=abc123` on its own line in an email to boss@. This file reads
 * those lines, refuses reserved names BY NAME, and scrubs every value — accepted or refused — out of
 * the raw MIME (plain, quoted-printable and base64 text parts alike, read by postal-mime), so nothing downstream can copy
 * it anywhere. The Worker half (`src/worker/boss/service/secretHandoff.ts`) encrypts and stores.
 */
import { decodeHeader, parseMail } from "../../mail/parseMail.mjs";

export const SECRET_REDACTED = "[secret redacted]";
/** The Worker secret that encrypts a hand-off. Vendor-prefixed; never a reserved name. */
export const SECRET_HANDOFF_KEY_NAME = "BOSS_OS_SECRET_HANDOFF_KEY";

/** Detect an exact runtime credential in plain text or a serialized model request. */
export function containsCredential(text, env) {
  return Object.entries(env).some(([name, value]) =>
    /(?:PASSCODE|PASSWORD|SECRET|TOKEN|API_KEY|MAIL_KEY|SERVICE_ROLE_KEY)$/.test(name) &&
    typeof value === "string" && value.length >= 8 &&
    (text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1))),
  );
}

/** Names no email may set: what a process, a loader or her seat reads for itself, and this door's own key. */
export const RESERVED_SECRET_NAMES = new Set([
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "PATH", "HOME", "SHELL", "USER",
  "LOGNAME", "TMPDIR", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS", "NODE_PATH", "CI",
  "GIT_SSH_COMMAND", "SSH_AUTH_SOCK", SECRET_HANDOFF_KEY_NAME, "BOSS_PASSCODE", "BOSS_SESSION_SECRET",
  "SESSION_SECRET",
]);
export const RESERVED_SECRET_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "DYLD_", "LD_", "NODE_", "NPM_", "GIT_", "SSH_", "BASH_", "ZSH_", "XDG_"];

/** Why a name is refused, or null when it may be stored. */
export function secretNameProblem(name) {
  const n = String(name ?? "").trim();
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(n)) return "a secret name is SCREAMING_SNAKE_CASE, 3–64 characters";
  if (RESERVED_SECRET_NAMES.has(n)) return `${n} is reserved — a process reads it for itself; it is never set by email`;
  const prefix = RESERVED_SECRET_PREFIXES.find((p) => n.startsWith(p));
  if (prefix) return `${n} starts with ${prefix}, a reserved prefix (her seat, a loader or the shell); use the vendor's own name`;
  if (!n.includes("_")) return `${n} has no vendor prefix — name it VENDOR_THING (RUNWARE_API_KEY, RESEND_API_KEY)`;
  return null;
}

const SECRET_LINE = /^[ \t>]*SECRET[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.+?)[ \t]*$/gm;

/** Read the SECRET lines out of decoded text. Pure. */
export function readSecretLines(text) {
  const found = [];
  const refused = [];
  const values = [];
  const scrubbed = String(text ?? "").replace(SECRET_LINE, (_m, name, rawValue) => {
    let value = String(rawValue).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.length >= 4) values.push(value);
    const why = secretNameProblem(name);
    if (why) refused.push({ name, why });
    else if (!value || value.length < 4) refused.push({ name, why: "the value is empty or shorter than 4 characters" });
    else if (!found.some((f) => f.name === name)) found.push({ name, value });
    return `SECRET ${name}=${SECRET_REDACTED}`;
  });
  return { found, refused, scrubbed, values: [...new Set(values)] };
}

/** True when nothing but greetings, sign-offs, employee tags and redacted SECRET lines remain. */
export function nothingButSecrets(scrubbedWritten) {
  const rest = String(scrubbedWritten ?? "")
    .replace(/^.*SECRET [A-Z0-9_]+=.*$/gm, "")
    .replace(/#[a-z0-9_-]+/gi, "")
    .replace(/^\s*(hey|hi|hello|dear|morning|afternoon)[\s,!]*\w*[\s,!:—–-]*$/gim, "")
    .replace(/^\s*(thanks|thank you|cheers|best|regards|ty|thx)[\s,!.]*$/gim, "")
    .replace(/^\s*(here (are|is) (the|some|my)? ?(keys?|secrets?|credentials?)|for the vault|secrets? for [\w./-]+|keys? for [\w./-]+)[\s,!.:]*$/gim, "")
    .replace(/^\s*(sequoia|s|seq)[\s,!.]*$/gim, "")
    .replace(/^\s*--+\s*$/gm, "")
    .replace(/[^A-Za-z0-9]+/g, "");
  return rest.length === 0;
}

// ─── The MIME scrub ──────────────────────────────────────────────────────────

/*
 * POSTAL-MIME READS, THIS FILE ONLY REWRITES (22 Nov 2026, row olp_m81m3hdh0dansp34: the home-made decoders are gone).
 * First every literal copy of a value is replaced in the raw text. Then the message is parsed ONCE by postal-mime: if any
 * decoded part (text, html, a text file) still carries a value, the kept message is REBUILT from that parse: her top
 * headers, the scrubbed text and html as 8bit, every file re-encoded base64 from its own bytes (text files scrubbed).
 * A message postal-mime cannot take apart keeps its headers and loses its body, never the other way round: a secret is
 * never kept because a part could not be read (fails closed).
 *
 * ENCODED HEADERS (RFC 2047, engineering review 22 Nov 2026: a value in `Subject: =?utf-8?B?…?=` survived). Every top
 * header holding an encoded word is decoded by `decodeHeader` (postal-mime's decodeWords, the repo's one header decoder).
 * One that decodes to a value is written back decoded with the value replaced (RFC 6532 UTF-8, which postal-mime reads;
 * its decoder turns a decoded CR LF into a space, so no header of its own can start). One whose word cannot be read (left standing
 * by the decoder, or bytes its charset rejects) becomes the marker: a header we cannot read is never kept raw. The same
 * reading runs over the parts: a value in an encoded part header or file name sends the message to the rebuild.
 */
const TOP_HEADERS_DROPPED = /^(?:content-type|content-transfer-encoding|mime-version|content-disposition)$/i;

function base64Of(buffer) {
  const bytes = new Uint8Array(buffer ?? new ArrayBuffer(0));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (btoa(bin).match(/.{1,76}/g) ?? []).join("\r\n");
}

function topHeaders(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  const block = end === -1 ? raw : raw.slice(0, end);
  return block.split(/\r?\n(?![ \t])/).filter((h) => h && !TOP_HEADERS_DROPPED.test(h.split(":")[0].trim())).join("\r\n");
}

/** An encoded word the decoder could not read: its opener still standing, or bytes its charset rejected. */
const unreadWord = (decoded) => /=\?[^?\s]*\?[^?\s]*\?/.test(decoded) || decoded.includes("\uFFFD");
/** One top header line, folds included. */
const HEADER_LINE = /^([!-9;-~]+):([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/gm;

/** The value as anything reading the mail would see it: literally, or through its encoded words. */
const exposes = (wanted, text) => {
  const t = String(text ?? "");
  if (wanted.some((v) => t.includes(v))) return true;
  return t.includes("=?") && wanted.some((v) => decodeHeader(t).includes(v));
};

/** Text with every value replaced, its encoded words decoded first when they are what carries one. */
const scrubberFor = (wanted, marker) => {
  const replaceAll = (text) => wanted.reduce((acc, v) => acc.split(v).join(marker), String(text ?? ""));
  return (text) => {
    const plain = replaceAll(text);
    return exposes(wanted, plain) ? replaceAll(decodeHeader(plain)) : plain;
  };
};

function splitHead(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  return end === -1 ? [raw, ""] : [raw.slice(0, end), raw.slice(end)];
}

/**
 * ONE HEADER VALUE, as it may be kept: every value replaced, read through its encoded words (decoded, value replaced, one
 * line) when they are what carries one, and the marker alone when an encoded word in it cannot be read. Unchanged when
 * nothing in it carries a value. Also the subject the door hands back, which was read before any value was known.
 */
export function scrubSecretHeader(value, values, marker = SECRET_REDACTED) {
  const wanted = (values ?? []).filter((v) => typeof v === "string" && v.length >= 4);
  const plain = wanted.reduce((acc, v) => acc.split(v).join(marker), String(value ?? ""));
  if (!wanted.length || !plain.includes("=?")) return plain;
  const decoded = decodeHeader(plain.replace(/\r?\n[ \t]+/g, " "));
  if (unreadWord(decoded)) return marker;
  if (!wanted.some((v) => decoded.includes(v))) return plain;
  return wanted.reduce((acc, v) => acc.split(v).join(marker), decoded).trim();
}

/** The top headers with every encoded value scrubbed and every unreadable encoded word withheld. */
function scrubTopHeaders(raw, wanted, marker) {
  const [head, rest] = splitHead(raw);
  return head.replace(HEADER_LINE, (line, name, value) => {
    const kept = scrubSecretHeader(value, wanted, marker);
    return kept === value ? line : `${name}: ${kept}`;
  }) + rest;
}

/** True when a top header holds an encoded word nobody can read: unsure, so it counts as carrying a value. */
function unreadTopHeader(raw) {
  const [head] = splitHead(raw);
  return [...head.matchAll(HEADER_LINE)].some(([, , value]) => value.includes("=?") && unreadWord(decodeHeader(value.replace(/\r?\n[ \t]+/g, " "))));
}

const isTextFile = (a) => /^text\//i.test(a?.mimeType ?? "");
const textOfFile = (a) => { try { return new TextDecoder("utf-8").decode(new Uint8Array(a.content)); } catch { return ""; } };

/** Every decoded text the parse holds: the bodies, any text file, and every file's name. */
function decodedTexts(mail) {
  const files = mail?.attachments ?? [];
  return [mail?.text ?? "", mail?.html ?? "", ...files.filter(isTextFile).map(textOfFile), ...files.map((a) => a.filename ?? "")];
}

/** The message rebuilt from the one parse with every value replaced. */
function rebuilt(raw, mail, replaceAll) {
  const boundary = `boss-scrub-${Math.random().toString(36).slice(2, 12)}`;
  const parts = [];
  const part = (headers, body) => parts.push(`--${boundary}\r\n${headers.join("\r\n")}\r\n\r\n${body}\r\n`);
  if (mail.text) part(["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit"], replaceAll(mail.text));
  if (mail.html) part(["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit"], replaceAll(mail.html));
  for (const a of mail.attachments ?? []) {
    const name = replaceAll(String(a.filename ?? "file")).replace(/["\r\n]/g, "");
    const bytes = isTextFile(a) ? new TextEncoder().encode(replaceAll(textOfFile(a))).buffer : a.content;
    part([`Content-Type: ${a.mimeType || "application/octet-stream"}; name="${name}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${a.disposition === "inline" ? "inline" : "attachment"}; filename="${name}"`,
      ...(a.contentId ? [`Content-ID: ${a.contentId}`] : [])], base64Of(bytes));
  }
  return `${topHeaders(raw)}\r\nMIME-Version: 1.0\r\nX-Boss-OS-Scrubbed: secret redacted\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}--${boundary}--\r\n`;
}

/** EVERY VALUE OUT OF THE RAW MESSAGE, plain or encoded. Nothing else changes when nothing encoded carries one. */
export async function scrubSecretValues(raw, values, marker = SECRET_REDACTED) {
  const wanted = (values ?? []).filter((v) => typeof v === "string" && v.length >= 4);
  if (!wanted.length || !raw) return raw;
  const scrub = scrubberFor(wanted, marker);
  const out = scrubTopHeaders(wanted.reduce((acc, v) => acc.split(v).join(marker), String(raw)), wanted, marker);
  const parsed = await parseMail(out);
  if (!parsed.mail) return `${topHeaders(out)}\r\nX-Boss-OS-Scrubbed: body withheld (${parsed.failed})\r\n\r\n${marker}\r\n`;
  if (!exposes(wanted, out) && !decodedTexts(parsed.mail).some((t) => exposes(wanted, t))) return out;
  return rebuilt(out, parsed.mail, scrub);
}

/** True when any value is still readable in the message, plainly, through an encoded word or in anything postal-mime
 * decodes, or when a top header holds an encoded word that cannot be read (unsure counts as carrying). */
export async function carriesSecretValue(raw, values) {
  const wanted = (values ?? []).filter((v) => typeof v === "string" && v.length >= 4);
  if (!wanted.length || !raw) return false;
  if (exposes(wanted, raw) || unreadTopHeader(String(raw))) return true;
  const { mail } = await parseMail(String(raw));
  return decodedTexts(mail).some((t) => exposes(wanted, t));
}

/** The one line her reply carries. Names only. */
export function secretDoorLine(stored, refused) {
  const parts = [];
  if (stored?.length) parts.push(`Stored ${stored.map((s) => `${s.name}${s.repo ? ` for ${s.repo}` : ""}`).join(", ")}; it is never shown again, and your Mac moves it into the vault on its next pass.`);
  if (refused?.length) parts.push(`Not stored: ${refused.map((r) => `${r.name} (${r.why})`).join("; ")}.`);
  return parts.join(" ") || "No secret was read.";
}
