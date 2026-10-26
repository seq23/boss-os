/**
 * "TELL SIMONE" — the box at the very top of Today (owner-approved mock-up, 26 Oct 2026).
 *
 * Type a task the way you would write an email. It goes to POST /api/intake/simone, which hands the
 * text to the same intake an email to simone@ takes, so Simone splits it into jobs and hands each to
 * the right person. The answer is the per-job handoff, shown here one row per job.
 *
 * After sending, the box shows what happened in place (never jumps the page); "Tell Simone something
 * else" brings the empty box back. An error says what went wrong and keeps her words for Try again.
 */
import { useEffect, useRef, useState } from "react";
import { api, type TellSimoneResult } from "../api";

export const TELL_SIMONE_ID = "tell-simone";

export function TellSimone({ focus = false, onOpenRecentWork }: { focus?: boolean; onOpenRecentWork?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TellSimoneResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);

  // "Tell Simone ↑" on an employee's page opens Today here, with the cursor in the box.
  useEffect(() => {
    if (!focus) return;
    section.current?.scrollIntoView({ block: "start" });
    box.current?.focus();
  }, [focus]);

  async function send() {
    setBusy(true);
    setFailed(null);
    try {
      setResult(await api.tellSimone(text));
      setText("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = (e as { hint?: string })?.hint;
      setFailed(`${msg}.${hint ? ` ${hint}` : ""} Your words are still in the box.`);
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setResult(null);
    setFailed(null);
    requestAnimationFrame(() => box.current?.focus());
  }

  const jobs = result?.jobs ?? [];
  return (
    <section ref={section} id={TELL_SIMONE_ID} className="panel tell-simone" data-testid="tell-simone" aria-label="Tell Simone">
      <h2 className="tell-simone-h">Tell Simone</h2>
      {!result ? (
        <>
          <p className="row-sub tell-simone-hint">Any task, question or new duty. She hands it to the right person. Several at once is fine.</p>
          <textarea
            ref={box}
            className="tell-simone-box"
            rows={4}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            aria-label="What should Simone hand off?"
            disabled={busy}
          />
          {failed && (
            <div className="notice notice-hint-box" role="alert" style={{ marginTop: 10 }}>
              Simone did not get that. {failed}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-small" onClick={send} disabled={busy || !text.trim()}>Try again</button>
              </div>
            </div>
          )}
          <div className="btn-row tell-simone-btns">
            <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim()}>
              {busy ? "Sending to Simone…" : "Send to Simone"}
            </button>
          </div>
          <p className="row-sub">Same as emailing simone@sequoiataylor.com.</p>
        </>
      ) : (
        <div className="tell-simone-done" role="status">
          {jobs.length > 0 ? (
            <>
              <p className="tell-simone-ok">✓ Simone has it: {jobs.length} {jobs.length === 1 ? "job" : "jobs"}</p>
              {jobs.map((j, i) => (
                <div className="tell-simone-job" key={`${j.taskId ?? "job"}-${i}`}>
                  <span>{j.title}</span>
                  <span className="tell-simone-who">
                    {j.employee}{j.duty ? " (duty)" : ""}{j.failure ? " (not started)" : ""}
                  </span>
                </div>
              ))}
              <p className="row-sub">Each one reports back by email when it&apos;s done or needs you. You&apos;ll also find them under Recent work.</p>
            </>
          ) : (
            <>
              <p className="tell-simone-ok">✓ Simone has it</p>
              <p className="tell-simone-reply">{replyLead(result.reply)}</p>
            </>
          )}
          <div className="btn-row tell-simone-btns">
            <button className="btn" onClick={again}>Tell Simone something else</button>
            {onOpenRecentWork && <button className="btn" onClick={onOpenRecentWork}>Open Recent work</button>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Her answer when no job opened (a question back, an answer filed on a card): its words, without the email sign-off. */
function replyLead(reply: string | null): string {
  return String(reply ?? "Simone has your message.").split(/\n\s*—\s*\n|\n— Boss OS/)[0]!.trim();
}
