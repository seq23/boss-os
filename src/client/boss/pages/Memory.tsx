import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

const TIERS = ["capture", "working", "canon"] as const;
const NEXT: Record<string, string | null> = { capture: "working", working: "canon", canon: null };

export function Memory() {
  const [view, setView] = useState<"memory" | "knowledge">("memory");

  return (
    <>
      <div className="btn-row">
        <button className="btn" aria-pressed={view === "memory"} onClick={() => setView("memory")}>Memory</button>
        <button className="btn" aria-pressed={view === "knowledge"} onClick={() => setView("knowledge")}>Knowledge</button>
      </div>
      {view === "memory" ? <MemoryTiers /> : <Knowledge />}
    </>
  );
}

function MemoryTiers() {
  const [items, setItems] = useState<any[] | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [capturing, setCapturing] = useState(false);

  function load() {
    Promise.all([api.memory(), api.rules(), api.promotionEvents()])
      .then(([m, r, e]) => { setItems(m); setRules(r); setEvents(e); })
      .catch((e) => { setError(e); setItems([]); });
  }
  useEffect(load, []);

  async function sweep() {
    setError(null);
    try {
      const r = await api.sweep();
      setMsg(`Promoted ${r.promoted}. Sent ${r.proposed} to the inbox for approval.`);
      load();
    } catch (e) { setError(e); }
  }

  async function promote(id: string, tier: string) {
    setError(null);
    try {
      await api.promote(id, tier);
      setMsg("Sent to the inbox. Nothing moves tier until you approve it.");
      load();
    } catch (e) { setError(e); }
  }

  async function archive(id: string) {
    setError(null);
    try { await api.archiveMemory(id, "Archived from Memory"); load(); }
    catch (e) { setError(e); }
  }

  /**
   * Retirement is not archival. The memory stays, with its history and its
   * filings; it stops surfacing. Canon asks for a reason and so does this.
   */
  async function retire(id: string) {
    const reason = window.prompt("Why is this no longer true?");
    if (!reason?.trim()) return;
    setError(null);
    try {
      await api.retireMemory(id, reason.trim());
      setMsg("Retired. It is kept and no longer surfaced — regenerate the Manual to drop it from the current version.");
      load();
    } catch (e) { setError(e); }
  }

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

      <div className="stats">
        {TIERS.map((t) => (
          <div className="stat" key={t}>
            <div className="stat-n">{items?.filter((i) => i.tier === t).length ?? "—"}</div>
            <div className="stat-l">{t}</div>
          </div>
        ))}
      </div>

      <div className="btn-row">
        <button className="btn" onClick={sweep}>Run promotion sweep</button>
        <button className="btn" onClick={() => setCapturing((v) => !v)}>
          {capturing ? "Close" : "Capture something"}
        </button>
      </div>

      {capturing && <Capture onDone={() => { setCapturing(false); load(); }} />}

      <p className="eyebrow">Promotion rules</p>
      {rules.map((r) => (
        <div className="row" key={r.id}>
          <div className="row-main">
            <div className="row-title">{r.name}</div>
            <div className="row-sub">{r.from_tier} → {r.to_tier}</div>
          </div>
          <div className="row-val">{r.requires_approval ? "asks first" : "automatic"}</div>
        </div>
      ))}

      <p className="eyebrow">Memory</p>
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title="Memory is empty" hint="Captures arrive from tasks, then climb to canon as they earn it." />
      ) : (
        items.slice(0, 30).map((i) => (
          <div className="row" key={i.id}>
            <div className="row-main">
              <div className="row-title">{i.title}</div>
              <div className="row-sub">
                {i.tier} · {i.hits} hits · {Math.round(i.confidence * 100)}% confidence
              </div>
            </div>
            <div className="row-actions">
              {NEXT[i.tier] && (
                <button className="btn btn-small" onClick={() => promote(i.id, NEXT[i.tier]!)}>
                  → {NEXT[i.tier]}
                </button>
              )}
              <button className="btn btn-small" onClick={() => retire(i.id)}>Retire</button>
              <button className="btn btn-small btn-defer" onClick={() => archive(i.id)}>Archive</button>
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Promotion history</p>
      {events.length === 0 ? (
        <Empty title="Nothing promoted yet" hint="Every tier change is recorded here with its cause." />
      ) : (
        events.slice(0, 20).map((e) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">{e.title ?? e.item_id}</div>
              <div className="row-sub">{e.from_tier} → {e.to_tier} · {e.outcome}{e.note ? ` · ${e.note}` : ""}</div>
            </div>
            <div className="row-val">{new Date(e.ts).toLocaleDateString()}</div>
          </div>
        ))
      )}
    </>
  );
}

/**
 * Knowledge OS — canon §45's twelve surfaces, the generated Manual, and the
 * portable export. Nothing here stores knowledge: every surface is a view over
 * the memory substrate, and two of them are views over the Phase 14 tables.
 */
function Knowledge() {
  const [surfaces, setSurfaces] = useState<any[] | null>(null);
  const [manual, setManual] = useState<any | null>(null);
  const [exports, setExports] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    Promise.all([api.surfaces(), api.manual(), api.knowledgeExports()])
      .then(([s, m, e]) => { setSurfaces(s); setManual(m); setExports(e); })
      .catch((e) => { setError(e); setSurfaces([]); });
  }
  useEffect(load, []);

  async function generate() {
    setBusy(true); setError(null);
    try {
      const result = await api.generateManual();
      setMsg(result.unchanged
        ? `Nothing changed. Still version ${result.version}.`
        : `Version ${result.version} from ${result.item_count} promoted memor${result.item_count === 1 ? "y" : "ies"}.`);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function exportAll() {
    setBusy(true); setError(null);
    try {
      const result = await api.exportKnowledge({});
      setMsg(
        `Exported ${result.item_count} item${result.item_count === 1 ? "" : "s"}` +
        (result.restricted_excluded ? `, holding back ${result.restricted_excluded} restricted.` : "."),
      );
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (open) return <Surface key={open} surfaceKey={open} onBack={() => { setOpen(null); load(); }} />;
  if (surfaces === null) return <Loading />;

  const current = manual?.manual ?? null;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

      <p className="eyebrow">Personal Operating Manual</p>
      {current ? (
        <div className="panel">
          <div className="row-sub">
            Version {current.version} · {current.item_count} entries · {new Date(current.generated_at).toLocaleString()}
          </div>
          {current.sections.map((s: any) => (
            <details key={s.surface}>
              <summary className="docket-more" style={{ cursor: "pointer" }}>
                {s.title} — {s.entries.length}
              </summary>
              <div className="docket-full">
                {s.entries.map((e: any) => (
                  <div className="row" key={e.item_id}>
                    <div className="row-main">
                      <div className="row-title">{e.title}</div>
                      <div className="row-sub">{e.body}</div>
                    </div>
                    <div className="row-val">{e.tier}</div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <Empty title="Never generated" hint={manual?.note ?? "It is assembled from promoted memory, never typed."} />
      )}

      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={generate}>Generate the Manual</button>
        <button className="btn" disabled={busy} onClick={exportAll}>Export knowledge</button>
      </div>

      <p className="eyebrow">Surfaces</p>
      {surfaces.map((s) => (
        <div className="row" key={s.key}>
          <div className="row-main">
            <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                    onClick={() => setOpen(s.key)}>
              {s.name}
            </button>
            <div className="row-sub">{s.description}</div>
            <div className="row-sub">
              {s.backing === "memory" ? `${s.tier_floor} tier and above` : `backed by ${s.backing}`}
              {s.in_manual ? " · feeds the Manual" : ""}{s.offline ? " · offline library" : ""}
            </div>
          </div>
          <div className="row-val">{s.items}</div>
        </div>
      ))}

      {exports.length > 0 && (
        <>
          <p className="eyebrow">Exports</p>
          {exports.slice(0, 10).map((e) => (
            <div className="row" key={e.id}>
              <div className="row-main">
                <div className="row-title">{e.scope} · {e.item_count} items</div>
                <div className="row-sub">
                  {new Date(e.ts).toLocaleString()} · {e.status}
                  {e.restricted_included ? ` · carried ${e.restricted_included} restricted` : ""}
                  {e.restricted_excluded ? ` · held back ${e.restricted_excluded} restricted` : ""}
                </div>
              </div>
              <div className="row-val">{e.sha256 ? e.sha256.slice(0, 8) : "—"}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Surface({ surfaceKey, onBack }: { surfaceKey: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [itemId, setItemId] = useState("");

  function load() { api.surface(surfaceKey).then(setData).catch(setError); }
  useEffect(load, [surfaceKey]);

  async function fileIt() {
    setError(null);
    try { await api.fileToSurface(surfaceKey, { item_id: itemId.trim() }); setItemId(""); load(); }
    catch (e) { setError(e); }
  }

  if (!data) return <Loading />;
  const { surface, backing, items, note } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{surface.name}</h3>
        <p className="row-sub">{surface.description}</p>
        {note && <p className="row-sub">{note}</p>}
      </div>

      {backing === "memory" && (
        <div className="panel">
          <label className="field">
            <span>File a memory here by id</span>
            <input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="mem_…" />
          </label>
          <p className="row-sub">Filing never copies. The memory stays where it is, at the tier it earned.</p>
          <button className="btn btn-approve" style={{ width: "100%" }} disabled={!itemId.trim()} onClick={fileIt}>File it</button>
        </div>
      )}

      {items.length === 0 ? (
        <Empty title="Nothing here yet" hint="Capture it, promote it, then file it." />
      ) : (
        items.map((i: any) => (
          <div className="row" key={i.id}>
            <div className="row-main">
              <div className="row-title">{i.title ?? i.statement}</div>
              <div className="row-sub">
                {backing === "memory"
                  ? [i.tier, i.sensitivity, i.note].filter(Boolean).join(" · ")
                  : [i.status, i.outcome, i.kind].filter(Boolean).join(" · ")}
              </div>
            </div>
            {backing === "memory" && (
              <div className="row-actions">
                <button className="btn btn-small btn-defer"
                        onClick={() => api.unfileFromSurface(surfaceKey, i.id).then(load).catch(setError)}>
                  Unfile
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

function Capture({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.capture({ title, body });
      setTitle(""); setBody("");
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>What is worth remembering</span>
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="row-sub">It enters at capture. Only the gate can move it higher.</p>
      <button className="btn btn-approve" style={{ width: "100%" }}
              disabled={busy || !title.trim() || !body.trim()} onClick={submit}>
        {busy ? "Saving…" : "Capture"}
      </button>
    </div>
  );
}
