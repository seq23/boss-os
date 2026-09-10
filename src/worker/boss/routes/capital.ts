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
 * ─── READ ONLY, AND DELIBERATELY NO WRITE ──────────────────────────────────
 *
 * There is no POST here. The book has exactly one way in — an email from a verified sender — and a
 * second door would be a second thing to authorise and a second thing to get wrong. If she wants to
 * change her book she sends it, which is the same gesture she already makes.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok } from "../lib/http";
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
