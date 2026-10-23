/**
 * THE OWNER EDITS HER EMPLOYEES' DUTIES ON THE SITE (Builder U, 23 Oct 2026, boards 7 + 8).
 *
 * "i should be able to use the UI to make any needed changes." This module is the pure half: which
 * duties carry written instructions and where the repo keeps them, the schedule choices in plain
 * words, which of those a Mac duty's launchd tick can honour, and the decision duty-run.sh makes
 * from /api/duties/brief before a Mac job runs. The Worker half is src/worker/boss/duties/ownerEdits.ts.
 *
 * A SETTING NO CODE READS IS A DEFECT. Every field the page saves is read by a job:
 *   - owner_prompt  → materialiseDueDuties (Worker duties: the task's prompt) and duty-run.sh
 *                     (Mac duties: BOSS_DUTY_PROMPT_FILE, which each prompt-file script reads first).
 *   - schedule      → standing_duties' cadence columns and next_due_at, read by the cron, by /due and
 *                     by /brief (a Mac duty she rescheduled runs only on the days she chose).
 *   - paused        → standing_duties.suspended, refused by the cron, by /due and by /brief.
 * A Mac duty with no prompt (fixed steps in code) shows no instructions box: there is nothing to
 * read one. Its "ask for a change" goes to Danielle as a task instead.
 */

/** Mac duties whose script reads a prompt file, and that file. The script honours BOSS_DUTY_PROMPT_FILE first. */
export const DUTY_PROMPT_FILES = Object.freeze({
  duty_inbound_supply: "scripts/ops/interest-extract-prompt.md",
  duty_mailbox_sweep: "scripts/ops/mailbox-sweep-prompt.md",
  duty_site_audit_repair: "scripts/ops/ahrefs-audit-fix-prompt.md",
  duty_kdp_surface: "scripts/ops/kdp-surface-prompt.md",
});

export const DAY_NAMES = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const WEEKDAYS = [1, 2, 3, 4, 5];

/** The schedule choices, in her words. Keys: daily | weekdays | weekly:N | monthly. */
export function allChoices() {
  return [
    { key: "daily", label: "Every day" },
    { key: "weekdays", label: "Weekdays (Monday to Friday)" },
    ...DAY_NAMES.map((d, i) => ({ key: `weekly:${i}`, label: `Every ${d}` })),
    { key: "monthly", label: "Once a month (on the 1st)" },
  ];
}

function parseDays(weekdays) {
  if (Array.isArray(weekdays)) return weekdays;
  try { const v = JSON.parse(weekdays ?? "null"); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** The choice key a duty row's schedule is on now. A day set that is not a named choice reads as "custom". */
export function choiceOf(row) {
  if (row.cadence === "monthly") return "monthly";
  if (row.cadence === "weekly") return `weekly:${row.weekday ?? 1}`;
  const days = parseDays(row.weekdays);
  if (days.length === 0 || days.length === 7) return "daily";
  if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return "weekdays";
  if (days.length === 1) return `weekly:${days[0]}`;
  return "custom";
}

/** A choice key → the cadence columns. Null for a key that is not one of the choices. */
export function scheduleFromChoice(key) {
  if (key === "daily") return { cadence: "daily", weekday: null, weekdays: null };
  if (key === "weekdays") return { cadence: "daily", weekday: null, weekdays: JSON.stringify(WEEKDAYS) };
  if (key === "monthly") return { cadence: "monthly", weekday: null, weekdays: null };
  const m = /^weekly:([0-6])$/.exec(String(key));
  if (m) return { cadence: "weekly", weekday: Number(m[1]), weekdays: null };
  return null;
}

const hhmm = (h, m) => {
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${am ? "am" : "pm"}`;
};

/** "Every Monday at 7:15 am" — the line under each duty. */
export function scheduleWords(row) {
  const key = choiceOf(row);
  const days = parseDays(row.weekdays);
  const label = key === "custom"
    ? `Every ${days.map((d) => DAY_NAMES[d]).join(", ")}`
    : allChoices().find((c) => c.key === key)?.label ?? key;
  return `${label} at ${hhmm(row.local_hour ?? 0, row.local_minute ?? 0)}`;
}

/**
 * The choices a duty can actually be given. A Worker duty can take any of them (the cron ticks
 * hourly). A Mac duty runs when its launchd entry fires, so it can only be narrowed to days that
 * tick reaches: a daily tick takes any choice; a weekly or monthly tick keeps its own day.
 */
export function choicesFor(duty) {
  if (duty.executor !== "local_job") return allChoices();
  const tick = duty.mac_tick ?? duty.cadence;
  if (tick === "daily") return allChoices();
  const own = tick === "monthly" ? "monthly" : `weekly:${duty.weekday ?? 1}`;
  return allChoices().filter((c) => c.key === own);
}

/** May her time of day be changed? Only where something ticks often enough to honour it. */
export function timeEditable(duty) {
  return duty.executor !== "local_job";
}

/** The civil date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(timeZone, at) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Is a Mac duty she rescheduled due on this tick? By DAY, not by minute: the launchd entry fires at
 * its own fixed time, which need not equal the duty row's minute, so comparing instants would skip
 * a run whenever the plist fires a few minutes before the row's time. Due = today's date has reached
 * the date of next_due_at.
 */
export function macDueToday({ next_due_at, timezone }, now) {
  if (next_due_at === null || next_due_at === undefined) return true;
  return localDate(timezone, now) >= localDate(timezone, next_due_at);
}

/**
 * What duty-run.sh does with a brief. Exit 0 = run it; 10 = skip, deliberately and named.
 *   paused or removed               → skip [PAUSED]
 *   she rescheduled it, or the plist
 *   asked --only-if-due, and not due → skip [NOT_DUE]
 *   otherwise                        → run, with her instructions if she wrote any.
 */
export function briefDecision(brief, { onlyIfDue = false } = {}) {
  if (brief.removed) return { run: false, code: 10, line: `SKIPPED [REMOVED] ${brief.duty_id}: you removed this duty, so it does not run.` };
  if (brief.paused) return { run: false, code: 10, line: `SKIPPED [PAUSED] ${brief.duty_id}: paused on the employee page, so it does not run until you resume it.` };
  if ((onlyIfDue || brief.owner_schedule) && !brief.due) {
    return { run: false, code: 10, line: `SKIPPED [NOT_DUE] ${brief.duty_id}: ${brief.reason}. Nothing to do today, and that is the answer.` };
  }
  return {
    run: true,
    code: 0,
    line: `${brief.duty_id} runs${brief.instructions ? ` with your instructions (version ${brief.version})` : " with the repository's instructions"}.`,
    instructions: brief.instructions ?? null,
  };
}
