import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Docket } from "../components/Docket";
import { JudgementDocket } from "../components/JudgementDocket";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

export function Inbox({ onCountChange, onOpen }: {
  onCountChange: (n: number) => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
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
      const [approvals, sys, judged] = await Promise.all([
        api.approvals("pending"),
        api.status(),
        api.judgementPending().catch(() => ({ items: [] as any[] })),
      ]);
      setItems(approvals);
      setJudgements(Object.fromEntries((judged.items ?? []).map((j: any) => [j.approval_id, j])));
      setStatus(sys);
      onCountChange(approvals.length);
      setError(null);
    } catch (e) {
      setError(e);
      setItems((prev) => prev ?? []);
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
      // Counters and budgets move on a decision, so refresh them from the server.
      api.status().then(setStatus).catch(() => {});
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

  const dayBudget = status?.budgets?.find((b: any) => b.lane === "ops" && b.period === "day");
  const pct = dayBudget ? Math.min(100, (dayBudget.spent_micros / dayBudget.limit_micros) * 100) : 0;
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
          <div className="stat-n">{status?.counts?.pending_approvals ?? "—"}</div>
          <div className="stat-l">Waiting on you</div>
        </div>
        <div className="stat">
          <div className="stat-n">{status?.counts?.open_tasks ?? "—"}</div>
          <div className="stat-l">Work in flight</div>
        </div>
      </div>

      {dayBudget && (
        <div className="stat" style={{ marginTop: 10 }}>
          <div className="stat-l" style={{ margin: 0 }}>
            Today · {usd(dayBudget.spent_micros)} of {usd(dayBudget.limit_micros)}
          </div>
          <div className="meter"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {(status?.counts?.open_dead_letters ?? 0) > 0 && (
        <div className="notice" style={{ borderColor: "var(--reject)" }}>
          {status.counts.open_dead_letters} task{status.counts.open_dead_letters === 1 ? "" : "s"} gave up after
          retrying. Triage them under Settings → Diagnostics.
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
