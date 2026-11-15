/**
 * A VOICE NOTE IS HER WORDS (15 Nov 2026, the West Peek OS #443 rule brought to Boss OS).
 *
 * An email to Boss OS with a recording attached ("New Recording 4.m4a") was read for its typed text
 * only: the recording was skipped without a word, and the job was worked from whatever she typed
 * around it, or from nothing. Each recording is now transcribed on the Worker's own Workers AI
 * binding (Whisper; the audio never leaves Cloudflare, no key, no egress) and its words join her own.
 * One that cannot be heard (no binding, the model refused, too big) is a NAMED STOP said in the reply
 * and on the job: never silence.
 */
import type { Env } from "../env";
import { audioAttachments } from "../../effects/mimeAttachments";
import { transcribeChunk } from "../../ai/providers/workersAiWhisper";

export const VOICE_NOTE_STOP = "VOICE_NOTE_NOT_TRANSCRIBED";

export interface VoiceNotes {
  heard: Array<{ filename: string; text: string }>;
  failed: Array<{ filename: string; reason: string }>;
}

/** Every recording attached to the message. Never throws: a failure is in `failed`. */
export async function hearVoiceNotes(env: Env, raw: string): Promise<VoiceNotes> {
  const { attachments, unread } = audioAttachments(raw);
  const out: VoiceNotes = { heard: [], failed: unread.map((u) => ({ filename: u.replace(/\s*\(.*$/, ""), reason: u.replace(/^[^(]*\(|\)$/g, "") })) };
  for (const a of attachments) {
    try {
      const text = (await transcribeChunk(env.AI, a.dataBase64)).text.trim();
      if (text) out.heard.push({ filename: a.filename, text });
      else out.failed.push({ filename: a.filename, reason: "the transcriber heard no words in it" });
    } catch (err) {
      out.failed.push({ filename: a.filename, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  }
  return out;
}

/** Her typed words, then each recording's words, labelled. Pure. */
export function withVoiceNotes(written: string, heard: VoiceNotes["heard"]): string {
  if (!heard.length) return written;
  return [written.trim(), ...heard.map((h) => `Voice note (${h.filename}), her words transcribed:\n${h.text}`)].filter(Boolean).join("\n\n");
}

/** The named stop for each recording that could not be heard, one line each. Pure. */
export function unheardLines(failed: VoiceNotes["failed"]): string[] {
  return failed.map((f) => `NAMED STOP [${VOICE_NOTE_STOP}] Your voice note ${f.filename} could not be transcribed (${f.reason}), so its words are not in the work. Type what it said in a reply and it goes to the same job.`);
}
