import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Docket } from "../components/Docket";
import { JudgementDocket } from "../components/JudgementDocket";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * THE INBOX — what is waiting on her, by lane, with one act for many.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "The inbox needs an overhaul. I need to be able to reject all things at once with an
 *    overarching reason why — right now I had 13 messages to reject."
 *
 * Confirmed on production the same day: thirteen `judgement_call` dockets rejected one by one
 * between 1789827048305 and 1789827130515, eleven of them with the decision note "same". So:
 *
 *   · THE MASTHEAD answers the question first — "13 waiting on you · oldest 3 days".
 *   · GROUPED BY LANE, with a count on each group, so thirteen letters from one employee read as
 *     one thing that happened rather than thirteen unrelated cards.
 *   · SELECT MANY (checkbox, space toggles, shift-click ranges), then ONE "Reject selected" that
 *     asks for one reason (≥ 12 characters, with the reasons she actually gives to hand), confirms
 *     the count, and rejects each docket through the same route a single press uses — one decision
 *     per record, the whole sentence on each, progress as it runs, and a result line at the end.
 *   · NO BULK APPROVE. Approving is judging work she has read; thirteen letters approved as one act
 *     are thirteen letters she may not have read. Rejecting sends nothing and loses nothing.
 */

/** How short the shared reason may be. Mirrors MIN_BATCH_REASON_CHARS on the route. */
const MIN_REASON = 12;

/**
 * The reasons she actually gives, read off production's decision notes on 19 September 2026 and
 * written as whole sentences a person redoing the work can act on. "same" is what they replace.
 */
const QUICK_REASONS = [
  "Same note as the previous letter — apply it to this one too.",
  "Rewrite the opening: my name, Spry VC, and that I have investors interested in late-stage positions.",
  "Too long and it reads like AI — shorter, plainer, and drop the technical paragraph.",
  "Not the right firm for this — do not write to them again.",
];

const RESUME_LABEL: Record<string, string> = {
  buyer_outreach_email: "Letters to buyers",
  kdp_covers: "Kindle covers",
  meeting_packet_raised: "Meeting packets",
};
const KIND_LABEL: Record<string, string> = {
  task_output: "Work to check",
  spend: "Budget",
  memory_promotion: "Memory",
  trade: "Trades",
  model_route: "Routing",
  model_promotion: "Model promotions",
  agent_creation: "New employees",
  backend_run: "Runs to accept",
  manual: "Decisions",
};

function groupOf(a: any, judgement: any | undefined): { key: string; label: string } {
  if (judgement) {
    const who = judgement.employee_name ?? judgement.employee_id ?? "an employee";
    const what = RESUME_LABEL[judgement.resume_kind] ?? judgement.resume_kind ?? "judgement calls";
    return { key: `j:${judgement.resume_kind}:${who}`, label: `${what} · ${who}` };
  }
  return { key: `k:${a.kind}:${a.lane}`, label: `${KIND_LABEL[a.kind] ?? a.kind}${a.lane === "trading" ? " · trading" : ""}` };
}

function ageWords(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

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
   * ─── "LATER" MUST GO SOMEWHERE SHE CAN SEE ────────────────────────────────
   *
   * CONFIRMED in a browser, 19 September 2026 (hostile sweep): Later wrote `status = 'deferred'`,
   * the list reads `status = 'pending'`, and the flash said "It stays on the list until it
   * expires" while the card left the screen for good — no surface read deferred rows, so a
   * put-off decision was a lost decision until the expiry sweep marked it expired. This list is
   * the deferred rows, read from the same table, shown under the decisions, decidable from there.
   */
  const [putOff, setPutOff] = useState<any[] | null>(null);
  /*
   * The judgement calls, by their approval id. Fetched alongside the dockets so a judgement card
   * can render the actual work — the covers, the letter — rather than a sentence describing them.
   */
  const [judgements, setJudgements] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // ─── Selection and the one shared reason ───────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastTouched = useRef<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number; redrafted: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      /*
       * A JUDGEMENT FETCH THAT FAILS IS NOT A JUDGEMENT-FREE INBOX.
       *
       * This used to be `.catch(() => ({ items: [] }))`, so an outage on that one endpoint rendered
       * every judgement docket as an ORDINARY docket - Approve and Try Again over a card with the
       * covers missing and nothing saying they were missing. It now fails with the rest of the
       * load, and the list says so.
       */
      const [approvals, sys, judged, told, deferred] = await Promise.all([
        api.approvals("pending"),
        api.status(),
        api.judgementPending(),
        api.notices(),
        api.approvals("deferred"),
      ]);
      setItems(approvals);
      setNotices(told);
      setPutOff(deferred);
      setJudgements(Object.fromEntries((judged.items ?? []).map((j: any) => [j.approval_id, j])));
      setStatus(sys);
      /*
       * THE BADGE READS THE SAME NUMBER THE STAT DOES, AND BOTH COME FROM `approvals/pending.ts`.
       * Every surface carries the total; only the list is capped, and the response says when it is.
       */
      onCountChange(sys?.counts?.pending_approvals ?? approvals.length);
      setError(null);
      // A selection that outlived its rows is a count that lies.
      setSelected((prev) => new Set([...prev].filter((id) => approvals.some((a: any) => a.id === id))));
    } catch (e) {
      setError(e);
      setItems((prev) => prev ?? []);
      // NOT `[]`. A failed fetch and an empty inbox are opposite facts, and the section below says
      // which one it is looking at rather than rendering both as silence.
      setNotices((prev) => prev ?? null);
      setPutOff((prev) => prev ?? null);
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
    /*
     * ─── A NOTICE IS NOT IN `items`, AND "GOT IT" USED TO DO NOTHING ──────────
     *
     * CONFIRMED in a browser, 19 September 2026 (hostile sweep): `approvals/pending.ts` splits the
     * table into decisions (`rows` → `items`) and notices (`notices`), and this guard returned when
     * the id was not among the decisions — which is every notice. The "Got it" press fired no
     * request, the card stayed, and nothing said so. A dead button on the one card that exists to
     * be dismissed teaches her the Inbox is decorative. So a notice is looked up in its own list,
     * and the early return is only for an id that is on NEITHER list.
     */
    const noticeSnapshot = notices ?? [];
    const noticeIndex = noticeSnapshot.findIndex((n) => n.id === id);
    const putOffSnapshot = putOff ?? [];
    const putOffIndex = putOffSnapshot.findIndex((n) => n.id === id);
    if (index === -1 && noticeIndex === -1 && putOffIndex === -1) return;
    setPutOff((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));

    const optimistic = snapshot.filter((a) => a.id !== id);
    setNotices((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    setItems(optimistic);
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    onCountChange(optimistic.length);
    setError(null);

    try {
      const result = await api.decide(id, decision, note);
      const exec = result.execution;
      if (exec?.status === "failed") {
        setFlash(`Recorded as ${decision}, but the action failed: ${exec.detail?.error ?? "unknown reason"}`);
        /*
         * A JUDGEMENT WHOSE RESUME FAILED IS STILL AWAITING, so it has to come back onto the list.
         * Her answer did not take, and the worst possible response is the item quietly vanishing.
         */
        if (exec.detail?.still_awaiting) load();
      } else if (exec?.status === "executed" && exec.detail?.resumed) {
        setFlash(exec.detail.resumed as string);
        // A different letter came back for this firm; show it rather than leaving a stale list.
        if (exec.detail?.redrafted) load();
      } else if (decision === "deferred") {
        setFlash("Put off. It waits under \"Put off\" below until it expires, and you can decide it from there.");
      } else {
        setFlash(null);
      }
      /*
       * COUNTERS MOVE ON A DECISION, AND THE BADGE MOVES WITH THEM. If the server cannot be reached
       * the numbers are set to a dash rather than left showing what was true before the decision.
       */
      api.status()
        .then((s) => { setStatus(s); onCountChange(s?.counts?.pending_approvals ?? optimistic.length); })
        .catch(() => setStatus(null));
      if (decision === "deferred") load();
    } catch (e) {
      // Roll back to exactly where the card was — on whichever list it came from.
      if (index !== -1) {
        const rolled = [...optimistic];
        rolled.splice(index, 0, snapshot[index]);
        setItems(rolled);
        onCountChange(rolled.length);
      } else if (noticeIndex !== -1) {
        const rolledNotices = [...noticeSnapshot.filter((n) => n.id !== id)];
        rolledNotices.splice(noticeIndex, 0, noticeSnapshot[noticeIndex]);
        setNotices(rolledNotices);
      } else {
        setPutOff(putOffSnapshot);
      }
      setError(e);
    }
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  /** Everything on the list that can be selected: decisions, never notices. */
  const selectable = useMemo(() => (items ?? []).filter((a) => a.kind !== "notice"), [items]);

  function toggle(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const order = selectable.map((a) => a.id);
      /*
       * SHIFT-CLICK SELECTS THE RANGE from the last card she touched to this one, in list order, and
       * sets every card in it to the state this click produced — so shift-clicking into a mostly
       * selected block clears it rather than flipping each card at random.
       */
      if (shiftKey && lastTouched.current && order.includes(lastTouched.current)) {
        const a = order.indexOf(lastTouched.current);
        const b = order.indexOf(id);
        const turnOn = !prev.has(id);
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) {
          if (turnOn) next.add(x); else next.delete(x);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      lastTouched.current = id;
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(selectable.map((a) => a.id)) : new Set());
  }

  const reasonOk = reason.trim().length >= MIN_REASON;

  /**
   * ONE ACT, N DECISIONS. Open the batch (the shared reason and the count), then decide each
   * docket through the same route a single press uses, in order, counting as it goes. A docket the
   * route refuses is counted as failed on the batch and stays on the list with the reason.
   */
  async function rejectSelected() {
    const ids = selectable.filter((a) => selected.has(a.id)).map((a) => a.id);
    if (ids.length === 0 || !reasonOk) return;
    setConfirming(false);
    setError(null);
    setResult(null);
    setProgress({ done: 0, failed: 0, total: ids.length, redrafted: 0 });

    let batchId: string;
    try {
      const batch = await api.openBatch("rejected", reason.trim(), ids.length);
      batchId = batch.id;
    } catch (e) {
      setError(e);
      setProgress(null);
      return;
    }

    let done = 0, failed = 0, redrafted = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const r = await api.decide(id, "rejected", reason.trim(), batchId);
        done += 1;
        if (r.execution?.detail?.redrafted) redrafted += 1;
        setItems((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      } catch (e) {
        failed += 1;
        const message = (e as { message?: string })?.message ?? "refused";
        failures.push(`${(items ?? []).find((a) => a.id === id)?.title ?? id}: ${message}`);
        api.batchItemFailed(batchId, id, message).catch(() => { /* counted locally regardless */ });
      }
      setProgress({ done, failed, total: ids.length, redrafted });
    }

    setSelected(new Set());
    setAsking(false);
    setReason("");
    setProgress(null);
    setResult(
      `${done} rejected · ${failed} failed` +
        (redrafted > 0 ? ` · ${redrafted} came back rewritten to your note and ${redrafted === 1 ? "is" : "are"} below` : "") +
        (failures.length ? ` — ${failures.join("; ")}` : ""),
    );
    await load();
  }

  // ─── Derived: the masthead and the groups ────────────────────────────────────

  const waiting = status?.counts?.pending_approvals ?? (items ? selectable.length : null);
  const oldest = useMemo(() => {
    const ts = (items ?? []).filter((a) => a.kind !== "notice").map((a) => Number(a.requested_at)).filter(Number.isFinite);
    return ts.length ? Math.min(...ts) : null;
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: any[] }>();
    for (const a of items ?? []) {
      if (a.kind === "notice") continue;
      const g = groupOf(a, judgements[a.id]);
      if (!map.has(g.key)) map.set(g.key, { label: g.label, rows: [] });
      map.get(g.key)!.rows.push(a);
    }
    // Biggest group first: the thing that flooded her is the thing to deal with first.
    return [...map.values()].sort((x, y) => y.rows.length - x.rows.length);
  }, [items, judgements]);

  const work = status?.work_today ?? null;
  const costMode = status?.cost_mode;
  const selectedCount = selectable.filter((a) => selected.has(a.id)).length;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {flash && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          {flash}
          <button className="notice-x" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {result && (
        <div className="notice" style={{ borderColor: "var(--gold)" }} data-testid="bulk-result">
          {result}
          <button className="notice-x" onClick={() => setResult(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {costMode && costMode !== "NORMAL" && (
        <div className="notice" style={{ borderColor: "var(--gold)" }}>
          Cost mode is <strong>{status.cost_mode_policy?.label ?? costMode}</strong>. {status.cost_mode_policy?.note}
        </div>
      )}

      {/*
        * ─── THE MASTHEAD: THE ANSWER FIRST ────────────────────────────────────
        *
        * "13 waiting on you · oldest 3 days". The number is `approvals/pending.ts`'s total — the same
        * one the badge and Today read — so no surface disagrees. Notices are not counted: they are
        * things she has been told, not things waiting on her.
        */}
      <div className="masthead" data-testid="inbox-masthead">
        <div className="masthead-n">{waiting ?? "—"}</div>
        <div className="masthead-l">
          {waiting === 0 ? "waiting on you — nothing needs an answer" : waiting === 1 ? "waiting on you" : "waiting on you"}
          {oldest !== null && waiting !== 0 ? ` · oldest ${ageWords(Date.now() - oldest)}` : ""}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-n">{status?.counts?.open_tasks ?? "—"}</div>
          <div className="stat-l">Work in flight</div>
        </div>
        <div className="stat">
          <div className="stat-n">{work ? work.runs : "—"}</div>
          <div className="stat-l">runs today</div>
        </div>
      </div>

      {/*
        * ─── WHAT HAPPENED TODAY, INSTEAD OF A BAR THAT CANNOT FILL ───────────
        *
        * `runs` COUNTS ATTEMPTS AND `delivered` COUNTS THINGS THAT EXIST, and they are shown side by
        * side on purpose: a day of six runs and no deliverables is precisely the day she needs to see.
        * Tokens, not dollars: the dollar figure is structurally always zero on the Claude Code lane.
        */}
      {work && (
        <div className="row-sub" style={{ marginTop: 6 }}>
          {work.runs === 0
            ? "Nothing has run yet today."
            : `${work.succeeded} finished, ${work.failed} failed, ${work.running} still going${work.refused > 0 ? `, ${work.refused} refused` : ""}, ${work.delivered} delivered.`}
          {" "}
          {work.metered_calls > 0
            ? `${work.in_tokens.toLocaleString()} in / ${work.out_tokens.toLocaleString()} out tokens on the metered models.`
            : "Nothing ran on a metered model today, so there is no token figure — this is not a measure of how much ran."}
        </div>
      )}

      {(status?.counts?.open_dead_letters ?? 0) > 0 && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          {status.counts.open_dead_letters} task{status.counts.open_dead_letters === 1 ? "" : "s"} gave up after
          retrying. Triage them under Settings → Diagnostics.
        </div>
      )}

      {/*
        * ─── ONE ACT FOR MANY ──────────────────────────────────────────────────
        *
        * The bar appears when there is more than one thing to decide. Select all, or some; the count
        * is always what will actually be rejected. Approve is deliberately absent — see the header.
        */}
      {selectable.length > 1 && (
        <div className="bulk-bar" data-testid="bulk-bar">
          <label className="bulk-all">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={selectedCount > 0 && selectedCount === selectable.length}
              onChange={(e) => selectAll(e.target.checked)}
            />
            <span>{selectedCount > 0 ? `${selectedCount} selected` : `Select all ${selectable.length}`}</span>
          </label>
          <button
            className="btn btn-small btn-reject"
            disabled={selectedCount === 0 || progress !== null}
            onClick={() => { setAsking(true); setConfirming(false); }}
            data-testid="reject-selected"
          >
            Reject selected
          </button>
        </div>
      )}

      {asking && selectedCount > 0 && (
        <div className="panel" data-testid="bulk-reason">
          <div className="row-title">One reason for all {selectedCount}</div>
          <div className="row-sub" style={{ marginTop: 4 }}>
            It is written onto every one of the {selectedCount} records, so whoever redoes the work reads the whole
            sentence — not "same".
          </div>
          <div className="quick-reasons">
            {QUICK_REASONS.map((q) => (
              <button key={q} type="button" className="btn btn-small" onClick={() => setReason(q)}>{q}</button>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>The reason ({MIN_REASON} characters or more)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What is wrong with these, in one sentence they can act on."
              aria-invalid={reason.length > 0 && !reasonOk}
              data-testid="bulk-reason-text"
            />
          </label>
          {reason.length > 0 && !reasonOk && (
            <div className="field-error" role="alert">
              {MIN_REASON - reason.trim().length} more character{MIN_REASON - reason.trim().length === 1 ? "" : "s"} — a reason this short tells them nothing.
            </div>
          )}
          {!confirming ? (
            <div className="decide">
              <button className="btn btn-reject" disabled={!reasonOk || progress !== null} onClick={() => setConfirming(true)} data-testid="bulk-continue">
                Reject {selectedCount} with this reason
              </button>
              <button className="btn btn-defer" onClick={() => { setAsking(false); setConfirming(false); }}>Cancel</button>
            </div>
          ) : (
            <div className="decide">
              <button className="btn btn-reject" disabled={progress !== null} onClick={rejectSelected} data-testid="bulk-confirm">
                Yes — reject all {selectedCount}
              </button>
              <button className="btn btn-defer" onClick={() => setConfirming(false)}>Back</button>
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="notice" style={{ borderColor: "var(--gold)" }} role="status" data-testid="bulk-progress">
          {progress.done} of {progress.total} rejected{progress.failed > 0 ? ` · ${progress.failed} failed` : ""}…
        </div>
      )}

      {/*
        * ─── WHAT AN EMPLOYEE TOLD HER, WITH NOTHING TO ANSWER ────────────────
        *
        * Below the decisions, because a decision outranks a notification.
        */}
      {(notices?.length ?? 0) > 0 && (
        <>
          <p className="eyebrow">Just so you know — nothing here needs an answer · {notices!.length}</p>
          {notices!.map((n) => <Docket key={n.id} approval={n} onDecide={decide} onOpen={onOpen} />)}
        </>
      )}
      {notices === null && !error && (
        <div className="row-sub">
          What your employees have told you could not be read just now, so this is not saying they
          have told you nothing.
        </div>
      )}

      {items === null ? (
        <>
          <p className="eyebrow">Waiting on you</p>
          <Loading />
        </>
      ) : selectable.length === 0 ? (
        <>
          <p className="eyebrow">Waiting on you</p>
          <Empty
            title="Nothing needs you"
            hint={error ? "The list could not be read just now, so this is not saying nothing is waiting." : "Approvals raised by your employees land here, grouped by who raised them."}
          />
        </>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="inbox-group" data-testid="inbox-group">
            <p className="eyebrow">{g.label} · {g.rows.length}</p>
            {g.rows.map((a) =>
              judgements[a.id] ? (
                <JudgementDocket
                  key={a.id}
                  approval={a}
                  judgement={judgements[a.id]}
                  onDecide={decide}
                  selected={selected.has(a.id)}
                  onSelect={toggle}
                />
              ) : (
                <Docket
                  key={a.id}
                  approval={a}
                  onDecide={decide}
                  onOpen={onOpen}
                  selected={selected.has(a.id)}
                  onSelect={toggle}
                />
              ),
            )}
          </section>
        ))
      )}

      {/* Below the decisions: what she put off. See `putOff` above for why this section exists. */}
      {(putOff?.length ?? 0) > 0 && (
        <section className="inbox-group" data-testid="inbox-put-off">
          <p className="eyebrow">Put off · {putOff!.length} — still yours to decide; gone only when it expires</p>
          {putOff!.map((a) => (
            <Docket key={a.id} approval={a} onDecide={decide} onOpen={onOpen} />
          ))}
        </section>
      )}
      {putOff === null && !error && (
        <div className="row-sub">
          What you put off could not be read just now, so this is not saying there is nothing put off.
        </div>
      )}
    </>
  );
}
