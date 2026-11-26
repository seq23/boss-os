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

/** Match Claude's completed reads to references in the review. Tool output is evidence only. */
function reviewEvidence(transcript, tool) {
  const pending = new Map();
  const sources = new Set();
  const items = new Set();
  for (const line of transcript.split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const content = record?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (entry?.type === "tool_use") pending.set(entry.id, entry);
      if (entry?.type !== "tool_result" || entry.is_error) continue;
      const use = pending.get(entry.tool_use_id);
      const output = typeof entry.content === "string" ? entry.content : Array.isArray(entry.content)
        ? entry.content.map((block) => block?.text ?? "").join("\n") : "";
      if (use?.name === "WebFetch" && output.trim() && URL.canParse(use.input?.url) && new URL(use.input.url).protocol === "https:") {
        sources.add(use.input.url);
      }
      if (use?.name !== "Bash") continue;
      const [command, verb, business, arg, extra] = String(use.input?.command ?? "").trim().split(/\s+/);
      if (command !== tool || extra || !business || !arg || !["post-results", "search-console"].includes(verb)) continue;
      const [opening, json, closing, receipt] = output.trim().split("\n");
      if (opening !== `<untrusted source="${verb}">` || closing !== "</untrusted>" || !receipt?.startsWith("OUTPUT ")) continue;
      let data;
      try { data = JSON.parse(json); } catch { continue; }
      if (data?.business !== business) continue;
      if (verb === "post-results" && data.id === arg && Object.values(data.metrics ?? {}).some(Number.isFinite)) {
        items.add(`${business}:${arg}`);
      }
      if (verb === "search-console" && data.domain === arg && Array.isArray(data.rows)) {
        for (const row of data.rows) if (row.page && Number.isFinite(row.clicks)) items.add(`${business}:${row.page}`);
      }
    }
  }
  return { sources, items };
}

/** The model judges the bets. The launcher checks their dated source and item receipts before recording completion. */
export function monthlyReview(dir, plan, runId, transcriptFile, tool) {
  let report, evidence;
  try {
    report = JSON.parse(memoryFile(join(dir, "monthly-review.json"), true).text);
    evidence = reviewEvidence(readFileSync(transcriptFile, "utf8"), tool);
  } catch { return { why: "the review file or the tool transcript couldn’t be read" }; }
  if (report?.run !== runId) return { why: "the review must identify this run" };
  const outcomes = {};
  let reviewed = 0;
  for (const business of plan.businesses) {
    const entry = report.businesses?.[business];
    if (!Array.isArray(entry?.sources) || !entry.sources.length
      || !entry.sources.every((source) => source?.readOn === plan.day && evidence.sources.has(source.url))) {
      return { why: `${business} needs a source fetched and dated on this run` };
    }
    if (!Array.isArray(entry.bets)) return { why: `${business} needs its reviewed bets (or an empty list when none are live)` };
    const ids = new Set();
    const results = [];
    for (const bet of entry.bets) {
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(bet?.id ?? "") || ids.has(bet.id)
        || typeof bet.stopRule !== "string" || !bet.stopRule.trim() || !["keep", "double", "stop"].includes(bet.decision)) {
        return { why: `${business} has a bet without a unique ID, stop rule or decision` };
      }
      if (!Array.isArray(bet.items) || !bet.items.length || !bet.items.every((item) => typeof item === "string" && evidence.items.has(`${business}:${item}`))) {
        return { why: `${business}/${bet.id} needs a per-post or per-page result read on this run` };
      }
      ids.add(bet.id);
      const sales = Number.isSafeInteger(bet.sales) && bet.sales >= 0 ? bet.sales : null;
      results.push({ id: bet.id, decision: bet.decision, sales });
    }
    reviewed += results.length;
    // Client results stay in each client's playbook. The owner's rollup carries only her own businesses.
    if (business !== "hicks" && business !== "horse") outcomes[business] = results;
  }
  return reviewed ? { month: plan.day.slice(0, 7), reviewed, outcomes } : { why: "no bet was reviewed" };
}
