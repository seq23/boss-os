import { useCallback, useEffect, useRef, useState } from "react";
import { go, employeeHref, morningHref } from "../nav";
import { api } from "../api";
import { buildOperations } from "../operationsSource";
import { Coaching } from "./Coaching";
import { BodyContractView } from "./BodyContract";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { AncestralHourCard } from "../components/AncestralHourCard";
import { LunationBlock, type Lunation } from "../components/Lunation";
import { usd } from "../../../shared/boss/types";
import { TodayList, GateEditor, GateCreator, AddToToday, Sheet, clock, type DayContext, type Gate, type ListData } from "../components/TodayList";

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

/**
 * The groups, mirrored from `TODAY_GROUPS` in the worker. Each is one request; together they are
 * the thirteen. A key listed nowhere here would never be fetched, which is why the worker's list is
 * the authority and this one is checked against it by test.
 */
export const TODAY_GROUPS: readonly (readonly string[])[] = [
  ["todays_contract"],
  ["day_flow", "coaching_focus", "daily_thinking_lens"],
  ["executive_briefing"],
  ["meetings", "open_loops"],
  ["critical_alerts"],
  ["spirit_signal"],
  ["approval_inbox", "employee_status", "continuity_status", "trading_status"],
];

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The groups the new Today reads. System health (alerts' detail, the roster, continuity, trading) moved to Systems. */
const TODAY_PAGE_GROUPS = TODAY_GROUPS.filter((g) => !g.includes("approval_inbox"));

const shortDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/** "**The AI trade is being repriced.** Friday's…" → "The AI trade is being repriced." */
const leadOf = (bullet: string) => {
  const m = /\*\*(.+?)\*\*/.exec(bullet);
  return (m ? m[1]! : bullet.split(/(?<=[.!?])\s/)[0]!).replace(/\[\d+\]/g, "").trim();
};

/**
 * COMING UP, ONE MEETING ONCE. Her Wednesday showed "Scooter Sync 8:00" from the calendar and "West
 * Peek partner meeting 9:00 · standing" an hour later, every week: the same meeting from two
 * sources. A standing entry whose person is named in a calendar entry on the same day is folded
 * into it ("… · and the standing partner meeting, 9:00").
 */
export function dedupeDiary(rows: any[]): any[] {
  const dayOf = (ms: number) => new Date(ms).toDateString();
  const out = rows.filter((r) => !r.standing).map((r) => ({ ...r }));
  for (const st of rows.filter((r) => r.standing)) {
    const who = String(st.with ?? "").toLowerCase();
    const twin = who ? out.find((r) => dayOf(r.scheduled_at) === dayOf(st.scheduled_at) && `${r.title} ${r.with ?? ""}`.toLowerCase().includes(who)) : null;
    if (twin) twin.also = `and the standing ${String(st.title).replace(/^West Peek /, "").toLowerCase()}, ${new Date(st.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    else out.push({ ...st });
  }
  return out.sort((a, b) => a.scheduled_at - b.scheduled_at);
}

/** Done for you, with the receipts rolled into one line. */
export function doneLines(done: { id: string; text: string }[]): { id: string | null; text: string }[] {
  const receipts = done.filter((d) => /^New receipt from /i.test(d.text));
  const rest = done.filter((d) => !/^New receipt from /i.test(d.text)).map((d) => ({ id: d.id, text: d.text }));
  if (!receipts.length) return rest;
  const from = receipts.map((r) => /^New receipt from ([^:]+?)(?:\.[a-z]+)*:/i.exec(r.text)?.[1] ?? "a sender")
    .map((d) => d.replace(/mail$/i, "")).map((d) => d.charAt(0).toUpperCase() + d.slice(1));
  return [...rest, { id: receipts[0]!.id, text: `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} filed (${[...new Set(from)].join(", ")}).` }];
}

export function Today({ onOpenOperations: _ops, onOpenRecentWork: _recent, focus = null, onNeedsYou, gateFocus = null }: {
  onOpenOperations?: () => void; onOpenRecentWork?: () => void;
  focus?: "briefing" | "morning" | "tell" | "coach" | "gate" | null;
  onNeedsYou?: (n: number) => void;
  gateFocus?: Gate | null;
} = {}) {
  const [blocks, setBlocks] = useState<Record<string, any>>({});
  const [day, setDay] = useState<any>(null);
  const [limits, setLimits] = useState<DayContext["limits"]>({ morning_priorities: 3, midday_checks: 3, night_review_prompts: 3 });
  const [list, setList] = useState<ListData | null>(null);
  const [morning, setMorning] = useState<any>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [coach, setCoach] = useState<"morning" | "evening" | null>(focus === "coach" ? (new Date().getHours() >= 17 ? "evening" : "morning") : null);
  const [sheet, setSheet] = useState<null | { kind: "edit"; gate: Gate; items: any[] } | { kind: "create" } | { kind: "add" }>(null);
  const [lunation, setLunation] = useState<Lunation | null>(null);
  const [fullBrief, setFullBrief] = useState(false);
  // "✎ Change it" in the morning email opens Today on that person (/?waiting=<id>).
  const [waitingFocus] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("waiting")));

  const loadList = useCallback(async () => {
    try { const l = await api.practiceList(); setList(l); onNeedsYou?.(l.needs_you); } catch (e) { setError(e); }
  }, [onNeedsYou]);

  const load = useCallback(async () => {
    const settled = await Promise.allSettled(TODAY_PAGE_GROUPS.map((g) => api.todayBlocks(g)));
    const good = settled.filter((r): r is PromiseFulfilledResult<Payload> => r.status === "fulfilled").map((r) => r.value);
    const bad = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (good.length) {
      setBlocks(Object.fromEntries(good.flatMap((p) => p.blocks).map((b) => [b.key, b])));
      setDay(good[good.length - 1]!.day);
      setLimits(good[good.length - 1]!.limits);
    }
    setError(bad ? bad.reason : null);
    await loadList();
  }, [loadList]);

  useEffect(() => {
    void load();
    api.morningLatest().then(setMorning).catch(() => setMorning(null));
    // The cycle she is in, from the same reading Spirit shows (components/Lunation.tsx).
    api.spiritDay().then((d: any) => setLunation(d?.current_lunation ?? null)).catch(() => setLunation(null));
  }, [load]);
  const setListAndCount = (l: ListData) => { setList(l); onNeedsYou?.(l.needs_you); };

  async function tick(key: string, done: boolean) {
    try { const l = await api.practiceTick(key, done); setList(l); onNeedsYou?.(l.needs_you); } catch (e) { setError(e); }
  }

  const c = (k: string) => blocks[k]?.content ?? null;
  const contract = c("todays_contract");
  const pillars = contract?.agenda?.pillars ?? null;
  const focusC = c("coaching_focus");
  const lens = c("daily_thinking_lens");
  const brief = c("executive_briefing");
  const spirit = c("spirit_signal");
  const meetings = c("meetings");
  // RED ONLY FOR A REAL ALARM THAT IS HERS (make-it-calm): a critical alert nobody on the team can
  // clear. A dead key, a blocked deliverable or a stalled duty is the team's, and lives on Systems.
  const TEAM_FIXES = new Set(["credentials", "deliverables", "tasks", "duties", "standing_duties", "site_audit"]);
  const alerts: any[] = (c("critical_alerts")?.alerts ?? []).filter((a: any) => a.severity === "critical" && !TEAM_FIXES.has(a.source_type));

  const ctx: DayContext = {
    gratitude: pillars?.spirit?.available === false ? null : (pillars?.spirit?.action ?? null),
    practice: pillars?.spirit?.detail ?? [],
    body: pillars?.body ?? null,
    law: focusC?.law ? { n: focusC.law.n, title: focusC.law.title, text: focusC.law.text } : null,
    // An empty pillar contributes nothing: "Nothing is owed" is not a priority.
    priorities: (contract?.contract?.priorities ?? []).filter((p: string) => !/^Nothing is owed/i.test(p)),
    // The leads review is the Wealth block's own sub-item; any other first money move is folded into Core business.
    firstMove: pillars?.wealth?.action && !/^Review \d+ candidate/.test(pillars.wealth.action)
      ? { action: pillars.wealth.action, why: pillars.wealth.why ? String(pillars.wealth.why).replace(/§[\d.]+\s*[—-]\s*/g, "") : null } : null,
    limits,
  };

  if (!list && !day) return error ? <ErrorNotice error={error} /> : <Loading />;

  const nudge = list?.coach.nudge ?? null;
  const done: any[] = morning?.payload?.done ?? [];
  const diaryRows = dedupeDiary(meetings?.diary ?? []);
  const next = diaryRows[0];
  // The briefing's 1-minute summary is shown; the rest opens inline (Today v4).
  const sections: any[] = brief?.sections ?? [];
  const summaryAt = sections.findIndex((x: any) => x?.key === "one_minute_summary" || /one[- ]minute|1[- ]minute/i.test(String(x?.heading ?? "")));
  const summary = sections[summaryAt >= 0 ? summaryAt : 0] ?? null;
  const rest = sections.filter((_: any, i: number) => i !== (summaryAt >= 0 ? summaryAt : 0));
  const q = list?.coach_question ?? null;
  const coachPhase = () => (new Date().getHours() >= 17 ? "evening" : "morning");

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {alerts.length > 0 && (
        <div className="alarm-banner" role="alert" data-testid="alarm-banner">
          ⚠ {alerts.length} to check first: {String(alerts[0].text).split(/(?<=[.!?])\s/)[0]}{" "}
          <button className="t-link" onClick={() => go("/?tab=systems&section=health")}>Open ›</button>
        </div>
      )}

      <div className="today-summary" data-testid="today-summary">
        <strong>{day ? shortDate(day.date_ts) : ""}</strong>
        {list && <span>· {list.needs_you} need you · {list.done} of {list.total} done</span>}
        {nudge && (
          <button className="nudge" onClick={() => setCoach(nudge)} data-testid="coach-nudge">
            {nudge === "morning" ? "☀" : "🌙"} Your coach is waiting · Start ›
          </button>
        )}
      </div>

      {/* The ancestral hour: a thin banner, only on the last day of the month and the 3 days before. */}
      <AncestralHourCard />

      {/* 1. TODAY'S CONTRACT — first, always. */}
      {list && (
        <TodayList
          list={list} ctx={ctx} onTick={(k, d) => void tick(k, d)} onChanged={() => void load()} onError={setError}
          onList={setListAndCount} waitingFocus={waitingFocus}
          onCoach={setCoach} openGate={gateFocus}
          onEditGate={(gate, items) => setSheet({ kind: "edit", gate, items })}
          onCreateGate={() => setSheet({ kind: "create" })}
          onAddLoop={() => setSheet({ kind: "add" })}
        />
      )}
      {list && list.needs_you === 0 && <p className="all-clear" data-testid="all-clear">All clear today: nothing is waiting on you.</p>}

      {/* 2. BRIEFING — the headline and the 1-minute summary; the rest opens right here. */}
      {brief && (brief.headline || brief.summary) && (
        <section className="t-card" data-testid="briefing-excerpt" id="briefing" aria-label="Briefing">
          <h2 className="t-section-h">Briefing</h2>
          <p className="t-headline">{brief.headline ?? brief.summary}</p>
          {summary && (
            <div data-testid="briefing-summary">
              <div className="t-k">1-minute summary</div>
              {summary.so_what && <div className="t-row-sub">{summary.so_what}</div>}
              {Array.isArray(summary.bullets) && <ul>{summary.bullets.map((b: string, i: number) => <li key={i}>{leadOf(b)}</li>)}</ul>}
              {!summary.bullets && summary.body && <div className="today-4">{summary.body}</div>}
            </div>
          )}
          {rest.length > 0 && (
            <button className="t-link" onClick={() => setFullBrief(!fullBrief)} aria-expanded={fullBrief} data-testid="briefing-more">
              {fullBrief ? "Show less ▴" : "Show full briefing ▾"}
            </button>
          )}
          {fullBrief && <div data-testid="briefing-full">{rest.map((sec: any, i: number) => renderSection(sec, i))}</div>}
        </section>
      )}
      {brief?.reason && !brief.headline && (
        <section className="t-card" aria-label="Briefing"><h2 className="t-section-h">Briefing</h2><div className="t-row-sub">{brief.reason}</div></section>
      )}

      {/* 3. SPIRIT — the exact lunation block the Spirit page builds. */}
      <section className="t-card" data-testid="spirit-card" aria-label="Spirit">
        <h2 className="t-section-h">Spirit</h2>
        {lunation ? <LunationBlock lunation={lunation} advisory={false} /> : <div className="t-row-sub">The sky is on the Spirit page.</div>}
        <button className="t-link" onClick={() => go("/?tab=spirit")}>Open Spirit for more ›</button>
      </section>

      {/* 4. COACHING — her 1:1: one question from what is going on, and the talk. */}
      {q && (
        <section className="t-card coach-card" data-testid="coach-card" aria-label="Coaching">
          <h2 className="t-section-h">Coaching</h2>
          <div className="t-k">Today&apos;s question · picked from your week</div>
          <p className="coach-q" data-testid="coach-question">{q.question}</p>
          <div className="t-actions">
            <button className="done-btn send-btn" onClick={() => setCoach(coachPhase())} data-testid="coach-talk">💬 Talk it through (1:1)</button>
          </div>
          {focusC?.law && <div className="t-row-sub law-line" data-testid="law-line">Law {focusC.law.n} · {focusC.law.title}: {focusC.law.text}</div>}
        </section>
      )}

      <div className="t-below">
        <details data-testid="coming-up">
          <summary>
            Coming up · {meetings?.diary_summary?.startsWith("Nothing today") || !next ? "nothing today" : ""}
            {next ? ` next ${new Date(next.scheduled_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}, ${next.title}` : ""} · Show ▾
          </summary>
          {meetings && <Diary content={{ ...meetings, diary: diaryRows, calendar: null }} onChanged={() => void load()} onError={setError} />}
        </details>
        {done.length > 0 && (
          <details data-testid="done-for-you">
            <summary>Done for you ({doneLines(done).length}) · tap to show ▾</summary>
            {doneLines(done).map((d, i) => (
              <button key={i} className="row mi-row" onClick={() => d.id && go(morningHref(morning.day, d.id))}>
                <span className="row-main"><span className="row-title">{d.text}</span></span>
                <span className="row-val">Open ›</span>
              </button>
            ))}
          </details>
        )}
      </div>

      {coach && (
        <Sheet title={coach === "evening" ? "🌙 Evening coaching" : "☀ Morning coaching"} onClose={() => { setCoach(null); void loadList(); }} testId="coach-sheet">
          <Coaching phase={coach} onTalked={() => void loadList()} opening={list?.coach_question?.question ?? null} />
        </Sheet>
      )}
      {sheet?.kind === "edit" && (
        <Sheet title="Edit gate" onClose={() => setSheet(null)} testId="edit-sheet">
          <GateEditor gate={sheet.gate} items={sheet.items} onClose={() => setSheet(null)} onError={setError}
            onSaved={(l) => { setList(l); onNeedsYou?.(l.needs_you); setSheet(null); }} />
        </Sheet>
      )}
      {sheet?.kind === "create" && (
        <Sheet title="+ Create a gate" onClose={() => setSheet(null)} testId="create-sheet">
          <GateCreator onError={setError} onSaved={(l) => { setList(l); setSheet(null); }} />
        </Sheet>
      )}
      {sheet?.kind === "add" && (
        <Sheet title="+ Add to today" onClose={() => setSheet(null)} testId="add-sheet">
          <AddToToday onError={setError} onSaved={() => { setSheet(null); void loadList(); }} />
        </Sheet>
      )}
    </>
  );
}

/** "Read the full briefing ›": the whole report, word for word, on its own page, with its run button. */
export function BriefingPage() {
  const [block, setBlock] = useState<Block | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { const p = await api.todayBlocks(["executive_briefing"]); setBlock(p.blocks[0] ?? null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!block) return error ? <ErrorNotice error={error} /> : <Loading />;
  return <BlockCard block={block} onChanged={load} onError={setError} open />;
}

/**
 * SYSTEM HEALTH, OFF TODAY (owner, 31 Oct 2026). Critical alerts, the team's roll call, continuity
 * and trading moved here from Today, with every button they had (Mark resolved, Dismiss, Refresh).
 * A real alarm still shows on Today as a thin red banner that links here.
 */
export function SystemHealth({ onOpenOperations }: { onOpenOperations?: () => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    const groups = TODAY_GROUPS.filter((g) => g.includes("critical_alerts") || g.includes("approval_inbox"));
    const settled = await Promise.allSettled(groups.map((g) => api.todayBlocks(g)));
    const good = settled.filter((r): r is PromiseFulfilledResult<Payload> => r.status === "fulfilled").map((r) => r.value);
    setBlocks(good.flatMap((p) => p.blocks).filter((b) => b.key !== "approval_inbox").sort((a, b) => a.order - b.order));
    const bad = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(bad ? bad.reason : null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div data-testid="system-health">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <OperationsLine onOpen={onOpenOperations ?? (() => go("/?tab=team&team=duties"))} />
      {blocks.map((b) => <BlockCard key={b.key} block={b} onChanged={load} onError={setError} />)}
    </div>
  );
}


/**
 * The two "when relevant" elements disappear when they are not relevant, which
 * is what canon means by them. Everything else is always present, because an
 * element that vanishes when empty makes it impossible to tell "nothing today"
 * from "the screen forgot".
 */
/**
 * THE BRIEFING HAS A BUTTON (1 Oct 2026). "There is no button to retry or re-run briefing in Boss OS." A briefing that failed, never
 * searched, or was written by a lane she did not want could only be fixed by waiting for 06:00 tomorrow. This fires the Executive
 * Intelligence Report duty now, through the route that already existed, and says in words what happened: queued, or why not. It sits
 * on the card itself rather than behind "Open", because the card with NO report is exactly the one that has nothing to open.
 */
const BRIEFING_DUTY_ID = "duty_exec_intel";

function RunBriefingNow({ hasReport, runStatus, onChanged }: { hasReport: boolean; runStatus: string | null; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await api.runDutyNow(BRIEFING_DUTY_ID);
      setSaid(
        r.fired
          ? "Queued. Your Mac picks it up on its next check; reload Today when it lands. If it fails, this card will say why."
          : (r.note ?? `Not queued: ${r.reason ?? "no reason recorded"}.`),
      );
    } catch (e) {
      setSaid(e instanceof Error ? `Could not queue it: ${e.message}` : "Could not queue it.");
    } finally {
      setBusy(false);
      // Re-read the day so the status line above the button shows the run just queued, without a reload.
      try { await onChanged(); } catch { /* the sentence above already said what happened */ }
    }
  };
  return (
    <div style={{ marginTop: 8 }}>
      {runStatus && <div className="row-sub" style={{ marginBottom: 6 }} data-testid="briefing-run-status">{runStatus}</div>}
      <button type="button" className="btn" data-testid="run-briefing-now" disabled={busy} onClick={run}>
        {busy ? "Queuing…" : hasReport ? "Run the briefing again" : "Run the briefing now"}
      </button>
      {said && <div className="row-sub" style={{ marginTop: 6 }} data-testid="run-briefing-now-said">{said}</div>}
    </div>
  );
}

function BlockCard({ block, onChanged, onError, open = false }: {
  block: Block;
  open?: boolean;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const conditional = block.key === "continuity_status" || block.key === "trading_status";
  if (conditional && block.content?.relevant === false) return null;

  const summary = summarise(block);
  const detail = renderDetail(block, onChanged, onError);

  return (
    <div className="docket" id={block.key === "executive_briefing" ? "briefing" : undefined} style={{ paddingBottom: detail ? 14 : 12 }}>
      {/*
        * ── THE NUMBER IS GONE ────────────────────────────────────────────────
        *
        * She pasted what this card actually showed her: "medium / 07 / Spirit Signal / 08". Two of
        * those four lines were `block.order` — an index into a list she never asked to have ordered,
        * printed at her because it was convenient for the system. She is not the audience for it.
        */}
      <div className="docket-head">
        <h3 style={{ margin: 0 }}>{block.title}</h3>
      </div>
      {/*
        * AND A SECTION THAT SAYS NOTHING IS THE DEFECT. `summarise()` fell through to "" for any
        * block with no case, which is how Spirit Signal came to be a label between two numbers. It
        * has no empty return any more, and `tests/boss/everySectionSpeaks.test.ts` fails the build
        * if a block is ever added without one.
        */}
      <p style={{ marginTop: 6 }}>{summary}</p>
      {block.key === "executive_briefing" && <RunBriefingNow hasReport={Boolean(block.content?.sections || block.content?.summary)} runStatus={block.content?.run_status ?? null} onChanged={onChanged} />}
      {detail && (
        <details open={open || undefined}>
          <summary className="docket-more" style={{ cursor: "pointer" }}>Tap to open ▾</summary>
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
    /*
     * PROPOSED AND AGREED READ DIFFERENTLY, and both are a day rather than a demand.
     *
     * "The Morning Gate has not run. Today has no contract yet." was the first line on this screen
     * every morning she had not pressed the button — an OS telling its owner it declines to say
     * what the day is until she asks it twice. The day is derived on read now; this line says the
     * day, and whether she has agreed to it.
     */
    case "todays_contract":
      if (!c.contract) return c.reason;
      return c.state === "proposed"
        ? `${c.contract.commitment} — proposed. ${c.contract.priorities.length} priorit${c.contract.priorities.length === 1 ? "y" : "ies"} derived from your projects.`
        : `${c.contract.priorities.length} priorit${c.contract.priorities.length === 1 ? "y" : "ies"} agreed${c.contract.commitment ? ` — ${c.contract.commitment}` : ""}.`;
    case "executive_briefing":
      // The report, or an honest account of why there is not one. "Nothing to report" was the old
      // block's line and it is now a lie in two directions: the world always has something, and a
      // missing report is a fact about this system rather than about the news.
      if (c.reason) return c.reason;
      /*
       * ONE LINE, AND IT IS THE ANSWER. Her instruction: "the way it is formmated now is for a
       * machine not for a human eyes." The collapsed block shows exactly this string, and it used
       * to be a five-sentence summary of stacked figures. `headline` is one line by contract; the
       * summary is the fallback for reports written before that column existed.
       *
       * THE GAP COUNT STAYS ON THE COLLAPSED LINE. It is the one caveat that must survive being
       * shortened — a briefing that reads well because it hid what it could not verify is worse
       * than the one it replaced.
       */
      const gapCount = (c.gaps ?? []).length;
      return [
        // Yesterday's briefing shown in place of one that has not arrived says so FIRST. A stale
        // report presented as current is worse than no report; a stale report that admits it is
        // better than a blank.
        c.carried_over ? `Yesterday (${c.for_day}) ·` : null,
        c.headline ?? c.summary ?? "Report delivered.",
        gapCount > 0 ? `· ${gapCount} unverified.` : null,
      ].filter(Boolean).join(" ");
    case "day_flow":
      // Her blocks, and the word is "blocks" because that is what her contract calls them. "Stages"
      // was the machine's vocabulary for the machine's list.
      return `${c.complete} of ${c.total} blocks done.`;
    case "coaching_focus":
      return `${c.mode}. Law ${c.law?.n}: ${c.law?.title}.`;
    case "daily_thinking_lens":
      return `${c.track}.`;
    case "meetings": {
      /*
       * THE COLLAPSED LINE COMES FROM THE SERVER, COMPUTED FROM THE ROWS THE BODY RENDERS.
       *
       * It used to count `c.total` — the CRM meetings table, always empty — and say "Nothing in the
       * diary" over a section that opened onto a full agenda. A summary derived from a different
       * source than the body will eventually contradict it, and this one did. `diary_summary` is
       * built in `today/diary.ts` from the same array, so they cannot disagree.
       */
      const parts: string[] = [c.diary_summary ?? "The diary could not be read."];
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
      /*
       * THE SUMMARY ANSWERS "DOES ANYONE NEED ME", which three counts of employment status never
       * did. The counts stay — they were the one part of this block that was always correct — but
       * they follow the verdict rather than standing in for it.
       */
      return (
        (c.needing_you ? `${c.needing_you} employee${c.needing_you === 1 ? "" : "s"} need${c.needing_you === 1 ? "s" : ""} you. ` : "Everyone is on schedule. ") +
        `${c.by_status?.active ?? 0} active, ${c.by_status?.paused ?? 0} paused, ${c.by_status?.retired ?? 0} retired.`
      );
    case "continuity_status":
      return c.note;
    case "trading_status":
      return c.kill_switch
        ? "Kill switch engaged. Nothing in that lane executes."
        : `${c.open_positions} open position${c.open_positions === 1 ? "" : "s"}${c.open_incidents?.length ? `, ${c.open_incidents.length} open incident${c.open_incidents.length === 1 ? "" : "s"}` : ""}.`;

    /*
     * ── SPIRIT SIGNAL, AS A SENTENCE RATHER THAN A LABEL ─────────────────────
     *
     * She pasted the whole of what this card showed her:
     *
     *     medium
     *     07
     *     Spirit Signal
     *     08
     *
     * and said "this is not helpful and needs to be explicit in that area". She was right about all
     * of it. There was no `case` here, so `summarise` returned "" and the card rendered a category
     * name between two list indices — a label, not a statement, with nothing saying what it is or
     * what she should do with it.
     *
     * THE MATERIAL EXISTED THE WHOLE TIME. `spirit/day.ts` composes `note` from the computed sky and
     * her real records and hands back `reality_priority` — canon §5.2's rule that a day where
     * something is actually broken says so FIRST and the sky is context. None of it reached this
     * surface.
     *
     * So: what it is, then what it means for today, then the classification last.
     */
    case "spirit_signal": {
      const moon = c.moon
        ? `${c.moon.phase?.replace(/_/g, " ") ?? "moon"}${c.moon.sign ? ` in ${c.moon.sign}` : ""}${c.moon.cusp ? `, on the cusp of ${c.moon.next_sign}` : ""}`
        : null;
      /*
       * THE EVENT LEADS THE COLLAPSED LINE. "New Moon in Virgo — tomorrow" is the sentence she wants
       * to see first on a day when one is coming; the phase and the windows are context under it.
       */
      const major = c.major_event ?? null;
      const majorWhen = major
        ? (() => {
            const days = Math.round((major.at - Date.now()) / 86_400_000);
            const time = new Date(major.at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
            return days <= 0 ? `today at ${time}` : days === 1 ? `tomorrow at ${time}` : `in ${days} days`;
          })()
        : null;
      const parts: string[] = [];
      /*
       * REALITY FIRST, WHICH IS CANON RATHER THAN A PREFERENCE. §5.2: if something is actually
       * broken today, that leads and the sky is context underneath it.
       *
       * ── AND IT PRINTED `[object Object]` ON HER DAILY SCREEN ────────────────
       *
       * `reality_priority` is `{ warning, text, counts, rule }` — it has been an OBJECT since
       * `spirit/day.ts` was written — and this pushed the whole thing into an array of strings.
       * The card read "[object Object] Advisory only. The sky is context, never a cause…" every
       * morning. It is the second defect in this one block in a day; the first fix gave it a
       * sentence and reached straight past the shape of the value it was reading.
       *
       * NOTHING TYPED CAUGHT IT because `c` is `any` here, which is why the sentence is now built
       * from a named field with an explicit string check rather than from whatever arrives. A value
       * that is not a string is a NAMED absence, never a stringified one: printing a JavaScript
       * artifact at her tells her nobody looks at this screen, which is worse than printing nothing.
       *
       * AND IT LEADS ONLY WHEN IT IS A WARNING. `text` is also written for the calm case ("Nothing
       * operational is waiting"), and leading every quiet day with that is a sentence she learns to
       * skip — which is how the real one stops being read on the day it matters.
       */
      /*
       * AND THE OPERATIONAL SCOLD IS GONE FROM HERE TOO. Her instruction was about the Spirit tab,
       * and this block is the same content on Today — leaving it in one place and not the other is
       * how two components come to disagree. The failed-task count it carried is already a Critical
       * Alert on this very screen, checked rather than assumed, so nothing is lost by removing it.
       *
       * The line above it read `parts.push(c.reality_priority)` on an OBJECT and printed
       * "[object Object]" on her daily screen every morning. Both defects leave together.
       */
      if (major) parts.push(`${major.label} — ${majorWhen}.`);
      if (c.note) parts.push(c.note);
      else if (moon) parts.push(`The sky today: ${moon}.`);
      if (c.windows?.length) {
        parts.push(`${c.windows.length} window${c.windows.length === 1 ? "" : "s"} open — timing worth using rather than fighting.`);
      }
      if (c.rituals_due?.length) parts.push(`${c.rituals_due.length} ritual${c.rituals_due.length === 1 ? "" : "s"} due.`);
      /*
       * ADVISORY, SAID OUT LOUD. The block has carried `advisory: true` since it was built and
       * never showed it. It is context for a decision she makes, never an instruction, and a
       * screen that does not say so invites the opposite reading.
       */
      parts.push("Context for the day, never an instruction. Ignoring it costs nothing and nothing is scored on it.");
      return parts.join(" ");
    }

    /*
     * NO EMPTY DEFAULT. Returning "" is what produced a section that said nothing at all, and a
     * block added later would inherit the same silence. A named absence is the floor.
     */
    default:
      return `${block.title} has no summary written for it yet, which is a gap in this screen rather than a quiet day.`;
  }
}

/**
 * `**like this**` becomes bold, and nothing else is interpreted.
 *
 * KEPT, THOUGH NOTHING IS ASKED TO EMIT IT ANY MORE. 0205's prompt told the run to bold the key
 * phrase in EVERY bullet, and when every bullet contains bold the bold marks nothing — worse, it
 * competed with the section heading, so the loudest thing on the screen was a phrase in the middle
 * of a sentence. That is her "some bold stuff that i feel like should not be", and migration 0223
 * stops asking for it: weight belongs to hierarchy now. Every report already written still carries
 * the asterisks, so this function stays exactly as it is or a month of history renders as
 * punctuation noise.
 *
 * DELIBERATELY NOT A MARKDOWN PARSER. This text comes from a research run that reads the open web,
 * so it is untrusted by construction. Splitting on a delimiter and emitting <strong> around
 * alternate pieces cannot produce markup of any kind — a full renderer would be the place an
 * injected link or image got in.
 */
function bold(text: string) {
  const parts = String(text).split(/\*\*/);
  return parts.map((piece, i) => (i % 2 === 1 ? <strong key={i}>{cited(piece, i)}</strong> : <span key={i}>{cited(piece, i)}</span>));
}

/**
 * `[3]` and `[3, 7]` become superscript citation marks pointing at the numbered source list.
 *
 * STILL NOT A MARKDOWN PARSER. The only thing recognised is digits inside square brackets, and the
 * only thing emitted is a <sup> with an in-page anchor — nothing from the text becomes an attribute.
 * The file's report cites every figure this way; a number she can trace to its source in one tap
 * is the whole difference between a briefing and a rumour.
 */
function cited(text: string, keyBase: number) {
  const pieces = String(text).split(/(\[\d{1,3}(?:\s*,\s*\d{1,3})*\])/);
  return pieces.map((piece, j) => {
    const m = /^\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]$/.exec(piece);
    if (!m) return <span key={`${keyBase}-${j}`}>{piece}</span>;
    const refs = m[1]!.split(",").map((n) => n.trim());
    return (
      <sup key={`${keyBase}-${j}`} className="brief-ref">
        {refs.map((n, k) => (
          <a key={k} href={`#brief-src-${n}`} title={`Source ${n}`}>{n}</a>
        ))}
      </sup>
    );
  });
}

/**
 * One briefing section: the heading, what it means for her, then the evidence.
 *
 * BOTH SHAPES RENDER. `{heading, so_what, bullets}` is 0205's contract; `{heading, body}` is what
 * every report written before it carries. A format change that made historical days render empty
 * would look exactly like a regression on the screen it was meant to fix.
 */
function renderSection(sec: any, i: number, insight?: any) {
  return (
    <div key={i} style={{ marginBottom: 12 }}>
      {/*
        * THE HEADING OUTRANKS ITS OWN CONTENT, WHICH IT DID NOT.
        *
        * This line was `<p className="eyebrow">` — 11px, `--muted` — directly above a `.row-title`
        * that is heavier and full ink. Every briefing section was headed by something quieter than
        * the sentence beneath it. `.today-2` is level 2 of the one scale both blocks on this page
        * now draw from; `.today-4` is body. The order is structural and cannot invert.
        */}
      <p className="today-2">{sec.heading ?? `Section ${i + 1}`}</p>
      {/* What she should DO or watch because of it, before the evidence for it. */}
      {sec.so_what && <div className="today-4">{sec.so_what}</div>}
      {/*
        * WHAT THIS SECTION LOST, SAID ON THE SECTION. An uncited figure never reaches her — that is
        * the $72 rule — but the line that carried it disappearing in silence would be the same
        * defect in a smaller box, so the section says how much it dropped and why.
        */}
      {sec.dropped_for_sourcing > 0 && (
        <p className="brief-absent">
          {sec.dropped_for_sourcing} line{sec.dropped_for_sourcing === 1 ? "" : "s"} dropped here — {sec.dropped_for_sourcing === 1 ? "it" : "they"} carried figures with no source.
        </p>
      )}

      {/* §5's Top 5 Headlines: each one a fact, why it matters, and an importance score. */}
      {Array.isArray(sec.items) && sec.items.length > 0 && (
        <div>
          {sec.items.map((it: any, j: number) => (
            <div key={j} style={{ marginBottom: 8 }}>
              <p className="today-3">{typeof it === "string" ? it : it.headline ?? it.title ?? `Item ${j + 1}`}</p>
              {typeof it === "object" && it.summary && <div className="today-4">{bold(String(it.summary))}</div>}
              {/*
                * THE DATA BLOCK. The file's headlines each carry the numbers that make them a story
                * — "First-half revenue $140.6 million, +1,252% [2]" — set apart from the prose so
                * the eye finds them first. Each line carries its own [n].
                */}
              {typeof it === "object" && Array.isArray(it.numbers) && it.numbers.length > 0 && (
                <ul className="brief-numbers">
                  {it.numbers.map((n: string, k: number) => <li key={k} className={k === 0 ? "brief-keyfigure" : undefined}>{bold(String(n))}</li>)}
                </ul>
              )}
              {/* SpaceX Watch files its parts as items with bullets: SPCX, the reference map, Starship, Starlink, supply. */}
              {typeof it === "object" && Array.isArray(it.bullets) && it.bullets.length > 0 && (
                <ul className="brief-list">
                  {it.bullets.map((b: string, k: number) => <li key={k}>{bold(String(b))}</li>)}
                </ul>
              )}
              {typeof it === "object" && it.why_it_matters && (
                <p className="brief-why">Why it matters — {bold(String(it.why_it_matters))}</p>
              )}
              {typeof it === "object" && it.importance && (
                <p className="brief-score">Investor importance {String(it.importance)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        * §5's Markets & Macro Dashboard is a TABLE or it is absent. §2.1 forbids inventing market
        * data and she is a registered rep who trades on this, so a dashboard with no verified rows
        * renders nothing here and is named in what-is-missing instead.
        */}
      {sec.table && Array.isArray(sec.table.rows) && sec.table.rows.length > 0 && (
        <div className="brief-tablewrap">
          {sec.table_built_by === "system" && (
            <p className="brief-cite">Figures fetched by the system from the feeds in the source list, not typed by the run.</p>
          )}
          <table className="brief-table phone-cards">
            {Array.isArray(sec.table.columns) && sec.table.columns.length > 0 && (
              <thead>
                <tr>{sec.table.columns.map((col: string, j: number) => <th key={j}>{col}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {sec.table.rows.map((row: any, j: number) => (
                <tr key={j}>
                  {(Array.isArray(row) ? row : [row]).map((cell: any, k: number) => <td key={k} data-label={Array.isArray(sec.table.columns) ? sec.table.columns[k] : undefined}>{String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Array.isArray(sec.bullets) && sec.bullets.length > 0 ? (
        <ul className="brief-list">
          {sec.bullets.map((b: string, j: number) => (
            <li key={j}>{bold(b)}</li>
          ))}
        </ul>
      ) : (
        sec.body && <div className="today-4">{bold(String(sec.body))}</div>
      )}

      {/*
        * ─── THE INVESTOR INSIGHT, WHICH IS TEACHING RATHER THAN COMMENTARY ───
        *
        *   "u r also supposed to use the intelligence of the LLM to develop an investor insights
        *    section to help me learn how to think about the stuff im reading....."
        *
        * The spec already mandated a synthesis, and every one of its examples is a CONCLUSION. She
        * is asking for the reasoning that reaches it, so she can make the move herself on
        * tomorrow's news without the report. Four parts, and each is a different kind of claim:
        * the pattern, the move that found it, the frame to reuse, and what would break it.
        *
        * IT IS WITHHELD WHEN IT IS NOT GROUNDED. The worker checks that every fact it joins appears
        * elsewhere in today's own report; reasoning is fabricable in a way that reads like insight,
        * and a pattern manufactured out of a thin news day is a horoscope with a Bloomberg accent.
        */}
      {sec.key === "investor_insight" && insight && (
        insight.grounded && insight.insight ? (
          <div className="brief-insight">
            <p className="today-3">{insight.insight.synthesis}</p>
            {insight.insight.how_reached && (
              <div className="brief-insight-part">
                <p className="brief-insight-l">How it was reached</p>
                <div className="today-4">{insight.insight.how_reached}</div>
              </div>
            )}
            {insight.insight.transferable_frame && (
              <div className="brief-insight-part">
                <p className="brief-insight-l">Ask this next time</p>
                <div className="today-4">{insight.insight.transferable_frame}</div>
              </div>
            )}
            {insight.insight.falsified_by && (
              <div className="brief-insight-part">
                <p className="brief-insight-l">What would break it</p>
                <div className="today-4">{insight.insight.falsified_by}</div>
              </div>
            )}
            {(insight.insight.cites ?? []).length > 0 && (
              <div className="brief-insight-part">
                <p className="brief-insight-l">Built from</p>
                <ul className="brief-list">
                  {insight.insight.cites.map((cite: any, j: number) => (
                    <li key={j} className="brief-cite">{cite.fact}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          insight.withheld_because && <p className="brief-absent">{insight.withheld_because}</p>
        )
      )}
    </div>
  );
}

function renderDetail(
  block: Block,
  onChanged: () => void | Promise<void>,
  onError: (e: unknown) => void,
) {
  const c = block.content ?? {};
  if (c.available === false) return null;

  switch (block.key) {
    /*
     * THE MORNING AGENDA, WHICH IS NOW ON THE SCREEN BEFORE SHE TOUCHES ANYTHING.
     *
     * Her words: "i should get a morning agenda each day without doing anything what the fuck?!"
     * The four Pillar Contracts were being derived the whole time and only inside the gate handler,
     * so they existed and nothing showed them. Each one names WHAT it means in her language and
     * WHO owns it, because a pillar whose name needs a canon section to decode is one she skips.
     */
    case "todays_contract": {
      /*
       * ── THE HEADER, WHICH ANSWERS THE FOUR THINGS SHE HAD TO ASK ────────────
       *
       * Rendered even when the contract itself failed to derive, because a screen with no date
       * cannot tell her whether she is looking at today, a stale render, or yesterday — and "what
       * happens to yesterday, it just disappears?" needs an answer on a broken morning most of all.
       */
      const header = <ContractHeader content={c} />;
      if (!c.contract) return header;
      const pillars = c.agenda?.pillars ?? null;
      /*
       * ─── THE AGENDA, DIVIDED BY PILLAR ─────────────────────────────────────
       *
       * Her specification, verbatim, 8 September 2026: "'today's contract' is supposed to be my
       * fucking agenda for the day divided by pillar and with my gratitude sentence mirrored there
       * and with my morning movement (either the actual movements or a link to them)".
       *
       * All three of those existed and none of them was on this screen.
       *
       *   · The four Pillar Contracts were derived inside the Morning Gate handler and nowhere else.
       *   · `spirit.action` IS the gratitude sentence, composed from her own record by
       *     `spirit/practice.ts`, and this block rendered it as an unlabelled row title.
       *   · `body.launch_sequence` is §6.9's stored morning sequence — five NAMED movements,
       *     "print this exactly, in order" — and `body.somatic` is five more, one per lane, each
       *     chosen as the least recently used and each carrying why. Twenty lines of real content
       *     that had never been on any screen.
       *
       * NOTHING HERE IS INVENTED. Every movement below is one she wrote down; the system chooses
       * which somatic one comes up today from `movement_log`, deterministically, and says why.
       */
      const gratitudeMissing = pillars?.spirit && pillars.spirit.available === false;
      return (
        <>
          {header}
          {c.agenda?.warning && <div className="notice" style={{ borderColor: "var(--gold)" }}>{c.agenda.warning}</div>}

          {/*
            * BODY — keto, movement, discipline. Imani.
            * The movements themselves, because "morning movement" as a label with nothing under it
            * is the exact failure she is describing everywhere else in this system.
            */}
          {pillars?.body && (
            <>
              <p className="pillar">Body — movement, food, discipline <span className="pillar-who">Imani</span></p>
              {/*
                * THE KINDS ARE TOLD APART, which they were not.
                *
                * "i need to make sure i can delineate between movment and etc..."
                *
                * Ten fields rendered as one run: the floor, five launch movements, five somatic
                * lanes, medicine, water, food and the safety stop, all at the same weight. Medicine
                * is non-negotiable and time-boxed, the safety stop is a STOP, and both read as more
                * exercises. `BodyContract.tsx` groups them into movement, intake, medical and stop,
                * and a registry there is checked against the payload's own interface so a field
                * added later cannot fall out of her morning unnoticed.
                */}
              <BodyContractView body={pillars.body} onChanged={() => void onChanged()} />
            </>
          )}

          {/*
            * SPIRIT — the sentence, MIRRORED here rather than moved. Spirit remains its home and
            * its source of truth; she should not have to navigate to read her own sentence.
            */}
          {pillars?.spirit && (
            <>
              <p className="pillar">Spirit — the sentence and the sequence <span className="pillar-who">Imani</span></p>
              {gratitudeMissing ? (
                <div className="row-sub">
                  {pillars.spirit.gap ?? "Today's sentence could not be composed from your record."}
                  {" "}It is written on Spirit — a generic mantra is worse than none, so nothing is filled in for you.
                </div>
              ) : (
                /*
                 * THE SENTENCE, AT THE WEIGHT OF A SENTENCE. It was 17px inline and read as another
                 * paragraph; it is the one line of her day that is not an instruction.
                 */
                <p className="sentence">{pillars.spirit.action}</p>
              )}
              <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {(pillars.spirit.detail ?? []).map((step: string, i: number) => (
                  <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{step}</li>
                ))}
              </ol>
            </>
          )}

          {/* WEALTH — money in: buyers, LPs, and the people who send you both. Camille and Monique. */}
          {pillars?.wealth && (
            <>
              <p className="pillar">Wealth — the first money move <span className="pillar-who">Camille and Monique</span></p>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">{pillars.wealth.action}</div>
                  <div className="row-sub">{pillars.wealth.why}</div>
                  {pillars.wealth.gap && <div className="row-sub">Missing: {pillars.wealth.gap}</div>}
                </div>
              </div>
              {(pillars.wealth.detail ?? []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {pillars.wealth.detail.map((d: string, i: number) => (
                    <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* EXECUTION — did anything you own actually get built or shipped. Danielle. */}
          {pillars?.execution && (
            <>
              <p className="pillar">Execution — did anything you own ship <span className="pillar-who">Danielle</span></p>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">{pillars.execution.action}</div>
                  <div className="row-sub">{pillars.execution.why}</div>
                  {pillars.execution.gap && <div className="row-sub">Missing: {pillars.execution.gap}</div>}
                </div>
              </div>
              {(pillars.execution.detail ?? []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {pillars.execution.detail.map((d: string, i: number) => (
                    <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* The agreed contract has no derived pillars beside it — her answer, not a second one. */}
          {!pillars && (
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {c.contract.priorities.map((p: string, i: number) => <li key={i}>{p}</li>)}
            </ol>
          )}

          {c.note && <div className="row-sub" style={{ marginTop: 12 }}>{c.note}</div>}
        </>
      );
    }

    case "executive_briefing": {
      // No report is not an error state, so it renders as prose rather than a notice.
      if (!c.sections && !c.summary) return null;
      /*
       * ─── THE BRIEFING, FOR HER EYES ────────────────────────────────────────
       *
       * "the way it is formmated now is for a machine not for a human eyes. it needs to be
       * synthesized and summarized and formatted properly."
       *
       * It was rendering storage order: heading, paragraph, heading, paragraph, then a list of URLs
       * with ISO timestamps at the same visual weight as the content. THE ORDER IS THE ANSWER, THEN
       * WHAT IT MEANS, THEN THE EVIDENCE, and provenance goes behind a toggle.
       *
       * WHAT IS NOT COMPRESSED AWAY: gaps and corrections stay on the screen at full weight.
       * "I could not verify this" and "yesterday I told you the opposite" are decision-bearing, and
       * a briefing that reads beautifully because it dropped its caveats is worse than the one it
       * replaced. Only `sources` collapse — a URL list is what she reaches for when she doubts a
       * figure, not something she reads at 7am.
       *
       * BOTH SHAPES RENDER. Reports written before 0205 carry `{heading, body}` sections and no
       * headline; reports after it carry `{heading, so_what, bullets}`. A format change that made
       * every historical day render as empty would look exactly like a regression.
       */
      return (
        <>
          {c.staleness && <div className="row-sub" style={{ marginBottom: 10 }}>{c.staleness}</div>}
          {/*
            * "partial" SAYS WHICH. The word on its own sent her looking for what was wrong in a
            * report where nothing was — the status was being believed from the run rather than
            * derived, and four forward-looking notes had downgraded a complete morning.
            */}
          {c.status === "partial" && (c.shortfalls ?? []).length > 0 && (
            <div className="row-sub" style={{ marginBottom: 10 }}>
              Partial because: {(c.shortfalls ?? []).join(" ")}
            </div>
          )}

          {/*
            * THE EDITION. "Saturday, September 19, 2026 • Morning Edition • Central Time" and
            * "Information checked through 6:28 AM CT" — the file's framing, and the stamp is derived
            * from the evidence on the server rather than written by the run.
            */}
          {c.edition && (
            <p className="brief-edition">
              {c.edition.day_label} • {c.edition.edition_label}
              {c.edition.checked_through_label && <><br />{c.edition.checked_through_label}</>}
              {c.written_by?.label && <><br />Written by {c.written_by.label}{(c.written_by.refused_seats ?? []).length > 0 ? ` — after ${c.written_by.refused_seats.join(", ")} declined` : ""}</>}
            </p>
          )}
          {/* Level 1: the one line that IS the report if she reads nothing else. */}
          {c.headline && <p className="today-1">{c.headline}</p>}
          {c.summary && c.summary !== c.headline && <p className="today-4">{c.summary}</p>}

          {/*
            * ─── EVERY SECTION, IN §5's ORDER, INSIDE ITS OWN SCROLL ──────────
            *
            * "the executive breifing section is missing some sections (and u can make it
            * scrollable)...like major news (top 5 headlines) a one min summary section, markets
            * dashboard a tech section a cpaital markets secondary ipo m&A section....."
            *
            * The `slice(0, 4)` that stood here was a cap put on the WRONG END. It was written
            * because a run filed fourteen sections and the screen could not take them — but the
            * fourteen were thematic essays produced by a prompt that had been told to ignore §5,
            * and hiding ten of them behind a toggle solved the symptom by throwing away research
            * she paid for. §5's eleven sections are short and each has a job; the fix is that the
            * run files THOSE, which migration 0223 does, and that this block can hold them, which
            * is what the scroll is for. She asked for the scroll herself.
            */}
          <div className="brief-scroll">
            {(c.sections ?? []).map((sec: any, i: number) => renderSection(sec, i, c.insight))}

            {/*
              * ─── WHAT IS NOT HERE, AND WHY ─────────────────────────────────
              *
              * A section can never be silently absent. §2.1 — never invent market data — means an
              * absent Markets & Macro Dashboard is often the CORRECT outcome, and an empty one
              * filled with plausible numbers would be far worse; what she needs is to see that it
              * is absent and what the run said about it. This is also what makes `status: partial`
              * mean something she can see, instead of a short report that looks complete.
              */}
            {/*
              * WATCHING IS NOT A SHORTFALL. A report that wants Monday's launch outcome is correct,
              * not incomplete — so it reads as its own thing, in its own words, and never as an
              * absence. It was four of these that made a complete report call itself "partial".
              */}
            {/*
              * ONE LINE, NOT ELEVEN. A report written before per-section sourcing existed cannot
              * carry citations, and holding it to the rule emptied her screen the moment the rule
              * shipped. The fact is stated once, where five identical somatic reasons taught the
              * same lesson.
              */}
            {c.pre_rule_sources && (
              <p className="brief-absent">
                This briefing was written before figures carried their own source, so its numbers are
                not individually cited. Its source list is below.
              </p>
            )}

            {(c.watching ?? []).length > 0 && (
              <>
                <p className="today-2">Watching for — {(c.watching ?? []).length}</p>
                <ul className="brief-list">
                  {c.watching.map((w: any, i: number) => (
                    <li key={i} className="brief-cite">
                      {typeof w === "string" ? w : `${w.wanted ?? ""}${w.why ? ` — ${w.why}` : ""}`}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {(c.missing_sections ?? []).length > 0 && (
              <>
                <p className="today-2">Not in today&rsquo;s report — {(c.missing_sections ?? []).length}</p>
                <ul className="brief-list">
                  {c.missing_sections.map((m: any, i: number) => (
                    <li key={i} className="brief-cite"><strong>{m.title}</strong> — {m.why}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {(c.corrections ?? []).length > 0 && (
            <>
              {/*
                * CORRECTIONS ARE CONTENT, NOT APPARATUS. "Yesterday I told you the opposite" is the
                * single most decision-bearing thing a briefing can say — the 7 September run used it
                * to correct a standing assumption that a company was still private.
                */}
              <p className="today-2">Corrects an earlier report</p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {c.corrections.map((g: any, i: number) => (
                  <li key={i} style={{ marginBottom: 3, lineHeight: 1.45 }}>
                    {typeof g === "string" ? g : `${g.was ?? ""} → ${g.now ?? ""}${g.why ? ` (${g.why})` : ""}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(c.gaps ?? []).length > 0 && (
            <>
              <p className="today-2">Could not be verified — {(c.gaps ?? []).length}</p>
              <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {c.gaps.map((g: any, i: number) => (
                  <li key={i} className="row-sub" style={{ marginBottom: 2 }}>
                    {typeof g === "string" ? g : `${g.wanted ?? g.what ?? JSON.stringify(g)}${g.why ? ` — ${g.why}` : ""}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            * PROVENANCE, NUMBERED, AND REACHABLE FROM EVERY [n] IN THE TEXT. The file ends with a
            * numbered footnote list of real URLs; each `[n]` above is an anchor to its row here.
            * Open by default now — she asked for the sourcing to be visible, not tucked away.
            */}
          {(c.sources ?? []).length > 0 && (
            <details open>
              <summary className="docket-more" style={{ cursor: "pointer" }}>
                {c.sources.length} source{c.sources.length === 1 ? "" : "s"}, numbered, with when each was read
              </summary>
              <ol className="brief-sources">
                {c.sources.map((src: any, i: number) => (
                  <li key={i} id={`brief-src-${i + 1}`} className="row-sub">
                    {typeof src === "string"
                      ? src
                      : <>
                          {src.url ? <a href={String(src.url)} target="_blank" rel="noreferrer noopener">{src.name ?? src.url}</a> : (src.name ?? "unnamed")}
                          {src.read_at ? ` · read ${src.read_at}` : ""}
                        </>}
                  </li>
                ))}
              </ol>
            </details>
          )}

          {/* The absolute final line of every report, appended by the system. Nothing renders after it. */}
        </>
      );
    }

    /*
     * THE RUN OF SHOW.
     *
     * A block a gate closed is shown as closed and is NOT tappable — re-ticking something the
     * Morning Gate already recorded would let her produce two different stories about the same
     * morning. The three blocks no gate can speak for are hers, and they are the ones that respond
     * to a tap.
     */
    case "day_flow": {
      /*
       * The toggle calls the API here rather than being threaded down as a prop, which is how the
       * other interactive blocks on this screen already work — `onChanged` re-reads Today, so the
       * count in the summary line and the block state can never disagree.
       */
      const toggle = async (key: string, done: boolean) => {
        try {
          await api.runOfShowBlock(key, { done });
          await onChanged();
        } catch (e) { onError(e); }
      };
      return (
        <>
          {(c.blocks ?? []).map((b: any) => {
            const mine = b.closedBy === null;
            return (
              <div
                className={mine ? "row row-tap" : "row"}
                key={b.key}
                role={mine ? "button" : undefined}
                tabIndex={mine ? 0 : undefined}
                aria-pressed={mine ? b.done : undefined}
                onClick={mine ? () => void toggle(b.key, !b.done) : undefined}
                onKeyDown={mine ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggle(b.key, !b.done); } } : undefined}
              >
                <div className="row-main">
                  <div className="row-title">{b.done ? "✓" : "○"} {b.title}</div>
                  <div className="row-sub">{b.instruction ?? b.intent}</div>
                </div>
                <div className="row-val">
                  {b.done ? time(b.done_at) : mine ? "tap" : "—"}
                </div>
              </div>
            );
          })}
          {(c.midday_checks ?? []).map((chk: any, i: number) => (
            <div className="row-sub" key={i}>{chk.done ? "✓" : "○"} {chk.text}</div>
          ))}
          {/* §15.5's conflict rule, on the screen rather than only in the schema. */}
          <p className="row-sub">{c.conflict_rule}</p>
        </>
      );
    }

    /*
     * BLOCKS 08 AND 09. Both spent the whole port rendering "awaiting substrate"; both now say what
     * they chose AND why, because a focus that cannot name its evidence is a horoscope.
     */
    case "coaching_focus":
      return (
        <>
          <div className="row">
            <div className="row-main">
              <div className="row-title">{c.mode}</div>
              <div className="row-sub">{c.because}</div>
            </div>
          </div>
          {(c.rules ?? []).map((r: string, i: number) => (
            <div className="row-sub" key={i}>{r}</div>
          ))}
          <p className="eyebrow">Law {c.law?.n} — {c.law?.title}</p>
          <p className="row-sub">{c.law?.text}</p>
          <p className="row-sub">{c.law?.because}</p>
        </>
      );

    case "daily_thinking_lens":
      return (
        <>
          <div className="row">
            <div className="row-main">
              <div className="row-title">{c.track}</div>
              <div className="row-sub">{c.purpose}</div>
            </div>
          </div>
          {(c.prompts ?? []).map((q: string, i: number) => (
            <div className="row-sub" key={i}>{q}</div>
          ))}
          <p className="row-sub">{c.note}</p>
        </>
      );

    case "meetings":
      /*
       * ── A DIARY, NOT A PACKET READER ──────────────────────────────────────
       *
       * "this meetings tab needs work. it says Nothing in the diary when the meeting tab is closed
       * then u open to all this stuff. this stuff is unnecessary. this tab is suppose to show what
       * meetings i have upcoming."
       *
       * Two defects and the first is the one this repository keeps producing. The collapsed line
       * counted `c.meetings` — the CRM table, always empty — while the body rendered the whole
       * Wednesday packet, so the section said "Nothing in the diary" and opened onto a full agenda.
       * Both sentences were true about the thing each was looking at. Together they were a lie.
       *
       * The packet is not rendered here at all now. It lives at one permanent URL and the row that
       * has one carries the link: "if there is a packet or deliverable for a meeting i should see
       * that in a link". The CRM meetings, the held-and-uncaptured ones and the overdue touches
       * still render below, because they are also things she has coming up and a second screen for
       * them would be the two-lists defect.
       */
      return (
        <>
          {c.intent && <div className="row-sub"><em>{c.intent}</em></div>}
          <Diary content={c} onChanged={onChanged} onError={onError} />
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
      );

    case "open_loops":
      return <Loops loops={c.loops ?? []} onChanged={onChanged} onError={onError} />;

    case "critical_alerts":
      return <Alerts content={c} onChanged={onChanged} onError={onError} />;

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
      /*
       * ─── EVERY EMPLOYEE, WITH A VERDICT AND THE REASON FOR IT ──────────────
       *
       * "the ai employee status section does not have an accurate list of who is on duty and there
       * prob needs to be better UX showing a green dot showing they are working correctly when they
       * are and that changes to red when they are broken"
       *
       * The list was the five BUSIEST of eight active employees, so three were missing at any
       * moment and which three moved with the queue. It is the whole roster now, worst first.
       *
       * THE STATE IS IN THE SHAPE AS WELL AS THE COLOUR — a filled disc, a hollow ring, a square —
       * and the word is always there beside it, so the verdict survives a greyscale screenshot and
       * a colourblind reader. And every dot carries its sentence: a red dot with no reason is a
       * puzzle, not an alert.
       */
      return (c.roster ?? c.busiest ?? []).length ? (
        <>
          {(c.roster ?? c.busiest).map((e: any) => (
            <div className="row" key={e.id}>
              <div className="row-main">
                <div className="row-title">
                  <span className={`health health-${e.health ?? "amber"}`} aria-hidden="true" />
                  {e.name}
                  <span className="health-l">{e.label ?? ""}</span>
                </div>
                <div className="row-sub">{e.role} · {e.lane}</div>
                {e.reason && <div className="row-sub">{e.reason}</div>}
              </div>
              {e.open_tasks > 0
                ? <button className="row-open" onClick={() => go(employeeHref(e.id))} aria-label={`See ${e.name}'s ${e.open_tasks} open item${e.open_tasks === 1 ? "" : "s"}`}>See {e.open_tasks} open ▸</button>
                : <div className="row-val">0 open</div>}
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

/**
 * THE DATE, THE GATES, AND WHAT HAPPENED YESTERDAY.
 *
 * Her three questions, which were all defects in this screen:
 *
 *   "the 'today's contract' needs the date there and what happens to yesterday it just disappears?"
 *   "if nothing is clicked does it track which days were skipped?"
 *   "AND ARE U FIXING THE FACT THAT I HAD TO ASK WHAT MORNING MID DAY AND EVENING GATES WERE?"
 *
 * Every answer was already written down in the source, where only a developer would ever read it.
 * The test this component is held to: could she work out what this is for, and what happens if she
 * ignores it, without asking anyone? A one-line intent under a heading is usually enough — it does
 * not need a help system.
 *
 * THE unknown / missed DISTINCTION IS SHOWN RATHER THAN TRUSTED. It is the most careful decision in
 * the system — a night she was too tired to close the gate is not a day she skipped the work — and
 * it is the thing that makes the streak worth believing, so it belongs on the screen.
 */
function ContractHeader({ content }: { content: any }) {
  const y = content.yesterday;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="row">
        <div className="row-main">
          <div className="row-title">{content.day_label ?? content.day_id}</div>
          <div className="row-sub">
            {content.state === "agreed"
              ? "Agreed at the Morning Gate. This is what you signed up to."
              : content.state === "proposed"
                ? "Proposed, not agreed. Run the Morning Gate to agree to it or override it."
                : "Today's agenda could not be derived — that is a fault, not an empty day."}
          </div>
        </div>
        {/*
          * `2026-09-09` USED TO SIT HERE, beside "Wednesday 9 September". The same fact twice, once
          * in a format written for a database key. It told her nothing the line to its left had not
          * already said, and it made the header look like a record rather than a day.
          */}
      </div>

      {y && (
        <div className="row">
          <div className="row-main">
            {/* Human first here too: "Yesterday · 2026-09-08" is a key, not a day. */}
            <div className="row-title">
              Yesterday · {new Date(`${y.day_id}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div className="row-sub">{y.verdict}</div>
            <div className="row-sub">
              Gates run: {y.gates_run?.length ? y.gates_run.join(", ") : "none"}
            </div>
          </div>
          <div className={`risk risk-${y.anchor_outcome === "missed" ? "high" : y.anchor_outcome === "done" ? "low" : "medium"}`}>
            {y.anchor_outcome}
          </div>
        </div>
      )}

      {content.gates?.length ? (
        <>
          <button className="docket-open" onClick={() => setOpen((v) => !v)}>
            <span className="docket-more">{open ? "Hide what the gates are" : "What are the gates? →"}</span>
          </button>
          {open && (
            <>
              <div className="row-sub">{content.gates_note}</div>
              {content.gates.map((g: any) => (
                <div className="row" key={g.name}>
                  <div className="row-main">
                    <div className="row-title">{g.name}</div>
                    <div className="row-sub">Closes: {g.closes}</div>
                    <div className="row-sub">{g.what}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      ) : null}
    </>
  );
}

/**
 * WHAT SHE CAN DO WITH AN ALERT — which until today was read it.
 *
 *   "i also need to be able to refresh critical alerts and / or dismiss / mark resolved? i dont know
 *    u need to figure it out and add it"
 *
 * ─── Three verbs, and each is built against its own failure mode ───────────
 *
 * REFRESH re-runs the checks rather than re-fetching the answer. Today is computed on read, so a
 * reload would say exactly what it said a minute ago; what makes an answer current is something
 * going and looking.
 *
 * RESOLVED RE-VERIFIES AND CAN DISAGREE WITH HER. `TERMINAL_CHECKS` refuses an employee, a run and a
 * job that claim work is done, and a person asserting it is the same claim in different clothes — if
 * she closes the West Peek grant and Scooter has not granted it, the system believes a false thing
 * and stops telling her. So the verdict comes back and is shown verbatim, including when it says no.
 *
 * DISMISS IS A SNOOZE WITH A REASON. It expires, it breaks if the alert gets louder, and the reason
 * is required — so next week it can say why she put it aside instead of arriving as if it were new.
 */
function Alerts({ content, onChanged, onError }: {
  content: any;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const dismissBox = useRef<HTMLDivElement | null>(null);
  const reasonBox = useRef<HTMLTextAreaElement | null>(null);
  /*
   * A QUESTION FROM AN EMPLOYEE IS ANSWERED HERE, NOT IN HER MAIL CLIENT. The intake alert used to
   * end "reply to that email" — and for a question she had typed into this screen there was no
   * email. Same reason box, two verbs: an answer becomes work by the reply path; a withdrawal says
   * why there is nothing to do and opens nothing.
   */
  const [answering, setAnswering] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");

  /*
   * ── THE SECOND STEP HAS TO BE WHERE HER EYES ARE ──────────────────────────
   *
   *   "and the dimiss and mark resolved buttons dont work"
   *
   * The dismiss endpoint worked the whole time — 201, a row in `alert_dismissals`, the alert gone
   * on the next read. What did not work was the INTERACTION. Pressing "Dismiss" replaces the button
   * with a reason box whose "Put it aside" / "Cancel" pair renders BELOW THE FOLD, behind the fixed
   * bottom nav. From her seat: she presses Dismiss, the button she pressed vanishes, and nothing is
   * dismissed. That is precisely "doesn't work", and no amount of endpoint testing would find it.
   *
   * So the box scrolls itself into view and takes the cursor. `block: "nearest"` rather than
   * "center" because the row is usually almost visible already and yanking the page is its own kind
   * of broken.
   */
  useEffect(() => {
    if (dismissing === null && answering === null) return;
    dismissBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    reasonBox.current?.focus();
  }, [dismissing, answering]);
  const alerts: any[] = content.alerts ?? [];
  const keys: string[] = content.keys ?? [];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { onError(e); } finally { setBusy(false); }
  };

  if (alerts.length === 0 && (content.dismissed ?? []).length === 0) return null;

  return (
    <>
      {content.intent && <div className="row-sub"><em>{content.intent}</em></div>}
      {verdict && <div className="notice" style={{ borderColor: "var(--gold)" }}>{verdict}</div>}

      {alerts.map((a: any, i: number) => (
        <div className="row" key={keys[i] ?? i}>
          <div className="row-main">
            <div className="row-title">{a.text}</div>
            {dismissing === i ? (
              <div className="judgement-note" ref={dismissBox}>
                <label className="stat-l" htmlFor={`why-dismiss-${i}`}>
                  Why are you putting this aside? It comes back in a week, or sooner if it gets worse.
                </label>
                <textarea
                  id={`why-dismiss-${i}`}
                  ref={reasonBox}
                  className="judgement-why"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="decide">
                  {/*
                    * THE DISABLED STATE SAYS WHY IT IS DISABLED.
                    *
                    * It sat grey and silent until three characters were typed, so on a screen she
                    * had to scroll to find, the one control there looked dead on arrival. The
                    * required reason is a good rule and it stays; what changes is that the button
                    * asks for the thing it is waiting for.
                    */}
                  <button
                    className="btn btn-reject"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => run(async () => {
                      await api.dismissAlert({ key: keys[i], text: a.text, severity: a.severity, reason: reason.trim() });
                      setReason(""); setDismissing(null); onChanged();
                    })}
                  >
                    {reason.trim().length < 3 ? "Say why first" : "Put it aside"}
                  </button>
                  <button className="btn btn-defer" disabled={busy} onClick={() => setDismissing(null)}>Cancel</button>
                </div>
              </div>
            ) : answering === i ? (
              <div className="judgement-note" ref={dismissBox}>
                <label className="stat-l" htmlFor={`answer-${i}`}>
                  Your answer goes straight to that desk as work. Or withdraw the question, saying why it no longer needs one.
                </label>
                <textarea
                  id={`answer-${i}`}
                  ref={reasonBox}
                  className="judgement-why"
                  rows={3}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <div className="decide">
                  <button
                    className="btn"
                    disabled={busy || answer.trim().length < 3}
                    onClick={() => run(async () => {
                      const r = await api.answerQuestion(a.source_id, { answer: answer.trim() });
                      setVerdict(r.note); setAnswer(""); setAnswering(null); onChanged();
                    })}
                  >
                    {answer.trim().length < 3 ? "Write the answer first" : "Send the answer"}
                  </button>
                  <button
                    className="btn btn-reject"
                    disabled={busy || answer.trim().length < 3}
                    onClick={() => run(async () => {
                      const r = await api.answerQuestion(a.source_id, { withdraw: answer.trim() });
                      setVerdict(r.note); setAnswer(""); setAnswering(null); onChanged();
                    })}
                  >
                    {answer.trim().length < 3 ? "Write the reason first" : "Withdraw the question"}
                  </button>
                  <button className="btn btn-defer" disabled={busy} onClick={() => setAnswering(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="decide">
                {a.source_type === "intake" && a.source_id && (
                  <button className="btn" disabled={busy} onClick={() => { setAnswering(i); setAnswer(""); }}>
                    Answer
                  </button>
                )}
                {/*
                  * EVERY ALERT OFFERS IT, WHICH IS THE FIX.
                  *
                  * This was gated on `a.source_id?.startsWith("del_")` and NONE of the alerts on
                  * her screen had a `del_` source id — so "the mark resolved button dont work" was
                  * literally true: the button was not on the page. An owned deliverable still goes
                  * through its own terminal check, which can refuse her; everything else is
                  * re-tested by recomputing the surface and seeing whether the condition holds.
                  */}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run(async () => {
                    const r = await api.resolveAlert({
                      deliverableId: a.source_type === "tasks" && a.source_id?.startsWith("del_") ? a.source_id : null,
                      key: keys[i],
                    });
                    setVerdict(r.verdict);
                    if (r.closed) onChanged();
                  })}
                >
                  Mark resolved
                </button>
                <button className="btn btn-defer" disabled={busy} onClick={() => { setDismissing(i); setReason(""); }}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <div className={`risk risk-${a.severity === "critical" || a.severity === "high" ? "high" : "medium"}`}>
            {a.severity}
          </div>
        </div>
      ))}

      <div className="decide">
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(async () => {
            const r = await api.refreshAlerts();
            const closed = (r.rechecked ?? []).filter((x: any) => x.met);
            setVerdict(
              `${(r.rechecked ?? []).length} check(s) re-run. ` +
              (closed.length ? `${closed.length} finished and closed. ` : "Nothing has become true since. ") +
              r.credentials_note,
            );
            onChanged();
          })}
        >
          {busy ? "Re-running the checks…" : "Refresh — re-run the checks"}
        </button>
      </div>

      {/* Dismissed is not hidden. The count is here and the reasons with it. */}
      {(content.dismissed ?? []).length > 0 && (
        <>
          <div className="row-sub">
            <strong>{content.dismissed.length} put aside.</strong> They come back on their own, and sooner if they get worse.
          </div>
          {content.dismissed.map((d: any) => (
            <div className="row-sub" key={d.key}>
              {d.text} — you said: {d.reason} (back on {new Date(d.until).toISOString().slice(0, 10)})
            </div>
          ))}
        </>
      )}
    </>
  );
}

/**
 * THE DIARY. What she has coming up, and a link where a packet exists.
 *
 * ─── Her correction, with a screenshot ─────────────────────────────────────
 *
 *   "this tab is suppose to show what meetings i have upcoming. i should be able to input what
 *    meetings i have and it should check my calendars for meetings and if there is a packet or
 *    deliverable for a meeting i should see that in a link"
 *
 * FOUR THINGS ON A ROW AND NO MORE: what it is, when, who with, and the link if there is one. The
 * packet used to be expanded in place — "Your week", the grant steps, the entire document — into a
 * section she opens to see what is on today.
 *
 * ─── A diary you cannot write in is not a diary ────────────────────────────
 *
 * The form is the PRIMARY route rather than a fallback while calendar sync is built, and that is a
 * fact about Google rather than a staging decision: a service account can never read a personal
 * @gmail.com calendar, so some of her meetings will always be ones she typed.
 *
 * ─── And it says which calendars are actually in here ──────────────────────
 *
 * A partial calendar presented as complete is worse than manual entry, because she would trust it
 * and stop typing the ones it cannot see. So the connected feeds are named, and so are the ones
 * that are not.
 */
function Diary({ content, onChanged, onError }: {
  content: any;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [withWho, setWithWho] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const rows: any[] = content.diary ?? [];

  async function add() {
    const at = Date.parse(when);
    if (!title.trim() || !Number.isFinite(at)) return;
    setBusy(true);
    try {
      await api.addMeeting({ title: title.trim(), counterpart: withWho.trim() || null, scheduled_at: at });
      setTitle(""); setWithWho(""); setWhen(""); setAdding(false);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {rows.length === 0 ? (
        <div className="row-sub">Nothing in the next three weeks. Add one below.</div>
      ) : (
        rows.map((r) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <div className="row-title">{r.title}</div>
              <div className="row-sub">
                {new Date(r.scheduled_at).toLocaleString(undefined, {
                  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
                {r.with ? ` · with ${r.with}` : ""}
                {r.location ? ` · ${r.location}` : ""}
              </div>
              <div className="row-sub">
                {r.source === "recurring" ? "standing" : r.source === "calendar" ? "from your calendar" : r.source === "crm" ? "from your people" : "you added this"}
              </div>
            </div>
            {/* Cancelled, not deleted — and the standing fixture has no row to cancel. */}
            {r.standing || r.source === "crm" ? (
              <div className="row-val">{r.standing ? "weekly" : ""}</div>
            ) : (
              <button
                className="btn btn-defer"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await api.cancelMeeting(r.id); onChanged(); } catch (e) { onError(e); } finally { setBusy(false); }
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ))
      )}

      {adding ? (
        <div className="judgement-note">
          {/* Every control is named for a screen reader; a placeholder is not a label. */}
          <label className="stat-l" htmlFor="diary-title">What is it?</label>
          <input id="diary-title" className="judgement-why" placeholder="Coffee with the Hartley people" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="stat-l" htmlFor="diary-with">Who with? (optional)</label>
          <input id="diary-with" className="judgement-why" placeholder="Scooter" value={withWho} onChange={(e) => setWithWho(e.target.value)} />
          <label className="stat-l" htmlFor="diary-when">When</label>
          <input id="diary-when" className="judgement-why" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <div className="decide">
            <button className="btn btn-approve" disabled={busy || !title.trim() || !when} onClick={() => void add()}>
              {busy ? "Adding…" : "Add it"}
            </button>
            <button className="btn btn-defer" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="decide">
          <button className="btn" onClick={() => setAdding(true)}>Add a meeting</button>
        </div>
      )}

      {content.calendar && (
        <>
          <div className="row-sub">{content.calendar.note}</div>
          {(content.calendar.unreadable ?? []).map((u: string, i: number) => (
            <div className="row-sub" key={i}>Not in here: {u}</div>
          ))}
        </>
      )}
    </>
  );
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

/**
 * OPERATIONS, ONE LINE (owner, 12 Oct 2026). The synopsis from Team → Duties — what runs today, what
 * went out, what needs her — and the way there. Its own requests, so a failure here never touches
 * the day's blocks; it says so in words instead.
 */
function OperationsLine({ onOpen }: { onOpen?: () => void }) {
  const [s, setS] = useState<ReturnType<typeof buildOperations>["synopsis"] | null>(null);
  const [err, setErr] = useState(false);
  // THE FAILED-RUNS COUNT OPENS ITS DETAIL (owner, 26 Oct 2026: "1 failed runs" and she could not
  // click it). What failed, why, and when — one line each, from the same ledgers as the count.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Promise.all([api.roster(), api.operations().catch(() => null)])
      .then(([roster, ledgers]) => setS(buildOperations(roster, ledgers).synopsis))
      .catch(() => setErr(true));
  }, []);
  const n = s?.counts.failedRuns ?? 0;
  const when = (at: number | null) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  return (
    <div className="panel" data-testid="today-operations">
      <p className="eyebrow" style={{ marginTop: 0 }}>Operations</p>
      <div className="row-sub">
        {err ? "Operations could not be read just now; Team → Duties has the full view."
          : !s ? "Reading the schedule and today’s ledgers…"
          : `${s.running} · ${s.sent} · ${s.needs}`}
      </div>
      {n > 0 && (
        <button className="btn btn-small" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="open-failed-runs">
          {open ? "Hide" : "See"} the {n} failed run{n === 1 ? "" : "s"}
        </button>
      )}
      {open && s && (
        <ul className="row-sub" data-testid="failed-runs">
          {s.failed.map((f, i) => (
            <li key={i}><strong>{f.what}</strong>{f.at ? ` at ${when(f.at)}` : ""}: {f.why}</li>
          ))}
        </ul>
      )}
      {onOpen && <button className="btn btn-small" onClick={onOpen} data-testid="open-operations">Team → Duties</button>}
    </div>
  );
}
