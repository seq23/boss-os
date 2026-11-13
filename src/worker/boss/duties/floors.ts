import type { Env } from "../env";
import type { FloorVerdict } from "./briefingSpec";

/*
 * ─── THE FLOORS: THE FINISHED WORK IS CHECKED WHERE IT IS DELIVERED (owner, 13 Nov 2026) ─────────
 *
 * "i want all of this to be perfect figure out how ot make sure my briefs get wrriten to the
 * impeccable standard we have had". The review that day found that what makes work worse is not
 * which route wrote it but that nothing checked the finished work: backlink prospecting had
 * delivered zero rows ever and every run was "succeeded"; a tools run lost 23 tools to an invalid
 * delivers.json and was auto-accepted; three research pages were stored "delivered" with no source.
 *
 * One floor per deliverable, run on the REAL output by the route that receives it
 * (routes/backends.ts /report). A miss is a FAILED run of that route for that job kind: the run is
 * handed to a stronger seat when its ladder has one (`ladder_release`), and two misses in a row move
 * the kind up a rung (seatOrder.ts `seatFailedTwice`), with no model named anywhere. The briefing's
 * own floor is briefingSpec.ts `briefingFloor`, graded by `assessBriefing`.
 */

export type { FloorVerdict } from "./briefingSpec";

export interface Reach { reachable: number; answered: number; checked: number; dead: string[] }

/**
 * DOES A CITED SOURCE ANSWER A PLAIN GET? Any answer that is not "gone" counts, a bot wall's 403 and
 * a rate limit's 429 included: the page exists and a person can open it. 404, 410 and a server error
 * do not, and neither does a silence. A local file path, or anything that is not http(s), is not a
 * source and is never fetched. Bounded: at most `max` fetches, `timeoutMs` each, and it stops asking
 * once `need` have answered. `answered` is how many gave ANY response; zero means the check itself
 * was blind (no network), and callers must not read that as "every source is dead".
 */
export async function sourcesReachable(
  urls: unknown[],
  o: { need?: number; max?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Reach> {
  const list = [...new Set(urls.map((u) => (typeof u === "string" ? u.trim() : "")).filter((u) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u)))];
  const max = o.max ?? 40;
  const need = o.need ?? list.length;
  const doFetch = o.fetchImpl ?? fetch;
  const out: Reach = { reachable: 0, answered: 0, checked: 0, dead: [] };
  const queue = list.slice(0, max);
  const one = async (url: string) => {
    out.checked++;
    try {
      const res = await doFetch(url, {
        method: "GET", redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; source-check/1.0)", accept: "text/html,*/*" },
      });
      await res.body?.cancel().catch(() => {});
      out.answered++;
      if (res.status === 404 || res.status === 410 || res.status >= 500) out.dead.push(url);
      else out.reachable++;
    } catch {
      out.dead.push(url);
    }
  };
  while (queue.length > 0 && out.reachable < need) {
    await Promise.all(queue.splice(0, 8).map(one));
  }
  return out;
}

/** What each row deliverable must carry to count, and where its rows already live. */
const ROWS: Record<string, {
  list: string; noun: string; min: number; table: string;
  valid: (r: Record<string, unknown>) => boolean;
  /** The link a person would open to check this row. */
  link: (r: Record<string, unknown>) => string;
  /** SQL that is true for a row already in the table, bound with `keys(r)`. */
  known: string; keys: (r: Record<string, unknown>) => string[];
}> = {
  sourcing_candidates: {
    list: "candidates", noun: "candidate", min: 1, table: "sourcing_candidates",
    valid: (r) => text(r.name) !== "" && text(r.source_url) !== "",
    link: (r) => text(r.source_url),
    known: "name = ? AND kind = ?",
    keys: (r) => [text(r.name), typeof r.kind === "string" && ["buyer", "seller", "intermediary"].includes(r.kind) ? r.kind : "buyer"],
  },
  link_prospects: {
    list: "prospects", noun: "prospect", min: 1, table: "link_prospects",
    valid: (r) => text(r.url) !== "" && text(r.property) !== "",
    link: (r) => text(r.url),
    known: "property = ? AND url = ?", keys: (r) => [text(r.property), text(r.url)],
  },
  tool_suggestions: {
    list: "tools", noun: "tool", min: 3, table: "tool_suggestions",
    valid: (r) => text(r.name) !== "" && text(r.url) !== "" && text(r.what_it_does) !== "",
    link: (r) => text(r.url),
    known: "url = ?", keys: (r) => [text(r.url)],
  },
};
export const ROW_FLOOR_KINDS = Object.keys(ROWS);

function text(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }

/**
 * THE FLOOR FOR A LIST DELIVERABLE (buyers and sellers, backlink prospects, tools), on the payload
 * the run filed and the table as it stands BEFORE this run's rows are written.
 *
 *   no payload            the run wrote no delivers.json this side could read (missing, or not JSON)
 *   zero usable rows      it delivered nothing, or was "blocked on missing input"
 *   fewer NEW rows than   a row already in the table is last run's item repeated, not new work
 *   the minimum
 *   new rows whose link   a row nobody can open is a guess
 *   does not open
 *
 * `nothingNew` (PR 3, sourcing): a run may say honestly that it searched and found nothing new. That
 * is a pass only with the searches and the rejected names on record; see `honestNothingNew`.
 */
export async function rowsFloor(
  env: Pick<Env, "DB">,
  kind: string,
  payload: Record<string, unknown> | null,
  o: { fetchImpl?: typeof fetch; why?: string | null } = {},
): Promise<FloorVerdict | null> {
  const spec = ROWS[kind];
  if (!spec) return null;
  if (!payload) {
    return { pass: false, misses: [`no readable delivers.json reached Boss OS${o.why ? ` (${o.why})` : ""}`], measured: { rows: 0, new_rows: 0 } };
  }
  const filed = Array.isArray(payload[spec.list]) ? (payload[spec.list] as unknown[]) : [];
  const rows = filed.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && spec.valid(r as Record<string, unknown>));
  const fresh: Record<string, unknown>[] = [];
  for (const r of rows) {
    const hit = await env.DB.prepare(`SELECT 1 AS x FROM ${spec.table} WHERE ${spec.known} LIMIT 1`).bind(...spec.keys(r)).first<{ x: number }>();
    if (!hit) fresh.push(r);
  }
  const measured: Record<string, number | string> = { rows: rows.length, new_rows: fresh.length, dropped: filed.length - rows.length };
  const misses: string[] = [];
  if (rows.length === 0) {
    const honest = honestNothingNew(kind, payload);
    if (honest.ok) return { pass: true, misses: [], measured: { ...measured, nothing_new: honest.why } };
    misses.push(`it delivered zero ${spec.noun}s${honest.why ? ` (${honest.why})` : ""}`);
  } else if (fresh.length < spec.min) {
    const honest = honestNothingNew(kind, payload);
    if (honest.ok) return { pass: true, misses: [], measured: { ...measured, nothing_new: honest.why } };
    misses.push(`${fresh.length} new ${spec.noun}${fresh.length === 1 ? "" : "s"} (the floor is ${spec.min}); ${rows.length - fresh.length} repeated the list as it stood`);
  } else {
    const reach = await sourcesReachable(fresh.map(spec.link), { need: spec.min, fetchImpl: o.fetchImpl });
    measured.links_reachable = reach.answered === 0 ? "not read: no link answered the check at all" : reach.reachable;
    if (reach.answered > 0 && reach.reachable < spec.min) misses.push(`only ${reach.reachable} of ${reach.checked} new ${spec.noun} links opened when they were checked (the floor is ${spec.min})`);
  }
  return { pass: misses.length === 0, misses, measured };
}

/**
 * "NOTHING NEW" IS HONEST ONLY WITH THE SEARCH ON RECORD. Seven of twelve brokerage sourcing runs in
 * thirty days delivered zero rows, and nothing told a real "the market gave nothing new" from a weak
 * search. A run that found nothing files `nothing_new: { searches: [..], considered: [{ name, why_not }] }`:
 * the queries it actually ran and the firms it looked at and turned down (already on the list, below
 * the ticket floor, no source). Enough of both is a pass that says so; anything less is a miss.
 */
export const NOTHING_NEW_FLOOR = Object.freeze({ searches: 5, considered: 3 });
export function honestNothingNew(kind: string, payload: Record<string, unknown> | null): { ok: boolean; why: string } {
  if (kind !== "sourcing_candidates") return { ok: false, why: "" };
  const n = payload?.nothing_new && typeof payload.nothing_new === "object" ? (payload.nothing_new as Record<string, unknown>) : null;
  if (!n) return { ok: false, why: "and did not say what it searched" };
  const searches = (Array.isArray(n.searches) ? n.searches : []).filter((q) => text(q) !== "").length;
  const considered = (Array.isArray(n.considered) ? n.considered : [])
    .filter((c) => c && typeof c === "object" && text((c as Record<string, unknown>).name) !== "" && text((c as Record<string, unknown>).why_not) !== "").length;
  const ok = searches >= NOTHING_NEW_FLOOR.searches && considered >= NOTHING_NEW_FLOOR.considered;
  return { ok, why: `${searches} searches run, ${considered} firms considered and turned down${ok ? "" : ` (an honest "nothing new" needs ${NOTHING_NEW_FLOOR.searches} and ${NOTHING_NEW_FLOOR.considered})`}` };
}

/** A research page's floor: a page with no source a person can open is not delivered. */
export async function researchPageFloor(
  page: { sources: { url: string }[] } | null,
  why: string | null,
  o: { fetchImpl?: typeof fetch } = {},
): Promise<FloorVerdict> {
  if (!page) return { pass: false, misses: [why ?? "the run delivered no research page"], measured: { sources: 0 } };
  const urls = page.sources.map((s) => s.url);
  if (urls.length === 0) return { pass: false, misses: ["the page cites no source"], measured: { sources: 0 } };
  const reach = await sourcesReachable(urls, { need: 1, fetchImpl: o.fetchImpl });
  const measured = { sources: urls.length, sources_reachable: reach.answered === 0 ? "not read: no source answered the check at all" : reach.reachable };
  if (reach.answered > 0 && reach.reachable === 0) return { pass: false, misses: [`none of its ${reach.checked} sources opened when they were checked`], measured };
  return { pass: true, misses: [], measured };
}

/** The stop a missed floor ends under: one sentence, the counts that explain it. */
export function floorStop(delivers: string, v: FloorVerdict): string {
  return `NAMED STOP [FLOOR_MISSED] ${delivers} is below its floor: ${v.misses.join("; ")}`;
}
