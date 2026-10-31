import { useEffect, useState } from "react";
import { api } from "../api";
import { go } from "../nav";
import { BodyContractView } from "../pages/BodyContract";

/**
 * TODAY'S LIST (owner approved the mock-up, 31 Oct 2026). One list she can tick: the Morning gate
 * first, the Midday gate in the middle, the Night gate last, and between them every Decide item, the
 * Wealth block, approvals, open loops and the day's other blocks in time order. Every row has a
 * circle; a tick stamps the time and the row never moves. The list and its one "needs you" count
 * come from `/practice/list` (src/worker/boss/today/list.ts) and nowhere else.
 */

export type Gate = "morning" | "midday" | "night";
type Item = { key: string; kind: string; label: string; required?: boolean };
type Sub = { key: string; title: string; sub?: string; done_at: number | null; open?: { label: string; href: string } };
export type Row = {
  key: string; kind: string; title: string; sub: string | null; at: number; done_at: number | null; needs_you: boolean;
  open?: { label: string; href: string }; subs?: Sub[];
  gate?: { name: string; items: Item[]; is_default: boolean; saved_default: boolean; checks?: string[] };
};
export type ListData = {
  day_id: string; rows: Row[]; ticks: Record<string, number>; needs_you: number; done: number; total: number;
  coach: { morning_at: number | null; evening_at: number | null; nudge: "morning" | "evening" | null };
};

/** What the gates need from the rest of the day: the sentence, the practice, the body, the law. */
export type DayContext = {
  gratitude: string | null;
  practice: string[];
  body: any | null;
  law: { n: number; title: string; text: string } | null;
  priorities: string[];
  /** The day's first money move (Monique's find, a live deal), shown on the Brokerage block. */
  firstMove: { action: string; why: string | null } | null;
  limits: { morning_priorities: number; midday_checks: number; night_review_prompts: number };
};

export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Tick({ done, onTick, label, small = false }: { done: number | null; onTick?: () => void; label: string; small?: boolean }) {
  return (
    <button
      type="button" className="tick" aria-pressed={Boolean(done)} aria-label={done ? `${label}: done at ${clock(done)}. Tap to undo` : `${label}: tick when done`}
      disabled={!onTick} onClick={onTick} style={small ? undefined : undefined}
    >
      {done ? "✓" : ""}
    </button>
  );
}

function DoneBtn({ k, ticks, onTick, label = "Done ✓" }: { k: string; ticks: Record<string, number>; onTick: (k: string, done: boolean) => void; label?: string }) {
  const at = ticks[k] ?? null;
  return (
    <button type="button" className="done-btn" aria-pressed={Boolean(at)} onClick={() => onTick(k, !at)} data-tick={k}>
      {at ? `✓ ${clock(at)}` : label}
    </button>
  );
}

export function TodayList({ list, ctx, onTick, onChanged, onCoach, onError, openGate, onEditGate, onCreateGate, onAddLoop }: {
  list: ListData;
  ctx: DayContext;
  onTick: (key: string, done: boolean) => void;
  onChanged: () => void;
  onCoach: (phase: "morning" | "evening") => void;
  onError: (e: unknown) => void;
  openGate: Gate | null;
  onEditGate: (gate: Gate, items: Item[]) => void;
  onCreateGate: () => void;
  onAddLoop: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (openGate ? { [`gate:${openGate}`]: true } : {}));
  useEffect(() => {
    if (!openGate) return;
    setOpen((o) => ({ ...o, [`gate:${openGate}`]: true }));
    requestAnimationFrame(() => document.getElementById(`row-gate-${openGate}`)?.scrollIntoView({ block: "start" }));
  }, [openGate]);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); onChanged(); } catch (e) { onError(e); }
  }

  return (
    <section data-testid="today-list" aria-label="Today's list">
      <p className="t-list-h">Today&apos;s list · in time order</p>
      {list.rows.map((r) => {
        const isGate = r.kind === "gate";
        const gate = isGate ? (r.gate!.name as Gate) : null;
        const tickable = r.kind === "decide" || r.kind === "block" || r.kind === "loop";
        const onRowTick = tickable
          ? () => {
              if (r.kind === "decide") onTick(r.key, !r.done_at);
              else if (r.kind === "block") void act(() => api.runOfShowBlock(r.key.replace(/^ros:/, ""), { done: !r.done_at }));
              else if (r.kind === "loop") void act(() => api.closeLoop(r.key.replace(/^loop:/, ""), "resolve"));
            }
          : undefined;
        return (
          <div key={r.key} id={isGate ? `row-gate-${gate}` : undefined} className={`t-row${isGate ? " is-gate" : ""}`} data-testid={`row-${r.key}`}>
            <div className="t-row-top">
              <Tick done={r.done_at} onTick={onRowTick} label={r.title} />
              <div>
                <div className="t-row-title">
                  {r.title}
                  {isGate && r.gate!.is_default && <span className="dflt">Default</span>}
                </div>
                {r.sub && <div className="t-row-sub">{r.sub}</div>}
                {r.key === "ros:first_wealth_block" && ctx.firstMove && (
                  <div className="t-row-sub" data-testid="first-money-move"><strong>First money move:</strong> {ctx.firstMove.action}{ctx.firstMove.why ? ` ${ctx.firstMove.why}` : ""}</div>
                )}
                {r.done_at ? <div className="t-row-time">✓ {clock(r.done_at)}</div>
                  : isGate ? <div className="t-row-sub">Ticks itself when you {gate === "morning" ? "agree the day" : gate === "midday" ? "press Reset" : "close the day"}.</div>
                  : r.kind === "approval" ? <div className="t-row-sub">Answer it to tick it.</div> : null}
              </div>
              {r.open ? (
                <button className="t-open" onClick={() => go(r.open!.href)}>{r.open.label}</button>
              ) : isGate ? (
                <button className="t-open" onClick={() => onEditGate(gate!, r.gate!.items)} aria-label={`Edit ${r.title}`}>Edit gate ✎</button>
              ) : null}
            </div>

            {r.subs && r.subs.length > 0 && (
              <div className="t-subs">
                {r.subs.map((s) => (
                  <div className="t-sub" key={s.key} data-testid={`sub-${s.key}`}>
                    <Tick done={s.done_at} onTick={() => onTick(s.key, !s.done_at)} label={s.title} small />
                    <div>
                      <div>{s.title}</div>
                      {s.sub && <div className="t-row-sub">{s.sub}</div>}
                    </div>
                    {s.open && <button className="t-open" onClick={() => go(s.open!.href)}>{s.open.label}</button>}
                  </div>
                ))}
              </div>
            )}

            {isGate && (
              <>
                <button className="t-more" onClick={() => toggle(r.key)} aria-expanded={Boolean(open[r.key])}>
                  {open[r.key] ? "Show less ▴" : "Tap to open ▾"}
                </button>
                {open[r.key] && (
                  <GateBody
                    gate={gate!} items={r.gate!.items} ctx={ctx} ticks={list.ticks} done={Boolean(r.done_at)}
                    coach={list.coach} onTick={onTick} onCoach={onCoach} onDone={onChanged} onError={onError}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
      <div className="t-actions" style={{ margin: "4px 0 0" }}>
        <button className="t-link" onClick={onCreateGate} data-testid="create-gate">+ Create a gate</button>
        <span className="t-row-sub">·</span>
        <button className="t-link" onClick={onAddLoop} data-testid="add-to-today">+ Add to today</button>
      </div>
    </section>
  );
}

// ─── Inside a gate ─────────────────────────────────────────────────────────────

function GateBody({ gate, items, ctx, ticks, done, coach, onTick, onCoach, onDone, onError }: {
  gate: Gate; items: Item[]; ctx: DayContext; ticks: Record<string, number>; done: boolean;
  coach: ListData["coach"];
  onTick: (key: string, done: boolean) => void; onCoach: (phase: "morning" | "evening") => void;
  onDone: () => void; onError: (e: unknown) => void;
}) {
  const t = (k: string) => `${gate}:${k}`;
  const lawName = ctx.law ? `Law ${ctx.law.n} · ${ctx.law.title}` : "Today's law";
  const nightFlags = { floors: items.some((i) => i.kind === "floors"), law: items.some((i) => i.kind === "law_reflect"), grateful: items.some((i) => i.kind === "grateful") };
  let n = 0;
  return (
    <div className="gate-body" data-testid={`gate-body-${gate}`}>
      {items.map((it) => {
        if (it.kind === "floors" || it.kind === "law_reflect" || it.kind === "grateful" || it.kind === "attention") return null; // inside the Night form below
        n += 1;
        const head = (label: string) => <div className="gate-step-h">{n} · {label}</div>;
        switch (it.kind) {
          case "coach":
          case "coach_evening": {
            const evening = it.kind === "coach_evening";
            const at = evening ? coach.evening_at : coach.morning_at;
            return (
              <div className="gate-step" key={it.key}>
                {head(evening ? "🌙 Evening coaching" : "☀ Morning coaching")}
                <div className="step">
                  <span>{evening ? "5 min wrap-up with your coach · the day, the law, wins, tomorrow" : "5 min talk with your coach · today's law and plan"}</span>
                  {at ? <span className="done-btn" aria-pressed="true">✓ {clock(at)}</span>
                    : <button className="done-btn" onClick={() => onCoach(evening ? "evening" : "morning")} data-testid={`coach-start-${evening ? "evening" : "morning"}`}>Start ›</button>}
                </div>
                <div className="t-row-sub">Nothing you say is saved.</div>
              </div>
            );
          }
          case "gratitude":
            return (
              <div className="gate-step" key={it.key}>
                {head("Say it aloud")}
                {ctx.gratitude ? <p className="say">“{ctx.gratitude}”</p> : <div className="t-row-sub">Today&apos;s sentence is written on Spirit.</div>}
                <div><DoneBtn k={t("gratitude")} ticks={ticks} onTick={onTick} label="Say it aloud ✓" /></div>
              </div>
            );
          case "practice":
            return (
              <div className="gate-step" key={it.key}>
                {head("Practice · 20 minutes")}
                {(ctx.practice.length ? ctx.practice : ["Your practice steps are on Spirit."]).map((s, i) => (
                  <div className="step" key={i}><span>{s}</span>{ctx.practice.length ? <DoneBtn k={t(`practice:${i}`)} ticks={ticks} onTick={onTick} /> : null}</div>
                ))}
              </div>
            );
          case "law":
            return (
              <div className="gate-step" key={it.key}>
                {head("Today's coaching law · read it aloud")}
                <div>{lawName}{ctx.law ? `. “${ctx.law.text}”` : ""}</div>
                <div><DoneBtn k="morning:law" ticks={ticks} onTick={onTick} label="Read it aloud ✓" /></div>
                <div className="t-row-sub">Same tick as the card at the top of Today.</div>
              </div>
            );
          case "move":
            return (
              <div className="gate-step" key={it.key}>
                {head("Move · 10 minutes (bed counts)")}
                {ctx.body ? <BodyContractView body={ctx.body} onChanged={onDone} /> : <div className="t-row-sub">Your movements are on Spirit.</div>}
                <div><DoneBtn k={t("move")} ticks={ticks} onTick={onTick} label="Moved ✓" /></div>
              </div>
            );
          case "water":
            return (
              <div className="gate-step" key={it.key}>
                {head("Water and medicine")}
                <div className="step"><span>Water + BP medicine in the first hour</span><DoneBtn k={t("water:0")} ticks={ticks} onTick={onTick} /></div>
                <div className="step"><span>One full Stanley cup (two is the target)</span><DoneBtn k={t("water:1")} ticks={ticks} onTick={onTick} /></div>
              </div>
            );
          case "law_check":
            return (
              <div className="gate-step" key={it.key}>
                {head(`Did you hold ${ctx.law ? `Law ${ctx.law.n}` : "today's law"} today?`)}
                <div className="t-row-sub">{ctx.law ? `${ctx.law.title}: the morning plan stands.` : "The morning plan stands."}</div>
                <div className="t-actions">
                  <DoneBtn k={t("law_check")} ticks={ticks} onTick={onTick} label="✓ Yes" />
                  {ticks[t("law_check")] ? <button className="done-btn" onClick={() => onTick(t("law_check"), false)}>✗ Not yet</button> : null}
                </div>
              </div>
            );
          case "agree":
            return <div className="gate-step" key={it.key}>{head("Agree the day")}<MorningForm done={done} ctx={ctx} onDone={onDone} onError={onError} /></div>;
          case "what_changed":
            return <div className="gate-step" key={it.key}>{head("What changed")}<MiddayForm done={done} items={items} ticks={ticks} law={ctx.law} onDone={onDone} onError={onError} /></div>;
          case "tomorrow":
            return <div className="gate-step" key={it.key}>{head("Close the day")}<NightForm done={done} flags={nightFlags} law={ctx.law} limits={ctx.limits} onDone={onDone} onError={onError} /></div>;
          default:
            // water_mid, meal, stand and her own lines: a plain check with "Done ✓".
            return (
              <div className="gate-step" key={it.key}>
                <div className="step"><span>{n} · {it.label}</span><DoneBtn k={t(it.key)} ticks={ticks} onTick={onTick} /></div>
              </div>
            );
        }
      })}
    </div>
  );
}

// ─── The three gate forms: every field the old forms had, now filled in by default ───────────

/** Every field is named for a screen reader: callers pass the name, and it is required here. */
const input = ({ "aria-label": name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { "aria-label": string }) => <input className="t-input" aria-label={name} {...props} />;

function MorningForm({ done, ctx, onDone, onError }: { done: boolean; ctx: DayContext; onDone: () => void; onError: (e: unknown) => void }) {
  const max = ctx.limits.morning_priorities;
  const defaults = ctx.priorities.slice(0, max);
  const [priorities, setPriorities] = useState<string[]>(() => Array.from({ length: Math.max(1, defaults.length) }, () => ""));
  const [f, setF] = useState({ identity: "", state: "", body: "", revenue: "", commitment: "" });
  const [busy, setBusy] = useState(false);
  if (done) return <div className="t-row-sub">Agreed. The day is set.</div>;
  // Grey-filled lines are Boss OS's default; a line she leaves empty keeps its default.
  const chosen = priorities.map((p, i) => p.trim() || defaults[i] || "").filter(Boolean);
  const submit = async () => {
    setBusy(true);
    try {
      await api.morningGate({
        priorities: chosen,
        identity_cue: f.identity || undefined, state: f.state || undefined,
        body_floor: f.body || "10 min, one Stanley cup", revenue_reality: f.revenue || undefined, commitment: f.commitment || undefined,
      });
      onDone();
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="t-row-sub">Three priorities at most. Choosing them is the work. Grey lines are Boss OS&apos;s default; type over any of them to make the gate yours.</div>
      {priorities.map((p, i) => (
        <input key={i} className="t-input" aria-label={`Priority ${i + 1}`} placeholder={defaults[i] ? `Priority ${i + 1} · ${defaults[i]}` : `Priority ${i + 1}`}
          value={p} onChange={(e) => setPriorities(priorities.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}
      {priorities.length < max && <button type="button" className="done-btn" style={{ marginTop: 6 }} onClick={() => setPriorities([...priorities, ""])}>Add priority</button>}
      {([["identity", "Identity cue"], ["state", "State"], ["body", "Body floor · 10 min, one Stanley cup"], ["revenue", "Revenue reality"], ["commitment", "Today's commitment"]] as const).map(([k, label]) =>
        input({ key: k, "aria-label": label.split(" · ")[0], placeholder: label, value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) } as any))}
      <div className="decide">
        <button className="btn btn-approve" disabled={busy || chosen.length === 0} onClick={() => void submit()}>Agree the day</button>
      </div>
    </div>
  );
}

function MiddayForm({ done, items, ticks, law, onDone, onError }: {
  done: boolean; items: Item[]; ticks: Record<string, number>; law: DayContext["law"]; onDone: () => void; onError: (e: unknown) => void;
}) {
  const [changed, setChanged] = useState("");
  const [busy, setBusy] = useState(false);
  if (done) return <div className="t-row-sub">Reset recorded.</div>;
  const checks = items.filter((i) => ["water_mid", "meal", "stand", "custom"].includes(i.kind)).slice(0, 3)
    .map((i) => ({ text: i.label, done: Boolean(ticks[`midday:${i.key}`]) }));
  const held = ticks["midday:law_check"] ? `${law ? `Law ${law.n}` : "The law"}: held.` : null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.middayGate({ checks: checks.length ? checks : [{ text: "Midday reset", done: true }], adjustments: [changed.trim(), held].filter(Boolean).join(" ") || undefined });
      onDone();
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="t-row-sub">Three checks at most, and the approval sweep runs with them.</div>
      {input({ "aria-label": "What changed", placeholder: "What changed", value: changed, onChange: (e) => setChanged(e.target.value) })}
      <div className="decide"><button className="btn btn-approve" disabled={busy} onClick={() => void submit()}>Reset</button></div>
    </div>
  );
}

function NightForm({ done, flags, law, limits, onDone, onError }: {
  done: boolean; flags: { floors: boolean; law: boolean; grateful: boolean }; law: DayContext["law"]; limits: DayContext["limits"];
  onDone: () => void; onError: (e: unknown) => void;
}) {
  const [attention, setAttention] = useState([{ focus_area: "", pct: "" }]);
  const [review, setReview] = useState<string[]>([""]);
  const [seed, setSeed] = useState<string[]>([""]);
  const [note, setNote] = useState("");
  const [lawLine, setLawLine] = useState("");
  const [grateful, setGrateful] = useState("");
  const [floors, setFloors] = useState<{ key: string; title: string; floor: string }[]>([]);
  const [reported, setReported] = useState<Record<string, boolean | undefined>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.floors().then((f: any) => setFloors(f.floors)).catch(() => setFloors([])); }, []);
  if (done) return <div className="t-row-sub">The day is closed.</div>;
  const allocated = attention.reduce((sum, a) => sum + (Number(a.pct) || 0), 0);
  const usable = attention.filter((a) => a.focus_area.trim() && Number(a.pct) > 0);
  const answered = Object.values(reported).filter((v) => v !== undefined).length;
  const submit = async () => {
    setBusy(true);
    try {
      const lawNote = lawLine.trim() ? `${law ? `Law ${law.n}` : "The law"}: ${lawLine.trim()}` : "";
      await api.nightGate({
        attention: usable.map((a) => ({ focus_area: a.focus_area.trim(), pct: Number(a.pct) })),
        review: review.filter((r) => r.trim()),
        evidence: note || lawNote || grateful ? { note: [lawNote, note.trim()].filter(Boolean).join(" ") || null, wins: grateful.trim() ? [`Grateful: ${grateful.trim()}`] : [] } : undefined,
        tomorrow_seed: { priorities: seed.filter((s) => s.trim()) },
        floors: flags.floors && answered > 0 ? reported : undefined,
      });
      onDone();
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  const lines = (value: string[], set: (v: string[]) => void, max: number, label: string) => (
    <>
      {value.map((v, i) => input({ key: i, "aria-label": `${label} ${i + 1}`, placeholder: `${label} ${i + 1}`, value: v, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(value.map((x, j) => (j === i ? e.target.value : x))) } as any))}
      {value.length < max && <button type="button" className="done-btn" style={{ marginTop: 6 }} onClick={() => set([...value, ""])}>Add {label.toLowerCase()}</button>}
    </>
  );
  return (
    <div>
      <div className="t-row-sub" style={{ color: allocated > 100 ? "var(--reject)" : undefined }}>Attention allocation: {allocated}% of the day accounted for.</div>
      {attention.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8 }}>
          <input className="t-input" style={{ flex: 1 }} aria-label={`Focus area ${i + 1}`} placeholder="Where the attention went" value={a.focus_area}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, focus_area: e.target.value } : x)))} />
          <input className="t-input" style={{ width: 70 }} aria-label={`Percentage ${i + 1}`} placeholder="%" inputMode="numeric" value={a.pct}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="done-btn" style={{ marginTop: 6 }} onClick={() => setAttention([...attention, { focus_area: "", pct: "" }])}>Add focus area</button>

      {flags.floors && (
        <>
          <p className="eyebrow" style={{ marginTop: 12 }}>Floors</p>
          {floors.map((f) => (
            <div className="step" key={f.key}>
              <span><strong>{f.title}</strong> · {f.floor}</span>
              <span className="t-actions">
                {([["Met", true], ["Missed", false]] as const).map(([label, value]) => (
                  <button key={label} type="button" className="done-btn" aria-pressed={reported[f.key] === value}
                    onClick={() => setReported((r) => ({ ...r, [f.key]: r[f.key] === value ? undefined : value }))}>{label}</button>
                ))}
              </span>
            </div>
          ))}
          <div className="t-row-sub">{answered === 0 ? "Answer none and the day closes unscored. That is allowed." : `${answered} of ${floors.length} answered. The rest stay unanswered rather than counting as missed.`}</div>
        </>
      )}
      {flags.law && input({ "aria-label": "Law reflection", placeholder: `${law ? `Law ${law.n}` : "Today's law"} · where did you break or keep it? One line is enough`, value: lawLine, onChange: (e) => setLawLine(e.target.value) })}
      {flags.grateful && input({ "aria-label": "Grateful for today", placeholder: "One thing from today you're grateful for (about the day, never body or food)", value: grateful, onChange: (e) => setGrateful(e.target.value) })}
      <p className="eyebrow" style={{ marginTop: 12 }}>Review</p>
      {lines(review, setReview, limits.night_review_prompts, "Prompt")}
      <p className="eyebrow" style={{ marginTop: 12 }}>Tomorrow&apos;s priorities</p>
      {lines(seed, setSeed, limits.morning_priorities, "Priority")}
      {input({ "aria-label": "Evidence from the day", placeholder: "Evidence from the day", value: note, onChange: (e) => setNote(e.target.value) })}
      <div className="decide">
        <button className="btn btn-approve" disabled={busy || usable.length === 0 || allocated > 100} onClick={() => void submit()}>Close the day</button>
      </div>
    </div>
  );
}

// ─── Edit a gate, create a gate ─────────────────────────────────────────────────

export function GateEditor({ gate, items, onClose, onSaved, onError }: {
  gate: Gate; items: Item[]; onClose: () => void; onSaved: (list: ListData) => void; onError: (e: unknown) => void;
}) {
  const [list, setList] = useState<Item[]>(items);
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
  };
  const save = async (scope: "default" | "today" | "reset") => {
    setBusy(true);
    try { onSaved(await api.saveGate(gate, list, scope)); } catch (e) { onError(e); } finally { setBusy(false); }
  };
  const name = gate === "morning" ? "Morning" : gate === "midday" ? "Midday" : "Night";
  return (
    <div data-testid="gate-editor">
      <div className="t-row-sub">Move an item with ▲ ▼. Changes keep every tick you&apos;ve already made today.</div>
      <h3 style={{ margin: "8px 0 4px" }}>Edit your {name} gate</h3>
      {list.map((it, i) => (
        <div className="ed-row" key={it.key} data-testid={`edit-item-${it.key}`}>
          <span className="ed-mv">
            <button type="button" aria-label={`Move ${it.label} up`} onClick={() => move(i, -1)}>▲</button>
            <button type="button" aria-label={`Move ${it.label} down`} onClick={() => move(i, 1)}>▼</button>
          </span>
          <span>{it.label}</span>
          {it.required ? <span className="t-row-sub">always on</span>
            : confirm === it.key ? (
              <span className="t-actions">
                <button className="done-btn" onClick={() => { setList(list.filter((x) => x.key !== it.key)); setConfirm(null); }}>Yes, remove</button>
                <button className="done-btn" onClick={() => setConfirm(null)}>Keep</button>
              </span>
            ) : <button className="done-btn" onClick={() => setConfirm(it.key)}>Remove</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input className="t-input" style={{ flex: 1, marginTop: 0 }} aria-label="New item" placeholder="+ Add an item" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button className="done-btn" disabled={!adding.trim()} onClick={() => {
          const at = Math.max(0, list.findIndex((x) => x.required));
          const item = { key: `custom:${Math.random().toString(36).slice(2, 10)}`, kind: "custom", label: adding.trim() };
          setList([...list.slice(0, at), item, ...list.slice(at)]);
          setAdding("");
        }}>Add</button>
      </div>
      <div className="decide">
        <button className="btn btn-approve" disabled={busy} onClick={() => void save("default")}>Save as my default</button>
        <button className="btn" disabled={busy} onClick={() => void save("today")}>Just for today</button>
      </div>
      <div className="t-row-sub">&quot;Save as my default&quot; means tomorrow starts like this too, and the &quot;Default&quot; label goes.</div>
      <div style={{ marginTop: 18 }}>
        <button className="btn btn-defer" disabled={busy} onClick={() => void save("reset")}>Reset to Boss OS default</button>
      </div>
      <button className="t-link" style={{ marginTop: 10 }} onClick={onClose}>← Back to Today</button>
    </div>
  );
}

export function GateCreator({ onSaved, onError }: { onSaved: (list: ListData) => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState("");
  const [time, setTime] = useState("13:00");
  const [checks, setChecks] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const filled = checks.map((c) => c.trim()).filter(Boolean);
  const save = async () => {
    const [h, m] = time.split(":").map(Number);
    setBusy(true);
    try { onSaved(await api.createGate({ name: name.trim(), at_minute: (h ?? 13) * 60 + (m ?? 0), checks: filled })); } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <div data-testid="gate-creator">
      <div className="t-row-sub">Name it, pick a time, add up to three checks. It takes its place in today&apos;s list by time.</div>
      {input({ "aria-label": "Gate name", placeholder: "Gate name", value: name, onChange: (e) => setName(e.target.value) })}
      {input({ "aria-label": "Time", type: "time", value: time, onChange: (e) => setTime(e.target.value) })}
      {checks.map((c, i) => input({ key: i, "aria-label": `Check ${i + 1}`, placeholder: `Check ${i + 1}`, value: c, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setChecks(checks.map((x, j) => (j === i ? e.target.value : x))) } as any))}
      {checks.length < 3 && <button type="button" className="done-btn" style={{ marginTop: 6 }} onClick={() => setChecks([...checks, ""])}>Add a check</button>}
      <div className="decide"><button className="btn btn-approve" disabled={busy || !name.trim() || filled.length === 0} onClick={() => void save()}>Save gate</button></div>
    </div>
  );
}

export function AddToToday({ onSaved, onError }: { onSaved: () => void; onError: (e: unknown) => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div data-testid="add-to-today-sheet">
      <div className="t-row-sub">Something that must not be forgotten. It becomes a row you can tick.</div>
      {input({ "aria-label": "New item for today", placeholder: "Something that must not be forgotten", value: title, onChange: (e) => setTitle(e.target.value) })}
      <div className="decide">
        <button className="btn btn-approve" disabled={busy || !title.trim()} onClick={async () => {
          setBusy(true);
          try { await api.openLoop({ title: title.trim(), kind: "other" }); setTitle(""); onSaved(); } catch (e) { onError(e); } finally { setBusy(false); }
        }}>Add</button>
      </div>
    </div>
  );
}

/** A sheet over the page: ✕ Close, and back on the same spot, same scroll, after it closes. */
export function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn btn-small" onClick={onClose} data-testid="sheet-close">✕ Close</button>
        </div>
        {children}
      </div>
    </>
  );
}
