import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * The seven subsystems that had an API and no screen.
 *
 * WHY A HUB AND NOT SEVEN TABS. The tab bar already carries nine destinations, which is the most a
 * thumb can reach on a phone without the labels turning into abbreviations. Seven more would have
 * made the bar a scrolling list — the pattern where you stop reading the labels and start hunting.
 * So these arrive as one tab with a section switcher, which is also honest about what they are:
 * the machinery behind the operating screens, not places you visit every morning.
 *
 * EVERY PANEL IS REAL. Each one reads its own live endpoint and renders what came back — including
 * nothing, which is a state each panel names rather than showing an empty box. None of them
 * fabricates a number the server did not send.
 */
type SectionId = "governance" | "knowledge" | "prompt" | "quant" | "bridge" | "capability" | "runtimes" | "sync";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "governance", label: "Governance" },
  { id: "knowledge", label: "Knowledge" },
  { id: "prompt", label: "Prompts" },
  { id: "quant", label: "Quant" },
  { id: "bridge", label: "Bridge" },
  { id: "capability", label: "Capability" },
  { id: "runtimes", label: "Runtimes" },
  { id: "sync", label: "Sync" },
];

export function Systems() {
  const [section, setSection] = useState<SectionId>("governance");
  return (
    <>
      <div className="seg" role="tablist" aria-label="Systems">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className="seg-btn"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "governance" && <Governance />}
      {section === "knowledge" && <Knowledge />}
      {section === "prompt" && <Prompts />}
      {section === "quant" && <Quant />}
      {section === "bridge" && <Bridge />}
      {section === "capability" && <Capability />}
      {section === "runtimes" && <Runtimes />}
      {section === "sync" && <Sync />}
    </>
  );
}

/**
 * One loader for every panel.
 *
 * A LIST MUST SPEAK WHILE IT IS LOADING. The chassis enforces that with a scan, and it is the same
 * rule here: three states, all named. Loading says so, a failure says what happened and keeps the
 * page, and an empty result says it is empty rather than rendering a blank rectangle that looks
 * like something is still coming.
 */
function usePanel<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1), setError };
}

function Panel({
  title,
  hint,
  state,
  children,
}: {
  title: string;
  hint: string;
  state: { data: unknown; error: unknown };
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">{title}</p>
      <ErrorNotice error={state.error} />
      {state.error ? null : state.data === null ? <Loading /> : isEmpty(state.data) ? <Empty title="Nothing here yet" hint={hint} /> : children}
    </section>
  );
}

/**
 * Coerce a payload to a list, because `?.map` is not the guard it looks like.
 *
 * These endpoints are typed `any` on the client, and several of them return an OBJECT that wraps
 * the rows rather than the rows themselves. `data?.map(...)` survives null and undefined and then
 * walks straight into `data.map is not a function` on `{ flags: [...] }` — an uncaught TypeError,
 * which in React 18 unmounts the whole tree. The E2E suite caught exactly that: one governance
 * endpoint returned a wrapper and the entire Boss OS app went blank, tab bar and all.
 *
 * So no panel calls `.map` on a payload again. Anything that is not a list becomes one, and a
 * shape nobody anticipated renders as empty rather than taking the app down.
 */
function asList(d: unknown): any[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const v of Object.values(d as Record<string, unknown>)) if (Array.isArray(v)) return v;
  }
  return [];
}

function isEmpty(d: unknown) {
  if (d === null || d === undefined) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (typeof d === "object") return Object.keys(d as object).length === 0;
  return false;
}

function Row({ title, sub, val }: { title: string; sub?: string; val?: string }) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      {val && <div className="row-val">{val}</div>}
    </div>
  );
}

function text(v: unknown, fallback = "—") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

/* ─── Governance ──────────────────────────────────────────────────────────── */

function Governance() {
  const flags = usePanel(() => api.complianceFlags());
  const rights = usePanel(() => api.decisionRights());
  const plays = usePanel(() => api.playbooks());
  return (
    <>
      <Panel title="Compliance sentinel" hint="The sentinel has raised nothing. Run it from Settings to check now." state={flags}>
        {asList(flags.data).map((f: any) => (
          <Row key={f.id} title={text(f.title ?? f.watch_item)} sub={text(f.detail ?? f.reason, "")} val={text(f.severity ?? f.status)} />
        ))}
      </Panel>
      <Panel title="Decision rights" hint="No decision classes are declared." state={rights}>
        {asList(rights.data).map((r: any) => (
          <Row key={r.id ?? r.action_class} title={text(r.action_class ?? r.id)} sub={text(r.rule ?? r.who, "")} val={text(r.decider ?? r.authority)} />
        ))}
      </Panel>
      <Panel title="Failure playbooks" hint="No playbook's condition is true right now, which is the good case." state={plays}>
        {asList(plays.data).map((p: any) => (
          <Row key={p.id ?? p.key} title={text(p.title ?? p.key)} sub={text(p.condition, "")} val={p.active ? "ACTIVE" : undefined} />
        ))}
      </Panel>
    </>
  );
}

/* ─── Knowledge OS ────────────────────────────────────────────────────────── */

function Knowledge() {
  const surfaces = usePanel(() => api.surfaces());
  const versions = usePanel(() => api.manualVersions());
  return (
    <>
      <Panel title="Surfaces" hint="No surface holds anything yet. Promote a memory to file it here." state={surfaces}>
        {asList(surfaces.data).map((s: any) => (
          <Row key={s.key ?? s.id} title={text(s.title ?? s.key)} sub={text(s.description, "")} val={text(s.item_count ?? s.items)} />
        ))}
      </Panel>
      <Panel title="Personal Operating Manual" hint="No version has been generated. It is built from promoted memory, so promote something first." state={versions}>
        {asList(versions.data).map((v: any) => (
          <Row key={v.id} title={`Version ${text(v.version ?? v.id)}`} sub={text(v.content_hash, "")} val={text(v.generated_at ?? v.created_at)} />
        ))}
      </Panel>
    </>
  );
}

/* ─── Prompt Intelligence ─────────────────────────────────────────────────── */

function Prompts() {
  const lenses = usePanel(() => api.lenses());
  const pov = usePanel(() => api.povCards());
  const lib = usePanel(() => api.promptLibrary());
  return (
    <>
      <Panel title="Mastery lens bench" hint="The bench is empty, which should not happen — the lenses are seeded." state={lenses}>
        {asList(lenses.data).map((l: any) => (
          <Row key={l.key ?? l.id} title={text(l.name ?? l.key)} sub={text(l.origin_discipline ?? l.method, "")} val={text(l.counter_lens, "")} />
        ))}
      </Panel>
      <Panel title="Points of view" hint="No POV cards are registered." state={pov}>
        {asList(pov.data).map((c: any) => <Row key={c.key ?? c.id} title={text(c.name ?? c.key)} sub={text(c.stance ?? c.description, "")} />)}
      </Panel>
      <Panel title="Approved library" hint="Nothing has passed the library gate. A packet enters only through the approval inbox." state={lib}>
        {asList(lib.data).map((p: any) => (
          <Row key={p.id} title={text(p.title ?? p.id)} sub={text(p.output_contract, "")} val={text(p.uses ?? p.use_count)} />
        ))}
      </Panel>
    </>
  );
}

/* ─── AI Quant Fund ───────────────────────────────────────────────────────── */

function Quant() {
  const validation = usePanel(() => api.quantValidation());
  const rungs = usePanel(() => api.quantRungs());
  const nevers = usePanel(() => api.quantNevers());
  const engines = usePanel(() => api.quantEngines());
  return (
    <>
      <section className="panel">
        <p className="eyebrow">Validation status</p>
        <ErrorNotice error={validation.error} />
        {validation.data === null && !validation.error ? (
          <Loading />
        ) : (
          <dl className="kv">
            {Object.entries((validation.data as any) ?? {}).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k.replace(/_/g, " ")}</dt>
                <dd className="mono">{typeof v === "object" ? JSON.stringify(v) : text(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <Panel title="Scale ladder" hint="No rung is declared." state={rungs}>
        {asList(rungs.data).map((r: any) => (
          <Row key={r.rung ?? r.id} title={`Rung ${text(r.rung ?? r.id)}`} sub={text(r.requirement ?? r.gate, "")} val={r.open ? "OPEN" : "CLOSED"} />
        ))}
      </Panel>
      <Panel title="The risk constitution" hint="No nevers are recorded, which would itself be the finding." state={nevers}>
        {asList(nevers.data).map((n: any) => (
          <Row key={n.id ?? n.key} title={text(n.statement ?? n.key)} val={n.enforced_in_code ? "IN CODE" : "PROCEDURAL"} />
        ))}
      </Panel>
      <Panel title="Engines" hint="No engine is registered, so the kill switch stays UNPROVEN — which the status above says out loud." state={engines}>
        {asList(engines.data).map((e: any) => (
          <Row key={e.id} title={text(e.name ?? e.id)} sub={text(e.control_url, "no control endpoint")} val={text(e.last_probe_outcome, "never probed")} />
        ))}
      </Panel>
    </>
  );
}

/* ─── Firm OS bridge ──────────────────────────────────────────────────────── */

function Bridge() {
  const sep = usePanel(() => api.bridgeSeparation());
  const cats = usePanel(() => api.bridgeCategories());
  const hand = usePanel(() => api.handoffs());
  return (
    <>
      <section className="panel">
        <p className="eyebrow">Separation</p>
        <ErrorNotice error={sep.error} />
        {sep.data === null && !sep.error ? (
          <Loading />
        ) : (
          <dl className="kv">
            {Object.entries((sep.data as any) ?? {}).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k.replace(/_/g, " ")}</dt>
                <dd className="mono">{typeof v === "object" ? JSON.stringify(v) : text(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="panel">
        <p className="eyebrow">Forbidden categories</p>
        <ErrorNotice error={cats.error} />
        {cats.data === null && !cats.error ? (
          <Loading />
        ) : (
          <div className="btn-row">
            {asList((cats.data as any)?.forbidden ?? (cats.data as any)?.categories ?? cats.data).map((c: any) => (
              <span className="pill" key={String(c)}>{String(c)}</span>
            ))}
          </div>
        )}
      </section>
      <Panel title="Handoffs" hint="Nothing has crossed the boundary, in either direction." state={hand}>
        {asList(hand.data).map((h: any) => (
          <Row key={h.id} title={text(h.title)} sub={`${text(h.direction)} · ${text(h.category)}`} val={text(h.status)} />
        ))}
      </Panel>
    </>
  );
}

/* ─── Capability Intelligence ─────────────────────────────────────────────── */

function Capability() {
  const caps = usePanel(() => api.capabilities());
  const cover = usePanel(() => api.capabilityCoverage());
  return (
    <>
      <Panel title="Coverage" hint="No job types are declared." state={cover}>
        {asList(cover.data).map((c: any) => (
          <Row key={c.job_type ?? c.id} title={text(c.job_type ?? c.id)} sub={text(c.default_capability ?? c.active_default, "no active default")} val={text(c.alternatives)} />
        ))}
      </Panel>
      <Panel title="Capability packages" hint="No capability is registered." state={caps}>
        {asList(caps.data).map((c: any) => (
          <Row key={c.key ?? c.id} title={text(c.name ?? c.key)} sub={text(c.mechanism ?? c.description, "")} val={c.is_core ? "CORE" : undefined} />
        ))}
      </Panel>
    </>
  );
}

/* ─── Runtimes ────────────────────────────────────────────────────────────── */

function Runtimes() {
  const jobs = usePanel(() => api.runtimeJobs());
  const arts = usePanel(() => api.artifacts());
  const audits = usePanel(() => api.seoAudits());
  return (
    <>
      <Panel title="Runtime jobs" hint="No runtime has been asked to do anything yet." state={jobs}>
        {asList(jobs.data).map((j: any) => (
          <Row key={j.id} title={text(j.kind ?? j.runtime)} sub={text(j.created_at, "")} val={text(j.status)} />
        ))}
      </Panel>
      <Panel title="Compiled documents" hint="The Document Compiler has produced nothing. It assembles from named live sources." state={arts}>
        {asList(arts.data).map((a: any) => (
          <Row key={a.id} title={text(a.title ?? a.id)} sub={text(a.content_hash, "")} val={text(a.section_count ?? a.sections)} />
        ))}
      </Panel>
      <Panel title="SEO/GEO audits" hint="No audit has run. Everything needing the network is reported as deferred, never guessed." state={audits}>
        {asList(audits.data).map((a: any) => (
          <Row key={a.id} title={text(a.target ?? a.url ?? a.id)} sub={text(a.created_at, "")} val={text(a.checks_passed ?? a.status)} />
        ))}
      </Panel>
    </>
  );
}


/* ─── Sync: devices and the conflict inbox ────────────────────────────────── */

/**
 * A conflict nobody can see is a conflict nobody resolves, and the two sides stay diverged while
 * the system looks fine. Batch 6 asks for the inbox to show the entity, both versions, the base
 * they came apart from, why, and which resolutions are SAFE for that entity — and for a
 * NEVER_AUTOMATIC record that is a hand merge only, because a machine may not pick a winner
 * between two capital allocations however confident the rule looks.
 */
function Sync() {
  const status = usePanel(() => api.syncStatus());
  const conflicts = usePanel(() => api.syncConflicts());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function resolve(id: string, resolution: string) {
    setBusy(id);
    try {
      await api.resolveConflict(id, { resolution, by: "owner" });
      conflicts.reload();
      status.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const rows = asList((conflicts.data as any)?.conflicts ?? conflicts.data);
  return (
    <>
      <section className="panel">
        <p className="eyebrow">Devices</p>
        <ErrorNotice error={status.error} />
        {status.data === null && !status.error ? (
          <Loading />
        ) : asList((status.data as any)?.devices).length === 0 ? (
          <Empty title="No device is registered" hint="A device is registered before it may sync. Nothing else has asked to." />
        ) : (
          asList((status.data as any)?.devices).map((d: any) => (
            <Row
              key={d.device_id}
              title={text(d.label)}
              sub={`${text(d.kind)} · ${text(d.device_id)}`}
              val={d.revoked_at ? "REVOKED" : "ACTIVE"}
            />
          ))
        )}
      </section>

      <section className="panel">
        <p className="eyebrow">Conflict inbox</p>
        <ErrorNotice error={error ?? conflicts.error} onDismiss={() => setError(null)} />
        {conflicts.data === null && !conflicts.error ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="Nothing disagrees" hint="Both sides hold the same version of every record. This is the state you want it to stay in." />
        ) : (
          rows.map((cf: any) => (
            <div className="row" key={cf.id}>
              <div className="row-main">
                <div className="row-title">{text(cf.entity)} · {text(cf.record_id)}</div>
                <div className="row-sub">{text(cf.reason)}</div>
                <div className="row-sub mono">
                  base {text(cf.base_version, "none")} · here {text(cf.cloud_version)} · {text(cf.merge_policy)}
                </div>
                <div className="decide" style={{ marginTop: 8 }}>
                  {asList(cf.safe_actions).map((a: string) => (
                    <button
                      key={a}
                      className={a === "KEPT_CURRENT" ? "btn btn-approve" : a === "APPLIED_INCOMING" ? "btn btn-defer" : "btn"}
                      disabled={busy === cf.id}
                      onClick={() => resolve(cf.id, a)}
                    >
                      {a === "KEPT_CURRENT" ? "Keep this" : a === "APPLIED_INCOMING" ? "Take theirs" : "Merged by hand"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
