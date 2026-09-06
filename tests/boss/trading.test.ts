import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { executeDecision, type ApprovalRow } from "../../src/worker/boss/approvals/execute";
import { runExpirySweep } from "../../src/worker/boss/routes/approvals";
import { loadAuthority, unmetGates } from "../../src/worker/boss/trading/authority";
import { api, apiJson, row, all } from "./helpers";

const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });
const patch = (path: string, body: unknown) => apiJson(path, { method: "PATCH", body });

async function draftOrder(over: Record<string, unknown> = {}) {
  const { status, body } = await post("/api/trading/orders", {
    account_id: "acct_paper", symbol: "BTC", side: "buy", qty: 1, ref_price: 50000, ...over,
  });
  return { status, body };
}

const approvalFor = (id: string) => row<ApprovalRow>(`SELECT * FROM approvals WHERE id = ?`, id);

describe("Phase 4 — the paper lifecycle actually completes", () => {
  it("drafts an order that waits for approval instead of executing", async () => {
    const { status, body } = await draftOrder();
    expect(status).toBe(201);
    expect(body.data.notional_micros).toBe(50_000_000_000);

    const order = await row(`SELECT status, mode FROM trading_orders WHERE id = ?`, body.data.order_id);
    expect(order!.status).toBe("awaiting_approval");
    expect(order!.mode).toBe("paper");
  });

  it("fills, opens a position, and moves cash when the approval clears", async () => {
    const { body } = await draftOrder({ qty: 2, ref_price: 100 });
    const cashBefore = (await row(`SELECT cash_micros FROM trading_accounts WHERE id = 'acct_paper'`))!.cash_micros;

    const result = await executeDecision(env, (await approvalFor(body.data.approval_id))!, "approved");
    expect(result.status).toBe("executed");
    expect(result.detail.simulated).toBe(true);

    const order = await row(`SELECT status, filled_qty, avg_price FROM trading_orders WHERE id = ?`, body.data.order_id);
    expect(order!.status).toBe("filled");
    expect(order!.filled_qty).toBe(2);
    expect(order!.avg_price).toBe(100);

    const position = await row(`SELECT qty, avg_cost FROM trading_positions WHERE symbol = 'BTC'`);
    expect(position!.qty).toBe(2);
    expect(position!.avg_cost).toBe(100);

    const fill = await row(`SELECT simulated, mode FROM trading_fills WHERE order_id = ?`, body.data.order_id);
    expect(fill!.simulated).toBe(1);
    expect(fill!.mode).toBe("paper");

    const cashAfter = (await row(`SELECT cash_micros FROM trading_accounts WHERE id = 'acct_paper'`))!.cash_micros;
    expect(cashAfter).toBe(cashBefore - 200_000_000);
  });

  it("realises P&L when a position is closed", async () => {
    const open = await draftOrder({ symbol: "ETH", qty: 10, ref_price: 100 });
    await executeDecision(env, (await approvalFor(open.body.data.approval_id))!, "approved");

    const close = await draftOrder({ symbol: "ETH", side: "sell", qty: 10, ref_price: 120 });
    await executeDecision(env, (await approvalFor(close.body.data.approval_id))!, "approved");

    const position = await row(`SELECT qty, realized_micros, closed_at FROM trading_positions WHERE symbol = 'ETH'`);
    expect(position!.qty).toBe(0);
    expect(position!.realized_micros).toBe(200_000_000); // 10 × (120 − 100) USD
    expect(position!.closed_at).toBeGreaterThan(0);
  });

  it("cancels the order when the trade is rejected", async () => {
    const { body } = await draftOrder();
    await executeDecision(env, (await approvalFor(body.data.approval_id))!, "rejected");

    const order = await row(`SELECT status, cancelled_at FROM trading_orders WHERE id = ?`, body.data.order_id);
    expect(order!.status).toBe("cancelled");
    expect(order!.cancelled_at).toBeGreaterThan(0);
    expect(await row(`SELECT id FROM trading_fills WHERE order_id = ?`, body.data.order_id)).toBeNull();
  });

  it("cancels the order when its approval expires", async () => {
    const { body } = await draftOrder();
    await env.DB.prepare(`UPDATE approvals SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1000, body.data.approval_id).run();

    await runExpirySweep(env);

    expect((await row(`SELECT status FROM trading_orders WHERE id = ?`, body.data.order_id))!.status).toBe("cancelled");
  });

  it("refuses a market order with no reference price rather than inventing a mark", async () => {
    const { status, body } = await post("/api/trading/orders", {
      account_id: "acct_paper", symbol: "BTC", side: "buy", qty: 1,
    });
    expect(status).toBe(400);
    expect(body.hint).toContain("no market data feed");
  });
});

describe("Phase 4 — the authority envelope holds", () => {
  it("starts with live denied and every micro-live gate unmet", async () => {
    const auth = await loadAuthority(env.DB);
    expect(auth.live_enabled).toBe(0);
    expect(unmetGates(auth)).toHaveLength(6);
  });

  it("refuses to enable live trading even with every gate recorded", async () => {
    await patch("/api/trading/authority", {
      human_approval_recorded: true, exchange_security_ok: true, withdrawals_disabled: true,
      monitoring_ok: true, incident_runbook_ok: true, ledger_export_tested: true,
    });
    expect(unmetGates(await loadAuthority(env.DB))).toHaveLength(0);

    const { status, body } = await patch("/api/trading/authority", { live_enabled: true });
    expect(status).toBe(501);
    expect(body.error).toContain("cannot execute live orders");
    expect((await loadAuthority(env.DB)).live_enabled).toBe(0);
  });

  it("refuses to enable live trading through the settings back door", async () => {
    const { status, body } = await apiJson("/api/system/settings/trading_live_enabled", {
      method: "PUT", body: { value: "true" },
    });
    expect(status).toBe(409);
    expect(body.error).toContain("cannot be switched on from settings");
  });

  it("stops execution dead when the kill switch is engaged", async () => {
    const { body } = await draftOrder();
    await post("/api/trading/kill-switch", { engaged: true, reason: "Drill" });

    const result = await executeDecision(env, (await approvalFor(body.data.approval_id))!, "approved");
    // The kill switch cancels open orders, so the approval finds nothing to fill.
    const order = await row(`SELECT status FROM trading_orders WHERE id = ?`, body.data.order_id);
    expect(order!.status).toBe("cancelled");
    expect(result.status).not.toBe("executed");
  });

  it("refuses to draft an order at all while the kill switch is engaged", async () => {
    await post("/api/trading/kill-switch", { engaged: true, reason: "Drill" });
    const { status, body } = await draftOrder();
    expect(status).toBe(423);
    expect(body.error).toContain("kill switch");
  });

  it("logs an incident when the kill switch fires", async () => {
    await post("/api/trading/kill-switch", { engaged: true, reason: "Drill" });
    const incidents = await all(`SELECT summary, severity FROM trading_incidents`);
    expect(incidents.some((i) => i.summary.includes("Kill switch"))).toBe(true);
  });
});

describe("Phase 4 — strategy gates", () => {
  it("refuses paper stage before a backtest note exists", async () => {
    const created = await post("/api/trading/strategies", {
      name: "Untested", thesis: "T", market: "spot", timeframe: "1d", risk_controls: "none",
    });
    const { status, body } = await post(`/api/trading/strategies/${created.body.data.id}/stage`, { stage: "paper" });
    expect(status).toBe(409);
    expect(body.error).toContain("backtest note");
  });

  it("refuses every live stage because no live adapter exists", async () => {
    for (const stage of ["micro_live_1", "micro_live_2", "small_live", "production_candidate"]) {
      const { status, body } = await post(`/api/trading/strategies/str_paper_baseline/stage`, { stage });
      expect(status).toBe(409);
      expect(body.hint).toContain("live broker adapter");
    }
  });

  it("requires a reason to retire a strategy into the cemetery", async () => {
    const { status } = await post(`/api/trading/strategies/str_paper_baseline/retire`, {});
    expect(status).toBe(400);
  });
});

describe("Phase 4 — lane isolation", () => {
  it("keeps trading spend out of the ops budget", async () => {
    const opsBefore = (await row(`SELECT spent_micros FROM budgets WHERE lane = 'ops' AND period = 'day'`))!.spent_micros;
    await env.DB
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, in_tokens, out_tokens, cost_micros, status)
         VALUES ('usg_iso', ?, 'trading', 100, 100, 5000, 'ok')`,
      )
      .bind(Date.now())
      .run();
    await env.DB.prepare(`UPDATE budgets SET spent_micros = spent_micros + 5000 WHERE lane = 'trading'`).run();

    const opsAfter = (await row(`SELECT spent_micros FROM budgets WHERE lane = 'ops' AND period = 'day'`))!.spent_micros;
    expect(opsAfter).toBe(opsBefore);
  });

  it("exports the fill ledger as CSV that names simulated fills as simulated", async () => {
    const { body } = await draftOrder({ symbol: "SOL", qty: 3, ref_price: 20 });
    await executeDecision(env, (await approvalFor(body.data.approval_id))!, "approved");

    const res = await api("/api/trading/ledger.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");

    const csv = await res.text();
    const line = csv.split("\n").find((l) => l.includes("SOL"));
    expect(line).toBeTruthy();
    expect(line).toContain("paper");
    expect(line!.endsWith("yes") || line!.includes(",yes,")).toBe(true);
  });
});
