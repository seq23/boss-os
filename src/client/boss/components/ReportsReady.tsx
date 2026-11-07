import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * REPORTS READY, IN HER INBOX (owner, 6 Nov 2026: the DNA report "should have been in my inbox
 * waiting for me inside boss os"). Every research page delivered in the last 14 days, newest first:
 * its title, who wrote it and when, the 1-minute answer, and "Open ›" to the full page. A list part
 * with nothing in it is not drawn; a list that did not load says so.
 */
export const REPORTS_READY_DAYS = 14;

type Page = { id: string; state: string; title: string | null; summary: string | null; status: string | null; question: string | null; delivered_at: number | null };

export function reportsReady(items: Page[], now = Date.now()): Page[] {
  const since = now - REPORTS_READY_DAYS * 86_400_000;
  return items
    .filter((p) => p.state === "delivered" && typeof p.delivered_at === "number" && p.delivered_at >= since)
    .sort((a, b) => (b.delivered_at ?? 0) - (a.delivered_at ?? 0));
}

const when = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function ReportsReady() {
  const [items, setItems] = useState<Page[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.researchPages().then((r) => { if (live) setItems(reportsReady(r.items ?? [])); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (failed) return <p className="row-sub" data-testid="reports-ready-failed">Your research reports did not load. Reload the page to try again.</p>;
  if (!items || items.length === 0) return null;
  return (
    <section className="inbox-group" data-testid="reports-ready">
      <h3>Reports ready ({items.length})</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((p) => (
          <li key={p.id} className="row" data-testid="report-ready-row" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{p.title || p.question || "Research report"}</div>
              <div className="row-sub">Camille · {when(p.delivered_at as number)}{p.status && p.status !== "complete" ? " · some things couldn't be confirmed" : ""}</div>
              {p.summary && <div className="row-sub" style={{ marginTop: 4, overflowWrap: "anywhere" }}>{p.summary}</div>}
            </div>
            <a className="btn btn-small" href={`/research/${encodeURIComponent(p.id)}`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Open ›</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
