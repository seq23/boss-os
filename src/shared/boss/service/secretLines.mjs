/**
 * SECRETS BY EMAIL — THE PURE HALF (R3, 6 Oct 2026).
 *
 * The owner, 6 Oct 2026, for West Peek OS: "we should be able to email them and u should look them
 * up in the vault when necessary without approval" — and today, for every Boss OS employee: "same
 * capabilities and friction reduction". A COPY of West Peek OS's door, never an import.
 *
 * She writes `SECRET RUNWARE_API_KEY=abc123` on its own line in an email to boss@. This file reads
 * those lines, refuses reserved names BY NAME, and scrubs every value — accepted or refused — out of
 * the raw MIME (plain, quoted-printable and base64 text parts alike), so nothing downstream can copy
 * it anywhere. The Worker half (`src/worker/boss/service/secretHandoff.ts`) encrypts and stores.
 */
/*
 * THE SCRUB KEEPS ITS OWN SMALL MIME WALK, ON PURPOSE (22 Nov 2026, when the repo's two reading walkers
 * moved onto postal-mime): it does not read the message, it REWRITES it, replacing an encoded part in
 * the raw text with its scrubbed 8bit copy. A parser hands back decoded content, never where the part
 * sits in the raw bytes, so this needs the raw parts and the two decoders below, which live here now
 * because this is their only user.
 */

export const SECRET_REDACTED = "[secret redacted]";
/** The Worker secret that encrypts a hand-off. Vendor-prefixed; never a reserved name. */
export const SECRET_HANDOFF_KEY_NAME = "BOSS_OS_SECRET_HANDOFF_KEY";

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

/**
 * `=C2=A0` and a soft line break, undone.
 *
 * THE SOFT BREAK IS THE HALF EVERY NAIVE VERSION FORGETS. A quoted-printable line is at most 76
 * characters and a trailing `=` means "this line did not really end" — so `buyers=C2=A0of Da\ntabricks`
 * is one word split across a line, and leaving the break in produces text that reads as a typo in
 * her instruction rather than as a decoding failure.
 */
export function decodeQuotedPrintable(text, charset) {
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
  return utf8(Uint8Array.from(bytes), charset);
}

/** Base64 to text. Whitespace is stripped first — a MIME body is wrapped at 76 columns. */
export function decodeBase64Text(text, charset) {
  const clean = String(text ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return "";
  try {
    const bin = atob(clean);
    return utf8(Uint8Array.from(bin, (c) => c.charCodeAt(0)), charset);
  } catch {
    /*
     * A TRUNCATED BASE64 PART IS NOT A REASON TO LOSE THE MESSAGE. Returning "" here would be a
     * silent drop; the caller falls through to the next part, and if every part fails the whole
     * message is reported as unreadable rather than as empty.
     */
    return "";
  }
}

/** One `TextDecoder` per label: cheap to reuse, and a bad label only ever fails once. */
const DECODERS = new Map();
function decoderFor(label) {
  let d = DECODERS.get(label);
  if (d === undefined) {
    try { d = new TextDecoder(label, { fatal: true }); } catch { d = null; }
    DECODERS.set(label, d);
  }
  return d;
}

/**
 * THE PART'S OWN CHARSET WINS (26 Oct 2026 held mail: a windows-1252 em dash and curly apostrophe,
 * declared or not, came out as U+FFFD because this always decoded as UTF-8). A declared non-UTF-8
 * charset decodes as itself; an undeclared or UTF-8-declared part that is not actually valid UTF-8
 * (a client that lied) falls back to windows-1252, the one real mail clients actually emit — never
 * a guess beyond that, and never a change to the bytes themselves.
 */
function utf8(bytes, charset) {
  const label = String(charset ?? "").trim().toLowerCase();
  if (label && !["utf-8", "utf8", "us-ascii", "ascii"].includes(label)) {
    const d = decoderFor(label);
    if (d) { try { return d.decode(bytes); } catch { /* fall through to UTF-8 / windows-1252 */ } }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch {
    const fallback = decoderFor("windows-1252");
    if (fallback) { try { return fallback.decode(bytes); } catch { /* fall through */ } }
    return String.fromCharCode(...bytes);
  }
}


function headerOf(part, name) {
  const end = part.search(/\r?\n\r?\n/);
  const block = (end === -1 ? part : part.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const m = new RegExp(`^${name}\\s*:\\s*(.*)$`, "im").exec(block);
  return m ? m[1].trim() : null;
}

function leaves(section, depth = 0) {
  const type = headerOf(section, "content-type") ?? "";
  const b = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(type);
  if (!b || depth > 6) return [section];
  return section.split(`--${b[1]}`).slice(1).flatMap((p) => (p.startsWith("--") ? [] : leaves(p.replace(/^\r?\n/, ""), depth + 1)));
}

function decodedBody(part) {
  const at = part.search(/\r?\n\r?\n/);
  if (at === -1) return "";
  const body = part.slice(at).replace(/^\r?\n\r?\n/, "");
  const enc = (headerOf(part, "content-transfer-encoding") ?? "").toLowerCase();
  return enc.includes("base64") ? decodeBase64Text(body) : enc.includes("quoted-printable") ? decodeQuotedPrintable(body) : body;
}

/**
 * EVERY VALUE OUT OF THE RAW MESSAGE: the literal text, and every encoded text part whose DECODED
 * body carries one (that part is re-emitted as 8bit with the value replaced). Nothing else changes.
 */
export function scrubSecretValues(raw, values, marker = SECRET_REDACTED) {
  const wanted = (values ?? []).filter((v) => typeof v === "string" && v.length >= 4);
  if (!wanted.length || !raw) return raw;
  const replaceAll = (text) => wanted.reduce((acc, v) => acc.split(v).join(marker), text);
  let out = replaceAll(String(raw));
  for (const part of leaves(out)) {
    const enc = (headerOf(part, "content-transfer-encoding") ?? "").toLowerCase();
    if (!enc.includes("base64") && !enc.includes("quoted-printable")) continue;
    const type = (headerOf(part, "content-type") ?? "text/plain").toLowerCase();
    if (!type.startsWith("text/")) continue;
    const decoded = decodedBody(part);
    if (!wanted.some((v) => decoded.includes(v))) continue;
    const split = part.search(/\r?\n\r?\n/);
    const headers = part.slice(0, split).replace(/^content-transfer-encoding:.*(?:\r?\n[ \t]+.*)*\r?\n?/gim, "").replace(/\r?\n$/, "");
    out = out.replace(part, `${headers}\r\nContent-Transfer-Encoding: 8bit\r\nX-Boss-OS-Scrubbed: secret redacted\r\n\r\n${replaceAll(decoded)}\r\n`);
  }
  return out;
}

/** True when any value is still readable in the message — plainly or in any decoded part. Used by the guard. */
export function carriesSecretValue(raw, values) {
  const wanted = (values ?? []).filter((v) => typeof v === "string" && v.length >= 4);
  if (!wanted.length || !raw) return false;
  if (wanted.some((v) => String(raw).includes(v))) return true;
  return leaves(String(raw)).some((p) => wanted.some((v) => decodedBody(p).includes(v)));
}

/** The one line her reply carries. Names only. */
export function secretDoorLine(stored, refused) {
  const parts = [];
  if (stored?.length) parts.push(`Stored ${stored.map((s) => `${s.name}${s.repo ? ` for ${s.repo}` : ""}`).join(", ")}; it is never shown again, and your Mac moves it into the vault on its next pass.`);
  if (refused?.length) parts.push(`Not stored: ${refused.map((r) => `${r.name} (${r.why})`).join("; ")}.`);
  return parts.join(" ") || "No secret was read.";
}
