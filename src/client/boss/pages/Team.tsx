import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

export function Team() {
  const [view, setView] = useState<"team" | "prompts" | "capabilities">("team");

  return (
    <>
      <div className="btn-row">
        <button className="btn" aria-pressed={view === "team"} onClick={() => setView("team")}>Team</button>
        <button className="btn" aria-pressed={view === "prompts"} onClick={() => setView("prompts")}>Prompts</button>
        <button className="btn" aria-pressed={view === "capabilities"} onClick={() => setView("capabilities")}>Capabilities</button>
      </div>
      {view === "team" ? <Roster /> : view === "prompts" ? <Prompts /> : <Capabilities />}
    </>
  );
}

/**
 * Capability Intelligence — canon §78.
 *
 * The screen answers one question per job type: what actually runs this? The
 * bench sits beside it, visible and not running, and the discovery inbox only
 * accepts a search that had a reason.
 */
function Capabilities() {
  const [coverage, setCoverage] = useState<any | null>(null);
  const [discoveries, setDiscoveries] = useState<any[]>([]);
  const [patches, setPatches] = useState<any[]>([]);
  const [triggers, setTriggers] = useState<any | null>(null);
  const [trigger, setTrigger] = useState("high_value");
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);

  function load() {
    Promise.all([api.capabilityCoverage(), api.discoveries(), api.capabilityPatches(), api.capabilityTriggers()])
      .then(([c, d, p, t]) => { setCoverage(c); setDiscoveries(d); setPatches(p); setTriggers(t); })
      .catch(setError);
  }
  useEffect(load, []);

  async function raise() {
    setError(null);
    try {
      await api.raiseDiscovery({ trigger, note });
      setNote("");
      load();
    } catch (e) { setError(e); }
  }

  if (!coverage) return <Loading />;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="stats">
        <div className="stat"><div className="stat-n">{coverage.covered}</div><div className="stat-l">jobs covered</div></div>
        <div className="stat"><div className="stat-n">{coverage.uncovered.length}</div><div className="stat-l">uncovered</div></div>
        <div className="stat"><div className="stat-n">{discoveries.filter((d) => d.status === "new").length}</div><div className="stat-l">to look at</div></div>
      </div>
      <p className="row-sub">{coverage.rule}</p>

      <p className="eyebrow">What runs what</p>
      {coverage.job_types.map((j: any) => (
        <div className="row" key={j.job_type}>
          <div className="row-main">
            <div className="row-title">{j.job_type.replace(/_/g, " ")}</div>
            <div className="row-sub">{j.default ? `${j.default.name} — ${j.default.reason}` : "No active default."}</div>
            {j.benched.length > 0 && (
              <div className="row-sub">benched: {j.benched.map((b: any) => b.name).join(", ")}</div>
            )}
          </div>
          <div className="row-val">{j.default?.criticality ?? "—"}</div>
        </div>
      ))}

      {coverage.deferred.length > 0 && (
        <>
          <p className="eyebrow">Not covered on purpose</p>
          {coverage.deferred.map((d: any) => (
            <div className="row" key={d.job_type}>
              <div className="row-main">
                <div className="row-title">{d.job_type.replace(/_/g, " ")}</div>
                <div className="row-sub">{d.reason}</div>
              </div>
              <div className="row-val">phase {d.phase}</div>
            </div>
          ))}
        </>
      )}

      <p className="eyebrow">Look for something else</p>
      <div className="panel">
        <label className="field">
          <span>What triggered this?</span>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {(triggers?.triggers ?? []).map((t: any) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="field"><span>Note</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className="row-sub">{triggers?.rule}</p>
        <button className="btn" style={{ width: "100%" }} disabled={!note.trim()} onClick={raise}>Record the search</button>
      </div>

      {discoveries.length > 0 && (
        <>
          <p className="eyebrow">Discovery inbox</p>
          {discoveries.slice(0, 10).map((d) => (
            <div className="row" key={d.id}>
              <div className="row-main">
                <div className="row-title">{d.note}</div>
                <div className="row-sub">{d.trigger_key.replace(/_/g, " ")}{d.job_type ? ` · ${d.job_type}` : ""} · {d.status}</div>
              </div>
              <div className="row-actions">
                {d.status === "new" && (
                  <button className="btn btn-small btn-defer"
                          onClick={() => api.reviewDiscovery(d.id, { outcome: "dismissed" }).then(load).catch(setError)}>
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {patches.length > 0 && (
        <>
          <p className="eyebrow">Patches</p>
          {patches.slice(0, 10).map((p) => (
            <div className="row" key={p.id}>
              <div className="row-main">
                <div className="row-title">{p.name}</div>
                <div className="row-sub">{p.reason}</div>
                <div className="row-sub">{Object.keys(p.changes).join(", ")}</div>
              </div>
              <div className="row-val">{p.status}{p.requires_approval ? " · needs review" : ""}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Roster() {
  const [employees, setEmployees] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sprawl, setSprawl] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);

  function load() {
    Promise.all([api.employees(), api.tasks(), api.templates(), api.sprawl()])
      .then(([e, t, tp, s]) => { setEmployees(e); setTasks(t); setTemplates(tp); setSprawl(s); })
      .catch((e) => { setError(e); setEmployees([]); });
  }
  useEffect(load, []);

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <button className="btn" style={{ width: "100%" }} onClick={() => setOpen((v) => !v)}>
        {open ? "Close" : "Give the team something to do"}
      </button>
      {open && <NewTask templates={templates} onDone={() => { setOpen(false); load(); }} />}

      {sprawl?.duplicate_departments?.length > 0 && (
        <div className="notice" style={{ borderColor: "var(--gold)" }}>
          Two employees cover the same ground: {sprawl.duplicate_departments.map((d: any) => d.names).join("; ")}.
          Merge one before the roster grows again.
        </div>
      )}

      <p className="eyebrow">Employees</p>
      {employees === null ? (
        <Loading />
      ) : employees.length === 0 ? (
        <Empty title="No one hired yet" hint="Employees run tasks and raise approvals on your behalf." />
      ) : (
        employees.map((e) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">
                {e.name}
                {e.lifecycle !== "active" && <span className="pill">{e.lifecycle}</span>}
              </div>
              <div className="row-sub">
                {e.role} · {e.department ?? "unassigned"} ·{" "}
                {e.autonomy === "auto" ? "acts alone" : "asks before acting"}
              </div>
            </div>
            <div className="row-val">{e.open_tasks} open</div>
          </div>
        ))
      )}

      <p className="eyebrow">Recent work</p>
      {tasks.length === 0 ? (
        <Empty title="No tasks yet" hint="Queued work shows here with what it cost." />
      ) : (
        tasks.slice(0, 25).map((t) => (
          <div className="row" key={t.id}>
            <div className="row-main">
              <div className="row-title">{t.title}</div>
              <div className="row-sub">
                {t.employee_name ?? "Unassigned"} · {t.status.replace(/_/g, " ")}
                {t.intake_kind ? ` · ${t.intake_kind.replace(/_/g, " ")}` : ""}
                {t.error ? ` · ${t.error}` : ""}
              </div>
            </div>
            <div className="row-val">{usd(t.cost_micros)}</div>
          </div>
        ))
      )}
    </>
  );
}

/**
 * Intake, from the phone. The classification is shown before anything is
 * created, so it is obvious when the system is about to hand something back
 * rather than do it.
 */
function NewTask({ templates, onDone }: { templates: any[]; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!title.trim()) { setPreview(null); return; }
    const timer = setTimeout(() => {
      api.classify({ title, prompt }).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [title, prompt]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: any = { title, input: prompt ? { prompt } : {} };
      if (templateId) body.template_id = templateId;
      const res = await api.createTask(body);
      if (res.created === false) {
        setResult(`Boss OS declined this one: ${res.reason}`);
      } else {
        setResult(
          res.task.status === "queued"
            ? "Queued. It will raise an approval when it has something to show."
            : `Held for you: intake assigned it ${res.classification.executionAssignment.replace(/_/g, " ")}.`,
        );
        setTitle(""); setPrompt(""); setTemplateId("");
        setTimeout(onDone, 1200);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {result && <div className="notice" style={{ borderColor: "var(--gold)" }}>{result}</div>}

      <label className="field">
        <span>What needs doing</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft the reply to the LP" />
      </label>

      <label className="field">
        <span>Detail (optional)</span>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      {templates.length > 0 && (
        <label className="field">
          <span>Template</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">None — classify it fresh</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}

      {preview && (
        <div className="preview">
          <div><strong>{preview.classification.intakeKind.replace(/_/g, " ")}</strong> · {preview.classification.risk} risk · {preview.classification.sensitivity}</div>
          <div className="row-sub">{preview.classification.executionAssignment.replace(/_/g, " ")} — {preview.classification.reason}</div>
          {preview.suggested && <div className="row-sub">Would go to {preview.suggested.name}.</div>}
        </div>
      )}

      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !title.trim()} onClick={submit}>
        {busy ? "Sending…" : "Send it in"}
      </button>
    </div>
  );
}

/**
 * The Mastery Lens Bench — canon §76.
 *
 * The compiler is the point of the screen: a rough request goes in, and the
 * packet comes back with what was applied to it, what argues with it, and what
 * it scored. The library sits underneath, and nothing is in it that was not
 * reviewed in the approval inbox first.
 */
function Prompts() {
  const [request, setRequest] = useState("");
  const [taskKind, setTaskKind] = useState("");
  const [tier, setTier] = useState("2");
  const [result, setResult] = useState<any | null>(null);
  const [lenses, setLenses] = useState<any | null>(null);
  const [library, setLibrary] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    Promise.all([api.lenses(), api.promptLibrary()])
      .then(([l, lib]) => { setLenses(l); setLibrary(lib); })
      .catch(setError);
  }
  useEffect(load, []);

  async function compile() {
    setBusy(true); setError(null); setMsg(null);
    try {
      setResult(await api.compilePacket({ request, task_kind: taskKind || null, tier: Number(tier) }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function propose() {
    if (!result) return;
    setBusy(true); setError(null);
    try {
      const promoted = await api.promotePacket(result.packet.id, { title: request.slice(0, 60) });
      setMsg(promoted.note);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

      <div className="panel">
        <label className="field">
          <span>What do you actually want?</span>
          <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} />
        </label>
        <label className="field">
          <span>Kind of work</span>
          <input value={taskKind} onChange={(e) => setTaskKind(e.target.value)} placeholder="decision_support, repo_work…" />
        </label>
        <label className="field">
          <span>Treatment</span>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="1">tier 1 — full</option>
            <option value="2">tier 2 — standard</option>
            <option value="3">tier 3 — light</option>
          </select>
        </label>
        <p className="row-sub">
          Repo work, investor materials, outbound email, marketing, legal-adjacent writing, money decisions,
          document compiles, private data, external actions, vendor changes and canon updates compile at tier 1
          whatever is chosen here.
        </p>
        <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !request.trim()} onClick={compile}>
          {busy ? "Compiling…" : "Compile the packet"}
        </button>
      </div>

      {result && (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-n">{result.packet.tier}</div><div className="stat-l">tier</div></div>
            <div className="stat"><div className="stat-n">{result.score.total}</div><div className="stat-l">score</div></div>
            <div className="stat"><div className="stat-n">{result.packet.lens_stack.length}</div><div className="stat-l">lenses</div></div>
          </div>
          <p className="row-sub">{result.packet.tier_reason}</p>

          <p className="eyebrow">Stack</p>
          {result.packet.sections.method.map((m: any) => (
            <div className="row" key={m.lens}>
              <div className="row-main">
                <div className="row-title">{m.name}</div>
                <div className="row-sub">{m.origin}</div>
              </div>
            </div>
          ))}
          {result.packet.sections.counter_check && (
            <div className="row">
              <div className="row-main">
                <div className="row-title">Counter-check: {result.packet.sections.counter_check.name}</div>
                <div className="row-sub">{result.packet.sections.counter_check.questions.join(" · ")}</div>
              </div>
            </div>
          )}

          <p className="eyebrow">Score</p>
          {result.score.dimensions.map((d: any) => (
            <div className="row" key={d.key}>
              <div className="row-main">
                <div className="row-title">{d.key.replace(/_/g, " ")}</div>
                <div className="row-sub">{d.why}</div>
              </div>
              <div className="row-val">{d.points}/{d.max}</div>
            </div>
          ))}

          <p className="eyebrow">The packet</p>
          <pre className="docket-full" style={{ whiteSpace: "pre-wrap" }}>{result.packet.compiled_prompt}</pre>

          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={propose}>Propose it for the library</button>
          </div>
        </>
      )}

      <p className="eyebrow">Library</p>
      {library.length === 0 ? (
        <Empty title="Nothing in the library" hint="Prompts enter through review in the approval inbox, never directly." />
      ) : (
        library.map((l) => (
          <div className="row" key={l.id}>
            <div className="row-main">
              <div className="row-title">{l.title}</div>
              <div className="row-sub">tier {l.tier} · {l.status}{l.uses ? ` · used ${l.uses} times` : ""}</div>
            </div>
            <div className="row-actions">
              {l.status === "approved" && (
                <button className="btn btn-small" onClick={() => api.usePrompt(l.id).then(load).catch(setError)}>Use</button>
              )}
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">The bench</p>
      {lenses?.lenses?.map((l: any) => (
        <div className="row" key={l.key}>
          <div className="row-main">
            <div className="row-title">{l.name}</div>
            <div className="row-sub">{l.summary}</div>
            <div className="row-sub">{l.category} · from {l.origin} · argued with by {l.counter_lens_key}</div>
          </div>
          <div className="row-val">t{l.tier_minimum}</div>
        </div>
      ))}
      {lenses && <p className="row-sub">{lenses.law.text}</p>}
    </>
  );
}
