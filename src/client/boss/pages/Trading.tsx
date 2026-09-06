import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

export function Trading() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    api.tradingOverview().then(setData).catch((e) => {
      setError(e);
      setData({ positions: [], orders: [], signals: [], accounts: [], strategies: [], incidents: [], authority: {} });
    });
  }
  useEffect(load, []);

  async function toggleKill(engaged: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.killSwitch(engaged, engaged ? "Engaged from Trading" : undefined);
      setMsg(engaged
        ? `Kill switch engaged. ${r.cancelled_orders} open order${r.cancelled_orders === 1 ? "" : "s"} cancelled.`
        : "Kill switch cleared.");
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (!data) return <Loading />;
  const auth = data.authority ?? {};

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--brass)" }}>{msg}</div>}

      <div className="notice" style={{ borderColor: auth.kill_switch ? "var(--reject)" : "var(--lane-trading)" }}>
        {auth.kill_switch
          ? "Kill switch is engaged. Nothing in this lane executes."
          : "Paper mode. Orders are recorded and approved, and fills are simulated — no money moves."}
      </div>

      {data.live_execution_note && (
        <p className="row-sub">{data.live_execution_note}</p>
      )}

      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => setDrafting((v) => !v)}>
          {drafting ? "Close" : "Draft an order"}
        </button>
        <button className={`btn ${auth.kill_switch ? "" : "btn-reject"}`} disabled={busy}
                onClick={() => toggleKill(!auth.kill_switch)}>
          {auth.kill_switch ? "Clear kill switch" : "Kill switch"}
        </button>
      </div>

      {drafting && (
        <DraftOrder
          accounts={data.accounts}
          strategies={data.strategies}
          onDone={() => { setDrafting(false); load(); }}
        />
      )}

      <p className="eyebrow">Live authority</p>
      <div className="row">
        <div className="row-main">
          <div className="row-title">Live execution</div>
          <div className="row-sub">
            {auth.unmet_gates?.length
              ? `${auth.unmet_gates.length} gate${auth.unmet_gates.length === 1 ? "" : "s"} unmet`
              : "Every gate recorded"}
          </div>
        </div>
        <div className="row-val">{auth.live_enabled ? "on" : "off"}</div>
      </div>
      {(auth.gates ?? []).map((g: any) => (
        <div className="row" key={g.key}>
          <div className="row-main"><div className="row-sub">{g.label}</div></div>
          <div className="row-val">{g.met ? "✓" : "—"}</div>
        </div>
      ))}

      <p className="eyebrow">Positions</p>
      {data.positions.length === 0 ? (
        <Empty title="Flat" hint="Positions appear once an approved order fills." />
      ) : (
        data.positions.map((p: any) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div className="row-title">{p.symbol}</div>
              <div className="row-sub">avg {p.avg_cost} · realised {usd(p.realized_micros)}</div>
            </div>
            <div className="row-val">{p.qty}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Strategies</p>
      {data.strategies.length === 0 ? (
        <Empty title="No strategies" hint="A strategy needs a thesis and risk controls before it can be staged." />
      ) : (
        data.strategies.map((s: any) => (
          <div className="row" key={s.id}>
            <div className="row-main">
              <div className="row-title">{s.name}</div>
              <div className="row-sub">{s.stage.replace(/_/g, " ")} · {s.market}</div>
            </div>
            <div className="row-val">{s.status}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Orders</p>
      {data.orders.length === 0 ? (
        <Empty title="No orders" hint="Drafted orders raise a trading approval before they can be sent." />
      ) : (
        data.orders.slice(0, 20).map((o: any) => (
          <div className="row" key={o.id}>
            <div className="row-main">
              <div className="row-title">{o.side.toUpperCase()} {o.qty} {o.symbol}</div>
              <div className="row-sub">
                {o.status.replace(/_/g, " ")} · {o.mode}
                {o.avg_price ? ` @ ${o.avg_price}` : ""}{o.error ? ` · ${o.error}` : ""}
              </div>
            </div>
            <div className="row-val">{new Date(o.ts).toLocaleDateString()}</div>
          </div>
        ))
      )}

      {data.incidents?.length > 0 && (
        <>
          <p className="eyebrow">Open incidents</p>
          {data.incidents.map((i: any) => (
            <div className="row" key={i.id}>
              <div className="row-main">
                <div className="row-title">{i.summary}</div>
                <div className="row-sub">{i.kind} · {i.severity}</div>
              </div>
              <div className="row-val">{new Date(i.ts).toLocaleDateString()}</div>
            </div>
          ))}
        </>
      )}

      <p className="eyebrow">Signals</p>
      {data.signals.length === 0 ? (
        <Empty title="Quiet" hint="Signals from your sources collect here before becoming orders." />
      ) : (
        data.signals.map((s: any) => (
          <div className="row" key={s.id}>
            <div className="row-main">
              <div className="row-title">{s.symbol} · {s.direction}</div>
              <div className="row-sub">{s.source}</div>
            </div>
            <div className="row-val">{Math.round(s.conviction * 100)}%</div>
          </div>
        ))
      )}

      <a className="btn" style={{ width: "100%", marginTop: 16 }} href="/api/trading/ledger.csv">
        Export the fill ledger
      </a>
    </>
  );
}

function DraftOrder({ accounts, strategies, onDone }: { accounts: any[]; strategies: any[]; onDone: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("buy");
  const [qty, setQty] = useState("");
  const [refPrice, setRefPrice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.draftOrder({
        account_id: accountId, symbol, side,
        qty: Number(qty), ref_price: Number(refPrice),
        strategy_id: strategyId || undefined,
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field">
        <span>Account</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.mode})</option>)}
        </select>
      </label>
      {strategies.length > 0 && (
        <label className="field">
          <span>Strategy</span>
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
            <option value="">Unattributed</option>
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Symbol</span>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTC" />
      </label>
      <label className="field">
        <span>Side</span>
        <select value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </label>
      <label className="field">
        <span>Quantity</span>
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <label className="field">
        <span>Reference price</span>
        <input inputMode="decimal" value={refPrice} onChange={(e) => setRefPrice(e.target.value)} />
      </label>
      <p className="row-sub">
        Boss OS has no market data feed. The paper fill uses the price you record here, so it stays honest.
      </p>
      <button className="btn btn-approve" style={{ width: "100%" }}
              disabled={busy || !symbol || !qty || !refPrice} onClick={submit}>
        {busy ? "Drafting…" : "Draft — it still needs approval"}
      </button>
    </div>
  );
}
