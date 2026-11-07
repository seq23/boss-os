import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { go } from "../nav";
import { Loading } from "../components/Shell";
import { updatesLine, updatesSummary, type UpdateRow } from "@shared/boss/mail/noticeGate.mjs";

/**
 * UPDATES (owner, 7 Nov 2026: "either consolidate the emails or make those notifications on some
 * page inside boss os only"). ☰ More → Updates, /?tab=updates.
 *
 * Everything Simone and Kendra used to email "just so you know" (reminders, Done notices for work a
 * job started, pauses, the Mac disk line) lands here instead; the morning email carries one count
 * line read from the same route. One list, newest first: a tick to mark it read, the title, one grey
 * sub line, "Open ›". The row never moves when ticked.
 */
const when = (ms: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms)).replace(",", "");

export function Updates() {
  const [rows, setRows] = useState<UpdateRow[] | undefined>(undefined);
  const [days, setDays] = useState(7);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => api.updates().then((d) => { setRows(d.rows); setDays(d.days); setFailed(false); }).catch(() => { setFailed(true); setRows((r) => r ?? []); }), []);
  useEffect(() => { void load(); }, [load]);
  if (rows === undefined) return <Loading />;
  const line = updatesLine(updatesSummary(rows));
  const tick = (r: UpdateRow) => {
    const read = r.read_at == null;
    setRows((all) => all?.map((x) => (x.id === r.id ? { ...x, read_at: read ? Date.now() : null } : x)));
    api.markUpdateRead(r.id, read).catch(() => setRows((all) => all?.map((x) => (x.id === r.id ? r : x))));
  };
  return (
    <div className="brains" data-testid="updates">
      <p className="brain-summary" data-testid="updates-summary">
        {failed ? "Updates did not load. Try again in a minute." : line ?? "All read. Nothing new from the team."}
      </p>
      <p className="brain-hint">News from the team that needs nothing from you, from the last {days} days. Anything you must decide still comes by email.</p>
      {!failed && rows.length === 0 && <p className="brain-hint">No updates this week.</p>}
      {rows.map((r) => (
        <div key={r.id} className="t-row" data-testid={`update-${r.id}`}>
          <div className="t-row-top">
            <button type="button" className="tick" aria-pressed={r.read_at != null} aria-label={r.read_at != null ? `${r.title}: read. Tap to mark unread` : `${r.title}: tick when read`} onClick={() => tick(r)}>
              {r.read_at != null ? "✓" : ""}
            </button>
            <div>
              <div className="t-row-title">{r.title}</div>
              <div className="t-row-sub">{r.from} · {when(r.at)}{r.line ? ` · ${r.line}` : ""}</div>
            </div>
            <button type="button" className="t-open" onClick={() => (r.link.startsWith("/research/") ? window.location.assign(r.link) : go(r.link))}>Open ›</button>
          </div>
        </div>
      ))}
    </div>
  );
}
