/**
 * Deals page → "LP replies" (Boss fix L, ruling 10; mock-up board 6, top half).
 *
 * Every positive LP reply, checked each morning against sequoia@westpeek.ventures. One row each:
 * who, what they said and when, the tracker status, and one link that opens the real thing in Gmail
 * (the held draft, or the thread). Builder D mounts this in Capital.tsx.
 */
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Empty, Loading } from "../../components/Shell";
import { gmailDraftUrl, gmailThreadUrl } from "../../../../shared/boss/lp/plan.mjs";

/** Waiting on her = live; done = good; skipped = quiet. Colours come from the shared state classes. */
const PILL: Record<string, string> = {
  drafted: "pill state-live",
  replied_again: "pill state-live",
  not_answered: "pill state-live",
  scheduled: "pill",
  sent: "pill state-good",
  skipped: "pill state-quiet",
};
const ORDER = ["drafted", "not_answered", "replied_again", "scheduled", "sent", "skipped"];
const day = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function lpRowsInOrder(rows: any[]): any[] {
  return [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(a.first_seen).localeCompare(String(b.first_seen)));
}

export function LpTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.lpReplies().then((d) => setRows(d.rows ?? [])).catch(() => setFailed(true));
  }, []);
  if (failed) return <div className="row-sub">The LP replies could not be read just now. This is not saying there are none.</div>;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <Empty title="No positive LP replies yet" hint="Monique checks the West Peek mailbox every morning." />;
  return (
    <div data-testid="lp-tab">
      <p className="row-sub" style={{ marginBottom: 10 }}>Checked every morning against sequoia@westpeek.ventures (sent mail). A reply you scheduled in Gmail shows as waiting until it goes out.</p>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>{["LP", "They replied", "Status", "When", "Next"].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 10px", fontSize: 12 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {lpRowsInOrder(rows).map((r) => {
              const draft = r.status === "drafted";
              return (
                <tr key={r.id}>
                  <td style={{ padding: "9px 10px" }}><b>{r.name || "—"}</b>{r.firm ? ` · ${r.firm}` : ""}<div className="row-sub">{r.address}</div></td>
                  <td style={{ padding: "9px 10px" }}>{r.first_seen}{r.quote ? ` · "${String(r.quote).slice(0, 80)}"` : ""}
                    {r.said || r.draft_body || r.last_reply_text ? (
                      <details className="mi-more">
                        <summary>Show what they wrote{r.draft_body ? " and your reply" : ""} ▾</summary>
                        {r.said ? <><p className="eyebrow">What they wrote</p><div className="mi-draft">{r.said}</div></> : null}
                        {r.last_reply_text ? <><p className="eyebrow">What they wrote after your reply</p><div className="mi-draft">{r.last_reply_text}</div></> : null}
                        {r.draft_body ? <><p className="eyebrow">Your reply, word for word (Send as is sends exactly this)</p><div className="mi-draft">{r.draft_body}</div></> : null}
                      </details>
                    ) : null}
                  </td>
                  <td style={{ padding: "9px 10px" }}><span className={PILL[r.status] ?? "pill"}>{r.status_label}</span>{r.send_error ? <div className="row-sub">Not sent: {r.send_error}</div> : null}</td>
                  <td style={{ padding: "9px 10px" }}>{r.status === "sent" || r.status === "replied_again" ? day(r.sent_at) : "—"}</td>
                  <td style={{ padding: "9px 10px" }}>
                    <a href={draft ? gmailDraftUrl(r.draft_message_id) : gmailThreadUrl(r.thread_id)} target="_blank" rel="noreferrer">{draft ? "Open the draft" : "Open the email"}</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
