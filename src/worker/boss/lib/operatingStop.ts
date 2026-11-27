import { auditOfPrevious } from "./audit";

export const OPERATING_STOP = "owner_operating_stop";
export const OPERATIONS_ENABLED = `NOT EXISTS (SELECT 1 FROM settings
  WHERE key = '${OPERATING_STOP}' AND value IS NOT 'running')`;

export async function operatingStopped(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT ${OPERATIONS_ENABLED} AS enabled`).first<{ enabled: number }>();
  return row?.enabled !== 1;
}

export function operatingStopCommand(words: string): boolean | null {
  switch (words.trim().toLowerCase()) {
    case "stop everything": return true;
    case "resume": return false;
    default: return null;
  }
}

export async function setOperatingStop(db: D1Database, stopped: boolean, now: number) {
  const state = stopped ? "stopped" : "running";
  await db.batch([
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= settings.updated_at`)
      .bind(OPERATING_STOP, state, now),
    auditOfPrevious(db, { actor: "owner", lane: "ops", entityType: "setting", entityId: OPERATING_STOP,
      action: stopped ? "operations_stopped" : "operations_resumed" }, "rows", { onlyIfChanged: true }),
  ]);
  return operatingStopped(db);
}
