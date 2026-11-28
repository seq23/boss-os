import { dayOf, startOfDay } from "../../../shared/boss/schedule/clock.mjs";
import { GRID } from "../../../shared/boss/grid.mjs";

/** Counts and run receipts only. Mail, task text, and run logs stay in their source systems. */
export async function workerEvidence(db: D1Database, now: number) {
  const end = startOfDay(now);
  const start = startOfDay(end - 1);
  async function counts(sql: string) {
    try {
      const rows = await db.prepare(sql).bind(start, end).all<{ id: string; source: number; handled: number }>();
      return rows.success && Array.isArray(rows.results)
        ? Object.fromEntries(rows.results.map(({ id, source, handled }) => [id, { source, handled }])) : null;
    } catch {
      return null;
    }
  }

  const [duties, runs, workflows, worker, properties] = await Promise.all([
    counts(`SELECT json_extract(input, '$.duty_id') AS id, COUNT(*) AS source,
      SUM(CASE WHEN status = 'done' AND finished_at < ?2 THEN 1 ELSE 0 END) AS handled
      FROM tasks WHERE created_at >= ?1 AND created_at < ?2
        AND json_extract(input, '$.duty_id') IS NOT NULL GROUP BY 1`),
    counts(`SELECT duty_id AS id, COUNT(*) AS source,
      SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END) AS handled
      FROM duty_runs WHERE finished_at >= ? AND finished_at < ? AND source = 'launchd' GROUP BY duty_id`),
    counts(`SELECT job AS id, COUNT(*) AS source,
      SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END) AS handled
      FROM cloud_job_dispatches WHERE due_at >= ? AND due_at < ? GROUP BY job`),
    counts(`SELECT 'boss-nightly' AS id, COUNT(*) AS source,
      COALESCE(SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END), 0) AS handled
      FROM cron_runs WHERE started_at >= ?1 AND started_at < ?2
      UNION ALL
      SELECT 'cloud-clock', COUNT(*), COUNT(*) FROM cloud_job_dispatches WHERE claimed_at >= ?1 AND claimed_at < ?2`),
    counts(`SELECT reader AS id, COUNT(*) AS source, SUM(checked) AS handled FROM (
      SELECT reader, property_key, MIN(CASE WHEN state = 'blocked' THEN 0 ELSE 1 END) AS checked
      FROM property_health_readings WHERE read_at >= ? AND read_at < ? AND reader IN ('uptime','gsc')
      GROUP BY reader, property_key
    ) GROUP BY reader`),
  ]);

  return { day: dayOf(start), duties, runs, workflows, worker, properties, propertyCount: GRID.length };
}
