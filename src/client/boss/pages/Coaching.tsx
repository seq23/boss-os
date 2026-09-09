import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

/**
 * THE MORNING COACHING CONVERSATION.
 *
 * Her §15.6: mandatory every morning, brief by default, 1-5 short exchanges, ONE QUESTION AT A
 * TIME, focused on readiness, resistance, emotional state, launch friction, and confirming the
 * day's centre of gravity.
 *
 * THE TRANSCRIPT LIVES HERE AND NOWHERE ELSE. Boss OS has no coaching table and must never get one:
 * this content is LOCAL_ONLY residency and the design honours that literally rather than by writing
 * a row and labelling it. The turns are React state — they exist in this browser, on this device,
 * for as long as the screen is open, and then they are gone. That is not a limitation being worked
 * around; it is the feature.
 *
 * WHICH IS WHY THERE IS NO HISTORY VIEW, and there should never be one. A conversation you can
 * scroll back through a week later is a conversation that was stored, and storing it is the one
 * thing she was promised would not happen.
 */

type Turn = { role: "coach" | "her"; text: string };

export function Coaching({ onModeSet }: { onModeSet?: () => void }) {
  const [state, setState] = useState<any>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = () => api.coachingState().then(setState).catch(setError);
  useEffect(() => { load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns.length, busy]);

  const consented = state?.consent?.granted === true;
  const exchanges = turns.filter((t) => t.role === "her").length;

  /*
   * THE CHOICES COME FROM THE SERVER, NEVER FROM A LITERAL HERE.
   *
   * This screen used to hardcode one backend id. It named Claude Code, which cannot hold a
   * conversation at all — it is agent-executed, so a turn would have become a task in a queue
   * waiting on the Mac agent — and even a correct id would have been a second list, free to drift
   * from the one the router actually reaches. What she approves is now whatever can genuinely
   * answer her, and the free ones are listed first.
   */
  const backends: { id: string; display_name: string; free: boolean }[] = state?.backends ?? [];

  async function approve(backendId: string) {
    setError(null);
    try {
      // The backend is named in the request, because consent to one is not consent to another.
      await api.coachingConsent({ backend_id: backendId });
      await load();
    } catch (e) { setError(e); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "her", text }]);
    setBusy(true);
    setError(null);
    try {
      const res = await api.coachingTurn({
        text,
        turn: exchanges + 1,
        // Only the last two exchanges travel. A morning is not a transcript, and a context window
        // that grows every day is one nobody bounded.
        recent: turns.slice(-4).map((t) => ({ role: t.role, text: t.text })),
      });
      if (res.ended) setEnded(res.reason === "exit_phrase" ? "You called it. Go." : "That is five. Go.");
      else setTurns((t) => [...t, { role: "coach", text: res.reply }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: string) {
    setError(null);
    try {
      await api.setDayMode({ mode, source: "coaching" });
      await load();
      onModeSet?.();
    } catch (e) { setError(e); }
  }

  if (!state && !error) return <Loading />;

  return (
    <div className="coach">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {/*
        * THE PROMISE, ON THE SCREEN WHERE SHE DECIDES — not buried in a policy document she would
        * have to go and find. Both halves are stated, because only saying the first would be the
        * reassuring lie and only saying the second would hide what she actually controls.
        */}
      {!consented ? (
        <div className="coach-gate">
          {/*
            * ── PURPOSE FIRST, APPARATUS LAST ──────────────────────────────────
            *
            * She screenshotted this and said: "AND THIS IS THE COACHING SECTION? IT DOESNT LOOK
            * LIKE A COACHING SECTION AT FIRST GLANCE."
            *
            * Every sentence that was here was true. The order was the defect: a privacy disclaimer
            * led, a Cloudflare product name was half the button, an internal classification constant
            * was printed at her, and nothing anywhere said what coaching would DO for her.
            * Reassurance is not an introduction — she cannot weigh a promise about her data before
            * she knows what the thing is.
            *
            * So: a heading that says what this is, one line on what it is for, what happens if she
            * ignores it, a button naming the ACTION — then the caveats, below, in smaller weight,
            * where they reassure instead of leading.
            */}
          <h2 className="coach-heading">{state?.heading ?? "Coaching"}</h2>
          <p className="coach-purpose">{state?.purpose}</p>
          <p className="row-sub">{state?.if_ignored}</p>
          {backends.length === 0 ? (
            /*
             * NAMED, NOT A DISABLED BUTTON. An empty list means no cloud backend is both
             * commissioned and carrying a model, and she should be told which of the two is
             * missing rather than left pressing something that does nothing.
             */
            <p className="row-sub">
              No backend is currently able to hold this conversation. Commission one in Systems →
              Backends and provision its models, then come back.
            </p>
          ) : (
            <div className="btn-row">
              {backends.map((b) => (
                <button key={b.id} className="btn btn-approve" onClick={() => void approve(b.id)}>
                  {/*
                    * THE LABEL SAYS WHAT PRESSING IT CAUSES. It used to read "APPROVE WORKERS AI —
                    * FREE", which names a Cloudflare inference product — an implementation detail —
                    * and made the vendor half the button. "Free" is kept because she cares about
                    * cost, and demoted to where a note belongs.
                    */}
                  {state?.action_label ?? "Start coaching"}
                </button>
              ))}
            </div>
          )}

          {/* ── The caveats, after the point, in smaller weight ── */}
          <p className="row-sub coach-fineprint">{state?.storage}</p>
          <p className="row-sub coach-fineprint">{state?.why_daily}</p>
          <p className="row-sub coach-fineprint">{state?.cost_note}</p>
          {backends.length === 1 && (
            <p className="row-sub coach-fineprint">
              Answering today: {backends[0]?.display_name}.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="coach-log" role="log" aria-label="Morning coaching">
            {turns.length === 0 && (
              <p className="row-sub">
                Say how you are landing this morning. One question at a time, five at most — or say
                “I’m ready” and go.
              </p>
            )}
            {turns.map((t, i) => (
              <div className={t.role === "coach" ? "coach-said" : "her-said"} key={i}>{t.text}</div>
            ))}
            {busy && <div className="coach-said coach-thinking">…</div>}
            {ended && <div className="row-sub">{ended}</div>}
            <div ref={endRef} />
          </div>

          {!ended && (
            <div className="coach-input">
              <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                <span className="sr-only">What you want to say</span>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={`${exchanges} of ${state?.max_turns ?? 5} — or an exit phrase`}
                  disabled={busy}
                  aria-label="What you want to say"
                />
              </label>
              <button className="btn" onClick={() => void send()} disabled={busy || !draft.trim()}>
                {busy ? "…" : "Say it"}
              </button>
            </div>
          )}

          {/*
            * THE ONE THING THE CONVERSATION LEAVES BEHIND. Her §17 rewrites all four pillar
            * contracts to floors on a Recovery Day, so the agenda has to know — and naming the day
            * correctly is her own first instruction in that protocol: "This is a Recovery Day, not
            * a failed day."
            */}
          <p className="eyebrow">How today runs</p>
          <div className="btn-row">
            {(["full", "mvd", "recovery"] as const).map((m) => (
              <button
                key={m}
                className="btn"
                aria-pressed={state?.day_mode === m}
                onClick={() => void setMode(m)}
              >
                {m === "full" ? "Full day" : m === "mvd" ? "Minimum viable" : "Recovery"}
              </button>
            ))}
          </div>
          <p className="row-sub">
            {state?.day_mode
              ? `Today is a ${state.day_mode === "mvd" ? "minimum viable" : state.day_mode} day${state.day_mode_source === "coaching" ? ", from this conversation" : ", because you said so"}.`
              : "A minimum viable day and a recovery day are still days. Continuity over intensity."}
          </p>
        </>
      )}
    </div>
  );
}
