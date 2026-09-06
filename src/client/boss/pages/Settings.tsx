import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../../../shared/boss/types";
import { Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

type Panel = "overview" | "cost" | "health" | "diagnostics" | "governance";

export function Settings({ onLock }: { onLock: () => void }) {
  const [panel, setPanel] = useState<Panel>("overview");
  const [status, setStatus] = useState<any>(null);
  const [modes, setModes] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.status(), api.costModes()])
      .then(([s, m]) => { setStatus(s); setModes(m); })
      .catch(setError);
  }
  useEffect(load, []);

  async function setMode(mode: string) {
    setError(null);
    try { await api.setSetting("cost_mode", mode); load(); }
    catch (e) { setError(e); }
  }

  if (!status && !error) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="seg">
        {(["overview", "cost", "health", "diagnostics", "governance"] as Panel[]).map((p) => (
          <button key={p} className="seg-btn" aria-pressed={panel === p} onClick={() => setPanel(p)}>
            {p}
          </button>
        ))}
      </div>

      {panel === "overview" && (
        <>
          <p className="eyebrow">Cost mode</p>
          {modes.map((m) => (
            <button key={m.id} className="row row-tap" onClick={() => setMode(m.id)}>
              <div className="row-main">
                <div className="row-title">
                  {m.label}
                  {status?.cost_mode === m.id && <span className="pill">current</span>}
                </div>
                <div className="row-sub">{m.note}</div>
              </div>
            </button>
          ))}

          <p className="eyebrow">Budgets</p>
          {(status?.budgets ?? []).map((b: any) => (
            <div className="row" key={b.id}>
              <div className="row-main">
                <div className="row-title">{b.lane} · {b.period}</div>
                <div className="row-sub">{b.hard_stop ? "stops work at the limit" : "warns only"}</div>
              </div>
              <div className="row-val">{usd(b.spent_micros)} / {usd(b.limit_micros)}</div>
            </div>
          ))}

          <p className="eyebrow">System</p>
          <div className="row">
            <div className="row-main">
              <div className="row-title">Boss OS {status?.version}</div>
              <div className="row-sub">{status?.phase}</div>
            </div>
          </div>
          {status?.last_cron && (
            <div className="row">
              <div className="row-main">
                <div className="row-title">Last nightly run</div>
                <div className="row-sub">{new Date(status.last_cron.started_at).toLocaleString()}</div>
              </div>
              <div className="row-val">{status.last_cron.status}</div>
            </div>
          )}
          {status?.last_snapshot && (
            <div className="row">
              <div className="row-main">
                <div className="row-title">Last snapshot</div>
                <div className="row-sub">{new Date(status.last_snapshot.ts).toLocaleString()}</div>
              </div>
              <div className="row-val">{status.last_snapshot.status}</div>
            </div>
          )}

          <button className="btn btn-reject" style={{ width: "100%", marginTop: 18 }} onClick={onLock}>
            Lock
          </button>
        </>
      )}

      {panel === "cost" && <CostPanel />}
      {panel === "health" && <HealthPanel />}
      {panel === "diagnostics" && <DiagnosticsPanel />}
      {panel === "governance" && <Governance />}
    </>
  );
}

function CostPanel() {
  const [cost, setCost] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.cost(30).then(setCost).catch(setError); }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!cost) return <Loading />;

  const section = (title: string, rows: any[], label: (r: any) => string) => (
    <>
      <p className="eyebrow">{title}</p>
      {rows.length === 0 ? (
        <div className="row"><div className="row-sub">Nothing recorded in this window.</div></div>
      ) : rows.map((r, i) => (
        <div className="row" key={i}>
          <div className="row-main"><div className="row-title">{label(r)}</div></div>
          <div className="row-val">{usd(r.cost ?? 0)}</div>
        </div>
      ))}
    </>
  );

  return (
    <>
      <p className="row-sub">Last {cost.window_days} days.</p>
      {section("By lane", cost.by_lane, (r) => r.lane)}
      {section("By employee", cost.by_employee, (r) => r.name ?? r.employee_id)}
      {section("By model", cost.by_model, (r) => r.display_name ?? r.model_id ?? "unknown")}
      {section("By kind of work", cost.by_intake_kind, (r) => String(r.intake_kind).replace(/_/g, " "))}

      <p className="eyebrow">Decisions that did not route</p>
      {cost.non_routed_decisions.length === 0 ? (
        <div className="row"><div className="row-sub">Every routing decision found a model.</div></div>
      ) : cost.non_routed_decisions.map((d: any) => (
        <div className="row" key={d.outcome}>
          <div className="row-main"><div className="row-title">{d.outcome.replace(/_/g, " ")}</div></div>
          <div className="row-val">{d.n}</div>
        </div>
      ))}
    </>
  );
}

function HealthPanel() {
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function run() {
    setBusy(true);
    setError(null);
    api.health().then(setHealth).catch(setError).finally(() => setBusy(false));
  }
  useEffect(run, []);

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={run}>
        {busy ? "Checking…" : "Re-run checks"}
      </button>

      {health && (
        <>
          <div className="notice" style={{ borderColor: health.ok ? "var(--ok)" : "var(--reject)" }}>
            {health.ok
              ? "Every binding responded."
              : `Failing: ${health.failing.join(", ")}.`}
          </div>
          {health.checks.map((c: any) => (
            <div className="row" key={c.name}>
              <div className="row-main">
                <div className="row-title">{c.name.replace(/_/g, " ")}</div>
                <div className="row-sub">{c.detail}</div>
              </div>
              <div className="row-val">{c.ok ? "✓" : "✕"}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function DiagnosticsPanel() {
  const [data, setData] = useState<any>(null);
  const [dead, setDead] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.diagnostics(), api.deadLetters()])
      .then(([d, dl]) => { setData(d); setDead(dl); })
      .catch(setError);
  }
  useEffect(load, []);

  async function act(id: string, fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e); }
  }

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Gave up after retrying</p>
      {dead.length === 0 ? (
        <div className="row"><div className="row-sub">Nothing in the dead letter queue.</div></div>
      ) : dead.map((d) => (
        <div className="row" key={d.id}>
          <div className="row-main">
            <div className="row-title">{d.task_id ?? d.id}</div>
            <div className="row-sub">{d.attempts} attempts · {d.error}</div>
          </div>
          <div className="row-actions">
            <button className="btn btn-small" onClick={() => act(d.id, () => api.requeueDeadLetter(d.id))}>
              Requeue
            </button>
            <button className="btn btn-small btn-defer" onClick={() => act(d.id, () => api.dismissDeadLetter(d.id))}>
              Dismiss
            </button>
          </div>
        </div>
      ))}

      <p className="eyebrow">Nightly runs</p>
      {(data.cron_runs ?? []).slice(0, 5).map((r: any) => (
        <div className="row" key={r.id}>
          <div className="row-main">
            <div className="row-title">{new Date(r.started_at).toLocaleString()}</div>
            <div className="row-sub">
              {(safeParse(r.steps) ?? []).map((s: any) => `${s.name} ${s.status}`).join(" · ") || "no steps recorded"}
            </div>
          </div>
          <div className="row-val">{r.status}</div>
        </div>
      ))}

      <p className="eyebrow">Recent events</p>
      {(data.events ?? []).slice(0, 40).map((e: any) => (
        <div className="row" key={e.id}>
          <div className="row-main">
            <div className="row-title">{e.scope} · {e.event.replace(/_/g, " ")}</div>
            <div className="row-sub mono">{e.detail ?? ""}</div>
          </div>
          <div className={`row-val level-${e.level}`}>{e.level}</div>
        </div>
      ))}
    </>
  );
}

function safeParse(raw: unknown) {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Governance — canon v10.10's operating layer.
 *
 * The mode card first, because it is the answer to "what am I allowed to do
 * right now". The state comes next, since it is the thing that changes the
 * answer, and it is recorded here rather than inferred anywhere.
 */
function Governance() {
  const [card, setCard] = useState<any | null>(null);
  const [state, setState] = useState<any | null>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [playbooks, setPlaybooks] = useState<any | null>(null);
  const [dependency, setDependency] = useState<any | null>(null);
  const [maintenance, setMaintenance] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    Promise.all([
      api.modeCard(), api.governanceState(), api.complianceFlags(),
      api.playbooks(), api.antiDependency(), api.maintenance(),
    ])
      .then(([c, s, f, p, d, m]) => { setCard(c); setState(s); setFlags(f); setPlaybooks(p); setDependency(d); setMaintenance(m); })
      .catch(setError);
  }
  useEffect(load, []);

  async function record(stateName: string, riskClass: string) {
    setBusy(true); setError(null);
    try { await api.recordState({ state: stateName, risk_class: riskClass, hours: 12 }); load(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (!card || !state) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Mode card</p>
      <div className="panel">
        <div className="row-sub">Cost mode: {card.cost_mode}</div>
        <div className="row-sub">
          State: {card.emotional_state.state} · {card.emotional_state.risk_class} risk
        </div>
        <div className="row-sub">
          Trading: {card.trading.kill_switch ? "kill switch engaged" : "clear"} ·
          {card.trading.live_enabled ? " live enabled" : " live denied"}
        </div>
        <p className="row-sub">{card.boundary}</p>
        {card.protected_actions.map((a: any) => (
          <div className="row" key={a.action_class}>
            <div className="row-main"><div className="row-title">{a.label}</div></div>
            <div className="row-val">{a.allowed_now ? "open" : "held"}</div>
          </div>
        ))}
      </div>

      <p className="eyebrow">Where you are</p>
      <div className="panel">
        <p className="row-sub">{state.note}</p>
        <div className="btn-row">
          {["steady", "stretched", "activated", "depleted", "grieving", "elated"].map((s) => (
            <button key={s} className="btn btn-small" disabled={busy}
                    onClick={() => record(s, s === "steady" || s === "elated" ? "low" : s === "stretched" ? "elevated" : "high")}>
              {s}
            </button>
          ))}
        </div>
        {state.current.risk_class === "high" && (
          <button className="btn" style={{ width: "100%" }} disabled={busy}
                  onClick={() => api.clearState().then(load).catch(setError)}>
            Clear the hold
          </button>
        )}
      </div>

      <p className="eyebrow">Flags</p>
      {flags.length === 0 ? (
        <div className="row-sub">Nothing on the board.</div>
      ) : (
        flags.map((f) => (
          <div className="row" key={f.id}>
            <div className="row-main">
              <div className="row-title">{f.summary}</div>
              <div className="row-sub">{f.watch_key.replace(/_/g, " ")} · {new Date(f.ts).toLocaleString()}</div>
            </div>
            <div className={`risk risk-${f.severity === "high" ? "high" : "medium"}`}>{f.severity}</div>
          </div>
        ))
      )}
      <div className="btn-row">
        <button className="btn" onClick={() => api.runSentinel().then(load).catch(setError)}>Run the sentinel</button>
      </div>

      {(playbooks?.applies_now ?? []).length > 0 && (
        <>
          <p className="eyebrow">Playbooks that apply right now</p>
          {playbooks.applies_now.map((p: any) => (
            <details key={p.key}>
              <summary className="docket-more" style={{ cursor: "pointer" }}>{p.title}</summary>
              <div className="docket-full">
                <div className="row-sub">{p.condition_text}</div>
                <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {p.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            </details>
          ))}
        </>
      )}

      <p className="eyebrow">If this system vanished tonight</p>
      {(dependency?.checks ?? []).map((c: any) => (
        <div className="row" key={c.key}>
          <div className="row-main">
            <div className="row-title">{c.question}</div>
            <div className="row-sub">{c.detail}</div>
          </div>
          <div className="row-val">{c.pass ? "yes" : "no"}</div>
        </div>
      ))}
      {dependency && <p className="row-sub">{dependency.verdict}</p>}

      <p className="eyebrow">Maintenance</p>
      {(maintenance?.items ?? []).map((m: any) => (
        <div className="row" key={m.key}>
          <div className="row-main">
            <div className="row-title">{m.title}</div>
            <div className="row-sub">every {m.cadence_days} days · {m.note}</div>
          </div>
          <div className="row-actions">
            <button className="btn btn-small" onClick={() => api.maintenanceDone(m.key).then(load).catch(setError)}>
              {m.overdue ? "Overdue — done" : "Done"}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
