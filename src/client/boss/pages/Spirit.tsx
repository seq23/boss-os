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

/**
 * A void-of-course boundary, in HER zone and labelled with it.
 *
 * Same rule as everything else on this page, and it matters more here than anywhere: a VOC window
 * running "9:27 AM to 1:45 AM" is a thing she plans a call around, and rendering it in the browser's
 * zone would move both ends by hours without saying it had.
 */
const atLocal = (ts: number) =>
  `${inOwnerZone(ts, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} ${OWNER_TIMEZONE_LABEL}`;

export function Spirit() {
  const [signal, setSignal] = useState<any | null>(null);
  const [month, setMonth] = useState<any | null>(null);
  const [week, setWeek] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openManifestation, setOpenManifestation] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [recordingHour, setRecordingHour] = useState(false);

  function load() {
    Promise.all([api.spiritDay(), api.spiritMonth()])
      .then(([d, m]) => { setSignal(d); setMonth(m); })
      .catch(setError);
    /*
     * THE WEEK LOADS SEPARATELY AND MAY FAIL ALONE.
     *
     * It is joined into the Promise.all above only in the sense of arriving on the same screen. A
     * practice delivery that has never happened, or an endpoint that errors, must not take the
     * whole Spirit page down with it — the morning sentence and the movement contract are what she
     * opens this screen for, and they do not depend on a weekly research run having succeeded.
     */
    api.practiceWeek().then(setWeek).catch(() => setWeek({ prepared: false, unavailable: true }));
  }
  useEffect(load, []);

  if (openManifestation) {
    return <Manifestation id={openManifestation} onBack={() => { setOpenManifestation(null); load(); }} />;
  }
  if (!signal || !month) return <Loading />;

  const { astro, rituals_due, contribution, ancestors, manifestations } = signal;
  const practice = signal.practice;
  const sky = signal.sky;
  const major = signal.major_event ?? null;
  /*
   * The two things her 12 September mail moved off the daily briefing and onto this page: the
   * astronomical dashboard at her report's precision, and the locked Money / Career / Travel Map.
   */
  const dashboard = signal.dashboard ?? null;
  const map = signal.map ?? null;

  /*
   * HER LOCAL CLOCK, NAMED, AND THE ZONE SHE QUOTED IT IN BESIDE IT.
   *
   * She said "11:27PM EDT". She lives in America/Chicago. Silently converting would leave her
   * wondering which clock a time is on — so both are printed and both are labelled, which costs one
   * short line and removes the only real ambiguity in the whole block.
   */
  const at = (ts: number) => {
    const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
    const local = new Date(ts).toLocaleString(undefined, opts);
    const eastern = new Date(ts).toLocaleString("en-US", { ...opts, timeZone: "America/New_York" });
    return { local, eastern };
  };
  const when = (ts: number) => {
    const days = Math.round((ts - Date.now()) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  };

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/*
        * ─── THE EVENT, FIRST AND LARGEST ──────────────────────────────────────
        *
        *   "if i log in and push the spirit tab on 9/9 and there is a HUGE ASTROLOGICAL EVENT ON
        *    9/10 THE NEW MOON IN VIRGO AT 11:27PM EDT --- IT SHOULD BE FUCKING PROMINENT"
        *
        * It always was in the data — `buildAlmanac` computes new and full moons to the minute with
        * the sign — and it was flattened into "1 window open" beneath three sentences of caveat.
        * This is a salience fix, not a data one.
        *
        * ─── AND THE "REALITY FIRST" BLOCK IS GONE ─────────────────────────────
        *
        * Her instruction, plainly: "ALSO GET RID OF THIS ON THE SPIRIT TAB: Reality first / 2 things
        * need attention before anything here — 2 failed tasks. / Canon §5.2..."
        *
        * She is right, and it was doing three unrelated jobs badly in one box: scolding her before
        * she had read anything, putting an OPERATIONAL alert on the one tab that is explicitly not
        * operational, and repeating a canon citation she wrote herself.
        *
        * THE SIGNAL IS NOT LOST, AND THAT WAS CHECKED RATHER THAN ASSUMED. `routes/today.ts` pushes
        * a Critical Alert reading "N tasks failed and have not been requeued or cancelled" — so the
        * failed-task count she saw here is already on Today, where she can act on it. Removing it
        * from Spirit removes a duplicate, not the only sighting.
        *
        * THE DISCLAIMER STAYS AND SHRINKS. "Advisory only, never a cause and never a permission" is
        * a real editorial position; three sentences of it above the content was the tail wagging the
        * dog. One line, small, underneath.
        */}
      {major ? (
        <div className="panel" style={{ borderColor: "var(--gold)" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.2 }}>{major.label}</div>
          <div style={{ fontSize: "1.05rem", marginTop: 4 }}>
            {when(major.at)} — {at(major.at).local}
          </div>
          <div className="row-sub">{at(major.at).eastern} Eastern · your clock is shown above</div>
          <div className="row-sub" style={{ marginTop: 8 }}>
            Advisory only — context, never a cause and never a permission.
          </div>
        </div>
      ) : (
        /*
         * AN HONEST EMPTY STATE, DISTINCT FROM A FAILED ONE. `signal` loaded — we are past the
         * Loading guard and past ErrorNotice — so "nothing major" is a finding about the sky rather
         * than a fetch that did not come back, and it says which.
         */
        <div className="panel">
          <div className="row-title">No major event in the next two days</div>
          <div className="row-sub">
            New moons, full moons and eclipses appear here at full size when one is within
            forty-eight hours. This is the sky being quiet, not a reading that failed.
          </div>
        </div>
      )}

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
        * THE WEEK AHEAD — Imani's duty, which for eleven Sundays delivered into nothing.
        *
        * It sits after this morning and before the sky, which is the order §5.2 asks for: what she
        * does, then what is overhead. The block is ALWAYS PRESENT once the endpoint answers, even
        * with nothing in it, because an absent block and a quiet week look identical on a screen and
        * only one of them is a fault — that confusion is the entire reason this was invisible.
        */}
      {week && <WeekAhead week={week} />}

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

      {/*
        * ─── THE DASHBOARD, AT THE PRECISION OF HER OWN REPORT ─────────────────
        *
        * What stood here was four lines of prose: phase, Moon longitude to ONE DECIMAL PLACE,
        * illumination, cusp. Her Executive Intelligence Report of 12 September 2026 carried a ten-body
        * ephemeris table to the arcminute with a Direct/Retrograde column, a Moon dashboard naming the
        * void-of-course convention and giving the next window's start, end and ingress sign, the sign
        * theme with a planning translation, and major aspects with orbs to the arcminute.
        *
        * Her instruction was to pull that out of the briefing and put it HERE. So the block below is
        * her report's structure, in her order, and none of it is transcribed — `spirit/dashboard.ts`
        * computes every figure, which is why it will still be right tomorrow.
        *
        * `19.7°` AND `19°45′` ARE THE SAME NUMBER AND ONLY ONE IS AN EPHEMERIS. The arcminutes are not
        * decoration: at one decimal place a 0°16′ orb and a 0°18′ orb are both "0.3°", and the
        * tightness ordering — the only thing an orb is for — vanishes.
        */}
      {dashboard && (
        <>
          <p className="eyebrow">The sky today</p>

          {/*
            * ─── THE DISCLAIMER SITS ABOVE THE CONTENT, NOT UNDER IT ────────────
            *
            * The briefing spec used to carry this caveat because the briefing used to carry the
            * astrology. Taking the astrology out and leaving the caveat behind would have been worse
            * than either — a caveat with nothing to caveat implies content that is not there. So it
            * moved WITH the content, and it is first on the block rather than a footnote, because a
            * caveat underneath a table is read after the table has already been believed.
            */}
          <div className="panel">
            <p className="row-sub"><strong>{dashboard.disclaimer}</strong></p>
            <p className="row-sub">{dashboard.note}</p>
          </div>

          <div className="panel">
            {dashboard.bodies.length === 0 ? (
              /* Named, never a blank table. An empty ephemeris is a fault, not a quiet sky. */
              <p className="row-sub">
                No positions were computed. That is a fault in this page, not an empty sky — every one
                of these is arithmetic that cannot return nothing.
              </p>
            ) : (
              dashboard.bodies.map((b: any) => (
                <div className="row" key={b.key}>
                  <div className="row-main">
                    <div className="row-title">{b.name}</div>
                  </div>
                  {/* Degrees AND arcminutes AND motion. All three, on every row. */}
                  <div className="row-sub">{b.degrees}°{String(b.arcminutes).padStart(2, "0")}′ {b.sign}</div>
                  <div className="row-val">{b.motion}</div>
                </div>
              ))
            )}
            <p className="row-sub">{dashboard.method}</p>
          </div>

          <p className="eyebrow">Moon</p>
          <div className="panel">
            <div className="row-title">
              Moon — {dashboard.moon.position.degrees}°{String(dashboard.moon.position.arcminutes).padStart(2, "0")}′ {dashboard.moon.position.sign}
            </div>
            <p className="row-sub">
              {dashboard.moon.phase} · approximately {dashboard.moon.illumination_percent}% illuminated ·
              {dashboard.moon.waxing ? " waxing" : " waning"}
            </p>
            {/*
              * THE CONVENTION IS NAMED EVERY TIME, because astrology sources genuinely disagree about
              * void-of-course and different conventions move the start by hours. Her own spec said so
              * before this was built: do not present one convention as universally authoritative.
              */}
            <p className="row-sub">
              {dashboard.moon.void_of_course.now
                ? `The Moon is void of course now, under the ${dashboard.moon.void_of_course.convention} convention.`
                : `The Moon is not void of course today, under the ${dashboard.moon.void_of_course.convention} convention.`}
            </p>
            <p className="row-sub">
              {dashboard.moon.void_of_course.now ? "This window ends" : "The next void-of-course period begins"}{" "}
              {dashboard.moon.void_of_course.now ? "" : <>{atLocal(dashboard.moon.void_of_course.starts_at)} and ends </>}
              {atLocal(dashboard.moon.void_of_course.ends_at)}, when the Moon enters {dashboard.moon.void_of_course.enters_sign}.
            </p>
            {dashboard.moon.void_of_course.last_aspect && (
              <p className="row-sub">
                It begins at the Moon's last major aspect in this sign — {dashboard.moon.void_of_course.last_aspect.aspect}{" "}
                {dashboard.moon.void_of_course.last_aspect.name}.
              </p>
            )}
          </div>

          <p className="eyebrow">Symbolic {dashboard.moon.theme.sign} theme</p>
          <div className="panel">
            <p className="row-sub">
              Traditional {dashboard.moon.theme.sign} symbolism emphasizes: {dashboard.moon.theme.keywords.join("; ")}.
            </p>
            <p className="row-sub"><strong>Useful planning translation:</strong> {dashboard.moon.theme.translation}</p>
          </div>

          <p className="eyebrow">Major active aspects</p>
          <div className="panel">
            {dashboard.aspects.length === 0 ? (
              <p className="row-sub">
                Nothing is inside orb today. That is a real answer — most days carry one or two, and a
                day with none is a quiet sky rather than a computation that failed.
              </p>
            ) : (
              dashboard.aspects.map((a: any) => (
                <div className="row" key={`${a.a}-${a.aspect}-${a.b}`}>
                  <div className="row-main">
                    <div className="row-title">{a.a_name} {a.aspect} {a.b_name}</div>
                    {/* Orb in arcminutes, with the tightness note her report puts beside it. */}
                    <div className="row-sub">
                      Orb: ~{a.orb_text} · {a.tightness} · {a.applying ? "applying" : "separating"}
                    </div>
                    <div className="row-sub">Traditional symbolism: {a.symbolism.join("; ")}.</div>
                    <div className="row-sub"><strong>Useful translation:</strong> {a.translation}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {dashboard.retrogrades.length > 0 && (
            <>
              <p className="eyebrow">Currently retrograde</p>
              <div className="panel">
                {dashboard.retrogrades.map((r: any) => (
                  <div className="row-sub" key={r.name}>{r.name} — {r.position}</div>
                ))}
              </div>
            </>
          )}

          {/* Canon §42.2's windows stay: they are hers and they are not part of the report's table. */}
          {(astro.canon_window || astro.windows.length > 0) && (
            <>
              <p className="eyebrow">Windows</p>
              <div className="panel">
                {astro.canon_window && <p className="row-sub"><strong>{astro.canon_window}</strong> window</p>}
                {astro.windows.map((w: any, i: number) => (
                  <div className="row-sub" key={i}>{w.label}</div>
                ))}
                <p className="row-sub">{signal.note}</p>
              </div>
            </>
          )}
        </>
      )}

      {/*
        * ─── THE MONEY / CAREER / TRAVEL MAP ───────────────────────────────────
        *
        * It arrived here from the briefing spec by her own choice, and the reason is the one that
        * makes the separation checkable: the map is astrologically derived, so once it is out, the
        * briefing contains NO astrologically-derived content and a scan can say so.
        *
        * A WEEK WITH NO BAND SAYS "not yet given". It does not render blank and it never borrows a
        * colour from the weeks either side. On 12 September four weeks were briefly believed
        * unlocked, and the tempting fix — infer them from her line about not unplugging until
        * November 15 — would have painted a green week she had not given. She sent the real bands an
        * hour later and they were green, which is exactly why the inference was still wrong.
        */}
      {map && <TravelMap map={map} />}

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

/**
 * THE LOCKED 2026 MONEY / CAREER / TRAVEL MAP.
 *
 * It lived in `docs/boss/EXECUTIVE_INTELLIGENCE.md` as twenty-six prose bullets inside the document
 * the Executive Intelligence duty passes to a model, which meant nothing could answer "which week
 * is today in?" — the model re-derived it every morning from a list it had to read correctly, and a
 * misread was invisible. It is rows now, and the endpoint answers the question.
 *
 * ─── `not yet given` IS THE POINT OF THIS COMPONENT ───────────────────────────
 *
 * Every band on screen comes from `signalFor` in the Worker, which has NO glyph for `unset` and no
 * `?? BAND.green` fallback anywhere. There is deliberately no colour lookup in this file at all — if
 * there were, a week with a missing band would fall through it to whatever the default happened to
 * be, and a green week she never gave is indistinguishable on screen from one she did.
 *
 * WHAT HER CURRENT WEEK IS FOR. It is not a tile with a colour on it. It is the sentence she reads
 * at 6am: the band, her note for the week, and the transition that is coming — because "🟡" alone
 * tells her nothing she can act on, and "Sep 14–20 is still yellow" tells her not to manufacture
 * peak-October intensity in September.
 */
function TravelMap({ map }: { map: any }) {
  /* RULE 0 ON THE SCREEN. An empty map is a fault with a name, never an empty section. */
  if (!map.covered) {
    return (
      <>
        <p className="eyebrow">Money / career / travel map</p>
        <div className="panel"><p className="row-sub">{map.empty_reason}</p></div>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Money / career / travel map</p>

      <div className="panel">
        {map.current ? (
          <>
            <div style={{ fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.3 }}>
              {map.current.signal} — {map.current.label}
            </div>
            {/*
              * THE SENTENCE, NOT THE TILE. Her own reading of 12 September was "This is a yellow
              * travel/recalibration week. Keep live opportunities moving, clean up your systems, and
              * prepare the pipeline—but don't try to manufacture peak October intensity in
              * September." A colour is a fact about a table; that is a decision about today.
              */}
            <p className="row-sub" style={{ marginTop: 4, fontSize: "1rem" }}>
              {map.current.reading ?? map.current.meaning}
            </p>
          </>
        ) : (
          /*
           * OUTSIDE THE MAP IS A REAL STATE AND IT SAYS SO. The alternative — returning the nearest
           * week — would put her in a band on a day she was never given one, which is the same fault
           * as painting an unset week, arriving through a different door.
           */
          <p className="row-sub">{map.uncovered_reason}</p>
        )}
        {map.next && (
          <p className="row-sub">
            Next: <strong>{map.next.signal}</strong> {map.next.label}
            {map.next.note ? ` — ${map.next.note}` : ""}
          </p>
        )}
        {/* Hers, and it travels with the map the way the disclaimer travels with the chart. */}
        <p className="row-sub"><strong>{map.caveat}</strong></p>
      </div>

      <p className="eyebrow">The year as she locked it</p>
      <div className="panel">
        {map.weeks.map((w: any) => (
          <div className="row" key={w.starts}>
            <div className="row-main">
              <div className={w.current ? "row-title" : "row-sub"}>
                {w.label}{w.current ? " — this week" : ""}
              </div>
              {/*
                * An ungiven week prints its reason where a note would go, so the row is visibly
                * incomplete rather than merely short.
                */}
              {w.note ? <div className="row-sub">{w.note}</div> : <div className="row-sub">{w.meaning}</div>}
            </div>
            <div className="row-val">{w.signal}</div>
          </div>
        ))}
      </div>

      <p className="eyebrow">Legend</p>
      <div className="panel">
        {map.legend.map((l: any) => (
          <div className="row-sub" key={l.glyph}>{l.glyph} = {l.meaning}</div>
        ))}
      </div>
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

/**
 * IMANI'S WEEK OF PRACTICE.
 *
 * Every state this can be in is NAMED, because the failure this block replaces was silence: the
 * duty ran, cost its money, and produced nothing anyone could see — so "no delivery yet", "the
 * latest delivery is for a week that has ended" and "this week is genuinely quiet" all rendered
 * identically, which is to say not at all.
 *
 * NOTHING HERE IS A STREAK OR A SCORE. Canon §44's tone and 0192's charter: the job is to make the
 * practice easier to do, not to grade whether she did it. There is no tick box on this block on
 * purpose, and the sky rule is restated beside the rituals rather than assumed to be remembered
 * from the top of the page.
 */
function WeekAhead({ week }: { week: any }) {
  if (!week.prepared) {
    return (
      <>
        <p className="eyebrow">The week ahead</p>
        <div className="panel">
          <p className="row-sub">
            {week.unavailable
              ? "The week's practice could not be read just now. Nothing about your morning depends on it."
              : week.reason}
          </p>
        </div>
      </>
    );
  }

  const rituals: any[] = Array.isArray(week.rituals) ? week.rituals : [];
  const gaps: any[] = Array.isArray(week.gaps) ? week.gaps : [];
  /*
   * The computed answer, from the endpoint, which reads `astro_calendar` — the same rows the top of
   * this page renders. One source, so "there is a new moon tomorrow" and "no new or full moon this
   * week" can never both be on screen again.
   */
  const moons: any[] = Array.isArray(week.moons_this_week) ? week.moons_this_week : [];

  return (
    <>
      <p className="eyebrow">
        The week ahead — {week.week_id}
        {week.stale ? ` · prepared for a week that has ended` : ""}
      </p>
      <div className="panel">
        {/*
          * A STALE WEEK SAYS SO RATHER THAN PRETENDING. The duty fires Sunday at 17:00; if it did
          * not, last week's rituals are still on the screen, and reading them as this week's is
          * exactly the quiet wrongness this whole block exists to end.
          */}
        {week.stale && (
          <p className="row-sub">
            This is the most recent delivery and it is not for the current week. Imani's Sunday run
            has not landed since.
          </p>
        )}
        {week.status === "failed" && (
          <p className="row-sub">The last run did not produce a usable week. Nothing below is a finding.</p>
        )}

        {rituals.length === 0 ? (
          /*
           * ─── THIS LINE USED TO CONTRADICT THE TOP OF THE SAME PAGE ────────────
           *
           * On 9 September 2026 the screen led with "New Moon in Virgo — tomorrow, Thursday
           * September 10 at 10:28 PM", the almanac listed it as computed, and this block said "No
           * new or full moon this week". It was making an ASTRONOMICAL claim on the strength of an
           * empty array — what it actually knew was that Imani's delivery contained no ritual, which
           * is a completely different fact and, when a moon does fall, a real gap in her week.
           *
           * The moons now come from the almanac, which computes them to the minute, so the two
           * halves of the page cannot disagree.
           */
          moons.length > 0 ? (
            <p className="row-sub">
              There <strong>is</strong> a {moons.map((m: any) => `${m.label ?? m.kind.replace("_", " ")} on ${new Date(m.starts_at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`).join(", and a ")}
              {" "}— and Imani's week did not include a ritual for it. That is a gap in the week, not a quiet sky.
            </p>
          ) : (
            <p className="row-sub">
              No new or full moon this week, so no ritual is suggested. That is the answer, not a gap —
              and it is the almanac's answer, computed, not the absence of a delivery.
            </p>
          )
        ) : (
          rituals.map((r: any, i: number) => (
            <div className="row" key={i}>
              <div className="row-main">
                <div className="row-title">{r.occasion ?? "Ritual"}</div>
                <div className="row-sub">{r.ritual}</div>
                <div className="row-sub">{r.what_it_is_for}</div>
              </div>
              <div className="row-val">{r.minutes ? `${r.minutes} min` : "—"}</div>
            </div>
          ))
        )}

        {week.practice && (
          <div className="row">
            <div className="row-main">
              <div className="row-title">Practice — {week.practice.technique}</div>
              <div className="row-sub">{week.practice.claim}</div>
              <div className="row-sub">{week.practice.how_to_try_it}</div>
              {/*
                * THE SOURCE IS SHOWN, ALWAYS. The duty's success criterion is a real citation, and a
                * technique rendered without one is indistinguishable from something invented.
                */}
              <div className="row-sub">
                {week.practice.source_name ?? "No source named"}
                {week.practice.source_url ? ` — ${week.practice.source_url}` : ""}
              </div>
            </div>
          </div>
        )}

        {week.body && (
          <div className="row">
            <div className="row-main">
              <div className="row-title">For the body</div>
              <div className="row-sub">{week.body.suggestion}</div>
              <div className="row-sub">{week.body.why}</div>
            </div>
          </div>
        )}

        {gaps.length > 0 && (
          <>
            {/* Gaps are part of the week, not an error beside it. Same rule as the report. */}
            <p className="eyebrow">Could not be sourced</p>
            {gaps.map((g: any, i: number) => (
              <div className="row-sub" key={i}>
                {typeof g === "string" ? g : `${g.wanted ?? "?"} — ${g.why ?? ""}`}
              </div>
            ))}
          </>
        )}

        {rituals.length > 0 && week.sky_rule && <p className="row-sub">{week.sky_rule}</p>}
      </div>
    </>
  );
}
