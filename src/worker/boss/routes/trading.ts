import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { loadAuthority, unmetGates, assertOrderAllowed, setLiveEnabled } from "../trading/authority";
import { cancelOrder, recordIncident } from "../trading/execute";
import { LIVE_TRADING_GATES, LIVE_GATE_LABELS } from "../../../shared/boss/governance";
import { assertProtectedAction } from "../governance/gate";

/**
 * The trading lane is isolated by construction: its own tables, its own budget
 * rows, its own authority envelope, and no route here reads or writes ops data.
 * Every order that could move money goes through the approval inbox, and the
 * envelope is re-checked at execution time, not just at draft time.
 */
export const trading = new Hono<{ Bindings: Env; Variables: Vars }>();

const STAGES = [
  "research", "backtest", "paper", "micro_live_1", "micro_live_2",
  "small_live", "production_candidate", "retired",
] as const;
type Stage = (typeof STAGES)[number];

/** Stages beyond paper commit real capital and are not reachable in this build. */
const LIVE_STAGES: Stage[] = ["micro_live_1", "micro_live_2", "small_live", "production_candidate"];

trading.get("/overview", async (c) => {
  const [accounts, positions, orders, signals, strategies, incidents, fills] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM trading_accounts ORDER BY created_at`).all(),
    c.env.DB.prepare(`SELECT * FROM trading_positions WHERE qty != 0 ORDER BY symbol`).all(),
    c.env.DB.prepare(`SELECT * FROM trading_orders ORDER BY ts DESC LIMIT 50`).all(),
    c.env.DB.prepare(`SELECT * FROM trading_signals ORDER BY ts DESC LIMIT 25`).all(),
    c.env.DB.prepare(`SELECT * FROM trading_strategies WHERE status != 'cemetery' ORDER BY created_at`).all(),
    c.env.DB.prepare(`SELECT * FROM trading_incidents WHERE resolved_at IS NULL ORDER BY ts DESC LIMIT 20`).all(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(realized_micros),0) AS realized FROM trading_positions`).first<{ realized: number }>(),
  ]);

  const auth = await loadAuthority(c.env.DB);
  return ok(c, {
    accounts: accounts.results ?? [],
    positions: positions.results ?? [],
    orders: orders.results ?? [],
    signals: signals.results ?? [],
    strategies: strategies.results ?? [],
    incidents: incidents.results ?? [],
    realized_micros: fills?.realized ?? 0,
    authority: {
      live_enabled: Boolean(auth.live_enabled),
      kill_switch: Boolean(auth.kill_switch),
      unmet_gates: unmetGates(auth),
      gates: LIVE_TRADING_GATES.map((g) => ({ key: g, label: LIVE_GATE_LABELS[g], met: Boolean(auth[g]) })),
      max_order_notional_micros: auth.max_order_notional_micros,
      note: auth.note,
    },
    live_execution_available: false,
    live_execution_note:
      "This build ships a paper broker only. Live execution requires a broker adapter that does not exist here yet.",
  });
});

// ─── Strategy registry ───────────────────────────────────────────────────────

trading.get("/strategies", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM trading_strategies ORDER BY created_at DESC`).all();
  return ok(c, rows.results ?? []);
});

trading.post("/strategies", async (c) => {
  const b = await c.req.json<any>();
  const required = ["name", "thesis", "market", "timeframe", "risk_controls"];
  const missing = required.filter((f) => !b?.[f]);
  if (missing.length) {
    throw badRequest(
      `A strategy needs ${missing.join(", ")}`,
      "The intake form is the gate. A strategy without a thesis and risk controls cannot be scored.",
    );
  }
  const id = newId("str");
  await c.env.DB
    .prepare(
      `INSERT INTO trading_strategies
         (id, name, thesis, market, timeframe, data_sources, risk_controls, intake_complete,
          backtest_note, stage, score, status, created_at)
       VALUES (?,?,?,?,?,?,?,1,?, 'research', 0, 'active', ?)`,
    )
    .bind(
      id, b.name, b.thesis, b.market, b.timeframe, b.data_sources ?? null,
      b.risk_controls, b.backtest_note ?? null, Date.now(),
    )
    .run();
  await audit(c.env.DB, { actor: "boss", lane: "trading", entityType: "strategy", entityId: id, action: "registered" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM trading_strategies WHERE id = ?`).bind(id).first(), 201);
});

/**
 * Stage promotion.
 *
 * Research → backtest → paper is reachable because none of it risks capital.
 * Every stage past paper is refused: this build has no live adapter, and the
 * scale ladder requires evidence that only real forward testing can produce.
 */
trading.post("/strategies/:id/stage", async (c) => {
  const id = c.req.param("id");
  const { stage, note } = await c.req.json<{ stage: string; note?: string }>();
  if (!STAGES.includes(stage as Stage)) {
    throw badRequest("That is not a strategy stage", `Use one of: ${STAGES.join(", ")}.`);
  }

  const strategy = await c.env.DB
    .prepare(`SELECT * FROM trading_strategies WHERE id = ?`).bind(id)
    .first<{ id: string; name: string; stage: string; intake_complete: number; backtest_note: string | null }>();
  if (!strategy) throw notFound("No strategy with that id");

  if (LIVE_STAGES.includes(stage as Stage)) {
    const auth = await loadAuthority(c.env.DB);
    const unmet = unmetGates(auth);
    throw conflict(
      `${stage.replace(/_/g, " ")} commits real capital and this build cannot execute live orders`,
      unmet.length
        ? `Unmet micro-live gates: ${unmet.join("; ")}. A live broker adapter is also required and is not installed.`
        : "Every gate is recorded, but no live broker adapter is installed. Installing one is a separate reviewed change.",
    );
  }

  if (stage === "backtest" && !strategy.intake_complete) {
    throw conflict("The intake form is not complete", "A strategy cannot be backtested before it is fully described.");
  }
  if (stage === "paper" && !strategy.backtest_note) {
    throw conflict(
      "Paper trading needs a backtest note first",
      "Record the backtest result, or write down why a backtest is not possible for this strategy.",
    );
  }

  const now = Date.now();
  await c.env.DB
    .prepare(
      `UPDATE trading_strategies
          SET stage = ?, paper_started_at = CASE WHEN ? = 'paper' THEN COALESCE(paper_started_at, ?) ELSE paper_started_at END
        WHERE id = ?`,
    )
    .bind(stage, stage, now, id)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "strategy", entityId: id,
    action: "stage_changed", detail: { from: strategy.stage, to: stage, note },
  });
  return ok(c, { id, stage, from: strategy.stage });
});

trading.post("/strategies/:id/retire", async (c) => {
  const id = c.req.param("id");
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  if (!reason) throw badRequest("Retiring a strategy needs a reason", "The cemetery is only useful if it says why.");
  const res = await c.env.DB
    .prepare(`UPDATE trading_strategies SET status = 'cemetery', stage = 'retired', retire_reason = ? WHERE id = ?`)
    .bind(reason, id)
    .run();
  if (!res.meta.changes) throw notFound("No strategy with that id");
  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "strategy", entityId: id,
    action: "retired", detail: { reason },
  });
  return ok(c, { retired: true, id, reason });
});

// ─── Signals ─────────────────────────────────────────────────────────────────

trading.post("/signals", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.symbol || !b?.direction) throw badRequest("A signal needs a symbol and a direction");
  if (!["long", "short", "flat"].includes(b.direction)) {
    throw badRequest("Direction must be long, short, or flat");
  }
  const id = newId("sig");
  await c.env.DB
    .prepare(
      `INSERT INTO trading_signals (id, ts, source, symbol, direction, conviction, rationale, raw, status, strategy_id)
       VALUES (?,?,?,?,?,?,?,?,'new',?)`,
    )
    .bind(
      id, Date.now(), b.source ?? "manual", String(b.symbol).toUpperCase(), b.direction,
      b.conviction ?? 0.5, b.rationale ?? null, b.raw ? JSON.stringify(b.raw) : null,
      b.strategy_id ?? null,
    )
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM trading_signals WHERE id = ?`).bind(id).first(), 201);
});

// ─── Orders ──────────────────────────────────────────────────────────────────

trading.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const order = await c.env.DB.prepare(`SELECT * FROM trading_orders WHERE id = ?`).bind(id).first();
  if (!order) throw notFound("No order with that id");
  const fills = await c.env.DB
    .prepare(`SELECT * FROM trading_fills WHERE order_id = ? ORDER BY ts`).bind(id).all();
  return ok(c, { order, fills: fills.results ?? [] });
});

/** Drafts an order and raises the approval that must clear before it can be sent. */
trading.post("/orders", async (c) => {
  // Canon §18: placing an order is a protected action. The envelope still
  // decides everything else; this only asks whether now is the moment.
  await assertProtectedAction(c.env, "trade");

  const b = await c.req.json<any>();
  if (!b?.symbol || !b?.side || !b?.qty) {
    throw badRequest("An order needs a symbol, a side, and a quantity", "Send { account_id, symbol, side, qty, ref_price }.");
  }
  if (!["buy", "sell"].includes(b.side)) throw badRequest("Side must be buy or sell");
  const qty = Number(b.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest("Quantity must be a positive number");

  const orderType = b.order_type ?? "market";
  const limitPrice = b.limit_price === undefined || b.limit_price === null ? null : Number(b.limit_price);
  const refPrice = b.ref_price === undefined || b.ref_price === null ? null : Number(b.ref_price);

  if (orderType === "limit" && (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0)) {
    throw badRequest("A limit order needs a limit price");
  }
  // Boss OS has no market data feed. Say so rather than invent a mark.
  const priceForNotional = orderType === "limit" ? limitPrice : refPrice;
  if (priceForNotional === null || !Number.isFinite(priceForNotional) || priceForNotional <= 0) {
    throw badRequest(
      "A market order needs a reference price",
      "Boss OS has no market data feed. Supply ref_price with the mark you observed so the fill is honest.",
    );
  }

  const account = await c.env.DB
    .prepare(`SELECT id, mode, enabled FROM trading_accounts WHERE id = ?`)
    .bind(b.account_id).first<{ id: string; mode: string; enabled: number }>();
  if (!account) throw badRequest("That account does not exist");
  if (!account.enabled) throw conflict("That account is disabled", "Enable it in Trading settings first.");

  const symbol = String(b.symbol).toUpperCase();
  const notionalMicros = Math.round(qty * priceForNotional * 1_000_000);
  const openPositions = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM trading_positions WHERE account_id = ? AND qty != 0`)
    .bind(account.id).first<{ n: number }>();

  // Checked here and again at execution: an envelope that only gates drafting is
  // not an envelope.
  await assertOrderAllowed(c.env.DB, {
    accountMode: account.mode,
    symbol,
    notionalMicros,
    openPositions: openPositions?.n ?? 0,
  });

  const orderId = newId("ord");
  const aprId = newId("apr");
  const now = Date.now();

  // Approval first — trading_orders.approval_id is a foreign key onto it.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
       VALUES (?, 'trading', ?, ?, 'trade', 'trading_orders', ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      aprId,
      `${b.side.toUpperCase()} ${qty} ${symbol}`,
      `${account.mode} ${orderType} order, notional ${(notionalMicros / 1_000_000).toFixed(2)} USD at ${priceForNotional}.` +
        (account.mode === "paper" ? " Paper fill — no money moves." : ""),
      orderId, account.mode === "live" ? "high" : "medium",
      JSON.stringify({ order_id: orderId }), now, now + 24 * 60 * 60 * 1000,
    ),
    c.env.DB.prepare(
      `INSERT INTO trading_orders (id, ts, account_id, signal_id, strategy_id, approval_id, symbol, side, qty,
                                   order_type, limit_price, ref_price, notional_micros, mode, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'awaiting_approval')`,
    ).bind(
      orderId, now, account.id, b.signal_id ?? null, b.strategy_id ?? null, aprId, symbol,
      b.side, qty, orderType, limitPrice, refPrice, notionalMicros, account.mode,
    ),
  ]);

  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "order", entityId: orderId,
    action: "drafted", detail: { symbol, side: b.side, qty, mode: account.mode, notional_micros: notionalMicros },
  });
  return ok(c, { order_id: orderId, approval_id: aprId, notional_micros: notionalMicros, mode: account.mode }, 201);
});

trading.post("/orders/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const cancelled = await cancelOrder(c.env.DB, id, reason ?? "Cancelled by the Boss");
  if (!cancelled) throw conflict("That order is already filled or cancelled");
  return ok(c, { cancelled: true, id });
});

// ─── Authority envelope ──────────────────────────────────────────────────────

trading.get("/authority", async (c) => {
  const auth = await loadAuthority(c.env.DB);
  return ok(c, {
    ...auth,
    unmet_gates: unmetGates(auth),
    gates: LIVE_TRADING_GATES.map((g) => ({ key: g, label: LIVE_GATE_LABELS[g], met: Boolean(auth[g]) })),
    live_execution_available: false,
  });
});

/** Records gate evidence and risk limits. Cannot switch live execution on. */
trading.patch("/authority", async (c) => {
  // Canon §18: the envelope is what stops the lane, so changing it is protected.
  await assertProtectedAction(c.env, "trading_authority_change");

  const b = await c.req.json<any>();
  const numeric = ["max_order_notional_micros", "max_daily_loss_micros", "max_open_positions"];
  const flags = [...LIVE_TRADING_GATES, "kill_switch"];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const f of numeric) {
    if (f in b) { updates.push(`${f} = ?`); values.push(Number(b[f]) || 0); }
  }
  for (const f of flags) {
    if (f in b) { updates.push(`${f} = ?`); values.push(b[f] ? 1 : 0); }
  }
  if ("allowed_symbols" in b) {
    updates.push(`allowed_symbols = ?`);
    values.push(Array.isArray(b.allowed_symbols) ? JSON.stringify(b.allowed_symbols.map(String)) : null);
  }
  if ("note" in b) { updates.push(`note = ?`); values.push(b.note ?? null); }

  if ("live_enabled" in b && b.live_enabled) {
    // Routed through the one function that owns this flag, which refuses.
    await setLiveEnabled(c.env.DB, true);
  }
  if (!updates.length) throw badRequest("Nothing to change", "Send a gate flag, a risk limit, or the kill switch.");

  updates.push(`updated_at = ?`);
  values.push(Date.now());
  await c.env.DB
    .prepare(`UPDATE trading_authority SET ${updates.join(", ")} WHERE id = 'trd_authority'`)
    .bind(...values)
    .run();

  const auth = await loadAuthority(c.env.DB);
  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "authority", entityId: "trd_authority",
    action: "updated", detail: { fields: updates },
  });
  await logEvent(c.env.DB, {
    level: "warn", scope: "trading", event: "authority_updated", lane: "trading",
    detail: { kill_switch: auth.kill_switch, unmet_gates: unmetGates(auth).length },
  });
  return ok(c, { ...auth, unmet_gates: unmetGates(auth) });
});

/** Kill switch. Engaging it also cancels everything not yet filled. */
trading.post("/kill-switch", async (c) => {
  const { engaged, reason } = await c.req.json<{ engaged: boolean; reason?: string }>();
  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE trading_authority SET kill_switch = ?, updated_at = ? WHERE id = 'trd_authority'`)
    .bind(engaged ? 1 : 0, now)
    .run();

  let cancelled = 0;
  if (engaged) {
    const open = await c.env.DB
      .prepare(`SELECT id FROM trading_orders WHERE status IN ('draft','awaiting_approval','sent')`)
      .all<{ id: string }>();
    for (const o of open.results ?? []) {
      if (await cancelOrder(c.env.DB, o.id, reason ?? "Kill switch engaged")) cancelled++;
    }
    await recordIncident(c.env.DB, {
      kind: "risk_breach", severity: "high",
      summary: "Kill switch engaged",
      detail: reason ?? "Engaged by the Boss",
    });
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "authority", entityId: "trd_authority",
    action: engaged ? "kill_switch_engaged" : "kill_switch_cleared",
    detail: { reason, cancelled_orders: cancelled },
  });
  return ok(c, { kill_switch: engaged, cancelled_orders: cancelled });
});

// ─── Incidents ───────────────────────────────────────────────────────────────

trading.get("/incidents", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM trading_incidents ORDER BY ts DESC LIMIT 100`).all();
  return ok(c, rows.results ?? []);
});

trading.post("/incidents", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.summary) throw badRequest("An incident needs a summary");
  const id = await recordIncident(c.env.DB, {
    kind: b.kind ?? "other",
    severity: b.severity ?? "low",
    summary: b.summary,
    detail: b.detail ?? null,
    orderId: b.order_id ?? null,
    strategyId: b.strategy_id ?? null,
  });
  return ok(c, { id }, 201);
});

trading.post("/incidents/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const { resolution } = await c.req.json<{ resolution?: string }>();
  if (!resolution) throw badRequest("Resolving an incident needs the resolution");
  const res = await c.env.DB
    .prepare(`UPDATE trading_incidents SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL`)
    .bind(Date.now(), resolution, id)
    .run();
  if (!res.meta.changes) throw conflict("That incident is already resolved");
  return ok(c, { resolved: true, id });
});

// ─── Ledger export ───────────────────────────────────────────────────────────

/** Tax and accounting need fills out of the system, not screenshots of them. */
trading.get("/ledger.csv", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT f.ts, f.order_id, f.symbol, f.side, f.qty, f.price, f.fee_micros, f.mode, f.simulated,
              o.strategy_id
         FROM trading_fills f LEFT JOIN trading_orders o ON o.id = f.order_id
        ORDER BY f.ts`,
    )
    .all<any>();

  const header = "timestamp_iso,order_id,symbol,side,qty,price,fee_usd,mode,simulated,strategy_id";
  const lines = (rows.results ?? []).map((r) =>
    [
      new Date(r.ts).toISOString(), r.order_id, r.symbol, r.side, r.qty, r.price,
      (r.fee_micros / 1_000_000).toFixed(6), r.mode, r.simulated ? "yes" : "no", r.strategy_id ?? "",
    ].join(","),
  );

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="boss-os-trading-ledger.csv"`,
    },
  });
});
