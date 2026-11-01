/**
 * Deals page → "Prospects" (Boss fix L, rulings 11 and 12; mock-up board 6, bottom half).
 *
 * Everyone Monique writes to on the prospect sequence: where they were found, how many touches
 * (the first email and ONE follow-up, then the sequence is complete; owner, 24 Oct 2026), their side once they reply (Buyer / Seller / Both), and the
 * 8Raise credits used this month. Filters are pull-downs. Builder D mounts this in Capital.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Empty, Loading } from "../../components/Shell";
import { MAX_TOUCHES, TOUCH_DAYS, MIN_TOUCH_GAP_DAYS, eightRaiseFooter, gmailThreadUrl } from "../../../../shared/boss/lp/plan.mjs";

const SOURCE: Record<string, string> = {
  "8raise_2026_10_11": "First batch (11 Oct)",
  inbox: "Wrote to you about a deal",
  sec_form_d: "SEC filings (SPV manager)",
  sec_13f: "SEC filings (13F)",
  "8raise_lp_mode": "8Raise",
};
const sourceLabel = (s: string) => SOURCE[s] ?? (s.startsWith("8raise") ? "8Raise" : s.replace(/_/g, " "));
const STATUS: Record<string, string> = {
  new: "Not written to yet", active: "No reply yet", interested: "Wants to talk", replied: "Replied",
  opted_out: "Asked not to be emailed", bounced: "Address did not work", done: "Sequence complete",
};
const SIDE: Record<string, string> = { buyer: "Buyer", seller: "Seller", both: "Both", unknown: "—" };
const DAY = 86_400_000;
const day = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function nextTouchLabel(p: any): string {
  if (!["new", "active"].includes(p.status)) return p.status === "done" ? "— sequence complete" : "— stopped";
  if (p.touches >= MAX_TOUCHES) return "— sequence complete";
  if (!p.first_sent_at) return "Next sending day";
  const due = Math.max(p.first_sent_at + (TOUCH_DAYS[p.touches] ?? 0) * DAY, (p.last_touch_at ?? 0) + MIN_TOUCH_GAP_DAYS * DAY);
  return `${day(due)}${p.touches + 1 === MAX_TOUCHES ? " (the one follow-up, the last)" : ""}`;
}

export function ProspectsTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [credits, setCredits] = useState<{ used: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [side, setSide] = useState("all");
  // What went out, word for word, and why nothing did (owner, 24 Oct 2026: keep me abreast).
  const [activity, setActivity] = useState<any>(null);
  useEffect(() => {
    api.prospectActivity(0).then(setActivity).catch(() => setActivity(null));
    api.prospects().then((d) => setRows(d.rows ?? [])).catch(() => setFailed(true));
    api.eightRaise().then((d) => setCredits({ used: d.used ?? 0 })).catch(() => setCredits(null));
  }, []);
  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (source === "all" || sourceLabel(r.source) === source) && (status === "all" || r.status === status) && (side === "all" || r.side === side)), [rows, source, status, side]);
  if (failed) return <div className="row-sub">The prospects could not be read just now. This is not saying there are none.</div>;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <Empty title="No prospects yet" hint="Monique imports the first batch and adds new ones every Monday." />;
  const count = (f: (r: any) => boolean) => rows.filter(f).length;
  const weekAgo = Date.now() - 7 * DAY;
  const stats = [
    { v: count((r) => r.source === "8raise_2026_10_11"), k: "first batch emailed" },
    { v: count((r) => r.status === "interested"), k: "want to talk" },
    { v: count((r) => r.created_at >= weekAgo), k: "new this week" },
    { v: count((r) => r.touches >= 2), k: "had a follow-up" },
  ];
  const sources = [...new Set(rows.map((r) => sourceLabel(r.source)))];
  const select = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <label className="row-sub" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="all">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div data-testid="prospects-tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {stats.map((s) => (
          <div key={s.k} className="panel" style={{ padding: "12px 16px", minWidth: 150 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.v}</div>
            <div className="row-sub">{s.k}</div>
          </div>
        ))}
      </div>
      {activity ? <ActivityPanel a={activity} /> : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {select("Found via", source, setSource, sources.map((s) => [s, s]))}
        {select("Status", status, setStatus, Object.entries(STATUS))}
        {select("Side", side, setSide, Object.entries(SIDE).filter(([k]) => k !== "unknown"))}
      </div>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="phone-cards" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>{["Prospect", "Email", "Found via", "Touches", "Last sent", "Sent from", "Side", "Status", "Next touch"].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 10px", fontSize: 12 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td data-label="Prospect" style={{ padding: "9px 10px" }}><b>{p.name || "—"}</b>{p.firm ? ` · ${p.firm}` : ""}</td>
                <td data-label="Email" style={{ padding: "9px 10px" }}>{p.email ?? "—"}</td>
                <td data-label="Found via" style={{ padding: "9px 10px" }}>{sourceLabel(p.source)}</td>
                <td data-label="Touches" style={{ padding: "9px 10px" }}>{p.touches} of {MAX_TOUCHES}</td>
                <td data-label="Last sent" style={{ padding: "9px 10px" }}>{p.thread_id ? <a href={gmailThreadUrl(p.thread_id)} target="_blank" rel="noreferrer">{day(p.last_touch_at)}</a> : day(p.last_touch_at)}</td>
                <td data-label="Sent from" style={{ padding: "9px 10px" }}>{p.sent_from ?? (p.touches > 0 ? "not read yet" : "—")}</td>
                <td data-label="Side" style={{ padding: "9px 10px" }}>{SIDE[p.side] ?? "—"}</td>
                <td data-label="Status" style={{ padding: "9px 10px" }}>{STATUS[p.status] ?? p.status}{p.reply_note ? <div className="row-sub">"{String(p.reply_note).slice(0, 80)}"</div> : null}</td>
                <td data-label="Next touch" style={{ padding: "9px 10px" }}>{nextTouchLabel(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="row-sub">
        {MAX_TOUCHES} emails at most (the first and one follow-up), then they stop. Anyone who replies or opts out is never emailed again. At most 20 new a day.
        {credits ? ` ${eightRaiseFooter(credits.used)}.` : ""}
      </p>
    </div>
  );
}

const TAP = (token: string, action: string) => `/tap/${encodeURIComponent(token)}?do=${action}`;

/** Why nothing is going out, the email waiting for her OK, and every email sent with its words. */
function ActivityPanel({ a }: { a: any }) {
  const sent: any[] = a.sent ?? [];
  return (
    <div className="panel" style={{ padding: "12px 16px" }} data-testid="prospects-activity">
      {(a.stops ?? []).length ? (
        <p className="mi-lede"><b>Nothing is going out right now.</b> Why: {(a.stops as string[]).join(" ")}</p>
      ) : <p className="mi-lede">Sending on schedule: weekdays, 9 to 5 Central, up to 20 new people a day.</p>}
      {a.pending ? (
        <details className="mi-more" open>
          <summary>The email waiting for your OK — tap to hide ▴</summary>
          <div className="mi-draft">{`Subject: ${a.pending.subject}\n\n${a.pending.body}`}</div>
          {a.pending.tap_token ? (
            <div className="btn-row mi-buttons">
              <a className="btn btn-small btn-primary" href={TAP(a.pending.tap_token, "approve")}>Approve</a>
              <a className="btn btn-small" href={TAP(a.pending.tap_token, "edit")}>Change</a>
            </div>
          ) : null}
        </details>
      ) : null}
      <p className="eyebrow" style={{ marginTop: 10 }}>Emails sent ({a.totals?.emails_sent ?? sent.length})</p>
      {sent.length === 0 ? <p className="row-sub">None recorded with their words yet.</p> : sent.map((r: any, i: number) => (
        <details key={i} className="mi-more">
          <summary>{day(r.sent_at)} · email {r.touch_no} of {MAX_TOUCHES} to {r.name || r.email}{r.firm ? `, ${r.firm}` : ""} ({r.email}){r.sent_from ? `, from ${r.sent_from}` : ""} — tap to read ▾</summary>
          <div className="mi-draft">{r.body ? `Subject: ${r.sent_subject ?? r.subject ?? ""}\n\n${r.body}` : "Its words were not kept (it went before 24 October); it is in your Sent mail."}</div>
          {r.thread_id ? <a className="btn btn-small" href={gmailThreadUrl(r.thread_id)} target="_blank" rel="noreferrer">Open the thread</a> : null}
        </details>
      ))}
    </div>
  );
}
