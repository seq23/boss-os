/**
 * The Trading Allocation Bridge — canon §41.
 *
 * Wealth needs to know how much capital is sitting in the trading lane. It does
 * not get to move it. This module is the only path across that boundary, and it
 * is deliberately one direction: every statement in it is a SELECT, it returns
 * a snapshot rather than a handle, and the Wealth routes refuse to create a
 * vehicle or an allocation that would represent trading capital as something
 * Wealth can deploy.
 *
 * The boundary is also kept in SQL: nothing here joins a trading table to an
 * ops table. Two reads and an assembly in TypeScript is the honest shape, and a
 * join would quietly make the lanes one book.
 */

export interface TradingCapitalRead {
  read_only: true;
  source: "trading_lane";
  read_at: number;
  capital_micros: number;
  cash_micros: number;
  realized_micros: number;
  open_positions: number;
  accounts: {
    id: string;
    label: string;
    mode: string;
    stage: string;
    enabled: boolean;
    capital_micros: number;
    cash_micros: number;
  }[];
  authority: { live_enabled: boolean; kill_switch: boolean };
  note: string;
}

const NOTE =
  "Read across the lane boundary. Trading capital is governed by the trading authority envelope; " +
  "Wealth reports it and cannot allocate, move, or spend it.";

/** One read of the trading lane's capital position. Writes nothing, ever. */
export async function readTradingCapital(db: D1Database, now = Date.now()): Promise<TradingCapitalRead> {
  const [accounts, positions, authority] = await Promise.all([
    db
      .prepare(
        `SELECT id, label, mode, stage, enabled, capital_micros, cash_micros
           FROM trading_accounts ORDER BY created_at ASC`,
      )
      .all<{
        id: string; label: string; mode: string; stage: string; enabled: number;
        capital_micros: number; cash_micros: number;
      }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(realized_micros),0) AS realized,
                COALESCE(SUM(CASE WHEN qty <> 0 AND closed_at IS NULL THEN 1 ELSE 0 END),0) AS open_positions
           FROM trading_positions`,
      )
      .first<{ realized: number; open_positions: number }>(),
    db
      .prepare(`SELECT live_enabled, kill_switch FROM trading_authority LIMIT 1`)
      .first<{ live_enabled: number; kill_switch: number }>(),
  ]);

  const rows = accounts.results ?? [];
  return {
    read_only: true,
    source: "trading_lane",
    read_at: now,
    capital_micros: rows.reduce((sum, a) => sum + a.capital_micros, 0),
    cash_micros: rows.reduce((sum, a) => sum + a.cash_micros, 0),
    realized_micros: positions?.realized ?? 0,
    open_positions: positions?.open_positions ?? 0,
    accounts: rows.map((a) => ({
      id: a.id, label: a.label, mode: a.mode, stage: a.stage,
      enabled: Boolean(a.enabled), capital_micros: a.capital_micros, cash_micros: a.cash_micros,
    })),
    authority: {
      live_enabled: Boolean(authority?.live_enabled),
      kill_switch: Boolean(authority?.kill_switch),
    },
    note: NOTE,
  };
}

/**
 * The words a refusal uses when something tries to treat trading capital as
 * Wealth capital. Kept here so the boundary reads the same wherever it is hit.
 */
export const LANE_BREACH_REFUSAL = {
  message: "Trading capital cannot be held or allocated from Wealth",
  hint:
    "The trading lane is isolated. Wealth reads its capital through the bridge, read-only; " +
    "moving it happens in the trading lane, under its own authority envelope and approval path.",
};
