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
import {
  activeLists, applyListEdit, cleanDealRow, cleanHolder, dealGrid, holdersList, storeDeals, storeHolders,
  type DealRow, type HolderRow,
} from "../capital/grid";
import { targetOf, confirmEdit } from "../../../shared/boss/capital/partyLists.mjs";
import type { ListEdit } from "../../../shared/boss/capital/partyLists.mjs";

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

// ─── boss fix D: the deal grid, her two lists, the holders (23 Oct 2026) ─────────────────────────
//
// The Deals page reads these; `npm run capital:grid` on her Mac writes the grid and the holders.
// Behind the same session as every other Boss OS route. See src/worker/boss/capital/grid.ts.

capital.get("/deals", async (c) => ok(c, await dealGrid(c.env)));

capital.post("/deals", async (c) => {
  const body = await c.req.json<{ rows?: unknown[]; replace?: boolean }>().catch(() => null);
  if (!body || !Array.isArray(body.rows)) throw badRequest("A grid push needs rows", "{ rows: [...], replace: true|false }");
  if (body.rows.length > 2000) throw badRequest("At most 2,000 rows per push", "Send the grid in batches.");
  const rows = body.rows.map((r) => cleanDealRow((r ?? {}) as Record<string, unknown>));
  const bad = rows.filter((r) => r === null).length;
  if (bad > 0) throw badRequest(`${bad} row(s) are not deals`, "Each row needs id, company, side, direction, received_on and a Gmail link or none.");
  const stored = await storeDeals(c.env, rows as DealRow[], body.replace === true);
  return ok(c, { stored });
});

/** Every current match (24 Oct 2026), best first — the Matches screen. Written whole by her Mac. */
capital.get("/matches", async (c) => {
  const r = await c.env.DB.prepare(`SELECT payload, updated_at FROM capital_matches ORDER BY rank ASC LIMIT 2000`).all<{ payload: string; updated_at: number }>();
  const rows = (r.results ?? []).map((x) => { try { return JSON.parse(x.payload); } catch { return null; } }).filter(Boolean);
  return ok(c, { matches: rows, updated_at: (r.results ?? []).reduce((n, x) => Math.max(n, x.updated_at), 0) || null });
});

capital.post("/matches", async (c) => {
  const body = await c.req.json<{ matches?: unknown[]; replace?: boolean; offset?: number }>().catch(() => null);
  if (!body || !Array.isArray(body.matches)) throw badRequest("A matches push needs matches", "{ matches: [...], replace: true|false, offset }");
  if (body.matches.length > 500) throw badRequest("At most 500 matches per push", "Send them in batches.");
  const now = Date.now();
  const offset = Number(body.offset ?? 0) || 0;
  const stmts: D1PreparedStatement[] = body.replace ? [c.env.DB.prepare(`DELETE FROM capital_matches`)] : [];
  body.matches.forEach((m: any, i: number) => {
    const key = String(m?.key ?? "").slice(0, 120);
    const company = String(m?.company ?? "").slice(0, 120);
    if (!key || !company) return;
    stmts.push(c.env.DB.prepare(`INSERT OR REPLACE INTO capital_matches (key, company, rank, payload, updated_at) VALUES (?,?,?,?,?)`)
      .bind(key, company, offset + i, JSON.stringify(m).slice(0, 20000), now));
  });
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return ok(c, { stored: stmts.length - (body.replace ? 1 : 0) });
});

capital.get("/lists", async (c) => ok(c, await activeLists(c.env)));

/** Add or remove one entry by hand (the seed script, or the page). Her replies use the mail path. */
capital.post("/lists", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const list = String(body?.list ?? "");
  const action = String(body?.action ?? "");
  if (!["same_firm", "do_not_suggest"].includes(list) || !["add", "remove"].includes(action)) {
    throw badRequest("Which list, and add or remove?", "{ list: same_firm|do_not_suggest, action: add|remove, who: \"...\" }");
  }
  const t = targetOf(String(body?.who ?? ""));
  if (!t) throw badRequest("Nobody named", "who is an address, a domain, or a person's name.");
  const source = body?.source === "seed" ? "seed" : "screen";
  const edit = { list, action, ...t } as ListEdit;
  await applyListEdit(c.env, edit, source);
  return ok(c, { done: confirmEdit(edit) });
});

capital.get("/holders", async (c) => ok(c, { holders: await holdersList(c.env) }));

capital.post("/holders", async (c) => {
  const body = await c.req.json<{ company?: string; holders?: unknown[] }>().catch(() => null);
  const company = String(body?.company ?? "").trim().slice(0, 80);
  if (!company || !Array.isArray(body?.holders)) throw badRequest("Holders need a company and a list", "{ company, holders: [...] }");
  const holders = body.holders.map((h) => cleanHolder((h ?? {}) as Record<string, unknown>)).filter(Boolean) as HolderRow[];
  return ok(c, { stored: await storeHolders(c.env, company, holders.slice(0, 1000)) });
});
