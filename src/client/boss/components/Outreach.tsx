import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "./Shell";
import { ErrorNotice } from "./Notice";

/**
 * MONIQUE'S OUTREACH DESK (owner, 9 Oct 2026: "u do it all"). Fully automatic: nothing here asks
 * her to approve an email. What she can see and touch is the brakes — the kill switch, the sending
 * flag, every automatic pause with its reason, the cap and today's count per domain — and the one
 * thing only she can give each business: the postal address CAN-SPAM requires in every email.
 */
export function OutreachDesk() {
  const [data, setData] = useState<any | null>(null);
  const [refs, setRefs] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<Record<string, string>>({});

  const load = () => {
    api.moniqueOutreach().then(setData).catch(setError);
    api.moniqueOutreachReferrals().then(setRefs).catch(() => setRefs(null));
  };
  useEffect(load, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setNote(done);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <Loading />;
  if (!data) return <ErrorNotice error={error} onDismiss={() => setError(null)} />;

  const killed = data.settings.killSwitch;
  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {note && <div className="notice">{note}</div>}

      <p className="eyebrow">Switches</p>
      <div className="row">
        <div className="row-main">
          <div className="row-title">Kill switch {killed ? <span className="pill">ON — nothing sends</span> : <span className="pill">off</span>}</div>
          <div className="row-sub">Sending: {data.settings.sending.replace("_", " ")}. Test recipients: {data.test_recipients.join(", ")}.</div>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => act(() => api.moniqueOutreachSettings({ kill_switch: killed ? "off" : "on" }), killed ? "Kill switch off." : "Kill switch on. Nothing sends from the next tick.")}>
          {killed ? "Turn the kill switch off" : "Stop all sending"}
        </button>
        <button className="btn" disabled={busy} onClick={() => act(() => api.moniqueOutreachTick(), "Ran one outreach tick.")}>Run a tick now</button>
      </div>

      <p className="eyebrow">Businesses</p>
      {data.businesses.map((b: any) => (
        <div className="row" key={b.key}>
          <div className="row-main">
            <div className="row-title">
              {b.brand} <span className="pill">{b.paused ? "paused" : b.route_state === "ready" ? "route proven" : "awaiting route"}</span>
            </div>
            <div className="row-sub">{b.sender} · {b.offer}</div>
            <div className="row-sub">
              Today {b.sent_today} of {b.daily_cap} · 14 days: {b.health_14d.sent} sent, {b.health_14d.bounced} bounced, {b.health_14d.complaints} complaints ·
              {" "}waiting {b.prospects.new ?? 0}, in sequence {b.prospects.in_sequence ?? 0}, replied {b.prospects.replied ?? 0}
            </div>
            {b.paused && <div className="row-sub">{b.pause_reason}</div>}
            {b.route_state !== "ready" && b.route_detail && <div className="row-sub">{b.route_detail}</div>}
            {!b.postal_address_set && (
              <label className="field">
                <span>Postal address for the email footer (CAN-SPAM) — nothing goes to a business until this is set</span>
                <input value={address[b.key] ?? ""} onChange={(e) => setAddress({ ...address, [b.key]: e.target.value })} placeholder="Street or PO Box, city, state ZIP" />
              </label>
            )}
            <div className="btn-row">
              {!b.postal_address_set && (
                <button className="btn" disabled={busy || (address[b.key] ?? "").trim().length < 10} onClick={() => act(() => api.moniqueOutreachBusiness(b.key, { postal_address: address[b.key] ?? "" }), `Postal address set for ${b.brand}.`)}>Save address</button>
              )}
              {b.paused && (
                <button className="btn" disabled={busy} onClick={() => act(() => api.moniqueOutreachBusiness(b.key, { resume: true }), `${b.brand} resumed.`)}>Lift the pause</button>
              )}
              {b.route_state === "ready" && (
                <button className="btn" disabled={busy || killed} onClick={() => act(() => api.moniqueOutreachTestSend(b.key, 0), `Sample sent to ${data.test_recipients[0]}.`)}>Send a sample to the test inbox</button>
              )}
            </div>
          </div>
        </div>
      ))}

      <p className="eyebrow">Recent replies</p>
      {data.recent_replies.length === 0 ? (
        <Empty title="No replies yet" hint="Replies are read every hour. Interested ones become a card in your Inbox." />
      ) : (
        data.recent_replies.map((r: any, i: number) => (
          <div className="row" key={i}>
            <div className="row-main">
              <div className="row-title">{r.from_email} <span className="pill">{String(r.classification).replace("_", " ")}</span></div>
              <div className="row-sub">{r.excerpt}</div>
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Referral partners</p>
      {!refs || refs.partners.length === 0 ? (
        <Empty title="No partners yet" hint="A partner and their code are created the moment an affiliate says yes." />
      ) : (
        refs.partners.map((p: any) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div className="row-title">{p.name ?? p.email} <span className="pill">{p.code}</span></div>
              <div className="row-sub">{p.business_key} · {p.share_bps / 100}% of first-year revenue</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
