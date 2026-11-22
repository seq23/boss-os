/**
 * A DRY READ OF A STORED EMAIL (15 Nov 2026, the West Peek OS #452 dry run brought to Boss OS).
 *
 * The mailbox's own readers, run over a message that is already kept (by its `boss_inbound_mail` id,
 * or a raw message posted to it): her words, every file, every voice note, every Drive link, who would
 * get the work, and the Got it she would be sent, laid out exactly as it would go. RETURNED AND NOT
 * APPLIED. It writes nothing and sends nothing: no arrival row, no task, no notice, no mail ref, no
 * quota claim, no email. Only reads: D1 (the roster), R2 (the stored email), and the read-only calls
 * readFiles.ts makes (transcription, document text, Drive).
 */
import type { Env } from "../env";
import { activeRoster } from "./inboundMail";
import { readEverything } from "./readFiles";
import { asksIn, gotItLines } from "./gotIt";
import { firstRead, unclearLines } from "./firstRead";
import { layReply } from "./mailRefs";
import { triageReply } from "./inboundMail";
import { unheardLines, withVoiceNotes } from "./voiceNotes";
import { taskBodyFrom, ownWords } from "../../../shared/boss/intake/messageBody.mjs";
import { parseMail } from "../../../shared/mail/parseMail.mjs";
import { decodeMimeHeader, replyBody, routeToSeat } from "../../../shared/boss/intake/mail.mjs";
import { triage } from "../../../shared/boss/intake/triage.mjs";

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
  reply_text: string;
  got_it: { subject: string; text: string };
}

export async function dryReadMessage(env: Env, raw: string, opts: { rung?: string | null } = {}): Promise<DryRead> {
  const headers = headersOfRaw(raw);
  const subject = decodeMimeHeader(headers.get("subject") ?? "");
  const to = (headers.get("to") ?? "").toLowerCase();
  const parsed = await parseMail(raw);
  const read = await taskBodyFrom(parsed);
  const files = await readEverything(env, parsed, read.readable ?? "");
  const own = withVoiceNotes(ownWords(read.readable ?? ""), files.heard);
  const roster = await activeRoster(env);
  const route = routeToSeat(`${subject}\n${own}`, roster, to);
  // The first read, dry: the free ladder is walked, but no Workers AI slot is claimed and nothing is logged.
  const fileNames = [...files.heard.map((h) => h.filename), ...files.read.map((r) => r.filename), ...files.unopened.map((u) => u.filename)];
  const first = own.trim() ? await firstRead(env, { subject, words: own, files: fileNames, dry: true, onlyRung: opts.rung ?? null }) : null;
  const brief = first?.brief ?? null;
  const asks = brief?.asks.length ? brief.asks : asksIn(own);
  let head: string;
  let seats: string[];
  if (route && route.outcome === "DEFAULTED") {
    const jobs = triage({ subject, text: own || subject, roster, asks: brief?.asks ?? null });
    seats = jobs.map((j: { seat: { name: string } }) => j.seat.name);
    head = jobs.length
      ? triageReply(jobs.map((job: any) => ({ job, taskId: "would_start", failure: null })), { tags: route.unknownTags, roster })
      : replyBody(route, roster, subject);
  } else {
    seats = route ? [route.seat.name] : [];
    head = route ? replyBody(route, roster, subject) : "No seat could be read.";
  }
  const unheard = unheardLines(files.unopened.filter((u) => u.audio).map((u) => ({ filename: u.filename, reason: u.reason })));
  const lines = gotItLines({ asks, files, holds: brief?.holds, questions: brief?.questions, unclear: unclearLines(brief?.unclear ?? []) });
  const replyText = [head, ...(lines.length ? ["", ...lines] : []), ...(unheard.length ? ["", ...unheard] : [])].join("\n");
  const replySubject = `Re: ${subject || "your message"}`.replace(/\s+/g, " ").trim().slice(0, 200);
  const laid = layReply({ text: replyText, subject: replySubject, signer: "Simone" });
  return {
    dry_run: true,
    bytes: new TextEncoder().encode(raw).byteLength,
    subject,
    to: to || null,
    would_route_to: seats,
    typed_chars: own.length,
    asks,
    first_read: first ? { reader: first.reader, stop: first.stop, tried: first.tried, holds: brief?.holds.length ?? 0, questions: brief?.questions.length ?? 0, unclear: brief?.unclear.length ?? 0, unclear_items: (brief?.unclear ?? []).map((u) => ({ words: u.words, missing: u.missing })) } : null,
    files: {
      heard: files.heard.map((h) => h.filename),
      read: files.read.map((r) => r.filename),
      zips: files.zips,
      unopened: files.unopened.map((u) => ({ filename: u.filename, reason: u.reason })),
    },
    reply_text: replyText,
    got_it: { subject: replySubject, text: laid.text },
  };
}
