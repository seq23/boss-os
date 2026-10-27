import { useEffect, useState } from "react";
import { api } from "../api";
import { go } from "../nav";
import { ErrorNotice } from "../components/Notice";
import { Loading } from "../components/Shell";
import { MailThread, MailWords } from "../components/MailThread";

export function commandState(row: any): string {
  if (row.result?.owner_handling) return "Owner is handling this herself";
  const words: Record<string, string> = { queued: "Simone is preparing it", sent: "Waiting for their reply", replied: "They replied — read their email below", needs_card: "Needs you: card", booked: "The venue confirmed your booking", follow_up: "Your answer is waiting to go", cancel_sent: "Waiting for them to confirm cancellation", cancelled: "Cancelled", done: "Done", failed: "Needs attention" };
  return words[row.state] ?? String(row.state).replace(/_/g, " ");
}
export function CommandPage({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [line, setLine] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.command(id).then(setData).catch(setError);
  useEffect(() => { setData(null); load(); }, [id]);
  async function act(action: string) {
    setBusy(true); setError(null);
    try {
      const r = action === "handle_self" ? await api.handleErrandSelf(id) : await api.answerErrand(id, action, answer);
      setLine(r.line); await load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const back = <button className="btn btn-small back-link" onClick={() => window.history.length > 1 ? window.history.back() : go("/")}>← Back</button>;
  return <div data-testid="command-page">{back}<ErrorNotice error={error} onDismiss={() => setError(null)} />
    {!data ? !error && <Loading /> : <>
      <h2>{data.kind === "errand" ? "Your errand" : "Your request"}</h2>
      <section className="panel"><p className="eyebrow">What you asked for</p><MailWords text={data.spec.ask ?? data.spec.title ?? data.spec.name ?? data.spec.who ?? "Your request"} /></section>
      <p role="status">{commandState(data)}</p>
      {line && <p role="status">{line}</p>}
      <h3>Every email in this thread</h3>
      {data.mail.threads.length ? data.mail.threads.map((t: any) => <MailThread key={t.id} thread={t} onChanged={load} />) : <p>No saved emails in this thread yet.</p>}
      {data.kind === "errand" && <section className="panel"><h3>Booking</h3>
        {data.result.booking?.at ? <p>{new Date(data.result.booking.at).toLocaleString("en-US", { timeZone: data.result.booking.tz ?? "America/New_York", timeZoneName: "short" })} · {data.state !== "needs_card" && data.result.booking.confirmed ? "Confirmed by the venue" : "Waiting for the venue to confirm"}</p> : <p>No booking confirmed yet.</p>}
        {(data.result.rules ?? []).map((s: string, i: number) => <p key={i}>{s}</p>)}
        {(data.result.cancel_rule ?? []).map((s: string, i: number) => <p key={i}>{s}</p>)}
        <h3>Reminder</h3><p>{data.result.owner_handling ? "Simone has stood down. No reminder will be sent." : data.result.reminder_sent_at ? `Sent ${new Date(data.result.reminder_sent_at).toLocaleString()}` : data.result.booking?.at ? `Due ${new Date(data.result.booking.at - 28 * 3_600_000).toLocaleString()} — 28 hours before.` : "Once there is a booking time, Simone checks with you 28 hours before."}</p>
      </section>}
      {data.kind === "errand" && !data.result.owner_handling && <section className="panel">
        <h3>What would you like to do?</h3>
        <p>Give Simone your answer here. Card details and payments are always yours to handle using the venue’s link.</p>
        <label className="field">Your answer<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
        <button className="btn" disabled={busy || !answer.trim()} onClick={() => act("answer")}>Send answer to Simone</button>
        <div className="decide"><button className="btn" disabled={busy} onClick={() => act("keep")}>Yes, keep it</button><button className="btn" disabled={busy || ["cancelled", "cancel_sent"].includes(data.state)} onClick={() => act("cancel")}>Cancel booking — tell the venue</button></div>
        <p>If you take over, Simone stops here. The venue receives no email.</p>
        <button className="btn" disabled={busy} onClick={() => act("handle_self")}>I’m handling it myself</button>
      </section>}
    </>}{back}</div>;
}
