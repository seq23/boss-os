import { newId } from "./id";

export async function audit(
  db: D1Database,
  entry: {
    actor: string;
    lane: string;
    entityType: string;
    entityId?: string | null;
    action: string;
    detail?: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("aud"),
      Date.now(),
      entry.actor,
      entry.lane,
      entry.entityType,
      entry.entityId ?? null,
      entry.action,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
    )
    .run();
}
