/**
 * WHAT SHE HAS OUT, READ FROM HER INBOX FIRST — THE BOOK IS AN OPTIONAL EXTRA (owner, 26 Oct 2026).
 *
 * Her ruling, 26 Oct 2026: "Yes, inbox only." Monique works from the inbox deal flow — the deal grid
 * built from her own mail (`interest-grid.mjs`, "Yours: seller" / "Yours: buyer" rows) — and the
 * "send me your book" reminder is retired. It replaces the 10 Sep 2026 rule ("If she does not send a
 * book for 7 days, Monique must ASK HER for it"), which put "Your live book is 40 days old … Monique
 * is still working v3 and has now asked three times" at the top of Today.
 *
 * A book she emails to boss@ with #monique is still accepted and parsed (`liveBook.mjs`, the same
 * intake as before) and joins the grid and the hunts as an EXTRA source: never required, never
 * asked for, and its age never raises anything. Pinned by `tests/inboxOnlyBook.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { CAPITAL_DIR, BOOK_JSON } from "./book-mirror.mjs";
import { buildGrid, loadIdentity } from "../interest-grid.mjs";

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/** Her own lots on one side from the inbox grid (`ledger.json`), as the hunts consume positions. */
export function inboxLots(side, { dir = CAPITAL_DIR, now = Date.now() } = {}) {
  const ledger = readJson(path.join(dir, "ledger.json"), null);
  if (!ledger?.interests?.length) return [];
  const lists = readJson(path.join(dir, "party-lists.json"), { same_firm: [], do_not_suggest: [] });
  let identity;
  try { identity = loadIdentity(path.join(dir, "self.json")); } catch { return []; }
  const grid = buildGrid(ledger.interests, { identity, lists, now });
  const seen = new Set();
  const out = [];
  for (const g of grid) {
    if (g.side !== "yours" || g.direction !== side) continue;
    const k = String(g.company).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ asset: g.company, side, size_usd: g.size_usd, size_min_usd: null, size_max_usd: null, size_shares: null, size_text: g.size_text === "—" ? "" : g.size_text, source_line: `inbox ${g.received_on}` });
  }
  return out;
}

/**
 * The lots a hunt works: the inbox grid's, plus any the optional book adds. `null` only when BOTH are
 * empty — a named stop that says there is nothing of hers on that side, and never asks for a book.
 */
export function herLots(side, { book = null, dir = CAPITAL_DIR, now = Date.now() } = {}) {
  const inbox = inboxLots(side, { dir, now });
  const have = new Set(inbox.map((p) => p.asset.toLowerCase()));
  const extra = (book?.positions ?? []).filter((p) => p.side === side && !have.has(String(p.asset).toLowerCase()));
  const positions = [...inbox, ...extra];
  if (!positions.length) return null;
  return {
    positions, unparsed: [],
    source: `the inbox grid (${inbox.length} of yours)${extra.length ? ` plus ${extra.length} from ${book?.source ?? "your book"}` : ""}`,
  };
}

/** The book mirror as written by `capital-book.mjs --pull`, raw, or null. */
export const rawBookMirror = (file = BOOK_JSON) => readJson(file, null);
