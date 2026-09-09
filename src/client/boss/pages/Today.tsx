import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Coaching } from "./Coaching";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice, InfoNotice } from "../components/Notice";
import { usd } from "../../../shared/boss/types";

/**
 * Today — canon §15.
 *
 * Thirteen elements, in canon's order, and nothing else. Canon is explicit that
 * this must read like a Chief of Staff briefing rather than a dashboard, and
 * §5's Cognitive Load Budget says brief by default, expandable on demand — so
 * every block is one line until you open it, the two "when relevant" elements
 * stay closed when they are not, and the gates cap at three.
 */

type Block = {
  key: string;
  title: string;
  order: number;
  content: any;
  source_type: string;
  source_id: string | null;
  is_empty: boolean;
};

type Payload = {
  day: any;
  blocks: Block[];
  gates: { gate: string; completed_at: number }[];
  limits: { morning_priorities: number; midday_checks: number; night_review_prompts: number };
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function Today() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [gate, setGate] = useState<"morning" | "midday" | "night" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.today());
      setError(null);
    } catch (e) {
      setError(e);
      setData((prev) => prev);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <ErrorNotice error={error} /> : <Loading />;

  const { day, blocks, limits } = data;
  const done = {
    morning: Boolean(day?.morning_completed_at),
    midday: Boolean(day?.midday_completed_at),
    night: Boolean(day?.night_completed_at),
  };

  async function run(which: "morning" | "midday" | "night", body: unknown) {
    setError(null);
    try {
      if (which === "morning") await api.morningGate(body);
      else if (which === "midday") await api.middayGate(body);
      else await api.nightGate(body);
      setGate(null);
      setFlash(`${which[0]!.toUpperCase()}${which.slice(1)} gate recorded.`);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {flash && (
        <div className="notice" style={{ borderColor: "var(--ok)" }}>
          {flash}
          <button className="notice-x" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <p className="eyebrow">
        {new Date(day.date_ts).toLocaleDateString(undefined, {
          weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
        })}
      </p>

      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {(["morning", "midday", "night"] as const).map((g) => (
          <button
            key={g}
            className="stat"
            style={{ textAlign: "left", cursor: done[g] ? "default" : "pointer", font: "inherit", color: "inherit" }}
            onClick={() => !done[g] && setGate(gate === g ? null : g)}
            aria-pressed={gate === g}
            disabled={done[g]}
          >
            <div className="stat-n" style={{ fontSize: 15, color: done[g] ? "var(--ok)" : "var(--gold)" }}>
              {done[g] ? time(day[`${g}_completed_at`]) : "Open"}
            </div>
            <div className="stat-l">{g === "midday" ? "Midday reset" : `${g} gate`}</div>
          </button>
        ))}
      </div>

      {/*
        * MANDATORY MORNING COACHING, after the gate rather than instead of it.
        *
        * Her §15.6 puts it AFTER the Daily Anchor, Pillar Contracts and Run of Show are printed —
        * "before execution begins", not before the day is described. So it sits under the Morning
        * Gate form: she sees what the day is, then is asked how she is landing in it.
        */}
      {gate === "morning" && <MorningForm max={limits.morning_priorities} onRun={(b) => run("morning", b)} />}
      {gate === "morning" && <Coaching onModeSet={load} />}
      {gate === "midday" && <MiddayForm max={limits.midday_checks} onRun={(b) => run("midday", b)} />}
      {gate === "night" && (
        <NightForm max={limits.night_review_prompts} maxSeed={limits.morning_priorities} onRun={(b) => run("night", b)} />
      )}

      {blocks.map((b) => (
        <BlockCard key={b.key} block={b} onChanged={load} onError={setError} />
      ))}
    </>
  );
}

/**
 * The two "when relevant" elements disappear when they are not relevant, which
 * is what canon means by them. Everything else is always present, because an
 * element that vanishes when empty makes it impossible to tell "nothing today"
 * from "the screen forgot".
 */
function BlockCard({ block, onChanged, onError }: {
  block: Block;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const conditional = block.key === "continuity_status" || block.key === "trading_status";
  if (conditional && block.content?.relevant === false) return null;

  const summary = summarise(block);
  const detail = renderDetail(block, onChanged, onError);

  return (
    <div className="docket" style={{ paddingBottom: detail ? 14 : 12 }}>
      {/*
        * ── THE NUMBER IS GONE ────────────────────────────────────────────────
        *
        * She pasted what this card actually showed her: "medium / 07 / Spirit Signal / 08". Two of
        * those four lines were `block.order` — an index into a list she never asked to have ordered,
        * printed at her because it was convenient for the system. She is not the audience for it.
        */}
      <div className="docket-head">
        <h3 style={{ margin: 0 }}>{block.title}</h3>
      </div>
      {/*
        * AND A SECTION THAT SAYS NOTHING IS THE DEFECT. `summarise()` fell through to "" for any
        * block with no case, which is how Spirit Signal came to be a label between two numbers. It
        * has no empty return any more, and `tests/boss/everySectionSpeaks.test.ts` fails the build
        * if a block is ever added without one.
        */}
      <p style={{ marginTop: 6 }}>{summary}</p>
      {detail && (
        <details>
          <summary className="docket-more" style={{ cursor: "pointer" }}>Open</summary>
          <div className="docket-full">{detail}</div>
        </details>
      )}
    </div>
  );
}

function summarise(block: Block): string {
  const c = block.content ?? {};
  if (c.available === false) return c.reason;

  switch (block.key) {
    /*
     * PROPOSED AND AGREED READ DIFFERENTLY, and both are a day rather than a demand.
     *
     * "The Morning Gate has not run. Today has no contract yet." was the first line on this screen
     * every morning she had not pressed the button — an OS telling its owner it declines to say
     * what the day is until she asks it twice. The day is derived on read now; this line says the
     * day, and whether she has agreed to it.
     */
    case "todays_contract":
      if (!c.contract) return c.reason;
      return c.state === "proposed"
        ? `${c.contract.commitment} — proposed. ${c.contract.priorities.length} priorit${c.contract.priorities.length === 1 ? "y" : "ies"} derived from your projects.`
        : `${c.contract.priorities.length} priorit${c.contract.priorities.length === 1 ? "y" : "ies"} agreed${c.contract.commitment ? ` — ${c.contract.commitment}` : ""}.`;
    case "executive_briefing":
      // The report, or an honest account of why there is not one. "Nothing to report" was the old
      // block's line and it is now a lie in two directions: the world always has something, and a
      // missing report is a fact about this system rather than about the news.
      if (c.reason) return c.reason;
      /*
       * ONE LINE, AND IT IS THE ANSWER. Her instruction: "the way it is formmated now is for a
       * machine not for a human eyes." The collapsed block shows exactly this string, and it used
       * to be a five-sentence summary of stacked figures. `headline` is one line by contract; the
       * summary is the fallback for reports written before that column existed.
       *
       * THE GAP COUNT STAYS ON THE COLLAPSED LINE. It is the one caveat that must survive being
       * shortened — a briefing that reads well because it hid what it could not verify is worse
       * than the one it replaced.
       */
      const gapCount = (c.gaps ?? []).length;
      return [
        // Yesterday's briefing shown in place of one that has not arrived says so FIRST. A stale
        // report presented as current is worse than no report; a stale report that admits it is
        // better than a blank.
        c.carried_over ? `Yesterday (${c.for_day}) ·` : null,
        c.headline ?? c.summary ?? "Report delivered.",
        gapCount > 0 ? `· ${gapCount} unverified.` : null,
      ].filter(Boolean).join(" ");
    case "day_flow":
      // Her blocks, and the word is "blocks" because that is what her contract calls them. "Stages"
      // was the machine's vocabulary for the machine's list.
      return `${c.complete} of ${c.total} blocks done.`;
    case "coaching_focus":
      return `${c.mode}. Law ${c.law?.n}: ${c.law?.title}.`;
    case "daily_thinking_lens":
      return `${c.track}.`;
    case "meetings": {
      /*
       * THE COLLAPSED LINE COMES FROM THE SERVER, COMPUTED FROM THE ROWS THE BODY RENDERS.
       *
       * It used to count `c.total` — the CRM meetings table, always empty — and say "Nothing in the
       * diary" over a section that opened onto a full agenda. A summary derived from a different
       * source than the body will eventually contradict it, and this one did. `diary_summary` is
       * built in `today/diary.ts` from the same array, so they cannot disagree.
       */
      const parts: string[] = [c.diary_summary ?? "The diary could not be read."];
      if (c.held_not_captured?.length) {
        parts.push(`${c.held_not_captured.length} held and not captured.`);
      }
      if (c.follow_ups_overdue) {
        parts.push(`${c.follow_ups_overdue} follow-up${c.follow_ups_overdue === 1 ? "" : "s"} overdue.`);
      }
      return parts.join(" ");
    }
    case "open_loops":
      return c.total === 0
        ? "Nothing is hanging."
        : `${c.total} open${c.carried_forward ? `, ${c.carried_forward} carried from earlier days` : ""}.`;
    case "critical_alerts":
      return c.alerts?.length ? `${c.alerts.length} thing${c.alerts.length === 1 ? "" : "s"} wrong.` : "Nothing is wrong.";
    case "approval_inbox":
      return c.pending === 0
        ? "Nothing is waiting on you."
        : `${c.pending} waiting${c.by_risk?.high ? `, ${c.by_risk.high} high risk` : ""}${c.expiring_within_a_day ? `, ${c.expiring_within_a_day} expiring within a day` : ""}.`;
    case "employee_status":
      return `${c.by_status?.active ?? 0} active, ${c.by_status?.paused ?? 0} paused, ${c.by_status?.retired ?? 0} retired.`;
    case "continuity_status":
      return c.note;
    case "trading_status":
      return c.kill_switch
        ? "Kill switch engaged. Nothing in that lane executes."
        : `${c.open_positions} open position${c.open_positions === 1 ? "" : "s"}${c.open_incidents?.length ? `, ${c.open_incidents.length} open incident${c.open_incidents.length === 1 ? "" : "s"}` : ""}.`;

    /*
     * ── SPIRIT SIGNAL, AS A SENTENCE RATHER THAN A LABEL ─────────────────────
     *
     * She pasted the whole of what this card showed her:
     *
     *     medium
     *     07
     *     Spirit Signal
     *     08
     *
     * and said "this is not helpful and needs to be explicit in that area". She was right about all
     * of it. There was no `case` here, so `summarise` returned "" and the card rendered a category
     * name between two list indices — a label, not a statement, with nothing saying what it is or
     * what she should do with it.
     *
     * THE MATERIAL EXISTED THE WHOLE TIME. `spirit/day.ts` composes `note` from the computed sky and
     * her real records and hands back `reality_priority` — canon §5.2's rule that a day where
     * something is actually broken says so FIRST and the sky is context. None of it reached this
     * surface.
     *
     * So: what it is, then what it means for today, then the classification last.
     */
    case "spirit_signal": {
      const moon = c.moon
        ? `${c.moon.phase?.replace(/_/g, " ") ?? "moon"}${c.moon.sign ? ` in ${c.moon.sign}` : ""}${c.moon.cusp ? `, on the cusp of ${c.moon.next_sign}` : ""}`
        : null;
      /*
       * THE EVENT LEADS THE COLLAPSED LINE. "New Moon in Virgo — tomorrow" is the sentence she wants
       * to see first on a day when one is coming; the phase and the windows are context under it.
       */
      const major = c.major_event ?? null;
      const majorWhen = major
        ? (() => {
            const days = Math.round((major.at - Date.now()) / 86_400_000);
            const time = new Date(major.at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
            return days <= 0 ? `today at ${time}` : days === 1 ? `tomorrow at ${time}` : `in ${days} days`;
          })()
        : null;
      const parts: string[] = [];
      /*
       * REALITY FIRST, WHICH IS CANON RATHER THAN A PREFERENCE. §5.2: if something is actually
       * broken today, that leads and the sky is context underneath it.
       *
       * ── AND IT PRINTED `[object Object]` ON HER DAILY SCREEN ────────────────
       *
       * `reality_priority` is `{ warning, text, counts, rule }` — it has been an OBJECT since
       * `spirit/day.ts` was written — and this pushed the whole thing into an array of strings.
       * The card read "[object Object] Advisory only. The sky is context, never a cause…" every
       * morning. It is the second defect in this one block in a day; the first fix gave it a
       * sentence and reached straight past the shape of the value it was reading.
       *
       * NOTHING TYPED CAUGHT IT because `c` is `any` here, which is why the sentence is now built
       * from a named field with an explicit string check rather than from whatever arrives. A value
       * that is not a string is a NAMED absence, never a stringified one: printing a JavaScript
       * artifact at her tells her nobody looks at this screen, which is worse than printing nothing.
       *
       * AND IT LEADS ONLY WHEN IT IS A WARNING. `text` is also written for the calm case ("Nothing
       * operational is waiting"), and leading every quiet day with that is a sentence she learns to
       * skip — which is how the real one stops being read on the day it matters.
       */
      /*
       * AND THE OPERATIONAL SCOLD IS GONE FROM HERE TOO. Her instruction was about the Spirit tab,
       * and this block is the same content on Today — leaving it in one place and not the other is
       * how two components come to disagree. The failed-task count it carried is already a Critical
       * Alert on this very screen, checked rather than assumed, so nothing is lost by removing it.
       *
       * The line above it read `parts.push(c.reality_priority)` on an OBJECT and printed
       * "[object Object]" on her daily screen every morning. Both defects leave together.
       */
      if (major) parts.push(`${major.label} — ${majorWhen}.`);
      if (c.note) parts.push(c.note);
      else if (moon) parts.push(`The sky today: ${moon}.`);
      if (c.windows?.length) {
        parts.push(`${c.windows.length} window${c.windows.length === 1 ? "" : "s"} open — timing worth using rather than fighting.`);
      }
      if (c.rituals_due?.length) parts.push(`${c.rituals_due.length} ritual${c.rituals_due.length === 1 ? "" : "s"} due.`);
      /*
       * ADVISORY, SAID OUT LOUD. The block has carried `advisory: true` since it was built and
       * never showed it. It is context for a decision she makes, never an instruction, and a
       * screen that does not say so invites the opposite reading.
       */
      parts.push("Context for the day, never an instruction. Ignoring it costs nothing and nothing is scored on it.");
      return parts.join(" ");
    }

    /*
     * NO EMPTY DEFAULT. Returning "" is what produced a section that said nothing at all, and a
     * block added later would inherit the same silence. A named absence is the floor.
     */
    default:
      return `${block.title} has no summary written for it yet, which is a gap in this screen rather than a quiet day.`;
  }
}

/**
 * `**like this**` becomes bold, and nothing else is interpreted.
 *
 * The briefing prompt asks every bullet to bold its key phrase, because she scans and the bold is
 * what she scans for. Rendering the asterisks literally would put punctuation noise in the one
 * place the formatting was supposed to help.
 *
 * DELIBERATELY NOT A MARKDOWN PARSER. This text comes from a research run that reads the open web,
 * so it is untrusted by construction. Splitting on a delimiter and emitting <strong> around
 * alternate pieces cannot produce markup of any kind — a full renderer would be the place an
 * injected link or image got in.
 */
function bold(text: string) {
  const parts = String(text).split(/\*\*/);
  return parts.map((piece, i) => (i % 2 === 1 ? <strong key={i}>{piece}</strong> : <span key={i}>{piece}</span>));
}

/**
 * One briefing section: the heading, what it means for her, then the evidence.
 *
 * BOTH SHAPES RENDER. `{heading, so_what, bullets}` is 0205's contract; `{heading, body}` is what
 * every report written before it carries. A format change that made historical days render empty
 * would look exactly like a regression on the screen it was meant to fix.
 */
function renderSection(sec: any, i: number) {
  return (
    <div key={i} style={{ marginBottom: 12 }}>
      <p className="eyebrow" style={{ marginBottom: 4 }}>{sec.heading ?? `Section ${i + 1}`}</p>
      {/* What she should DO or watch because of it, before the evidence for it. */}
      {sec.so_what && <div className="row-title" style={{ marginBottom: 4 }}>{sec.so_what}</div>}
      {Array.isArray(sec.bullets) && sec.bullets.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {sec.bullets.map((b: string, j: number) => (
            <li key={j} style={{ marginBottom: 3, lineHeight: 1.45 }}>{bold(b)}</li>
          ))}
        </ul>
      ) : (
        sec.body && <div className="row-sub" style={{ lineHeight: 1.5 }}>{bold(String(sec.body))}</div>
      )}
    </div>
  );
}

function renderDetail(
  block: Block,
  onChanged: () => void | Promise<void>,
  onError: (e: unknown) => void,
) {
  const c = block.content ?? {};
  if (c.available === false) return null;

  switch (block.key) {
    /*
     * THE MORNING AGENDA, WHICH IS NOW ON THE SCREEN BEFORE SHE TOUCHES ANYTHING.
     *
     * Her words: "i should get a morning agenda each day without doing anything what the fuck?!"
     * The four Pillar Contracts were being derived the whole time and only inside the gate handler,
     * so they existed and nothing showed them. Each one names WHAT it means in her language and
     * WHO owns it, because a pillar whose name needs a canon section to decode is one she skips.
     */
    case "todays_contract": {
      /*
       * ── THE HEADER, WHICH ANSWERS THE FOUR THINGS SHE HAD TO ASK ────────────
       *
       * Rendered even when the contract itself failed to derive, because a screen with no date
       * cannot tell her whether she is looking at today, a stale render, or yesterday — and "what
       * happens to yesterday, it just disappears?" needs an answer on a broken morning most of all.
       */
      const header = <ContractHeader content={c} />;
      if (!c.contract) return header;
      const pillars = c.agenda?.pillars ?? null;
      /*
       * ─── THE AGENDA, DIVIDED BY PILLAR ─────────────────────────────────────
       *
       * Her specification, verbatim, 8 September 2026: "'today's contract' is supposed to be my
       * fucking agenda for the day divided by pillar and with my gratitude sentence mirrored there
       * and with my morning movement (either the actual movements or a link to them)".
       *
       * All three of those existed and none of them was on this screen.
       *
       *   · The four Pillar Contracts were derived inside the Morning Gate handler and nowhere else.
       *   · `spirit.action` IS the gratitude sentence, composed from her own record by
       *     `spirit/practice.ts`, and this block rendered it as an unlabelled row title.
       *   · `body.launch_sequence` is §6.9's stored morning sequence — five NAMED movements,
       *     "print this exactly, in order" — and `body.somatic` is five more, one per lane, each
       *     chosen as the least recently used and each carrying why. Twenty lines of real content
       *     that had never been on any screen.
       *
       * NOTHING HERE IS INVENTED. Every movement below is one she wrote down; the system chooses
       * which somatic one comes up today from `movement_log`, deterministically, and says why.
       */
      const gratitudeMissing = pillars?.spirit && pillars.spirit.available === false;
      return (
        <>
          {header}
          {c.agenda?.warning && <div className="notice" style={{ borderColor: "var(--gold)" }}>{c.agenda.warning}</div>}

          {/*
            * BODY — keto, movement, discipline. Imani.
            * The movements themselves, because "morning movement" as a label with nothing under it
            * is the exact failure she is describing everywhere else in this system.
            */}
          {pillars?.body && (
            <>
              <p className="pillar">Body — movement, food, discipline <span className="pillar-who">Imani</span></p>
              <div className="row-sub" style={{ marginBottom: 6 }}>{pillars.body.movement_floor}</div>
              <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {(pillars.body.launch_sequence ?? []).map((m: string, i: number) => (
                  <li key={i} style={{ marginBottom: 2 }}>{m}</li>
                ))}
              </ol>
              {(pillars.body.somatic ?? []).length > 0 && (
                <>
                  <div className="row-sub" style={{ marginBottom: 4 }}>Then today's somatic rotation, one per lane:</div>
                  {pillars.body.somatic.map((sm: any) => (
                    <div className="row" key={sm.lane}>
                      <div className="row-main">
                        <div className="row-title">{sm.movement}</div>
                        <div className="row-sub">{sm.title} · {sm.because}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                <li className="row-sub"><strong>Water and medicine</strong> — {pillars.body.medication}</li>
                <li className="row-sub"><strong>Hydration</strong> — {pillars.body.hydration}</li>
                <li className="row-sub"><strong>Food</strong> — {pillars.body.food_rule}</li>
              </ul>
              <div className="row-sub" style={{ marginTop: 6 }}>{pillars.body.safety_stop}</div>
            </>
          )}

          {/*
            * SPIRIT — the sentence, MIRRORED here rather than moved. Spirit remains its home and
            * its source of truth; she should not have to navigate to read her own sentence.
            */}
          {pillars?.spirit && (
            <>
              <p className="pillar">Spirit — the sentence and the sequence <span className="pillar-who">Imani</span></p>
              {gratitudeMissing ? (
                <div className="row-sub">
                  {pillars.spirit.gap ?? "Today's sentence could not be composed from your record."}
                  {" "}It is written on Spirit — a generic mantra is worse than none, so nothing is filled in for you.
                </div>
              ) : (
                /*
                 * THE SENTENCE, AT THE WEIGHT OF A SENTENCE. It was 17px inline and read as another
                 * paragraph; it is the one line of her day that is not an instruction.
                 */
                <p className="sentence">{pillars.spirit.action}</p>
              )}
              <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {(pillars.spirit.detail ?? []).map((step: string, i: number) => (
                  <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{step}</li>
                ))}
              </ol>
            </>
          )}

          {/* WEALTH — money in: buyers, LPs, and the people who send you both. Camille and Monique. */}
          {pillars?.wealth && (
            <>
              <p className="pillar">Wealth — the first money move <span className="pillar-who">Camille and Monique</span></p>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">{pillars.wealth.action}</div>
                  <div className="row-sub">{pillars.wealth.why}</div>
                  {pillars.wealth.gap && <div className="row-sub">Missing: {pillars.wealth.gap}</div>}
                </div>
              </div>
              {(pillars.wealth.detail ?? []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {pillars.wealth.detail.map((d: string, i: number) => (
                    <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* EXECUTION — did anything you own actually get built or shipped. Danielle. */}
          {pillars?.execution && (
            <>
              <p className="pillar">Execution — did anything you own ship <span className="pillar-who">Danielle</span></p>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">{pillars.execution.action}</div>
                  <div className="row-sub">{pillars.execution.why}</div>
                  {pillars.execution.gap && <div className="row-sub">Missing: {pillars.execution.gap}</div>}
                </div>
              </div>
              {(pillars.execution.detail ?? []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {pillars.execution.detail.map((d: string, i: number) => (
                    <li key={i} className="row-sub" style={{ marginBottom: 2 }}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* The agreed contract has no derived pillars beside it — her answer, not a second one. */}
          {!pillars && (
            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {c.contract.priorities.map((p: string, i: number) => <li key={i}>{p}</li>)}
            </ol>
          )}

          {c.note && <div className="row-sub" style={{ marginTop: 12 }}>{c.note}</div>}
        </>
      );
    }

    case "executive_briefing": {
      // No report is not an error state, so it renders as prose rather than a notice.
      if (!c.sections && !c.summary) return null;
      /*
       * ─── THE BRIEFING, FOR HER EYES ────────────────────────────────────────
       *
       * "the way it is formmated now is for a machine not for a human eyes. it needs to be
       * synthesized and summarized and formatted properly."
       *
       * It was rendering storage order: heading, paragraph, heading, paragraph, then a list of URLs
       * with ISO timestamps at the same visual weight as the content. THE ORDER IS THE ANSWER, THEN
       * WHAT IT MEANS, THEN THE EVIDENCE, and provenance goes behind a toggle.
       *
       * WHAT IS NOT COMPRESSED AWAY: gaps and corrections stay on the screen at full weight.
       * "I could not verify this" and "yesterday I told you the opposite" are decision-bearing, and
       * a briefing that reads beautifully because it dropped its caveats is worse than the one it
       * replaced. Only `sources` collapse — a URL list is what she reaches for when she doubts a
       * figure, not something she reads at 7am.
       *
       * BOTH SHAPES RENDER. Reports written before 0205 carry `{heading, body}` sections and no
       * headline; reports after it carry `{heading, so_what, bullets}`. A format change that made
       * every historical day render as empty would look exactly like a regression.
       */
      return (
        <>
          {c.staleness && <div className="row-sub" style={{ marginBottom: 10 }}>{c.staleness}</div>}

          {c.headline && (
            <p style={{ margin: "0 0 8px", fontFamily: "var(--display)", fontSize: 19, lineHeight: 1.35 }}>
              {c.headline}
            </p>
          )}
          {c.summary && c.summary !== c.headline && (
            <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{c.summary}</p>
          )}

          {/*
            * FOUR SECTIONS, AND THE REST BEHIND A TOGGLE.
            *
            * The prompt asks for four at most. A real run on 8 September, with the new prompt, filed
            * FOURTEEN — down from twenty, so the instruction moved it and did not govern it. There
            * are 28KB of specification sitting in the run's own working directory describing a
            * twenty-section newspaper, and a model splitting the difference between two documents is
            * what that produces.
            *
            * TRUNCATING ON THE WRITE SIDE WOULD DESTROY RESEARCH SHE PAID FOR, so the cap is applied
            * HERE instead: the top four are the briefing, everything else stays one click away and
            * says how much there is. She gets the short read; nothing is lost; and the count on the
            * toggle is also the honest measure of how far the run overshot.
            */}
          {(c.sections ?? []).slice(0, 4).map((sec: any, i: number) => renderSection(sec, i))}
          {(c.sections ?? []).length > 4 && (
            <details style={{ marginBottom: 12 }}>
              <summary className="docket-more" style={{ cursor: "pointer" }}>
                {(c.sections ?? []).length - 4} more section{(c.sections ?? []).length - 4 === 1 ? "" : "s"} the run filed
              </summary>
              <div style={{ marginTop: 8 }}>
                {(c.sections ?? []).slice(4).map((sec: any, i: number) => renderSection(sec, i + 4))}
              </div>
            </details>
          )}

          {(c.corrections ?? []).length > 0 && (
            <>
              {/*
                * CORRECTIONS ARE CONTENT, NOT APPARATUS. "Yesterday I told you the opposite" is the
                * single most decision-bearing thing a briefing can say — the 7 September run used it
                * to correct a standing assumption that a company was still private.
                */}
              <p className="eyebrow" style={{ marginTop: 4 }}>Corrects an earlier report</p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {c.corrections.map((g: any, i: number) => (
                  <li key={i} style={{ marginBottom: 3, lineHeight: 1.45 }}>
                    {typeof g === "string" ? g : `${g.was ?? ""} → ${g.now ?? ""}${g.why ? ` (${g.why})` : ""}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(c.gaps ?? []).length > 0 && (
            <>
              <p className="eyebrow">Could not be verified — {(c.gaps ?? []).length}</p>
              <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {c.gaps.map((g: any, i: number) => (
                  <li key={i} className="row-sub" style={{ marginBottom: 2 }}>
                    {typeof g === "string" ? g : `${g.wanted ?? g.what ?? JSON.stringify(g)}${g.why ? ` — ${g.why}` : ""}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Provenance, reachable and out of the way. */}
          {(c.sources ?? []).length > 0 && (
            <details>
              <summary className="docket-more" style={{ cursor: "pointer" }}>
                {c.sources.length} source{c.sources.length === 1 ? "" : "s"}, with when each was read
              </summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {c.sources.map((src: any, i: number) => (
                  <li key={i} className="row-sub" style={{ marginBottom: 2 }}>
                    {typeof src === "string" ? src : `${src.name ?? src.url ?? "unnamed"}${src.read_at ? ` · read ${src.read_at}` : ""}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      );
    }

    /*
     * THE RUN OF SHOW.
     *
     * A block a gate closed is shown as closed and is NOT tappable — re-ticking something the
     * Morning Gate already recorded would let her produce two different stories about the same
     * morning. The three blocks no gate can speak for are hers, and they are the ones that respond
     * to a tap.
     */
    case "day_flow": {
      /*
       * The toggle calls the API here rather than being threaded down as a prop, which is how the
       * other interactive blocks on this screen already work — `onChanged` re-reads Today, so the
       * count in the summary line and the block state can never disagree.
       */
      const toggle = async (key: string, done: boolean) => {
        try {
          await api.runOfShowBlock(key, { done });
          await onChanged();
        } catch (e) { onError(e); }
      };
      return (
        <>
          {(c.blocks ?? []).map((b: any) => {
            const mine = b.closedBy === null;
            return (
              <div
                className={mine ? "row row-tap" : "row"}
                key={b.key}
                role={mine ? "button" : undefined}
                tabIndex={mine ? 0 : undefined}
                aria-pressed={mine ? b.done : undefined}
                onClick={mine ? () => void toggle(b.key, !b.done) : undefined}
                onKeyDown={mine ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggle(b.key, !b.done); } } : undefined}
              >
                <div className="row-main">
                  <div className="row-title">{b.done ? "✓" : "○"} {b.title}</div>
                  <div className="row-sub">{b.instruction ?? b.intent}</div>
                </div>
                <div className="row-val">
                  {b.done ? time(b.done_at) : mine ? "tap" : "—"}
                </div>
              </div>
            );
          })}
          {(c.midday_checks ?? []).map((chk: any, i: number) => (
            <div className="row-sub" key={i}>{chk.done ? "✓" : "○"} {chk.text}</div>
          ))}
          {/* §15.5's conflict rule, on the screen rather than only in the schema. */}
          <p className="row-sub">{c.conflict_rule}</p>
        </>
      );
    }

    /*
     * BLOCKS 08 AND 09. Both spent the whole port rendering "awaiting substrate"; both now say what
     * they chose AND why, because a focus that cannot name its evidence is a horoscope.
     */
    case "coaching_focus":
      return (
        <>
          <div className="row">
            <div className="row-main">
              <div className="row-title">{c.mode}</div>
              <div className="row-sub">{c.because}</div>
            </div>
          </div>
          {(c.rules ?? []).map((r: string, i: number) => (
            <div className="row-sub" key={i}>{r}</div>
          ))}
          <p className="eyebrow">Law {c.law?.n} — {c.law?.title}</p>
          <p className="row-sub">{c.law?.text}</p>
          <p className="row-sub">{c.law?.because}</p>
        </>
      );

    case "daily_thinking_lens":
      return (
        <>
          <div className="row">
            <div className="row-main">
              <div className="row-title">{c.track}</div>
              <div className="row-sub">{c.purpose}</div>
            </div>
          </div>
          {(c.prompts ?? []).map((q: string, i: number) => (
            <div className="row-sub" key={i}>{q}</div>
          ))}
          <p className="row-sub">{c.note}</p>
        </>
      );

    case "meetings":
      /*
       * ── A DIARY, NOT A PACKET READER ──────────────────────────────────────
       *
       * "this meetings tab needs work. it says Nothing in the diary when the meeting tab is closed
       * then u open to all this stuff. this stuff is unnecessary. this tab is suppose to show what
       * meetings i have upcoming."
       *
       * Two defects and the first is the one this repository keeps producing. The collapsed line
       * counted `c.meetings` — the CRM table, always empty — while the body rendered the whole
       * Wednesday packet, so the section said "Nothing in the diary" and opened onto a full agenda.
       * Both sentences were true about the thing each was looking at. Together they were a lie.
       *
       * The packet is not rendered here at all now. It lives at one permanent URL and the row that
       * has one carries the link: "if there is a packet or deliverable for a meeting i should see
       * that in a link". The CRM meetings, the held-and-uncaptured ones and the overdue touches
       * still render below, because they are also things she has coming up and a second screen for
       * them would be the two-lists defect.
       */
      return (
        <>
          {c.intent && <div className="row-sub"><em>{c.intent}</em></div>}
          <Diary content={c} onChanged={onChanged} onError={onError} />
          {(c.held_not_captured ?? []).map((m: any) => (
            <div className="row" key={m.id}>
              <div className="row-main">
                <div className="row-title">{m.title}</div>
                <div className="row-sub">{m.full_name} · held {new Date(m.scheduled_at).toLocaleDateString()} and never captured</div>
              </div>
              <div className="risk risk-medium">capture</div>
            </div>
          ))}
          {(c.touches_due ?? []).map((t: any) => (
            <div className="row-sub" key={t.id}>
              {t.full_name} is past their {t.cadence_days}-day cadence.
            </div>
          ))}
        </>
      );

    case "open_loops":
      return <Loops loops={c.loops ?? []} onChanged={onChanged} onError={onError} />;

    case "critical_alerts":
      return <Alerts content={c} onChanged={onChanged} onError={onError} />;

    case "approval_inbox":
      return c.oldest ? (
        <div className="row">
          <div className="row-main">
            <div className="row-title">{c.oldest.title}</div>
            <div className="row-sub">Oldest, waiting since {time(c.oldest.requested_at)}</div>
          </div>
          <div className={`risk risk-${c.oldest.risk}`}>{c.oldest.risk}</div>
        </div>
      ) : null;

    case "employee_status":
      return (c.busiest ?? []).length ? (
        <>
          {c.busiest.map((e: any) => (
            <div className="row" key={e.id}>
              <div className="row-main">
                <div className="row-title">{e.name}</div>
                <div className="row-sub">{e.role} · {e.lane}</div>
              </div>
              <div className="row-val">{e.open_tasks} open</div>
            </div>
          ))}
        </>
      ) : null;

    case "continuity_status":
      return c.last_snapshot ? (
        <dl className="kv">
          <dt>Last snapshot</dt><dd>{new Date(c.last_snapshot.ts).toLocaleString()}</dd>
          <dt>Status</dt><dd>{c.last_snapshot.status}</dd>
          <dt>Promotions waiting</dt><dd>{c.proposed_promotions_awaiting_decision}</dd>
        </dl>
      ) : null;

    case "trading_status":
      return (
        <>
          <dl className="kv">
            <dt>Kill switch</dt><dd>{c.kill_switch ? "engaged" : "clear"}</dd>
            <dt>Live execution</dt><dd>{c.live_enabled ? "enabled" : "denied"}</dd>
            <dt>Open positions</dt><dd>{c.open_positions}</dd>
          </dl>
          {(c.open_incidents ?? []).map((i: any) => (
            <div className="row-sub" key={i.id}>{i.severity}: {i.summary}</div>
          ))}
        </>
      );

    default:
      return null;
  }
}

/**
 * THE DATE, THE GATES, AND WHAT HAPPENED YESTERDAY.
 *
 * Her three questions, which were all defects in this screen:
 *
 *   "the 'today's contract' needs the date there and what happens to yesterday it just disappears?"
 *   "if nothing is clicked does it track which days were skipped?"
 *   "AND ARE U FIXING THE FACT THAT I HAD TO ASK WHAT MORNING MID DAY AND EVENING GATES WERE?"
 *
 * Every answer was already written down in the source, where only a developer would ever read it.
 * The test this component is held to: could she work out what this is for, and what happens if she
 * ignores it, without asking anyone? A one-line intent under a heading is usually enough — it does
 * not need a help system.
 *
 * THE unknown / missed DISTINCTION IS SHOWN RATHER THAN TRUSTED. It is the most careful decision in
 * the system — a night she was too tired to close the gate is not a day she skipped the work — and
 * it is the thing that makes the streak worth believing, so it belongs on the screen.
 */
function ContractHeader({ content }: { content: any }) {
  const y = content.yesterday;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="row">
        <div className="row-main">
          <div className="row-title">{content.day_label ?? content.day_id}</div>
          <div className="row-sub">
            {content.state === "agreed"
              ? "Agreed at the Morning Gate. This is what you signed up to."
              : content.state === "proposed"
                ? "Proposed, not agreed. Run the Morning Gate to agree to it or override it."
                : "Today's agenda could not be derived — that is a fault, not an empty day."}
          </div>
        </div>
        {/*
          * `2026-09-09` USED TO SIT HERE, beside "Wednesday 9 September". The same fact twice, once
          * in a format written for a database key. It told her nothing the line to its left had not
          * already said, and it made the header look like a record rather than a day.
          */}
      </div>

      {y && (
        <div className="row">
          <div className="row-main">
            {/* Human first here too: "Yesterday · 2026-09-08" is a key, not a day. */}
            <div className="row-title">
              Yesterday · {new Date(`${y.day_id}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div className="row-sub">{y.verdict}</div>
            <div className="row-sub">
              Gates run: {y.gates_run?.length ? y.gates_run.join(", ") : "none"}
            </div>
          </div>
          <div className={`risk risk-${y.anchor_outcome === "missed" ? "high" : y.anchor_outcome === "done" ? "low" : "medium"}`}>
            {y.anchor_outcome}
          </div>
        </div>
      )}

      {content.gates?.length ? (
        <>
          <button className="docket-open" onClick={() => setOpen((v) => !v)}>
            <span className="docket-more">{open ? "Hide what the gates are" : "What are the gates? →"}</span>
          </button>
          {open && (
            <>
              <div className="row-sub">{content.gates_note}</div>
              {content.gates.map((g: any) => (
                <div className="row" key={g.name}>
                  <div className="row-main">
                    <div className="row-title">{g.name}</div>
                    <div className="row-sub">Closes: {g.closes}</div>
                    <div className="row-sub">{g.what}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      ) : null}
    </>
  );
}

/**
 * WHAT SHE CAN DO WITH AN ALERT — which until today was read it.
 *
 *   "i also need to be able to refresh critical alerts and / or dismiss / mark resolved? i dont know
 *    u need to figure it out and add it"
 *
 * ─── Three verbs, and each is built against its own failure mode ───────────
 *
 * REFRESH re-runs the checks rather than re-fetching the answer. Today is computed on read, so a
 * reload would say exactly what it said a minute ago; what makes an answer current is something
 * going and looking.
 *
 * RESOLVED RE-VERIFIES AND CAN DISAGREE WITH HER. `TERMINAL_CHECKS` refuses an employee, a run and a
 * job that claim work is done, and a person asserting it is the same claim in different clothes — if
 * she closes the West Peek grant and Scooter has not granted it, the system believes a false thing
 * and stops telling her. So the verdict comes back and is shown verbatim, including when it says no.
 *
 * DISMISS IS A SNOOZE WITH A REASON. It expires, it breaks if the alert gets louder, and the reason
 * is required — so next week it can say why she put it aside instead of arriving as if it were new.
 */
function Alerts({ content, onChanged, onError }: {
  content: any;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const alerts: any[] = content.alerts ?? [];
  const keys: string[] = content.keys ?? [];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { onError(e); } finally { setBusy(false); }
  };

  if (alerts.length === 0 && (content.dismissed ?? []).length === 0) return null;

  return (
    <>
      {content.intent && <div className="row-sub"><em>{content.intent}</em></div>}
      {verdict && <div className="notice" style={{ borderColor: "var(--gold)" }}>{verdict}</div>}

      {alerts.map((a: any, i: number) => (
        <div className="row" key={keys[i] ?? i}>
          <div className="row-main">
            <div className="row-title">{a.text}</div>
            {dismissing === i ? (
              <div className="judgement-note">
                <label className="stat-l" htmlFor={`why-dismiss-${i}`}>
                  Why are you putting this aside? It comes back in a week, or sooner if it gets worse.
                </label>
                <textarea
                  id={`why-dismiss-${i}`}
                  className="judgement-why"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="decide">
                  <button
                    className="btn btn-reject"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => run(async () => {
                      await api.dismissAlert({ key: keys[i], text: a.text, severity: a.severity, reason: reason.trim() });
                      setReason(""); setDismissing(null); onChanged();
                    })}
                  >
                    Put it aside
                  </button>
                  <button className="btn btn-defer" disabled={busy} onClick={() => setDismissing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="decide">
                {/* Only an owned deliverable can be verified, so only those offer it. */}
                {a.source_type === "tasks" && a.source_id?.startsWith("del_") && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => run(async () => {
                      const r = await api.resolveAlert(a.source_id);
                      setVerdict(r.verdict);
                      if (r.closed) onChanged();
                    })}
                  >
                    Mark resolved
                  </button>
                )}
                <button className="btn btn-defer" disabled={busy} onClick={() => { setDismissing(i); setReason(""); }}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <div className={`risk risk-${a.severity === "critical" || a.severity === "high" ? "high" : "medium"}`}>
            {a.severity}
          </div>
        </div>
      ))}

      <div className="decide">
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(async () => {
            const r = await api.refreshAlerts();
            const closed = (r.rechecked ?? []).filter((x: any) => x.met);
            setVerdict(
              `${(r.rechecked ?? []).length} check(s) re-run. ` +
              (closed.length ? `${closed.length} finished and closed. ` : "Nothing has become true since. ") +
              r.credentials_note,
            );
            onChanged();
          })}
        >
          {busy ? "Re-running the checks…" : "Refresh — re-run the checks"}
        </button>
      </div>

      {/* Dismissed is not hidden. The count is here and the reasons with it. */}
      {(content.dismissed ?? []).length > 0 && (
        <>
          <div className="row-sub">
            <strong>{content.dismissed.length} put aside.</strong> They come back on their own, and sooner if they get worse.
          </div>
          {content.dismissed.map((d: any) => (
            <div className="row-sub" key={d.key}>
              {d.text} — you said: {d.reason} (back on {new Date(d.until).toISOString().slice(0, 10)})
            </div>
          ))}
        </>
      )}
    </>
  );
}

/**
 * THE DIARY. What she has coming up, and a link where a packet exists.
 *
 * ─── Her correction, with a screenshot ─────────────────────────────────────
 *
 *   "this tab is suppose to show what meetings i have upcoming. i should be able to input what
 *    meetings i have and it should check my calendars for meetings and if there is a packet or
 *    deliverable for a meeting i should see that in a link"
 *
 * FOUR THINGS ON A ROW AND NO MORE: what it is, when, who with, and the link if there is one. The
 * packet used to be expanded in place — "Your week", the grant steps, the entire document — into a
 * section she opens to see what is on today.
 *
 * ─── A diary you cannot write in is not a diary ────────────────────────────
 *
 * The form is the PRIMARY route rather than a fallback while calendar sync is built, and that is a
 * fact about Google rather than a staging decision: a service account can never read a personal
 * @gmail.com calendar, so some of her meetings will always be ones she typed.
 *
 * ─── And it says which calendars are actually in here ──────────────────────
 *
 * A partial calendar presented as complete is worse than manual entry, because she would trust it
 * and stop typing the ones it cannot see. So the connected feeds are named, and so are the ones
 * that are not.
 */
function Diary({ content, onChanged, onError }: {
  content: any;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [withWho, setWithWho] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const rows: any[] = content.diary ?? [];

  async function add() {
    const at = Date.parse(when);
    if (!title.trim() || !Number.isFinite(at)) return;
    setBusy(true);
    try {
      await api.addMeeting({ title: title.trim(), counterpart: withWho.trim() || null, scheduled_at: at });
      setTitle(""); setWithWho(""); setWhen(""); setAdding(false);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {rows.length === 0 ? (
        <div className="row-sub">Nothing in the next three weeks. Add one below.</div>
      ) : (
        rows.map((r) => (
          <div className="row" key={r.id}>
            <div className="row-main">
              <div className="row-title">{r.title}</div>
              <div className="row-sub">
                {new Date(r.scheduled_at).toLocaleString(undefined, {
                  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
                {r.with ? ` · with ${r.with}` : ""}
                {r.location ? ` · ${r.location}` : ""}
              </div>
              <div className="row-sub">
                {r.packet_url ? (
                  <a href={r.packet_url} target="_blank" rel="noreferrer">Packet →</a>
                ) : (
                  "No packet"
                )}
                {" · "}
                {r.source === "recurring" ? "standing" : r.source === "calendar" ? "from your calendar" : r.source === "crm" ? "from your people" : "you added this"}
              </div>
            </div>
            {/* Cancelled, not deleted — and the standing fixture has no row to cancel. */}
            {r.standing || r.source === "crm" ? (
              <div className="row-val">{r.standing ? "weekly" : ""}</div>
            ) : (
              <button
                className="btn btn-defer"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await api.cancelMeeting(r.id); onChanged(); } catch (e) { onError(e); } finally { setBusy(false); }
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ))
      )}

      {adding ? (
        <div className="judgement-note">
          {/* Every control is named for a screen reader; a placeholder is not a label. */}
          <label className="stat-l" htmlFor="diary-title">What is it?</label>
          <input id="diary-title" className="judgement-why" placeholder="Coffee with the Hartley people" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="stat-l" htmlFor="diary-with">Who with? (optional)</label>
          <input id="diary-with" className="judgement-why" placeholder="Scooter" value={withWho} onChange={(e) => setWithWho(e.target.value)} />
          <label className="stat-l" htmlFor="diary-when">When</label>
          <input id="diary-when" className="judgement-why" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <div className="decide">
            <button className="btn btn-approve" disabled={busy || !title.trim() || !when} onClick={() => void add()}>
              {busy ? "Adding…" : "Add it"}
            </button>
            <button className="btn btn-defer" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="decide">
          <button className="btn" onClick={() => setAdding(true)}>Add a meeting</button>
          <a className="btn" href={content.agenda_page ?? "/api/boss/packets/page"} target="_blank" rel="noreferrer">
            All agendas
          </a>
        </div>
      )}

      {content.calendar && (
        <>
          <div className="row-sub">{content.calendar.note}</div>
          {(content.calendar.unreadable ?? []).map((u: string, i: number) => (
            <div className="row-sub" key={i}>Not in here: {u}</div>
          ))}
        </>
      )}
    </>
  );
}

function Loops({ loops, onChanged, onError }: {
  loops: any[];
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(id: string, action: "resolve" | "dismiss" | "defer") {
    setBusy(true);
    try { await api.closeLoop(id, action); await onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try { await api.openLoop({ title: title.trim(), kind: "other" }); setTitle(""); await onChanged(); }
    catch (err) { onError(err); }
    finally { setBusy(false); }
  }

  return (
    <>
      {loops.length === 0
        ? <Empty title="Nothing is hanging" hint="Loops raised by meetings, approvals and the Night Gate land here." />
        : loops.map((l) => (
            <div className="row" key={l.id}>
              <div className="row-main">
                <div className="row-title">{l.title}</div>
                <div className="row-sub">
                  {l.kind.replace(/_/g, " ")}
                  {l.carried_from && ` · carried from ${l.carried_from}`}
                </div>
              </div>
              <div className="decide" style={{ marginTop: 0 }}>
                <button className="btn btn-approve" disabled={busy} onClick={() => act(l.id, "resolve")}>Done</button>
                <button className="btn btn-defer" disabled={busy} onClick={() => act(l.id, "defer")}>Tomorrow</button>
                <button className="btn btn-reject" disabled={busy} onClick={() => act(l.id, "dismiss")}>Drop</button>
              </div>
            </div>
          ))}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="field-inline"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Something that must not be forgotten"
          aria-label="New open loop"
        />
        <button className="btn" disabled={busy || !title.trim()}>Add</button>
      </form>
    </>
  );
}

// ─── Gate flows ───────────────────────────────────────────────────────────────

function Lines({ value, onChange, max, label }: {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  label: string;
}) {
  return (
    <>
      {value.map((v, i) => (
        <input
          key={i}
          value={v}
          onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={`${label} ${i + 1}`}
          aria-label={`${label} ${i + 1}`}
          style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
        />
      ))}
      {value.length < max && (
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => onChange([...value, ""])}>
          Add {label.toLowerCase()}
        </button>
      )}
    </>
  );
}

function MorningForm({ max, onRun }: { max: number; onRun: (b: unknown) => void }) {
  const [priorities, setPriorities] = useState<string[]>([""]);
  const [identity, setIdentity] = useState("");
  const [state, setState] = useState("");
  const [bodyFloor, setBodyFloor] = useState("");
  const [revenue, setRevenue] = useState("");
  const [commitment, setCommitment] = useState("");
  const filled = priorities.filter((p) => p.trim());

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          priorities: filled,
          identity_cue: identity || undefined,
          state: state || undefined,
          body_floor: bodyFloor || undefined,
          revenue_reality: revenue || undefined,
          commitment: commitment || undefined,
        });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Morning Gate</h3>
      <InfoNotice>Three priorities at most. Choosing them is the work.</InfoNotice>
      <Lines value={priorities} onChange={setPriorities} max={max} label="Priority" />
      {[
        ["Identity cue", identity, setIdentity],
        ["State", state, setState],
        ["Body floor", bodyFloor, setBodyFloor],
        ["Revenue reality", revenue, setRevenue],
        ["Today's commitment", commitment, setCommitment],
      ].map(([label, value, set]: any) => (
        <input
          key={label}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={label}
          aria-label={label}
          style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
        />
      ))}
      <div className="decide">
        <button className="btn btn-approve" disabled={filled.length === 0}>Agree the day</button>
      </div>
    </form>
  );
}

function MiddayForm({ max, onRun }: { max: number; onRun: (b: unknown) => void }) {
  const [checks, setChecks] = useState<string[]>([""]);
  const [adjustments, setAdjustments] = useState("");
  const filled = checks.filter((c) => c.trim());

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ checks: filled.map((text) => ({ text, done: false })), adjustments: adjustments || undefined });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Midday Reset</h3>
      <InfoNotice>Three checks at most, and the approval sweep runs with them.</InfoNotice>
      <Lines value={checks} onChange={setChecks} max={max} label="Check" />
      <input
        value={adjustments}
        onChange={(e) => setAdjustments(e.target.value)}
        placeholder="What changed"
        aria-label="What changed"
        style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
      />
      <div className="decide">
        <button className="btn btn-approve" disabled={filled.length === 0}>Reset</button>
      </div>
    </form>
  );
}

function NightForm({ max, maxSeed, onRun }: { max: number; maxSeed: number; onRun: (b: unknown) => void }) {
  const [attention, setAttention] = useState([{ focus_area: "", pct: "" }]);
  const [review, setReview] = useState<string[]>([""]);
  const [seed, setSeed] = useState<string[]>([""]);
  const [note, setNote] = useState("");

  const allocated = attention.reduce((sum, a) => sum + (Number(a.pct) || 0), 0);
  const usable = attention.filter((a) => a.focus_area.trim() && Number(a.pct) > 0);

  /*
   * THE FIVE FLOORS, ASKED RATHER THAN INFERRED.
   *
   * §14.2: "Ask what was completed before assigning a verdict. Do not guess completion." So the
   * three-state control is the design, not a UI nicety — met, missed, and NOT ANSWERED are three
   * different things, and a checkbox would collapse the last two into "missed" and quietly
   * manufacture the guess the rule forbids. Unanswered is the default and it stays that way unless
   * she touches it.
   *
   * The floor list is fetched rather than written here, so this screen cannot drift from the
   * contract that scores the day.
   */
  const [floors, setFloors] = useState<{ key: string; title: string; floor: string }[]>([]);
  const [reported, setReported] = useState<Record<string, boolean | undefined>>({});
  useEffect(() => { api.floors().then((f: any) => setFloors(f.floors)).catch(() => setFloors([])); }, []);

  const answered = Object.values(reported).filter((v) => v !== undefined).length;

  return (
    <form
      className="docket"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          attention: usable.map((a) => ({ focus_area: a.focus_area.trim(), pct: Number(a.pct) })),
          review: review.filter((r) => r.trim()),
          evidence: note ? { note } : undefined,
          tomorrow_seed: { priorities: seed.filter((s) => s.trim()) },
          // Sent only when she answered something. An empty object would look like a report of
          // five unknowns rather than a night she chose not to score.
          floors: answered > 0 ? reported : undefined,
        });
      }}
    >
      <h3 style={{ marginTop: 0 }}>Night Gate</h3>
      <InfoNotice tone={allocated > 100 ? "reject" : "brass"}>
        Attention allocation: {allocated}% of the day accounted for.
      </InfoNotice>

      {attention.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={a.focus_area}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, focus_area: e.target.value } : x)))}
            placeholder="Where the attention went"
            aria-label={`Focus area ${i + 1}`}
            style={{ flex: 1, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px" }}
          />
          <input
            value={a.pct}
            onChange={(e) => setAttention(attention.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
            placeholder="%"
            inputMode="numeric"
            aria-label={`Percentage ${i + 1}`}
            style={{ width: 64, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px" }}
          />
        </div>
      ))}
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setAttention([...attention, { focus_area: "", pct: "" }])}>
        Add focus area
      </button>

      <p className="eyebrow" style={{ marginTop: 14 }}>Floors</p>
      {floors.map((f) => (
        <div className="row" key={f.key}>
          <div className="row-main">
            <div className="row-title">{f.title}</div>
            <div className="row-sub">{f.floor}</div>
          </div>
          <div className="btn-row">
            {([["met", true], ["missed", false]] as const).map(([label, value]) => (
              <button
                key={label}
                type="button"
                className="btn"
                aria-pressed={reported[f.key] === value}
                // Pressing the active answer clears it. Nothing else can return a floor to
                // unanswered, and she should never be trapped into a claim by a mis-tap.
                onClick={() => setReported((r) => ({ ...r, [f.key]: r[f.key] === value ? undefined : value }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="row-sub">
        {answered === 0
          ? "Answer none of these and the day closes unscored. That is allowed."
          : `${answered} of ${floors.length} answered. The rest stay unanswered rather than counting as missed.`}
      </p>

      <p className="eyebrow" style={{ marginTop: 14 }}>Review</p>
      <Lines value={review} onChange={setReview} max={max} label="Prompt" />

      <p className="eyebrow" style={{ marginTop: 14 }}>Seed tomorrow</p>
      <Lines value={seed} onChange={setSeed} max={maxSeed} label="Priority" />

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Evidence from the day"
        aria-label="Evidence from the day"
        style={{ display: "block", width: "100%", marginTop: 8, background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 3, padding: "8px 10px", boxSizing: "border-box" }}
      />

      <div className="decide">
        <button className="btn btn-approve" disabled={usable.length === 0 || allocated > 100}>Close the day</button>
      </div>
    </form>
  );
}
