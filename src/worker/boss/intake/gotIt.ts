/**
 * THE GOT IT SAYS WHAT WAS READ (15 Nov 2026, the West Peek OS #453/#459 rule brought to Boss OS).
 *
 * Her reply used to say who had the work and nothing about what was understood, so a request half
 * read (a deck nobody opened, a voice note that could not be heard) was acknowledged exactly like one
 * read in full. The reply now goes only after everything was read (readFiles.ts runs first), and it
 * carries: each thing she asked, in HER words; the files that were read; and every file that could
 * not be opened, by name, with why. Pure: no model, no database.
 */
import type { FilesRead } from "./readFiles";

/** At most this many asks are listed; the rest are still on the job. */
export const MAX_ASKS = 12;

/** A line a mail client wrapped mid-sentence is joined back, so "Attached is" never stands alone. */
function unwrapped(words: string): string {
  return words
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((para) => para.split("\n").reduce((acc, line) => {
      if (!acc) return line;
      const prev = acc.slice(acc.lastIndexOf("\n") + 1);
      const newItem = /^\s*(?:\d+[.)]|[-*•])\s+/.test(line) || (/^\s*(?:\d+[.)]|[-*•])\s+/.test(prev) && /^\s*[A-Z"“(]/.test(line) && /[.!?:)"”]\s*$|^\s*[-*•]/.test(prev));
      return newItem ? `${acc}\n${line}` : `${acc} ${line.trim()}`;
    }, ""))
    .join("\n\n");
}

/** A remark on how something IS (a greeting, praise, thanks), not something she asked for. */
const REMARK = /^(?:hi|hey|hello|thanks|thank you|cheers|best|regards|xo)\b[^a-z]*\w*[,!.:]?$|\b(?:looks? (?:good|great)|love (?:it|this|the)|nice work|great work|well done|thank you|thanks)\b/i;
/** Too short to stand as an ask: a fragment of a sentence. */
const isFragment = (s: string): boolean => s.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length < 3 || /[:,;–—-]$/.test(s.trim());
/** Her tags and a voice-note label are not asks. */
const NOT_AN_ASK = /^(?:#[\w-]+\s*)+$|^Voice note \(/i;

/** Her sentences, as written: the asks when no model has read the email. Whole sentences, never fragments. Pure. */
export function asksIn(words: string): string[] {
  return unwrapped(String(words ?? ""))
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/^[\s\-–—•*]+|\s+$/g, "").replace(/^\d+[.)]\s+/, "").replace(/^(?:#[\w-]+\s+)+/, "").replace(/\s+/g, " "))
    .filter((s) => /[a-z]{2}/i.test(s) && !isFragment(s) && !REMARK.test(s) && !NOT_AN_ASK.test(s))
    .slice(0, MAX_ASKS);
}

/**
 * A file's name as it can travel in her email. The owner layout takes ids and code-file names out of
 * every line (plain.mjs `simplifyForOwner`), so "IMG_0001.jpg" would arrive as ".jpg" and "notes.md"
 * as "a file": the underscore becomes a space and a code-file ending is said in words. Pure.
 */
export function fileLabel(name: string): string {
  return String(name ?? "")
    .replace(/_/g, " ")
    .replace(/\.(m?js|tsx?|json|md|sql|sh|py|toml|ya?ml|plist|log)\b/gi, (_m, ext: string) => ` (${ext.toLowerCase()} file)`)
    .trim();
}

/**
 * The Got it's own lines, under the handoff. `asks` are hers (asksIn, or a first read's verified
 * asks); `files` is what readFiles.ts returned. Recordings that could not be heard are left out of
 * "could not open" because their own stop line already names them (voiceNotes.ts unheardLines).
 */
export function gotItLines(input: { asks: readonly string[]; files: FilesRead; holds?: readonly string[] }): string[] {
  const lines: string[] = [];
  if (input.asks.length) {
    lines.push(`What you asked, in your words (${input.asks.length === 1 ? "one thing" : `${input.asks.length} things`}):`);
    input.asks.forEach((a, i) => lines.push(`  ${i + 1}. "${a}"`));
  }
  if (input.holds?.length) {
    lines.push("", "What you said must wait:");
    for (const h of input.holds) lines.push(`  "${h}"`);
  }
  const inZip = (n: string) => / \(in [^)]+\)$/.test(n);
  const read = [
    ...input.files.heard.filter((h) => !inZip(h.filename)).map((h) => `${fileLabel(h.filename)} (your voice note)`),
    ...input.files.read.filter((r) => !inZip(r.filename)).map((r) => fileLabel(r.filename)),
    ...input.files.zips.map((z) => `${fileLabel(z.filename)} (${z.files === 1 ? "1 file" : `${z.files} files`} inside)`),
  ];
  if (read.length) lines.push("", `What I read: ${read.join(", ")}.`);
  const unopened = input.files.unopened.filter((u) => !u.audio);
  if (unopened.length) {
    lines.push("", `What I could not open (${unopened.length}):`);
    for (const u of unopened.slice(0, 15)) lines.push(`  ${fileLabel(u.filename)}: ${u.reason}.`.replace(/\.\.$/, "."));
    if (unopened.length > 15) lines.push(`  …and ${unopened.length - 15} more, listed on the job.`);
  }
  return lines;
}

/** The files' words for the job's body, each under its name. Pure. */
export function filesForTask(files: FilesRead): string {
  const parts = files.read.map((r) => `Attached file "${r.filename}", its text:\n${r.text}`);
  const not = files.unopened.filter((u) => !u.audio).map((u) => `- ${u.filename}: ${u.reason}`);
  return [...parts, ...(not.length ? [`Files that could not be opened (named in her Got it):\n${not.join("\n")}`] : [])].join("\n\n");
}
