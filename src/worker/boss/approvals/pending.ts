/**
 * ONE ANSWER TO "WHAT IS WAITING ON HER", AND EVERY SURFACE READS IT.
 *
 * ─── The defect, observed on production on 9 September 2026 ────────────────
 *
 *   Today card:  "Approval Inbox — 9 waiting"
 *   Tab badge:   9
 *   Inbox tab:   "0 waiting on you · Nothing needs you"
 *   The API:     GET /api/boss/approvals → { "ok": true, "data": [] }
 *
 * Three surfaces, three numbers, and the one with nothing behind it was the one she was looking at.
 * She has reported the identical defect in the other product — "still says 12 unread even tho i read
 * it all" — which makes it a pattern rather than an incident, and a count that lies about work
 * waiting on her is worse than no count: it sends her to an empty screen, and after that she stops
 * believing the number on the day it is right.
 *
 * ─── What was actually wrong, precisely ────────────────────────────────────
 *
 * FOUR PLACES COMPUTED IT, each with its own SQL: `system.ts` counted, `today.ts` grouped by risk
 * and summed, `approvals.ts` selected rows with `LIMIT 100`, and the client took a fifth answer from
 * `rows.length`. They agreed on the predicate and disagreed on everything else:
 *
 *   · The list was capped at 100 and the count was not, so past a hundred they diverge by
 *     construction and nothing anywhere says so.
 *   · Each was fetched at a different moment and none was invalidated by the others, so the badge
 *     was whatever had been true when the app was unlocked.
 *
 * ─── The fix is one function, not four careful queries ─────────────────────
 *
 * Careful queries drift; that is the whole history of this file's existence. A count that is
 * DERIVED FROM THE SAME FETCH as the list cannot disagree with it, and `total` beside `rows` is what
 * lets a capped list say "showing 100 of 143" instead of quietly being wrong.
 *
 * `scripts/validate/one-source-for-a-count.mjs` fails the build if a second place starts counting
 * `approvals` on its own, because a rule that is only in a comment is a rule that lasts until the
 * next person is in a hurry.
 */

import type { ApprovalRow } from "./execute";

/** The one definition of "waiting on her". Everything else here is built from it. */
export const PENDING = `status = 'pending'`;

/**
 * A NOTICE IS NOT AN APPROVAL, AND THE COUNT MUST NOT PRETEND IT IS.
 *
 * ─── Confirmed on production, 9 September 2026 ─────────────────────────────
 *
 *   SELECT kind, status, COUNT(*) FROM approvals GROUP BY kind, status
 *     notice | approved | 8
 *
 * Eight times, an employee told her something — "Monique emailed you the LP outcomes" — and the
 * Inbox rendered it with Approve / Reject / Later. There was nothing to approve. She pressed
 * Approve eight times to make a sentence go away, and the system recorded eight approvals she never
 * gave.
 *
 * THE DAMAGE IS TO THE REAL APPROVALS. A screen that asks for a verdict on things that have no
 * verdict teaches her that the button is a dismiss button, and the next card is a letter to a firm
 * or a cover going to Amazon.
 *
 * So `kind = 'notice'` is separated at the source rather than styled differently at the end: the
 * badge, the Today card and the Inbox stat all read `total`, and `total` now counts only things her
 * answer changes. The notices are returned beside them, never hidden.
 */
export const IS_NOTICE = `kind = 'notice'`;

/** More than this on one screen is not a list she works; it is a wall. The total still tells the truth. */
export const PENDING_PAGE = 100;

export interface PendingApprovals {
  /** The page she can see, risk-ordered. Decisions only — a notice is not one. */
  rows: ApprovalRow[];
  /**
   * Things she has been TOLD, which are pending in the table and are not waiting on an answer.
   * Returned from the same fetch so the two can never disagree about what is outstanding.
   */
  notices: ApprovalRow[];
  /**
   * EVERY pending approval, not just the page. The badge, the Today card and the Inbox stat all
   * read this, so a capped page can never turn into an under-count on a different screen.
   */
  total: number;
  /** True when the page is not the whole list, so a surface can say so rather than imply otherwise. */
  truncated: boolean;
  /** Counts by risk, derived from the same query the total is — never a second GROUP BY. */
  by_risk: { high: number; medium: number; low: number };
}

export async function pendingApprovals(
  db: D1Database,
  lane?: string | null,
): Promise<PendingApprovals> {
  const params: unknown[] = [];
  let where = PENDING;
  if (lane) { where += ` AND lane = ?`; params.push(lane); }

  /*
   * THE TOTAL AND THE PAGE COME FROM ONE STATEMENT.
   *
   * `COUNT(*) OVER ()` is evaluated over the same filtered set the rows come from, before the limit
   * applies, so the number and the list are two readings of one query rather than two queries that
   * happen to share a WHERE clause. Two statements is exactly how the four callers drifted.
   */
  const res = await db
    .prepare(
      `SELECT *, COUNT(*) OVER () AS pending_total FROM approvals
        WHERE ${where}
        ORDER BY CASE risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, requested_at DESC
        LIMIT ${PENDING_PAGE}`,
    )
    .bind(...params)
    .all<ApprovalRow & { pending_total: number }>();

  const raw = res.results ?? [];
  /*
   * `pending_total` still counts BOTH, because it is computed by the database over the whole
   * filtered set. The split happens here, once, and `total` below is the decision count — which is
   * the number every surface reads and the only one that should ever appear beside "waiting on you".
   */
  const noticeRows = raw.filter((r) => r.kind === "notice");
  const decisionRows = raw.filter((r) => r.kind !== "notice");

  /*
   * BY-RISK IS COUNTED OVER THE WHOLE SET, NOT OVER THE PAGE.
   *
   * Deriving it from `rows` would be the same defect one level down: high-risk sorts first, so a
   * truncated page would report zero low-risk approvals while the total counted them — a breakdown
   * that does not add up to its own headline. It is a second statement, but it is a second statement
   * INSIDE the one function every caller uses, which is the property that was missing before.
   */
  const risks = await db
    .prepare(`SELECT risk, COUNT(*) AS n FROM approvals WHERE ${where} AND NOT (${IS_NOTICE}) GROUP BY risk`)
    .bind(...params)
    .all<{ risk: string; n: number }>();
  const by_risk = { high: 0, medium: 0, low: 0 };
  for (const r of risks.results ?? []) {
    if (r.risk === "high" || r.risk === "medium" || r.risk === "low") by_risk[r.risk] = Number(r.n) || 0;
  }

  /*
   * THE DECISION TOTAL IS COUNTED IN THE DATABASE, not taken from the page.
   *
   * Deriving it by subtracting the notices on this page would be wrong the moment the page is
   * capped: past a hundred pending items the split on the page says nothing about the split in the
   * table. It is a second statement inside the one function every caller uses, which is the property
   * that made this file exist.
   */
  const counted = await db
    .prepare(`SELECT COUNT(*) AS n FROM approvals WHERE ${where} AND NOT (${IS_NOTICE})`)
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(counted?.n ?? 0);

  const strip = (r: ApprovalRow & { pending_total?: number }) => {
    const { pending_total: _drop, ...rest } = r;
    return rest as ApprovalRow;
  };
  const rows = decisionRows.map(strip);
  return { rows, notices: noticeRows.map(strip), total, truncated: total > rows.length, by_risk };
}
