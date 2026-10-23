import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import {
  LOOKBACK_DAYS, isDoNotSuggest, parseListEdits, confirmEdit,
} from "../../../shared/boss/capital/partyLists.mjs";
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
    same_firm: all.filter((e) => e.list === "same_firm"),
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
  const edits = parseListEdits(body);
  if (edits.length === 0) return null;
  for (const e of edits) await applyListEdit(env, e, "reply", now);
  await audit(env.DB, {
    actor: "owner", lane: "ops", entityType: "inbound_mail", entityId: mailId, action: "party_list_edited",
    detail: { edits: edits.map((e) => ({ list: e.list, action: e.action, kind: e.kind })) },
  });
  const above = String(body).split(/\r?\n(?:>|On .+wrote:)/)[0] ?? "";
  const other = above.split(/\r?\n/).map((l) => l.trim()).filter((l) => l
    && parseListEdits(l).length === 0
    && !/^(hi|hey|hello|thanks|thank you|thx|ty|best|sequoia|s|-+|—.*)[,.!]?$/i.test(l));
  return { note: edits.map(confirmEdit).join("\n"), edits, onlyEdits: other.length === 0 };
}

/** Replace (or add to) the grid, and drop anything older than her ~6-month window. */
export async function storeDeals(env: Env, rows: DealRow[], replace: boolean, now = Date.now()): Promise<number> {
  const stmts = [];
  if (replace) stmts.push(env.DB.prepare(`DELETE FROM capital_deal_rows`));
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      `INSERT OR REPLACE INTO capital_deal_rows
         (id, company, side, direction, size_usd, size_text, price_text, structure_text, from_text,
          rainmaker, received_on, email_url, parties, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(r.id, r.company, r.side, r.direction, r.size_usd, r.size_text, r.price_text, r.structure_text,
      r.from_text, r.rainmaker, r.received_on, r.email_url, r.parties, now));
  }
  const cutoff = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  stmts.push(env.DB.prepare(`DELETE FROM capital_deal_rows WHERE received_on < ?`).bind(cutoff));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return rows.length;
}

/** The grid as the page shows it: inside the window, nobody she has ruled out, newest first. */
export async function dealGrid(env: Env, now = Date.now()) {
  const cutoff = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT id, company, side, direction, size_usd, size_text, price_text, structure_text, from_text,
            rainmaker, received_on, email_url, parties, updated_at
       FROM capital_deal_rows WHERE received_on >= ? ORDER BY received_on DESC, size_usd DESC`,
  ).bind(cutoff).all<DealRow & { updated_at: number }>();
  const lists = await activeLists(env);
  const rows = (res.results ?? []).filter((r) => !isDoNotSuggest({ parties: r.parties, from_text: r.from_text }, lists))
    .map(({ parties: _p, ...rest }) => rest);
  const updated = rows.reduce((n, r) => Math.max(n, r.updated_at ?? 0), 0);
  return { rows, lookback_days: LOOKBACK_DAYS, updated_at: updated || null };
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
