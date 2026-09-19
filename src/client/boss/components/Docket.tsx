import { useState } from "react";

const KIND_LABEL: Record<string, string> = {
  task_output: "output",
  spend: "budget",
  memory_promotion: "memory",
  trade: "trade",
  model_route: "routing",
  agent_creation: "new employee",
  manual: "decision",
  notice: "she told you",
};

export function Docket({
  approval, onDecide, onOpen, selected, onSelect,
}: {
  approval: any;
  onDecide: (id: string, decision: string) => Promise<void>;
  onOpen: (id: string) => void;
  /** Bulk selection (Inbox overhaul, 19 Sep 2026). Undefined when the list is not selectable. */
  selected?: boolean;
  onSelect?: (id: string, shiftKey: boolean) => void;
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
      className={`docket${selected ? " docket-selected" : ""}`}
      style={{ ["--lane" as string]: approval.lane === "trading" ? "var(--lane-trading)" : "var(--lane-ops)" }}
      data-approval-id={approval.id}
    >
      <div className="docket-head">
        <span className="docket-no">
          {onSelect && approval.kind !== "notice" && (
            <input
              type="checkbox"
              className="docket-select"
              aria-label={`Select ${approval.title}`}
              checked={Boolean(selected)}
              onClick={(e) => onSelect(approval.id, e.shiftKey)}
              onChange={() => { /* handled in onClick so the shift key is visible */ }}
            />
          )}
          {KIND_LABEL[approval.kind] ?? approval.kind} · {filedAt}
        </span>
        <span className={`risk risk-${approval.risk}`}>{approval.risk}</span>
      </div>

      <button className="docket-open" onClick={() => onOpen(approval.id)}>
        <h3>{approval.title}</h3>
        {approval.summary && <p>{approval.summary}</p>}
        <span className="docket-more">Open the full docket →</span>
      </button>

      {/*
        * ─── A NOTICE IS NOT AN APPROVAL ───────────────────────────────────────
        *
        * Confirmed on production, 9 September 2026: `kind = 'notice'` had eight rows and every one
        * was `approved`. An employee said "I emailed you the LP outcomes" and this component put
        * Approve / Reject / Later underneath it. There was nothing to approve, so she pressed
        * Approve eight times to make a sentence go away — and the system recorded eight approvals
        * she never gave.
        *
        * THE COST IS TO THE REAL APPROVALS BESIDE IT. A screen that asks for a verdict on things
        * that have no verdict teaches the reader that the green button is a dismiss button, and the
        * next card is a letter going to a firm or a cover going to Amazon.
        *
        * One button, and it says what it does. `approved` is still the decision written to the
        * table, because that is the only terminal state this row can reach — but she is never asked
        * to approve, and "Reject" and "Later" are meaningless here and are gone.
        */}
      {approval.kind === "notice" ? (
        <div className="decide">
          <button className="btn" disabled={busy !== null} onClick={() => decide("approved")}>
            {busy === "approved" ? "Clearing…" : "Got it"}
          </button>
        </div>
      ) : (
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
      )}
    </article>
  );
}
