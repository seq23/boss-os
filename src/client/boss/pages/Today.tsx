import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice, InfoNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

/**
 * Today — canon §15.
 *
 * Thirteen elements, in canon's order, and nothing else. Canon is explicit that
 * this must read like a Chief of Staff briefing rather than a dashboard, and
 * §5's Cognitive Load Budget says brief by default, expandable on demand — so
 * every block is one line until you open it, the two "when relevant" elements
 * stay closed when they are not, and the gates cap at three.
 */

type Block = {
  key: string;
  title: string;
  order: number;
  content: any;
  source_type: string;
  source_id: string | null;
  is_empty: boolean;
};

type Payload = {
  day: any;
  blocks: Block[];
  gates: { gate: string; completed_at: number }[];
  limits: { morning_priorities: number; midday_checks: number; night_review_prompts: number };
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function Today() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [gate, setGate] = useState<"morning" | "midday" | "night" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.today());
      setError(null);
    } catch (e) {
      setError(e);
      setData((prev) => prev);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <ErrorNotice error={error} /> : <Loading />;

  const { day, blocks, limits } = data;
  const done = {
    morning: Boolean(day?.morning_completed_at),
    midday: Boolean(day?.midday_completed_at),
    night: Boolean(day?.night_completed_at),
  };

  async function run(which: "morning" | "midday" | "night", body: unknown) {
    setError(null);
    try {
      if (which === "morning") await api.morningGate(body);
      else if (which === "midday") await api.middayGate(body);
      else await api.nightGate(body);
      setGate(null);
      setFlash(`${which[0]!.toUpperCase()}${which.slice(1)} gate recorded.`);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {flash && (
        <div className="notice" style={{ borderColor: "var(--ok)" }}>
          {flash}
          <button className="notice-x" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <p className="eyebrow">
        {new Date(day.date_ts).toLocaleDateString(undefined, {
          weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
        })}
      </p>

      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {(["morning", "midday", "night"] as const).map((g) => (
          <button
            key={g}
            className="stat"
            style={{ textAlign: "left", cursor: done[g] ? "default" : "pointer", font: "inherit", color: "inherit" }}
            onClick={() => !done[g] && setGate(gate === g ? null : g)}
            aria-pressed={gate === g}
            disabled={done[g]}
          >
            <div className="stat-n" style={{ fontSize: 15, color: done[g] ? "var(--ok)" : "var(--gold)" }}>
              {done[g] ? time(day[`${g}_completed_at`]) : "Open"}
            </div>
            <div className="stat-l">{g === "midday" ? "Midday reset" : `${g} gate`}</div>
          </button>
        ))}
      </div>

      {gate === "morning" && <MorningForm max={limits.morning_priorities} onRun={(b) => run("morning", b)} />}
      {gate === "midday" && <MiddayForm max={limits.midday_checks} onRun={(b) => run("midday", b)} />}
      {gate === "night" && (
        <NightForm max={limits.night_review_prompts} maxSeed={limits.morning_priorities} onRun={(b) => run("night", b)} />
      )}

      {blocks.map((b) => (
        <BlockCard key={b.key} block={b} onChanged={load} onError={setError} />
      ))}
    </>
  );
}

/**
 * The two "when relevant" elements disappear when they are not relevant, which
 * is what canon means by them. Everything else is always present, because an
 * element that vanishes when empty makes it impossible to tell "nothing today"
 * from "the screen forgot".
 */
function BlockCard({ block, onChanged, onError }: {
  block: Block;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const conditional = block.key === "continuity_status" || block.key === "trading_status";
  if (conditional && block.content?.relevant === false) return null;

  const summary = summarise(block);
  const detail = renderDetail(block, onChanged, onError);

  return (
    <div className="docket" style={{ paddingBottom: detail ? 14 : 12 }}>
      <div className="docket-head">
        <span className="docket-no">{String(block.order).padStart(2, "0")}</span>
        <h3 style={{ margin: 0 }}>{block.title}</h3>
      </div>
      <p style={{ marginTop: 6 }}>{summary}</p>
      {detail && (
        <details>
          <summary className="docket-more" style={{ cursor: "pointer" }}>Open</summary>
          <div className="docket-full">{detail}</div>
        </details>
      )}
    </div>
  );
}

function summarise(block: Block): string {
  const c = block.content ?? {};
  if (c.available === false) return c.reason;

  switch (block.key) {
    case "todays_contract":
      return c.contract
        ? `${c.contract.priorities.length} priorit${c.contract.priorities.length === 1 ? "y" : "ies"} agreed${c.contract.commitment ? ` — ${c.contract.commitment}` : ""}.`
        : c.reason;
    case "executive_briefing":
      return c.lines?.[0] ?? "Nothing to report.";
    case "day_flow": {
      const done = (c.stages ?? []).filter((s: any) => s.done).length;
      return `${done} of ${(c.stages ?? []).length} stages complete.`;
    }
    case "meetings": {
      const parts: string[] = [];
      parts.push(
        c.total === 0
          ? "Nothing in the diary."
          : `${c.total} meeting${c.total === 1 ? "" : "s"}${c.unbriefed ? `, ${c.unbriefed} unbriefed` : ", all briefed"}.`,
      );
      if (c.held_not_captured?.length) {
        parts.push(`${c.held_not_captured.length} held and not captured.`);
      }
      if (c.follow_ups_overdue) {
        parts.push(`${c.follow_ups_overdue} follow-up${c.follow_ups_overdue === 1 ? "" : "s"} overdue.`);
      }
      return parts.join(" ");
    }
    case "open_loops":
      return c.total === 0
        ? "Nothing is hanging."
        : `${c.total} open${c.carried_forward ? `, ${c.carried_forward} carried from earlier days` : ""}.`;
    case "critical_alerts":
      return c.alerts?.length ? `${c.alerts.length} thing${c.alerts.length === 1 ? "" : "s"} wrong.` : "Nothing is wrong.";
    case "approval_inbox":
      return c.pending === 0
        ? "Nothing is waiting on you."
        : `${c.pending} waiting${c.by_risk?.high ? `, ${c.by_risk.high} high risk` : ""}${c.expiring_within_a_day ? `, ${c.expiring_within_a_day} expiring within a day` : ""}.`;
    case "employee_status":
      return `${c.by_status?.active ?? 0} active, ${c.by_status?.paused ?? 0} paused, ${c.by_status?.retired ?? 0} retired.`;
    case "continuity_status":
      return c.note;
    case "trading_status":
      return c.kill_switch
        ? "Kill switch engaged. Nothing in that lane executes."
        : `${c.open_positions} open position${c.open_positions === 1 ? "" : "s"}${c.open_incidents?.length ? `, ${c.open_incidents.length} open incident${c.open_incidents.length === 1 ? "" : "s"}` : ""}.`;
    default:
      return "";
  }
}

function renderDetail(
  block: Block,
  onChanged: () => void | Promise<void>,
  onError: (e: unknown) => void,
) {
  const c = block.content ?? {};
  if (c.available === false) return null;

  switch (block.key) {
    case "todays_contract":
      return c.contract ? (
        <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {c.contract.priorities.map((p: string, i: number) => <li key={i}>{p}</li>)}
        </ol>
      ) : null;

    case "executive_briefing":
      return (
        <>
          {(c.lines ?? []).slice(1).map((l: string, i: number) => (
            <div className="row-sub" key={i}>{l}</div>
          ))}
          <div className="row-sub">Model spend today: {usd(c.spend_micros_today ?? 0)}</div>
        </>
      );

    case "day_flow":
      return (
        <>
          {(c.stages ?? []).map((s: any) => (
            <div className="row" key={s.stage}>
              <div className="row-main">
                <div className="row-title">{s.stage}</div>
                {s.absent && <div className="row-sub">{s.reason}</div>}
              </div>
              <div className="row-val">{s.done ? time(s.at) : s.absent ? "absent" : "—"}</div>
            </div>
          ))}
          {(c.midday_checks ?? []).map((chk: any, i: number) => (
            <div className="row-sub" key={i}>{chk.done ? "✓" : "○"} {chk.text}</div>
          ))}
        </>
      );

    case "meetings":
      return (c.meetings ?? []).length || (c.held_not_captured ?? []).length || (c.touches_due ?? []).length ? (
        <>
          {(c.meetings ?? []).map((m: any) => (
            <div className="row" key={m.id}>
              <div className="row-main">
                <div className="row-title">{m.title}</div>
                <div className="row-sub">
                  {m.full_name}{m.organization_name ? ` · ${m.organization_name}` : ""} · {time(m.scheduled_at)}
                </div>
                <div className="row-sub">
                  {m.briefed ? "briefed" : "no brief yet"}{m.captured ? " · captured" : ""}
                  {m.relationship_health !== null && m.relationship_health !== undefined
                    ? ` · health ${m.relationship_health}`
                    : ""}
                </div>
              </div>
              <div className="row-val">{m.captured ? "done" : m.briefed ? "ready" : "cold"}</div>
            </div>
          ))}
          {(c.held_not_captured ?? []).map((m: any) => (
            <div className="row" key={m.id}>
              <div className="row-main">
                <div className="row-title">{m.title}</div>
                <div className="row-sub">{m.full_name} · held {new Date(m.scheduled_at).toLocaleDateString()} and never captured</div>
              </div>
              <div className="risk risk-medium">capture</div>
            </div>
          ))}
          {(c.touches_due ?? []).map((t: any) => (
            <div className="row-sub" key={t.id}>
              {t.full_name} is past their {t.cadence_days}-day cadence.
            </div>
          ))}
        </>
      ) : null;

    case "open_loops":
      return <Loops loops={c.loops ?? []} onChanged={onChanged} onError={onError} />;

    case "critical_alerts":
      return (c.alerts ?? []).length ? (
        <>
          {c.alerts.map((a: any, i: number) => (
            <div className="row" key={i}>
              <div className="row-main"><div className="row-title">{a.text}</div></div>
              <div className={`risk risk-${a.severity === "critical" || a.severity === "high" ? "high" : "medium"}`}>
                {a.severity}
              </div>
            </div>
          ))}
        </>
      ) : null;

    case "approval_inbox":
      return c.oldest ? (
        <div className="row">
          <div className="row-main">
            <div className="row-title">{c.oldest.title}</div>
            <div className="row-sub">Oldest, waiting since {time(c.oldest.requested_at)}</div>
          </div>
          <div className={`risk risk-${c.oldest.risk}`}>{c.oldest.risk}</div>
        </div>
      ) : null;

    case "employee_status":
      return (c.busiest ?? []).length ? (
        <>
          {c.busiest.map((e: any) => (
            <div className="row" key={e.id}>
              <div className="row-main">
                <div className="row-title">{e.name}</div>
                <div className="row-sub">{e.role} · {e.lane}</div>
              </div>
              <div className="row-val">{e.open_tasks} open</div>
            </div>
          ))}
        </>
      ) : null;

    case "continuity_status":
      return c.last_snapshot ? (
        <dl className="kv">
          <dt>Last snapshot</dt><dd>{new Date(c.last_snapshot.ts).toLocaleString()}</dd>
          <dt>Status</dt><dd>{c.last_snapshot.status}</dd>
          <dt>Promotions waiting</dt><dd>{c.proposed_promotions_awaiting_decision}</dd>
        </dl>
      ) : null;

    case "trading_status":
      return (
        <>
          <dl className="kv">
            <dt>Kill switch</dt><dd>{c.kill_switch ? "engaged" : "clear"}</dd>
            <dt>Live execution</dt><dd>{c.live_enabled ? "enabled" : "denied"}</dd>
            <dt>Open positions</dt><dd>{c.open_positions}</dd>
          </dl>
          {(c.open_incidents ?? []).map((i: any) => (
            <div className="row-sub" key={i.id}>{i.severity}: {i.summary}</div>
          ))}
        </>
      );

    default:
      return null;
  }
}

function Loops({ loops, onChanged, onError }: {
  loops: any[];
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(id: string, action: "resolve" | "dismiss" | "defer") {
    setBusy(true);
    try { await api.closeLoop(id, action); await onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try { await api.openLoop({ title: title.trim(), kind: "other" }); setTitle(""); await onChanged(); }
    catch (err) { onError(err); }
    finally { setBusy(false); }
  }

  return (
    <>
      {loops.length === 0
        ? <Empty title="Nothing is hanging" hint="Loops raised by meetings, approvals and the Night Gate land here." />
        : loops.map((l) => (
            <div className="row" key={l.id}>
              <div className="row-main">
                <div className="row-title">{l.title}</div>
                <div className="row-sub">
                  {l.kind.replace(/_/g, " ")}
                  {l.carried_from && ` · carried from ${l.carried_from}`}
                </div>
              </div>
              <div className="decide" style={{ marginTop: 0 }}>
                <button className="btn btn-approve" disabled={busy} onClick={() => act(l.id, "resolve")}>Done</button>
                <button className="btn btn-defer" disabled={busy} onClick={() => act(l.id, "defer")}>Tomorrow</button>
                <button className="btn btn-reject" disabled={busy} onClick={() => act(l.id, "dismiss")}>Drop</button>
              </div>
            </div>
          ))}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="field-inline"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Something that must not be forgotten"
          aria-label="New open loop"
        />
        <button className="btn" disabled={busy || !title.trim()}>Add</button>
      </form>
    </>
  );
}

// ─── Gate flows ───────────────────────────────────────────────────────────────

function Lines({ value, onChange, max, label }: {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  label: string;
}) {
  return (
    <>
      {value.map((v, i) => (
        <input
          key={i}
          value={v}
          onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={`${label} ${i + 1}`}
          aria-label={`${label} ${i + 1}`}
          style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
        />
      ))}
      {value.length < max && (
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => onChange([...value, ""])}>
          Add {label.toLowerCase()}
        </button>
      )}
    </>
  );
}

function MorningForm({ max, onRun }: { max: number; onRun: (b: unknown) => void }) {
  const [priorities, setPriorities] = useState<string[]>([""]);
  const [identity, setIdentity] = useState("");
  const [state, setState] = useState("");
  const [bodyFloor, setBodyFloor] = useState("");
  const [revenue, setRevenue] = useState("");
  const [commitment, setCommitment] = useState("");
  const filled = priorities.filter((p) => p.trim());

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          priorities: filled,
          identity_cue: identity || undefined,
          state: state || undefined,
          body_floor: bodyFloor || undefined,
          revenue_reality: revenue || undefined,
          commitment: commitment || undefined,
        });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Morning Gate</h3>
      <InfoNotice>Three priorities at most. Choosing them is the work.</InfoNotice>
      <Lines value={priorities} onChange={setPriorities} max={max} label="Priority" />
      {[
        ["Identity cue", identity, setIdentity],
        ["State", state, setState],
        ["Body floor", bodyFloor, setBodyFloor],
        ["Revenue reality", revenue, setRevenue],
        ["Today's commitment", commitment, setCommitment],
      ].map(([label, value, set]: any) => (
        <input
          key={label}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={label}
          aria-label={label}
          style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
        />
      ))}
      <div className="decide">
        <button className="btn btn-approve" disabled={filled.length === 0}>Agree the day</button>
      </div>
    </form>
  );
}

function MiddayForm({ max, onRun }: { max: number; onRun: (b: unknown) => void }) {
  const [checks, setChecks] = useState<string[]>([""]);
  const [adjustments, setAdjustments] = useState("");
  const filled = checks.filter((c) => c.trim());

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ checks: filled.map((text) => ({ text, done: false })), adjustments: adjustments || undefined });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Midday Reset</h3>
      <InfoNotice>Three checks at most, and the approval sweep runs with them.</InfoNotice>
      <Lines value={checks} onChange={setChecks} max={max} label="Check" />
      <input
        value={adjustments}
        onChange={(e) => setAdjustments(e.target.value)}
        placeholder="What changed"
        aria-label="What changed"
        style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
      />
      <div className="decide">
        <button className="btn btn-approve" disabled={filled.length === 0}>Reset</button>
      </div>
    </form>
  );
}

function NightForm({ max, maxSeed, onRun }: { max: number; maxSeed: number; onRun: (b: unknown) => void }) {
  const [attention, setAttention] = useState([{ focus_area: "", pct: "" }]);
  const [review, setReview] = useState<string[]>([""]);
  const [seed, setSeed] = useState<string[]>([""]);
  const [note, setNote] = useState("");

  const allocated = attention.reduce((sum, a) => sum + (Number(a.pct) || 0), 0);
  const usable = attention.filter((a) => a.focus_area.trim() && Number(a.pct) > 0);

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          attention: usable.map((a) => ({ focus_area: a.focus_area.trim(), pct: Number(a.pct) })),
          review: review.filter((r) => r.trim()),
          evidence: note ? { note } : undefined,
          tomorrow_seed: { priorities: seed.filter((s) => s.trim()) },
        });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Night Gate</h3>
      <InfoNotice tone={allocated > 100 ? "reject" : "brass"}>
        Attention allocation: {allocated}% of the day accounted for.
      </InfoNotice>

      {attention.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={a.focus_area}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, focus_area: e.target.value } : x)))}
            placeholder="Where the attention went"
            aria-label={`Focus area ${i + 1}`}
            style={{ flex: 1, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px" }}
          />
          <input
            value={a.pct}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
            placeholder="%"
            inputMode="numeric"
            aria-label={`Percentage ${i + 1}`}
            style={{ width: 64, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px" }}
          />
        </div>
      ))}
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setAttention([...attention, { focus_area: "", pct: "" }])}>
        Add focus area
      </button>

      <p className="eyebrow" style={{ marginTop: 14 }}>Review</p>
      <Lines value={review} onChange={setReview} max={max} label="Prompt" />

      <p className="eyebrow" style={{ marginTop: 14 }}>Seed tomorrow</p>
      <Lines value={seed} onChange={setSeed} max={maxSeed} label="Priority" />

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Evidence from the day"
        aria-label="Evidence from the day"
        style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
      />

      <div className="decide">
        <button className="btn btn-approve" disabled={usable.length === 0 || allocated > 100}>Close the day</button>
      </div>
    </form>
  );
}
