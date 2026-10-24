/**
 * EVERY ITEM IN HER MORNING EMAIL HAS ITS OWN SCREEN (owner, 24 Oct 2026).
 *
 * "every item in the email links to its own Boss OS screen where she can learn more (no link to the
 * home page)". The email, Today's list and these screens read ONE record — the morning as Simone
 * built it (GET /morning/:day, written by scripts/ops/your-day.mjs before the email goes) — so they
 * cannot disagree about what is waiting for her.
 *
 *   MorningItem   /?morning=<day>&item=<id>   a decision, deal, finding, done line or catch-up, in full
 *   WorkItem      /?task=<id>                 one piece of work and what it waits on (comments by name)
 *                 /?employee=<id>             one employee's open work, each item tappable
 *   MorningBlock  Today's "This morning's email": the same Decide list as the email, every row tappable
 *
 * Calm (make-it-calm): summary first, one list, buttons say the outcome, ← Back on every screen.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { go, morningHref, taskHref } from "../nav";

type Btn = { label: string; url: string };

/** A link out of Boss OS opens in a new tab; one into Boss OS moves here. A tap page is its own page. */
function LinkButton({ b, primary = false }: { b: Btn; primary?: boolean }) {
  const inside = b.url.startsWith(window.location.origin + "/?") || b.url.startsWith("/?");
  if (inside) {
    const href = b.url.replace(window.location.origin, "");
    return <button className={`btn btn-small${primary ? " btn-primary" : ""}`} onClick={() => go(href)}>{b.label}</button>;
  }
  return <a className={`btn btn-small${primary ? " btn-primary" : ""}`} href={b.url} target={/\/tap\//.test(b.url) ? "_self" : "_blank"} rel="noreferrer">{b.label}</a>;
}

function Buttons({ list }: { list: Btn[] }) {
  const shown = (list ?? []).filter((b) => !/^See everything about this$/i.test(b.label));
  if (!shown.length) return null;
  return <div className="btn-row mi-buttons">{shown.map((b, i) => <LinkButton key={i} b={b} primary={i === 0} />)}</div>;
}

function Draft({ draft }: { draft: { heading?: string; text: string } | null }) {
  if (!draft) return null;
  return (
    <>
      <p className="eyebrow">{draft.heading ?? "The words, exactly"}</p>
      <div className="mi-draft">{draft.text}</div>
    </>
  );
}

function find(payload: any, id: string): { kind: string; item: any } | null {
  for (const kind of ["decide", "deals", "found", "done", "catchups"]) {
    const it = (payload?.[kind] ?? []).find((x: any) => x.id === id);
    if (it) return { kind, item: it };
  }
  return null;
}

const KIND_LABEL: Record<string, string> = {
  decide: "A decision for you", deals: "A new deal", found: "Something Monique found",
  done: "Done for you", catchups: "Someone to catch up with",
};

export function MorningItem({ day, id }: { day: string; id: string }) {
  const [data, setData] = useState<any>(undefined);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setData(undefined); api.morningDay(day).then(setData).catch((e) => { setError(e); setData(null); }); }, [day]);
  if (data === undefined) return <Loading />;
  if (!data) return <><ErrorNotice error={error} /><Empty title="This morning is not kept yet" hint="Simone keeps each morning's email here when she sends it." /></>;
  const hit = find(data.payload, id);
  if (!hit) return <Empty title="This item is not in that morning" hint="It may have been answered already. Today lists what is still waiting." />;
  const { kind, item } = hit;
  return (
    <div data-testid="morning-item">
      <p className="eyebrow">{KIND_LABEL[kind]} · from the morning email of {data.day}</p>
      {kind === "deals" ? <DealView d={item} /> : kind === "found" ? <FoundView f={item} /> : kind === "done" ? (
        <>
          <p className="mi-lede">{item.text}</p>
          <Buttons list={item.links ?? []} />
        </>
      ) : (
        <>
          <h2 className="mi-title">{item.title}</h2>
          {item.body ? <p className="mi-lede">{item.body}</p> : null}
          {(item.details ?? []).length ? <ul className="brief-list mi-list">{item.details.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul> : null}
          <Draft draft={item.draft} />
          <Buttons list={item.buttons ?? []} />
          {item.plan ? <><p className="eyebrow">Danielle&apos;s plan, in full</p><div className="mi-draft">{item.plan}</div></> : null}
        </>
      )}
    </div>
  );
}

function DealView({ d }: { d: any }) {
  return (
    <>
      <h2 className="mi-title">{d.company}: {d.side}</h2>
      <dl className="kv">
        <dt>Size</dt><dd>{d.size ?? "—"}</dd>
        <dt>Price or valuation</dt><dd>{d.price ?? "—"}</dd>
        <dt>Structure and fees</dt><dd>{d.structure ?? "—"}</dd>
        <dt>From</dt><dd>{d.from ?? "—"}</dd>
        <dt>When</dt><dd>{d.received_on ?? d.when ?? "—"}</dd>
      </dl>
      <p className="row-sub">&quot;—&quot; means the email did not say it clearly.</p>
      <Buttons list={[
        ...(d.email_url ? [{ label: "Open the original email (your spry.vc mailbox)", url: d.email_url }] : []),
        { label: "See it in the deal grid", url: `/?tab=capital&view=grid&company=${encodeURIComponent(d.company)}` },
      ]} />
    </>
  );
}

function FoundView({ f }: { f: any }) {
  return (
    <>
      <p className="mi-lede">{f.text}</p>
      <Buttons list={f.links ?? []} />
      {(f.holders ?? []).length ? (
        <>
          <p className="eyebrow">The funds, from their public filings (not confirmed sellers)</p>
          <div className="brief-tablewrap">
            <table className="brief-table">
              <thead><tr><th>Fund</th><th>Manager</th><th>Holds</th><th>As of</th><th>Filing</th></tr></thead>
              <tbody>
                {f.holders.map((h: any, i: number) => (
                  <tr key={i}><td>{h.fund}</td><td>{h.manager}</td><td>{h.value}</td><td>{h.as_of}</td><td>{h.url ? <a href={h.url} target="_blank" rel="noreferrer">Open the filing</a> : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

const CHOICE: Record<string, string> = {
  hide: "Hide: the comment disappears for everyone except the person who wrote it.",
  reply: "Reply: the channel answers in public with the words shown.",
  ignore: "Ignore: nothing changes on the channel.",
};
const OPEN = new Set(["queued", "running", "awaiting_approval", "classified", "assigned"]);
const STATUS_WORDS: Record<string, string> = {
  awaiting_approval: "Waiting for your word", queued: "Waiting to start", running: "Being worked on now",
  classified: "Waiting to start", assigned: "Waiting to start", done: "Done", failed: "Stopped", cancelled: "Cancelled",
};

export function WorkItem({ taskId, employeeId }: { taskId?: string; employeeId?: string }) {
  if (employeeId) return <EmployeeOpen id={employeeId} />;
  return <TaskView id={taskId!} />;
}

function TaskView({ id }: { id: string }) {
  const [task, setTask] = useState<any>(undefined);
  const [digest, setDigest] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.task(id).then(async (t) => {
      setTask(t);
      let input: any = {};
      try { input = typeof t?.input === "string" ? JSON.parse(t.input) : (t?.input ?? {}); } catch { input = {}; }
      if (input?.kind === "youtube_comment_watch") {
        const r = await api.commentDigests();
        setDigest((r.digests ?? []).find((d: any) => d.id === input.digest_id) ?? null);
      }
    }).catch((e) => { setError(e); setTask(null); });
  }, [id]);
  if (task === undefined) return <Loading />;
  if (!task) return <><ErrorNotice error={error} /><Empty title="That piece of work is not here" hint="It may have been finished and archived." /></>;
  return (
    <div data-testid="work-item">
      <p className="eyebrow">{task.employee_name ?? "Your team"} · {STATUS_WORDS[task.status] ?? task.status}</p>
      <h2 className="mi-title">{task.title}</h2>
      {digest ? (
        <>
          <p className="mi-lede">Comments on How We Know on YouTube. Hiding or answering one speaks for the channel, so it waits for you.</p>
          {(digest.items ?? []).map((i: any) => (
            <div key={i.n} className="duty-card mi-comment">
              <p className="row-title">{i.n}. On &quot;{i.video_title ?? "a video"}&quot;, {i.author ?? "a viewer"} wrote:</p>
              <div className="mi-draft">{i.text}</div>
              <p className="row-sub">Monique suggests: {CHOICE[i.proposed_action] ?? i.proposed_action}{i.proposed_reply ? ` With: "${i.proposed_reply}"` : ""}</p>
              {i.product_note ? <p className="row-sub">It points at a fault in the video ({i.product_note}); Danielle fixes that for future videos.</p> : null}
              <p className="row-sub">{i.instructed_at ? `Answered: ${i.action}${i.result ? ` — ${i.result}` : " (being applied)"}` : "Not answered yet."}</p>
            </div>
          ))}
          <p className="eyebrow">What each choice does</p>
          <ul className="brief-list mi-list">{Object.values(CHOICE).map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="row-sub">To answer, reply to Monique&apos;s email about these comments with the number and the word, for example &quot;1 ignore&quot;.</p>
        </>
      ) : (
        <p className="mi-lede">{STATUS_WORDS[task.status] ?? task.status}. Started {new Date(task.created_at).toLocaleString()}.</p>
      )}
    </div>
  );
}

function EmployeeOpen({ id }: { id: string }) {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.tasks().then((t) => setTasks((t ?? []).filter((x) => x.employee_id === id && OPEN.has(x.status)))).catch((e) => { setError(e); setTasks([]); }); }, [id]);
  if (!tasks) return <Loading />;
  const name = tasks[0]?.employee_name ?? "This employee";
  return (
    <div data-testid="employee-open">
      <ErrorNotice error={error} />
      <p className="eyebrow">{name}&apos;s open work (tap one to open it)</p>
      {tasks.length === 0 ? <Empty title="Nothing open" hint="Everything they were given is finished." /> : tasks.map((t) => (
        <button key={t.id} className="row mi-row" onClick={() => go(taskHref(t.id))}>
          <span className="row-main"><span className="row-title">{t.title}</span><span className="row-sub">{STATUS_WORDS[t.status] ?? t.status}</span></span>
          <span className="row-val">Open ▸</span>
        </button>
      ))}
    </div>
  );
}

/** Today's "This morning's email": exactly the email's Decide list, then what was done, each tappable. */
export function MorningBlock() {
  const [m, setM] = useState<any>(undefined);
  useEffect(() => { api.morningLatest().then(setM).catch(() => setM(null)); }, []);
  if (m === undefined) return <Loading />;
  if (!m?.payload) return <p className="row-sub">Simone&apos;s morning email lists its decisions here once it goes.</p>;
  const p = m.payload;
  const row = (it: any, label: string) => (
    <button key={it.id} className="row mi-row" onClick={() => go(morningHref(m.day, it.id))} data-testid="morning-row">
      <span className="row-main"><span className="row-title">{label}</span>{it.body ? <span className="row-sub">{it.body}</span> : null}</span>
      <span className="row-val">Open ▸</span>
    </button>
  );
  return (
    <div id="morning" data-testid="morning-block">
      <p className="eyebrow">Decide ({p.decide.length}) · from the morning email of {m.day}</p>
      {p.decide.length === 0 ? <p className="row-sub">Nothing to decide this morning.</p> : p.decide.map((d: any) => row(d, d.title))}
      {(p.done ?? []).length ? (
        <details className="mi-more">
          <summary>Done for you ({p.done.length}) — tap to show ▾</summary>
          {p.done.map((d: any) => row(d, d.text))}
        </details>
      ) : null}
    </div>
  );
}
