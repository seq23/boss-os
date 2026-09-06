import { AppError } from "../lib/http";
import { LIVE_TRADING_GATES, LIVE_GATE_LABELS } from "../../shared/governance";

export interface TradingAuthority {
  id: string;
  updated_at: number;
  live_enabled: number;
  max_order_notional_micros: number;
  max_daily_loss_micros: number;
  max_open_positions: number;
  allowed_symbols: string | null;
  kill_switch: number;
  human_approval_recorded: number;
  exchange_security_ok: number;
  withdrawals_disabled: number;
  monitoring_ok: number;
  incident_runbook_ok: number;
  ledger_export_tested: number;
  note: string | null;
}

export async function loadAuthority(db: D1Database): Promise<TradingAuthority> {
  const row = await db
    .prepare(`SELECT * FROM trading_authority WHERE id = 'trd_authority'`)
    .first<TradingAuthority>();
  if (!row) {
    throw new AppError(
      500,
      "The trading authority envelope is missing",
      "Run the 0004 seed migration. The lane refuses to operate without an envelope.",
    );
  }
  return row;
}

/** Which micro-live gates are still unmet. Empty means every gate is satisfied. */
export function unmetGates(auth: TradingAuthority): string[] {
  return LIVE_TRADING_GATES.filter((g) => !auth[g]).map((g) => LIVE_GATE_LABELS[g]);
}

export interface OrderCheck {
  accountMode: string;
  symbol: string;
  notionalMicros: number;
  openPositions: number;
}

/**
 * The envelope is checked at draft time and again at execution time. Checking
 * once would let an order drafted before a kill switch flip still execute after.
 */
export async function assertOrderAllowed(db: D1Database, check: OrderCheck): Promise<void> {
  const auth = await loadAuthority(db);

  if (auth.kill_switch) {
    throw new AppError(
      423,
      "The trading kill switch is engaged",
      "Nothing in the trading lane executes until you clear the kill switch in Trading settings.",
    );
  }

  if (check.accountMode === "live") {
    if (!auth.live_enabled) {
      throw new AppError(
        423,
        "Live trading authority has not been granted",
        "This build has no live broker adapter. Paper orders work; live execution is a separate gated change.",
      );
    }
    const unmet = unmetGates(auth);
    if (unmet.length) {
      throw new AppError(
        423,
        `Live trading is blocked by ${unmet.length} unmet gate${unmet.length === 1 ? "" : "s"}`,
        `Still required: ${unmet.join("; ")}.`,
      );
    }
    if (auth.max_order_notional_micros > 0 && check.notionalMicros > auth.max_order_notional_micros) {
      throw new AppError(
        409,
        "This order is larger than the authority envelope allows",
        `The per-order ceiling is ${(auth.max_order_notional_micros / 1_000_000).toFixed(2)} USD.`,
      );
    }
    if (auth.allowed_symbols) {
      const allowed = JSON.parse(auth.allowed_symbols) as string[];
      if (!allowed.includes(check.symbol)) {
        throw new AppError(
          409,
          `${check.symbol} is not on the approved symbol list`,
          `Approved live symbols: ${allowed.join(", ") || "none"}.`,
        );
      }
    }
    if (auth.max_open_positions > 0 && check.openPositions >= auth.max_open_positions) {
      throw new AppError(
        409,
        "The open position limit is already reached",
        `The envelope allows ${auth.max_open_positions} concurrent positions.`,
      );
    }
  }
}

/**
 * Live authority can only be switched on when every gate is recorded as met.
 * This is the one place that flips the flag, so there is no back door.
 */
export async function setLiveEnabled(db: D1Database, enabled: boolean): Promise<TradingAuthority> {
  const auth = await loadAuthority(db);
  if (enabled) {
    const unmet = unmetGates(auth);
    if (unmet.length) {
      throw new AppError(
        409,
        `Cannot enable live trading with ${unmet.length} unmet gate${unmet.length === 1 ? "" : "s"}`,
        `Record these first: ${unmet.join("; ")}.`,
      );
    }
    throw new AppError(
      501,
      "This build cannot execute live orders",
      "Every micro-live gate is recorded, but no live broker adapter is installed. Installing one is a separate reviewed change.",
    );
  }
  await db
    .prepare(`UPDATE trading_authority SET live_enabled = 0, updated_at = ? WHERE id = 'trd_authority'`)
    .bind(Date.now())
    .run();
  return loadAuthority(db);
}
