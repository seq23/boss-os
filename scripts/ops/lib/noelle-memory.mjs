import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const day = /\b\d{4}-\d{2}-\d{2}\b/;
export const clip = (s, chars) => String(s ?? "").slice(0, chars);
export const fingerprint = (text) => createHash("sha256").update(text).digest("hex");

function memoryFile(file, required = false) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error("expected a regular, unlinked file");
    const text = readFileSync(file, "utf8");
    if (required && !text.trim()) throw new Error("file is empty");
    return { text, modified: info.mtime.toISOString().slice(0, 10) };
  } catch (e) {
    if (!required && e?.code === "ENOENT") return { text: "", modified: "" };
    throw e;
  }
}

export function latestNote(home) {
  const dir = join(home, "notes");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
    .map((entry) => entry.name).sort();
  return names.at(-1) ?? null;
}

/** The launcher reads the owner file before any other growth context. */
export function wakeMemory(home, { call = false } = {}) {
  let owner;
  try { owner = memoryFile(join(home, "owner-notes.md"), true); }
  catch { throw new Error("NAMED STOP [OWNER_NOTES_UNREAD] ~/Work/noelle/owner-notes.md must be readable before the run starts"); }
  const handoff = memoryFile(join(home, "HANDOFF.md")).text;
  const newest = call ? null : latestNote(home);
  const note = newest ? memoryFile(join(home, "notes", newest)).text : "";
  return {
    owner: owner.text,
    through: owner.text.match(day)?.[0] ?? owner.modified,
    handoff: clip(handoff, 8_000),
    before: fingerprint(handoff),
    newest,
    note: clip(note, 2_500),
  };
}

export function handoffStop(home, start, run) {
  if (!start?.through || !run || !start?.before) return "OWNER_NOTES_UNREAD";
  try {
    const { text } = memoryFile(join(home, "HANDOFF.md"), true);
    const lines = text.split(/\r?\n/);
    if (text.length <= 8_000 && start.before !== fingerprint(text)
      && lines.includes(`Run: ${run}`) && lines.includes(`owner-notes read through ${start.through}`)) return null;
  } catch { /* A missing or unreadable handoff is a stop. */ }
  return "HANDOFF_NOT_WRITTEN";
}
