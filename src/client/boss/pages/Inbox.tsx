import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Docket } from "../components/Docket";
import { JudgementDocket } from "../components/JudgementDocket";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

export function Inbox({ onCountChange, onOpen }: {
  onCountChange: (n: number) => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  /*
   * NOTICES, HELD SEPARATELY FROM DECISIONS, all the way from the query to the screen.
   *
   * Confirmed on production, 9 September 2026: eight `kind = 'notice'` rows, all `approved`. She had
   * pressed Approve on eight sentences that had nothing to approve. Splitting them at the end — a
   * different colour, a different label — would have left them in the same list and the same count;
   * they are a different kind of thing and the screen now says so before she reads a word.
   */
  const [notices, setNotices] = useState<any[] | null>(null);
  /*
   * The judgement calls, by their approval id. Fetched alongside the dockets so a judgement card
   * can render the actual work — the covers — rather than a sentence describing them. A judgement
   * whose detail fails to load still renders as an ordinary docket rather than disappearing.
   */
  const [judgements, setJudgements] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      /*
       * A JUDGEMENT FETCH THAT FAILS IS NOT A JUDGEMENT-FREE INBOX.
       *
       * This used to be `.catch(() => ({ items: [] }))`, so an outage on that one endpoint rendered
       * every judgement docket as an ORDINARY docket - Approve and Try Again over a card with the
       * covers missing and nothing saying they were missing. Approving work you cannot see is the
       * exact failure `missing_reason` exists to prevent, arriving through the back door. It now
       * fails with the rest of the load, and the list says so.
       */
      const [approvals, sys, judged, told] = await Promise.all([
        api.approvals("pending"),
        api.status(),
        api.judgementPending(),
        api.notices(),
      ]);
      setItems(approvals);
      setNotices(told);
      setJudgements(Object.fromEntries((judged.items ?? []).map((j: any) => [j.approval_id, j])));
      setStatus(sys);
      /*
       * THE BADGE READS THE SAME NUMBER THE STAT DOES, AND BOTH COME FROM `approvals/pending.ts`.
       *
       * It used to be `approvals.length` - a fifth independent answer to "what is waiting on her",
       * and the one that silently under-reports past the hundred-row page cap. Every surface now
       * carries the total; only the list is capped, and the response says when it is.
       */
      onCountChange(sys?.counts?.pending_approvals ?? approvals.length);
      setError(null);
    } catch (e) {
      setError(e);
      setItems((prev) => prev ?? []);
      // NOT `[]`. A failed fetch and an empty inbox are opposite facts, and the section below says
      // which one it is looking at rather than rendering both as silence.
      setNotices((prev) => prev ?? null);
    }
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  /**
   * Optimistic: the docket leaves the list the moment you decide. If the request
   * fails the card comes straight back with the reason, rather than the list
   * silently disagreeing with the server after an arbitrary delay.
   */
  async function decide(id: string, decision: string, note?: string) {
    const snapshot = items ?? [];
    const index = snapshot.findIndex((a) => a.id === id);
    if (index === -1) return;

    const optimistic = snapshot.filter((a) => a.id !== id);
    // A notice cleared from its own section leaves that section, not this list.
    setNotices((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    setItems(optimistic);
    onCountChange(optimistic.length);
    setError(null);

    try {
      const result = await api.decide(id, decision, note);
      const exec = result.execution;
      if (exec?.status === "failed") {
        setFlash(`Recorded as ${decision}, but the action failed: ${exec.detail?.error ?? "unknown reason"}`);
        /*
         * A JUDGEMENT WHOSE RESUME FAILED IS STILL AWAITING, so it has to come back onto the list.
         * The optimistic removal above is right for an ordinary docket and wrong here: her answer
         * did not take, and the worst possible response is the item quietly vanishing.
         */
        if (exec.detail?.still_awaiting) load();
      } else if (exec?.status === "executed" && exec.detail?.resumed) {
        setFlash(exec.detail.resumed as string);
      } else if (decision === "deferred") {
        setFlash("Deferred. It stays on the list until it expires.");
      } else {
        setFlash(null);
      }
      /*
       * COUNTERS MOVE ON A DECISION, AND THE BADGE MOVES WITH THEM.
       *
       * The refresh used to swallow its own failure, so a stale "9 waiting" over an empty list
       * survived a decision and looked exactly like a fresh one. If the server cannot be reached
       * the numbers are set to a dash rather than left showing what was true before the decision.
       */
      api.status()
        .then((s) => { setStatus(s); onCountChange(s?.counts?.pending_approvals ?? optimistic.length); })
        .catch(() => setStatus(null));
      if (decision === "deferred") load();
    } catch (e) {
      // Roll back to exactly where the card was.
      const rolled = [...optimistic];
      rolled.splice(index, 0, snapshot[index]);
      setItems(rolled);
      onCountChange(rolled.length);
      setError(e);
    }
  }

  const work = status?.work_today ?? null;
  const costMode = status?.cost_mode;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {flash && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          {flash}
          <button className="notice-x" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {costMode && costMode !== "NORMAL" && (
        <div className="notice" style={{ borderColor: "var(--gold)" }}>
          Cost mode is <strong>{status.cost_mode_policy?.label ?? costMode}</strong>. {status.cost_mode_policy?.note}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          {/*
            * THIS NUMBER NOW COUNTS ONLY WHAT HER ANSWER CHANGES. `approvals/pending.ts` excludes
            * notices from `total`, so the badge, the Today card and this stat all stopped counting
            * eight sentences as eight decisions.
            */}
          <div className="stat-n">{status?.counts?.pending_approvals ?? "—"}</div>
          <div className="stat-l">Waiting on you</div>
        </div>
        <div className="stat">
          <div className="stat-n">{status?.counts?.open_tasks ?? "—"}</div>
          <div className="stat-l">Work in flight</div>
        </div>
      </div>

      {/*
        * ─── WHAT HAPPENED TODAY, INSTEAD OF A BAR THAT CANNOT FILL ───────────
        *
        * This strip read "Today · $0.00 of $2.00" above an empty progress bar. The figure is not
        * merely small — it is STRUCTURALLY ALWAYS ZERO: nearly every duty runs through Claude Code
        * on her own subscription, which records `cost_micros: 0` by design, so no amount of activity
        * can ever move it. A bar that cannot fill, in the most prominent strip on the page, implies
        * an oversight that does not exist.
        *
        * IT HAD ALREADY DONE REAL DAMAGE. The daily briefing's leash was cut to 300s to fit that
        * ceiling, and that cut is what kills the run at exit 124 with a finished report on disk.
        *
        * HER ACTUAL QUESTION IS "DID MY EMPLOYEES DO ANYTHING, AND DID IT WORK". On the morning this
        * was written, two runs died silently and this screen said nothing. `failed` is now the second
        * number on the strip.
        *
        * `runs` COUNTS ATTEMPTS AND `delivered` COUNTS THINGS THAT EXIST, and they are shown side by
        * side on purpose: a day of six runs and no deliverables is precisely the day she needs to see.
        */}
      {work && (
        <>
          <div className="stats" style={{ marginTop: 10 }}>
            <div className="stat">
              <div className="stat-n">{work.runs}</div>
              <div className="stat-l">runs today</div>
            </div>
            <div className="stat">
              <div className="stat-n" style={work.failed > 0 ? { color: "var(--reject)" } : undefined}>{work.failed}</div>
              <div className="stat-l">failed</div>
            </div>
            <div className="stat">
              <div className="stat-n">{work.delivered}</div>
              <div className="stat-l">delivered</div>
            </div>
          </div>
          <div className="row-sub" style={{ marginTop: 6 }}>
            {work.runs === 0
              ? "Nothing has run yet today."
              : `${work.succeeded} finished, ${work.failed} failed, ${work.running} still going${work.refused > 0 ? `, ${work.refused} refused` : ""}.`}
            {" "}
            {/*
              * TOKENS, NOT DOLLARS. Tokens are measured and real. The dollar figure would cover only
              * the metered backends, and on a day when six things ran it would read as zero — which
              * is exactly the misreading that shortened the briefing's leash.
              */}
            {work.metered_calls > 0
              ? `${work.in_tokens.toLocaleString()} in / ${work.out_tokens.toLocaleString()} out tokens on the metered models.`
              : "Nothing ran on a metered model today, so there is no token figure — this is not a measure of how much ran."}
          </div>
        </>
      )}

      {(status?.counts?.open_dead_letters ?? 0) > 0 && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          {status.counts.open_dead_letters} task{status.counts.open_dead_letters === 1 ? "" : "s"} gave up after
          retrying. Triage them under Settings → Diagnostics.
        </div>
      )}

      {/*
        * ─── WHAT AN EMPLOYEE TOLD HER, WITH NOTHING TO ANSWER ────────────────
        *
        * Below the decisions, because a decision outranks a notification, and above nothing —
        * these are the only two lists on this screen.
        */}
      {(notices?.length ?? 0) > 0 && (
        <>
          <p className="eyebrow">Just so you know — nothing here needs an answer</p>
          {notices!.map((n) => <Docket key={n.id} approval={n} onDecide={decide} onOpen={onOpen} />)}
        </>
      )}
      {notices === null && !error && (
        <div className="row-sub">
          What your employees have told you could not be read just now, so this is not saying they
          have told you nothing.
        </div>
      )}

      <p className="eyebrow">Pending dockets</p>
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title="Nothing needs you" hint="Approvals raised by your employees land here." />
      ) : (
        items.map((a) =>
          judgements[a.id] ? (
            <JudgementDocket key={a.id} approval={a} judgement={judgements[a.id]} onDecide={decide} />
          ) : (
            <Docket key={a.id} approval={a} onDecide={decide} onOpen={onOpen} />
          ),
        )
      )}
    </>
  );
}
