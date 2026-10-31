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
  is_last_day?: boolean;
  days_left?: number;
};

/**
 * TODAY v4 (owner, 31 Oct 2026): A THIN BANNER, NOT A CARD. One line and "Log it ›", only on the last
 * day of the month and the 3 days before (the Worker's window, spirit/ancestralHour.ts), and only
 * while the hour is not logged. Outside that, it is not on Today at all. Red only on the last day.
 */
export function ancestralBannerText(s: Pick<State, "is_last_day" | "days_left">): string {
  return s.is_last_day
    ? "🔥 Last day of the month: ancestral hour not logged yet"
    : `🕯 Ancestral hour: ${s.days_left} day${s.days_left === 1 ? "" : "s"} left this month, not logged yet`;
}

export function AncestralHourCard() {
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    let live = true;
    api.ancestralHour().then((r) => { if (live) setS(r as State); }).catch(() => { /* a banner that cannot load stays out of the way */ });
    return () => { live = false; };
  }, []);

  if (!s || !s.show || s.done) return null;

  return (
    <div className={`ancestral-banner ancestral-${s.is_last_day ? "alarm" : "warm"}`} data-testid="ancestral-hour">
      <span>{ancestralBannerText(s)}</span>
      <button className="t-link" onClick={() => go("/?tab=spirit")}>Log it ›</button>
    </div>
  );
}
