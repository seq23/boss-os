import { newId } from "./id";

export interface AuditEntry {
  actor: string;
  lane: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  detail?: unknown;
}

/** The audit row as a statement, so a change and its record can share one batch (one transaction). */
export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
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
    );
}

export async function audit(db: D1Database, entry: AuditEntry): Promise<void> {
  await auditStatement(db, entry).run();
}
