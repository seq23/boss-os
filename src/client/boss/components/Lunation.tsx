import { inOwnerZone, OWNER_TIMEZONE_LABEL } from "../../../shared/boss/timezone";

/**
 * THE CYCLE SHE IS IN — ONE BLOCK, TWO SCREENS (Today v4, 31 Oct 2026: "the exact lunation block from
 * Spirit … Extract it into a shared component, don't duplicate"). Spirit renders it in its panel with the
 * advisory line; Today renders the same words above the fold. Both read `current_lunation` from
 * `/spirit/day`, and the helpers that print its times live here, once.
 */

/** HER clock, named, and the Eastern clock she quotes beside it (never the browser's zone). */
export const lunationAt = (ts: number) => {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
  const local = `${inOwnerZone(ts, opts)} ${OWNER_TIMEZONE_LABEL}`;
  const eastern = new Date(ts).toLocaleString("en-US", { ...opts, timeZone: "America/New_York" });
  return { local, eastern };
};

/** Degrees AND arcminutes, the precision rule Spirit holds for the ephemeris. */
export const lunationDeg = (d: number) =>
  `${Math.floor(d)}°${String(Math.round((d - Math.floor(d)) * 60)).padStart(2, "0")}′`;

export const lunationWhen = (ts: number) => {
  const days = Math.round((ts - Date.now()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
};

export type Lunation = {
  current: { label: string; at: number; sign: string; degrees_in_sign: number };
  next: { label: string; at: number };
  days_since: number;
};

export function LunationBlock({ lunation, advisory = true }: { lunation: Lunation; advisory?: boolean }) {
  const at = lunationAt;
  return (
    <div data-testid="lunation-block">
      <div style={{ fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.2 }}>{lunation.current.label}</div>
      <div style={{ fontSize: "1.05rem", marginTop: 4 }}>
        The cycle you are in — {lunation.days_since === 0 ? "today" : `day ${lunation.days_since + 1}`} of it.
      </div>
      <div className="row-sub">
        {at(lunation.current.at).local} · {at(lunation.current.at).eastern} Eastern ·{" "}
        {lunationDeg(lunation.current.degrees_in_sign)} {lunation.current.sign}
      </div>
      <div className="row-sub" style={{ marginTop: 6 }}>
        It runs until the {lunation.next.label} — {at(lunation.next.at).local}, {lunationWhen(lunation.next.at)}.
      </div>
      {advisory && (
        <div className="row-sub" style={{ marginTop: 8 }}>
          Advisory only — context, never a cause and never a permission.
        </div>
      )}
    </div>
  );
}
