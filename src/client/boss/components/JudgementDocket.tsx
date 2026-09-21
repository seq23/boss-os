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
  approval, judgement, onDecide, selected, onSelect,
}: {
  approval: any;
  judgement: any;
  onDecide: (id: string, decision: string, note?: string) => Promise<void>;
  /** Bulk selection (Inbox overhaul, 19 Sep 2026). Undefined when the list is not selectable. */
  selected?: boolean;
  onSelect?: (id: string, shiftKey: boolean) => void;
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
    <article
      className={`docket${selected ? " docket-selected" : ""}`}
      style={{ ["--lane" as string]: "var(--lane-ops)" }}
      data-approval-id={approval.id}
    >
      <div className="docket-head">
        <span className="docket-no">
          {onSelect && (
            /*
             * SELECT MANY, THEN ONE REASON. Space toggles (the native checkbox does that), shift-click
             * selects the range from the last one she touched; the Inbox owns the range logic.
             */
            <input
              type="checkbox"
              className="docket-select"
              aria-label={`Select ${approval.title}`}
              checked={Boolean(selected)}
              onClick={(e) => onSelect(approval.id, e.shiftKey)}
              onChange={() => { /* handled in onClick so the shift key is visible */ }}
            />
          )}
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

      {/*
        * ─── WHEN THE WORK IS WORDS ────────────────────────────────────────────
        *
        * Same rule the covers follow: THE WORK IS VISIBLE HERE. Judging a letter from a sentence
        * describing it is not judging it, and sending her somewhere else to read it is the
        * hands-off failure the whole mechanism exists to remove.
        *
        * `white-space: pre-wrap` because the paragraphs are the letter's own. Reflowing them would
        * show her something other than what an approval approves.
        */}
      {judgement?.letter && (
        <div className="panel" style={{ marginTop: 8 }}>
          <div className="stat-l" style={{ margin: 0 }}>Subject</div>
          <div className="row-title">{judgement.letter.subject}</div>
          <div className="row-sub" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{judgement.letter.body}</div>
          {judgement.letter.to_hint && (
            <div className="row-sub" style={{ marginTop: 8 }}><strong>Where it goes:</strong> {judgement.letter.to_hint}</div>
          )}
          {/*
            * SAID ON THE CARD, NOT ONLY IN THE HANDLER. The green button is the most
            * consequential-looking control in the product and she should never have to wonder
            * whether pressing it emailed a stranger. It does not, and it cannot: it creates a
            * DRAFT in her own Gmail, and she sends from there.
            */}
          <div className="row-sub" style={{ marginTop: 8 }}>
            The green button does not send this. It creates the draft in your Gmail
            (staylor@spry.vc) with the subject and body filled; you read it once more there, add the
            address, and send it yourself.
          </div>
          {judgement.letter.her_note && (
            <div className="row-sub" style={{ marginTop: 8 }} data-testid="letter-answers-note">
              <strong>Answering your note:</strong> {judgement.letter.her_note}
              {judgement.letter.written_by && <> · <em>rewritten by {judgement.letter.written_by}</em></>}
            </div>
          )}
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
        /*
         * ─── THE GREEN BUTTON MAKES A DRAFT. THERE IS NO SEND BUTTON. ────────────────
         *
         * Owner, 19 September 2026, verbatim: "it should never send — the green button should be
         * to create the draft." Until that day this button read "Approve — it is ready to send",
         * which was true only in the sense that she would then copy the letter out of the Capital
         * desk by hand. Now the approval IS the draft: one press records her yes and creates the
         * draft in her own mailbox, and the result comes back on this card.
         *
         * NO SEND ACTION MAY BE ADDED HERE. `scripts/validate/the-inbox-draft-never-sends.mjs`
         * fails the build if this card grows a second primary button, a label that is a send verb,
         * or a letter label that does not say "draft".
         */
        <div className="decide">
          <button className="btn btn-approve" disabled={busy !== null} onClick={() => decide("approved")}>
            {busy === "approved"
              ? (judgement?.letter ? "Creating the draft…" : "Approving…")
              : judgement?.letter ? "Create the draft in my Gmail"
                : judgement?.resume_kind === "duty_created" ? "Approve — put it on the schedule"
                  : "Approve — carry on and finish"}
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
