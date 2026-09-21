import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

export function Team() {
  const [view, setView] = useState<"team" | "duties" | "owns" | "prompts" | "capabilities">("team");

  return (
    <>
      <div className="btn-row">
        <button className="btn" aria-pressed={view === "team"} onClick={() => setView("team")}>Team</button>
        {/*
          * WHAT THEY OWN, BESIDE WHO THEY ARE. Handing someone a deliverable is a different act
          * from giving them a duty — a duty fires, a deliverable is not finished until an outcome
          * in the world is true — and the register belongs next to the roster because the first
          * question about a stuck commitment is who is on the hook for it.
          */}
        {/*
          * WHEN THEY ACT WITHOUT BEING ASKED, and the door for giving them more. Owner, 21 Sep
          * 2026: "is there a lane for me to ask for a new duty to my Boss OS agents? i still dont
          * know how to create a job for them." The drafter existed and nothing invoked it.
          */}
        <button className="btn" aria-pressed={view === "duties"} onClick={() => setView("duties")}>Duties</button>
        <button className="btn" aria-pressed={view === "owns"} onClick={() => setView("owns")}>Owns</button>
        <button className="btn" aria-pressed={view === "prompts"} onClick={() => setView("prompts")}>Prompts</button>
        <button className="btn" aria-pressed={view === "capabilities"} onClick={() => setView("capabilities")}>Capabilities</button>
      </div>
      {view === "team" ? <Roster />
        : view === "duties" ? <Duties />
        : view === "owns" ? <Owns />
        : view === "prompts" ? <Prompts /> : <Capabilities />}
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
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);

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

      {/*
        * ONLY MEASURED OVERLAP EARNS A RECOMMENDATION.
        *
        * This banner used to read "Two employees cover the same ground: Chief of Staff, Task
        * Intake; Model Router, Continuity. Merge one before the roster grows again." - rendered
        * from a COUNT of who shares a department. Those four each do a job nobody else does, so
        * the screen's standing advice was to merge away a job the system needs. See the note on
        * `/review/sprawl`.
        *
        * Now it appears only when two charters genuinely say the same thing, it names the pair
        * rather than a department's whole membership, and it shows the score - so the reader can
        * disagree with the measurement instead of only with the verdict.
        */}
      {sprawl?.overlapping_charters?.length > 0 && (
        <div className="notice" style={{ borderColor: "var(--gold)" }}>
          {sprawl.overlapping_charters.map((o: any) => (
            <div key={`${o.a.id}-${o.b.id}`}>
              {o.a.name} and {o.b.name} have nearly the same standing orders
              {" "}({Math.round(o.similarity * 100)}% of the wording is shared). Read both charters,
              then merge or narrow one.
            </div>
          ))}
        </div>
      )}

      {openEmployee && <EmployeeSheet id={openEmployee} onClose={() => setOpenEmployee(null)} />}

      <p className="eyebrow">Employees</p>
      {employees === null ? (
        <Loading />
      ) : employees.length === 0 ? (
        <Empty title="No one hired yet" hint="Employees run tasks and raise approvals on your behalf." />
      ) : (
        employees.map((e) => (
          /*
            * A BUTTON, NOT A DIV. The owner asked "why cant i click on an employee name or pic and
            * get a read on what they do for me?" — and the answer was that the endpoint returning
            * her charter existed and nothing in the interface called it. A row that opens something
            * must be operable by keyboard and announce itself as operable, which a div cannot do
            * however many click handlers it carries.
            */
          <button className="row row-tap" key={e.id} onClick={() => setOpenEmployee(e.id)}>
            {/*
              * THE ALT TEXT IS THE HONESTY STATEMENT, and it is not optional.
              *
              * Seven polished headshots on a team screen are indistinguishable from photographs of
              * real staff. The one way this becomes a problem is if a face is later taken for a
              * colleague, so every portrait says what it is to anyone who cannot see it — and
              * MANIFEST.json says the same thing beside the files.
              *
              * A missing file degrades to nothing rather than a broken image: the row still reads,
              * because the name and the role are the information and the face is decoration.
              */}
            <img
              className="avatar"
              src={`/employees-boss/${String(e.name ?? "").toLowerCase()}.jpg`}
              alt={`${e.name}, ${e.role} — an AI-generated portrait of a person who does not exist`}
              loading="lazy"
              onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
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
          </button>
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
            {/*
              * VISIBLE, NOT A TOOLTIP. A subscription-backed run costs this column nothing, so an
              * unlabelled $0.00 beside a task reads as "that was free" when it means "this figure
              * cannot see what that cost". A label she has to hover for is a label she never reads.
              */}
            <div className="row-val">
              {usd(t.cost_micros)}
              <div className="stat-l" style={{ margin: 0 }}>metered</div>
            </div>
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
        const scan = (() => { try { return JSON.parse(res.task.input ?? "null")?.firm_scan; } catch { return null; } })();
        setResult(
          scan
            ? `Camille has it: find firms that ${scan.find}, and draft the ask "${scan.ask}". The list and the letters land on the Capital desk and in your Inbox as they are ready.`
            : res.task.status === "queued"
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

/**
 * WHAT THIS PERSON ACTUALLY DOES FOR YOU.
 *
 * The list gave a name, a role and a department — none of which says what someone is FOR. The
 * charter does, and it was sitting behind `GET /employees/:id`, an endpoint that existed and that
 * nothing in the interface had ever called.
 *
 * THE THREE THINGS THAT MAKE AN EMPLOYEE LEGIBLE, in this order: what she is for (the charter),
 * when she acts without being asked (her standing duties), and what she follows when she does (the
 * spec). The owner asked for the first and the third in the same breath, of Camille and her morning
 * report, and they belong on one screen because they are one question.
 */
function EmployeeSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    api.employee(id).then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [id]);

  const e = data?.employee;

  return (
    <div className="sheet" role="dialog" aria-label="Employee detail">
      <div className="sheet-head">
        <p className="eyebrow" style={{ margin: 0 }}>{e?.name ?? "Loading"}</p>
        <button className="btn btn-small" onClick={onClose}>Close</button>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {!data && !error ? (
        <Loading />
      ) : e ? (
        <>
          <div className="sheet-id">
            <img
              className="avatar avatar-lg"
              src={`/employees-boss/${String(e.name ?? "").toLowerCase()}.jpg`}
              alt={`${e.name} — an AI-generated portrait of a person who does not exist`}
              onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
            <div>
              <div className="row-title">{e.role}</div>
              <div className="row-sub">
                {e.department ?? "unassigned"} · {e.lane} lane ·{" "}
                {e.autonomy === "auto" ? "acts alone" : "asks before acting"}
              </div>
            </div>
          </div>

          {/* The charter is the point of this panel, so it leads and it is quoted, not summarised. */}
          <p className="eyebrow">What she is for</p>
          <p className="charter">{e.charter ?? "No charter recorded — which means nothing governs what she does."}</p>

          <p className="eyebrow">When she acts without being asked</p>
          {(data.duties ?? []).length === 0 ? (
            <Empty title="No standing duties" hint="She acts only when work is routed to her." />
          ) : (
            data.duties.map((d: any) => (
              <div className="row" key={d.id}>
                <div className="row-main">
                  <div className="row-title">{d.name}</div>
                  <div className="row-sub">
                    {d.cadence} at {String(d.local_hour).padStart(2, "0")}:{String(d.local_minute).padStart(2, "0")} {d.timezone}
                    {d.suspended ? " · suspended" : ""}
                    {" · "}{d.success_criteria}
                  </div>
                </div>
                <div className="row-val">
                  {d.suspended ? "off" : d.next_due_at ? new Date(d.next_due_at).toLocaleString() : "next tick"}
                </div>
              </div>
            ))
          )}

          {/*
            * WHERE THE DOCUMENT LIVES, stated plainly including the part that is inconvenient: it
            * is in the repository, not in this product. Naming the path is not the same as being
            * able to open it, and pretending otherwise would answer her question wrongly.
            */}
          {(data.specs ?? []).length > 0 && (
            <>
              <p className="eyebrow">What she follows</p>
              {data.specs.map((sp: string) => (
                <div className="row" key={sp}>
                  <div className="row-main">
                    <div className="row-title">{sp.split("/").pop()}</div>
                    <div className="row-sub">{sp} — in the repository. Not readable from here yet.</div>
                  </div>
                </div>
              ))}
            </>
          )}

          <p className="eyebrow">Cost</p>
          <div className="row">
            <div className="row-main">
              <div className="row-title">${((e.budget_micros_day ?? 0) / 1_000_000).toFixed(2)} a day</div>
              <div className="row-sub">
                Her own ceiling. The lane budget and the spend lever bind first when either is tighter.
              </div>
            </div>
            <div className="row-val">${((data.lifetime_cost_micros ?? 0) / 1_000_000).toFixed(4)} ever</div>
          </div>

          <p className="eyebrow">Recent work</p>
          {(data.recent_tasks ?? []).length === 0 ? (
            <Empty title="Nothing yet" hint="Tasks routed to her appear here with what they cost." />
          ) : (
            data.recent_tasks.slice(0, 8).map((t: any) => (
              <div className="row" key={t.id}>
                <div className="row-main">
                  <div className="row-title">{t.title}</div>
                  <div className="row-sub">{t.status} · {new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className="row-val">${((t.cost_micros ?? 0) / 1_000_000).toFixed(4)}</div>
              </div>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}


/**
 * THE REGISTER OF OWNED WORK.
 *
 * Her rule: "she owns this deliverable so she needs to make sure its done and if there is any block
 * she needs to tell me immediately and keep reminding me until its done. she canot drop it. that
 * goes for all employees when i give them something to own."
 *
 * The reminding happens on Today, under Critical Alerts, getting louder the longer a block sits —
 * an escalation she has to come here to find would not be one. THIS screen is the register and the
 * one lever: stopping a commitment, which costs a reason and is the only way out that is not the
 * work actually being finished.
 *
 * THERE IS NO "MARK DONE" BUTTON AND THERE MUST NEVER BE ONE. Completion is granted by counting
 * real records — `TERMINAL_CHECKS` in the Worker — because the moment a person can declare a
 * commitment finished, "done" means "somebody said so", which is what a duty already meant and is
 * exactly how the practice duty spent eleven Sundays succeeding at nothing.
 */
function Owns() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function load() {
    api.deliverables().then(setData).catch(setError);
  }
  useEffect(load, []);

  async function stop(id: string) {
    setError(null);
    try {
      await api.setDeliverableState(id, { state: "killed", killed_reason: reason });
      setStopping(null);
      setReason("");
      load();
    } catch (e) { setError(e); }
  }

  if (!data) return error ? <ErrorNotice error={error} /> : <Loading />;

  const list: any[] = Array.isArray(data.deliverables) ? data.deliverables : [];

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/* An empty register reads as "nothing is stuck", which is why it is reported as a fault. */}
      {data.empty_register && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          <strong>{data.empty_register}</strong>
        </div>
      )}

      <p className="eyebrow">Owned work — {data.open} open</p>
      <p className="row-sub">{data.rule}</p>

      {list.length === 0 ? (
        <Empty title="Nothing is owned yet" hint="A deliverable is something you hand a person, with a condition that says when it is finished." />
      ) : (
        list.map((d) => (
          <div className="docket" key={d.id}>
            <div className="docket-head">
              <span className="docket-no">{d.state === "blocked" ? "!!" : d.state === "done" ? "✓" : "··"}</span>
              <h3 style={{ margin: 0 }}>{d.name}</h3>
            </div>
            <p style={{ marginTop: 6 }}>
              {d.employee_name ?? d.employee_id}
              {d.employee_role ? ` — ${d.employee_role}` : ""} · {d.state}
              {d.days_blocked !== null && d.days_blocked !== undefined ? ` for ${d.days_blocked} days` : ""}
            </p>
            {d.state === "blocked" && d.blocker && <p className="row-sub">{d.blocker}</p>}
            {d.escalation && <p className="row-sub">{d.escalation.tone}</p>}
            {d.stalled && (
              <p className="row-sub">
                Nothing has happened on this for {d.days_silent} days. Silence is the alarm here, not the calm.
              </p>
            )}
            {!d.checkable && (
              <p className="row-sub">
                Its completion check ({d.terminal_check}) is not one this system has, so nothing can ever mark it done.
              </p>
            )}
            <details>
              <summary className="docket-more" style={{ cursor: "pointer" }}>Open</summary>
              <div className="docket-full">
                <p className="row-sub"><strong>Finished when:</strong> {d.terminal_condition}</p>
                <p className="row-sub"><strong>How you find out:</strong> {d.escalation_path}</p>
                {d.killed_reason && <p className="row-sub"><strong>Stopped because:</strong> {d.killed_reason}</p>}
                {(d.state === "open" || d.state === "blocked") && (
                  stopping === d.id ? (
                    <>
                      {/*
                        * `.field`, not `.input`. There is no `.input` rule in Boss's stylesheet and
                        * never was, so the one control that stops an owned deliverable — the thing
                        * OPERATIONS says "costs a reason" — rendered as a raw browser input in the
                        * middle of a designed page. `validate:css-classes` had been reporting it and
                        * the scan is not in `npm run validate`, so nothing failed. A misspelt class
                        * is the one front-end mistake with no symptom: it renders, unstyled, for ever.
                        */}
                      <label className="field">
                        <span>Why are you stopping it?</span>
                        <input
                          placeholder="It costs a reason, and the reason stays in the register."
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          aria-label={`Reason for stopping ${d.name}`}
                        />
                      </label>
                      <div className="btn-row">
                        <button className="btn" disabled={!reason.trim()} onClick={() => stop(d.id)}>Stop it</button>
                        <button className="btn" onClick={() => { setStopping(null); setReason(""); }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div className="btn-row">
                      <button className="btn" onClick={() => setStopping(d.id)}>Stop this</button>
                    </div>
                  )
                )}
              </div>
            </details>
          </div>
        ))
      )}
    </>
  );
}


/**
 * ─── DUTIES: WHO ACTS WITHOUT BEING ASKED, AND THE DOOR FOR GIVING THEM MORE ───
 *
 * Owner, 21 September 2026: "is there a lane for me to ask for a new duty to my Boss OS agents?
 * i still dont know how to create a job for them — if it's not user-friendly then make it so."
 *
 * Per employee, every duty with its cadence, executor, last run, next run and last outcome — the
 * roster endpoint has carried all of that for a while and no screen showed it in one place. And
 * "Add a duty": her phrase in, the draft previewed in full (the same letter the mail door sends),
 * then Create files exactly what the mail door files — a card in the Inbox whose Approve creates
 * it. A draft that cannot run is a NAMED STOP here, as it is by mail, and files nothing.
 *
 * The mail door is stated on the screen because it is the door she will actually use from her
 * phone: `#<seat> new duty …` to boss@sequoiataylor.com, reply `approved`.
 */
function Duties() {
  const [data, setData] = useState<any | null>(null);
  const [drafts, setDrafts] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [phrase, setPhrase] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<any | null>(null);

  function load() {
    Promise.all([api.roster(), api.dutyDrafts()])
      .then(([r, d]) => { setData(r); setDrafts(d); if (!employeeId && r.roster?.[0]) setEmployeeId(r.roster[0].id); })
      .catch(setError);
  }
  useEffect(load, []);

  async function draft() {
    setError(null); setPreview(null); setFiled(null); setBusy(true);
    try { setPreview(await api.draftDuty({ employee_id: employeeId, phrase, preview: true })); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function create() {
    setError(null); setBusy(true);
    try {
      const r = await api.draftDuty({ employee_id: employeeId, phrase });
      setFiled(r); setPreview(null); setPhrase(""); load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  const when = (d: any) => {
    const t = `${String(d.local_hour).padStart(2, "0")}:${String(d.local_minute).padStart(2, "0")}`;
    if (d.cadence === "daily") {
      let days: number[] = [];
      try { days = JSON.parse(d.weekdays ?? "null") ?? []; } catch { days = []; }
      return days.length ? `${days.map((n) => DAY_SHORT[n]).join("/")} at ${t}` : `daily at ${t}`;
    }
    if (d.cadence === "weekly") return `${DAY_SHORT[d.weekday ?? 1]} at ${t}`;
    return `${d.cadence} at ${t}`;
  };
  const executor = (d: any) => d.executor === "local_job" ? `your Mac · ${d.local_job ?? "?"}` : d.executor === "worker" ? "the Worker" : `agent · ${d.model ? (d.model.includes("sonnet") ? "Sonnet" : "Haiku") : "NO MODEL NAMED"}`;
  const stamp = (ms: number | null) => ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Add a duty</p>
      <div className="panel" data-testid="add-duty">
        <p className="row-sub" style={{ marginTop: 0 }}>
          Say it the way you would say it to her. The draft comes back in full — cadence with the slot, executor, model, delivery,
          and anything that would stop it — before anything exists. From your phone: email boss@sequoiataylor.com with
          <code> #&lt;seat&gt; new duty</code> and the same words; reply <code>approved</code> to the draft. Put <em>your call</em> in the
          request and it is created without waiting.
        </p>
        <label className="field">
          <span>Who owns it</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="duty-owner">
            {(data?.roster ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
          </select>
        </label>
        <label className="field">
          <span>The duty, in your words</span>
          <textarea rows={2} value={phrase} onChange={(e) => setPhrase(e.target.value)} data-testid="duty-phrase"
                    placeholder="every friday, write me a short report on what changed in the private markets this week" />
        </label>
        <div className="btn-row">
          <button className="btn btn-small" disabled={busy || !employeeId || phrase.trim().length < 8} onClick={draft} data-testid="preview-duty">Preview the draft</button>
          {preview && preview.draft.refusals.length === 0 && (
            <button className="btn btn-small btn-approve" disabled={busy} onClick={create} data-testid="create-duty">
              {preview.pre_approved ? "Create it now" : "Create — it goes to your Inbox to approve"}
            </button>
          )}
        </div>
        {preview && (
          <div data-testid="duty-preview" style={{ marginTop: 12 }}>
            {preview.draft.refusals.length > 0 && (
              <div className="notice notice-error">
                This duty would not work, so it cannot be created. {preview.draft.refusals.join(" ")}
              </div>
            )}
            <pre className="docket-full" style={{ whiteSpace: "pre-wrap" }}>{preview.letter}</pre>
          </div>
        )}
        {filed && (
          <div className="notice" data-testid="duty-filed">
            {filed.state === "created"
              ? `Created — ${filed.duty_id}. First run ${stamp(filed.first_run_at)}.`
              : "Filed. It is in your Inbox as a card — Approve there creates it exactly as previewed."}
          </div>
        )}
      </div>

      {data && (
        <div className="stats">
          <div className="stat"><div className="stat-n">${data.monthly_estimate_usd}</div><div className="stat-l">a month, estimated, of ${data.ceiling_usd}</div></div>
          <div className="stat"><div className="stat-n">{data.empty_seats?.length ?? 0}</div><div className="stat-l">empty seats</div></div>
        </div>
      )}

      {data === null ? <Loading /> : (data.roster ?? []).map((e: any) => (
        <section key={e.id} data-testid="duties-employee" aria-label={`${e.name}'s duties`}>
          <p className="eyebrow">{e.name} — {e.role}</p>
          {e.duties.length === 0 ? (
            <Empty title="No standing duties" hint="An empty seat: give her one above." />
          ) : e.duties.map((d: any) => (
            <div className="row" key={d.id} data-testid="duty-row">
              <div className="row-main">
                <div className="row-title">
                  {d.name}
                  {d.suspended ? <span className="pill">suspended</span> : d.overdue ? <span className="pill pill-forbid">overdue</span> : null}
                  {d.model_warning && <span className="pill pill-forbid">no model</span>}
                </div>
                <div className="row-sub">
                  {when(d)} · {executor(d)} · about ${d.estimated_per_month_usd}/mo
                </div>
                <div className="row-sub">
                  last run {stamp(d.last_run_at)}
                  {d.last_outcome ? ` · ${d.last_outcome}${d.last_failure_reason ? ` — ${d.last_failure_reason}` : ""}` : d.last_run_at ? "" : " · never fired"}
                </div>
              </div>
              <div className="row-val">{d.suspended ? "off" : `next ${stamp(d.next_due_at)}`}</div>
            </div>
          ))}
        </section>
      ))}

      {drafts && drafts.drafts.length > 0 && (
        <>
          <p className="eyebrow">What you asked for</p>
          {drafts.drafts.slice(0, 12).map((d: any) => (
            <div className="row" key={d.id} data-testid="duty-draft">
              <div className="row-main">
                <div className="row-title">{d.employee_name} — {d.phrase.slice(0, 120)}</div>
                <div className="row-sub">
                  {d.state === "drafted" ? "waiting on you — approve it in the Inbox, or reply approved to the email"
                    : d.state === "created" ? `created · ${d.duty_id} · first run ${stamp(d.first_run_at)}${d.pre_approved_phrase ? ` · pre-approved: "${d.pre_approved_phrase}"` : ""}`
                    : d.state === "refused" ? `refused — ${(d.refusals ?? []).join(" ")}`
                    : d.state === "redrafted" ? "replaced by a later draft"
                    : `held${d.held_note ? ` — ${d.held_note}` : ""}`}
                  {" · "}{d.door} · {stamp(d.created_at)}
                </div>
              </div>
              <div className="row-val">{d.state}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
