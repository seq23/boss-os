import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type BrainFull, type BrainRevision, type BrainSummary, type ScoreRow } from "../api";
import { Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * BRAINS (owner, 31 Oct 2026). One document per business, the single source of truth every
 * employee reads first. Phone first (390px), calm: a summary line, then one list of cards. Tap a
 * card to read its brain section by section; every section has "Edit this section"; every gap
 * ([MISSING]) is yellow with a one-tap "Fill this in"; the history sits under a labelled expander;
 * "← Back" everywhere. The scoreboard is a labelled expander on the same page.
 *
 * Links in: /?tab=brains, /?tab=brains&brain=<slug>, /?tab=brains&view=scoreboard.
 */
const MISSING = "[MISSING]";
/** A plain document (the team's who's who) has no sections: it is read and edited whole. */
const WHOLE = "__whole__";
const DAY = 86_400_000;

function updatedWords(at: number, now = Date.now()) {
  const d = Math.max(0, Math.floor((now - at) / DAY));
  return d === 0 ? "Updated today" : d === 1 ? "Updated yesterday" : `Updated ${d} days ago`;
}
const gapWords = (n: number) => (n === 0 ? "All filled in" : `${n} ${n === 1 ? "gap" : "gaps"} to fill`);
const when = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Brains() {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [open, setOpen] = useState<string | null>(q.get("brain"));
  const [scoreOpen] = useState(q.get("view") === "scoreboard");
  return open
    ? <BrainView slug={open} onBack={() => setOpen(null)} />
    : <BrainList onOpen={setOpen} scoreOpen={scoreOpen} />;
}

function BrainList({ onOpen, scoreOpen }: { onOpen: (slug: string) => void; scoreOpen: boolean }) {
  const [list, setList] = useState<BrainSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.brains().then((d) => setList(d.brains)).catch((e) => { setError(e); setList([]); }); }, []);
  const gaps = (list ?? []).reduce((s, b) => s + b.missing_count, 0);
  const stale = (list ?? []).filter((b) => b.stale).length;
  return (
    <div className="brains">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <p className="brain-summary">
        {list === null ? "Loading your brains…"
          : `${list.length} brains · ${gaps === 0 ? "nothing left to fill" : gapWords(gaps)}${stale ? ` · ${stale} not updated in 90+ days` : ""}`}
      </p>
      <p className="brain-hint">Each brain is what your team reads first about that business. Tap one to read or change it.</p>
      <Scoreboard startOpen={scoreOpen} />
      {list === null ? <Loading /> : list.length === 0 ? <p className="brain-hint">No brains came back. Try again in a minute.</p> : (
        <div className="brain-cards">
          {list.map((b) => (
            <button key={b.slug} className="brain-card" onClick={() => onOpen(b.slug)} data-testid={`brain-${b.slug}`}>
              <span className="brain-card-title">{b.title}</span>
              <span className={b.stale ? "brain-card-line brain-warn" : "brain-card-line"}>
                {updatedWords(b.updated_at)}{b.stale ? " — worth a look" : ""}
              </span>
              <span className={b.missing_count ? "brain-card-line brain-warn" : "brain-card-line brain-ok"}>{gapWords(b.missing_count)}</span>
              <span className="brain-card-open">Tap to open ›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One row per business and metric from each Numbers table. "not tracked yet" when there is no value; never a guess. */
function Scoreboard({ startOpen }: { startOpen: boolean }) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { api.scoreboard().then((d) => setRows(d.rows)).catch((e) => { setError(e); setRows([]); }); }, []);
  useEffect(() => { if (startOpen) ref.current?.scrollIntoView({ block: "start" }); }, [startOpen]);
  return (
    <details className="brain-expander" open={startOpen} ref={ref} data-testid="scoreboard">
      <summary>Scoreboard: the numbers for every business ▾</summary>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {rows === null ? <p className="brain-hint">Loading the numbers…</p> : rows.length === 0 ? <p className="brain-hint">No numbers yet.</p> : (
        <div className="brain-tablewrap">
          <table className="brain-table">
            <thead><tr><th>Business</th><th>Metric</th><th>Value</th><th>Last updated</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.slug}-${i}`}>
                  <td>{r.business}</td>
                  <td>{r.metric ?? "—"}</td>
                  <td className={r.value ? "" : "brain-quiet"}>{r.value ?? "not tracked yet"}</td>
                  <td>{r.last_updated ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="brain-hint">Numbers come from each brain's Numbers section. Change them there, or email Simone, for example "P&amp;P brain: set Revenue to 12,000".</p>
    </details>
  );
}

function BrainView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [brain, setBrain] = useState<BrainFull | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { api.brain(slug).then(setBrain).catch(setError); }, [slug]);
  // Back to the same place after saving: the section just saved stays on screen.
  useEffect(() => {
    if (saved) document.getElementById(`brain-sec-${saved}`)?.scrollIntoView({ block: "start" });
  }, [saved, brain]);

  function startEdit(section: string, body: string, fill = false) {
    setSaved(null);
    setEditing(section);
    setDraft(body);
    setTimeout(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      if (fill) { const at = body.indexOf(MISSING); if (at >= 0) box.setSelectionRange(at, at + MISSING.length); }
    }, 0);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const next = editing === WHOLE ? await api.saveBrainBody(slug, draft) : await api.saveBrainSection(slug, editing, draft);
      setBrain(next);
      setSaved(editing);
      setEditing(null);
      setHistoryKey((k) => k + 1);
    } catch (e) { setError(e); } finally { setSaving(false); }
  }

  const back = <div className="page-back"><button className="btn" onClick={onBack}>← Back to all brains</button></div>;
  if (!brain) return <>{back}<ErrorNotice error={error} onDismiss={() => setError(null)} />{!error && <Loading />}</>;

  return (
    <div className="brains">
      {back}
      <h2 className="brain-title">{brain.title}</h2>
      <p className={brain.stale ? "brain-card-line brain-warn" : "brain-card-line"}>
        {updatedWords(brain.updated_at)}{brain.updated_by ? ` by ${brain.updated_by === "seed" ? "Boss OS (blank to start)" : brain.updated_by}` : ""} · {gapWords(brain.missing_count)}
      </p>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {brain.sections.length === 0 && (
        <section id={`brain-sec-${WHOLE}`} className="panel brain-section" data-testid="section-whole">
          {saved === WHOLE && <p className="brain-saved">Saved. Your team reads this from now on.</p>}
          {editing === WHOLE ? (
            <>
              <label className="brain-hint" htmlFor="edit-whole">Change the words below, then tap Save.</label>
              <textarea id="edit-whole" ref={boxRef} className="brain-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(24, Math.max(8, draft.split("\n").length + 2))} />
              <div className="btn-row">
                <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save this page"}</button>
                <button className="btn" disabled={saving} onClick={() => setEditing(null)}>Cancel (keep it as it was)</button>
              </div>
            </>
          ) : (
            <>
              <BrainText text={brain.body_md.replace(/^#\s+.*\n?/, "")} onFill={() => startEdit(WHOLE, brain.body_md, true)} />
              <div className="btn-row"><button className="btn" onClick={() => startEdit(WHOLE, brain.body_md)}>Edit this page</button></div>
            </>
          )}
        </section>
      )}
      {brain.sections.map((s) => (
        <section key={s.name} id={`brain-sec-${s.name}`} className="panel brain-section" data-testid={`section-${s.name}`}>
          <h3 className="brain-section-h">{s.name}</h3>
          {saved === s.name && <p className="brain-saved">Saved. Your team reads this from now on.</p>}
          {editing === s.name ? (
            <>
              <label className="brain-hint" htmlFor={`edit-${s.name}`}>Change the words below, then tap Save. Leave [MISSING] where you do not know yet.</label>
              <textarea id={`edit-${s.name}`} ref={boxRef} className="brain-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(18, Math.max(5, draft.split("\n").length + 2))} />
              <div className="btn-row">
                <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save this section"}</button>
                <button className="btn" disabled={saving} onClick={() => setEditing(null)}>Cancel (keep it as it was)</button>
              </div>
            </>
          ) : (
            <>
              <BrainText text={s.body} onFill={() => startEdit(s.name, s.body, true)} />
              <div className="btn-row">
                <button className="btn" onClick={() => startEdit(s.name, s.body)}>Edit this section</button>
              </div>
            </>
          )}
        </section>
      ))}
      <History key={historyKey} slug={slug} />
      {back}
    </div>
  );
}

function History({ slug }: { slug: string }) {
  const [revs, setRevs] = useState<BrainRevision[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.brainRevisions(slug).then((d) => setRevs(d.revisions)).catch((e) => { setError(e); setRevs([]); }); }, [slug]);
  return (
    <details className="brain-expander" data-testid="brain-history">
      <summary>History: {revs === null ? "loading…" : revs.length === 0 ? "no changes yet" : `${revs.length} ${revs.length === 1 ? "change" : "changes"}`} ▾ Show</summary>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {revs === null ? <p className="brain-hint">Loading the history…</p> : revs.length === 0 ? <p className="brain-hint">Nothing has been changed yet.</p> : revs.map((r) => (
        <details key={r.id} className="brain-rev">
          <summary>{when(r.changed_at)} · {r.note ?? "Edited"} · {r.changed_by} ▾ Show this version</summary>
          <pre className="brain-pre">{r.body_md}</pre>
        </details>
      ))}
    </details>
  );
}

// ─── A small markdown reader: paragraphs, lists, the Numbers table, gaps and private parts ───

const OPEN = /<!--\s*confidential\s*-->/i;
const CLOSE = /<!--\s*\/\s*confidential\s*-->/i;

function splitPrivate(text: string): { text: string; private: boolean }[] {
  const out: { text: string; private: boolean }[] = [];
  let rest = text;
  for (;;) {
    const o = OPEN.exec(rest);
    if (!o) { if (rest) out.push({ text: rest.replace(new RegExp(CLOSE.source, "gi"), ""), private: false }); break; }
    if (o.index) out.push({ text: rest.slice(0, o.index), private: false });
    const after = rest.slice(o.index + o[0].length);
    const c = CLOSE.exec(after);
    if (!c) { out.push({ text: after, private: true }); break; }
    out.push({ text: after.slice(0, c.index), private: true });
    rest = after.slice(c.index + c[0].length);
  }
  return out;
}

function inline(text: string, onFill: () => void): ReactNode[] {
  return text.split(MISSING).flatMap((part, i) => i === 0 ? [part] : [
    <Fragment key={i}><mark className="brain-gap">Not written yet</mark> <button className="btn btn-small brain-fill" onClick={onFill}>Fill this in</button> </Fragment>, part,
  ]);
}

function BrainText({ text, onFill }: { text: string; onFill: () => void }) {
  return (
    <>
      {splitPrivate(text).map((seg, i) => seg.private ? (
        <div key={i} className="brain-private">
          <span className="brain-private-l">Private — only your Claude seat sees this</span>
          <Blocks text={seg.text} onFill={onFill} />
        </div>
      ) : <Blocks key={i} text={seg.text} onFill={onFill} />)}
    </>
  );
}

function Blocks({ text, onFill }: { text: string; onFill: () => void }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) { i++; continue; }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div className="brain-tablewrap" key={`t${i}`}>
          <table className="brain-table">
            {head && <thead><tr>{head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>}
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, onFill)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^([-*•]|\d+[.)])\s+/.test(line)) {
      const numbered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^([-*•]|\d+[.)])\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const lis = items.map((t, k) => <li key={k}>{inline(t, onFill)}</li>);
      out.push(numbered ? <ol className="brain-ol" key={`l${i}`}>{lis}</ol> : <ul className="brain-ul" key={`l${i}`}>{lis}</ul>);
      continue;
    }
    out.push(<p className="brain-p" key={`p${i}`}>{inline(line.replace(/^#{3,}\s+/, ""), onFill)}</p>);
    i++;
  }
  return <>{out}</>;
}
