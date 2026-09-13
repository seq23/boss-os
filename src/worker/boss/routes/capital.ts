/**
 * HER LIVE BOOK, READABLE BY THE ONE THING THAT HAS TO WORK FROM IT.
 *
 * ─── The gap this closes, named before it existed ──────────────────────────
 *
 * The book arrives by email, is parsed by the Worker and is stored in D1. Monique's buyer hunt is a
 * node script on her Mac. Without this route those are two components each keeping their own copy of
 * her inventory with no link between them — this repo's most-named defect, and the worst possible
 * place for it: she would email an updated book, see it acknowledged, and the hunt would go on
 * working yesterday's names for ever while every signal said it was current.
 *
 * SO D1 IS AUTHORITATIVE AND THE LOCAL FILE IS A MIRROR. `npm run capital:book -- --pull` writes it,
 * and it carries the version and the arrival date so a mirror that has fallen behind says so rather
 * than looking like the real thing.
 *
 * ─── THE BOOK IS READ ONLY, AND DELIBERATELY SO ────────────────────────────
 *
 * There is no POST for the BOOK. It has exactly one way in — an email from a verified sender — and a
 * second door would be a second thing to authorise and a second thing to get wrong. If she wants to
 * change her book she sends it, which is the same gesture she already makes.
 *
 * `POST /brokerage-pointer` below is not a second door onto the book. It writes a count, a clock and
 * a word from a two-value list into a table that is structurally incapable of holding a name; it
 * cannot touch `capital_book` and there is nothing about her inventory in its body. See the comment
 * on the handler, and `migrations/0234`.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { currentBook, currentBookLines } from "../capital/book";

export const capital = new Hono<{ Bindings: Env; Variables: Vars }>();

capital.get("/book", async (c) => {
  const live = await currentBook(c.env);
  /*
   * NO BOOK IS AN ANSWER WITH A REASON, NOT AN EMPTY LIST. A caller handed `{ lines: [] }` cannot
   * tell "she has never sent one" from "she has nothing to sell", and those need opposite responses
   * — one is a question for her and the other is a quiet week.
   */
  if (!live) {
    return ok(c, {
      book: null,
      lines: [],
      why: "No live book has ever been filed. Email it to boss@sequoiataylor.com with #monique.",
    });
  }
  const lines = await currentBookLines(c.env);
  const history = await c.env.DB
    .prepare(`SELECT version, received_at, superseded_at FROM capital_book ORDER BY version DESC LIMIT 10`)
    .all<{ version: number; received_at: number; superseded_at: number | null }>();
  return ok(c, {
    book: { ...live, age_days: Math.floor((Date.now() - live.received_at) / 86_400_000) },
    lines,
    // Superseded versions, so the mirror can show what changed rather than only what is current.
    history: history.results ?? [],
  });
});

/**
 * ─── THE POINTER: WORK MONIQUE DID FROM THE LEDGER, ANNOUNCED WITHOUT NAMING ANY OF IT ──────────
 *
 * `npm run capital:match -- --pointer --send` runs on her Mac, reads the 2,145-row interest ledger
 * at `~/.boss-os/capital/ledger.json`, finds the crossings, and EMAILS HER THE DETAIL from
 * monique@sequoiataylor.com — the counterparty, the asset, the size, the next action. That mail is
 * the deliverable. This endpoint exists only so today's contract can say the mail is there.
 *
 * ─── WHAT MAY CROSS, AND WHAT MAY NOT ──────────────────────────────────────
 *
 *   "Named counterparties, assets and sizes never reach the Boss OS database — not code-named,
 *    not counted."
 *
 * So the body is THREE FIELDS AND NO OTHERS: how many, of what kind, and the minute the mail went.
 * Anything else in the body is REFUSED rather than ignored. That distinction is the point: a caller
 * that starts sending `{ asset: "OpenAI" }` must fail loudly on its first run, in a place somebody
 * reads, rather than have the extra field silently dropped for six months until somebody decides to
 * "just store the summary too" and finds the field already arriving.
 *
 * The table behind this cannot hold a name even if this handler were wrong — every column is an
 * INTEGER or a CHECK-constrained enum, and there is no free TEXT column anywhere in it. Two
 * independent refusals, because this is the boundary the owner has stated three times.
 *
 * `validate:pointer-has-no-names` proves both halves offline and fails the build if either is
 * loosened.
 */
capital.post("/brokerage-pointer", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("A pointer needs a body", "Three fields: kind, crossings, sent_at.");
  }

  /*
   * THE ALLOWLIST IS THE GUARD. Not a denylist of name-shaped fields — a denylist would have to
   * anticipate what a future caller calls a counterparty, and it would be wrong the first time
   * somebody used the word "party" or "who" or "top".
   */
  const ALLOWED = ["kind", "crossings", "sent_at"];
  const extra = Object.keys(body).filter((k) => !ALLOWED.includes(k));
  if (extra.length > 0) {
    throw badRequest(
      `A brokerage pointer carries ${ALLOWED.join(", ")} and nothing else; this one also carried ${extra.join(", ")}.`,
      "The interest ledger stays on her Mac. A pointer says how many and when, never who, what or how much.",
    );
  }

  const kind = String(body.kind ?? "");
  if (kind !== "cross" && kind !== "revival") {
    throw badRequest(`"${kind}" is not a kind of pointer`, "kind is 'cross' or 'revival'.");
  }

  const crossings = Number(body.crossings);
  if (!Number.isInteger(crossings) || crossings < 1) {
    /*
     * A ZERO IS NOT A SMALL POINTER, IT IS A WRONG ONE. Her rule is that coming back empty-handed
     * beats noise, and a pointer to an empty mail is noise with a count on it. The local job sends
     * nothing and posts nothing on a quiet day; this refuses the row that would say otherwise.
     */
    throw badRequest(
      "A pointer needs at least one crossing",
      "Nothing worth sending means nothing sent and nothing posted — empty-handed beats noise.",
    );
  }

  const sentAt = Number(body.sent_at);
  if (!Number.isFinite(sentAt) || sentAt <= 0) {
    throw badRequest("A pointer needs the time the mail was sent", "sent_at is epoch milliseconds.");
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO brokerage_pointers (kind, crossings, sent_at, created_at) VALUES (?,?,?,?)`)
    .bind(kind, crossings, sentAt, now)
    .run();

  return ok(c, { recorded: true, kind, crossings });
});
