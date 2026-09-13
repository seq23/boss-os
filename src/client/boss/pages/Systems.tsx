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
  | "costs"
  | "airlock" | "router" | "intake" | "governance" | "knowledge" | "prompt"
  | "quant" | "bridge" | "capability" | "runtimes" | "sync" | "publishing";

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
  /*
   * COSTS SITS WITH THE ACTION SECTIONS because it is a place she DECIDES in, not one she
   * inspects. Her words: "i see nothing in systems about controlling costs and setting monthly
   * budgets that all got sent to the backends tab?" — cost control had scattered into a tab about
   * something else, so the lever she was given had effectively vanished.
   */
  { id: "costs", label: "Costs" },
  /*
   * PUBLISHING SITS WITH THE ACTION SECTIONS, not with the machinery, because it is the only place
   * in Boss OS that can tell her the publishing block has lifted — and that is a thing she does,
   * not a thing she inspects. It is fourth rather than first: Launch and Watch are used every day
   * and this is used until seven books are Live and then never again.
   */
  { id: "publishing", label: "Publishing" },
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
      {section === "costs" && <Costs />}
      {section === "publishing" && <Publishing />}
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

/* ─── Costs & budgets ─────────────────────────────────────────────────────── */

const money = (micros: number) => `$${((micros ?? 0) / 1e6).toFixed(2)}`;

/**
 * ONE SCREEN THAT ANSWERS "WHAT CAN THIS THING SPEND".
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "i see nothing in systems about controlling costs and setting monthly budgets that all got
 *    sent to the backends tab? so claude cieling is $50? i want claude ceiling to be whatever my
 *    plan allows ... arent we on medium level of costs? what happened to the lever?"
 *
 * THE LEVER WAS NEVER MISSING, IT WAS INVISIBLE. She is on MODERATE at $25/month with cost_mode
 * NORMAL — exactly the "medium" she remembers. Both lived in Settings and neither appeared here,
 * so from her seat the control she was given had disappeared. It is a CONTROL on this screen, not
 * a readout.
 *
 * THE LEVER AND THE COST MODE STAY TWO THINGS, one sentence each saying what they govern.
 * `router/spend.ts` is explicit that "how good a model" and "how much money" are different
 * decisions; merging them into one list would be inventing the fourth budget concept this system
 * has spent three migrations avoiding.
 */
function Costs() {
  const costs = usePanel(() => api.costs());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const d: any = costs.data;

  const change = async (fn: () => Promise<any>, said: string) => {
    setBusy(true);
    setNote(null);
    try { await fn(); setNote(said); costs.reload(); }
    catch (e: any) { costs.setError(e); }
    finally { setBusy(false); }
  };

  if (costs.error) return <ErrorNotice error={costs.error} onDismiss={costs.reload} />;
  if (!d) return <Loading />;

  return (
    <>
      {note && <div className="notice" style={{ borderColor: "var(--gold)" }}>{note}</div>}

      {/* ── The lever, as a control ───────────────────────────────────────── */}
      <div className="panel">
        <p className="pillar">Spend lever — {d.lever.position}</p>
        <div className="row-sub">{d.lever.governs}</div>
        <div className="seg" role="group" aria-label="Spend lever">
          {(d.lever.positions ?? []).map((p: string) => (
            <button
              key={p}
              className="seg-btn"
              aria-selected={d.lever.position === p}
              disabled={busy}
              onClick={() => change(() => api.setSpendLever({ position: p }), `Lever moved to ${p}.`)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="row-sub">MODERATE&rsquo;s allowance is {money(d.lever.moderate_micros)} a month.</div>
      </div>

      {/* ── The cost mode, which is a different question ──────────────────── */}
      <div className="panel">
        <p className="pillar">Cost mode — {d.cost_mode.value}</p>
        <div className="row-sub">{d.cost_mode.governs}</div>
        <div className="seg" role="group" aria-label="Cost mode">
          {(d.cost_mode.modes ?? []).map((m: string) => (
            <button
              key={m}
              className="seg-btn"
              aria-selected={d.cost_mode.value === m}
              disabled={busy}
              onClick={() => change(() => api.setSetting("cost_mode", m), `Cost mode set to ${m}.`)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── The plan, and the reserve that is the real control ────────────── */}
      <div className="panel">
        <p className="pillar">Your plan — {text(d.plan.tierLabel)}</p>
        <div className="row-sub">{d.plan.governs}</div>
        {/*
          * RESERVE, NOT CAP. "i want claude ceiling to be whatever my plan allows" and, from 0195,
          * the real worry: "a week where she cannot use Claude Code for her own work because her
          * staff spent it." A reserve honours both — zero it and the ceiling is literally the whole
          * plan; the 25% default protects the week she was afraid of losing.
          */}
        <dl className="kv">
          <dt>Plan capacity</dt><dd>{money(d.plan.capacityMicros)} a month</dd>
          <dt>Kept for you</dt><dd>{d.plan.reservePct}% — {money(d.plan.reserveMicros)}</dd>
          <dt>Employees may draw</dt><dd>{money(d.plan.employeeCeilingMicros)}, which is {money(d.plan.dailyMicros)} a day</dd>
        </dl>
        {/* NOT A BILL. The figure beside this has been read as an invoice for a week. */}
        <div className="row-sub">{d.plan.basis_note}</div>
        <div className="seg" role="group" aria-label="Reserve">
          {[0, 10, 25, 50].map((pct) => (
            <button
              key={pct}
              className="seg-btn"
              aria-selected={d.plan.reservePct === pct}
              disabled={busy}
              onClick={() => change(() => api.setPlan({ reserve_pct: pct }), `Reserve set to ${pct}%.`)}
            >
              {pct === 0 ? "Keep nothing" : `${pct}%`}
            </button>
          ))}
        </div>
      </div>

      {/* ── A ceiling per thing, which is what she asked for ──────────────── */}
      <Panel title="Ceiling for each backend" hint="No backends are registered." state={costs}>
        {(d.backends ?? []).map((b: any) => (
          <Row
            key={b.id}
            title={`${text(b.display_name)}${b.ceiling_source === "plan" ? " — follows your plan" : ""}`}
            /* THE WORD, NOT THE NUMBER. Three $0.00 rows meant free, unauthorised and off. */
            sub={text(b.sentence)}
            val={b.spend_kind === "capped" && b.ceiling_micros > 0 ? `${money(b.spent_micros)} of ${money(b.ceiling_micros)}` : b.spend_kind.toUpperCase()}
          />
        ))}
      </Panel>

      <Panel title="The ops lane" hint="No lane budget is set." state={costs}>
        <Row title="This month" sub="The outer authority. Nothing may spend past it, whatever a backend's own ceiling says." val={`${money(d.lane.month_spent_micros)} of ${money(d.lane.month_limit_micros)}`} />
        {/*
          * THE DAY IS A PACE, NOT A SECOND AUTHORITY, and any drift from the derived figure is
          * shown rather than left latent — 0222 found a $2/day cap sitting under a $50/month
          * ceiling, two limits that could not both be honoured.
          */}
        <Row
          title="Today"
          sub={d.lane.day_agrees
            ? "Derived from the month, so the two can never disagree."
            : `Stored as ${money(d.lane.day_limit_micros)} but the month divides to ${money(d.lane.day_derived_micros)} — these disagree and the month wins.`}
          val={`${money(d.lane.day_spent_micros)} of ${money(d.lane.day_limit_micros)}`}
        />
      </Panel>
    </>
  );
}

/* ─── Governance ──────────────────────────────────────────────────────────── */

/**
 * GOVERNANCE, WITH A VERDICT AT THE TOP AND THE LIVE PLAYBOOK LEADING.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "the governence section on systems needs work. some thing about playbook broken or stale"
 *
 * `fpb_vault_stale` was ACTIVE, and it was RIGHT — the newest complete snapshot in production was
 * seven days old. The screen was reporting a real finding uselessly:
 *
 *   · It sat THIRD, in a list styled identically to the two panels that were fine, with the word
 *     ACTIVE in the value column and no indication that anything wanted her.
 *   · Its STEPS were loaded and never rendered. `failure_playbooks.steps` is JSON and the endpoint
 *     parses it; a playbook is exactly its steps, and without them it is a label saying something
 *     is wrong.
 *   · Three panels of raw rows and no sentence anywhere saying what was currently true.
 *   · Decision rights rendered `action_class` — she was reading `dr_capability_patch` — while
 *     every row already carries a `label` and a `rationale` that nothing used.
 *
 * A LIVE PLAYBOOK IS THE ONLY THING ON THIS SCREEN THAT ASKS FOR ANYTHING. It leads, in the state
 * colour, with its steps open. The rest is machinery you inspect.
 */
function Governance() {
  const flags = usePanel(() => api.complianceFlags());
  const rights = usePanel(() => api.decisionRights());
  const plays = usePanel(() => api.playbooks());

  const books = asList(plays.data?.playbooks ?? plays.data);
  const live = books.filter((p: any) => p.applies_now ?? p.active);
  const quiet = books.filter((p: any) => !(p.applies_now ?? p.active));
  const openFlags = asList(flags.data);

  return (
    <>
      {/*
        * THE ONE LINE AT THE TOP: what is true right now, and what it wants from her. Three panels
        * of rows with no verdict is a database view, and she has to read all of it to find out
        * whether anything is wrong.
        */}
      {!plays.error && plays.data !== null && plays.data !== undefined && (
        <div className={live.length ? "notice notice-live" : "row-sub"}>
          {live.length
            ? `${live.length} playbook${live.length === 1 ? "" : "s"} applies right now — ${live.map((p: any) => text(p.title ?? p.key)).join("; ")}. Its steps are below.`
            : `Nothing is currently wrong: no playbook's condition is true${openFlags.length ? `, and the sentinel's ${openFlags.length} open flag${openFlags.length === 1 ? "" : "s"} ${openFlags.length === 1 ? "is" : "are"} listed below` : " and the sentinel has raised nothing"}.`}
        </div>
      )}

      {live.map((p: any) => (
        <div className="panel" key={p.id ?? p.key}>
          <p className="pillar">{text(p.title ?? p.key)}</p>
          <div className="row-sub">Why it fired: {text(p.condition_text ?? p.condition, "no condition recorded")}</div>
          {/* THE STEPS, WHICH ARE THE PLAYBOOK. They were parsed by the endpoint and never shown. */}
          <ol className="brief-list">
            {(Array.isArray(p.steps) ? p.steps : []).map((step: any, i: number) => (
              <li key={i}>{typeof step === "string" ? step : text(step?.step ?? step?.text ?? JSON.stringify(step))}</li>
            ))}
          </ol>
          <div className="row-sub">Owner: {text(p.owner, "boss")}</div>
        </div>
      ))}

      <Panel title="Compliance sentinel" hint="The sentinel has raised nothing. Run it from Settings to check now." state={flags}>
        {openFlags.map((f: any) => (
          <Row key={f.id} title={text(f.title ?? f.watch_item)} sub={text(f.detail ?? f.reason, "")} val={text(f.severity ?? f.status)} />
        ))}
      </Panel>
      <Panel title="Decision rights" hint="No decision classes are declared." state={rights}>
        {/*
          * HER WORDS, NOT THE DATABASE'S. Each row carries a `label` and a `rationale`; the screen
          * was rendering `action_class`, so she read `dr_capability_patch` where the row itself
          * says what it is and why.
          */}
        {asList(rights.data).map((r: any) => (
          <Row
            key={r.id ?? r.action_class}
            title={text(r.label ?? r.action_class ?? r.id)}
            sub={text(r.rationale ?? r.rule ?? r.who, "")}
            val={text(r.decider ?? r.authority)}
          />
        ))}
      </Panel>
      <Panel title="Failure playbooks" hint="No playbook's condition is true right now, which is the good case." state={plays}>
        {quiet.map((p: any) => (
          <Row key={p.id ?? p.key} title={text(p.title ?? p.key)} sub={text(p.condition_text ?? p.condition, "")} />
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

/**
 * PUBLISHING — the seven books that cannot go out, and who is chasing it.
 *
 * ─── Why this screen exists at all ──────────────────────────────────────────
 *
 * The watcher has been running Mon/Wed/Fri since 2 September and it works. Its determinations went
 * to `~/Library/Logs/kdp-watch/latest.log`, a file she has never opened and has no reason to. So a
 * job was doing the work, an employee was going to own it, and there was no way for her to know
 * anything about either. That is this codebase's defect in its purest form: a correct thing nothing
 * reaches.
 *
 * ─── The one line that matters ──────────────────────────────────────────────
 *
 * The action banner, and it NAMES WHO ACTS. The owner asked whether the system could relaunch the
 * browser tool and try again when the block clears. The honest answer is: sometimes. The watcher
 * can drive Chrome and walk one title to Publish — but it runs at 09:23 and her laptop may be shut,
 * in which case it emails her and stops. So the banner says "publish one title now" to HER, or says
 * Simone handled it, rather than leaving her to work out which happened. A system that quietly did
 * not try is worse than one that says it needs her.
 *
 * ─── What is not here ───────────────────────────────────────────────────────
 *
 * The mail. Subjects and bodies are read on her Mac and stay there; what crosses is a determination
 * in the run's own words, and the endpoint refuses one containing an `@`. There is no button here
 * that sends anything to Amazon either — the chase ladder lives in the prompt, where a rule about
 * how often to nudge a support queue belongs.
 */
function Publishing() {
  const state = usePanel(() => api.kdp());
  const d: any = state.data ?? {};
  const titles = asList(d.titles);
  const blocked = titles.filter((t: any) => t.state === "blocked");
  const live = titles.filter((t: any) => t.state === "live");

  return (
    <>
      <Panel
        title="Kindle publication"
        hint="No publication state has been recorded. Migration 0201 seeds the ten known titles; if this is empty the migration has not been applied."
        state={state}
      >
        {/*
          * THE ACTION FIRST, ALWAYS, and phrased as a sentence rather than a status word. "cleared"
          * as a badge would be read as good news and closed; "publish one title now" is the thing
          * that actually has to happen.
          */}
        {d.action && (
          <div
            className="notice"
            style={{ borderColor: d.action.who === "her" ? "var(--gold)" : undefined }}
          >
            <strong>{d.action.headline}</strong>
            <div className="row-sub">{d.action.detail}</div>
            <div className="row-sub">
              {d.action.who === "her"
                ? "This one is yours — nothing automated will do it for you."
                : d.action.who === "simone"
                  ? "Simone has it. Nothing is needed from you."
                  : "Nothing is outstanding."}
            </div>
          </div>
        )}

        <Row
          title={`${blocked.length} blocked · ${live.length} live`}
          sub={`Amazon case #${text(d.case_number)} — the only route to the account-level flag.`}
          val={d.duty?.overdue ? "watcher overdue" : text(d.latest?.sentinel, "no check yet")}
        />

        {/*
          * A WATCHER THAT HAS STOPPED LOOKS EXACTLY LIKE GOOD NEWS. No determination arriving reads
          * identically to nothing happening, which is the failure the whole instrument exists to
          * prevent — so the age of the last check is stated rather than left to be inferred.
          */}
        <Row
          title="Last determination"
          sub={
            d.days_since_last_check === null || d.days_since_last_check === undefined
              ? "Simone's watcher has not reported yet."
              : `${d.days_since_last_check} day${d.days_since_last_check === 1 ? "" : "s"} ago · ${text(d.latest?.source)}`
          }
          val={text(d.latest?.sentinel, "—")}
        />
        {d.latest?.determination && <div className="row-sub">{d.latest.determination}</div>}

        <Row
          title="Owned by Simone, executed on your Mac"
          sub={text(
            d.duty?.runs_where,
            "Reading support mail needs your mailbox, and an agent's environment has no credentials in it. This runs from launchd.",
          )}
          val={d.duty?.suspended ? "suspended" : "active"}
        />

        <div className="row-sub">{text(d.known, "")}</div>
      </Panel>

      {/*
        * SHE CAN MOVE A TITLE AND THE WATCHER ALMOST CANNOT.
        *
        * The job may only ever set `live`, and only for the one title it actually published. Every
        * other move — a book she publishes herself, one she decides to withdraw — is hers, because
        * a list she cannot correct is a list she stops trusting, and this one has to stay true for
        * however long Amazon takes.
        */}
      <Panel
        title="The titles"
        hint="No titles are recorded."
        state={state}
      >
        {titles.map((t: any) => (
          <div className="row" key={t.title_ref}>
            <div className="row-main">
              <div className="row-title">{text(t.label, t.title_ref)}</div>
              <div className="row-sub">{text(t.note, "")}</div>
            </div>
            <div className="row-val">
              <select
                aria-label={`Publication state for ${t.title_ref}`}
                value={t.state}
                onChange={async (e) => {
                  try {
                    await api.setKdpTitleState(t.title_ref, { state: e.target.value });
                    state.reload();
                  } catch (err) {
                    state.setError(err);
                  }
                }}
              >
                {["blocked", "in_review", "live", "withdrawn"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title="The case, check by check"
        hint="No checks have been recorded. Each Mon/Wed/Fri run posts one."
        state={state}
      >
        {asList(d.history).map((h: any) => (
          <Row
            key={h.id}
            title={`${text(h.sentinel)}${h.needs_owner ? " — needs you" : ""}`}
            sub={[
              text(h.determination, ""),
              h.days_since_support === null || h.days_since_support === undefined
                ? ""
                : `${h.days_since_support}d since support wrote`,
              h.nudges_unanswered ? `${h.nudges_unanswered} unanswered nudge${h.nudges_unanswered === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            val={new Date(h.checked_at).toLocaleDateString()}
          />
        ))}
      </Panel>
    </>
  );
}
