import type { Env } from "../env";
import { currentBook } from "./book";

/**
 * IF SHE DOES NOT SEND A BOOK, MONIQUE ASKS FOR IT — AND KEEPS ASKING.
 *
 * Owner, 10 September 2026: "If she does not send a book for 7 days, Monique must ASK HER for it."
 * And the standing rule this repo already holds: employees cannot drop owned work; a block escalates
 * immediately and keeps nagging until it is resolved.
 *
 * ─── WHY THIS IS NOT AN `owned_deliverables` ROW ───────────────────────────
 *
 * That was the obvious home and it is the wrong one, for a reason worth writing down. A deliverable
 * COMPLETES: `deliverableAlerts` flips it to `done` the moment its terminal check passes and it
 * never opens again. That is right for "get the books published" and exactly wrong for a standing
 * condition that becomes false again every week — the first book she sent would close it for ever
 * and the nag would never fire a second time. A one-shot mechanism used for a recurring duty is
 * this codebase's "runs but inert" defect with a green tick on it.
 *
 * ─── WHY IT IS NOT A CRON EITHER ───────────────────────────────────────────
 *
 * Same reasoning `today/deliverables.ts` states for itself: EVALUATED ON READ. A scheduled nag stops
 * the day the schedule stops, and takes the escalation with it silently. This is arithmetic over a
 * timestamp, computed every time she opens Today, so it cannot fail without the whole page failing.
 *
 * ─── IT ESCALATES, BECAUSE A CONSTANT NAG IS A NAG SHE STOPS READING ───────
 *
 * Seven days is a question. Three weeks is Monique working from something she has been told twice is
 * out of date, which is worse than working from nothing — every match, every buyer, every call is
 * built on inventory that may already be gone.
 */

export interface BookNag {
  severity: "medium" | "high" | "critical";
  text: string;
  source_type: string;
  source_id: string | null;
}

/** Seven days, from her instruction. */
export const BOOK_FRESH_DAYS = 7;
const DAY = 86_400_000;

export async function bookNagAlerts(env: Env, now = Date.now()): Promise<BookNag[]> {
  const live = await currentBook(env);

  /*
   * NEVER SENT ONE IS THE STRONGEST CASE, NOT A QUIET ONE.
   *
   * The empty-set pass, at the level of an outcome: no book means no `received_at`, means no age,
   * means a staleness check that reports nothing wrong. Monique would then be matching against an
   * empty book and finding no buyers, and the honest answer — "she has never told me what she has"
   * — would look identical to "there is nothing to do this week".
   */
  if (!live) {
    return [{
      severity: "critical",
      text:
        "Monique has never been sent your live book, so every buyer hunt she runs is against nothing. "
        + "Email boss@sequoiataylor.com with #monique and the names and sizes you have out — one line each, "
        + "the way you would say it out loud.",
      source_type: "capital",
      source_id: null,
    }];
  }

  const ageDays = Math.floor((now - live.received_at) / DAY);
  if (ageDays < BOOK_FRESH_DAYS) return [];

  const severity = ageDays >= 21 ? "critical" : ageDays >= 14 ? "high" : "medium";
  const tail = ageDays >= 21
    ? "Monique is still working v" + live.version + " and has now asked three times. Anything she brings you is built on inventory that may already be gone."
    : ageDays >= 14
      ? "Monique is still working v" + live.version + ". Two weeks is long enough for a block to have traded away underneath her."
      : "Monique needs it to know what she is looking for buyers for.";

  return [{
    severity,
    text:
      `Your live book is ${ageDays} days old — v${live.version}, last sent ${new Date(live.received_at).toISOString().slice(0, 10)}. `
      + `${tail} Email boss@sequoiataylor.com with #monique. If nothing has changed, send it again anyway and it `
      + "will be marked confirmed rather than filed as a new version.",
    source_type: "capital",
    source_id: live.id,
  }];
}
