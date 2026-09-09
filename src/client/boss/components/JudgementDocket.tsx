import { useState } from "react";

/**
 * A DOCKET WITH THE WORK IN IT.
 *
 * "simone should deliver them in my inbox in the Boss OS system!!!!? right?" — and then, on how she
 * answers it: "i should have an easy way to say approved or try again and if i say apprpved she
 * should continue to finish".
 *
 * ─── Why this is not the ordinary Docket ───────────────────────────────────
 *
 * The ordinary docket shows a title, a summary and a link to open the full record. That is right
 * for a trade or a memory promotion, where the substance is text and one more click is nothing. It
 * is wrong for taste. Judging seven book covers from a sentence describing them is not judging
 * them, and sending her to a file path or an external page is the hands-off failure she objected to.
 *
 * ─── The three rules this component holds to ───────────────────────────────
 *
 * 1. THE WORK IS VISIBLE HERE. Images render in the card at a size you can actually judge.
 * 2. A MISSING ASSET SAYS SO. An empty frame asks her to approve something she cannot see, so the
 *    slot prints its own named reason instead. The server decides `available`; this only renders it.
 * 3. TRY AGAIN CARRIES A REASON. The box opens before the verdict is sent, because "try again" with
 *    nothing attached makes the next attempt a coin flip.
 */
export function JudgementDocket({
  approval, judgement, onDecide,
}: {
  approval: any;
  judgement: any;
  onDecide: (id: string, decision: string, note?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  async function decide(decision: string, withNote?: string) {
    setBusy(decision);
    try {
      await onDecide(approval.id, decision, withNote);
    } finally {
      setBusy(null);
      setAsking(false);
    }
  }

  const filedAt = new Date(approval.requested_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const assets: any[] = judgement?.assets ?? [];
  const missing = assets.filter((a) => !a.available).length;

  return (
    <article className="docket" style={{ ["--lane" as string]: "var(--lane-ops)" }}>
      <div className="docket-head">
        <span className="docket-no">
          your judgement · {judgement?.employee_name ?? judgement?.employee_id ?? "an employee"} · {filedAt}
          {judgement?.attempt > 1 ? ` · attempt ${judgement.attempt}` : ""}
        </span>
        <span className={`risk risk-${approval.risk}`}>{approval.risk}</span>
      </div>

      <h3>{approval.title}</h3>
      <p>{judgement?.question ?? approval.summary}</p>

      {assets.length > 0 && (
        <div className="judgement-assets">
          {assets.map((a) => (
            <figure className="judgement-asset" key={a.ord}>
              {a.available ? (
                <img src={a.url} alt={a.label} loading="lazy" />
              ) : (
                /* A NAMED ABSENCE, NEVER AN EMPTY BOX. */
                <div className="judgement-asset-missing">{a.missing_reason}</div>
              )}
              <figcaption>{a.label}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {missing > 0 && (
        <p className="row-sub">
          {missing} of {assets.length} could not be shown. Approving would approve work you have not
          seen, so send it back until they are all here.
        </p>
      )}

      {asking ? (
        <div className="judgement-note">
          <label className="stat-l" htmlFor={`why-${approval.id}`}>
            What is wrong with it? She gets this sentence and works to it.
          </label>
          <textarea
            id={`why-${approval.id}`}
            className="judgement-why"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The type is too small on the last three, and the second one is the wrong colour."
          />
          <div className="decide">
            <button
              className="btn btn-reject"
              disabled={busy !== null || note.trim().length === 0}
              onClick={() => decide("rejected", note.trim())}
            >
              {busy === "rejected" ? "Sending back…" : "Send it back"}
            </button>
            <button className="btn btn-defer" disabled={busy !== null} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="decide">
          <button className="btn btn-approve" disabled={busy !== null} onClick={() => decide("approved")}>
            {busy === "approved" ? "Approving…" : "Approve — carry on and finish"}
          </button>
          <button className="btn btn-reject" disabled={busy !== null} onClick={() => setAsking(true)}>
            Try again
          </button>
        </div>
      )}

      {/*
        * NO "LATER" BUTTON, AND THAT IS DELIBERATE. Deferring is how a judgement call becomes a
        * thing she scrolls past; the item does not expire and does not vanish, so the only two
        * answers are the two that move the work.
        */}
    </article>
  );
}
