import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { commandHref, go } from "../nav";
import { ErrorNotice } from "./Notice";
import { Loading } from "./Shell";

export function MailWords({ text }: { text: string }) {
  return <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : <Fragment key={i}>{part}</Fragment>)}</div>;
}

export function MailThread({ thread, direction, onChanged }: { thread: any; direction?: string; onChanged?: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const messages = thread.messages.filter((m: any) => !direction || m.direction === direction);
  if (!messages.length) return null;
  return <section className="panel" aria-label={messages[messages.length - 1].subject}>
    <ErrorNotice error={error} onDismiss={() => setError(null)} />
    {messages.map((m: any) => <details key={m.id} open={direction ? undefined : true}>
      <summary className="row-title">{m.subject || "Email without a subject"} · {new Date(m.at).toLocaleString()}</summary>
      <p className="row-sub">From {m.from_addr} → {m.to_addr}</p>
      {m.body === null ? <p>The saved copy is unavailable. This does not mean the email was empty.</p> : <MailWords text={m.body} />}
      {m.body !== null && !m.original_url && <p className="row-sub">This is the copy kept with the errand. The original email was not saved at the time.</p>}
      {m.original_url && <p><a href={m.original_url}>View the original email</a></p>}
      {m.command_id && <p><a href={commandHref(m.command_id)} onClick={(e) => { e.preventDefault(); go(commandHref(m.command_id)); }}>Open this errand or request →</a></p>}
      {m.outcome === "REFUSED_SENDER" && <div>
        <p>This sender has not been let in. Tap below to keep reading their emails here. Their emails cannot instruct your team.</p>
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await api.admitSender(m.id); onChanged?.(); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>{busy ? "Letting sender in…" : "Let this sender in"}</button>
      </div>}
    </details>)}
  </section>;
}

export function MailSections() {
  const [data, setData] = useState<any>(null);
  const [team, setTeam] = useState<any[] | null>(null);
  const [employee, setEmployee] = useState("");
  const [counterpart, setCounterpart] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { api.teamCards().then((r) => setTeam(r.team)).catch(setError); }, []);
  useEffect(() => {
    let current = true;
    setData(null);
    api.mail({ employee, counterpart: filter }).then((r) => { if (current) { setData(r); setError(null); } }).catch((e) => { if (current) setError(e); });
    return () => { current = false; };
  }, [employee, filter, version]);
  return <>
    <form className="panel" aria-label="Filter emails" onSubmit={(e) => { e.preventDefault(); setFilter(counterpart.trim()); }}>
      <label className="field">Employee<select value={employee} onChange={(e) => setEmployee(e.target.value)}>
        <option value="">Everyone</option>
        {team === null ? <option disabled>Loading team…</option> : team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label className="field">Other person or business<input type="email" value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder="Their email address" /></label>
      <button className="btn" type="submit">Filter emails</button>
    </form>
    <ErrorNotice error={error} onDismiss={() => setError(null)} />
    <p className="row-sub">The most recent 25 email threads. Tap a subject to read the email.</p>
    {[["sent", "Emails sent by agents"], ["received", "Emails sent to you"]].map(([direction, title]) => <section key={direction} aria-label={title}>
      <h2>{title}</h2>
      {!data ? error ? <p>The emails could not be loaded. Try opening Inbox again.</p> : <Loading /> : data[direction!].length === 0 ? <p>No emails in this section{employee || filter ? " for these filters" : " yet"}.</p> : data.threads.map((thread: any) => <MailThread key={thread.id} thread={thread} direction={direction} onChanged={() => setVersion((v) => v + 1)} />)}
    </section>)}
  </>;
}
