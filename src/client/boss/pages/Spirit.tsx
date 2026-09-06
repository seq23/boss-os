import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * Spirit — canon §43, §42.1–42.3, §44, and §5.2.
 *
 * The layout is the specification. Reality comes first on the screen because
 * canon §5.2 says it comes first, full stop; the sky follows as context and
 * says so; and the contribution and ancestor sections carry canon §44's tone,
 * which is not decorative — nothing here is a streak, a score or a red number.
 */

const day = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : "—");
const pct = (bps: number) => `${Math.round(bps / 100)}%`;

export function Spirit() {
  const [signal, setSignal] = useState<any | null>(null);
  const [month, setMonth] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openManifestation, setOpenManifestation] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    Promise.all([api.spiritDay(), api.spiritMonth()])
      .then(([d, m]) => { setSignal(d); setMonth(m); })
      .catch(setError);
  }
  useEffect(load, []);

  if (openManifestation) {
    return <Manifestation id={openManifestation} onBack={() => { setOpenManifestation(null); load(); }} />;
  }
  if (!signal || !month) return <Loading />;

  const { astro, reality_priority, rituals_due, contribution, ancestors, manifestations } = signal;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/* Canon §5.2: reality first, before anything about the sky. */}
      <div className="notice" style={{ borderColor: reality_priority.warning ? "var(--risk-high, #b4482f)" : undefined }}>
        <strong>{reality_priority.warning ? "Reality first" : "Nothing operational is waiting"}</strong>
        <div className="row-sub">{reality_priority.text}</div>
        <div className="row-sub">{reality_priority.rule}</div>
      </div>

      <p className="eyebrow">Sky — advisory</p>
      <div className="panel">
        <h3 style={{ margin: 0 }}>{astro.phase}</h3>
        <p className="row-sub">
          Moon in {astro.moon_sign} at {astro.degrees_in_sign.toFixed(1)}°
          {astro.cusp ? ` — near the cusp, possibly ${astro.next_sign}` : ""} · {pct(astro.illumination_bps)} lit ·
          {astro.waxing ? " waxing" : " waning"}
        </p>
        {/* Canon §42.2 names the window; the day says which one it is in. */}
        {astro.canon_window && (
          <p className="row-sub"><strong>{astro.canon_window}</strong> window</p>
        )}
        {astro.windows.length > 0 && (
          <>
            <p className="eyebrow">Windows</p>
            {astro.windows.map((w: any, i: number) => (
              <div className="row-sub" key={i}>{w.label}</div>
            ))}
          </>
        )}
        <p className="row-sub">{signal.note}</p>
        <p className="row-sub">{astro.method}</p>
      </div>

      <p className="eyebrow">Practice today</p>
      {rituals_due.length === 0 ? (
        <Empty title="Nothing due" hint="Rituals appear here on the day they are due, and nowhere else." />
      ) : (
        rituals_due.map((r: any) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <div className="row-title">{r.name}</div>
              <div className="row-sub">{r.cadence} · {r.why}</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small btn-approve" onClick={() => api.ritualDone(r.id).then(load).catch(setError)}>
                Done
              </button>
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Contribution — {contribution.month}</p>
      <div className="panel">
        <div className="stats">
          <div className="stat"><div className="stat-n">{contribution.count}</div><div className="stat-l">this month</div></div>
          <div className="stat"><div className="stat-n">{contribution.minimum}</div><div className="stat-l">the floor</div></div>
          <div className="stat"><div className="stat-n">{contribution.ideal}</div><div className="stat-l">a good month</div></div>
        </div>
        <p className="row-sub">{contribution.tone}</p>
        <button className="btn" style={{ width: "100%" }}
                onClick={() => api.recordContribution({ kind: "help" }).then(load).catch(setError)}>
          Record a contribution
        </button>
      </div>

      <p className="eyebrow">Ancestors — {ancestors.month}</p>
      <div className="panel">
        <p className="row-sub">{ancestors.minutes} of {ancestors.target_minutes} minutes.</p>
        <p className="row-sub">{ancestors.tone}</p>
      </div>

      <p className="eyebrow">Manifestations</p>
      <div className="btn-row">
        <button className="btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Open one"}</button>
      </div>
      {adding && <AddManifestation onDone={(id) => { setAdding(false); load(); setOpenManifestation(id); }} />}
      {month.manifestations.length === 0 ? (
        <Empty title="Nothing open" hint="A manifestation is held with a first concrete action, and closed by what you did." />
      ) : (
        month.manifestations.map((m: any) => (
          <div className="row" key={m.id}>
            <div className="row-main">
              <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                      onClick={() => setOpenManifestation(m.id)}>
                {m.title}
              </button>
              <div className="row-sub">Next: {m.first_action}</div>
            </div>
            <div className="row-val">{m.target_at ? day(m.target_at) : "open"}</div>
          </div>
        ))
      )}
      {manifestations.without_evidence_this_month > 0 && (
        <div className="row-sub">
          {manifestations.without_evidence_this_month} with nothing done or happened this month.
        </div>
      )}

      <p className="eyebrow">Almanac — {month.month}</p>
      {month.almanac.filter((e: any) => e.kind !== "window").map((e: any) => (
        <div className="row" key={e.id}>
          <div className="row-main">
            <div className="row-title">{e.label}</div>
            <div className="row-sub">
              {new Date(e.starts_at).toLocaleString()} · {e.source === "imported" ? "entered from an almanac" : "computed"}
            </div>
          </div>
        </div>
      ))}

      {/* Canon §42.2's forward view is only as complete as its pasted half. */}
      <p className="eyebrow">Entered by hand</p>
      {month.coverage?.manual.map((m: any) => (
        <div className="row" key={m.key}>
          <div className="row-main">
            <div className="row-title">{m.label}</div>
            <div className="row-sub">{m.rows > 0 ? `${m.months_covered} months covered` : m.how}</div>
          </div>
          <div className="row-val">{m.status}</div>
        </div>
      ))}
      {month.coverage && !month.coverage.complete && (
        <div className="row-sub">{month.coverage.note}</div>
      )}

      <p className="eyebrow">Not computed here</p>
      {month.deferred.map((d: any) => (
        <div className="row" key={d.key}>
          <div className="row-main"><div className="row-title">{d.label}</div></div>
          <div className="row-val">{d.status}</div>
        </div>
      ))}
    </>
  );
}

function Manifestation({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [kind, setKind] = useState("action");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  function load() { api.manifestation(id).then(setData).catch(setError); }
  useEffect(load, [id]);

  async function addEvidence() {
    setError(null);
    try {
      await api.addEvidence(id, { kind, description, reference: reference || undefined });
      setDescription(""); setReference("");
      load();
    } catch (e) { setError(e); }
  }

  if (!data) return <Loading />;
  const { manifestation, evidence, progress } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{manifestation.title}</h3>
        <p>{manifestation.statement}</p>
        <p className="row-sub">First action: {manifestation.first_action}</p>
        <p className="row-sub">{manifestation.status}{manifestation.target_at ? ` · by ${day(manifestation.target_at)}` : ""}</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-n">{progress.actions}/{progress.actions_required}</div><div className="stat-l">actions</div></div>
        <div className="stat"><div className="stat-n">{progress.verifiable_results}/{progress.verifiable_results_required}</div><div className="stat-l">results</div></div>
        <div className="stat"><div className="stat-n">{progress.signs}</div><div className="stat-l">signs (0 count)</div></div>
      </div>

      {manifestation.status === "open" && (
        <div className="panel">
          <label className="field"><span>What happened</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="action">something I did</option>
              <option value="result">something that happened, checkable</option>
              <option value="sign">a sign — kept, never counted</option>
            </select>
          </label>
          <label className="field"><span>Describe it</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          {kind === "result" && (
            <label className="field"><span>Where can it be checked?</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          )}
          <button className="btn" style={{ width: "100%" }} disabled={!description.trim()} onClick={addEvidence}>Record it</button>
        </div>
      )}

      {manifestation.status === "open" && (
        <div className="btn-row">
          <button className="btn btn-approve" disabled={!progress.can_close}
                  onClick={() => api.markManifested(id).then(load).catch(setError)}>
            {progress.can_close ? "Mark it manifested" : "Not closeable yet"}
          </button>
        </div>
      )}

      <p className="eyebrow">Evidence</p>
      {evidence.length === 0 ? (
        <Empty title="Nothing recorded" hint="Three things you did and one checkable thing that happened." />
      ) : (
        evidence.map((e: any) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">{e.description}</div>
              <div className="row-sub">
                {e.kind}{e.kind === "sign" ? " · does not count" : ""}{e.reference ? ` · ${e.reference}` : ""}
              </div>
            </div>
            <div className="row-val">{day(e.ts)}</div>
          </div>
        ))
      )}
    </>
  );
}

function AddManifestation({ onDone }: { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [firstAction, setFirstAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const created = await api.createManifestation({ title, statement, first_action: firstAction });
      onDone(created.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>What</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Stated plainly</span>
        <textarea rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} /></label>
      <label className="field"><span>The first concrete action</span>
        <input value={firstAction} onChange={(e) => setFirstAction(e.target.value)} /></label>
      <p className="row-sub">
        Required. What closes this is what you did and what happened — signs are kept because they matter to you,
        and they never count.
      </p>
      <button className="btn btn-approve" style={{ width: "100%" }}
              disabled={busy || !title.trim() || !statement.trim() || !firstAction.trim()} onClick={submit}>
        {busy ? "Saving…" : "Hold it"}
      </button>
    </div>
  );
}
