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
 * THE ONE RULE THIS SCREEN KEEPS ABOUT WHAT MAY BE RESTORED FROM.
 *
 * A pruned snapshot keeps its row and loses its bytes — deliberately, so vault history stays
 * readable and a restore attempt against one fails with "pruned" rather than a missing-key error
 * that reads like corruption. That design is right, and it has a consequence the screen must honour:
 * a snapshot you cannot restore from has no business being offered as a restore source. Production
 * held 68 rows of which 56 were tombstones.
 *
 * `status === "complete"` is the whole test, and it lives HERE rather than being repeated at each
 * use, so the picker and any future control that chooses a restore source cannot disagree about
 * what "restorable" means. `scripts/validate/a-pruned-snapshot-is-not-offered-for-restore.mjs`
 * asserts that every restore-source list on this screen goes through it.
 */
export function restorable(snapshots: any[]) {
  return snapshots.filter((s) => s.status === "complete" && s.r2_key);
}

/**
 * Choosing a snapshot and a mode, with the destructive one gated.
 *
 * Deliberately its own component with its own state: the mode and the confirmation must reset when
 * the chosen snapshot changes, or a reader could type REPLACE against one snapshot, change their
 * mind about which one, and fire it at another.
 */
function RestorePanel({
  snapshots, busy, run,
}: {
  snapshots: any[];
  busy: string | null;
  run: (name: string, fn: () => Promise<string>) => Promise<void>;
}) {
  const options = restorable(snapshots);
  const [id, setId] = useState<string>("");
  const [mode, setMode] = useState<"verify" | "merge" | "replace">("verify");
  const [confirm, setConfirm] = useState("");

  const chosen = id || options[0]?.id || "";
  const ready = chosen && (mode !== "replace" || confirm === "REPLACE");

  if (options.length === 0) {
    return (
      <Empty
        title="Nothing to restore from"
        hint="A snapshot has to exist and be complete before it can be restored. Pruned snapshots keep their record and lose their contents."
      />
    );
  }

  return (
    <>
      <label className="field">
        <span>Snapshot</span>
        <select
          value={chosen}
          onChange={(e) => { setId(e.target.value); setConfirm(""); }}
        >
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.ts).toLocaleString()} · {s.label} · {size(s.bytes)}
            </option>
          ))}
        </select>
      </label>

      <div className="btn-row">
        {(["verify", "merge", "replace"] as const).map((m) => (
          <button
            key={m}
            className="btn"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); setConfirm(""); }}
          >
            {m[0]!.toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {mode === "replace" && (
        <label className="field">
          <span>
            This wipes every covered table. Type REPLACE to confirm.
          </span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="REPLACE"
            aria-label="Type REPLACE to confirm"
          />
        </label>
      )}

      <button
        className="btn"
        style={{ width: "100%" }}
        disabled={busy !== null || !ready}
        onClick={() =>
          run("restore", async () => {
            const r = await api.restore(
              mode === "replace"
                ? { snapshot_id: chosen, mode, confirm: "REPLACE" }
                : { snapshot_id: chosen, mode },
            );
            // Every attempt is recorded in vault_restores, including the failures - so the
            // sentence here reports what came back rather than assuming success.
            return `Restore (${mode}): ${r.ok === false ? "refused" : "completed"}. ${
              r.tables_restored ?? r.tables ?? 0
            } tables, ${r.rows_restored ?? r.rows ?? 0} rows.`;
          })
        }
      >
        {busy === "restore" ? "Restoring…" : `Run ${mode}`}
      </button>
    </>
  );
}

/**
 * CLEARING OLD SNAPSHOTS FOR SPACE — the owner's ask, and the care it needs.
 *
 * `pruneSnapshots` and `POST /vault/prune` both existed and NOTHING IN THE UI CALLED THEM. Retention
 * only ever happened as a step inside the nightly run, so "be able to clear old ones for space" had
 * no control at all and the vault sat at 8.4 MB of mostly tombstones.
 *
 * WHY THIS IS NOT A BUTTON NEXT TO THE RESTORE CONTROLS, which is the shape it would have taken if
 * nobody thought about it. Deleting backups is irreversible and it is the one action on this screen
 * that reduces what the system can recover from. So it is its own section, below restore, and it
 * refuses to do anything until it has SAID what it will do:
 *
 *   1. Preview first, always. The button that deletes does not exist until a preview has been read
 *      back from the server, so there is no path from a single tap to a deletion.
 *   2. The preview names both halves — what goes AND what stays. "56 removed" is a number; "the
 *      oldest 56, and your newest copy from tonight is kept" is a sentence she can check.
 *   3. The preview is computed by the same selection the prune uses (`staleSnapshots`), so the
 *      confirmation cannot describe different rows from the ones removed.
 *   4. Typed confirmation, like Replace. A destructive action as easy to trigger as a safe one is a
 *      trap regardless of how clear the label is.
 *
 * AND THE FLOOR IS STATED ON SCREEN, not just enforced in the Worker: the newest complete snapshot
 * is never removed, whatever number is typed. `pruneSnapshots` defends that with `Math.max(1, keep)`
 * and the reader deserves to know it before agreeing to anything.
 */
function PrunePanel({
  busy, run, onDone,
}: {
  busy: string | null;
  run: (name: string, fn: () => Promise<string>) => Promise<void>;
  onDone: () => void;
}) {
  // Empty means "the system's own retention number", which the server owns. The client does not
  // keep its own copy of SNAPSHOT_KEEP — that would be the second list this repo keeps naming.
  const [keep, setKeep] = useState<string>("");
  const [preview, setPreview] = useState<any | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);

  const asked = keep.trim() === "" ? undefined : Number(keep);
  const valid = asked === undefined || (Number.isFinite(asked) && asked >= 1);

  async function look() {
    setError(null);
    setConfirm("");
    try { setPreview(await api.prunePreview(asked)); }
    catch (e) { setError(e); setPreview(null); }
  }

  return (
    <>
      <p className="eyebrow">Clear old snapshots</p>
      <p className="row-sub" style={{ marginBottom: 8 }}>
        Deleting a snapshot removes its contents from storage for good. The record stays — date, hash
        and table counts — so the vault's history is still readable, and the newest complete snapshot
        is never removed whatever number you choose.
      </p>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <label className="field">
        <span>How many to keep</span>
        <input
          value={keep}
          onChange={(e) => { setKeep(e.target.value); setPreview(null); setConfirm(""); }}
          placeholder="the system's retention setting"
          inputMode="numeric"
          aria-label="How many snapshots to keep"
        />
      </label>

      <button
        className="btn"
        style={{ width: "100%" }}
        disabled={busy !== null || !valid}
        onClick={look}
      >
        Show me what this would remove
      </button>

      {preview && (
        <div className="panel" style={{ marginTop: 8 }}>
          {preview.removing === 0 ? (
            <p className="row-sub">
              Nothing to remove. {preview.keeping} snapshot{preview.keeping === 1 ? "" : "s"} on hand,
              which is at or under a retention of {preview.keep}.
            </p>
          ) : (
            <>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">
                    Removes {preview.removing} snapshot{preview.removing === 1 ? "" : "s"}
                  </div>
                  <div className="row-sub">
                    The oldest {preview.removing}, from{" "}
                    {new Date(preview.oldest_removed_ts).toLocaleDateString()} to{" "}
                    {new Date(preview.newest_removed_ts).toLocaleDateString()}.
                  </div>
                </div>
                <div className="row-val">{size(preview.bytes_reclaimed)} back</div>
              </div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">
                    Keeps {preview.keeping} snapshot{preview.keeping === 1 ? "" : "s"}
                  </div>
                  <div className="row-sub">
                    Including your newest, from{" "}
                    {preview.newest_kept_ts ? new Date(preview.newest_kept_ts).toLocaleString() : "—"}.
                  </div>
                </div>
                <div className="row-val">{size(preview.total_bytes - preview.bytes_reclaimed)}</div>
              </div>

              <label className="field">
                <span>This cannot be undone. Type DELETE to confirm.</span>
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="DELETE"
                  aria-label="Type DELETE to confirm"
                />
              </label>

              <button
                className="btn"
                style={{ width: "100%" }}
                disabled={busy !== null || confirm !== "DELETE"}
                onClick={() =>
                  run("prune", async () => {
                    const r = await api.pruneSnapshots(asked);
                    setPreview(null);
                    setConfirm("");
                    onDone();
                    // What actually happened, not what the preview predicted. A delete that failed
                    // reclaims nothing and the row stays complete so the next run retries it.
                    return `Removed ${r.deleted} snapshot${r.deleted === 1 ? "" : "s"}, ${size(
                      r.bytes_reclaimed ?? 0,
                    )} reclaimed. ${r.kept} kept.${
                      r.failures?.length ? ` ${r.failures.length} could not be deleted and were left in place.` : ""
                    }`;
                  })
                }
              >
                {busy === "prune" ? "Removing…" : `Remove ${preview.removing} and keep ${preview.keeping}`}
              </button>
            </>
          )}
        </div>
      )}
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
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

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
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

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

      {/*
        * RESTORE — the one thing the vault exists FOR, and it had no screen.
        *
        * `POST /api/vault/restore` worked in all three modes and was reachable only from a
        * terminal. The operator runbook's instructions for the worst day of the system's life were
        * three curl commands. A vault you cannot restore from without a laptop and a shell is a
        * vault whose whole value depends on the one thing being unavailable.
        *
        * THE THREE MODES ARE NOT PEERS, and the screen refuses to present them as one row of
        * equal-looking buttons. `verify` writes nothing. `merge` fills gaps and lets existing rows
        * win. `replace` WIPES the covered tables, and the API demands the literal string REPLACE -
        * that confirmation is kept here rather than smoothed away, because a destructive action
        * that is as easy to trigger as a safe one is a trap regardless of how clear the label is.
        */}
      <p className="eyebrow">Restore</p>
      <p className="row-sub" style={{ marginBottom: 8 }}>
        Verify proves a snapshot loads and writes nothing. Merge fills gaps, and existing rows win.
        Replace wipes every covered table and loads the snapshot verbatim — take a fresh snapshot first.
      </p>
      <RestorePanel snapshots={snapshots ?? []} busy={busy} run={run} />

      <PrunePanel busy={busy} run={run} onDone={load} />

      {/*
        * THE HISTORY LIST KEEPS THE TOMBSTONES, and that is deliberate rather than an oversight.
        *
        * A pruned row is the evidence the prune design exists to preserve: it still carries the
        * date, the hash and the table counts of a copy that once existed, so "we had a snapshot
        * that night" stays an answerable question after the bytes are gone. What it must NOT do is
        * appear in the restore picker above, which is why `restorable()` filters it out there and
        * why it is marked plainly here instead of being quietly listed alongside live copies.
        */}
      <p className="eyebrow">Snapshots</p>
      {snapshots === null ? (
        <Loading />
      ) : snapshots.length === 0 ? (
        <Empty title="Nothing archived yet" hint="A snapshot is a full JSON copy of every table, stored in R2." />
      ) : (
        snapshots.slice(0, 20).map((s) => (
          <div className="row" key={s.id}>
            <div className="row-main">
              <div className="row-title">
                {new Date(s.ts).toLocaleString()}
                {s.status === "pruned" && <span className="pill">pruned</span>}
              </div>
              <div className="row-sub">
                {s.label} · {s.status}
                {s.sha256 ? ` · ${s.sha256.slice(0, 12)}…` : " · no hash"}
                {s.status === "pruned" && s.pruned_at
                  ? ` · contents removed ${new Date(s.pruned_at).toLocaleDateString()}`
                  : ""}
              </div>
            </div>
            <div className="row-actions">
              {/*
                * Verify reads the object back out of R2 and re-hashes it. There is no object behind
                * a pruned row, so offering the control would promise a check it cannot perform and
                * answer with a failure that reads like corruption.
                */}
              {s.status === "complete" && (
                <button className="btn btn-small" disabled={busy !== null}
                  onClick={() => run(`v${s.id}`, async () => {
                    const v = await api.verifySnapshot(s.id);
                    return v.ok
                      ? `Verified. Hash matches and ${v.parse.rows} rows parse cleanly.`
                      : `Failed: ${v.sha_match ? "" : "hash mismatch. "}${v.parse.ok ? "" : v.parse.reason}`;
                  })}>
                  Verify
                </button>
              )}
              {/*
                * `/api/boss`, NOT `/api`. Every other call on this screen goes through the api
                * client, which adds the prefix; this one is a plain href and was written without
                * it, so on production it hit the West Peek chassis and answered
                * `{"error":"unauthenticated"}` — verified against the live site, 8 Sep 2026. The
                * one control that gets a snapshot off the machine was the one that did not work.
                */}
              {s.status === "complete" && (
                <a className="btn btn-small" href={`/api/boss/vault/snapshots/${s.id}/download`}>{size(s.bytes)} ↓</a>
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
