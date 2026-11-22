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

/**
 * The audit row for the statement BEFORE it in the same batch, read off that statement's own effect.
 *
 * `changes()` is the row count of the statement that ran just before this one, inside the same
 * transaction, so the record says what the delete really did (not a COUNT read beforehand that a
 * concurrent writer can make wrong). The count lands in `detail[countAs]`. With `onlyIfChanged`, a
 * delete that found nothing (a double tap racing the first) writes no record at all.
 */
export function auditOfPrevious(
  db: D1Database, entry: AuditEntry, countAs = "rows", { onlyIfChanged = false } = {},
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
       SELECT ?, ?, ?, ?, ?, ?, ?, json_set(?, '$.' || ?, changes())${onlyIfChanged ? " WHERE changes() > 0" : ""}`,
    )
    .bind(
      newId("aud"),
      Date.now(),
      entry.actor,
      entry.lane,
      entry.entityType,
      entry.entityId ?? null,
      entry.action,
      JSON.stringify(entry.detail ?? {}),
      countAs,
    );
}

export async function audit(db: D1Database, entry: AuditEntry): Promise<void> {
  await auditStatement(db, entry).run();
}
