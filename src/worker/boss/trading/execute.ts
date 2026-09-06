import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { getBroker, BrokerUnavailable } from "./broker";
import { assertOrderAllowed } from "./authority";

export interface OrderRow {
  id: string;
  ts: number;
  account_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  order_type: string;
  limit_price: number | null;
  ref_price: number | null;
  status: string;
  mode: string;
  strategy_id: string | null;
  notional_micros: number;
}

export interface ExecutionOutcome {
  status: "filled" | "failed";
  fillId?: string;
  price?: number;
  qty?: number;
  error?: string;
  hint?: string;
}

const toMicros = (usd: number) => Math.round(usd * 1_000_000);

/**
 * Sends an approved order through its broker and books the result.
 *
 * Order, fill, position, and account cash move together in one batch so a
 * partial write cannot leave the book claiming a position that never filled.
 */
export async function executeOrder(db: D1Database, order: OrderRow): Promise<ExecutionOutcome> {
  if (order.status === "filled" || order.status === "cancelled") {
    return { status: "failed", error: `That order is already ${order.status}` };
  }

  const openPositions = await db
    .prepare(`SELECT COUNT(*) AS n FROM trading_positions WHERE account_id = ? AND qty != 0`)
    .bind(order.account_id)
    .first<{ n: number }>();

  try {
    await assertOrderAllowed(db, {
      accountMode: order.mode,
      symbol: order.symbol,
      notionalMicros: order.notional_micros,
      openPositions: openPositions?.n ?? 0,
    });

    const broker = getBroker(order.mode);
    const now = Date.now();

    const fill = await broker.submit({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      orderType: order.order_type,
      limitPrice: order.limit_price,
      refPrice: order.ref_price,
    });

    const fillId = newId("fil");
    const position = await db
      .prepare(`SELECT * FROM trading_positions WHERE account_id = ? AND symbol = ?`)
      .bind(order.account_id, order.symbol)
      .first<{ id: string; qty: number; avg_cost: number; realized_micros: number }>();

    const signedQty = order.side === "buy" ? fill.qty : -fill.qty;
    const cashDelta = toMicros(-signedQty * fill.price) - fill.feeMicros;

    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO trading_fills
             (id, ts, order_id, account_id, symbol, side, qty, price, fee_micros, mode, broker_ref, simulated)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          fillId, now, order.id, order.account_id, order.symbol, order.side,
          fill.qty, fill.price, fill.feeMicros, order.mode, fill.brokerRef,
          fill.simulated ? 1 : 0,
        ),
      db
        .prepare(
          `UPDATE trading_orders
              SET status = 'filled', sent_at = COALESCE(sent_at, ?), filled_at = ?,
                  filled_qty = ?, avg_price = ?, broker_ref = ?, error = NULL
            WHERE id = ?`,
        )
        .bind(now, now, fill.qty, fill.price, fill.brokerRef, order.id),
      db
        .prepare(`UPDATE trading_accounts SET cash_micros = cash_micros + ? WHERE id = ?`)
        .bind(cashDelta, order.account_id),
    ];

    if (!position) {
      statements.push(
        db
          .prepare(
            `INSERT INTO trading_positions (id, account_id, symbol, qty, avg_cost, realized_micros, opened_at)
             VALUES (?,?,?,?,?,0,?)`,
          )
          .bind(newId("pos"), order.account_id, order.symbol, signedQty, fill.price, now),
      );
    } else {
      const nextQty = position.qty + signedQty;
      const reducing = position.qty !== 0 && Math.sign(signedQty) !== Math.sign(position.qty);

      let avgCost = position.avg_cost;
      let realized = position.realized_micros;

      if (reducing) {
        // Closing size realises P&L against the existing average cost.
        const closedQty = Math.min(Math.abs(signedQty), Math.abs(position.qty));
        const direction = position.qty > 0 ? 1 : -1;
        realized += toMicros(direction * closedQty * (fill.price - position.avg_cost));
        // Flipping through zero re-bases the average at the new fill price.
        if (Math.sign(nextQty) !== 0 && Math.sign(nextQty) !== Math.sign(position.qty)) {
          avgCost = fill.price;
        }
      } else if (nextQty !== 0) {
        avgCost =
          (position.avg_cost * Math.abs(position.qty) + fill.price * Math.abs(signedQty)) /
          Math.abs(nextQty);
      }

      statements.push(
        db
          .prepare(
            `UPDATE trading_positions
                SET qty = ?, avg_cost = ?, realized_micros = ?,
                    opened_at = COALESCE(opened_at, ?),
                    closed_at = CASE WHEN ? = 0 THEN ? ELSE NULL END
              WHERE id = ?`,
          )
          .bind(nextQty, avgCost, realized, now, nextQty, now, position.id),
      );
    }

    await db.batch(statements);

    await audit(db, {
      actor: "system", lane: "trading", entityType: "order", entityId: order.id,
      action: "filled",
      detail: { price: fill.price, qty: fill.qty, mode: order.mode, simulated: fill.simulated },
    });
    await logEvent(db, {
      level: "info", scope: "trading", event: "order_filled", lane: "trading", entityId: order.id,
      detail: { symbol: order.symbol, side: order.side, qty: fill.qty, price: fill.price, mode: order.mode },
    });

    return { status: "filled", fillId, price: fill.price, qty: fill.qty };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = err instanceof BrokerUnavailable ? err.hint : (err as { hint?: string })?.hint;

    await db
      .prepare(`UPDATE trading_orders SET status = 'rejected', error = ? WHERE id = ?`)
      .bind(message.slice(0, 500), order.id)
      .run();

    await recordIncident(db, {
      kind: "stuck_order",
      severity: order.mode === "live" ? "high" : "low",
      summary: `Order ${order.id} could not execute`,
      detail: message,
      orderId: order.id,
      strategyId: order.strategy_id,
    });

    await logEvent(db, {
      level: "warn", scope: "trading", event: "order_rejected", lane: "trading",
      entityId: order.id, detail: { message },
    });

    return { status: "failed", error: message, hint };
  }
}

/** Cancels an order that has not filled. Rejection and expiry both land here. */
export async function cancelOrder(db: D1Database, orderId: string, reason: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE trading_orders
          SET status = 'cancelled', cancelled_at = ?, error = ?
        WHERE id = ? AND status NOT IN ('filled', 'cancelled')`,
    )
    .bind(Date.now(), reason.slice(0, 500), orderId)
    .run();
  const changed = (res.meta.changes ?? 0) > 0;
  if (changed) {
    await audit(db, {
      actor: "boss", lane: "trading", entityType: "order", entityId: orderId,
      action: "cancelled", detail: { reason },
    });
  }
  return changed;
}

export async function recordIncident(
  db: D1Database,
  incident: {
    kind: string;
    severity: string;
    summary: string;
    detail?: string | null;
    orderId?: string | null;
    strategyId?: string | null;
  },
): Promise<string> {
  const id = newId("inc");
  await db
    .prepare(
      `INSERT INTO trading_incidents (id, ts, kind, severity, summary, detail, order_id, strategy_id)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, Date.now(), incident.kind, incident.severity, incident.summary,
      incident.detail ?? null, incident.orderId ?? null, incident.strategyId ?? null,
    )
    .run();
  return id;
}
