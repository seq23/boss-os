/**
 * AN ITEM THE MODEL KEEPS CALLING UNCERTAIN IS HELD FOR A PERSON (27 Nov 2026, review F4 of #583).
 *
 * The free reader returns `uncertain` when a model read the item and could not decide. Retried forever,
 * one such message stalled the capital scan, the daily grid check, the October re-read and the LP reply
 * reads behind it. So each job counts `uncertain` answers per item in the state file it already keeps,
 * and on the third run the item is held: kept unread and never marked done, named with its Gmail link
 * in her morning email, and the job reads the next item. An outage (`unavailable`) or a spent allowance
 * never counts: those stop the run as before and the item is read again tomorrow.
 */
export const UNCERTAIN_RUNS = 3;

/**
 * One more `uncertain` answer for `id`, counted on `store.uncertain`. Returns true when it reaches the
 * limit; the caller then holds the item (`holdForPerson`). Mutates `store`; the caller saves it.
 */
export function stillUncertain(store, id) {
  store.uncertain = { ...(store.uncertain ?? {}) };
  const runs = (store.uncertain[id] ?? 0) + 1;
  store.uncertain[id] = runs;
  return runs >= UNCERTAIN_RUNS;
}

/** Hold `id` for a person on `store.held`, with what she needs to open it. Mutates `store`. */
export function holdForPerson(store, id, detail) {
  store.held = { ...(store.held ?? {}), [id]: { ...detail, runs: store.uncertain?.[id] ?? UNCERTAIN_RUNS } };
  if (store.uncertain) delete store.uncertain[id];
}

/** A Gmail link that opens the message itself in the named mailbox (never a bare id). Pure. */
export const messageLink = (mailbox, id) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${encodeURIComponent(String(id))}`;

/** The morning line that names the items held this run, one Gmail link each. Null when none. Pure. */
export function heldLine(what, links) {
  if (!links.length) return null;
  return {
    text: `${what[0].toUpperCase()}${what.slice(1)}: ${links.length} could not be read after ${UNCERTAIN_RUNS} tries, so ${links.length === 1 ? "it is" : "they are"} held for you, unread and never marked done. Open ${links.length === 1 ? "it" : "each"} to decide ${links.length === 1 ? "it" : "them"} yourself.`,
    links: links.slice(0, 10).map((url, i) => ({ label: links.length === 1 ? "Open the email" : `Open email ${i + 1}`, url })),
  };
}
