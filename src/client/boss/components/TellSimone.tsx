import { useEffect, useRef, useState } from "react";
import { api, type SimoneMessageResult } from "../api";

export const TELL_SIMONE_ID = "tell-simone";

export function TellSimone({ focus = false, onOpenRecentWork, page = false }: { focus?: boolean; onOpenRecentWork?: () => void; page?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(() => sessionStorage.getItem(page ? "simone-page-message" : "tell-simone-message"));
  const [result, setResult] = useState<SimoneMessageResult | null>(null);
  const label = page ? "Message Simone" : "Tell Simone";
  const storageKey = page ? "simone-page-message" : "tell-simone-message";
  const finished = result?.status === "done" || result?.status === "failed" || result?.status === "cancelled";
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);

  // "Tell Simone ↑" on an employee's page opens Today here, with the cursor in the box.
  useEffect(() => {
    if (!focus) return;
    section.current?.scrollIntoView({ block: "start" });
    box.current?.focus();
  }, [focus]);

  useEffect(() => {
    if (!taskId || finished) return;
    let active = true;
    let timer: number | undefined;
    async function check() {
      try {
        const next = await api.simoneMessage(taskId!);
        if (active) setResult(next);
      } catch { /* A dropped connection leaves the message on the server. */ }
      if (active) timer = window.setTimeout(check, 5_000);
    }
    void check();
    return () => { active = false; window.clearTimeout(timer); };
  }, [taskId, finished]);

  async function send() {
    setBusy(true);
    setFailed(null);
    try {
      const { taskId: id } = await (page ? api.messageSimone(text) : api.tellSimone(text));
      sessionStorage.setItem(storageKey, id);
      setTaskId(id);
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
    sessionStorage.removeItem(storageKey);
    setTaskId(null);
    setResult(null);
    setFailed(null);
    requestAnimationFrame(() => box.current?.focus());
  }

  return (
    <section ref={section} id={page ? undefined : TELL_SIMONE_ID} className="panel tell-simone" data-testid={page ? "employee-message-simone" : "tell-simone"} aria-label={label}>
      <h2 className="tell-simone-h">{label}</h2>
      {!taskId ? (
        <>
          <p className="row-sub tell-simone-hint">What can Simone take care of for you?</p>
          <textarea
            ref={box}
            className="tell-simone-box"
            rows={4}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            aria-label="What should Simone do?"
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
          <p className="tell-simone-ok">{finished ? "Simone replied" : "Simone has your message"}</p>
          {result?.reply && <p className="tell-simone-reply" style={{ whiteSpace: "pre-wrap" }}>{result.reply}</p>}
          <div className="btn-row tell-simone-btns">
            {finished && <button className="btn" onClick={again}>Tell Simone something else</button>}
            {onOpenRecentWork && <button className="btn" onClick={onOpenRecentWork}>Open Recent work</button>}
          </div>
        </div>
      )}
    </section>
  );
}
