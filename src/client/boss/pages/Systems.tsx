import { useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { Panel, Row, asList, text, usePanel } from "../components/panels";
import { BackendRegistry, Launch, Watch } from "./Backends";

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
type SectionId =
  | "launch" | "watch" | "backends"
  | "airlock" | "router" | "intake" | "governance" | "knowledge" | "prompt"
  | "quant" | "bridge" | "capability" | "runtimes" | "sync";

const SECTIONS: { id: SectionId; label: string }[] = [
  /*
   * STAGE 3 — DISPATCH, AND WATCHING IT. These three lead because they are the only sections you
   * ACT in; everything after them is machinery you inspect. They arrive as sections rather than a
   * tab because the tab bar is full at ten and canon §5's Cognitive Load Budget governs it — an
   * eleventh tab costs every screen a little legibility to buy this one a shortcut.
   */
  { id: "launch", label: "Launch" },
  { id: "watch", label: "Watch" },
  { id: "backends", label: "Backends" },
  { id: "airlock", label: "Airlock" },
  // Phase 7's "screens for what already exists but is unreachable". The router decides where every
  // piece of work runs and logs why each candidate was refused; until now none of that was visible
  // anywhere, so "why did nothing happen?" had no answer inside the product.
  { id: "router", label: "Router" },
  { id: "intake", label: "Intake" },
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
  const [section, setSection] = useState<SectionId>("launch");
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
      {section === "launch" && <Launch />}
      {section === "watch" && <Watch />}
      {section === "backends" && <BackendRegistry />}
      {section === "airlock" && <Airlock />}
      {section === "router" && <Router />}
      {section === "intake" && <Intake />}
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
 * THE ROUTER, MADE VISIBLE.
 *
 * `/models`, `/models/routes`, `/models/decisions` and `/models/benchmarks` all worked and none of
 * them had a screen. The operator runbook's answer to "nothing is running" is literally *"`GET
 * /api/models/decisions` records why every candidate model was refused"* - an instruction to open a
 * terminal, about a system whose whole promise is that the Boss does not have to.
 *
 * THE REFUSALS ARE THE POINT, so they lead. `blocked_policy`, `blocked_budget`, `blocked_no_model`
 * and `ask_human` are deliberate decisions, not errors, and a screen that showed only successful
 * routings would hide the four states you actually need when work is not moving.
 */
function Router() {
  const models = usePanel(() => api.models());
  const routes = usePanel(() => api.routes());
  const decisions = usePanel(() => api.decisions());
  const benchmarks = usePanel(() => api.benchmarks());

  return (
    <>
      <Panel title="Recent decisions" hint="Nothing has been routed yet. Every routing decision lands here, including the refusals." state={decisions}>
        {asList(decisions.data).slice(0, 25).map((d: any, i: number) => (
          <Row
            key={d.id ?? i}
            title={text(d.model_id ?? d.chosen_model, "No model chosen")}
            sub={[text(d.lane, ""), text(d.reason ?? d.outcome, "")].filter(Boolean).join(" · ")}
            val={text(d.outcome ?? d.status)}
          />
        ))}
      </Panel>

      <Panel title="Routes" hint="No routes are configured. A route is the lane-and-policy pairing a task is matched against." state={routes}>
        {asList(routes.data).map((r: any, i: number) => (
          <Row key={r.id ?? i} title={text(r.id)} sub={text(r.lane, "")} val={text(r.privacy_class ?? r.cost_mode, "")} />
        ))}
      </Panel>

      <Panel title="Models" hint="No models are registered." state={models}>
        {asList(models.data).map((m: any, i: number) => (
          <Row key={m.id ?? i} title={text(m.id ?? m.name)} sub={text(m.provider_id ?? m.provider, "")} val={text(m.capability_tier ?? m.tier, "")} />
        ))}
      </Panel>

      {/*
        * Phase 8's harness is deliberately not built (docs/boss/DECISIONS.md, BD-003) because
        * honest benchmarking means paying for real inference. The TABLE exists and the router
        * already screens on it, so the panel shows what is there and says plainly when that is
        * nothing - rather than implying a bench was run and came back empty.
        */}
      <Panel title="Benchmarks" hint="No model has been benchmarked. The bench is empty by decision, not by failure — running it means paying for real inference across several models." state={benchmarks}>
        {asList(benchmarks.data).map((b: any, i: number) => (
          <Row
            key={b.id ?? i}
            title={text(b.model_id)}
            sub={text(b.workload_id, "")}
            val={b.quality_score === undefined ? text(b.verdict) : `${Math.round(Number(b.quality_score) * 100)}% · ${text(b.verdict)}`}
          />
        ))}
      </Panel>
    </>
  );
}

/**
 * INTAKE GOVERNANCE — the Agent Creation Gate, and the workloads it matches against.
 *
 * The gate that refuses to invent a new employee when an existing one already covers the ground is
 * one of the system's better ideas, and it ran entirely out of sight: `/intake/workloads`,
 * `/intake/assessments` and `/intake/proposals` had no screen. A refusal nobody can read is a
 * refusal nobody can check.
 */
function Intake() {
  const workloads = usePanel(() => api.workloads());
  const assessments = usePanel(() => api.assessments());
  const proposals = usePanel(() => api.proposals());

  return (
    <>
      <Panel title="Agent proposals" hint="No one has proposed a new employee. Proposals appear here with the gate's verdict attached." state={proposals}>
        {asList(proposals.data).map((p: any, i: number) => (
          <Row key={p.id ?? i} title={text(p.name ?? p.proposed_name)} sub={text(p.rationale ?? p.reason, "")} val={text(p.status ?? p.verdict)} />
        ))}
      </Panel>

      <Panel title="Need assessments" hint="Nothing has been assessed. An assessment is what the No Agent Sprawl gate reads before it allows a proposal." state={assessments}>
        {asList(assessments.data).map((a: any, i: number) => (
          <Row key={a.id ?? i} title={text(a.need ?? a.summary)} sub={text(a.covered_by ? `Already covered by ${a.covered_by}` : "", "")} val={text(a.outcome ?? a.verdict)} />
        ))}
      </Panel>

      <Panel title="Workload profiles" hint="No workload profiles are registered." state={workloads}>
        {asList(workloads.data).map((w: any, i: number) => (
          <Row key={w.id ?? i} title={text(w.id ?? w.name)} sub={text(w.description, "")} val={text(w.risk_ceiling ?? w.privacy_class, "")} />
        ))}
      </Panel>
    </>
  );
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


/* ─── The airlock, legible ────────────────────────────────────────────────── */

/**
 * Batch 8 asks for the boundary to be legible "without creating daily friction", and those pull
 * against each other. The resolution: this ANSWERS rather than warns. It is somewhere you look,
 * not something that interrupts you — a banner on every screen would be read for a week and then
 * not at all, which is worse than no banner because it looks like protection.
 *
 * It reports private compute honestly. No local runtime exists on this deployment, so it says so
 * and says what would make it true, rather than showing a status that reads like readiness.
 */
function Airlock() {
  const view = usePanel(() => api.policyOverview());
  const d = view.data as any;
  const [showAll, setShowAll] = useState(false);

  if (view.error) return <section className="panel"><ErrorNotice error={view.error} /></section>;
  if (d === null) return <section className="panel"><p className="eyebrow">Airlock</p><Loading /></section>;

  const entities = asList(d.entities);
  const sovereign = entities.filter((e: any) => e.residency === "LOCAL_ONLY");
  const shown = showAll ? entities : sovereign;

  return (
    <>
      <section className="panel">
        <p className="eyebrow">What may leave</p>
        <div className="stats">
          <div className="stat"><div className="stat-n">{text(d.counts?.local_only)}</div><div className="stat-l">stay here</div></div>
          <div className="stat"><div className="stat-n">{text(d.counts?.entities)}</div><div className="stat-l">classified</div></div>
          <div className="stat"><div className="stat-n">{text(d.counts?.ai_local_only)}</div><div className="stat-l">no external AI</div></div>
          <div className="stat"><div className="stat-n">{text(d.counts?.ai_needs_approval)}</div><div className="stat-l">AI on approval</div></div>
        </div>
        <p className="row-sub" style={{ marginTop: 10 }}>
          Anything not classified is refused, not allowed. {text(d.counts?.record_overrides)} single records are held tighter than their kind.
        </p>
      </section>

      <section className="panel">
        <p className="eyebrow">Private compute</p>
        <dl className="kv">
          <dt>status</dt><dd>{text(d.private_compute?.status)}</dd>
          <dt>registered</dt><dd>{d.private_compute?.registered ? "yes" : "no"}</dd>
          <dt>provider</dt><dd>{d.provider_selected ? `${text(d.provider_selected.name)}${d.provider_selected.enabled ? "" : " (disabled)"}` : "none selected"}</dd>
        </dl>
        <p className="row-sub">{text(d.private_compute?.detail)}</p>
      </section>

      <section className="panel">
        <p className="eyebrow">Sync</p>
        <div className="stats">
          <div className="stat"><div className="stat-n">{text(d.sync?.devices_active)}</div><div className="stat-l">devices active</div></div>
          <div className="stat"><div className="stat-n">{text(d.sync?.open_conflicts)}</div><div className="stat-l">open conflicts</div></div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">{showAll ? "Every entity" : "Never leaves this system"}</p>
        <div className="btn-row">
          <button className="btn" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Sovereign only</button>
          <button className="btn" aria-pressed={showAll} onClick={() => setShowAll(true)}>All {text(d.counts?.entities)}</button>
        </div>
        {shown.length === 0 ? (
          <Empty title="Nothing is classified" hint="That is itself the finding: an unclassified system refuses everything." />
        ) : (
          shown.map((e: any) => (
            <Row
              key={e.entity}
              title={text(e.entity)}
              sub={text(e.reason)}
              val={e.residency === "LOCAL_ONLY" ? "STAYS HERE" : e.ai_processing === "LOCAL_ONLY" ? "NO EXT AI" : text(e.merge_policy)}
            />
          ))
        )}
      </section>
    </>
  );
}
