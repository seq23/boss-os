/**
 * "YOUR TEAM" — Builder U, approved 23 Oct 2026 (mock-up board 7).
 *
 * One card per employee, from the real roster: name, role, what they handle (their duties), what
 * they did today and what is next — all read from D1 (duty_runs and standing_duties, through
 * /api/duties/team). Nothing here is hard-coded. Tap a card to open her page.
 *
 * Below the cards, every list Monique keeps, each with its live count and an action that opens it
 * in place. The same D1 tables are edited by email reply (capital_party_lists, prospect_name_rules,
 * prospect_templates), so a change made either way shows in both.
 *
 * Between them, the duties grid (30 Oct 2026): every employee's standing duties in one list, each
 * row saying the duty in plain words, who owns it, how often it runs and how its last run went.
 * Tapping a row opens "what this means", an example, and the same editor the employee page uses.
 *
 * Make it calm: phone first (one column at 390 px), labelled actions, the editor opens under its own
 * card and stays there after a change, red only for a real failure.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { MONIQUE_MONTHLY, EIGHTRAISE_BUDGET } from "../../../shared/boss/lp/plan.mjs";
import { DutyBody } from "./EmployeePage";

const at = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const day = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function YourTeam({ onOpenEmployee, onOpenDeals }: { onOpenEmployee: (id: string) => void; onOpenDeals: (view: "lp" | "prospects") => void }) {
  const [team, setTeam] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.teamCards().then((r) => setTeam(r.team)).catch((e) => { setError(e); setTeam([]); }); }, []);

  return (
    <div data-testid="your-team">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <p className="eyebrow">Who is doing what for you</p>
      {team === null ? <Loading /> : team.length === 0 ? (
        <Empty title="No one on the team yet" hint="Employees appear here once they are hired." />
      ) : (
        <div className="team-grid">
          {team.map((t) => (
            <button key={t.id} className="team-card" data-testid="team-card" onClick={() => onOpenEmployee(t.id)}
                    aria-label={`${t.name}, ${t.role}. Open ${t.name}'s duties`}>
              <span className="team-card-who">
                <img className="avatar" src={`/employees-boss/${String(t.name ?? "").toLowerCase()}.jpg`}
                     alt={`${t.name}, ${t.role} — an AI-generated portrait of a person who does not exist`} loading="lazy"
                     onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                <span className="team-card-name">{t.name} <span className="row-sub">· {t.role}</span></span>
              </span>
              <span className="team-card-line"><b>Handles:</b> {t.handles.length ? t.handles.join("; ") : "Nothing standing yet"}</span>
              <span className="team-card-line"><b>Today:</b> {t.today.length ? t.today.join(" · ") : "Nothing run yet today"}</span>
              <span className="row-sub">Next: {t.next ? `${t.next.duty}, ${at(t.next.at)}` : "nothing scheduled"}
                {t.paused_count > 0 ? ` · ${t.paused_count} paused` : ""}</span>
              <span className="team-card-open">Open {t.name}&apos;s duties</span>
            </button>
          ))}
        </div>
      )}
      <p className="eyebrow" style={{ marginTop: 22 }}>Every standing duty, in one list</p>
      <DutiesGrid />
      <p className="eyebrow" style={{ marginTop: 22 }}>Lists Monique keeps for you (edit here, or reply to any Monique email)</p>
      <MoniqueLists onOpenDeals={onOpenDeals} />
    </div>
  );
}

/** How the last run went, in words with their one colour: green done, red did not finish, grey otherwise. */
export function lastRunWords(d: { paused?: boolean; last_run_at?: number | null; last_outcome?: string | null }): { words: string; tone: "good" | "bad" | "quiet" } {
  if (d.paused) return { words: "Paused", tone: "quiet" };
  if (!d.last_run_at) return { words: "Not run yet", tone: "quiet" };
  if (d.last_outcome === "failed") return { words: `Did not finish ${day(d.last_run_at)}`, tone: "bad" };
  return { words: `Done ${day(d.last_run_at)}`, tone: "good" };
}

function DutiesGrid() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [who, setWho] = useState("everyone");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => { api.allDuties().then((r) => setRows(r.duties)).catch((e) => { setError(e); setRows([]); }); };
  useEffect(load, []);
  if (rows === null) return <Loading />;
  const owners = [...new Map(rows.map((d) => [d.owner.id, d.owner.name])).entries()];
  const shown = who === "everyone" ? rows : rows.filter((d) => d.owner.id === who);
  const failed = shown.filter((d) => !d.paused && d.last_outcome === "failed").length;
  const paused = shown.filter((d) => d.paused).length;
  return (
    <div data-testid="duties-grid">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <p className="row-sub" data-testid="duties-summary" style={{ margin: "0 0 8px" }}>
        {shown.length} {shown.length === 1 ? "duty" : "duties"}
        {failed ? <> · <span className="state-bad">{failed} did not finish last time</span></> : " · all finished last time"}
        {paused ? ` · ${paused} paused` : ""}
      </p>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>Show duties for: tap to choose</span>
        <select value={who} onChange={(e) => { setWho(e.target.value); setOpen(null); }} data-testid="duties-filter">
          <option value="everyone">Everyone</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {shown.length === 0 ? <Empty title="No standing duties" hint="Duties appear here once an employee has one." /> : (
        <div className="duties-grid" role="list">
          <div className="duties-grid-head" aria-hidden="true"><span>Duty</span><span>Who</span><span>How often</span><span>Last run</span></div>
          {shown.map((d) => {
            const last = lastRunWords(d);
            const isOpen = open === d.id;
            return (
              <section key={d.id} className="panel duties-grid-row" role="listitem" data-testid="duties-grid-row" aria-label={`${d.name}, ${d.owner.name}`}>
                <button className="duties-grid-line" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
                  <span className="row-title">{d.name}</span>
                  <span className="row-sub">{d.owner.name}</span>
                  <span className="row-sub">{d.schedule_words}</span>
                  <span className={last.tone === "good" ? "state-good" : last.tone === "bad" ? "state-bad" : "row-sub"} data-testid="duty-last-run">{last.words}</span>
                  <span className="duty-card-hint duties-grid-open">{isOpen ? "✕ Close" : "Show what this means ▾"}</span>
                </button>
                {isOpen && <DutyBody duty={d} example onChanged={load} onError={setError} />}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ListKey = "same_firm" | "do_not_suggest" | "names" | "email" | "lp" | "credits";

function MoniqueLists({ onOpenDeals }: { onOpenDeals: (view: "lp" | "prospects") => void }) {
  const [lists, setLists] = useState<{ same_firm: any[]; do_not_suggest: any[] } | null>(null);
  const [prospects, setProspects] = useState<{ approved: any; pending: any } | null>(null);
  const [rules, setRules] = useState<{ name: string; rule: string }[]>([]);
  const [lp, setLp] = useState<any[] | null>(null);
  const [credits, setCredits] = useState<{ used: number; rows: any[] } | null>(null);
  const [open, setOpen] = useState<ListKey | null>(null);
  const [error, setError] = useState<unknown>(null);

  function load() {
    api.partyLists().then(setLists).catch((e) => { setError(e); setLists({ same_firm: [], do_not_suggest: [] }); });
    api.prospects().then((r) => setProspects({ approved: r.approved, pending: r.pending })).catch(() => setProspects({ approved: null, pending: null }));
    api.featuredNameRules().then((r) => setRules(r.rules ?? [])).catch(() => setRules([]));
    api.lpReplies().then((r) => setLp(r.rows ?? [])).catch(() => setLp([]));
    api.eightRaise().then((r) => setCredits({ used: r.used ?? 0, rows: r.rows ?? [] })).catch(() => setCredits(null));
  }
  useEffect(load, []);

  const featured: { name: string; why?: string }[] = (() => {
    try { return JSON.parse(prospects?.approved?.names_json ?? "[]"); } catch { return []; }
  })();
  const people = (rows: any[]) => {
    const domains = rows.filter((r) => r.kind === "domain").length;
    const others = rows.length - domains;
    return `${others} ${others === 1 ? "person" : "people"}${domains ? ` + ${domains} ${domains === 1 ? "domain" : "domains"}` : ""}`;
  };
  const waiting = (lp ?? []).filter((r) => ["drafted", "not_answered", "replied_again"].includes(r.status)).length;
  const sent = (lp ?? []).filter((r) => r.status === "sent").length;

  const cards: { key: ListKey; title: string; count: string; what: string; action: string }[] = [
    { key: "same_firm", title: "Rainmaker people", count: lists ? people(lists.same_firm) : "…", what: "Never matched with each other. Their deals still show, tagged Rainmaker.", action: "Add or remove" },
    { key: "do_not_suggest", title: "Don't suggest", count: lists ? people(lists.do_not_suggest) : "…", what: "Never in catch-ups, matches, drafts or the deal grid.", action: "Add or remove" },
    { key: "names", title: "Names to feature", count: prospects ? `${featured.length} ${featured.length === 1 ? "name" : "names"}` : "…", what: "The only names used in prospect emails. You approve changes.", action: "Change names" },
    {
      key: "email", title: "Prospect email",
      count: !prospects ? "…" : prospects.pending ? "A new version is waiting for you" : prospects.approved ? `Approved ${day(prospects.approved.approved_at)}` : "Not approved yet",
      what: "The soft \"names coming across my desk\" email. Changes come back to you to approve.", action: "See the email",
    },
    { key: "lp", title: "LP replies", count: lp ? `${waiting} waiting · ${sent} sent` : "…", what: "Every positive LP reply and where it stands.", action: "Open LP replies" },
    { key: "credits", title: "8Raise credits", count: credits ? `${Math.round(credits.used * 100) / 100} of ${MONIQUE_MONTHLY} used` : "…", what: `Prospecting up to ${EIGHTRAISE_BUDGET.prospecting}, buyers for your supply up to ${EIGHTRAISE_BUDGET.buyers_for_supply}; stops at ${EIGHTRAISE_BUDGET.floor} left. Never buys more.`, action: "See usage" },
  ];

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <div className="team-grid">
        {cards.map((c) => (
          <section key={c.key} className="panel team-list" data-testid="monique-list" aria-label={c.title}>
            <div className="team-list-head">
              <span className="team-card-name">{c.title}</span>
              <span className="row-sub" data-testid="list-count">{c.count}</span>
            </div>
            <p className="row-sub" style={{ margin: "4px 0 10px" }}>{c.what}</p>
            <button className="btn btn-small" aria-expanded={open === c.key}
                    onClick={() => (c.key === "lp" ? onOpenDeals("lp") : setOpen(open === c.key ? null : c.key))}>
              {open === c.key ? `✕ Close ${c.title}` : c.action}
            </button>
            {open === c.key && (
              <div style={{ marginTop: 12 }}>
                {c.key === "same_firm" || c.key === "do_not_suggest" ? (
                  <PartyListEditor list={c.key} rows={lists?.[c.key] ?? []} onChanged={load} onError={setError} />
                ) : c.key === "names" ? (
                  <NamesEditor featured={featured} rules={rules} onChanged={load} onError={setError} />
                ) : c.key === "email" ? (
                  <EmailEditor approved={prospects?.approved} pending={prospects?.pending} featured={featured} onChanged={load} onError={setError} />
                ) : c.key === "credits" ? (
                  <CreditRows rows={credits?.rows ?? []} />
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="row-sub" style={{ marginTop: 10 }}>
        Prospects Monique is writing to are on <button className="btn btn-small" onClick={() => onOpenDeals("prospects")}>Deals: Prospects</button>
      </p>
    </>
  );
}

function PartyListEditor({ list, rows, onChanged, onError }: { list: "same_firm" | "do_not_suggest"; rows: any[]; onChanged: () => void; onError: (e: unknown) => void }) {
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  async function edit(action: "add" | "remove", value: string) {
    setBusy(true); setSaid(null);
    try { const r = await api.editPartyList(list, action, value); setSaid(r.done); setWho(""); onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  return (
    <div data-testid={`list-editor-${list}`}>
      {rows.length === 0 ? <p className="row-sub">Nobody on this list yet.</p> : rows.map((r) => (
        <div className="row" key={r.id}>
          <div className="row-main">
            <div className="row-title">{r.label || r.value}</div>
            <div className="row-sub">{r.kind === "domain" ? `everyone at ${r.value}` : r.label ? r.value : r.kind}</div>
          </div>
          <button className="btn btn-small" disabled={busy} onClick={() => edit("remove", r.value)}>Remove {r.label || r.value}</button>
        </div>
      ))}
      <label className="field" style={{ marginTop: 10 }}>
        <span>Add someone: a name, an email address, or a whole domain</span>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="name@firm.com or firm.com" data-testid={`list-add-${list}`} />
      </label>
      <button className="btn btn-small btn-approve" disabled={busy || who.trim().length < 2} onClick={() => edit("add", who.trim())}>Add to this list</button>
      {said && <div className="notice" role="status" style={{ marginTop: 10 }}>{said}</div>}
    </div>
  );
}

function NamesEditor({ featured, rules, onChanged, onError }: { featured: { name: string; why?: string }[]; rules: { name: string; rule: string }[]; onChanged: () => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const never = rules.filter((r) => r.rule === "never");
  async function save() {
    setBusy(true); setSaid(null);
    try {
      const r = await api.changeFeaturedNames(text);
      setSaid(r.applied.length ? `Noted: ${r.applied.map((a: any) => `${a.rule} ${a.name}`).join(", ")}. Monique sends you the new email to approve.` : "Nothing in that reads as a change. Try \"add X\", \"drop Y\" or \"never feature Z\".");
      setText(""); onChanged();
    } catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <p className="row-title" style={{ margin: "0 0 6px" }}>Featured now</p>
      {featured.length === 0 ? <p className="row-sub">No approved names yet.</p> : (
        <ul className="row-sub" style={{ margin: "0 0 10px", paddingLeft: 18 }}>{featured.map((n) => <li key={n.name}>{n.name}{n.why ? ` (${n.why})` : ""}</li>)}</ul>
      )}
      {never.length > 0 && <p className="row-sub">Never featured: {never.map((n) => n.name).join(", ")}</p>}
      <label className="field">
        <span>Change them in plain words</span>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="add Stripe, drop Varda, never feature Anduril" />
      </label>
      <button className="btn btn-small btn-approve" disabled={busy || text.trim().length < 4} onClick={save}>Save the change</button>
      {said && <div className="notice" role="status" style={{ marginTop: 10 }}>{said}</div>}
    </div>
  );
}

function EmailEditor({ approved, pending, featured, onChanged, onError }: { approved: any; pending: any; featured: { name: string; why?: string }[]; onChanged: () => void; onError: (e: unknown) => void }) {
  const base = pending ?? approved;
  const [subject, setSubject] = useState(base?.subject ?? "");
  const [body, setBody] = useState(base?.body ?? "");
  const [follow, setFollow] = useState(base?.follow_up ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function propose() {
    setBusy(true); setSaid(null);
    try {
      await api.proposeProspectEmail({ subject, body, follow_up: follow }, featured);
      setSaid("Saved as a new version. Approve it below (or from the morning email); until then the approved one keeps going out.");
      onChanged();
    } catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  if (!base) return <p className="row-sub">There is no prospect email yet. Monique proposes the first one in the morning email.</p>;
  return (
    <div>
      {pending && (
        <div className="notice" style={{ marginBottom: 10 }}>
          A new version is waiting for you. <a className="btn btn-small btn-approve" href={`/tap/${encodeURIComponent(pending.tap_token)}?do=approve`}>Approve this version</a>
        </div>
      )}
      <label className="field"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field"><span>The email ({"{first}"} is their first name, {"{names}"} the featured names)</span>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <label className="field"><span>The one follow-up</span><textarea rows={3} value={follow} onChange={(e) => setFollow(e.target.value)} /></label>
      <button className="btn btn-small btn-approve" disabled={busy || !subject.trim() || !body.trim()} onClick={propose}>Save as a new version for me to approve</button>
      {said && <div className="notice" role="status" style={{ marginTop: 10 }}>{said}</div>}
    </div>
  );
}

const PURPOSE: Record<string, string> = { prospecting: "Prospecting", buyers_for_supply: "Buyers for your supply", balance_read: "Balance check" };

function CreditRows({ rows }: { rows: any[] }) {
  const spent = rows.filter((r) => r.purpose !== "balance_read");
  if (spent.length === 0) return <p className="row-sub">No credits used this month.</p>;
  return (
    <div>
      {spent.map((r) => (
        <div className="row" key={r.id}>
          <div className="row-main">
            <div className="row-title">{PURPOSE[r.purpose] ?? r.purpose}{r.company ? `: ${r.company}` : ""}</div>
            <div className="row-sub">{day(r.at)}{r.note ? ` · ${r.note}` : ""}</div>
          </div>
          <div className="row-val">{r.credits}</div>
        </div>
      ))}
    </div>
  );
}
