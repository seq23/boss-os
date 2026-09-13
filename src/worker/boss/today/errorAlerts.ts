/**
 * ERROR EVENTS BECOME ONE ALERT PER CAUSE, AND ONLY IF THEY CAN SAY WHAT HAPPENED.
 *
 * ─── The defect, in what she saw ───────────────────────────────────────────
 *
 * Critical Alerts held eleven items and five of them were the literal string `queue: task_failed`.
 * Not a sentence — a database key and a database value with a colon between them, repeated five
 * times, with nothing to act on and no way to tell the five apart.
 *
 * `routes/today.ts` was doing this:
 *
 *     SELECT id, ts, scope, event FROM system_events WHERE level = 'error' ... LIMIT 5
 *     alerts.push({ text: `${ev.scope}: ${ev.event}` })
 *
 * Three separate faults in four lines:
 *
 *   1. IT RENDERED A KEY PAIR AS PROSE. `queue: task_failed` is what the row stores, not what
 *      happened. Every other alert on this surface is a sentence; these five were a table dump.
 *
 *   2. IT DID NOT READ `detail`, WHICH IS WHERE THE ANSWER WAS. `system_events` has carried a
 *      `detail` column since migration 0154 and `logEvent` writes JSON into it. The five rows in
 *      production on 12 September each held
 *      `{"message":"No model on this route satisfied policy: 3 of 4 refused at capability — model
 *      is cleared to low risk, task is medium"}` — the actual cause, and a thing she could act on,
 *      sitting one column away from the string being printed.
 *
 *   3. IT SAID THE SAME THING TWICE. Seventeen lines above, the same render pushes "N tasks failed
 *      and have not been requeued or cancelled" out of `tasks`. The count and the raw list are one
 *      fact in two shapes, and `LIMIT 5` meant the list was neither complete nor a sample — five
 *      rows of an unknown number.
 *
 * ─── What replaces it ──────────────────────────────────────────────────────
 *
 *   GROUPED. One alert per `scope` + `event`, carrying how many times and when the newest was.
 *   Five of a thing is one fact about a thing that happened five times, and five identical lines
 *   are the shape that teaches her to scroll past the list.
 *
 *   SPOKEN FROM `detail`. The newest row that carries a readable message supplies the sentence.
 *
 *   SILENT WHEN IT CANNOT SPEAK. A class whose rows carry no readable detail cannot be made
 *   actionable, so it does not reach this surface at all — it stays in Diagnostics, which reads
 *   the same table in full at `GET /api/boss/system/diagnostics`. An alert she cannot act on is
 *   not a smaller version of a useful alert; it is training to ignore the ones that matter.
 */

/** A row of `system_events`, as the Today query selects it. */
export interface ErrorEventRow {
  id: string;
  ts: number;
  scope: string;
  event: string;
  detail: string | null;
}

/** One cause, however many times it fired. */
export interface ErrorAlertGroup {
  scope: string;
  event: string;
  count: number;
  /** The newest occurrence — the one whose id and time the alert carries. */
  newest_ts: number;
  newest_id: string;
  /** What happened, read out of `detail`. Never empty: a group without one is not returned. */
  message: string;
}

/**
 * The longest a cause may speak on a surface she reads at a glance.
 *
 * A stack trace pasted into `detail` would otherwise push every other alert off the screen, and the
 * full text is one tap away in Diagnostics.
 */
const MAX_MESSAGE = 180;

/**
 * The human name of a cause.
 *
 * MAPPED WHERE IT IS WORTH MAPPING, and a readable fallback otherwise. The fallback still reads as
 * English rather than as a key pair, and the substance of the alert is the `detail` message that
 * follows it in every case — so a new event class added next year is legible on the day it first
 * fires, without anyone having to remember to come back here.
 */
const SUBJECTS: Record<string, string> = {
  "queue:task_failed": "A queued task failed",
  "queue:dead_letter": "A task was dead-lettered after its last retry",
  "queue:task_missing": "The queue was handed a task that no longer exists",
  "cron:run_failed": "The nightly run failed",
  "log:system_events_write_failed": "Diagnostics could not be written",
};

export function subjectFor(scope: string, event: string): string {
  return SUBJECTS[`${scope}:${event}`] ?? `${scope.replace(/_/g, " ")} reported ${event.replace(/_/g, " ")}`;
}

/**
 * The sentence inside `detail`, or null if there is not one.
 *
 * `logEvent` stringifies whatever the caller passed, so this handles the three shapes that actually
 * occur: `{ message }` (what `timed()` and the queue consumer write), a bare JSON string, and a
 * plain non-JSON string written by an older caller. Anything else — an object with no readable
 * field, `null`, `{}` — is treated as ABSENT, which is what silences the class. Guessing a sentence
 * out of an arbitrary object by stringifying it would put `{"a":1,"b":2}` on her morning screen,
 * which is the defect this file exists to remove wearing a different costume.
 */
export function messageFrom(detail: string | null | undefined): string | null {
  if (detail === null || detail === undefined) return null;
  const raw = detail.trim();
  if (raw === "") return null;

  let candidate: unknown = raw;
  if (raw.startsWith("{") || raw.startsWith("[") || raw.startsWith('"')) {
    try {
      candidate = JSON.parse(raw);
    } catch {
      candidate = raw;
    }
  }

  if (typeof candidate === "string") return clean(candidate);
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    for (const key of ["message", "error", "reason", "summary"]) {
      const v = (candidate as Record<string, unknown>)[key];
      if (typeof v === "string") return clean(v);
    }
  }
  return null;
}

function clean(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t === "") return "";
  const capped = t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE - 1).trimEnd()}…` : t;
  return capped;
}

/**
 * Collapse a window of error rows into one group per cause, newest first.
 *
 * A group is DROPPED when no row in it carries a readable message. That is the rule that keeps
 * `queue: task_failed` from ever coming back in another form: a cause that cannot say what happened
 * does not get a line on this screen.
 */
export function groupErrorEvents(rows: ErrorEventRow[]): ErrorAlertGroup[] {
  const byCause = new Map<string, ErrorAlertGroup>();

  for (const row of rows) {
    const key = `${row.scope}::${row.event}`;
    const existing = byCause.get(key);
    const message = messageFrom(row.detail);

    if (!existing) {
      byCause.set(key, {
        scope: row.scope,
        event: row.event,
        count: 1,
        newest_ts: row.ts,
        newest_id: row.id,
        message: message ?? "",
      });
      continue;
    }

    existing.count += 1;
    if (row.ts > existing.newest_ts) {
      existing.newest_ts = row.ts;
      existing.newest_id = row.id;
    }
    // The newest row that HAS something to say wins, which is not always the newest row.
    if (message && (existing.message === "" || row.ts >= existing.newest_ts)) existing.message = message;
  }

  return [...byCause.values()]
    .filter((g) => g.message !== "")
    .sort((a, b) => b.newest_ts - a.newest_ts);
}

/** Her clock, so "20:04" means what it said on the wall. */
export function clockAt(ts: number, tz = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

/**
 * The alert sentence for one cause.
 *
 * Two shapes, because "1 time" is not English and a count of one has no newest to distinguish it
 * from the rest.
 */
export function errorAlertText(g: ErrorAlertGroup, tz = "America/Chicago"): string {
  const subject = subjectFor(g.scope, g.event);
  if (g.count === 1) return `${subject} — ${g.message}`;
  return `${subject} ${g.count} times in the last day, the newest at ${clockAt(g.newest_ts, tz)} — ${g.message}`;
}

/**
 * The failed-task alert, which is ONE alert whichever way it is derived.
 *
 * ─── Why these two were merged rather than one of them deleted ─────────────
 *
 * The aggregate counts rows in `tasks` with `status = 'failed'` — every failure still unhandled,
 * however old. The grouped events count rows in `system_events` from the last day — recent, and the
 * only place the REASON is recorded. Neither is a subset of the other: a task that failed last week
 * has no event in the window, and a task that failed and was requeued has an event and no failed
 * row. Deleting either one loses something real.
 *
 * So the count comes from `tasks` and the reason comes from `system_events`, in one sentence. Where
 * there is no recent reason the aggregate stands alone, as it did before; where there are failures
 * recorded but nothing left failed, the reason stands alone. There is never a line for each.
 */
export function failedTaskAlertText(failedCount: number, group: ErrorAlertGroup | null, tz = "America/Chicago"): string {
  const plural = failedCount === 1 ? "" : "s";
  const head = `${failedCount} task${plural} failed and have not been requeued or cancelled.`;
  if (!group) return head;
  const when = clockAt(group.newest_ts, tz);
  // "in the last day" rather than "today": the window is 24 rolling hours, so the newest failure
  // can perfectly well have happened last night, and a screen that says "today" about last night is
  // the small lie that makes her stop trusting the timestamps.
  const times = group.count === 1 ? "The failure logged" : `The newest of ${group.count} failures logged`;
  return `${head} ${times} in the last day was at ${when}: ${group.message}`;
}
