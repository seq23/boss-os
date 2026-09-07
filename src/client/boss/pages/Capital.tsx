import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * Capital — Investor OS and the Wealth Command Center on one screen.
 *
 * Canon §41's Deal Energy Protection decides the layout as much as the code
 * does: the pipeline is the first thing on the screen, the focused deal sits
 * under it as a subordinate object, and a thin pipeline behind a focused deal
 * is shown as a warning rather than as conviction.
 */

const USD = 1_000_000;
const BPS = 10_000;

const usd = (micros: number) =>
  micros >= 1_000 * USD
    ? `$${(micros / USD / 1000).toFixed(micros >= 10_000 * USD ? 0 : 1)}k`
    : `$${(micros / USD).toFixed(0)}`;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const day = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : "—");

type View = "deals" | "buyers" | "return" | "decisions" | "wealth";

const VIEW_LABEL: Record<View, string> = {
  deals: "Deal flow",
  buyers: "Buyers",
  return: "Return",
  decisions: "Decisions",
  wealth: "Wealth",
};

export function Capital() {
  const [view, setView] = useState<View>("deals");

  return (
    <>
      <div className="btn-row">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <button key={v} className="btn" aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      {view === "deals" ? <Deals />
        : view === "buyers" ? <Buyers />
        : view === "return" ? <ReturnLedger />
        : view === "decisions" ? <Decisions />
        : <Wealth />}
    </>
  );
}

// ─── Buyers, and the overlaps with the LP list ────────────────────────────────

/**
 * The buyer candidates Camille's sweep produces, and her verdict on each.
 *
 * THIS SCREEN IS A FIX, NOT A FEATURE. The endpoints have existed since 0185 and no page called
 * them, so eleven candidates sat at status `new` from the day they were found — visible on Today
 * only as a number in the Wealth pillar, with no way to review one. The sweep ran three mornings a
 * week into a list nobody could work.
 *
 * The cross-matches sit on this screen rather than their own because they are a fact ABOUT a buyer:
 * "this firm is already in your LP sequence" is something to know while deciding whether to contact
 * them, and a separate page would be read once.
 */
function Buyers() {
  const [data, setData] = useState<any | null>(null);
  const [matches, setMatches] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.sourcing(), api.crossmatches()])
      .then(([s, x]) => { setData(s); setMatches(x); })
      .catch((e) => { setError(e); setData({ candidates: [] }); setMatches({ confirmed: [], near: [] }); });
  }
  useEffect(load, []);

  async function mark(id: string, status: string) {
    setError(null);
    try { await api.setSourcingStatus(id, { status }); load(); } catch (e) { setError(e); }
  }
  async function markMatch(id: string, status: string) {
    setError(null);
    try { await api.setCrossmatchStatus(id, { status }); load(); } catch (e) { setError(e); }
  }

  if (!data) return <Loading />;
  const confirmed = matches?.confirmed ?? [];
  const near = matches?.near ?? [];
  const byCandidate = new Map<string, any[]>();
  for (const m of confirmed) byCandidate.set(m.candidate_id, [...(byCandidate.get(m.candidate_id) ?? []), m]);

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="stats">
        <div className="stat"><div className="stat-n">{data.total ?? 0}</div><div className="stat-l">candidates</div></div>
        <div className="stat"><div className="stat-n">{data.awaiting_review ?? 0}</div><div className="stat-l">awaiting you</div></div>
        <div className="stat"><div className="stat-n">{confirmed.length}</div><div className="stat-l">also LPs</div></div>
      </div>

      {confirmed.length > 0 && (
        <>
          <p className="eyebrow">Already in the LP universe</p>
          {confirmed.map((m: any) => (
            <div className="row" key={m.id}>
              <div className="row-main">
                <div className="row-title">{m.candidate_name} · {m.lp_firm}</div>
                <div className="row-sub">{m.why}</div>
                <div className="row-sub">
                  {m.lp_list === "sequence" ? "in the LP sequence" : "on the LP do-not-contact list"}
                  {m.lp_type ? ` · ${m.lp_type}` : ""}
                  {m.lp_contacts ? ` · ${m.lp_contacts} contact${m.lp_contacts === 1 ? "" : "s"}` : ""}
                  {m.lp_last_sent ? ` · last ${m.lp_last_sent}` : ""}
                </div>
              </div>
              <div className="row-actions">
                {m.status === "new" ? (
                  <>
                    <button className="btn btn-small" onClick={() => markMatch(m.id, "reviewed")}>Seen</button>
                    <button className="btn btn-small btn-defer" onClick={() => markMatch(m.id, "rejected")}>Not the same firm</button>
                  </>
                ) : <span className="row-val">{m.status}</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {near.length > 0 && (
        <details>
          <summary className="docket-more" style={{ cursor: "pointer" }}>
            {near.length} near-miss{near.length === 1 ? "" : "es"} — similar names, NOT treated as the same firm
          </summary>
          <div className="docket-full">
            {near.map((m: any) => (
              <div className="row" key={m.id}>
                <div className="row-main">
                  <div className="row-title">{m.candidate_name} ≈ {m.lp_firm}</div>
                  <div className="row-sub">{m.why}</div>
                </div>
                <div className="row-val">check yourself</div>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="eyebrow">Candidates</p>
      {(data.candidates ?? []).length === 0 ? (
        <Empty title="No buyer candidates" hint="Camille's sweep runs Monday, Wednesday and Friday at 06:45." />
      ) : (
        data.candidates.map((cand: any) => (
          <div className="row" key={cand.id}>
            <div className="row-main">
              <div className="row-title">
                {cand.name}
                {byCandidate.has(cand.id) && <span className="row-val"> · also an LP prospect</span>}
              </div>
              <div className="row-sub">{cand.thesis}</div>
              <div className="row-sub">
                {cand.ticket_floor_usd ? `floor $${(cand.ticket_floor_usd / 1_000_000).toFixed(0)}M · ` : ""}
                {cand.source_url ? <a href={cand.source_url} target="_blank" rel="noreferrer">source</a> : "no source"}
              </div>
            </div>
            <div className="row-actions">
              {cand.status === "new" ? (
                <>
                  <button className="btn btn-small" onClick={() => mark(cand.id, "reviewed")}>Reviewed</button>
                  <button className="btn btn-small btn-approve" onClick={() => mark(cand.id, "contacted")}>Contacted</button>
                  <button className="btn btn-small btn-defer" onClick={() => mark(cand.id, "rejected")}>Reject</button>
                </>
              ) : <span className="row-val">{cand.status}</span>}
            </div>
          </div>
        ))
      )}
    </>
  );
}

// ─── Return on effort ─────────────────────────────────────────────────────────

/**
 * Effort against outcome, per income line.
 *
 * THE LAYOUT CARRIES THE ARGUMENT. Ratios are the headline and totals are never shown alone;
 * "unmeasured" is rendered as its own state with the sentence saying why, never as a zero; and the
 * lines are in her own order with the reason for not ranking them printed on the screen rather than
 * only enforced in the code that builds it.
 */
function ReturnLedger() {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { setData(null); api.lineReturns(period).then(setData).catch(setError); }, [period]);
  if (error && !data) return <ErrorNotice error={error} onDismiss={() => setError(null)} />;
  if (!data) return <Loading />;

  const shift = (months: number) => {
    const [y, m] = data.period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 15));
    setPeriod(d.toISOString().slice(0, 7));
  };

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="btn-row">
        <button className="btn btn-small" onClick={() => shift(-1)}>← earlier</button>
        <span className="row-val">{data.period_label}</span>
        <button className="btn btn-small" onClick={() => shift(1)}>later →</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-n">{data.measured_lines}</div><div className="stat-l">measured</div></div>
        <div className="stat"><div className="stat-n">{data.unmeasured_lines}</div><div className="stat-l">unmeasured</div></div>
        <div className="stat"><div className="stat-n">{data.lines.length}</div><div className="stat-l">lines</div></div>
      </div>

      {data.lifetime.length > 0 && (
        <>
          <p className="eyebrow">All time — not part of the month, and never added to it</p>
          {data.lifetime.map((r: any, i: number) => <PairRow key={`lt${i}`} pair={r} />)}
        </>
      )}

      <p className="eyebrow">{data.period_label}</p>
      {data.lines.map((line: any) => (
        <div className="panel" key={line.line}>
          <div className="row-title">{line.name}</div>
          <div className="row-sub">{line.lane} · {line.status}{line.measured ? "" : " · unmeasured"}</div>
          {line.pairs.map((p: any, i: number) => <PairRow key={i} pair={p} />)}
        </div>
      ))}

      <p className="row-sub">{data.ordering_note}</p>
    </>
  );
}

/**
 * One effort→outcome pair.
 *
 * A MEASURED ZERO AND AN UNMEASURED BLANK LOOK DIFFERENT ON PURPOSE. "0 of 11" is a result; "not
 * measured" carries the sentence saying what is missing and how to fill it. Rendering the second as
 * the first is the mistake that would make her abandon a line that is merely unobserved.
 */
function PairRow({ pair }: { pair: any }) {
  const measured = pair.outcome_count !== null && pair.outcome_count !== undefined;
  const blind = pair.kind === "blind_spot";
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">
          {blind
            ? `Not visible anywhere in this system: ${pair.outcome_label}`
            : measured
              ? `${pair.outcome_count} ${pair.outcome_label} from ${pair.effort_count} ${pair.effort_label}`
              : `${pair.effort_count} ${pair.effort_label} — ${pair.outcome_label} not measured`}
        </div>
        {!measured && <div className="row-sub">{pair.unmeasured_why}</div>}
        {pair.note && <div className="row-sub">{pair.note}</div>}
        <div className="row-sub">
          {pair.source === "computed" ? "from this system" : pair.source === "none" ? "no source" : `contributed · ${pair.source}`}
          {pair.window_days ? ` · ${pair.window_days} days` : ""}
        </div>
      </div>
      <div className="row-val">
        {blind ? "blind spot"
          : pair.per_mille === null || pair.per_mille === undefined
            ? measured ? "—" : "unmeasured"
            : `${pair.per_mille} per 1,000`}
      </div>
    </div>
  );
}

// ─── Deal flow ────────────────────────────────────────────────────────────────

function Deals() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);

  function load() { api.deals().then(setData).catch((e) => { setError(e); setData({ deals: [] }); }); }
  useEffect(load, []);

  async function focus(id: string, on: boolean) {
    setError(null);
    try { on ? await api.focusDeal(id) : await api.releaseDeal(id); load(); }
    catch (e) { setError(e); }
  }

  if (!data) return <Loading />;
  const { pipeline, focus: focused, energy, deals } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/* The pipeline is read first. Canon §41 calls that the protection. */}
      <p className="eyebrow">Pipeline</p>
      <div className="stats">
        <div className="stat"><div className="stat-n">{pipeline.active}</div><div className="stat-l">active</div></div>
        <div className="stat"><div className="stat-n">{pipeline.total}</div><div className="stat-l">on file</div></div>
        <div className="stat"><div className="stat-n">{usd(pipeline.committed_micros)}</div><div className="stat-l">committed</div></div>
      </div>
      <div className="row">
        <div className="row-main">
          <div className="row-sub">
            {Object.entries(pipeline.by_stage ?? {}).map(([stage, n]) => `${stage} ${n}`).join(" · ") || "Nothing sourced yet"}
          </div>
        </div>
      </div>

      {energy.warnings.length > 0 && (
        <>
          <p className="eyebrow">Deal energy</p>
          {energy.warnings.map((w: any, i: number) => (
            <div className="row" key={i}>
              <div className="row-main"><div className="row-title">{w.text}</div></div>
              <div className="risk risk-medium">energy</div>
            </div>
          ))}
        </>
      )}

      <p className="eyebrow">Focus</p>
      {focused ? (
        <div className="row">
          <div className="row-main">
            <div className="row-title">{focused.name}</div>
            <div className="row-sub">
              {focused.stage} · {usd(focused.check_size_micros)} · focused since {day(focused.focus_since)}
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-small btn-defer" onClick={() => focus(focused.id, false)}>Release</button>
          </div>
        </div>
      ) : (
        <Empty title="No deal has focus" hint="One deal may hold it at a time. The pipeline is the primary object." />
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Source a deal"}</button>
      </div>
      {adding && <AddDeal onDone={() => { setAdding(false); load(); }} />}

      <p className="eyebrow">Deals</p>
      {deals.length === 0 ? (
        <Empty title="Nothing in the pipeline" hint="A pipeline with one deal in it is a bet, not a pipeline." />
      ) : (
        deals.map((d: any) => (
          <div className="row" key={d.id}>
            <div className="row-main">
              <div className="row-title">{d.name}</div>
              <div className="row-sub">
                {[d.stage, d.organization_name, usd(d.check_size_micros)].filter(Boolean).join(" · ")}
              </div>
              {d.next_step && <div className="row-sub">Next: {d.next_step}{d.next_step_due_at ? ` (${day(d.next_step_due_at)})` : ""}</div>}
            </div>
            <div className="row-actions">
              {d.energy === "focus" ? (
                <span className="row-val">focus</span>
              ) : (
                <button className="btn btn-small" onClick={() => focus(d.id, true)}>Focus</button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}

function AddDeal({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [check, setCheck] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.createDeal({
        name,
        check_size_micros: Math.round((Number(check) || 0) * USD),
        next_step: nextStep || null,
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Cheque size (USD)</span>
        <input value={check} onChange={(e) => setCheck(e.target.value)} inputMode="numeric" /></label>
      <label className="field"><span>Next step</span>
        <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} /></label>
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !name.trim()} onClick={submit}>
        {busy ? "Saving…" : "Source it"}
      </button>
    </div>
  );
}

// ─── Decisions, predictions, calibration ──────────────────────────────────────

function Decisions() {
  const [decisions, setDecisions] = useState<any[] | null>(null);
  const [calibration, setCalibration] = useState<any | null>(null);
  const [open, setOpen] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    Promise.all([api.decisionJournal(), api.calibration(), api.predictions("open")])
      .then(([d, c, p]) => { setDecisions(d); setCalibration(c); setOpen(p); })
      .catch((e) => { setError(e); setDecisions([]); });
  }
  useEffect(load, []);

  if (openDecision) return <Decision id={openDecision} onBack={() => { setOpenDecision(null); load(); }} />;
  if (decisions === null) return <Loading />;

  const latest = calibration?.latest ?? null;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Calibration</p>
      {latest ? (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-n">{latest.predictions_scored}</div><div className="stat-l">scored</div></div>
            <div className="stat"><div className="stat-n">{(latest.brier_score_bps / BPS).toFixed(2)}</div><div className="stat-l">brier</div></div>
            <div className="stat">
              <div className="stat-n">{latest.overconfidence_bps > 0 ? `+${pct(latest.overconfidence_bps)}` : pct(latest.overconfidence_bps)}</div>
              <div className="stat-l">over/under</div>
            </div>
          </div>
          <details>
            <summary className="docket-more" style={{ cursor: "pointer" }}>Where the forecasting is off</summary>
            <div className="docket-full">
              {latest.buckets.map((b: any) => (
                <div className="row" key={b.from_bps}>
                  <div className="row-main">
                    <div className="row-title">{pct(b.from_bps)}–{pct(b.to_bps)}</div>
                    <div className="row-sub">
                      said {pct(b.mean_probability_bps)}, happened {pct(b.hit_rate_bps)} · {b.n} forecast{b.n === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="row-val">{b.gap_bps > 0 ? `+${pct(b.gap_bps)}` : pct(b.gap_bps)}</div>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <Empty title="Nothing scored yet" hint={calibration?.note ?? "A calibration score appears when the first prediction resolves."} />
      )}

      {(calibration?.due_for_resolution ?? []).length > 0 && (
        <>
          <p className="eyebrow">Past their date</p>
          {calibration.due_for_resolution.map((p: any) => (
            <ResolvePrediction key={p.id} prediction={p} onDone={load} />
          ))}
        </>
      )}

      {open.length > 0 && (
        <>
          <p className="eyebrow">Open forecasts</p>
          {open.slice(0, 10).map((p: any) => (
            <div className="row" key={p.id}>
              <div className="row-main">
                <div className="row-title">{p.statement}</div>
                <div className="row-sub">{pct(p.probability_bps)} · resolves {day(p.resolves_at)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Open a decision"}</button>
      </div>
      {adding && <AddDecision onDone={(id) => { setAdding(false); load(); setOpenDecision(id); }} />}

      <p className="eyebrow">Decision journal</p>
      {decisions.length === 0 ? (
        <Empty title="Nothing recorded" hint="A decision is challenged before it is committed, and carries a prediction." />
      ) : (
        decisions.map((d: any) => (
          <div className="row" key={d.id}>
            <div className="row-main">
              <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                      onClick={() => setOpenDecision(d.id)}>
                {d.title}
              </button>
              <div className="row-sub">
                {d.stakes} stakes · {d.challenges} challenge{d.challenges === 1 ? "" : "s"} ·
                {" "}{d.predictions_count} forecast{d.predictions_count === 1 ? "" : "s"}
                {d.predictions_open ? ` (${d.predictions_open} open)` : ""}
              </div>
            </div>
            <div className="row-val">{d.status}</div>
          </div>
        ))
      )}
    </>
  );
}

function ResolvePrediction({ prediction, onDone }: { prediction: any; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function resolve(outcome: "true" | "false" | "ambiguous") {
    setBusy(true); setError(null);
    try { await api.resolvePrediction(prediction.id, { outcome }); onDone(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="row">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <div className="row-main">
        <div className="row-title">{prediction.statement}</div>
        <div className="row-sub">said {pct(prediction.probability_bps)} · due {day(prediction.resolves_at)}</div>
        <div className="row-sub">{prediction.resolution_criteria}</div>
      </div>
      <div className="row-actions">
        <button className="btn btn-small btn-approve" disabled={busy} onClick={() => resolve("true")}>Happened</button>
        <button className="btn btn-small btn-defer" disabled={busy} onClick={() => resolve("false")}>Did not</button>
        <button className="btn btn-small" disabled={busy} onClick={() => resolve("ambiguous")}>Unclear</button>
      </div>
    </div>
  );
}

function Decision({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<"red_team" | "prediction" | "commit" | null>(null);

  function load() { api.decision(id).then(setData).catch(setError); }
  useEffect(load, [id]);

  if (!data) return <Loading />;
  const { decision, red_team, predictions } = data;
  const latestVerdict = red_team[0]?.verdict ?? null;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{decision.title}</h3>
        <p className="row-sub">{decision.kind} · {decision.stakes} stakes · {decision.reversible ? "reversible" : "one-way door"} · {decision.status}</p>
        <p>{decision.context}</p>
        <p className="eyebrow">Options</p>
        {decision.options.map((o: any, i: number) => (
          <div className="row-sub" key={i}>
            {o.option === decision.chosen_option ? "→ " : "· "}{o.option}{o.why ? ` — ${o.why}` : ""}{o.why_not ? ` — against: ${o.why_not}` : ""}
          </div>
        ))}
        {decision.rationale && <><p className="eyebrow">Rationale</p><p>{decision.rationale}</p></>}
        {decision.red_team_override && (
          <div className="notice" style={{ borderColor: "var(--gold)" }}>
            Committed over a kill verdict: {decision.red_team_override.reason}
          </div>
        )}
        {decision.outcome && (
          <>
            <p className="eyebrow">Outcome</p>
            <p>{decision.outcome.summary}</p>
            {decision.outcome.lesson && <p className="row-sub">Lesson: {decision.outcome.lesson}</p>}
          </>
        )}
      </div>

      <p className="eyebrow">Red team</p>
      {red_team.length === 0 ? (
        <Empty title="Not challenged yet" hint="The challenge runs before commitment. Nothing commits without one." />
      ) : (
        red_team.map((r: any) => (
          <div className="panel" key={r.id}>
            <div className="row-sub">{r.challenger} · {day(r.ts)} · verdict: {r.verdict}</div>
            <p className="eyebrow">How this loses</p>
            {r.ways_this_loses.map((w: string, i: number) => <div className="row-sub" key={i}>· {w}</div>)}
            <p className="eyebrow">Disconfirming evidence</p>
            {r.disconfirming_evidence.map((w: string, i: number) => <div className="row-sub" key={i}>· {w}</div>)}
            <p className="eyebrow">Walk away when</p>
            <div className="row-sub">{r.walk_away_line}</div>
            {r.changes_required.length > 0 && (
              <>
                <p className="eyebrow">Changes required</p>
                {r.changes_required.map((w: string, i: number) => <div className="row-sub" key={i}>· {w}</div>)}
              </>
            )}
          </div>
        ))
      )}

      <p className="eyebrow">Forecasts</p>
      {predictions.length === 0 ? (
        <Empty title="Nothing predicted" hint="Anything above low stakes commits with a falsifiable forecast attached." />
      ) : (
        predictions.map((p: any) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div className="row-title">{p.statement}</div>
              <div className="row-sub">
                said {pct(p.probability_bps)} · resolves {day(p.resolves_at)}
                {p.status === "resolved" ? ` · ${p.outcome}${p.brier_bps !== null ? ` · brier ${(p.brier_bps / BPS).toFixed(2)}` : ""}` : ""}
              </div>
            </div>
            <div className="row-val">{p.status}</div>
          </div>
        ))
      )}

      {decision.status === "draft" && (
        <div className="btn-row">
          <button className="btn" onClick={() => setForm(form === "red_team" ? null : "red_team")}>Red team it</button>
          <button className="btn" onClick={() => setForm(form === "prediction" ? null : "prediction")}>Add a forecast</button>
          <button className="btn btn-approve" onClick={() => setForm(form === "commit" ? null : "commit")}>Commit</button>
        </div>
      )}

      {form === "red_team" && <RedTeamForm id={id} onDone={() => { setForm(null); load(); }} />}
      {form === "prediction" && <PredictionForm decisionId={id} onDone={() => { setForm(null); load(); }} />}
      {form === "commit" && (
        <CommitForm
          id={id}
          options={decision.options.map((o: any) => o.option)}
          killed={latestVerdict === "kill"}
          onDone={() => { setForm(null); load(); }}
        />
      )}
    </>
  );
}

function lines(value: string) {
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

function RedTeamForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [loses, setLoses] = useState("");
  const [evidence, setEvidence] = useState("");
  const [walkAway, setWalkAway] = useState("");
  const [verdict, setVerdict] = useState("proceed");
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.redTeam(id, {
        ways_this_loses: lines(loses),
        disconfirming_evidence: lines(evidence),
        walk_away_line: walkAway,
        verdict,
        changes_required: lines(changes),
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>Three ways this loses money — one per line</span>
        <textarea rows={3} value={loses} onChange={(e) => setLoses(e.target.value)} /></label>
      <label className="field"><span>Disconfirming evidence — one per line</span>
        <textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      <label className="field"><span>The walk-away line</span>
        <input value={walkAway} onChange={(e) => setWalkAway(e.target.value)} /></label>
      <label className="field"><span>Verdict</span>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          <option value="proceed">proceed</option>
          <option value="proceed_with_changes">proceed with changes</option>
          <option value="kill">kill</option>
        </select>
      </label>
      {verdict === "proceed_with_changes" && (
        <label className="field"><span>Changes required — one per line</span>
          <textarea rows={2} value={changes} onChange={(e) => setChanges(e.target.value)} /></label>
      )}
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy} onClick={submit}>
        {busy ? "Saving…" : "Record the challenge"}
      </button>
    </div>
  );
}

function PredictionForm({ decisionId, onDone }: { decisionId: string | null; onDone: () => void }) {
  const [statement, setStatement] = useState("");
  const [probability, setProbability] = useState("70");
  const [criteria, setCriteria] = useState("");
  const [when, setWhen] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.createPrediction({
        decision_id: decisionId,
        statement,
        probability_bps: Math.round(Number(probability) * 100),
        resolution_criteria: criteria,
        resolves_at: new Date(`${when}T12:00:00.000Z`).getTime(),
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>What you expect</span>
        <textarea rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} /></label>
      <label className="field"><span>How likely (%)</span>
        <input value={probability} onChange={(e) => setProbability(e.target.value)} inputMode="numeric" /></label>
      <label className="field"><span>What would settle it</span>
        <textarea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></label>
      <label className="field"><span>By when</span>
        <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <p className="row-sub">0% and 100% are refused. Certainty is not a forecast.</p>
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !statement.trim()} onClick={submit}>
        {busy ? "Saving…" : "Record the forecast"}
      </button>
    </div>
  );
}

function CommitForm({ id, options, killed, onDone }: {
  id: string; options: string[]; killed: boolean; onDone: () => void;
}) {
  const [chosen, setChosen] = useState(options[0] ?? "");
  const [rationale, setRationale] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.commitDecision(id, {
        chosen_option: chosen,
        rationale,
        override_reason: override || undefined,
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>Choosing</span>
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <label className="field"><span>Why</span>
        <textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      {killed && (
        <label className="field"><span>The red team said kill. Why are you doing it anyway?</span>
          <textarea rows={2} value={override} onChange={(e) => setOverride(e.target.value)} /></label>
      )}
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !rationale.trim()} onClick={submit}>
        {busy ? "Committing…" : "Commit"}
      </button>
    </div>
  );
}

function AddDecision({ onDone }: { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [options, setOptions] = useState("");
  const [stakes, setStakes] = useState("medium");
  const [reversible, setReversible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const decision = await api.createDecision({
        title, context, stakes, reversible,
        options: lines(options).map((option) => ({ option })),
      });
      onDone(decision.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>The decision</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Context</span>
        <textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} /></label>
      <label className="field"><span>Options — one per line, at least two</span>
        <textarea rows={3} value={options} onChange={(e) => setOptions(e.target.value)} /></label>
      <label className="field"><span>Stakes</span>
        <select value={stakes} onChange={(e) => setStakes(e.target.value)}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>
      <label className="field"><span>Reversible</span>
        <select value={reversible ? "yes" : "no"} onChange={(e) => setReversible(e.target.value === "yes")}>
          <option value="yes">yes</option>
          <option value="no">no — a one-way door</option>
        </select>
      </label>
      <p className="row-sub">One option is not a decision. Write down what you are not doing.</p>
      <button className="btn btn-approve" style={{ width: "100%" }}
              disabled={busy || !title.trim() || lines(options).length < 2} onClick={submit}>
        {busy ? "Saving…" : "Open it"}
      </button>
    </div>
  );
}

// ─── Wealth ───────────────────────────────────────────────────────────────────

function Wealth() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { api.wealth().then(setData).catch(setError); }, []);
  if (!data) return <Loading />;

  const { ops, tracks, trading, totals, unallocated_micros } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="stats">
        <div className="stat"><div className="stat-n">{usd(totals.ops_micros)}</div><div className="stat-l">wealth</div></div>
        <div className="stat"><div className="stat-n">{usd(ops.liquid_micros)}</div><div className="stat-l">liquid</div></div>
        <div className="stat"><div className="stat-n">{usd(unallocated_micros)}</div><div className="stat-l">unallocated</div></div>
      </div>

      <p className="eyebrow">Tracks</p>
      {tracks.length === 0 ? (
        <Empty title="No tracks defined" hint="A track says what a slice of the book is for. Targets divide one book." />
      ) : (
        tracks.map((t: any) => (
          <div className="row" key={t.id}>
            <div className="row-main">
              <div className="row-title">{t.name}</div>
              <div className="row-sub">
                {usd(t.allocated_micros)} · {pct(t.share_bps)} of allocated · target {pct(t.target_allocation_bps)}
              </div>
            </div>
            <div className="row-val">{t.drift_bps > 0 ? `+${pct(t.drift_bps)}` : pct(t.drift_bps)}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Holdings</p>
      {Object.entries(ops.by_kind ?? {}).map(([kind, micros]) => (
        <div className="row" key={kind}>
          <div className="row-main"><div className="row-title">{kind.replace(/_/g, " ")}</div></div>
          <div className="row-val">{usd(micros as number)}</div>
        </div>
      ))}
      {ops.stale_marks.length > 0 && (
        <>
          <p className="eyebrow">Marks older than six months</p>
          {ops.stale_marks.map((s: any) => (
            <div className="row-sub" key={s.id}>{s.name} — last marked {day(s.valued_at)}</div>
          ))}
        </>
      )}

      {/* Read across the lane boundary, and kept visually separate for the same reason. */}
      <p className="eyebrow">Trading lane — read only</p>
      <div className="panel" style={{ ["--lane" as string]: "var(--lane-trading)" }}>
        <dl className="kv">
          <dt>Capital</dt><dd>{usd(trading.capital_micros)}</dd>
          <dt>Cash</dt><dd>{usd(trading.cash_micros)}</dd>
          <dt>Realised</dt><dd>{usd(trading.realized_micros)}</dd>
          <dt>Open positions</dt><dd>{trading.open_positions}</dd>
          <dt>Live execution</dt><dd>{trading.authority.live_enabled ? "enabled" : "denied"}</dd>
        </dl>
        <p className="row-sub">{trading.note}</p>
      </div>
    </>
  );
}
