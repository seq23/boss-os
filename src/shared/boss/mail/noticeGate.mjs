/**
 * ONE GATE: EMAIL ONLY WHEN SHE MUST ACT (owner, 7 Nov 2026: "either consolidate the emails or make
 * those notifications on some page inside boss os only").
 *
 * Her inbox, 5 to 7 Nov: fifteen "Reminder: …" emails from Simone in one minute, five Kendra "Done"
 * emails about her own alarms, a daily "Mac disk" email. Each one said "Nothing to decide — this is
 * just so you know." Ruling: an email goes only when she must decide, reply or clear something only
 * she holds. Everything else is a row on the Updates page (☰ More → Updates), and the morning email
 * carries ONE count line for it.
 *
 * The decision is a FIELD on the notice (`boss_task_notices.needs_her`, migration 0353), set where the
 * notice is written, from its kind and who asked — never from its words. The drain on her Mac
 * (scripts/ops/task-notices.mjs `sendNotice`) reads that field and nothing else: needs_her = 0 never
 * reaches the mail sender. Guard: tests/noticeGate.test.ts.
 */

/** Kinds that always need her: a decision, a reply, a key or a folder only she can give. */
export const EMAIL_KINDS = Object.freeze(["stopped", "could_not_do", "missing_secret", "drive_empty"]);
/** Kinds that never need her: told on the Updates page and counted in the morning email. */
export const PAGE_KINDS = Object.freeze(["open_loop_reminder", "update"]);

/**
 * Does this notice need her? Pure.
 *   · stopped / could_not_do / missing_secret / drive_empty → yes (she alone can act);
 *   · "done#<n>" → yes for work she asked for, however she asked (owner, 7 Nov 2026: research she
 *     requested, a prep she asked for, a reply to her email are not noise); work a duty or an alarm
 *     started by itself (`systemStarted`) is told on the page;
 *   · "stop:<CODE>" (paused until a seat is back) → only for work she asked for; reminders, updates → no;
 *   · any notice about a repair Boss OS opened itself → no, unless it needs a key only she holds;
 *   · any kind not named here → yes: an unknown kind fails toward telling her, never toward silence.
 */
export function needsHer({ kind, systemStarted = false, repair = false } = {}) {
  const k = String(kind ?? "");
  // REPAIRS NEVER WAIT ON HER (owner, 7 Nov 2026: Kendra's reports "should not need my constant
  // approval"). A repair Boss OS opened itself that stops, could not finish or proposes a fix goes back
  // to the team's rework, never to her inbox. Only a key or account she alone holds is hers.
  if (repair) return k === "missing_secret";
  if (EMAIL_KINDS.includes(k)) return true;
  // Work SHE asked for (by email, on a screen, or through Claude) is never noise: its answer is emailed.
  if (/^done(#|$)/.test(k)) return !systemStarted;
  if (k.startsWith("stop:")) return !systemStarted;
  if (PAGE_KINDS.includes(k)) return false;
  return true;
}

/** The drain's reading of a row: only an explicit 0 / false keeps it off email. Pure. */
export function emailsHer(notice) {
  const v = notice?.needs_her;
  return !(v === 0 || v === false || v === "0");
}

/** How many days of updates the page shows and the morning email counts. */
export const UPDATES_DAYS = 7;
export const UPDATES_PATH = "/?tab=updates";

/** The one count, from the rows the page shows: unread reminders and unread other updates. Pure. */
export function updatesSummary(rows) {
  let reminders = 0;
  let updates = 0;
  for (const r of rows ?? []) {
    if (r.read_at != null) continue;
    if (r.kind === "open_loop_reminder") reminders += 1;
    else updates += 1;
  }
  return { updates, reminders, unread: updates + reminders };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The one line, the same on the page and in the morning email; null when nothing is unread. Pure. */
export function updatesLine(summary) {
  const s = summary ?? { updates: 0, reminders: 0 };
  const bits = [];
  if (s.updates) bits.push(plural(s.updates, "update"));
  if (s.reminders) bits.push(plural(s.reminders, "reminder"));
  if (!bits.length) return null;
  return `${bits.join(", ")} on your Updates page, all just so you know.`;
}

/** The row's "Open ›": the loop, the research page, the task, or Systems. Pure. */
export function updateLink(row) {
  const id = String(row?.task_id ?? "");
  if (row?.kind === "open_loop_reminder") return `/?tab=loops&loop=${encodeURIComponent(id)}`;
  const page = /\/research\/(rpg_[A-Za-z0-9_-]{3,60})\b/.exec(String(row?.body ?? ""))?.[1];
  if (page) return `/research/${page}`;
  if (/^tsk_[a-z0-9]+$/.test(id)) return `/?task=${id}`;
  return "/?tab=systems";
}

/** A row as the page shows it: a title with no job code, and one grey sub line. Pure. */
export function updateRow(row) {
  const title = String(row?.subject ?? "").replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, "").trim();
  const first = String(row?.body ?? "").split("\n").map((l) => l.trim()).find((l) => l && !/^Reply to this email/.test(l)) ?? "";
  const line = first.replace(/^What is waiting:\s*/, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return {
    id: String(row?.id ?? ""), kind: String(row?.kind ?? ""), from: String(row?.from_name ?? ""),
    title, line: line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line,
    at: Number(row?.created_at ?? 0), read_at: row?.read_at == null ? null : Number(row.read_at), link: updateLink(row),
  };
}
