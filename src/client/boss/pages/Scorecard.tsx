import { useEffect, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import manifest from "@shared/boss/scorecard/manifest.json";
import sites from "@shared/boss/searchReadiness/sites.json";
import { floorDate, floorWords, groupByBusiness, shortDate, trend, valueWords } from "@shared/boss/scorecard/scorecard.mjs";

/**
 * THE SCORECARD (owner ruling, 1 Nov 2026: "nothing runs unmeasured"). ☰ More → Scorecard, /?tab=scorecard.
 *
 * The rows are src/shared/boss/scorecard/manifest.json (imported, never copied); what each row has done
 * is the record the Monday run keeps (GET /api/boss/scorecard). Phone first, calm: line 1 says how
 * many need a look; then one section per business, brokerage first, West Peek Ventures second; each
 * initiative one card — its state, this week's number against its floor, an 8-week trend, the next
 * check date and, folded, what was tried. Friends' sites sit at the bottom: they keep their own rows.
 * Not read yet is said, never shown as all clear.
 */
type Rec = { start?: string | null; bOn?: string | null; pausedOn?: string | null; restartToken?: string | null; history?: Array<{ week: string; state: string; first: number | null; real: number | null; note: string }> };
type RowState = { state: string; note: string; next: string | null; record: Rec };
type Stray = { key: string; name: string; where: string; found: string; note: string };
const SC = manifest as any;
const NEEDS = new Set(["Trying version B", "Paused", "No number"]);
const TONE: Record<string, string> = { "On track": "scorecard-ok", "Too early": "scorecard-early", "Trying version B": "scorecard-gold", Paused: "scorecard-gold", "No number": "scorecard-red" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function Scorecard() {
  const [data, setData] = useState<{ state: { at: number; week: string; rows: Record<string, RowState> } | null; strays: Stray[] } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.scorecard().then(setData).catch(() => { setFailed(true); setData({ state: null, strays: [] }); }); }, []);
  if (data === undefined) return <Loading />;
  const rows = data.state?.rows ?? {};
  const states = SC.rows.map((r: any) => rows[r.id]?.state ?? "Not read yet");
  const look = states.filter((s: string) => NEEDS.has(s)).length + data.strays.length;
  const friends = ((sites as any).grid_repos ?? []).filter((s: any) => s.category === "client");
  return (
    <div className="brains" data-testid="scorecard">
      <p className="brain-summary" data-testid="scorecard-summary">
        {failed ? "The scorecard did not load. Try again in a minute."
          : !data.state ? `${plural(SC.rows.length, "initiative")} · first read on Monday morning`
          : look ? `${plural(SC.rows.length, "initiative")} · ${look} need${look === 1 ? "s" : ""} a look` : `${plural(SC.rows.length, "initiative")} · nothing needs a look`}
      </p>
      <p className="brain-hint">Each initiative's real result against its floor. A miss tries version B once, then pauses; nothing is deleted.{data.state ? ` Read ${shortDate(data.state.week)}.` : ""}</p>
      {groupByBusiness(SC).map((g) => (
        <section key={g.key} className="scorecard-business" data-testid={`scorecard-business-${g.key}`}>
          <h2 className="email-map-business-name">{g.label}</h2>
          <div className="brain-cards">{g.rows.map((r: any) => <Card key={r.id} row={r} st={rows[r.id]} />)}</div>
        </section>
      ))}
      {data.strays.length > 0 && (
        <section className="scorecard-business" data-testid="scorecard-strays">
          <h2 className="email-map-business-name">Running with no row yet</h2>
          <p className="brain-hint">Kendra found these running with no scorecard row; each has a default row until its source is wired.</p>
          <div className="brain-cards">{data.strays.map((s) => (
            <div key={s.key} className="brain-card email-map-card"><span className="email-map-what">{s.name}</span><span className="brain-card-line">{s.where} · found {shortDate(s.found)}</span><span className="scorecard-state scorecard-red">No number</span></div>
          ))}</div>
        </section>
      )}
      <section className="scorecard-business" data-testid="scorecard-friends">
        <h2 className="email-map-business-name">Friends' sites</h2>
        <p className="brain-hint">Each keeps its own scorecard in its own repo and reaches your email only when something breaks.</p>
        <ul className="schedule-list">{friends.map((f: any) => <li key={f.domain}>{f.label ?? f.domain}</li>)}</ul>
      </section>
    </div>
  );
}

function Spark({ values }: { values: Array<number | null> }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const max = Math.max(...nums, 1);
  const w = 80; const h = 20; const step = w / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)).filter(Boolean).join(" ");
  return <svg className="scorecard-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Eight-week trend"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function Card({ row, st }: { row: any; st?: RowState }) {
  const state = st?.state ?? "Not read yet";
  const last = st?.record?.history?.at(-1);
  const start = st?.record?.start ?? row.start;
  const judging = start && floorDate(row.real.by, start)! <= (last?.week ?? "") ? "real" : "first";
  const m = row[judging];
  const value = last ? (judging === "real" ? last.real : last.first) : null;
  const deep = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("row") === row.id;
  return (
    <div className="brain-card email-map-card" data-testid={`scorecard-row-${row.id}`} id={`row-${row.id}`}>
      <span className="email-map-what">{row.initiative}</span>
      <span className={`scorecard-state ${TONE[state] ?? "scorecard-early"}`}>{state}</span>
      <span className="brain-card-line">{last ? `This week: ${valueWords(m, value)} ${m.label}` : "Not read yet"} · floor {floorWords(m)}{start ? ` by ${shortDate(floorDate(m.by, start))}` : ""}</span>
      <Spark values={trend(st?.record, judging)} />
      {st?.note ? <span className="brain-card-line">{st.note}</span> : null}
      {st?.next ? <span className="email-map-runs">Next check {shortDate(st.next)}</span> : null}
      {state === "Paused" && st?.record?.restartToken ? <a className="brain-card-open" href={`/tap/${st.record.restartToken}`}>Restart it ›</a> : null}
      <details className="brain-expander" open={deep}>
        <summary>Show what counts and what was tried ▾</summary>
        <dl className="email-map-dl">
          <dt>Result that counts</dt><dd>{row.result}</dd>
          <dt>First floor</dt><dd>{floorWords(row.first)} {row.first.label}{start ? `, by ${shortDate(floorDate(row.first.by, start))}` : ""}</dd>
          <dt>Real floor</dt><dd>{floorWords(row.real)} {row.real.label}{start ? `, by ${shortDate(floorDate(row.real.by, start))}` : ""}</dd>
          <dt>Version B</dt><dd>{row.versionB.text}{st?.record?.bOn ? ` Tried since ${shortDate(st.record.bOn)}.` : ""}</dd>
          <dt>Owner</dt><dd>{row.owner}</dd>
          {(st?.record?.history ?? []).length > 0 && <><dt>History</dt><dd>{[...(st!.record.history ?? [])].reverse().slice(0, 8).map((h) => <span key={h.week} className="brain-card-line">{shortDate(h.week)}: {h.state}{h.note ? ` — ${h.note}` : ""}</span>)}</dd></>}
        </dl>
      </details>
    </div>
  );
}
