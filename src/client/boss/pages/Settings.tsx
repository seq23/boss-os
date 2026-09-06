import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../../../shared/boss/types";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { asList } from "../components/panels";

type Panel = "overview" | "cost" | "audit" | "health" | "diagnostics" | "governance";

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
        {(["overview", "cost", "audit", "health", "diagnostics", "governance"] as Panel[]).map((p) => (
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

          <SpendLever budgets={asList(status?.budgets)} />

          <p className="eyebrow">Budgets</p>
          {asList(status?.budgets).map((b: any) => (
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
      {panel === "audit" && <AuditPanel />}
      {panel === "health" && <HealthPanel />}
      {panel === "diagnostics" && <DiagnosticsPanel />}
      {panel === "governance" && <Governance />}
    </>
  );
}

/* ─── The spend lever ─────────────────────────────────────────────────────── */

const POSITIONS: { id: string; label: string; note: string }[] = [
  { id: "FREE_ONLY", label: "Free only", note: "$0. Only routes that cost nothing may run." },
  { id: "MODERATE", label: "Moderate", note: "Up to a figure you set, per backend, per month." },
  { id: "OPEN", label: "Open", note: "No dollar ceiling. Spend still accrues and is still shown." },
];

/**
 * ONE GRADUATED CONTROL OVER MONEY — and it is NOT the cost mode above it.
 *
 * The six cost modes decide which model tiers are good enough. This decides how much money may be
 * spent. Merging them would make both unusable: "use a better model" and "spend more" are separate
 * decisions, and a single list that did both would force one every time she meant the other. They
 * are deliberately different controls, in different shapes, with a rule between them.
 *
 * THE FIGURE IS ALWAYS ON SCREEN, AT EVERY POSITION. Under FREE_ONLY and MODERATE it is spend
 * against a limit. Under OPEN there is no limit to show it against — so the accruing number is
 * shown alone, because a figure with no ceiling is still the figure standing between her and a
 * surprise. `src/worker/boss/router/spend.ts` keeps `spent_micros` accruing at every position for
 * exactly this reason.
 *
 * OPEN LOOKS DIFFERENT, AND IS NOT SCOLDED. She chose it. Being warned about her own decision every
 * time she opens Settings is worse than useless — it trains her to skip the panel. So: no red, no
 * modal, no alert copy. One quiet difference, in `--rose`, which already carries "this is
 * consequential" elsewhere in this app, so a glance is enough to see that nothing is bounding spend.
 */
function SpendLever({ budgets }: { budgets: any[] }) {
  const [lever, setLever] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    api.spendLever()
      .then((d) => live && (setLever(d), setError(null)))
      .catch((e) => live && setError(e));
    return () => { live = false; };
  }, [nonce]);

  /*
   * THE FALLBACK SPEND FIGURE, so the panel is never silent about money.
   *
   * The lever's own endpoint is the authority. If it cannot be read, the ops month budget is
   * already in hand from `/system/status` and carries the same accruing `spent_micros` — so the
   * panel says the lever could not be read AND still shows what has been spent, rather than going
   * blank on the one number that matters most when something is wrong.
   */
  const opsMonth = budgets.find((b: any) => b.lane === "ops" && b.period === "month") ?? budgets[0] ?? null;
  const position = String(lever?.position ?? (opsMonth && opsMonth.hard_stop === 0 ? "OPEN" : "FREE_ONLY"));
  const open = position === "OPEN";
  const spent = Number(lever?.spent_micros ?? opsMonth?.spent_micros ?? 0);
  const allowance = Number(lever?.allowance_micros ?? lever?.allowanceMicros ?? opsMonth?.limit_micros ?? 0);
  const moderate = Number(lever?.moderate_micros ?? lever?.moderateMicros ?? opsMonth?.limit_micros ?? 0);
  const pct = allowance > 0 ? Math.min(100, Math.round((spent / allowance) * 100)) : 0;

  async function move(next: { position?: string; moderate_micros?: number }) {
    setSaving(true);
    setError(null);
    try {
      await api.setSpendLever(next);
      setDraft(null);
      setNonce((n) => n + 1);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Spend lever</p>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <p className="row-sub">
        How much money the router may spend. Separate from cost mode above, which decides how good a
        model may be — not how much it may cost.
      </p>

      {lever === null && !error ? (
        <Loading />
      ) : (
        <>
          <div className="lever">
            {POSITIONS.map((p) => (
              <button
                key={p.id}
                className={p.id === "OPEN" ? "lever-btn lever-open" : "lever-btn"}
                aria-pressed={position === p.id}
                disabled={saving}
                onClick={() => move({ position: p.id })}
              >
                <span className="lever-l">{p.label}</span>
                <span className="lever-note">{p.note}</span>
              </button>
            ))}
          </div>

          {position === "MODERATE" && (
            <label className="field">
              <span>Moderate's figure, in dollars — change it whenever</span>
              <input
                inputMode="decimal"
                value={draft ?? (moderate / 1_000_000).toFixed(2)}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
          )}
          {position === "MODERATE" && draft !== null && (
            <button
              className="btn btn-approve btn-wide"
              disabled={saving || !Number.isFinite(Number(draft)) || Number(draft) < 0}
              onClick={() => move({ position: "MODERATE", moderate_micros: Math.round(Number(draft) * 1_000_000) })}
            >
              {saving ? "Setting…" : `Set the ceiling to $${(Number(draft) || 0).toFixed(2)}`}
            </button>
          )}

          {/*
            * THE NUMBER, AT EVERY POSITION. Two shapes, because there are two truths: a figure
            * against a ceiling, and a figure with none.
            */}
          <div className={open ? "spendfig spendfig-open" : "spendfig"}>
            <div className="spendfig-n">{usd(spent)}</div>
            <div className="spendfig-l">
              {open
                ? "spent this window · nothing is bounding it"
                : `spent of ${usd(allowance)} allowed this window`}
            </div>
            {!open && (
              <div className="meter"><span style={{ width: `${pct}%` }} /></div>
            )}
          </div>

          {error && (
            <p className="row-sub">
              The lever itself could not be read, so the position shown is inferred from the budget
              rows and the figure above is the ops month spend. Moving it will not take effect until
              the endpoint answers.
            </p>
          )}
          {!error && lever?.remedy && <p className="row-sub">{lever.remedy}</p>}
        </>
      )}
    </>
  );
}

/**
 * THE AUDIT TRAIL AND THE SPEND LEDGER, both of which had endpoints and no screen.
 *
 * `/system/audit`, `/system/usage` and `/system/settings` all worked and were reachable only with
 * curl. The audit log is the answer to "what actually happened", and BOSS_OS_DEPLOY.md's own
 * reference table points at it as the place every state change is recorded - so leaving it
 * unreadable from inside the product made the system's own documentation impossible to follow
 * without a terminal.
 *
 * READ-ONLY, ALL THREE. `audit_log` is append-only by design; a screen that offered to edit it
 * would be offering to break the one property that makes it worth having.
 */
function AuditPanel() {
  const [audit, setAudit] = useState<any[] | null>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([api.audit(), api.usage(), api.settings()])
      .then(([a, u, st]) => { setAudit(a); setUsage(u); setSettings(st); })
      .catch((e) => { setError(e); setAudit([]); });
  }, []);

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Spend by model</p>
      {usage.length === 0 ? (
        <Empty title="Nothing has been spent" hint="Every model call writes a row here with what it cost." />
      ) : (
        usage.slice(0, 20).map((u: any, i: number) => (
          <div className="row" key={u.id ?? i}>
            <div className="row-main">
              <div className="row-title">{u.model_id ?? u.model ?? "—"}</div>
              <div className="row-sub">{[u.lane, u.kind].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <div className="row-val">
              {u.cost_micros === undefined ? "—" : `$${(Number(u.cost_micros) / 1_000_000).toFixed(4)}`}
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Settings on record</p>
      {settings.length === 0 ? (
        <Empty title="No settings recorded" hint="Settings written by the system appear here with their current value." />
      ) : (
        settings.map((st: any, i: number) => (
          <div className="row" key={st.key ?? i}>
            <div className="row-main"><div className="row-title">{st.key}</div></div>
            <div className="row-val">{String(st.value ?? "—")}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Audit trail</p>
      {audit === null ? (
        <Loading />
      ) : audit.length === 0 ? (
        <Empty title="Nothing recorded yet" hint="Every state change lands here. It is append-only: a mistake is corrected with a new row, never by editing one." />
      ) : (
        audit.slice(0, 50).map((a: any, i: number) => (
          <div className="row" key={a.id ?? i}>
            <div className="row-main">
              <div className="row-title">{[a.entity_type, a.action].filter(Boolean).join(" ") || "—"}</div>
              <div className="row-sub">
                {[a.actor, a.entity_id].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="row-val">{a.ts ? new Date(a.ts).toLocaleString() : "—"}</div>
          </div>
        ))
      )}
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
