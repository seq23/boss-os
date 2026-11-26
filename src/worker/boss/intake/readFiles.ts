/**
 * EVERY FILE SHE SENDS IS READ BEFORE SHE IS ANSWERED (15 Nov 2026, the West Peek OS #452/#453 rules
 * brought to Boss OS, copied and never imported: two companies).
 *
 * Boss OS read only her typed text and her voice notes. A deck, a spreadsheet, a ZIP of logos or a
 * Drive link (Gmail's own, for an attachment over 25 MB) reached nobody: the job was worked from the
 * words around it, and the reply said nothing about the files at all. Now, for each file:
 *
 *   · a recording is transcribed (Whisper, on the Worker's own binding, from the base64 TEXT the email
 *     already carries: nothing is decoded or turned into an object, which is what burned West Peek
 *     OS's CPU when a byte array was handed to the binding and JSON-serialised);
 *   · a ZIP is its files: unpacked with the platform's own inflate (zipEntries.ts), each one read
 *     the same way;
 *   · a PDF, Word or Excel file is turned into text by Workers AI's document conversion
 *     (`toMarkdown`, free for documents; pictures are never sent to it, because describing a picture
 *     uses a paid model);
 *   · a text file (txt, csv, html, ics…) is decoded;
 *   · a Drive or Docs link is read through the Drive access Boss OS already has (the Google service
 *     account, read-only, as her West Peek mailbox: the same access `scripts/ops/drive-pull.mjs`
 *     uses), a Doc/Sheet/Slides as text and any other file downloaded and read like an attachment;
 *   · anything else (a picture, a video, an encrypted ZIP) is NAMED with the reason in her Got it,
 *     never skipped in silence.
 *
 * WRITES NOTHING. Every result is returned; the caller files it. That is what lets the dry run use
 * exactly this reader. Never throws: a file that fails is in `unopened` with the reason.
 */
import type { Env } from "../env";
import { base64OfBytes, bytesOfBase64, fileAttachments, MAX_VOICE_NOTE_BYTES, type ParsedMail } from "../../effects/mimeAttachments";
import { transcribeChunk } from "../../ai/providers/workersAiWhisper";
import { unzipEntries, isZip, typeOfName } from "./zipEntries";
import { htmlToText } from "../../../shared/boss/intake/messageBody.mjs";
import { DEFAULT_MAILBOX } from "../../../shared/boss/commands/parse.mjs";

export interface FilesRead {
  /** Each recording's words, verbatim — joined to what she typed. */
  heard: Array<{ filename: string; text: string }>;
  /** Each document whose words were read, and the words (capped). */
  read: Array<{ filename: string; text: string }>;
  /** Each file that could not be opened, and why, in plain words. Named in the Got it. */
  unopened: Array<{ filename: string; reason: string; audio?: boolean }>;
  /** A ZIP and how many files it held: one line in the Got it, its files under it. */
  zips: Array<{ filename: string; files: number }>;
}

export const EMPTY_FILES: FilesRead = Object.freeze({ heard: [], read: [], unopened: [], zips: [] }) as unknown as FilesRead;

/** One document's words at most this long on the job; the whole file is still in the stored email. */
export const FILE_TEXT_MAX = 20_000;
/** All the documents' words together at most this long. */
export const FILES_TEXT_MAX = 80_000;
/** At most this many recordings are transcribed per email (each is a model call). */
export const MAX_RECORDINGS = 6;
/** At most this many Drive links are read per email. */
export const MAX_DRIVE_LINKS = 8;
/** A Drive file is downloaded up to this size, the same ceiling an attachment has. */
export const DRIVE_FILE_MAX_BYTES = 25 * 1024 * 1024;

const AUDIO_EXT = /\.(?:m4a|mp3|wav|aac|ogg|oga|opus|caf|amr|webm)$/i;
const TEXT_EXT = /\.(?:txt|csv|tsv|md|markdown|json|ics|vcf|eml|html?|xml|log|rtf)$/i;
/** What `toMarkdown` converts without a model: documents and spreadsheets, never pictures. */
const DOC_EXT = /\.(?:pdf|docx|xlsx|xlsm|xlsb|xls|et|ods|odt|numbers)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg)$/i;
const VIDEO_EXT = /\.(?:mov|mp4|m4v|avi|mkv)$/i;

type Ai = { run(model: string, inputs: Record<string, unknown>): Promise<unknown>; toMarkdown?: (files: Array<{ name: string; blob: Blob }>) => Promise<unknown> };

export interface ReadDeps {
  /** The Workers AI binding; tests pass a fake. Defaults to `env.AI`. */
  ai?: Ai | null;
  /** Google's endpoints; tests pass a fake. */
  fetchImpl?: typeof fetch;
}

interface OneFile { filename: string; mediaType: string; base64?: string; bytes?: Uint8Array; size: number }

function kindOf(f: { filename: string; mediaType: string }): "audio" | "zip" | "text" | "doc" | "image" | "video" | "other" {
  const t = f.mediaType.toLowerCase();
  const n = f.filename;
  if (t.startsWith("audio/") || AUDIO_EXT.test(n)) return "audio";
  if (isZip(n, t)) return "zip";
  if (DOC_EXT.test(n) || t === "application/pdf" || /officedocument|ms-excel|opendocument/.test(t)) return "doc";
  if (t.startsWith("text/") || TEXT_EXT.test(n) || t === "application/json" || t === "text/calendar") return "text";
  if (t.startsWith("image/") || IMAGE_EXT.test(n)) return "image";
  if (t.startsWith("video/") || VIDEO_EXT.test(n)) return "video";
  return "other";
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Read every file in a message, and every Drive link in her words. Never throws; writes nothing. */
export async function readEverything(env: Env, parsed: ParsedMail, words: string, deps: ReadDeps = {}): Promise<FilesRead> {
  const out: FilesRead = { heard: [], read: [], unopened: [], zips: [] };
  const ai = (deps.ai === undefined ? (env.AI as Ai | undefined) : deps.ai) ?? null;
  const budget = { text: FILES_TEXT_MAX, recordings: MAX_RECORDINGS };
  try {
    const { attachments, unread } = fileAttachments(parsed);
    for (const u of unread) out.unopened.push({ filename: u.replace(/\s*\(.*$/, ""), reason: u.replace(/^[^(]*\(|\)$/g, "") });
    for (const a of attachments) {
      await readOne(ai, { filename: a.filename, mediaType: a.mediaType, bytes: a.content, size: a.bytes }, out, budget, 0);
    }
  } catch (err) {
    out.unopened.push({ filename: "the attachments", reason: `they could not be read (${(err instanceof Error ? err.message : String(err)).slice(0, 160)})` });
  }
  await readDriveLinks(env, ai, driveIdsIn(words), out, budget, deps.fetchImpl ?? fetch);
  return out;
}

async function readOne(ai: Ai | null, f: OneFile, out: FilesRead, budget: { text: number; recordings: number }, depth: number): Promise<void> {
  const kind = kindOf(f);
  const bytesOf = () => f.bytes ?? bytesOfBase64(f.base64 ?? "");
  try {
    if (kind === "audio") {
      if (!ai) return void out.unopened.push({ filename: f.filename, reason: "the recording is kept with the original email", audio: true });
      if (f.size > MAX_VOICE_NOTE_BYTES) return void out.unopened.push({ filename: f.filename, reason: `${mb(f.size)} is over the ${mb(MAX_VOICE_NOTE_BYTES)} a recording can be heard at`, audio: true });
      if (budget.recordings <= 0) return void out.unopened.push({ filename: f.filename, reason: `only the first ${MAX_RECORDINGS} recordings of an email are heard`, audio: true });
      budget.recordings -= 1;
      const b64 = f.base64 ?? base64OfBytes(f.bytes!);
      const text = (await transcribeChunk(ai, b64)).text.trim();
      if (text) out.heard.push({ filename: f.filename, text });
      else out.unopened.push({ filename: f.filename, reason: "the transcriber heard no words in it", audio: true });
      return;
    }
    if (kind === "zip") {
      if (depth > 0) return void out.unopened.push({ filename: f.filename, reason: "a ZIP inside a ZIP is not unpacked" });
      const zip = await unzipEntries(bytesOf());
      out.zips.push({ filename: f.filename, files: zip.files.length });
      for (const s of zip.skipped) out.unopened.push({ filename: `${f.filename}: ${s.replace(/\s*\(.*$/, "")}`, reason: /\(([^)]*)\)/.exec(s)?.[1] ?? s });
      for (const e of zip.files) {
        const name = e.name.split("/").pop() || e.name;
        await readOne(ai, { filename: `${name} (in ${f.filename})`, mediaType: typeOfName(e.name), bytes: e.bytes, size: e.bytes.byteLength }, out, budget, depth + 1);
      }
      return;
    }
    if (kind === "text") {
      let text = new TextDecoder("utf-8").decode(bytesOf());
      if (/html?$/i.test(f.filename) || f.mediaType.includes("html")) text = htmlToText(text);
      return keepWords(out, budget, f.filename, text);
    }
    if (kind === "doc") {
      if (typeof ai?.toMarkdown !== "function") return void out.unopened.push({ filename: f.filename, reason: "the document reader is not connected on this Worker" });
      const res = await ai.toMarkdown([{ name: f.filename.replace(/ \(in .*\)$/, ""), blob: new Blob([bytesOf() as BlobPart], { type: f.mediaType }) }]);
      const first = (Array.isArray(res) ? res[0] : res) as { format?: string; data?: string; error?: string } | undefined;
      if (first?.format === "markdown" && first.data?.trim()) return keepWords(out, budget, f.filename, first.data);
      return void out.unopened.push({ filename: f.filename, reason: first?.error ? `the document reader could not read it (${String(first.error).slice(0, 120)})` : "it holds no text the document reader could find (a scan reads as a picture)" });
    }
    if (kind === "image") return void out.unopened.push({ filename: f.filename, reason: "a picture: it is kept with your email for the job, but nothing here looks at pictures" });
    if (kind === "video") return void out.unopened.push({ filename: f.filename, reason: "a video: it is kept with your email for the job, but nothing here watches video" });
    out.unopened.push({ filename: f.filename, reason: "a kind of file nothing here can open; it is kept with your email for the job" });
  } catch (err) {
    out.unopened.push({ filename: f.filename, reason: (err instanceof Error ? err.message : String(err)).slice(0, 200), ...(kind === "audio" ? { audio: true } : {}) });
  }
}

function keepWords(out: FilesRead, budget: { text: number }, filename: string, text: string): void {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return void out.unopened.push({ filename, reason: "it was empty" });
  if (budget.text <= 0) return void out.unopened.push({ filename, reason: "the email's other files already filled what one job can carry; it is kept with your email" });
  const cut = clean.slice(0, Math.min(FILE_TEXT_MAX, budget.text));
  budget.text -= cut.length;
  out.read.push({ filename, text: cut.length < clean.length ? `${cut}\n[…the rest is in the file]` : cut });
}

// ─── Drive links ────────────────────────────────────────────────────────────────────────────

/** Each Drive / Docs file id in her words (her own link, or the one Gmail writes for a file over 25 MB). Pure. */
export function driveIdsIn(text: string): string[] {
  const ids: string[] = [];
  const re = /https:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&(?:amp;)?)?id=|(?:document|spreadsheets|presentation|forms)\/d\/)([\w-]{20,})/g;
  for (const m of String(text ?? "").matchAll(re)) if (!ids.includes(m[1]!)) ids.push(m[1]!);
  return ids;
}

const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

const b64url = (data: Uint8Array | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return base64OfBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A drive.readonly token for her West Peek mailbox, from the service account the Worker already holds. */
export async function driveToken(env: Env, fetchImpl: typeof fetch): Promise<string> {
  const json = env.GSC_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("the Google service account is not on this Worker");
  const creds = JSON.parse(json) as { client_email: string; private_key: string };
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: DEFAULT_MAILBOX, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
  const der = bytesOfBase64(creds.private_key.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`)));
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }).toString(),
  });
  if (!res.ok) throw new Error(`Google refused the Drive sign-in (${res.status})`);
  const t = ((await res.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!t) throw new Error("Google's sign-in answer carried no token");
  return t;
}

export async function searchWorkspaceDrive(env: Env, title: string, pageToken?: string) {
  const literal = title.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const params = new URLSearchParams({
    q: `trashed = false and name contains '${literal}'`,
    corpora: "user", spaces: "drive",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    orderBy: "modifiedTime desc", pageSize: "15",
    fields: "files(id,name,mimeType,webViewLink),nextPageToken,incompleteSearch",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const token = await driveToken(env, fetch);
  const response = await fetch(`${DRIVE_FILES}?${params}`, {
    headers: { authorization: `Bearer ${token}` }, redirect: "manual",
  });
  if (!response.ok) throw new Error("Drive could not complete the search");
  const page = await response.json() as {
    files?: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }>;
    nextPageToken?: string;
    incompleteSearch?: boolean;
  };
  if (!page || !Array.isArray(page.files)) throw new Error("Drive did not return a file list");
  return { rows: page.files.slice(0, 15), nextPageToken: page.nextPageToken ?? null, incompleteSearch: page.incompleteSearch === true };
}

export async function readWorkspaceDriveFile(env: Env, id: string): Promise<FilesRead> {
  const out: FilesRead = { heard: [], read: [], unopened: [], zips: [] };
  await readDriveLinks(env, (env.AI as Ai | undefined) ?? null, [id], out, { text: FILE_TEXT_MAX, recordings: 0 }, fetch);
  return out;
}

async function driveBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Drive returned no file contents");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      size += part.value.byteLength;
      if (size > DRIVE_FILE_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`Drive returned more than ${mb(DRIVE_FILE_MAX_BYTES)}`);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readDriveLinks(env: Env, ai: Ai | null, ids: string[], out: FilesRead, budget: { text: number; recordings: number }, fetchImpl: typeof fetch): Promise<void> {
  if (!ids.length) return;
  for (const id of ids.slice(MAX_DRIVE_LINKS)) out.unopened.push({ filename: `a Drive link (${id.slice(0, 8)}…)`, reason: `only the first ${MAX_DRIVE_LINKS} Drive links of an email are read` });
  let token: string;
  try {
    token = await driveToken(env, fetchImpl);
  } catch (err) {
    for (const id of ids.slice(0, MAX_DRIVE_LINKS)) out.unopened.push({ filename: `a Drive link (${id.slice(0, 8)}…)`, reason: `Drive could not be reached (${(err instanceof Error ? err.message : String(err)).slice(0, 120)})` });
    return;
  }
  const auth = { headers: { authorization: `Bearer ${token}` }, redirect: "manual" as const };
  for (const id of ids.slice(0, MAX_DRIVE_LINKS)) {
    let name = `a Drive link (${id.slice(0, 8)}…)`;
    try {
      const url = `${DRIVE_FILES}/${encodeURIComponent(id)}`;
      const meta = await fetchImpl(`${url}?fields=id,name,mimeType,size&supportsAllDrives=true`, auth);
      if (!meta.ok) throw new Error(meta.status === 404 || meta.status === 403 ? "it is not shared with Boss OS (share it with your West Peek address, or attach it)" : `Google answered ${meta.status}`);
      const m = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
      name = m.name || name;
      const mime = m.mimeType ?? "";
      const exportAs = EXPORTS[mime];
      if (exportAs) {
        const res = await fetchImpl(`${url}/export?mimeType=${encodeURIComponent(exportAs)}`, auth);
        if (!res.ok) throw new Error(`Google would not export it (${res.status})`);
        keepWords(out, budget, name, new TextDecoder().decode(await driveBytes(res)));
        continue;
      }
      if (mime.startsWith("application/vnd.google-apps.")) throw new Error("a kind of Google file that has no text to read");
      const size = Number(m.size ?? 0);
      if (!size || size > DRIVE_FILE_MAX_BYTES) throw new Error(size ? `${mb(size)} is over the ${mb(DRIVE_FILE_MAX_BYTES)} a linked file is read at` : "Drive did not say how big it is");
      const res = await fetchImpl(`${url}?alt=media&supportsAllDrives=true`, auth);
      if (!res.ok) throw new Error(`Google would not hand over the file (${res.status})`);
      const bytes = await driveBytes(res);
      await readOne(ai, { filename: name, mediaType: mime || typeOfName(name), bytes, size: bytes.byteLength }, out, budget, 0);
    } catch (err) {
      out.unopened.push({ filename: name, reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
  }
}
