/** Inspect intake mail and its attachments without queuing work or rendering a reply. */
import type { Env } from "../env";
import { SIMONE } from "../agents/simone";
import { activeRoster } from "./inboundMail";
import { readEverything } from "./readFiles";
import { asksIn } from "./gotIt";
import { firstRead } from "./firstRead";
import { withVoiceNotes } from "./voiceNotes";
import { taskBodyFrom, herWords } from "../../../shared/boss/intake/messageBody.mjs";
import { parseMail, decodeHeader } from "../../../shared/mail/parseMail.mjs";

/** The header block of a raw message, as Headers. Pure. */
export function headersOfRaw(raw: string): Headers {
  const end = raw.search(/\r?\n\r?\n/);
  const block = (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const h = new Headers();
  for (const line of block.split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) {
      try { h.append(m[1]!, m[2]!); } catch { /* a header Headers refuses is not one routing reads */ }
    }
  }
  return h;
}

export interface DryRead {
  dry_run: true;
  bytes: number;
  subject: string;
  to: string | null;
  would_route_to: string[];
  typed_chars: number;
  asks: string[];
  first_read: { reader: string | null; stop: string | null; tried: string[]; holds: number; questions: number; unclear: number; unclear_items: Array<{ words: string; missing: string }> } | null;
  files: { heard: string[]; read: string[]; zips: Array<{ filename: string; files: number }>; unopened: Array<{ filename: string; reason: string }> };
}

export async function dryReadMessage(env: Env, raw: string, opts: { rung?: string | null } = {}): Promise<DryRead> {
  const headers = headersOfRaw(raw);
  const subject = decodeHeader(headers.get("subject") ?? "");
  const to = (headers.get("to") ?? "").toLowerCase();
  const parsed = await parseMail(raw);
  const read = await taskBodyFrom(parsed);
  const files = await readEverything(env, parsed, read.readable ?? "");
  const own = withVoiceNotes(herWords(read.readable ?? ""), files.heard);
  const roster = await activeRoster(env);
  const simone = roster.find((seat) => seat.id === SIMONE);
  // The first read, dry: the free ladder is walked, but no Workers AI slot is claimed and nothing is logged.
  const fileNames = [...files.heard.map((h) => h.filename), ...files.read.map((r) => r.filename), ...files.unopened.map((u) => u.filename)];
  const first = own.trim() ? await firstRead(env, { subject, words: own, files: fileNames, dry: true, onlyRung: opts.rung ?? null }) : null;
  const brief = first?.brief ?? null;
  const asks = brief?.asks.length ? brief.asks : asksIn(own);
  return {
    dry_run: true,
    bytes: new TextEncoder().encode(raw).byteLength,
    subject,
    to: to || null,
    would_route_to: simone ? [simone.name] : [],
    typed_chars: own.length,
    asks,
    first_read: first ? { reader: first.reader, stop: first.stop, tried: first.tried, holds: brief?.holds.length ?? 0, questions: brief?.questions.length ?? 0, unclear: brief?.unclear.length ?? 0, unclear_items: (brief?.unclear ?? []).map((u) => ({ words: u.words, missing: u.missing })) } : null,
    files: {
      heard: files.heard.map((h) => h.filename),
      read: files.read.map((r) => r.filename),
      zips: files.zips,
      unopened: files.unopened.map((u) => ({ filename: u.filename, reason: u.reason })),
    },
  };
}
