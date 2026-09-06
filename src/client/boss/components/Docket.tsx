import { useState } from "react";

const KIND_LABEL: Record<string, string> = {
  task_output: "output",
  spend: "budget",
  memory_promotion: "memory",
  trade: "trade",
  model_route: "routing",
  agent_creation: "new employee",
  manual: "decision",
};

export function Docket({
  approval, onDecide, onOpen,
}: {
  approval: any;
  onDecide: (id: string, decision: string) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: string) {
    setBusy(decision);
    try {
      await onDecide(approval.id, decision);
    } finally {
      setBusy(null);
    }
  }

  const filedAt = new Date(approval.requested_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <article
      className="docket"
      style={{ ["--lane" as string]: approval.lane === "trading" ? "var(--lane-trading)" : "var(--lane-ops)" }}
    >
      <div className="docket-head">
        <span className="docket-no">
          {KIND_LABEL[approval.kind] ?? approval.kind} · {filedAt}
        </span>
        <span className={`risk risk-${approval.risk}`}>{approval.risk}</span>
      </div>

      <button className="docket-open" onClick={() => onOpen(approval.id)}>
        <h3>{approval.title}</h3>
        {approval.summary && <p>{approval.summary}</p>}
        <span className="docket-more">Open the full docket →</span>
      </button>

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
    </article>
  );
}
