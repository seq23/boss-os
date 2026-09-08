import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * Relationship Capital — canon §40.
 *
 * The screen answers three questions in order: what am I late on, who am I not
 * keeping up with, and what happens in the next room. Scores are shown with the
 * number that produced them, because a health score nobody can interrogate is a
 * number nobody should act on.
 */

const DAY = 86_400_000;

const day = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : "—");

function Score({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="stat">
      <div className="stat-n">{value === null ? "—" : value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

/**
 * MONIQUE'S FINDINGS — what this screen is for now.
 *
 * Her words, 8 September 2026: "the people tab is stupid, i just want one of the employees to
 * peruse the mailbox and find connections and find people that could be buyers that i havent talked
 * to in a while etc.... and find deals im missing between a buyer and seller in my inbox"
 *
 * She was right, and the reason is worth writing down rather than just deleting the list. The old
 * primary content was 200 rows reading `importance 100 · trust 100 · recency 0 · opportunity 0` —
 * every single row identical, because `contacts-sync` seeds importance and health from one
 * two-wayness score and nothing has ever computed trust, recency or opportunity at all. A scoreboard
 * where everyone has the same score is not information about anyone; it is a directory wearing
 * numbers. The scan that would have caught it does not exist, because `validate:reachable` asks
 * whether a table is written, not whether what is written is worth reading.
 *
 * So the screen leads with findings — an assertion, a reason in dates and counts, and one suggested
 * action — and the roster moves to the bottom as a lookup, with its scores removed rather than
 * shown as though they meant something.
 */
const KIND_LABEL: Record<string, string> = {
  missed_deal: "A deal between two people in your mailbox",
  cooling_buyer: "A buyer going quiet",
  unworked_intro: "An introduction nobody followed up",
  connector: "Someone who keeps introducing people",
};

function Findings({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() { api.mailboxFindings("new").then(setData).catch(onError); }
  useEffect(load, []);

  async function decide(id: string, action: "acted" | "dismissed") {
    setBusy(id);
    try { await api.decideFinding(id, action); load(); }
    catch (e) { onError(e); }
    finally { setBusy(null); }
  }

  if (data === null) return <Loading />;
  const findings: any[] = data.findings ?? [];

  return (
    <>
      <p className="eyebrow">What Monique found in your mailbox</p>
      {/*
        * THE SWEEP'S OWN STATE IS ALWAYS ON SCREEN, above the list rather than instead of it.
        * "No findings" is true both when the sweep ran and found nothing and when it has never run,
        * and those are opposite facts — one is news about her mailbox, the other is a broken job.
        * This is the same defect the Executive Briefing had and it is not repeated here.
        */}
      <div className="row-sub" style={{ marginBottom: 8 }}>{data.sweep?.state}</div>

      {findings.length === 0 ? (
        <Empty
          title="Nothing found this week"
          hint="Monique reads your mail on your own Mac on Sunday evenings. Subjects and bodies stay there; only code names and her reasoning reach Boss OS."
        />
      ) : (
        findings.map((f) => (
          <div className="row" key={f.id}>
            <div className="row-main">
              <div className="row-title">{f.headline}</div>
              <div className="row-sub">
                {KIND_LABEL[f.kind] ?? f.kind} · {f.subject_code}
                {f.counterpart_code ? ` ↔ ${f.counterpart_code}` : ""}
                {f.subject_matter ? ` · ${f.subject_matter}` : ""} · {f.confidence} confidence
              </div>
              {/* Why she should believe it, in dates and counts. Never a quotation from the mail. */}
              <div className="row-sub">{f.because}</div>
              <div className="row-sub"><strong>Do this:</strong> {f.suggested_action}</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small btn-approve" disabled={busy === f.id} onClick={() => decide(f.id, "acted")}>Acted</button>
              <button className="btn btn-small btn-defer" disabled={busy === f.id} onClick={() => decide(f.id, "dismissed")}>Not useful</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}

export function People() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [due, setDue] = useState<any[]>([]);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    Promise.all([api.relationships(), api.followUps("open")])
      .then(([r, f]) => { setRows(r); setDue(f); })
      .catch((e) => { setError(e); setRows([]); });
  }
  useEffect(load, []);

  async function close(id: string, action: "complete" | "drop") {
    setError(null);
    try {
      await api.closeFollowUp(id, action);
      setMsg(action === "complete" ? "Kept. The loop it raised is closed too." : "Dropped. That costs relationship health, on purpose.");
      load();
    } catch (e) { setError(e); }
  }

  if (openPerson) {
    return <Person id={openPerson} onBack={() => { setOpenPerson(null); load(); }} />;
  }

  const now = Date.now();
  const overdue = due.filter((f) => f.due_at < now);
  const upcoming = due.filter((f) => f.due_at >= now);
  const dueTouch = (rows ?? [])
    .filter((r) => r.next_touch_due_at !== null && r.next_touch_due_at < now)
    .sort((a, b) => a.next_touch_due_at - b.next_touch_due_at);

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {msg && <div className="notice" style={{ borderColor: "var(--gold)" }}>{msg}</div>}

      {/* The findings come first, because they are the only thing on this screen she can act on. */}
      <Findings onError={setError} />

      <p className="eyebrow">Owed and late</p>
      {overdue.length === 0 ? (
        <Empty title="Nothing is late" hint="Commitments appear here the day they come due, and on Today as open loops." />
      ) : (
        overdue.map((f) => (
          <div className="row" key={f.id}>
            <div className="row-main">
              <div className="row-title">{f.title}</div>
              <div className="row-sub">
                {f.full_name} · {f.owner === "boss" ? "you owe" : "they owe"} · due {day(f.due_at)}
                {` · ${Math.floor((now - f.due_at) / DAY)} days late`}
              </div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small btn-approve" onClick={() => close(f.id, "complete")}>Kept</button>
              <button className="btn btn-small btn-defer" onClick={() => close(f.id, "drop")}>Dropped</button>
            </div>
          </div>
        ))
      )}

      {upcoming.length > 0 && (
        <>
          <p className="eyebrow">Coming due</p>
          {upcoming.slice(0, 10).map((f) => (
            <div className="row" key={f.id}>
              <div className="row-main">
                <div className="row-title">{f.title}</div>
                <div className="row-sub">{f.full_name} · {f.owner === "boss" ? "you owe" : "they owe"}</div>
              </div>
              <div className="row-val">{day(f.due_at)}</div>
            </div>
          ))}
        </>
      )}

      {/*
        * DUE A TOUCH — the one thing the roster genuinely knows, and the only part of it that names
        * an action. Cadence is OBSERVED from how often these two actually exchange mail, so a
        * fortnightly correspondent is late at three weeks and a twice-a-year one is not.
        */}
      <p className="eyebrow">Due a touch</p>
      {rows === null ? (
        <Loading />
      ) : dueTouch.length === 0 ? (
        <Empty
          title="Nobody is overdue"
          hint="Each person's rhythm is measured from your actual mail, so this is late against their pace rather than a single default."
        />
      ) : (
        dueTouch.slice(0, 25).map((r) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                      onClick={() => setOpenPerson(r.person_id)}>
                {r.full_name}
              </button>
              <div className="row-sub">
                {r.last_contact_at
                  ? `Last exchange ${day(r.last_contact_at)} · you normally speak about every ${r.cadence_days} days`
                  : `No exchange on record · expected about every ${r.cadence_days} days`}
              </div>
            </div>
            <div className="row-val">{Math.floor((now - r.next_touch_due_at) / DAY)}d late</div>
          </div>
        ))
      )}

      {/*
        * ─── THE ROSTER, DEMOTED, WITH ITS SCORES REMOVED ──────────────────────
        *
        * This list used to be the point of the screen and carried four numbers per row. Three of
        * them — trust, recency, opportunity — are read from columns nothing has ever written, so
        * every row showed `trust 100 · recency 0 · opportunity 0`, identically, 200 times. Printing
        * a number that was never computed is worse than printing none: it reads as a measurement.
        *
        * They are gone rather than fixed, because fixing them means inventing a trust model for
        * people the system knows only by hash. What remains is a lookup — who is on file, and a way
        * into their page — and it says plainly that these are code names.
        */}
      <p className="eyebrow">Everyone on file</p>
      {rows === null ? null : rows.length === 0 ? (
        <Empty title="Nobody is on file" hint="Run `npm run contacts:sync -- --commit` on your Mac to build this from your mailbox." />
      ) : (
        <>
          <div className="row-sub" style={{ marginBottom: 8 }}>
            {rows.length} correspondents, by code name. Only your Mac can say who each one is.
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add someone"}</button>
          </div>
          {adding && <AddPerson onDone={() => { setAdding(false); load(); }} />}
          {rows.slice(0, 60).map((r) => (
            <div className="row" key={r.id}>
              <div className="row-main">
                <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                        onClick={() => setOpenPerson(r.person_id)}>
                  {r.full_name}
                </button>
                <div className="row-sub">
                  {[r.role, r.organization_name, r.kind].filter(Boolean).join(" · ")}
                  {r.overdue_follow_ups > 0 ? ` · ${r.overdue_follow_ups} late` : ""}
                </div>
              </div>
              <div className="row-val">{r.last_contact_at ? day(r.last_contact_at) : "—"}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Person({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function load() {
    api.person(id).then(setData).catch(setError);
  }
  useEffect(load, [id]);

  if (openMeeting) {
    return <Meeting id={openMeeting} onBack={() => { setOpenMeeting(null); load(); }} />;
  }
  if (!data) return <Loading />;

  const { person, organization, relationship, meetings, follow_ups, remembered } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{person.full_name}</h3>
        <p className="row-sub">{[person.role, organization?.name].filter(Boolean).join(" · ") || "No role on file"}</p>
        {person.bio && <p>{person.bio}</p>}
        <dl className="kv">
          <dt>Privacy</dt><dd>{person.privacy_class}</dd>
          <dt>Last contact</dt><dd>{day(relationship?.last_contact_at ?? null)}</dd>
          <dt>Next touch due</dt><dd>{day(relationship?.next_touch_due_at ?? null)}</dd>
        </dl>
      </div>

      {relationship ? (
        <>
          <div className="stats">
            <Score label="importance" value={relationship.strategic_importance} />
            <Score label="trust" value={relationship.trust_level} />
            <Score label="recency" value={relationship.recency_score} />
          </div>
          <div className="stats">
            <Score label="opportunity" value={relationship.opportunity_value} />
            <Score label="health" value={relationship.relationship_health} />
            <Score label="cadence (days)" value={relationship.cadence_days} />
          </div>
          {relationship.score_detail && (
            <details>
              <summary className="docket-more" style={{ cursor: "pointer" }}>How that health score was reached</summary>
              <div className="docket-full">
                {(JSON.parse(relationship.score_detail).penalties ?? []).length === 0 ? (
                  <div className="row-sub">Nothing is subtracted: nothing is owed and late.</div>
                ) : (
                  JSON.parse(relationship.score_detail).penalties.map((p: any, i: number) => (
                    <div className="row-sub" key={i}>−{p.points} — {p.reason}</div>
                  ))
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <Empty title="This tie is not scored" hint="Score it to get briefs, cadence and health. Nothing is guessed until you do." />
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => setBooking((v) => !v)}>{booking ? "Close" : "Book a meeting"}</button>
      </div>
      {booking && <BookMeeting personId={person.id} onDone={() => { setBooking(false); load(); }} />}

      <p className="eyebrow">Meetings</p>
      {meetings.length === 0 ? (
        <Empty title="No meetings on record" hint="A meeting gets a brief before and a capture after." />
      ) : (
        meetings.map((m: any) => (
          <div className="row" key={m.id}>
            <div className="row-main">
              <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                      onClick={() => setOpenMeeting(m.id)}>
                {m.title}
              </button>
              <div className="row-sub">
                {day(m.scheduled_at)} · {m.briefed_at ? "briefed" : "not briefed"} · {m.captured_at ? "captured" : "not captured"}
              </div>
            </div>
            <div className="row-val">{m.status}</div>
          </div>
        ))
      )}

      <p className="eyebrow">Commitments</p>
      {follow_ups.length === 0 ? (
        <Empty title="Nothing outstanding" hint="Commitments come from captures, and are surfaced on Today when due." />
      ) : (
        follow_ups.map((f: any) => (
          <div className="row" key={f.id}>
            <div className="row-main">
              <div className="row-title">{f.title}</div>
              <div className="row-sub">{f.owner === "boss" ? "you owe" : "they owe"} · due {day(f.due_at)}</div>
            </div>
            <div className="row-val">{f.status}</div>
          </div>
        ))
      )}

      {remembered.length > 0 && (
        <>
          <p className="eyebrow">Remembered</p>
          {remembered.map((m: any) => (
            <div className="row" key={m.id}>
              <div className="row-main"><div className="row-title">{m.title}</div></div>
              <div className="row-val">{m.tier}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Meeting({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);

  function load() { api.meeting(id).then(setData).catch(setError); }
  useEffect(load, [id]);

  async function brief() {
    setBusy(true); setError(null);
    try { await api.briefMeeting(id); load(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (!data) return <Loading />;
  const { meeting, person, brief: existing, capture, follow_ups } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{meeting.title}</h3>
        <p className="row-sub">{person.full_name} · {day(meeting.scheduled_at)} · {meeting.status}</p>
        {meeting.purpose && <p>{meeting.purpose}</p>}
      </div>

      {!existing ? (
        <div className="btn-row">
          <button className="btn btn-approve" disabled={busy} onClick={brief}>
            {busy ? "Building…" : "Build the brief"}
          </button>
        </div>
      ) : (
        <>
          <p className="eyebrow">Dossier</p>
          <div className="panel">
            <div className="row-sub">
              {existing.dossier.who_they_are.name}
              {existing.dossier.who_they_are.role ? ` · ${existing.dossier.who_they_are.role}` : ""}
              {existing.dossier.who_they_are.organization ? ` · ${existing.dossier.who_they_are.organization.name}` : ""}
            </div>
            <p>{existing.dossier.who_they_are.bio.available ? existing.dossier.who_they_are.bio.value : existing.dossier.who_they_are.bio.reason}</p>
            <dl className="kv">
              <dt>What we want</dt>
              <dd>{existing.dossier.what_we_want.available ? existing.dossier.what_we_want.value : existing.dossier.what_we_want.reason}</dd>
              <dt>The ask</dt>
              <dd>{existing.the_ask.available ? existing.the_ask.value : existing.the_ask.reason}</dd>
            </dl>
            <p className="eyebrow">What they want</p>
            {existing.dossier.what_they_want.available ? (
              existing.dossier.what_they_want.value.map((w: any, i: number) => (
                <div className="row-sub" key={i}>{w.text}</div>
              ))
            ) : (
              <div className="row-sub">{existing.dossier.what_they_want.reason}</div>
            )}
          </div>

          <p className="eyebrow">Three questions worth asking</p>
          {existing.suggested_questions.map((q: any, i: number) => (
            <div className="row" key={i}>
              <div className="row-main">
                <div className="row-title">{q.question}</div>
                <div className="row-sub">{q.why}</div>
              </div>
            </div>
          ))}

          <p className="eyebrow">Landmines</p>
          {existing.dossier.landmines.length === 0 ? (
            <div className="row-sub">{existing.dossier.landmines_note}</div>
          ) : (
            existing.dossier.landmines.map((l: any, i: number) => (
              <div className="row" key={i}>
                <div className="row-main"><div className="row-title">{l.text}</div></div>
                <div className={`risk risk-${l.severity === "high" ? "high" : "medium"}`}>{l.severity}</div>
              </div>
            ))
          )}

          <p className="eyebrow">History</p>
          <dl className="kv">
            <dt>Meetings held</dt><dd>{existing.relationship_history.meetings_held}</dd>
            <dt>Open commitments</dt><dd>{existing.relationship_history.open_follow_ups.length}</dd>
            <dt>Overdue</dt><dd>{existing.relationship_history.overdue_follow_ups}</dd>
          </dl>
        </>
      )}

      <p className="eyebrow">After the room</p>
      {capture ? (
        <div className="panel">
          <p>{capture.notes}</p>
          <div className="row-sub">
            {capture.follow_up_count} follow-up{capture.follow_up_count === 1 ? "" : "s"} ·
            {" "}{capture.memory_candidate_count} memory candidate{capture.memory_candidate_count === 1 ? "" : "s"}
            {capture.sentiment ? ` · ${capture.sentiment}` : ""}
          </div>
          {follow_ups.map((f: any) => (
            <div className="row" key={f.id}>
              <div className="row-main">
                <div className="row-title">{f.title}</div>
                <div className="row-sub">{f.owner === "boss" ? "you owe" : "they owe"} · due {day(f.due_at)}</div>
              </div>
              <div className="row-val">{f.status}</div>
            </div>
          ))}
        </div>
      ) : capturing ? (
        <CaptureForm id={id} onDone={() => { setCapturing(false); load(); }} />
      ) : (
        <div className="btn-row">
          <button className="btn" onClick={() => setCapturing(true)}>Capture the meeting</button>
        </div>
      )}
    </>
  );
}

function CaptureForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [made, setMade] = useState("");
  const [received, setReceived] = useState("");
  const [trust, setTrust] = useState("0");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const lines = (value: string) =>
    value.split("\n").map((l) => l.trim()).filter(Boolean).map((text) => ({ text }));

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.captureMeeting(id, {
        notes,
        commitments_made: lines(made),
        commitments_received: lines(received),
        trust_delta: Number(trust) || 0,
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field">
        <span>What was said</span>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="field">
        <span>What you committed to — one per line</span>
        <textarea rows={2} value={made} onChange={(e) => setMade(e.target.value)} />
      </label>
      <label className="field">
        <span>What they committed to — one per line</span>
        <textarea rows={2} value={received} onChange={(e) => setReceived(e.target.value)} />
      </label>
      <label className="field">
        <span>Trust moved by</span>
        <input value={trust} onChange={(e) => setTrust(e.target.value)} inputMode="numeric" />
      </label>
      <p className="row-sub">
        Every capture leaves at least one follow-up and one memory promotion candidate. If nothing was
        committed, the recap is the commitment.
      </p>
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !notes.trim()} onClick={submit}>
        {busy ? "Saving…" : "Capture"}
      </button>
    </div>
  );
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [importance, setImportance] = useState("50");
  const [trust, setTrust] = useState("50");
  const [opportunity, setOpportunity] = useState("0");
  const [cadence, setCadence] = useState("30");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const person = await api.createPerson({ full_name: fullName, role: role || null });
      await api.createRelationship({
        person_id: person.id,
        strategic_importance: Number(importance),
        trust_level: Number(trust),
        opportunity_value: Number(opportunity),
        cadence_days: Number(cadence),
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>Name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
      <label className="field"><span>Role</span>
        <input value={role} onChange={(e) => setRole(e.target.value)} /></label>
      <label className="field"><span>Strategic importance (0–100)</span>
        <input value={importance} onChange={(e) => setImportance(e.target.value)} inputMode="numeric" /></label>
      <label className="field"><span>Trust (0–100)</span>
        <input value={trust} onChange={(e) => setTrust(e.target.value)} inputMode="numeric" /></label>
      <label className="field"><span>Opportunity value (0–100)</span>
        <input value={opportunity} onChange={(e) => setOpportunity(e.target.value)} inputMode="numeric" /></label>
      <label className="field"><span>Cadence in days</span>
        <input value={cadence} onChange={(e) => setCadence(e.target.value)} inputMode="numeric" /></label>
      <p className="row-sub">Recency and health are derived from these and from what is outstanding.</p>
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !fullName.trim()} onClick={submit}>
        {busy ? "Saving…" : "Add"}
      </button>
    </div>
  );
}

function BookMeeting({ personId, onDone }: { personId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [ask, setAsk] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.createMeeting({
        person_id: personId,
        title,
        purpose: purpose || null,
        the_ask: ask || null,
        scheduled_at: new Date(when).getTime(),
      });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>When</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="field"><span>What you want out of it</span>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
      <label className="field"><span>The one ask</span>
        <input value={ask} onChange={(e) => setAsk(e.target.value)} /></label>
      <button className="btn btn-approve" style={{ width: "100%" }} disabled={busy || !title.trim()} onClick={submit}>
        {busy ? "Saving…" : "Book it"}
      </button>
    </div>
  );
}
