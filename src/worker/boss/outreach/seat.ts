/**
 * THE EXCLUSIVE SEAT, READ AT SEND TIME (13 Oct 2026). A business with a `seat` in the catalog
 * publishes whether its one exclusive routing seat is taken, as public JSON with no facility
 * details: `{"active": false}` or `{"active": true, "end": "YYYY-MM-DD"}`.
 *
 *   · seat open  → pitch A (the seat itself, `steps`);
 *   · seat taken → pitch B (the open round, `seat.taken`), naming the month the seat ends.
 *
 * The read never blocks a tick: a short timeout, and on any failure the LAST value read is used,
 * or "open" when nothing was ever read. Because the JSON names no facility, the seat holder is
 * named by the owner as a domain (`seat_holder_domain`, PUT /api/outreach/business/:key), and the
 * seat holder is never written to by outreach for that business at all — pitch A least of all.
 */
import type { Business } from "./catalog";
import { baseDomain } from "./lists";

export interface Seat {
  active: boolean;
  /** YYYY-MM-DD, present only when active. */
  end: string | null;
}

export type Pitch = "A" | "B";

export const SEAT_TIMEOUT_MS = 3_000;
export const SEAT_OPEN: Seat = { active: false, end: null };

/** The published JSON, validated. Anything else is null and counts as a failed read. */
export function parseSeat(json: unknown): Seat | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { active?: unknown; end?: unknown };
  if (j.active === false) return { active: false, end: null };
  if (j.active === true && typeof j.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.end) && !Number.isNaN(Date.parse(`${j.end}T00:00:00Z`))) {
    return { active: true, end: j.end };
  }
  return null;
}

export interface SeatRead {
  seat: Seat;
  /** fetched = read now; last = the read failed and the stored value stands; default = never read. */
  source: "fetched" | "last" | "default";
  detail: string;
}

/** Read the seat with a short timeout. Never throws. */
export async function readSeat(url: string, last: Seat | null, fetchImpl: typeof fetch = fetch, ms = SEAT_TIMEOUT_MS): Promise<SeatRead> {
  const fallback = (detail: string): SeatRead =>
    last ? { seat: last, source: "last", detail: `${detail}; using the last value read` } : { seat: SEAT_OPEN, source: "default", detail: `${detail}; never read, so the seat counts as open` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return fallback(`${url} answered ${res.status}`);
    const seat = parseSeat(await res.json());
    return seat ? { seat, source: "fetched", detail: `read ${url}` } : fallback(`${url} is not {"active": false} or {"active": true, "end": "YYYY-MM-DD"}`);
  } catch (err) {
    return fallback(`${url} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Seat open → A; seat taken → B. A business without a seat always sends A. */
export function pitchFor(b: Business, seat: Seat): Pitch {
  return b.seat && seat.active ? "B" : "A";
}

/** "2027-03-31" → "March 2027". */
export function seatEndMonth(end: string): string {
  return new Date(`${end}T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The owner's seat_holder_domain, normalised ("https://www.Acme.com/x" → "acme.com"), or null. */
export function normaliseHolderDomain(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let host = s.includes("@") ? (s.split("@")[1] ?? "") : s;
  try { host = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).hostname; } catch { return null; }
  host = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The prospect is the seat holder: its address or its website is on the holder's domain. */
export function isSeatHolder(p: { email?: string | null; website?: string | null }, holderDomain: string | null | undefined): boolean {
  if (!holderDomain) return false;
  const holder = baseDomain(holderDomain);
  const emailHost = p.email?.split("@")[1] ?? "";
  let siteHost = "";
  try { siteHost = p.website ? new URL(p.website).hostname : ""; } catch { siteHost = ""; }
  return [emailHost, siteHost].some((h) => h && baseDomain(h) === holder);
}
