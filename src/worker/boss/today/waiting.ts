import type { Env } from "../env";
import { daysBetween } from "../practice/lapse";

/**
 * STILL WAITING ON YOU — EVERY UNANSWERED DECIDE ITEM, ACROSS MORNINGS (owner, Today v4, 31 Oct 2026).
 *
 * Until v4 Today read only the newest morning (`morning_digests ORDER BY day DESC LIMIT 1`), so an
 * item a producer stopped re-sending — a reply to an LP who had waited a week — fell off the page
 * while it was still hers to answer. Now every morning kept in the last `CARRY_DAYS` is read:
 *
 *   - one item per morning id (`decide-…`, stable across mornings), the NEWEST full copy kept;
 *   - "waiting N days" counts from the FIRST morning it appeared in;
 *   - it stays until it is answered (on any morning's copy, or underneath: the reply went) or
 *     dismissed (`decide_dismissed`);
 *   - "Not now" is a tick (`notnow:<id>`) for today only: tomorrow it is back.
 *
 * WHAT NEVER CARRIES: what is already handled underneath. A reply already sent, skipped or
 * scheduled (`lp_reply_drafts.status`); an errand she took over herself (`boss_commands` done); a
 * prospect template no longer waiting; and buyer/seller match cards, which belong to the deal grid
 * (CLAUDE.md "No match goes to Decide").
 *
 * NAMES STAY HERE. This module feeds her own screen; the coach is told counts only
 * (`today/coachQuestion.ts`), never these titles.
 */

export const CARRY_DAYS = 45;

export interface WaitingReply {
  lp_id: string;
  /** The held reply, word for word, when it can be sent as is (its words are on the row). */
  text: string | null;
  can_send: boolean;
  /** Why it cannot be sent from here, in one sentence, when it cannot. */
  why: string | null;
  /** The one-tap page (the morning email's "Send as is"); only for the email, never shown on Today. */
  tap_token: string | null;
}

export interface WaitingItem {
  id: string;
  key: string | null;
  title: string;
  body: string;
  from: string;
  first_day: string;
  newest_day: string;
  days: number;
  href: string;
  reply: WaitingReply | null;
  /** Wealth (LP / investor) items sit in the Wealth block's Core business on their first morning. */
  wealth: boolean;
}

const json = <T,>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string" || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

/** "Waiting 17 days: Answer Kenneth: they wrote back…" → "Answer Kenneth: they wrote back…". */
export const cleanTitle = (t: string) => String(t ?? "").replace(/^Waiting \d+ days?:\s*/i, "").trim();

export const isWealthItem = (d: { title?: string; body?: string; from?: string; key?: string | null }) =>
  d.from === "lp" || /^lp(-again)?:/.test(String(d.key ?? "")) ||
  /\bLPs?\b|investor|fundrais|capital call|commit(ment)? to (the|our) fund/i.test(`${d.title ?? ""} ${d.body ?? ""}`);

/** A buyer/seller match card: the grid's, never Decide's (CLAUDE.md, Deals rule 6). */
export const isMatchCard = (d: { title?: string; from?: string; key?: string | null }) =>
  d.from === "monique_found" || /^match:/.test(String(d.key ?? "")) || /\ba buyer and a seller\b/i.test(String(d.title ?? ""));

/** Who an LP card is about, by its key or (a morning kept before keys were) the name in its title. */
function lpNameOf(title: string): { name: string; again: boolean } | null {
  const m = /^(Reply to|Answer)\s+(.+?)(?:\s+at\s+[^:]+)?(?::.*)?$/i.exec(cleanTitle(title));
  return m ? { name: m[2]!.trim(), again: /^answer/i.test(m[1]!) } : null;
}

interface Raw { id: string; key: string | null; title: string; body: string; from: string; first: string; newest: string; full: boolean; answered: boolean }

/** Pure: fold the kept mornings (oldest first) into one record per item id. */
export function foldMornings(mornings: { day: string; decide: any[]; still: any[] }[]): Map<string, Raw> {
  const out = new Map<string, Raw>();
  for (const m of [...mornings].sort((a, b) => a.day.localeCompare(b.day))) {
    for (const d of m.decide ?? []) {
      if (!d?.id || !d?.title) continue;
      const r = out.get(d.id);
      out.set(d.id, {
        id: d.id, key: d.key ?? r?.key ?? null, title: cleanTitle(d.title), body: String(d.body ?? r?.body ?? ""),
        from: String(d.from ?? r?.from ?? "boss"), first: r?.first ?? m.day, newest: m.day, full: true,
        answered: Boolean(r?.answered || d.answered_at),
      });
    }
    for (const s of m.still ?? []) {
      if (!s?.id) continue;
      const r = out.get(s.id);
      out.set(s.id, r
        ? { ...r, newest: m.day }
        : { id: s.id, key: null, title: cleanTitle(s.title ?? s.line ?? ""), body: "", from: /\(LP\)/.test(String(s.line ?? "")) ? "lp" : "boss", first: m.day, newest: m.day, full: false, answered: false });
    }
  }
  return out;
}

export async function waitingOnYou(env: Env, today: string, opts: { includeSnoozed?: boolean } = {}): Promise<{ items: WaitingItem[]; latest: string | null }> {
  const db = env.DB;
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - CARRY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [mornR, disR, snzR, lpR, errR, tplR] = await db.batch([
    db.prepare(`SELECT day, json_extract(payload, '$.decide') AS decide, json_extract(payload, '$.still_yours') AS still FROM morning_digests WHERE day >= ? ORDER BY day ASC`).bind(since),
    db.prepare(`SELECT item_id FROM decide_dismissed`),
    db.prepare(`SELECT item_key FROM today_ticks WHERE day_id = ? AND item_key LIKE 'notnow:%'`).bind(today),
    db.prepare(`SELECT id, address, name, status, decision, draft_id, draft_message_id, draft_body, tap_token, thread_id, reply_from FROM lp_reply_drafts`),
    db.prepare(`SELECT id, state, lower(json_extract(spec, '$.to')) AS addr FROM boss_commands WHERE kind = 'errand'`),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_templates WHERE status = 'pending'`),
  ]);
  const mornings = ((mornR?.results ?? []) as { day: string; decide: string | null; still: string | null }[])
    .map((r) => ({ day: r.day, decide: json<any[]>(r.decide, []), still: json<any[]>(r.still, []) }));
  const latest = mornings.length ? mornings[mornings.length - 1]!.day : null;
  const dismissed = new Set(((disR?.results ?? []) as { item_id: string }[]).map((r) => r.item_id));
  const snoozed = new Set(((snzR?.results ?? []) as { item_key: string }[]).map((r) => r.item_key.slice("notnow:".length)));
  const lps = (lpR?.results ?? []) as any[];
  const errands = (errR?.results ?? []) as { id: string; state: string; addr: string | null }[];
  const templatePending = (((tplR?.results?.[0] ?? {}) as { n?: number }).n ?? 0) > 0;

  const lpOf = (r: Raw) => {
    const k = /^lp(?:-again)?:(.+)$/.exec(r.key ?? "")?.[1];
    if (k) return lps.find((x) => x.id === k || x.address === k.toLowerCase()) ?? null;
    const n = lpNameOf(r.title);
    return n ? lps.find((x) => x.name && x.name.toLowerCase() === n.name.toLowerCase()) ?? null : null;
  };

  const items: WaitingItem[] = [];
  const perLp = new Map<string, WaitingItem>();
  for (const r of foldMornings(mornings).values()) {
    if (r.answered || dismissed.has(r.id)) continue;
    if (!opts.includeSnoozed && snoozed.has(r.id)) continue;
    if (isMatchCard(r)) continue;
    // A prospect template card: only while a template is actually waiting for her.
    if (/^prospect-template:/.test(r.key ?? "") || /^Approve the prospect email/i.test(r.title)) {
      if (!templatePending || r.newest !== latest) continue;
    }
    // An errand she took over (or one that finished) is handled.
    const errandAddr = /^([^\s<>]+@[^\s<>]+)\s+(?:wants a card|answered your request)/i.exec(r.title)?.[1]?.toLowerCase();
    const errandId = /^errand:(cmd_[a-z0-9_]+)$/i.exec(r.key ?? "")?.[1];
    if (errandAddr || errandId) {
      const mine = errands.filter((e) => (errandId ? e.id === errandId : e.addr === errandAddr));
      if (!mine.length || mine.every((e) => ["done", "cancelled", "failed"].includes(e.state))) continue;
    }
    let reply: WaitingReply | null = null;
    const lpCard = r.from === "lp" || /^lp(-again)?:/.test(r.key ?? "");
    if (lpCard) {
      const row = lpOf(r);
      if (row) {
        // Handled underneath: the reply went, was skipped, or is scheduled to go.
        if (["sent", "skipped", "scheduled"].includes(row.status)) continue;
        const sendable = Boolean(row.draft_id && row.draft_body && row.draft_message_id && row.tap_token)
          && (row.status === "drafted" || row.status === "replied_again");
        reply = {
          lp_id: row.id,
          text: sendable ? String(row.draft_body) : null,
          can_send: sendable,
          why: sendable ? null : row.thread_id ? "No reply is ready in their thread yet. Change it to write one; it waits for your tap." : "Their thread could not be found, so nothing can be sent from here.",
          tap_token: sendable ? row.tap_token : null,
        };
      }
    }
    const item: WaitingItem = {
      id: r.id, key: r.key, title: r.title, body: r.body.split(/(?<=[.!?])\s/)[0] ?? "", from: r.from,
      first_day: r.first, newest_day: r.newest, days: Math.max(0, daysBetween(r.first, today)),
      href: `/?morning=${encodeURIComponent(r.newest)}&item=${encodeURIComponent(r.id)}`,
      reply, wealth: isWealthItem(r),
    };
    // One person, one line: an LP's "Reply to" and "Answer" cards are one conversation.
    if (reply) {
      const prev = perLp.get(reply.lp_id);
      if (prev) {
        // Keep the older start (they have waited since then) and the newer card.
        const keep = prev.newest_day >= item.newest_day ? prev : item;
        keep.first_day = prev.first_day < item.first_day ? prev.first_day : item.first_day;
        keep.days = Math.max(prev.days, item.days);
        perLp.set(reply.lp_id, keep);
        continue;
      }
      perLp.set(reply.lp_id, item);
      continue;
    }
    items.push(item);
  }
  items.push(...perLp.values());
  items.sort((a, b) => b.days - a.days || a.title.localeCompare(b.title));
  return { items, latest };
}
