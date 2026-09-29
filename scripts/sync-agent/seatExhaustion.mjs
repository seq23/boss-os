/**
 * WHICH SEATS ON THIS MACHINE ARE OUT OF USAGE, AND UNTIL WHEN (29 Sep 2026).
 *
 * The claim loop already has a mechanism for "this seat cannot take work right now": a seat that
 * fails its preflight is passed to the cloud as `fallback_from`, and the cloud may then hand this
 * machine's OTHER seat a run parked for it when the run's own ladder lists that seat later. A spent
 * plan is the same situation reached by a different door — the seat authenticates fine and cannot
 * answer — so it uses the same door. This is the memory that keeps a spent seat out of the claim
 * loop until its window resets, without a preflight that could only ever say "authenticated".
 *
 * A TIMESTAMP, NEVER A FLAG. The entry expires by itself, so nobody has to remember to switch a
 * seat back on; a seat that is still limited when tried again costs one fast failed run and is
 * marked again. `load`/`save` are injected so the agent persists it in its local database (a restart
 * mid-window does not forget) and a test keeps it in memory.
 */
import { DEFAULT_COOLDOWN_SECONDS, MAX_COOLDOWN_SECONDS, MIN_COOLDOWN_SECONDS } from "../lib/seat-usage-limit.mjs";

export function cooldownSeconds(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_COOLDOWN_SECONDS;
  return Math.min(MAX_COOLDOWN_SECONDS, Math.max(MIN_COOLDOWN_SECONDS, Math.round(n)));
}

export function createSeatExhaustion({ now = () => Date.now(), load = () => ({}), save = () => {} } = {}) {
  let cache = null;
  const read = () => {
    if (cache === null) {
      let raw = {};
      try { raw = load() ?? {}; } catch { raw = {}; }
      cache = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
    }
    return cache;
  };
  const write = () => { try { save({ ...read() }); } catch { /* remembering is best-effort; the cloud also knows */ } };
  return {
    /** The seat's plan is spent. Returns the epoch ms it will be tried again. */
    mark(seat, retryAfterSeconds) {
      const until = now() + cooldownSeconds(retryAfterSeconds) * 1000;
      read()[seat] = until;
      write();
      return until;
    },
    /** Epoch ms the seat is skipped until, or null when it is not skipped. Prunes an expired entry. */
    activeUntil(seat) {
      const u = read()[seat];
      if (typeof u === "number" && u > now()) return u;
      if (u !== undefined) { delete read()[seat]; write(); }
      return null;
    },
    /** The seat answered, so its plan has usage again. */
    clear(seat) {
      if (read()[seat] !== undefined) { delete read()[seat]; write(); }
    },
  };
}
