/**
 * THE BRAKES. Pure functions, so every one of them is tested directly and breaking one fails a test.
 *
 * There is no human review of outreach (owner, 9 Oct 2026). These are what stands in its place:
 *   · a per-domain daily cap that starts at 10 and ramps slowly;
 *   · an automatic pause on a bounce rate over 3% or on ANY complaint;
 *   · a global kill switch and a sending flag, checked before every send;
 *   · a sending window (weekdays, 09:00–16:59 America/Chicago) so mail lands in working hours.
 */

export const DAY_MS = 86_400_000;

/** Week 1: 10/day. Week 2: 15. Week 3: 20. Week 4: 30. After that: 40, and never more. */
export const RAMP = [10, 15, 20, 30, 40] as const;
export const MAX_DAILY = 40;
export const BOUNCE_PAUSE_RATE = 0.03;
/** Bounce rate is judged over this window of sends. */
export const BOUNCE_WINDOW_MS = 14 * DAY_MS;

export function dailyCap(rampStartedAt: number | null, now: number): number {
  if (!rampStartedAt || rampStartedAt > now) return RAMP[0] as number;
  const week = Math.floor((now - rampStartedAt) / (7 * DAY_MS));
  return Math.min(RAMP[Math.min(week, RAMP.length - 1)] ?? MAX_DAILY, MAX_DAILY);
}

export interface Health {
  sent: number;
  bounced: number;
  complaints: number;
}

/** A reason to pause, or null. Any complaint pauses; bounces pause strictly above 3%. */
export function pauseReason(h: Health): string | null {
  if (h.complaints > 0) {
    return `Paused automatically: ${h.complaints} spam complaint${h.complaints === 1 ? "" : "s"}. Any complaint pauses the domain.`;
  }
  if (h.sent > 0 && h.bounced / h.sent > BOUNCE_PAUSE_RATE) {
    const pct = ((h.bounced / h.sent) * 100).toFixed(1);
    return `Paused automatically: bounce rate ${pct}% (${h.bounced} of ${h.sent} in 14 days) is over 3%.`;
  }
  return null;
}

/** Wall-clock parts in America/Chicago, never a UTC hour. */
export function chicagoParts(now: number): { weekday: number; hour: number; day: string } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", hour: "numeric", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  const hour = Number(parts.hour) % 24;
  return { weekday, hour, day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function inSendWindow(now: number): boolean {
  const { weekday, hour } = chicagoParts(now);
  return weekday >= 1 && weekday <= 5 && hour >= 9 && hour <= 16;
}

/** How many to send on this hourly tick: the rest of today's cap spread over the hours left. */
export function sendsThisTick(cap: number, sentToday: number, now: number): number {
  const left = cap - sentToday;
  if (left <= 0 || !inSendWindow(now)) return 0;
  const hoursLeft = Math.max(1, 17 - chicagoParts(now).hour);
  return Math.max(1, Math.ceil(left / hoursLeft));
}

export type Sending = "off" | "test_only" | "live";

export interface Gate {
  killSwitch: boolean;
  sending: Sending;
  routeReady: boolean;
  hasPostalAddress: boolean;
  pausedReason: string | null;
  /** null when SPF, Google DKIM and DMARC all exist for the sender's domain (see mailauth.ts). */
  mailAuthMissing: string | null;
  isTestRecipient: boolean;
}

/**
 * May this one email go? Returns null for yes, or the reason for no. Order matters only for which
 * reason is shown; every check is a hard no.
 */
export function refusal(g: Gate): string | null {
  if (g.killSwitch) return "The global kill switch is on.";
  if (g.sending === "off") return "Sending is off.";
  if (!g.routeReady) return "This domain's sending address is not proven yet.";
  if (g.isTestRecipient) return null;
  if (g.sending === "test_only") return "Sending is test-only: only the test recipients may be written to.";
  if (g.mailAuthMissing) return g.mailAuthMissing;
  if (!g.hasPostalAddress) return "No postal address is set for this business, and CAN-SPAM requires one in every email.";
  if (g.pausedReason) return g.pausedReason;
  return null;
}
