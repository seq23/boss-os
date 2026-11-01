/**
 * MARKETPLACE LISTINGS USE OUR REAL WORK (owner ruling, 1 Nov 2026; porch-and-party brain, Settled
 * decisions). Camille uses real P&P job photos and clips first (P&P Studio uploads, P&P admin job
 * photos, newest first). When nothing new has come in for two weeks she asks the OWNER — never
 * Valerie — in one short item in the morning email, at most once a week.
 *
 * The pure rule: whether today's run asks, and the Decide item it writes. Read by
 * `scripts/ops/pnp-photo-ask.mjs`, which ~/bin/pnp-listings.sh runs before every listings run.
 */
export const NOTHING_NEW_DAYS = 14;
export const ASK_EVERY_DAYS = 7;
export const STUDIO_URL = "https://pnpstudio.spryexecutiveos.com";
const DAY = 86_400_000;

/**
 * `newest`: the newest real-work photo or clip time (ms) across every source that was read, or null
 * when the sources hold none. `lastAsked`: when she was last asked (ms) or null. Pure.
 */
export function photoAskDue({ newest, lastAsked, now }) {
  const days = newest === null || newest === undefined ? null : Math.floor((now - newest) / DAY);
  if (days !== null && days < NOTHING_NEW_DAYS) return { ask: false, days, why: `newest real-work photo is ${days} days old` };
  if (lastAsked !== null && lastAsked !== undefined && now - lastAsked < ASK_EVERY_DAYS * DAY) {
    return { ask: false, days, why: `asked ${Math.floor((now - lastAsked) / DAY)} days ago; at most once a week` };
  }
  return { ask: true, days, why: days === null ? "no real-work photos on file" : `nothing new in ${days} days` };
}

/** The one Decide item: one short line, one button. Never names a customer. Pure. */
export function photoAskItem({ days }) {
  return {
    key: "pnp-marketplace-photos",
    title: "Porch & Party: a few new photos of real jobs, please",
    body: `${days === null ? "There are no real-job photos on file yet" : `Nothing new from real jobs in ${days} days`}, so the Marketplace listings are reusing older pictures. Add a few from recent jobs in P&P Studio (no faces, no house numbers).`,
    buttons: [{ label: "Add photos in P&P Studio", url: STUDIO_URL }],
  };
}
