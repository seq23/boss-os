/**
 * THE ANCESTRAL HOUR, URGENT AT THE END OF THE MONTH (owner, 31 Oct 2026: "on the last day of the
 * month and 3 days before u should make the ancestral hour urgent and noticeable").
 *
 * SELF-CONTAINED ON PURPOSE: it fetches its own state (`GET /spirit/ancestral-hour`) and owns its own
 * "Done ✓", so Today can be redesigned and this card placed anywhere as one line. Outside the window
 * it renders nothing. The window, the countdown words and the tone all come from the Worker
 * (spirit/ancestralHour.ts): this file decides nothing about dates.
 *
 * Colour means one thing (make-it-calm): gold while there are days left; red only on the last day
 * and not yet done; green once it is done.
 *
 * NO role="status": the page has one live status region (the offline sync bar), and a second one
 * made "the status" ambiguous for anything reading the page (e2e boss-surface, 31 Oct 2026).
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { go } from "../nav";

type State = {
  show: boolean;
  done: boolean;
  tone: "warm" | "alarm" | "done" | null;
  headline: string | null;
  line: string | null;
  month_name: string;
};

export function AncestralHourCard() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.ancestralHour().then((r) => { if (live) setS(r as State); }).catch(() => { /* a card that cannot load stays out of the way */ });
    return () => { live = false; };
  }, []);

  if (!s || !s.show || !s.headline) return null;

  const done = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.ancestralHourDone();
      setS(r.state as State);
    } catch (e) {
      setErr(e instanceof Error ? `Not recorded: ${e.message}` : "Not recorded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`ancestral-card ancestral-${s.tone ?? "warm"}`} data-testid="ancestral-hour">
      <p className="ancestral-head">{s.headline}</p>
      {s.line && <p className="ancestral-line">{s.line}</p>}
      {err && <p className="ancestral-line">{err}</p>}
      <div className="btn-row">
        {!s.done && (
          <button className="btn btn-approve" disabled={busy} onClick={() => void done()}>
            {busy ? "Recording…" : "Done ✓"}
          </button>
        )}
        <button className="btn" onClick={() => go("/?tab=spirit")}>Open Spirit ›</button>
      </div>
    </div>
  );
}
