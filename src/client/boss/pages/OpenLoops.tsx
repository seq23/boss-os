import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { BRAINS } from "@shared/boss/brains/brain.mjs";
import { dayWords, groupLoops, isOverdue, ownerWords, visibleLoops, type Loop } from "@shared/boss/openLoops/openLoops.mjs";

/**
 * OPEN LOOPS (owner ruling, 1 Nov 2026: "Open Loops is the one list of everything approved but not
 * finished"). ☰ More → Open Loops, /?tab=loops (&loop=<id> opens one row).
 *
 * Phone first, calm. Line 1 says how many are not finished and how many are late. "Not finished" is
 * grouped by business, late rows first with a gold "Did this happen?" (a nudge, never red); each row
 * says its finish line, next step, owner and date, with Edit ✎ / ✓ Done / Move to parked. Done asks
 * "What's the real outcome?" first. Her rows waiting on an earlier step are not drawn, only counted.
 * "Parked ideas" sit at the bottom: no dates, no chasing, "Bring back". Rules: openLoops.mjs.
 */
const LABEL: Record<string, string> = Object.fromEntries(BRAINS.map((b) => [b.slug, b.title.split(" — ")[0]!]));
const ORDER = BRAINS.map((b) => b.slug);
const OWNERS = ["claude", "codex", "sequoia"];
type Data = { loops: Loop[]; waiting: number; names: Record<string, string>; today: string };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function OpenLoops() {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api.openLoops().then((d) => { setData(d); setFailed(false); }).catch(() => { setFailed(true); setData((d) => d ?? { loops: [], waiting: 0, names: {}, today: "" }); }), []);
  useEffect(() => { void load(); }, [load]);
  if (data === undefined) return <Loading />;
  const { shown, waiting } = visibleLoops(data.loops);
  const late = shown.filter((l) => isOverdue(l, data.today)).length;
  const parked = data.loops.filter((l) => l.status === "open" && l.section === "parked");
  const closed = data.loops.filter((l) => l.status === "closed").sort((a, b) => (b.closed_at ?? 0) - (a.closed_at ?? 0));
  return (
    <div className="brains" data-testid="open-loops">
      <p className="brain-summary" data-testid="open-loops-summary">
        {failed ? "Open loops did not load. Try again in a minute."
          : `${plural(shown.length, "loop")} not finished · ${late ? `${late} late` : "none late"}`}
      </p>
      <p className="brain-hint">Everything approved but not finished. A loop closes on the real outcome (live, selling, in store), then it moves to the Scorecard.</p>

      <h2 className="email-map-business-name">Not finished</h2>
      {waiting > 0 && <p className="brain-hint" data-testid="open-loops-waiting">{waiting} of yours waiting on earlier steps; each shows here once the step before it is done.</p>}
      {!failed && shown.length === 0 && <p className="brain-hint">Nothing is open. Every approved step is finished.</p>}
      {groupLoops(shown, ORDER, data.today).map((g) => (
        <section key={g.key} className="scorecard-business" data-testid={`open-loops-business-${g.key}`}>
          <h3 className="loops-business">{LABEL[g.key] ?? g.key}</h3>
          <div className="brain-cards">{g.rows.map((l) => <Row key={l.id} loop={l} data={data} onChanged={load} />)}</div>
        </section>
      ))}
      {adding
        ? <Editor data={data} onDone={() => { setAdding(false); void load(); }} />
        : <button className="done-btn loops-add" onClick={() => setAdding(true)} data-testid="open-loops-add">+ Add a loop</button>}

      <h2 className="email-map-business-name loops-parked-h">Parked ideas</h2>
      <p className="brain-hint">No dates and no chasing. Bring one back when you want it.</p>
      {parked.length === 0 ? <p className="brain-hint">Nothing parked.</p> : (
        <div className="brain-cards" data-testid="open-loops-parked">{parked.map((l) => <Parked key={l.id} loop={l} onChanged={load} />)}</div>
      )}

      {closed.length > 0 && (
        <details className="brain-expander loops-closed">
          <summary>Closed in the last 30 days ({closed.length}) · Show ▾</summary>
          <ul className="schedule-list">{closed.map((l) => <li key={l.id}>{l.title}: {l.closed_reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ loop, data, onChanged }: { loop: Loop; data: Data; onChanged: () => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "done">("view");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const late = isOverdue(loop, data.today);
  const deep = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("loop") === loop.id;
  useEffect(() => { if (deep) document.getElementById(`loop-${loop.id}`)?.scrollIntoView({ block: "center" }); }, [deep, loop.id]);
  const act = (p: Promise<unknown>) => p.then(() => { setMode("view"); onChanged(); }).catch((e) => setErr(e?.message ?? "That did not save. Try again."));
  if (mode === "edit") return <Editor data={data} loop={loop} onDone={() => { setMode("view"); onChanged(); }} />;
  return (
    <div className={`brain-card email-map-card${deep ? " loops-focus" : ""}`} id={`loop-${loop.id}`} data-testid={`open-loop-${loop.id}`}>
      <span className="email-map-what">{loop.title}</span>
      {late && <span className="loops-nudge">Did this happen? It was due {dayWords(loop.next_date)}.</span>}
      <span className="brain-card-line">Finish line: {loop.finish_line}</span>
      {loop.next_step && <span className="brain-card-line">Next: {loop.next_step}</span>}
      <span className="email-map-runs">{ownerWords(loop.owner, data.names)}{loop.next_date ? ` · ${late ? "was due" : "by"} ${dayWords(loop.next_date)}` : " · no date yet"}</span>
      {mode === "done" ? (
        <div className="loops-confirm">
          <label className="field"><span>What's the real outcome?</span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Live in both stores and selling" autoFocus />
          </label>
          <div className="t-actions">
            <button className="done-btn send-btn" disabled={!why.trim()} onClick={() => act(api.closeOpenLoop(loop.id, why.trim()))}>✓ Close it</button>
            <button className="done-btn" onClick={() => setMode("view")}>Keep it open</button>
          </div>
        </div>
      ) : (
        <div className="t-actions loops-actions">
          <button className="done-btn" onClick={() => setMode("edit")}>Edit ✎</button>
          <button className="done-btn" onClick={() => setMode("done")}>✓ Done</button>
          <button className="done-btn loops-quiet" onClick={() => act(api.updateOpenLoop(loop.id, { section: "parked" }))}>Move to parked</button>
        </div>
      )}
      {err && <span className="brain-card-line">{err}</span>}
    </div>
  );
}

function Parked({ loop, onChanged }: { loop: Loop; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="brain-card email-map-card" data-testid={`parked-loop-${loop.id}`}>
      <span className="email-map-what">{loop.title}</span>
      <span className="brain-card-line">{loop.finish_line}</span>
      {loop.next_step && <span className="brain-card-line">When it comes back: {loop.next_step}</span>}
      <div className="t-actions">
        <button className="done-btn" onClick={() => api.updateOpenLoop(loop.id, { section: "not_finished" }).then(onChanged).catch((e) => setErr(e?.message ?? "That did not save."))}>↑ Bring back</button>
      </div>
      {err && <span className="brain-card-line">{err}</span>}
    </div>
  );
}

function Editor({ data, loop, onDone }: { data: Data; loop?: Loop; onDone: () => void }) {
  const [f, setF] = useState({
    title: loop?.title ?? "", finish_line: loop?.finish_line ?? "", next_step: loop?.next_step ?? "",
    owner: loop?.owner ?? "claude", next_date: loop?.next_date ?? "", business: loop?.business ?? "personal",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const owners = [...OWNERS, ...Object.keys(data.names)];
  const save = () => {
    const body = { ...f, next_step: f.next_step || null, next_date: f.next_date || null };
    (loop ? api.updateOpenLoop(loop.id, body) : api.createOpenLoop(body)).then(onDone).catch((e) => setErr(e?.message ?? "That did not save. Try again."));
  };
  return (
    <div className="brain-card email-map-card" data-testid="open-loop-editor">
      <label className="field"><span>What it is</span><input value={f.title} onChange={set("title")} /></label>
      <label className="field"><span>Finish line (the real outcome)</span><input value={f.finish_line} onChange={set("finish_line")} placeholder="Live, selling, in store" /></label>
      <label className="field"><span>Next step</span><input value={f.next_step} onChange={set("next_step")} /></label>
      <label className="field"><span>Who</span>
        <select value={f.owner} onChange={set("owner")}>{owners.map((o) => <option key={o} value={o}>{ownerWords(o, data.names)}</option>)}</select>
      </label>
      <label className="field"><span>Next date</span><input type="date" value={f.next_date} onChange={set("next_date")} /></label>
      <label className="field"><span>Business</span>
        <select value={f.business} onChange={set("business")}>{ORDER.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
      </label>
      <div className="t-actions">
        <button className="done-btn send-btn" onClick={save} disabled={!f.title.trim() || !f.finish_line.trim()}>Save</button>
        <button className="done-btn" onClick={onDone}>Cancel</button>
      </div>
      {err && <span className="brain-card-line">{err}</span>}
    </div>
  );
}
