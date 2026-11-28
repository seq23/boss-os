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
import { inOneClock } from "../words";

export interface MapsHealth {
  emailMap: { rows: number; withScheduleAndPause: number; inOneClock: number };
  /** `joinedToDuty`: paths Team → Duties shows inside the duty that is their job (28 Nov 2026). */
  teamDuties: { paths: number; joinedToDuty: number };
}

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";

export function mapsHealth(
  m: { rows?: Array<{ when?: unknown; pause?: unknown }> } = manifest as never,
  o: { owners?: Record<string, { seat?: unknown; duty?: unknown }> } = owners as never,
): MapsHealth {
  const rows = Array.isArray(m?.rows) ? m.rows : [];
  return {
    emailMap: {
      rows: rows.length,
      withScheduleAndPause: rows.filter((r) => filled(r?.when) && filled(r?.pause)).length,
      inOneClock: rows.filter((r) => filled(r?.when) && inOneClock(r.when as string)).length,
    },
    teamDuties: {
      paths: Object.values(o?.owners ?? {}).filter((e) => filled(e?.seat)).length,
      joinedToDuty: Object.values(o?.owners ?? {}).filter((e) => filled(e?.seat) && filled(e?.duty)).length,
    },
  };
}
