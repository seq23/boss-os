/**
 * Deals page → "Pre-seed watch" (Monique, owner-approved 26 Oct 2026). Two lists side by side:
 * what crossed her desk and what was funded in the market this week, then what looks alike and the
 * themes she is not seeing. Figures from the news are marked "reported".
 */
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Empty, Loading } from "../../components/Shell";

export function PreseedTab() {
  const [d, setD] = useState<any | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.preseed().then(setD).catch(() => setFailed(true)); }, []);
  if (failed) return <div className="row-sub">The pre-seed lists could not be read just now. This is not saying they are empty.</div>;
  if (!d) return <Loading />;
  if (!d.week) return <Empty title="No pre-seed watch yet" hint="Monique builds it every Monday morning." />;
  const cmp = d.compare ?? {};
  return (
    <div data-testid="preseed-tab">
      <p className="row-sub" style={{ marginBottom: 10 }}>Week of {d.week}. Built by Monique every Monday from your mailboxes and public news.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <section className="panel" aria-label="Crossed your desk">
          <p className="row-title" style={{ marginTop: 0 }}>Crossed your desk ({d.crossed.length})</p>
          {d.crossed.length === 0 ? <p className="row-sub">Nothing at pre-seed or seed this week.</p> : d.crossed.map((r: any, i: number) => (
            <div key={i} className="row" style={{ padding: "6px 0" }}>
              <div className="row-title">{r.company} · {r.sector}{r.round ? ` · ${r.round}` : ""}</div>
              <div className="row-sub">From {r.from ?? "—"} · {r.date}{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">Open the email</a></>}</div>
            </div>
          ))}
        </section>
        <section className="panel" aria-label="Funded in the market">
          <p className="row-title" style={{ marginTop: 0 }}>Funded in the market ({d.funded.length})</p>
          {d.funded.length === 0 ? <p className="row-sub">No pre-seed rounds in the news this week.</p> : d.funded.map((r: any, i: number) => (
            <div key={i} className="row" style={{ padding: "6px 0" }}>
              <div className="row-title">{r.company} · {r.round}{r.lead ? ` · led by ${r.lead}` : ""}</div>
              <div className="row-sub">{r.what ? `${r.what} · ` : ""}{r.sector}{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">Read the source</a></>}</div>
            </div>
          ))}
        </section>
      </div>
      <section className="panel" aria-label="How they compare" style={{ marginTop: 16 }}>
        <p className="row-title" style={{ marginTop: 0 }}>How they compare</p>
        {(cmp.alike ?? []).map((a: any) => <p key={a.sector} className="row-sub">{a.sector}: the market funded {a.market.slice(0, 4).join(", ")}; on your desk: {a.desk.slice(0, 4).join(", ")}.</p>)}
        {(cmp.gaps ?? []).length > 0 && <p className="row-sub">Not reaching you: {cmp.gaps.map((g: any) => `${g.sector} (${g.market.length} in the market)`).join("; ")}.</p>}
        {!(cmp.alike ?? []).length && !(cmp.gaps ?? []).length && <p className="row-sub">Nothing to compare this week.</p>}
      </section>
    </div>
  );
}
