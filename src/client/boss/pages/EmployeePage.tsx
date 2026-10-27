/**
 * ONE PAGE PER EMPLOYEE — Builder U, approved 23 Oct 2026 (mock-up board 8).
 *
 * Her duties, each closed until tapped. Open, a duty shows what it does in plain words, the
 * instructions she follows (editable; the repository's prompt is the default until the owner saves
 * a change), and when it runs. Save changes / Undo to the last version / Pause this duty, and
 * "Remove this duty…" set apart, which asks first. Every change is versioned in D1 (duty_versions)
 * and read by the job that does the duty — see src/worker/boss/duties/ownerEdits.ts.
 *
 * A duty whose steps are fixed in code has no instructions for anything to read, so it shows none:
 * instead the owner asks Danielle for the change in plain words, and it becomes her task.
 *
 * After any action the page stays on the same duty, open, and says what happened under it.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { go, tellSimoneHref, commandHref, taskHref } from "../nav";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
const day = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const ADD_WHEN: { key: string; label: string; overrides: Record<string, unknown> }[] = [
  { key: "daily", label: "Every day", overrides: { cadence: "daily" } },
  ...["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => ({ key: `weekly:${i}`, label: `Every ${d}`, overrides: { cadence: "weekly", weekday: i } })),
];

export function EmployeePage({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<{ employee: any; duties: any[]; removed: any[] } | null>(null);
  const [recentError, setRecentError] = useState<unknown>(null);
  const [extra, setExtra] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  function load() {
    api.employeeDuties(id).then(setData).catch((e) => { setError(e); setData(null); });
    api.employee(id).then((r) => { setExtra(r); setRecentError(null); }).catch((e) => { setExtra(null); setRecentError(e); });
  }
  useEffect(load, [id]);

  const e = data?.employee;
  const back = <button className="btn btn-small back-link" onClick={onBack}>← Back to Your team</button>;
  if (!data) return <>{back}<ErrorNotice error={error} onDismiss={() => setError(null)} />{!error && <Loading />}</>;

  return (
    <div data-testid="employee-page">
      {back}
      <div className="sheet-id" style={{ margin: "12px 0" }}>
        <img className="avatar avatar-lg" src={`/employees-boss/${String(e.name ?? "").toLowerCase()}.jpg`}
             alt={`${e.name}, ${e.role} — an AI-generated portrait of a person who does not exist`}
             onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        <div>
          <h2 className="employee-name">{e.name}</h2>
          <div className="row-sub">{e.role} · {data.duties.length} {data.duties.length === 1 ? "duty" : "duties"}</div>
        </div>
      </div>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <p className="eyebrow">Her duties (tap one to open)</p>
      {data.duties.length === 0 ? <Empty title="No standing duties" hint="Add one below in plain words." /> : data.duties.map((d) => (
        <DutyCard key={d.id} duty={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} onChanged={load} onError={setError} />
      ))}

      {e.id === "emp_knowledge" && <WaitingOnRegister />}

      <section className="panel" data-testid="employee-tell-simone" aria-label={`Give ${e.name} a one-off task`}>
        <p className="row-title" style={{ marginTop: 0 }}>Give {e.name} a one-off task</p>
        <p className="row-sub">Goes through Simone, so it lands with the right person even if it isn&apos;t {e.name}&apos;s.</p>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => go(tellSimoneHref())}>Tell Simone ↑</button>
      </section>

      <AddDuty employee={e} onDone={load} onError={setError} />

      {data.removed.length > 0 && (
        <>
          <p className="eyebrow" style={{ marginTop: 18 }}>Removed duties (kept, not running)</p>
          {data.removed.map((d) => <RemovedRow key={d.id} duty={d} onChanged={load} onError={setError} />)}
        </>
      )}

      <p className="eyebrow" style={{ marginTop: 18 }}>What she is for</p>
      <p className="charter">{e.charter ?? "No charter recorded."}</p>
      <ErrorNotice error={recentError} onDismiss={() => setRecentError(null)} />
      {extra && (extra.recent_work ?? extra.recent_tasks ?? []).length > 0 && (
        <>
          <p className="eyebrow">Recent work</p>
          {(extra.recent_work ?? extra.recent_tasks ?? []).slice(0, 20).map((t: any) => (
            <div className="row" key={t.id}>
              <div className="row-main">
                <a className="row-title" href={t.type === "command" ? commandHref(t.id) : taskHref(t.id)} onClick={(ev) => { ev.preventDefault(); go(t.type === "command" ? commandHref(t.id) : taskHref(t.id)); }}>{t.title}</a>
                <div className="row-sub">{String(t.status).replace(/_/g, " ")} · {when(t.created_at)}</div>
              </div>
            </div>
          ))}
        </>
      )}
      {back}
    </div>
  );
}

function DutyCard({ duty: d, open, onToggle, onChanged, onError }: { duty: any; open: boolean; onToggle: () => void; onChanged: () => void; onError: (e: unknown) => void }) {
  const ins = d.instructions;
  const [text, setText] = useState<string>(ins.text ?? "");
  const [choice, setChoice] = useState<string>(d.choice);
  const [hour, setHour] = useState<number>(d.local_hour);
  const [ask, setAsk] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(ins.text ?? ""); setChoice(d.choice); setHour(d.local_hour); }, [d.id, ins.text, d.choice, d.local_hour]);

  const dirty = (ins.source !== "fixed" && text !== (ins.text ?? "")) || choice !== d.choice || hour !== d.local_hour;
  async function act(fn: () => Promise<string>) {
    setBusy(true); setSaid(null);
    try { setSaid(await fn()); onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); setConfirming(false); }
  }
  const save = () => act(async () => {
    const body: Record<string, unknown> = {};
    if (ins.source !== "fixed" && text !== (ins.text ?? "")) body.instructions = text;
    if (choice !== d.choice && choice !== "custom") body.schedule = choice;
    if (hour !== d.local_hour) body.hour = hour;
    const r = await api.editDuty(d.id, body as any);
    return r.changed.length ? `Saved (${r.changed.join(" and ")}). The next run uses it.` : "Nothing had changed.";
  });

  return (
    <section className="panel duty-card" data-testid="duty-card" aria-label={d.name}>
      <button className="duty-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="row-title">{d.name}</span>
        <span className="row-sub">
          {d.schedule_words} · {d.paused ? <span className="pill">Paused</span> : <span className="pill state-good">On</span>}
          {" · "}<span className="duty-card-hint">{open ? "Close ▴" : "Open ▾"}</span>
        </span>
      </button>
      {open && (
        <div className="duty-card-body">
          <p style={{ margin: 0 }}><b>What it does:</b> {d.what}</p>
          {d.sends && <p className="row-sub" style={{ margin: 0 }}><b>Where it goes:</b> {d.sends}</p>}
          <p className="row-sub" style={{ margin: 0 }}>
            {d.runs_on === "mac" ? "Runs on your Mac." : "Runs in Boss OS."}
            {d.last_run_at ? ` Last ran ${when(d.last_run_at)}${d.last_outcome === "failed" ? " and did not finish" : ""}.` : " Has not run yet."}
            {!d.paused ? ` Next ${when(d.next_due_at)}.` : ""}
          </p>

          {ins.source === "fixed" ? (
            <div className="field" data-testid="duty-fixed">
              <span>How it works</span>
              <p className="row-sub" style={{ margin: "4px 0 8px" }}>
                This duty follows fixed steps written into Boss OS, so there are no written instructions to edit.
                Say what should change and Danielle changes the steps for you.
              </p>
              <textarea rows={3} value={ask} onChange={(ev) => setAsk(ev.target.value)} aria-label={`What should change about ${d.name}`} placeholder="e.g. Only include deals over $20M" />
              <button className="btn btn-small" style={{ marginTop: 8 }} disabled={busy || ask.trim().length < 8}
                      onClick={() => act(async () => { await api.askDutyChange(d.id, ask); setAsk(""); return "Sent to Danielle as a task. You will see it in Recent work."; })}>
                Ask Danielle to change how it works
              </button>
            </div>
          ) : (
            <label className="field">
              <span>The instructions she follows (edit in plain words)</span>
              <textarea rows={8} value={text} onChange={(ev) => setText(ev.target.value)} data-testid="duty-instructions" />
              <span className="row-sub" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                {ins.source === "owner" ? "These are your words. Undo goes back a version." : "These are the original instructions. Your changes are kept as versions."}
              </span>
            </label>
          )}

          <div className="duty-when">
            <label className="field">
              <span>When it runs</span>
              <select value={choice} onChange={(ev) => setChoice(ev.target.value)} data-testid="duty-when">
                {d.choice === "custom" && <option value="custom">{d.schedule_words}</option>}
                {d.choices.map((c: any) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            {d.time_editable ? (
              <label className="field">
                <span>At</span>
                <select value={hour} onChange={(ev) => setHour(Number(ev.target.value))} data-testid="duty-hour">
                  {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </label>
            ) : (
              <p className="row-sub" style={{ alignSelf: "center" }}>Your Mac starts it at its own set time.</p>
            )}
          </div>

          <div className="duty-actions">
            <button className="btn btn-approve" disabled={busy || !dirty} onClick={save} data-testid="duty-save">Save changes</button>
            <button className="btn" disabled={busy || d.changes === 0}
                    onClick={() => act(async () => { const r = await api.undoDuty(d.id); return `Back to version ${r.restored_version}. The newer one is still kept.`; })}>
              Undo to the last version
            </button>
            <button className="btn btn-defer" disabled={busy} data-testid="duty-pause"
                    onClick={() => act(async () => { await api.pauseDuty(d.id, !d.paused); return d.paused ? "Running again from its next time." : "Paused. It will not run until you resume it."; })}>
              {d.paused ? "Resume this duty" : "Pause this duty"}
            </button>
            <span className="duty-actions-gap" />
            {!confirming ? (
              <button className="btn btn-defer btn-remove" disabled={busy} onClick={() => setConfirming(true)}>Remove this duty…</button>
            ) : (
              <div className="notice duty-confirm" role="alertdialog" aria-label={`Remove ${d.name}?`}>
                <p style={{ margin: "0 0 8px" }}>Remove “{d.name}”? It stops running. Its history is kept and Undo brings it back.</p>
                <div className="btn-row" style={{ margin: 0 }}>
                  <button className="btn btn-reject" disabled={busy} onClick={() => act(async () => { await api.removeDuty(d.id); return "Removed."; })}>Yes, remove it</button>
                  <button className="btn" onClick={() => setConfirming(false)}>✕ Keep it</button>
                </div>
              </div>
            )}
          </div>
          {said && <div className="notice" role="status">{said}</div>}
          <p className="row-sub" style={{ margin: 0 }}>
            {d.changes > 0 ? `Last changed by you on ${day(d.last_changed_at)}. ` : ""}Every version is kept. Removing asks you to confirm first.
          </p>
        </div>
      )}
    </section>
  );
}

function RemovedRow({ duty: d, onChanged, onError }: { duty: any; onChanged: () => void; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="row" data-testid="removed-duty">
      <div className="row-main">
        <div className="row-title">{d.name}</div>
        <div className="row-sub">Removed {day(d.last_changed_at)}</div>
      </div>
      <button className="btn btn-small" disabled={busy}
              onClick={async () => { setBusy(true); try { await api.undoDuty(d.id); onChanged(); } catch (e) { onError(e); } finally { setBusy(false); } }}>
        Bring {d.name.length > 30 ? "it" : d.name} back
      </button>
    </div>
  );
}

function AddDuty({ employee, onDone, onError }: { employee: any; onDone: () => void; onError: (e: unknown) => void }) {
  const [phrase, setPhrase] = useState("");
  const [whenKey, setWhenKey] = useState("weekly:1");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  async function add() {
    setBusy(true); setSaid(null);
    const overrides = ADD_WHEN.find((w) => w.key === whenKey)?.overrides ?? {};
    try {
      const preview = await api.draftDuty({ employee_id: employee.id, phrase, preview: true, overrides });
      if (preview.draft.refusals.length > 0) {
        setSaid({ ok: false, text: `Simone checked: ${employee.name} cannot do this as written. ${preview.draft.refusals.join(" ")}` });
        return;
      }
      const filed = await api.draftDuty({ employee_id: employee.id, phrase, overrides });
      setPhrase("");
      setSaid({ ok: true, text: filed.state === "created"
        ? `Simone checked it: ${employee.name} can do this. It is on, first run ${when(filed.first_run_at)}.`
        : `Simone checked it: ${employee.name} can do this. It is in your Inbox to approve; it starts once you do.` });
      onDone();
    } catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel duty-add" data-testid="employee-add-duty" aria-label={`Add a duty for ${employee.name}`}>
      <p className="row-title" style={{ marginTop: 0 }}>Add a duty for {employee.name}</p>
      <label className="field">
        <span>What should she do? (plain words)</span>
        <textarea rows={3} value={phrase} onChange={(ev) => setPhrase(ev.target.value)} placeholder="e.g. Send me the 5 brokers who sent the most deals last week" />
      </label>
      <label className="field">
        <span>When</span>
        <select value={whenKey} onChange={(ev) => setWhenKey(ev.target.value)}>
          {ADD_WHEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
      </label>
      <button className="btn btn-approve" disabled={busy || phrase.trim().length < 8} onClick={add}>Add duty</button>
      {said && <div className={said.ok ? "notice" : "notice notice-hint-box"} role="status" style={{ marginTop: 10 }}>{said.text}</div>}
      <p className="row-sub">Simone checks that {employee.name} can actually do it before it starts, and tells you in one line if it belongs to someone else.</p>
    </section>
  );
}

/**
 * ZORA'S REGISTER (owner-approved 26 Oct 2026): everything Boss OS is waiting on, who owns it, the
 * date, and what happens on that date. Read only; Zora's daily run acts on it.
 */
const OWNER_NAME: Record<string, string> = { emp_chief: "Simone", emp_relationship: "Monique", emp_knowledge: "Zora", emp_repo: "Danielle", emp_continuity: "Kendra", emp_risk: "Toni", emp_research: "Camille", emp_practice: "Imani", sequoia: "You" };
const STATE_WORDS: Record<string, string> = { open: "Waiting", actioned: "Started", done: "Done", repair: "Being fixed" };
export function WaitingOnRegister() {
  const [items, setItems] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.waitingOn().then((d) => setItems(d.items ?? [])).catch(() => setFailed(true)); }, []);
  return (
    <section className="panel" data-testid="waiting-on-register" aria-label="What we are waiting on">
      <p className="row-title" style={{ marginTop: 0 }}>What we are waiting on</p>
      <p className="row-sub">Every item has an owner and a date. On the date, its next step starts by itself.</p>
      {failed ? <p className="row-sub">The list could not be read just now. This is not saying it is empty.</p>
        : !items ? <Loading />
        : items.length === 0 ? <Empty title="Nothing is waiting" hint="New waits are added here as they come up." />
        : items.map((i) => (
          <div key={i.id} className="row" style={{ padding: "8px 0" }}>
            <div className="row-title">{i.what}</div>
            <div className="row-sub">
              {OWNER_NAME[i.owner] ?? "No owner yet (being fixed)"} · {i.due_on ? `on ${new Date(`${i.due_on}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "ongoing"} · {STATE_WORDS[i.state] ?? i.state}
            </div>
            {i.action && <div className="row-sub">Then: {i.action}</div>}
          </div>
        ))}
    </section>
  );
}
