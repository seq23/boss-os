import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { inOwnerZone, dayInOwnerZone, OWNER_TIMEZONE_LABEL } from "../../../shared/boss/timezone";

/**
 * Spirit — canon §43, §42.1–42.3, §44, and §5.2.
 *
 * The layout is the specification. Reality comes first on the screen because
 * canon §5.2 says it comes first, full stop; the sky follows as context and
 * says so; and the contribution and ancestor sections carry canon §44's tone,
 * which is not decorative — nothing here is a streak, a score or a red number.
 */

/*
 * EVERY TIME ON THIS PAGE IS IN THE OWNER'S ZONE, not the browser's.
 *
 * These read `toLocaleDateString()` and `toLocaleString()` with no arguments, which renders in
 * whatever zone the device is in. That happened to be right — and it made the whole almanac read
 * as UTC in any session where it was not, which is how a Moon phase at 10:28pm becomes one at
 * 5:28am on the wrong day. An astronomical instant is fixed; only its presentation is local, and it
 * should be local to HER.
 */
const day = (ts: number | null) => dayInOwnerZone(ts);
const pct = (bps: number) => `${Math.round(bps / 100)}%`;

export function Spirit() {
  const [signal, setSignal] = useState<any | null>(null);
  const [month, setMonth] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openManifestation, setOpenManifestation] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [recordingHour, setRecordingHour] = useState(false);

  function load() {
    Promise.all([api.spiritDay(), api.spiritMonth()])
      .then(([d, m]) => { setSignal(d); setMonth(m); })
      .catch(setError);
  }
  useEffect(load, []);

  if (openManifestation) {
    return <Manifestation id={openManifestation} onBack={() => { setOpenManifestation(null); load(); }} />;
  }
  if (!signal || !month) return <Loading />;

  const { astro, reality_priority, rituals_due, contribution, ancestors, manifestations } = signal;
  const practice = signal.practice;
  const sky = signal.sky;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/* Canon §5.2: reality first, before anything about the sky. */}
      <div className="notice" style={{ borderColor: reality_priority.warning ? "var(--reject)" : undefined }}>
        <strong>{reality_priority.warning ? "Reality first" : "Nothing operational is waiting"}</strong>
        <div className="row-sub">{reality_priority.text}</div>
        <div className="row-sub">{reality_priority.rule}</div>
      </div>

      {/*
        * THIS MORNING COMES FIRST, and everything about the sky comes after it.
        *
        * The page used to open on moon phase and illumination — true, computed, and not a thing to
        * do at 6am. §8.1 says Spirit is an ACTIVE operating pillar that must be rendered explicitly
        * in the daily agenda, and the agenda was rendering astronomy instead. The order on this
        * screen is now the order of §5.2: what is real, then what she does, then what is overhead.
        */}
      {practice && (
        <>
          <p className="eyebrow">This morning</p>

          {/*
            * THE SENTENCE IS THE LARGEST THING ON THE PAGE, because §8.5 says she should not have
            * to invent it and it is meant to be said out loud. Rendering it as one more row of
            * small grey text would make it something to skim past.
            */}
          <div className="panel">
            {practice.gratitude.sentence ? (
              <>
                <p className="coach-promise" style={{ marginTop: 0 }}>{practice.gratitude.sentence}</p>
                <p className="row-sub">
                  Say it out loud. Today's theme: {practice.gratitude.theme}
                </p>
                {/* Provenance, so it is never mistaken for something a vendor wrote. */}
                <p className="row-sub">{practice.gratitude.source}</p>
              </>
            ) : (
              // Named, never replaced with something generic — that is the whole of §8.5's ban on
              // filler, and a stock line here would be indistinguishable from a real one.
              <p className="row-sub">{practice.gratitude.unavailable}</p>
            )}
          </div>

          <div className="panel">
            <div className="row">
              <div className="row-main">
                <div className="row-title">
                  {practice.manifestation.floor ? "Spirit floor" : "Manifestation"} — {practice.manifestation.minutes} minutes
                </div>
                <div className="row-sub">{practice.manifestation.note}</div>
              </div>
            </div>
            {practice.manifestation.steps.map((step: any, i: number) => (
              <div className="row" key={i}>
                <div className="row-main">
                  <div className="row-sub">{i + 1}. {step.what}</div>
                </div>
                <div className="row-val">{step.minutes ? `${step.minutes} min` : "—"}</div>
              </div>
            ))}
          </div>

          {/*
            * THE MOVEMENT WAS ALREADY BEING COMPUTED AND SHOWN NOWHERE. The Morning Gate wrote the
            * whole contract — the stored sequence, today's rotated somatic lanes — into
            * `morning_agenda`, and no screen read it. Built, stored, invisible.
            */}
          <div className="panel">
            <div className="row">
              <div className="row-main">
                <div className="row-title">Movement{practice.body.bed_only ? " — all of it in bed" : ""}</div>
                <div className="row-sub">{practice.body.movement_floor}</div>
              </div>
            </div>
            {practice.body.launch_sequence.map((m: string, i: number) => (
              <div className="row-sub" key={i}>{i + 1}. {m}</div>
            ))}
            {practice.body.somatic.length > 0 && (
              <>
                <p className="eyebrow">Somatic — today's rotation</p>
                {practice.body.somatic.map((sq: any) => (
                  <div className="row" key={sq.lane}>
                    <div className="row-main">
                      <div className="row-sub">{sq.title}: {sq.movement}</div>
                    </div>
                    {/* The novelty engine saying why, so a rotation is visibly a rotation. */}
                    <div className="row-val">{sq.because}</div>
                  </div>
                ))}
              </>
            )}
            <p className="row-sub">{practice.body.hydration} {practice.body.medication}</p>
            <p className="row-sub">{practice.body.safety_stop}</p>
          </div>
        </>
      )}

      {/*
        * WHAT IS OVERHEAD, IN TWO LISTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
        *
        * The old panel rendered one list and it was always the same two outer-planet aspects — true
        * last month, true next month, and therefore nothing to read at 6am. Today's fast aspects
        * (Moon through Mars) are the part that is actually about today; the slow ones are the
        * season, kept but put second and collapsed into a quieter block so they cannot crowd out
        * the thing she opened the page for.
        *
        * Every line carries what it MEANS, composed in the Worker from what the moving body does
        * and what the natal point is. §5.2 is restated at the bottom of the panel rather than only
        * at the top of the page: a reader scrolling to "Mars square your natal Sun" should not have
        * to remember a caveat from four sections earlier.
        */}
      {sky && (
        <>
          <p className="eyebrow">Today's sky, against your chart</p>
          <div className="panel">
            {!sky.available ? (
              <p className="row-sub">{sky.reason}</p>
            ) : sky.quiet ? (
              <p className="row-sub">
                Nothing fast is touching your chart today. That is a real answer, not a gap — most days
                are quiet, and a quiet day is the one where what you do is entirely yours.
              </p>
            ) : (
              sky.active.map((t: any) => (
                <div className="row" key={`${t.body}-${t.natal_point}-${t.aspect}`}>
                  <div className="row-main">
                    <div className="row-title">
                      {t.body_name} {t.aspect} your natal {t.natal_point_name}
                      {t.retrograde ? " ℞" : ""}
                      {t.applying ? "" : " · separating"}
                    </div>
                    <div className="row-sub">{t.meaning}</div>
                    <div className="row-sub">
                      {t.body_name} now in {t.sign} {t.degrees_in_sign.toFixed(1)}° · your natal{" "}
                      {t.natal_point_name} at {t.natal_sign} {t.natal_degrees_in_sign.toFixed(1)}° ·{" "}
                      {t.orb.toFixed(1)}° from exact
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {sky.available && sky.season && sky.season.length > 0 && (
            <>
              <p className="eyebrow">The longer weather ({sky.season.length})</p>
              <div className="panel">
                {/* Jupiter outward. Months, not hours — read once, not every morning. */}
                {sky.season.map((t: any) => (
                  <div className="row" key={`${t.body}-${t.natal_point}-${t.aspect}`}>
                    <div className="row-main">
                      <div className="row-title">
                        {t.body_name} {t.aspect} your natal {t.natal_point_name}
                        {t.retrograde ? " ℞" : ""}
                      </div>
                      <div className="row-sub">{t.meaning}</div>
                      <div className="row-sub">{t.orb.toFixed(1)}° from exact</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {sky.available && (
            <div className="panel">
              <p className="row-sub">{sky.caveat}</p>
              <p className="row-sub">{sky.note}</p>
            </div>
          )}
        </>
      )}

      <p className="eyebrow">Sky — advisory</p>
      <div className="panel">
        <h3 style={{ margin: 0 }}>{astro.phase}</h3>
        <p className="row-sub">
          Moon in {astro.moon_sign} at {astro.degrees_in_sign.toFixed(1)}°
          {astro.cusp ? ` — near the cusp, possibly ${astro.next_sign}` : ""} · {pct(astro.illumination_bps)} lit ·
          {astro.waxing ? " waxing" : " waning"}
        </p>
        {/* Canon §42.2 names the window; the day says which one it is in. */}
        {astro.canon_window && (
          <p className="row-sub"><strong>{astro.canon_window}</strong> window</p>
        )}
        {astro.windows.length > 0 && (
          <>
            <p className="eyebrow">Windows</p>
            {astro.windows.map((w: any, i: number) => (
              <div className="row-sub" key={i}>{w.label}</div>
            ))}
          </>
        )}
        <p className="row-sub">{signal.note}</p>
        <p className="row-sub">{astro.method}</p>
      </div>

      <p className="eyebrow">Practice today</p>
      {rituals_due.length === 0 ? (
        <Empty title="Nothing due" hint="Rituals appear here on the day they are due, and nowhere else." />
      ) : (
        rituals_due.map((r: any) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <div className="row-title">{r.name}</div>
              <div className="row-sub">{r.cadence} · {r.why}</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-small btn-approve" onClick={() => api.ritualDone(r.id).then(load).catch(setError)}>
                Done
              </button>
            </div>
          </div>
        ))
      )}

      <p className="eyebrow">Contribution — {contribution.month}</p>
      <div className="panel">
        <div className="stats">
          <div className="stat"><div className="stat-n">{contribution.count}</div><div className="stat-l">this month</div></div>
          <div className="stat"><div className="stat-n">{contribution.minimum}</div><div className="stat-l">the floor</div></div>
          <div className="stat"><div className="stat-n">{contribution.ideal}</div><div className="stat-l">a good month</div></div>
        </div>
        <p className="row-sub">{contribution.tone}</p>
        <button className="btn" style={{ width: "100%" }}
                onClick={() => api.recordContribution({ kind: "help" }).then(load).catch(setError)}>
          Record a contribution
        </button>
      </div>

      {/*
        * THE ANCESTOR HOUR IS A STANDING REMINDER, and there is deliberately no dismiss control.
        *
        * The owner asked for it in those terms: it clears when she can say she completed it and
        * name the day and time. A dismiss button would have been the easiest thing to add and the
        * least use to her — it turns a reminder into something you get rid of instead of doing.
        *
        * §44's tone is unchanged. It is outstanding, not late; there is no schedule here.
        */}
      <p className="eyebrow">Ancestors — {ancestors.month}</p>
      <div className="panel">
        <p className="row-sub">{ancestors.minutes} of {ancestors.target_minutes} minutes.</p>
        <p className="row-sub">{ancestors.tone}</p>
        {ancestors.standing ? (
          <>
            <p className="row-sub">{ancestors.dismissal}</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setRecordingHour((v) => !v)}>
                {recordingHour ? "Close" : "I did this"}
              </button>
            </div>
            {recordingHour && (
              <RecordAncestorHour
                remaining={ancestors.remaining_minutes}
                onDone={() => { setRecordingHour(false); load(); }}
                onError={setError}
              />
            )}
          </>
        ) : (
          <p className="row-sub">The hour is recorded for this month.</p>
        )}
      </div>

      <p className="eyebrow">Manifestations</p>
      <div className="btn-row">
        <button className="btn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Open one"}</button>
      </div>
      {adding && <AddManifestation onDone={(id) => { setAdding(false); load(); setOpenManifestation(id); }} />}
      {month.manifestations.length === 0 ? (
        <Empty title="Nothing open" hint="A manifestation is held with a first concrete action, and closed by what you did." />
      ) : (
        month.manifestations.map((m: any) => (
          <div className="row" key={m.id}>
            <div className="row-main">
              <button className="row-title" style={{ background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}
                      onClick={() => setOpenManifestation(m.id)}>
                {m.title}
              </button>
              <div className="row-sub">Next: {m.first_action}</div>
            </div>
            <div className="row-val">{m.target_at ? day(m.target_at) : "open"}</div>
          </div>
        ))
      )}
      {manifestations.without_evidence_this_month > 0 && (
        <div className="row-sub">
          {manifestations.without_evidence_this_month} with nothing done or happened this month.
        </div>
      )}

      <p className="eyebrow">Almanac — {month.month}</p>
      {month.almanac.filter((e: any) => e.kind !== "window").map((e: any) => (
        <div className="row" key={e.id}>
          <div className="row-main">
            <div className="row-title">{e.label}</div>
            <div className="row-sub">
              {inOwnerZone(e.starts_at)} {OWNER_TIMEZONE_LABEL} · {e.source === "imported" ? "entered from an almanac" : "computed"}
            </div>
          </div>
        </div>
      ))}

      {/*
        * WAS "ENTERED BY HAND", AND NOTHING HERE IS ANY MORE. Retrogrades, shadow windows and
        * ingresses are computed now, so this section reports what exists rather than what is owed.
        * The hand-entered count stays visible because a correction someone typed should never be
        * indistinguishable from a number the arithmetic produced.
        */}
      <p className="eyebrow">Coverage</p>
      {month.coverage?.manual.map((m: any) => (
        <div className="row" key={m.key}>
          <div className="row-main">
            <div className="row-title">{m.label}</div>
            <div className="row-sub">
              {m.rows > 0 ? `${m.months_covered} months covered` : m.how}
              {m.imported_rows > 0 && ` · ${m.imported_rows} entered by hand`}
            </div>
          </div>
          <div className="row-val">{m.status}</div>
        </div>
      ))}
      {month.coverage && !month.coverage.complete && (
        <div className="row-sub">{month.coverage.note}</div>
      )}

      {/*
        * THE SECTION ONLY APPEARS IF SOMETHING IS ACTUALLY DEFERRED. It used to list three items
        * permanently, two of which were never blocked on anything. An empty heading reading "not
        * computed here" over nothing would be the same mistake in a quieter font.
        */}
      {month.deferred?.length > 0 && (
        <>
          <p className="eyebrow">Not computed here</p>
          {month.deferred.map((d: any) => (
            <div className="row" key={d.key}>
              <div className="row-main"><div className="row-title">{d.label}</div></div>
              <div className="row-val">{d.status}</div>
            </div>
          ))}
        </>
      )}

      {/*
        * THE ONE THING ONLY SHE CAN SUPPLY. Not a deferral and not a gap in the build — a question,
        * with what it needs and why the birth TIME is the part that matters.
        */}
      {month.owner_inputs?.length > 0 && (
        <>
          <p className="eyebrow">Waiting on you</p>
          {month.owner_inputs.map((o: any) => (
            <div className="row" key={o.key}>
              <div className="row-main">
                <div className="row-title">{o.label}</div>
                <div className="row-sub">{o.needs}</div>
                <div className="row-sub">{o.why}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Manifestation({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [kind, setKind] = useState("action");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  function load() { api.manifestation(id).then(setData).catch(setError); }
  useEffect(load, [id]);

  async function addEvidence() {
    setError(null);
    try {
      await api.addEvidence(id, { kind, description, reference: reference || undefined });
      setDescription(""); setReference("");
      load();
    } catch (e) { setError(e); }
  }

  if (!data) return <Loading />;
  const { manifestation, evidence, progress } = data;

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <button className="btn btn-small" onClick={onBack}>Back</button>

      <div className="panel">
        <h3 style={{ margin: 0 }}>{manifestation.title}</h3>
        <p>{manifestation.statement}</p>
        <p className="row-sub">First action: {manifestation.first_action}</p>
        <p className="row-sub">{manifestation.status}{manifestation.target_at ? ` · by ${day(manifestation.target_at)}` : ""}</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-n">{progress.actions}/{progress.actions_required}</div><div className="stat-l">actions</div></div>
        <div className="stat"><div className="stat-n">{progress.verifiable_results}/{progress.verifiable_results_required}</div><div className="stat-l">results</div></div>
        <div className="stat"><div className="stat-n">{progress.signs}</div><div className="stat-l">signs (0 count)</div></div>
      </div>

      {manifestation.status === "open" && (
        <div className="panel">
          <label className="field"><span>What happened</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="action">something I did</option>
              <option value="result">something that happened, checkable</option>
              <option value="sign">a sign — kept, never counted</option>
            </select>
          </label>
          <label className="field"><span>Describe it</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          {kind === "result" && (
            <label className="field"><span>Where can it be checked?</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          )}
          <button className="btn" style={{ width: "100%" }} disabled={!description.trim()} onClick={addEvidence}>Record it</button>
        </div>
      )}

      {manifestation.status === "open" && (
        <div className="btn-row">
          <button className="btn btn-approve" disabled={!progress.can_close}
                  onClick={() => api.markManifested(id).then(load).catch(setError)}>
            {progress.can_close ? "Mark it manifested" : "Not closeable yet"}
          </button>
        </div>
      )}

      <p className="eyebrow">Evidence</p>
      {evidence.length === 0 ? (
        <Empty title="Nothing recorded" hint="Three things you did and one checkable thing that happened." />
      ) : (
        evidence.map((e: any) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">{e.description}</div>
              <div className="row-sub">
                {e.kind}{e.kind === "sign" ? " · does not count" : ""}{e.reference ? ` · ${e.reference}` : ""}
              </div>
            </div>
            <div className="row-val">{day(e.ts)}</div>
          </div>
        ))
      )}
    </>
  );
}

function AddManifestation({ onDone }: { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [firstAction, setFirstAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const created = await api.createManifestation({ title, statement, first_action: firstAction });
      onDone(created.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      <label className="field"><span>What</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Stated plainly</span>
        <textarea rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} /></label>
      <label className="field"><span>The first concrete action</span>
        <input value={firstAction} onChange={(e) => setFirstAction(e.target.value)} /></label>
      <p className="row-sub">
        Required. What closes this is what you did and what happened — signs are kept because they matter to you,
        and they never count.
      </p>
      <button className="btn btn-approve" style={{ width: "100%" }}
              disabled={busy || !title.trim() || !statement.trim() || !firstAction.trim()} onClick={submit}>
        {busy ? "Saving…" : "Hold it"}
      </button>
    </div>
  );
}

/**
 * Recording the ancestor hour, which is the only thing that clears the reminder.
 *
 * THE DAY AND TIME ARE A FIELD, NOT A DEFAULT. The endpoint would happily stamp `now`, and that is
 * the wrong shape for this: the owner asked to clear it by SAYING she completed it and when. An
 * hour sat with on Sunday evening and recorded on Tuesday is a Sunday evening — silently filing it
 * under Tuesday would quietly make the record wrong in the only field that matters.
 *
 * It is pre-filled with now because most of the time that is the answer, and it is editable because
 * sometimes it is not.
 */
function RecordAncestorHour({ remaining, onDone, onError }: {
  remaining: number;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  // datetime-local reads in the BROWSER's zone, and the browser is not authoritative here — the
  // value is converted through the owner's zone on the way out so the record means the same thing
  // wherever she happens to be sitting.
  const [when, setWhen] = useState(() => localInputValue(Date.now()));
  const [who, setWho] = useState("");
  const [minutes, setMinutes] = useState(String(remaining || 60));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const ts = Date.parse(when);
    if (!Number.isFinite(ts)) return onError(new Error("Say the day and time you did it."));
    if (!who.trim()) return onError(new Error("Name who you sat with. That is the record."));
    setBusy(true);
    try {
      await api.recordAncestorHour({
        who: who.trim(),
        minutes: Number(minutes) || 0,
        ts,
        note: note.trim() || undefined,
      });
      onDone();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <label className="field">
        <span>The day and time you did it</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="field">
        <span>Who you sat with</span>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="A name, or the line" />
      </label>
      <label className="field">
        <span>Minutes</span>
        <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" />
      </label>
      <label className="field">
        <span>Anything worth keeping (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="decide">
        <button className="btn btn-approve" disabled={busy} onClick={() => void submit()}>
          {busy ? "…" : "Record it"}
        </button>
      </div>
    </div>
  );
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, from an instant. */
function localInputValue(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
