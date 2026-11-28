/*
 * WHAT THE DEPLOYED PAGES WERE BUILT FROM, IN COUNTS (engineering-check FAIL on #591, 28 Nov 2026).
 * Email Map renders ./manifest.json and Team -> Duties renders docs/outbound_email_owners.json (with the
 * map doc), both compiled into the deploy. /api/health reports these counts, so the nightly outcome
 * check (public GET, no sign-in) reads what production serves, never the repo: a deploy that failed or
 * never shipped this code has no `maps`, and a map emptied or broken counts below its floor.
 * Counts only: no names, addresses, schedules or pause steps leave the login.
 */
import manifest from "./manifest.json";
import owners from "../../../../docs/outbound_email_owners.json";

export interface MapsHealth {
  emailMap: { rows: number; withScheduleAndPause: number };
  teamDuties: { paths: number };
}

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";

export function mapsHealth(
  m: { rows?: Array<{ when?: unknown; pause?: unknown }> } = manifest as never,
  o: { owners?: Record<string, { seat?: unknown }> } = owners as never,
): MapsHealth {
  const rows = Array.isArray(m?.rows) ? m.rows : [];
  return {
    emailMap: { rows: rows.length, withScheduleAndPause: rows.filter((r) => filled(r?.when) && filled(r?.pause)).length },
    teamDuties: { paths: Object.values(o?.owners ?? {}).filter((e) => filled(e?.seat)).length },
  };
}
