import { useEffect, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

/**
 * The full docket: what is being asked, what it will act on, the evidence behind
 * it, the whole event trail, and a note field on the decision itself.
 */
export function ApprovalDetail({ id, onBack, onDecided }: {
  id: string;
  onBack: () => void;
  onDecided: () => void;
}) {
  const [data, setData] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    api.approval(id).then(setData).catch(setError);
  }, [id]);

  async function decide(decision: string) {
    setBusy(decision);
    setError(null);
    try {
      const result = await api.decide(id, decision, note.trim() || undefined);
      const exec = result.execution;
      if (exec?.status === "failed") {
        setOutcome(`Recorded as ${decision}, but the action failed: ${exec.detail?.error ?? "unknown reason"}`);
      } else if (exec?.status === "executed") {
        setOutcome(`Recorded as ${decision} and carried out.`);
      } else {
        setOutcome(`Recorded as ${decision}.`);
      }
      setData(await api.approval(id));
      onDecided();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <><ErrorNotice error={error} /><button className="btn" onClick={onBack}>Back</button></>;
  if (!data) return <Loading />;

  const a = data.approval;
  const decided = a.status !== "pending" && a.status !== "deferred";
  const payload = safeParse(a.payload);

  return (
    <>
      <button className="link-back" onClick={onBack}>← Inbox</button>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {outcome && <div className="notice" style={{ borderColor: "var(--gold)" }}>{outcome}</div>}

      <article className="docket docket-full"
        style={{ ["--lane" as string]: a.lane === "trading" ? "var(--lane-trading)" : "var(--lane-ops)" }}>
        <div className="docket-head">
          <span className="docket-no">{a.kind} · {a.lane}</span>
          <span className={`risk risk-${a.risk}`}>{a.risk}</span>
        </div>
        <h3>{a.title}</h3>
        {a.summary && <p>{a.summary}</p>}

        <dl className="kv">
          <dt>Status</dt><dd>{a.status}{a.execution_status ? ` · ${a.execution_status}` : ""}</dd>
          <dt>Raised</dt><dd>{new Date(a.requested_at).toLocaleString()}</dd>
          {a.expires_at && <><dt>Expires</dt><dd>{new Date(a.expires_at).toLocaleString()}</dd></>}
          {a.decided_at && <><dt>Decided</dt><dd>{new Date(a.decided_at).toLocaleString()}</dd></>}
          {a.decision_note && <><dt>Note</dt><dd>{a.decision_note}</dd></>}
        </dl>
      </article>

      <Origin origin={data.origin} payload={payload} />

      <p className="eyebrow">History</p>
      {(data.events ?? []).map((e: any) => (
        <div className="row" key={e.id}>
          <div className="row-main">
            <div className="row-title">{e.event.replace(/_/g, " ")}</div>
            {e.detail && <div className="row-sub mono">{truncate(e.detail, 160)}</div>}
          </div>
          <div className="row-val">{new Date(e.ts).toLocaleTimeString()}</div>
        </div>
      ))}

      {!decided && (
        <div className="decide-panel">
          <label className="field">
            <span>Decision note</span>
            <textarea
              rows={3}
              value={note}
              placeholder="Why, in your own words. Kept on the record."
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="decide">
            <button className="btn btn-approve" disabled={busy !== null} onClick={() => decide("approved")}>
              {busy === "approved" ? "Approving…" : "Approve"}
            </button>
            <button className="btn btn-reject" disabled={busy !== null} onClick={() => decide("rejected")}>
              {busy === "rejected" ? "Rejecting…" : "Reject"}
            </button>
            <button className="btn btn-defer" disabled={busy !== null} onClick={() => decide("deferred")}>
              Later
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Origin({ origin, payload }: { origin: any; payload: any }) {
  if (!origin) {
    return payload ? (
      <>
        <p className="eyebrow">Payload</p>
        <pre className="pre">{JSON.stringify(payload, null, 2)}</pre>
      </>
    ) : null;
  }

  if (origin.type === "task") {
    const output = safeParse(origin.task?.output);
    const ev = origin.evidence;
    return (
      <>
        <p className="eyebrow">What was produced</p>
        {output?.text
          ? <pre className="pre">{output.text}</pre>
          : <div className="row"><div className="row-sub">No output was produced yet.</div></div>}

        {ev && (
          <>
            <p className="eyebrow">Evidence packet</p>
            <dl className="kv">
              <dt>Worker</dt><dd>{ev.worker_used}{ev.model_id ? ` · ${ev.model_id}` : ""}</dd>
              <dt>Cost mode</dt><dd>{ev.cost_mode ?? "—"}</dd>
              <dt>Cost</dt><dd>{usd(ev.actual_cost_micros ?? 0)}</dd>
              <dt>Actions</dt><dd>{listOf(ev.actions_taken)}</dd>
              <dt>Checks</dt><dd>{listOf(ev.checks_run)}</dd>
              <dt>Risks</dt><dd>{listOf(ev.risks_remaining) || "None recorded"}</dd>
              <dt>Unknowns</dt><dd>{listOf(ev.unknowns) || "None recorded"}</dd>
              <dt>Rollback</dt><dd>{ev.rollback_available ? "available" : "not available"}</dd>
              <dt>Next</dt><dd>{ev.next_human_action ?? "—"}</dd>
            </dl>
          </>
        )}
      </>
    );
  }

  if (origin.type === "memory") {
    return (
      <>
        <p className="eyebrow">Memory being promoted</p>
        <div className="row">
          <div className="row-main">
            <div className="row-title">{origin.item?.title}</div>
            <div className="row-sub">{origin.item?.tier} → {origin.to_tier} · {origin.item?.hits} hits</div>
          </div>
        </div>
        <pre className="pre">{origin.item?.body}</pre>
      </>
    );
  }

  if (origin.type === "order") {
    const o = origin.order;
    return (
      <>
        <p className="eyebrow">Order</p>
        <dl className="kv">
          <dt>Instrument</dt><dd>{o?.symbol}</dd>
          <dt>Side</dt><dd>{o?.side} {o?.qty}</dd>
          <dt>Type</dt><dd>{o?.order_type}{o?.limit_price ? ` @ ${o.limit_price}` : ""}</dd>
          <dt>Reference</dt><dd>{o?.ref_price ?? "—"}</dd>
          <dt>Notional</dt><dd>{usd(o?.notional_micros ?? 0)}</dd>
          <dt>Mode</dt><dd>{o?.mode}{o?.mode === "paper" ? " — no money moves" : ""}</dd>
        </dl>
      </>
    );
  }

  if (origin.type === "agent_proposal") {
    const p = origin.proposal;
    return (
      <>
        <p className="eyebrow">Proposed employee</p>
        <dl className="kv">
          <dt>Name</dt><dd>{p?.name}</dd>
          <dt>Role</dt><dd>{p?.role}</dd>
          <dt>Purpose</dt><dd>{p?.purpose}</dd>
          <dt>Duties</dt><dd>{listOf(p?.duties)}</dd>
          <dt>Memory</dt><dd>{p?.memory_boundary}</dd>
          <dt>Approvals</dt><dd>{p?.approval_rules}</dd>
          <dt>Daily cap</dt><dd>{usd(p?.cost_limit_micros ?? 0)}</dd>
          <dt>Success</dt><dd>{p?.success_criteria}</dd>
          <dt>Retirement</dt><dd>{p?.retirement_criteria}</dd>
        </dl>
      </>
    );
  }

  return null;
}

function safeParse(raw: unknown) {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function listOf(raw: unknown): string {
  const v = typeof raw === "string" ? safeParse(raw) : raw;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
  return v ? String(v) : "";
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
