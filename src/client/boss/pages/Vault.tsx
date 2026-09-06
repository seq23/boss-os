import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

function size(bytes: number) {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function Vault() {
  const [view, setView] = useState<"vault" | "sovereignty" | "documents">("vault");

  return (
    <>
      <div className="btn-row">
        <button className="btn" aria-pressed={view === "vault"} onClick={() => setView("vault")}>Continuity</button>
        <button className="btn" aria-pressed={view === "sovereignty"} onClick={() => setView("sovereignty")}>Sovereignty</button>
        <button className="btn" aria-pressed={view === "documents"} onClick={() => setView("documents")}>Documents</button>
      </div>
      {view === "vault" ? <Continuity /> : view === "sovereignty" ? <Sovereignty /> : <Documents />}
    </>
  );
}

/**
 * The Emergency Sovereignty Package — canon §19, §46, §45.2, §45.3.
 *
 * The screen answers one question: if this system vanished tonight, what would
 * be in the drawer, and has anyone checked that it works? The two physical
 * steps — the SSD and the offsite copy — are shown as cadences the system
 * cannot verify, because it cannot see the drawer.
 */
function Sovereignty() {
  const [status, setStatus] = useState<any | null>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [drills, setDrills] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.sovereignty(), api.sovereigntyPackages(), api.offlineDrills()])
      .then(([s, p, d]) => { setStatus(s); setPackages(p); setDrills(d); })
      .catch((e) => { setError(e); setStatus({ components: [], missing: [], workflows: [] }); });
  }
  useEffect(load, []);

  async function build() {
    setBusy(true); setError(null);
    try {
      const built = await api.buildSovereigntyPackage();
      setMsg(built.note);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function drill() {
    setBusy(true); setError(null);
    try {
      const result = await api.runOfflineDrill();
      setMsg(result.note);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (!status) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--brass)" }}>{msg}</div>}

      <p className="row-sub">{status.verdict}</p>

      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={build}>Build a package</button>
        <button className="btn btn-approve" disabled={busy || packages.length === 0} onClick={drill}>Run the offline drill</button>
      </div>

      <p className="eyebrow">The package</p>
      {(status.components ?? []).map((component: any) => (
        <div className="row" key={component.key}>
          <div className="row-main">
            <div className="row-title">{component.label}</div>
            <div className="row-sub">{component.detail}</div>
          </div>
          <div className="row-val">{component.present ? "in" : "missing"}</div>
        </div>
      ))}

      <p className="eyebrow">What the system cannot see</p>
      {(status.workflows ?? []).map((workflow: any) => (
        <div className="row" key={workflow.key}>
          <div className="row-main">
            <div className="row-title">{workflow.title}</div>
            <div className="row-sub">{workflow.overdue ? "Overdue" : `Due ${new Date(workflow.due_at).toLocaleDateString()}`}</div>
          </div>
          <div className="row-val">{workflow.overdue ? "do it" : "ok"}</div>
        </div>
      ))}
      <p className="row-sub">{status.note}</p>

      {drills.length > 0 && (
        <>
          <p className="eyebrow">Drills</p>
          {drills.slice(0, 5).map((d) => (
            <details key={d.id}>
              <summary className="docket-more" style={{ cursor: "pointer" }}>
                {new Date(d.ts).toLocaleString()} — {d.passed ? "passed" : "failed"}
              </summary>
              <div className="docket-full">
                {d.steps.map((s: any) => (
                  <div className="row" key={s.key}>
                    <div className="row-main">
                      <div className="row-title">{s.label}</div>
                      <div className="row-sub">{s.evidence}</div>
                    </div>
                    <div className="row-val">{s.passed ? "ok" : "no"}</div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </>
      )}

      {packages.length > 0 && (
        <>
          <p className="eyebrow">Packages</p>
          {packages.slice(0, 5).map((p) => (
            <div className="row" key={p.id}>
              <div className="row-main">
                <div className="row-title">{new Date(p.ts).toLocaleString()}</div>
                <div className="row-sub">
                  {size(p.bytes)} · {p.sha256 ? `${p.sha256.slice(0, 12)}…` : "no hash"}
                  {p.verified_at ? " · verified" : " · not verified"}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn btn-small"
                        onClick={() => api.verifySovereigntyPackage(p.id).then((v) => { setMsg(v.ok ? "Verified." : v.reason); load(); }).catch(setError)}>
                  Verify
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Continuity() {
  const [snapshots, setSnapshots] = useState<any[] | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [restores, setRestores] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.snapshots(), api.vaultEntries(), api.restores()])
      .then(([s, e, r]) => { setSnapshots(s); setEntries(e); setRestores(r); })
      .catch((e) => { setError(e); setSnapshots([]); });
  }
  useEffect(load, []);

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setError(null);
    setMsg(null);
    try { setMsg(await fn()); load(); }
    catch (e) { setError(e); }
    finally { setBusy(null); }
  }

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--brass)" }}>{msg}</div>}

      <div className="btn-row">
        <button className="btn" disabled={busy !== null}
          onClick={() => run("snap", async () => {
            const s = await api.takeSnapshot();
            return `Snapshot written: ${size(s.bytes)} across ${Object.keys(s.counts).length} tables.`;
          })}>
          {busy === "snap" ? "Writing…" : "Take snapshot"}
        </button>

        <button className="btn" disabled={busy !== null}
          onClick={() => run("drill", async () => {
            const d = await api.drill();
            return d.passed
              ? `Drill passed. ${d.tables_covered}/${d.tables_expected} tables, ${d.total_rows} rows, hash verified in ${d.took_ms}ms.`
              : `Drill failed. Missing: ${d.missing_tables.join(", ") || "none"}; hash match ${d.sha_match}.`;
          })}>
          {busy === "drill" ? "Running…" : "Restore drill"}
        </button>
      </div>

      <p className="row-sub" style={{ marginTop: 4 }}>
        A drill takes a snapshot, reads it back out of storage, re-hashes it, and checks every table is covered.
        It writes nothing to live state.
      </p>

      <p className="eyebrow">Snapshots</p>
      {snapshots === null ? (
        <Loading />
      ) : snapshots.length === 0 ? (
        <Empty title="Nothing archived yet" hint="A snapshot is a full JSON copy of every table, stored in R2." />
      ) : (
        snapshots.slice(0, 20).map((s) => (
          <div className="row" key={s.id}>
            <div className="row-main">
              <div className="row-title">{new Date(s.ts).toLocaleString()}</div>
              <div className="row-sub">{s.label} · {s.status}</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small" disabled={busy !== null}
                onClick={() => run(`v${s.id}`, async () => {
                  const v = await api.verifySnapshot(s.id);
                  return v.ok
                    ? `Verified. Hash matches and ${v.parse.rows} rows parse cleanly.`
                    : `Failed: ${v.sha_match ? "" : "hash mismatch. "}${v.parse.ok ? "" : v.parse.reason}`;
                })}>
                Verify
              </button>
              {s.status === "complete" && (
                <a className="btn btn-small" href={`/api/vault/snapshots/${s.id}/download`}>{size(s.bytes)} ↓</a>
              )}
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Restore history</p>
      {restores.length === 0 ? (
        <Empty title="No restores" hint="Verifications, drills, and real restores are all recorded here." />
      ) : (
        restores.slice(0, 15).map((r) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <div className="row-title">{r.mode} · {r.status}</div>
              <div className="row-sub">{r.error ?? r.source}</div>
            </div>
            <div className="row-val">{new Date(r.ts).toLocaleDateString()}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Stored documents</p>
      {entries.length === 0 ? (
        <Empty title="No documents" hint="Canon docs and exports live here so the system survives a rebuild." />
      ) : (
        entries.map((e) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">{e.key}</div>
              <div className="row-sub">{e.kind}</div>
            </div>
            <div className="row-val">{size(e.bytes)}</div>
          </div>
        ))
      )}
    </>
  );
}

/**
 * Document Compiler Mode and the SEO/GEO runtime — canon §37, §38.
 *
 * The compiler assembles from named sources; a section whose source has nothing
 * to say is shown as absent rather than filled. The audit reports evidence and
 * says plainly what it cannot see from here.
 */
function Documents() {
  const [artifacts, setArtifacts] = useState<any[] | null>(null);
  const [sources, setSources] = useState<any | null>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [source, setSource] = useState("supplied");
  const [result, setResult] = useState<any | null>(null);
  const [audit, setAudit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.artifacts(), api.compilerSources(), api.seoAudits()])
      .then(([a, s, u]) => { setArtifacts(a); setSources(s); setAudits(u); })
      .catch((e) => { setError(e); setArtifacts([]); });
  }
  useEffect(load, []);

  async function compile() {
    setBusy(true); setError(null);
    try {
      const compiled = await api.compileDocument({
        name: title.toLowerCase().replace(/\s+/g, "-").slice(0, 40) || "document",
        title,
        sections: [
          source === "supplied"
            ? { key: "body", title: "Body", source: "supplied", text }
            : { key: "body", title: "Body", source },
        ],
      });
      setResult(compiled);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function auditArtifact(id: string) {
    setBusy(true); setError(null);
    try { setAudit(await api.runSeoAudit({ artifact_id: id, questions: [] })); load(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (artifacts === null) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="panel">
        <label className="field"><span>Document title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">
          <span>Where the body comes from</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {(sources?.sources ?? []).map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {source === "supplied" && (
          <label className="field"><span>The text</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
        )}
        <p className="row-sub">{sources?.note}</p>
        <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !title.trim()} onClick={compile}>
          {busy ? "Compiling…" : "Compile it"}
        </button>
      </div>

      {result && (
        <div className="panel">
          <div className="row-sub">{result.name} · {size(result.bytes)} · {result.sha256.slice(0, 12)}…</div>
          {result.sections.map((s: any) => (
            <div className="row" key={s.key}>
              <div className="row-main">
                <div className="row-title">{s.title}</div>
                <div className="row-sub">{s.present ? s.source : s.reason}</div>
              </div>
              <div className="row-val">{s.present ? "in" : "absent"}</div>
            </div>
          ))}
        </div>
      )}

      <p className="eyebrow">Compiled documents</p>
      {artifacts.length === 0 ? (
        <Empty title="Nothing compiled yet" hint="Every compile writes a hashed file with a per-section manifest." />
      ) : (
        artifacts.map((a) => (
          <div className="row" key={a.id}>
            <div className="row-main">
              <div className="row-title">{a.title ?? a.name}</div>
              <div className="row-sub">
                {new Date(a.created_at).toLocaleString()} · {size(a.bytes)} · {a.sha256.slice(0, 12)}…
                {a.manifest.absent?.length ? ` · ${a.manifest.absent.length} section(s) absent` : ""}
              </div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small" disabled={busy} onClick={() => auditArtifact(a.id)}>Audit</button>
            </div>
          </div>
        ))
      )}

      {audit && (
        <>
          <p className="eyebrow">Audit — evidence, not a claim</p>
          <div className="panel">
            <div className="row-sub">{audit.audit.score} of {audit.audit.max_score}</div>
            {audit.audit.checks.map((ch: any) => (
              <div className="row" key={ch.key}>
                <div className="row-main">
                  <div className="row-title">{ch.label}</div>
                  <div className="row-sub">{ch.observed} — {ch.evidence}</div>
                </div>
                <div className="row-val">{ch.pass ? "ok" : "no"}</div>
              </div>
            ))}
            <p className="eyebrow">Not observable from here</p>
            {audit.deferred.map((d: any) => (
              <div className="row-sub" key={d.key}>{d.label} — {d.status}</div>
            ))}
          </div>
        </>
      )}

      {audits.length > 0 && (
        <>
          <p className="eyebrow">Past audits</p>
          {audits.slice(0, 10).map((a) => (
            <div className="row" key={a.id}>
              <div className="row-main">
                <div className="row-title">{a.title}</div>
                <div className="row-sub">{a.findings.length} finding(s) · {new Date(a.created_at).toLocaleString()}</div>
              </div>
              <div className="row-val">{a.score}/{a.max_score}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
