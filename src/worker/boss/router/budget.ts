/**
 * Budget windows.
 *
 * Phase 0 stored `window_started_at` but never rolled it, so a lane that spent
 * its daily limit once stayed blocked forever. Windows are UTC calendar
 * boundaries: whichever request or cron run first notices a stale window rolls
 * it, so the reset does not depend on the cron having fired.
 */

export interface BudgetRow {
  id: string;
  lane: string;
  period: string;
  limit_micros: number;
  spent_micros: number;
  window_started_at: number;
  hard_stop: number;
}

export function windowStart(period: string, now: number): number {
  const d = new Date(now);
  if (period === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Rolls every budget row and per-employee daily allowance whose window has passed. */
export async function rollBudgetWindows(db: D1Database, now = Date.now()): Promise<number> {
  const rows = await db
    .prepare(`SELECT id, period, window_started_at FROM budgets`)
    .all<{ id: string; period: string; window_started_at: number }>();

  const statements: D1PreparedStatement[] = [];
  for (const b of rows.results ?? []) {
    const start = windowStart(b.period, now);
    if (b.window_started_at < start) {
      statements.push(
        db.prepare(`UPDATE budgets SET spent_micros = 0, window_started_at = ? WHERE id = ?`).bind(start, b.id),
      );
    }
  }

  const dayStart = windowStart("day", now);
  statements.push(
    db
      .prepare(
        `UPDATE employees SET spent_micros_day = 0, spend_window_started_at = ?
          WHERE spend_window_started_at IS NULL OR spend_window_started_at < ?`,
      )
      .bind(dayStart, dayStart),
  );

  if (statements.length) await db.batch(statements);
  return statements.length;
}

export interface BudgetState {
  blocked: boolean;
  blockedPeriod: string | null;
  remainingMicros: number;
  rows: BudgetRow[];
}

export async function laneBudgetState(db: D1Database, lane: string): Promise<BudgetState> {
  const rows = await db
    .prepare(`SELECT * FROM budgets WHERE lane = ?`)
    .bind(lane)
    .all<BudgetRow>();
  const results = rows.results ?? [];

  let blockedPeriod: string | null = null;
  let remaining = results.length ? Number.MAX_SAFE_INTEGER : 0;

  for (const b of results) {
    const left = Math.max(0, b.limit_micros - b.spent_micros);
    remaining = Math.min(remaining, left);
    if (b.hard_stop && b.spent_micros >= b.limit_micros) blockedPeriod = b.period;
  }

  return {
    blocked: blockedPeriod !== null,
    blockedPeriod,
    remainingMicros: remaining === Number.MAX_SAFE_INTEGER ? 0 : remaining,
    rows: results,
  };
}

export async function employeeBudgetState(
  db: D1Database,
  employeeId: string | null | undefined,
): Promise<{ blocked: boolean; remainingMicros: number | null }> {
  if (!employeeId) return { blocked: false, remainingMicros: null };
  const emp = await db
    .prepare(`SELECT budget_micros_day, spent_micros_day FROM employees WHERE id = ?`)
    .bind(employeeId)
    .first<{ budget_micros_day: number; spent_micros_day: number }>();
  if (!emp || emp.budget_micros_day <= 0) return { blocked: false, remainingMicros: null };
  const remaining = emp.budget_micros_day - emp.spent_micros_day;
  return { blocked: remaining <= 0, remainingMicros: Math.max(0, remaining) };
}
