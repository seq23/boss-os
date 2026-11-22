import type { Env } from "../env";
import { newId } from "../lib/id";
import { confirmAsk } from "../intake/meaning";
import { audit } from "../lib/audit";
import { badRequest, conflict } from "../lib/http";
import {
  LOOKBACK_DAYS, ARCHIVE_DAYS, archiveRows, isDoNotSuggest, parseListEdits, confirmEdit,
} from "../../../shared/boss/capital/partyLists.mjs";
import { partiesReply, rowsForCompany } from "../../../shared/boss/capital/partiesAsk.mjs";
import type { PartiesAsk } from "../../../shared/boss/capital/partiesAsk.mjs";
import type { ListEdit, PartyEntry, PartyList, PartyLists } from "../../../shared/boss/capital/partyLists.mjs";

/**
 * THE DEAL GRID, HER TWO LISTS, AND THE HOLDERS — the D1 half (Boss fix D, 23 Oct 2026).
 *
 * `npm run capital:grid` on her Mac builds the grid from her inbox ledger and pushes it here; the
 * Deals page reads it. Her Rainmaker list and her do-not-suggest list live ONLY here (never in the
 * public repo): seeded from a file outside the repo, and edited by her plain-words replies to any
 * Monique email ("X at Y is Rainmaker", "stop suggesting X"), read by `listEditsFromMail`.
 */

export interface DealRow {
  id: string;
  company: string;
  side: "buy" | "sell" | "yours";
  direction: "buy" | "sell";
  size_usd: number | null;
  size_text: string;
  price_text: string;
  structure_text: string;
  from_text: string;
  rainmaker: number;
  received_on: string;
  email_url: string | null;
  parties: string;
}

export interface HolderRow {
  kind: "nport" | "form_d";
  fund: string;
  manager: string | null;
  value_usd: number | null;
  as_of: string | null;
  filing_url: string;
  contact: string | null;
}

const text = (v: unknown, max: number, dflt = "—") => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : dflt;
};

/** One pushed row, checked field by field. A row that is not a deal is refused, not repaired. */
export function cleanDealRow(r: Record<string, unknown>): DealRow | null {
  const side = String(r.side ?? "");
  const direction = String(r.direction ?? "");
  if (!["buy", "sell", "yours"].includes(side) || !["buy", "sell"].includes(direction)) return null;
  const id = String(r.id ?? "");
  const company = text(r.company, 80, "");
  const received = String(r.received_on ?? "");
  if (!/^[a-f0-9]{8,64}$/i.test(id) || !company || !/^\d{4}-\d{2}-\d{2}$/.test(received)) return null;
  const url = r.email_url == null ? null : String(r.email_url);
  if (url && !/^https:\/\/mail\.google\.com\//.test(url)) return null;
  const size = Number(r.size_usd);
  return {
    id, company, side: side as DealRow["side"], direction: direction as DealRow["direction"],
    size_usd: Number.isFinite(size) && size > 0 ? size : null,
    size_text: text(r.size_text, 40), price_text: text(r.price_text, 60), structure_text: text(r.structure_text, 60),
    from_text: text(r.from_text, 120), rainmaker: r.rainmaker ? 1 : 0, received_on: received,
    email_url: url, parties: String(r.parties ?? "").slice(0, 600),
  };
}

/** Her lists, active entries only. */
export async function activeLists(env: Env): Promise<PartyLists> {
  const rows = await env.DB.prepare(
    `SELECT id, list, kind, value, label FROM capital_party_lists WHERE removed_at IS NULL ORDER BY created_at`,
  ).all<PartyEntry & { list: PartyList }>();
  const all = rows.results ?? [];
  return {
    same_firm: [...all.filter((e) => e.list === "same_firm"), ...((await env.DB.prepare(`SELECT address, name FROM rainmaker_addresses`).all<{ address: string; name: string | null }>()).results ?? []).map((r) => ({ kind: "email" as const, value: r.address, label: r.name }))],
    do_not_suggest: all.filter((e) => e.list === "do_not_suggest"),
  };
}

/** Add or remove one entry. Removal keeps the row (removed_at) so the history survives. */
export async function applyListEdit(env: Env, e: ListEdit, source: "seed" | "reply" | "screen", now = Date.now()): Promise<void> {
  const value = String(e.value).toLowerCase().trim();
  if (e.action === "add") {
    await env.DB.prepare(
      `INSERT INTO capital_party_lists (id, list, kind, value, label, source, created_at, removed_at)
       VALUES (?,?,?,?,?,?,?,NULL)
       ON CONFLICT(list, kind, value) DO UPDATE SET removed_at = NULL, label = excluded.label`,
    ).bind(newId("cpl"), e.list, e.kind, value, e.label ?? null, source, now).run();
  } else {
    await env.DB.prepare(
      // By the value, or by the name she used when she added it ("take Cang off" after "cvq@… is Rainmaker").
      `UPDATE capital_party_lists SET removed_at = ?
        WHERE list = ? AND removed_at IS NULL AND (value = ? OR instr(lower(coalesce(label, '')), ?) > 0)`,
    ).bind(now, e.list, value, value).run();
  }
}

/**
 * Her reply, read for list edits. Null when it holds none — the message then goes on as ordinary
 * mail. `rest` says whether the reply also carried other words, so the caller only stops the
 * message when the edits were all it said.
 */
export async function listEditsFromMail(
  env: Env, body: string, mailId: string, now = Date.now(),
): Promise<{ note: string; edits: ListEdit[]; onlyEdits: boolean } | null> {
  const found = parseListEdits(body);
  if (found.length === 0) return null;
  /*
   * MEANING BY THE MODEL (eng sweep row 7b): the words found the list and the name; the model reads whether she
   * asks for it. Not asked: the line is ordinary mail. Unsure: nothing changes and she is asked. Model down: the
   * words act, logged (`meaning_keyword_fallback`).
   */
  const her = String(body).split(/\r?\n(?:>|On .+wrote:)/)[0] ?? "";
  const edits: ListEdit[] = [];
  const unsure: ListEdit[] = [];
  let skipped = 0;
  for (const e of found) {
    const said = await confirmAsk(env, {
      what: "her list edit", about: "This is the owner's email to her deal team, which keeps a Rainmaker list and a do-not-suggest list.",
      change: listChangeWords(e), text: her, mailId, now,
    });
    if (said === "act") edits.push(e); else if (said === "ask") unsure.push(e); else skipped += 1;
  }
  if (edits.length === 0 && unsure.length === 0) return null;
  for (const e of edits) await applyListEdit(env, e, "reply", now);
  await audit(env.DB, {
    actor: "owner", lane: "ops", entityType: "inbound_mail", entityId: mailId, action: "party_list_edited",
    detail: { edits: edits.map((e) => ({ list: e.list, action: e.action, kind: e.kind })) },
  });
  const above = String(body).split(/\r?\n(?:>|On .+wrote:)/)[0] ?? "";
  const other = above.split(/\r?\n/).map((l) => l.trim()).filter((l) => l
    && parseListEdits(l).length === 0
    && !/^(hi|hey|hello|thanks|thank you|thx|ty|best|sequoia|s|-+|—.*)[,.!]?$/i.test(l));
  const asks = unsure.map((e) => `I could not tell whether you want this, so nothing changed: ${listChangeWords(e)}. Reply with it on its own line if you do.`);
  return { note: [...edits.map(confirmEdit), ...asks].join("\n"), edits, onlyEdits: other.length === 0 && skipped === 0 };
}

/** One edit in plain words, for the model and for her. Pure. */
export function listChangeWords(e: ListEdit): string {
  const who = e.label || e.value;
  if (e.list === "same_firm") return e.action === "add" ? `count ${who} as Rainmaker` : `take ${who} off the Rainmaker list`;
  return e.action === "add" ? `never suggest ${who} again` : `suggest ${who} again`;
}

/**
 * A WHOLE-OR-NOTHING REPLACE (eng sweep row 10, 22 Nov 2026). The grid and the Matches arrive from
 * her Mac in parts of up to 500. Each part is staged under its push id; the LAST part swaps the
 * staged set in with ONE D1 batch, which is one SQL transaction: the live delete and the copy are
 * both guarded on the staged count equalling the total the Mac declared, so a missing part, a
 * lying total or a failure on any statement leaves the previous grid exactly as it was.
 * A replace of zero rows is refused unless the route sets `allowEmpty`: the grid route never does, and
 * the Matches route only just after a grid push was saved (`routes/capital.ts`).
 */
export interface PushPart { push: string; total: number; last: boolean; allowEmpty: boolean }

const STALE_STAGE_MS = 86_400_000;

/** The push fields of a request body. A body with no `push` is one whole push in one part. */
export function pushPart(body: Record<string, unknown>, rowsInBody: number): PushPart {
  const total = Number(body.total);
  if (!Number.isInteger(total) || total < 0) {
    throw badRequest("A replace needs the whole push's row count", "{ total: <rows in the whole push>, push?: <id>, last?: true }");
  }
  const push = body.push == null ? "" : String(body.push);
  if (push && !/^[a-z0-9_-]{8,64}$/i.test(push)) throw badRequest("A push id is 8-64 letters, digits, - or _", "{ push: <id> }");
  if (!push && rowsInBody !== total) {
    throw conflict(`A one-part push carries all ${total} row(s); this one has ${rowsInBody}`, "Send every part under one push id, last: true on the final one.");
  }
  return { push: push || newId("push"), total, last: push ? body.last === true : true, allowEmpty: body.allowEmpty === true };
}

/**
 * One staged table. The swap's two live statements are written out whole, so a search for who
 * writes the live table finds them; both are guarded on the staged count (?1 push, ?2 total).
 */
interface StagedTable { live: string; staging: string; cols: readonly string[]; stage: string; clear: string; copy: string }

const WHOLE = (staging: string) => `(SELECT COUNT(*) FROM ${staging} WHERE push_id = ?1) = ?2`;
const DEAL_COLS = ["id", "company", "side", "direction", "size_usd", "size_text", "price_text", "structure_text", "from_text",
  "rainmaker", "received_on", "email_url", "parties"] as const;
export const DEALS_TABLE: StagedTable = {
  live: "capital_deal_rows", staging: "capital_deal_rows_staging", cols: DEAL_COLS,
  stage: `INSERT OR REPLACE INTO capital_deal_rows_staging (push_id, ${DEAL_COLS.join(", ")}, staged_at) VALUES `,
  clear: `DELETE FROM capital_deal_rows WHERE ${WHOLE("capital_deal_rows_staging")}`,
  copy: `INSERT OR REPLACE INTO capital_deal_rows (${DEAL_COLS.join(", ")}, updated_at)
           SELECT ${DEAL_COLS.join(", ")}, ?3 FROM capital_deal_rows_staging WHERE push_id = ?1 AND ${WHOLE("capital_deal_rows_staging")}`,
};
export const MATCHES_TABLE: StagedTable = {
  live: "capital_matches", staging: "capital_matches_staging", cols: ["key", "company", "rank", "payload"],
  stage: "INSERT OR REPLACE INTO capital_matches_staging (push_id, key, company, rank, payload, staged_at) VALUES ",
  clear: `DELETE FROM capital_matches WHERE ${WHOLE("capital_matches_staging")}`,
  copy: `INSERT OR REPLACE INTO capital_matches (key, company, rank, payload, updated_at)
           SELECT key, company, rank, payload, ?3 FROM capital_matches_staging WHERE push_id = ?1 AND ${WHOLE("capital_matches_staging")}`,
};

/**
 * Stage one part, and on the last part swap the whole push in. Returns the rows now live (the
 * total) on a commit, or null while parts are still arriving. `after` runs in the same batch.
 */
export async function stagedReplace(
  env: Env, t: StagedTable, part: PushPart, rows: readonly (readonly unknown[])[], now: number,
  after: D1PreparedStatement[] = [],
): Promise<number | null> {
  if (part.last && part.total === 0 && !part.allowEmpty) {
    throw badRequest(`Refused: a replace of ${t.live} with zero rows`, "An empty replace needs allowEmpty: true; the previous rows are kept.");
  }
  // One id (or match key) once per push. Staging is keyed on it, so a repeat would collapse two rows
  // into one and every later push would read "N-1 of N arrived": refused by name instead.
  const ids = new Set(rows.map((r) => String(r[0])));
  if (ids.size !== rows.length) throw badRequest(`DUPLICATE_ID: ${rows.length - ids.size} row(s) repeat an ${t.cols[0]} in this part; ${t.live} is unchanged`, `Send each ${t.cols[0]} once per push.`);
  const before = await stagedCount(env, t, part.push);
  const width = t.cols.length + 2; // + push_id, staged_at
  const perStmt = Math.max(1, Math.floor(100 / width)); // D1 binds at most 100 parameters per statement
  const stage: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += perStmt) {
    const chunk = rows.slice(i, i + perStmt);
    const marks = chunk.map(() => `(${Array(width).fill("?").join(",")})`).join(",");
    stage.push(env.DB.prepare(t.stage + marks)
      .bind(...chunk.flatMap((r) => [part.push, ...r, now])));
  }
  for (let i = 0; i < stage.length; i += 100) await env.DB.batch(stage.slice(i, i + 100));
  const staged = await stagedCount(env, t, part.push);
  if (staged !== before + rows.length) {
    throw badRequest(`DUPLICATE_ID: this part repeats ${before + rows.length - staged} ${t.cols[0]}(s) sent in an earlier part; ${t.live} is unchanged`, `Send each ${t.cols[0]} once per push, under a new push id.`);
  }
  if (!part.last) return null;
  if (staged !== part.total) {
    throw conflict(`Push incomplete: ${staged} of ${part.total} row(s) arrived; ${t.live} is unchanged`, "Send every part again under a new push id.");
  }
  return swapWhole(env, t, part, now, after);
}

const stagedCount = async (env: Env, t: StagedTable, push: string): Promise<number> =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t.staging} WHERE push_id = ?`).bind(push).first<{ n: number }>())?.n ?? 0;

/**
 * The swap, one D1 batch (one transaction). Both live statements carry the staged-count guard in
 * SQL, so a count that changed after the check above clears nothing and copies nothing. Returns the
 * rows the copy really wrote; anything but the total is refused, never reported as a commit.
 */
export async function swapWhole(env: Env, t: StagedTable, part: PushPart, now: number, after: D1PreparedStatement[] = []): Promise<number> {
  const res = await env.DB.batch([
    env.DB.prepare(t.clear).bind(part.push, part.total),
    env.DB.prepare(t.copy).bind(part.push, part.total, now),
    ...after,
    env.DB.prepare(`DELETE FROM ${t.staging} WHERE push_id = ? OR staged_at < ?`).bind(part.push, now - STALE_STAGE_MS),
  ]);
  const copied = Number(res[1]?.meta?.changes ?? 0);
  if (copied !== part.total) throw conflict(`Push not swapped in: ${copied} of ${part.total} row(s) copied; ${t.live} is unchanged`, "Send every part again under a new push id.");
  return copied;
}

/** Replace the grid (whole or not at all), and drop anything past her twelve-month window. */
export async function storeDeals(env: Env, rows: DealRow[], part: PushPart, now = Date.now()): Promise<number | null> {
  // Past twelve months a row leaves even the Archive view; her Mac's ledger keeps every one.
  const cutoff = new Date(now - ARCHIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return stagedReplace(env, DEALS_TABLE, part, rows.map((r) => DEAL_COLS.map((c) => r[c])), now,
    [env.DB.prepare(`DELETE FROM capital_deal_rows WHERE received_on < ?`).bind(cutoff)]);
}

/** The grid as the page shows it: inside the window, nobody she has ruled out, newest first. */
export async function dealGrid(env: Env, now = Date.now()) {
  // The main grid is the lookback; the Archive is lookback → twelve months (owner, 24 Oct 2026).
  const cutoff = new Date(now - ARCHIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const openFrom = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT id, company, side, direction, size_usd, size_text, price_text, structure_text, from_text,
            rainmaker, received_on, email_url, parties, updated_at
       FROM capital_deal_rows WHERE received_on >= ? ORDER BY received_on DESC, size_usd DESC`,
  ).bind(cutoff).all<DealRow & { updated_at: number }>();
  const lists = await activeLists(env);
  const rows = (res.results ?? []).filter((r) => !isDoNotSuggest({ parties: r.parties, from_text: r.from_text }, lists))
    .map(({ parties: _p, ...rest }) => rest);
  const updated = rows.reduce((n, r) => Math.max(n, r.updated_at ?? 0), 0);
  const open = rows.filter((r) => r.received_on >= openFrom);
  const archive = archiveRows(rows, now);
  return { rows: open, archive, counts: { open: open.length, archived: archive.length }, lookback_days: LOOKBACK_DAYS, archive_days: ARCHIVE_DAYS, updated_at: updated || null };
}

/**
 * "Find all buyers of <company>" from her email (5 Nov 2026): the twelve-month window with the
 * do-not-suggest list applied, people kept, for `partiesReply`. Null when the grid never names the
 * company, so an ask that is not about her deals goes to the ordinary triage.
 */
export async function partiesAnswer(env: Env, ask: PartiesAsk, now = Date.now()): Promise<{ reply: string; count: number } | null> {
  const cutoff = new Date(now - ARCHIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT company, side, size_text, price_text, from_text, received_on, parties
       FROM capital_deal_rows WHERE received_on >= ? AND side IN ('buy','sell')`,
  ).bind(cutoff).all<DealRow>();
  const named = rowsForCompany(res.results ?? [], ask.company);
  if (named.length === 0) return null;
  const lists = await activeLists(env);
  const rows = named.filter((r) => !isDoNotSuggest({ parties: r.parties, from_text: r.from_text }, lists));
  return { reply: partiesReply(ask, rows, now), count: rows.filter((r) => r.side === ask.side).length };
}

/** The holders for one company, replaced as a set. */
export async function storeHolders(env: Env, company: string, holders: HolderRow[], now = Date.now()): Promise<number> {
  const stmts = [env.DB.prepare(`DELETE FROM capital_holders WHERE company = ?`).bind(company)];
  for (const h of holders) {
    stmts.push(env.DB.prepare(
      `INSERT INTO capital_holders (id, company, kind, fund, manager, value_usd, as_of, filing_url, contact, found_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(newId("chd"), company, h.kind, h.fund, h.manager, h.value_usd, h.as_of, h.filing_url, h.contact, now));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return holders.length;
}

export function cleanHolder(h: Record<string, unknown>): HolderRow | null {
  const kind = h.kind === "form_d" ? "form_d" : "nport";
  const fund = text(h.fund, 160, "");
  const url = String(h.filing_url ?? "");
  if (!fund || !/^https:\/\/www\.sec\.gov\//.test(url)) return null;
  const v = Number(h.value_usd);
  return {
    kind, fund, manager: h.manager ? text(h.manager, 160) : null,
    value_usd: Number.isFinite(v) && v > 0 ? v : null,
    as_of: h.as_of ? text(h.as_of, 20) : null, filing_url: url.slice(0, 400),
    contact: h.contact ? text(h.contact, 120) : null,
  };
}

export async function holdersList(env: Env) {
  const res = await env.DB.prepare(
    `SELECT company, kind, fund, manager, value_usd, as_of, filing_url, contact, found_at
       FROM capital_holders ORDER BY company, value_usd DESC`,
  ).all<HolderRow & { company: string; found_at: number }>();
  const lists = await activeLists(env);
  return (res.results ?? []).filter((h) => !isDoNotSuggest({ principal: h.fund, from_text: h.manager ?? "" }, lists));
}
