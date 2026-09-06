import { newId } from "./id";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  scope: string;
  event: string;
  lane?: string | null;
  entityId?: string | null;
  detail?: unknown;
  durationMs?: number | null;
}

/**
 * Structured diagnostics that survive a log tail.
 *
 * Two destinations on purpose: `console` so `wrangler tail` shows it live, and
 * `system_events` so the Diagnostics screen can still answer "what happened at
 * 03:00 last Tuesday" a week later. Logging must never be the reason a request
 * fails, so a write failure here is swallowed after being surfaced to console.
 */
export async function logEvent(db: D1Database, entry: LogEntry): Promise<void> {
  const line = {
    ts: Date.now(),
    level: entry.level,
    scope: entry.scope,
    event: entry.event,
    lane: entry.lane ?? null,
    entityId: entry.entityId ?? null,
    durationMs: entry.durationMs ?? null,
    detail: entry.detail,
  };
  if (entry.level === "error") console.error(JSON.stringify(line));
  else if (entry.level === "warn") console.warn(JSON.stringify(line));
  else console.log(JSON.stringify(line));

  try {
    await db
      .prepare(
        `INSERT INTO system_events (id, ts, level, scope, event, lane, entity_id, detail, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        newId("evt"),
        line.ts,
        entry.level,
        entry.scope,
        entry.event,
        entry.lane ?? null,
        entry.entityId ?? null,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
        entry.durationMs ?? null,
      )
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", scope: "log", event: "system_events_write_failed", detail: String(err) }),
    );
  }
}

/** Times an operation and logs it once, whichever way it ends. */
export async function timed<T>(
  db: D1Database,
  meta: { scope: string; event: string; lane?: string | null; entityId?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await logEvent(db, { ...meta, level: "info", durationMs: Date.now() - started });
    return result;
  } catch (err) {
    await logEvent(db, {
      ...meta,
      level: "error",
      event: `${meta.event}_failed`,
      durationMs: Date.now() - started,
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
