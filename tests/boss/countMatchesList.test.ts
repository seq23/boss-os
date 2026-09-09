import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, api, uid } from "./helpers";
import { pendingApprovals, PENDING_PAGE } from "../../src/worker/boss/approvals/pending";

/**
 * THE NUMBER AND THE LIST ARE THE SAME QUERY, IN EVERY STATE.
 *
 * ─── What she was shown on production, 9 September 2026 ────────────────────
 *
 *   Today card: "Approval Inbox — 9 waiting".  Tab badge: 9.
 *   Inbox tab:  "0 waiting on you · Nothing needs you".
 *   GET /api/approvals → { "ok": true, "data": [] }
 *
 * She had already reported the same thing in the other product — "still says 12 unread even tho i
 * read it all" — so it is a class of defect rather than an incident, and the class is: a count
 * computed somewhere other than the list it describes.
 *
 * ─── Rule 0 is enforced from inside the test ───────────────────────────────
 *
 * A test that asserts equality proves nothing when both sides are zero, and zero is exactly the
 * state a broken seed produces. So every case that expects rows ASSERTS THAT THERE ARE ROWS before
 * it compares anything, and the state matrix is checked for having actually covered every status a
 * row can hold.
 */

const STATES = ["pending", "approved", "rejected", "deferred", "expired"] as const;

async function seed(status: string, risk: string, n: number) {
  const now = Date.now();
  for (let i = 0; i < n; i += 1) {
    await env.DB
      .prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, risk, status, requested_at, expires_at)
         VALUES (?,'ops',?,?, 'manual', ?, ?, ?, NULL)`,
      )
      .bind(uid("apr"), `${status} ${risk} ${i}`, "seeded", risk, status, now - i)
      .run();
  }
}

describe("the pending count and the pending list cannot disagree", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM approvals`).run();
  });

  it("agrees across every status a row can hold, not only the happy one", async () => {
    /*
     * THE MATRIX IS THE POINT. The production defect was invisible while everything was pending and
     * appeared the moment rows moved to other statuses, which is what a real day does to this table.
     */
    let expectedPending = 0;
    for (const status of STATES) {
      const n = status === "pending" ? 4 : 2;
      await seed(status, "medium", n);
      if (status === "pending") expectedPending += n;
    }
    // Rule 0: a seed that inserted nothing would make every assertion below trivially true.
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM approvals`).first<{ n: number }>();
    expect(total?.n).toBe(4 + 2 * (STATES.length - 1));
    expect(expectedPending).toBeGreaterThan(0);

    const list = await apiJson<{ data: any[] }>("/api/approvals?status=pending");
    const status = await apiJson<{ data: { counts: Record<string, number> } }>("/api/system/status");

    expect(list.body.data.length).toBe(expectedPending);
    expect(status.body.data.counts.pending_approvals).toBe(expectedPending);
    expect(status.body.data.counts.pending_approvals).toBe(list.body.data.length);
  });

  it("reports the true total when the list is capped, rather than under-counting", async () => {
    /*
     * THE HALF NOBODY WOULD HAVE FOUND BY HAND. The list has always been `LIMIT 100` and the count
     * never was, so past a hundred they diverge by construction — and the client took a third answer
     * from `rows.length`, which would have quietly reported 100 for ever.
     */
    const over = PENDING_PAGE + 7;
    await seed("pending", "low", over);

    const { rows, total, truncated } = await pendingApprovals(env.DB);
    expect(rows.length).toBe(PENDING_PAGE);
    expect(total).toBe(over);
    expect(truncated).toBe(true);

    const res = await api("/api/approvals?status=pending");
    expect(res.headers.get("X-Pending-Total")).toBe(String(over));
    expect(res.headers.get("X-Pending-Truncated")).toBe("1");

    const status = await apiJson<{ data: { counts: Record<string, number> } }>("/api/system/status");
    expect(status.body.data.counts.pending_approvals).toBe(over);
  });

  it("breaks down by risk over the whole set, not over the visible page", async () => {
    // High sorts first, so a page-derived breakdown would report zero low-risk while counting them
    // in the total — a breakdown that does not add up to its own headline.
    await seed("pending", "high", PENDING_PAGE);
    await seed("pending", "low", 5);

    const { by_risk, total } = await pendingApprovals(env.DB);
    expect(total).toBe(PENDING_PAGE + 5);
    expect(by_risk.high).toBe(PENDING_PAGE);
    expect(by_risk.low).toBe(5);
    expect(by_risk.high + by_risk.medium + by_risk.low).toBe(total);
  });

  it("says zero, and says it from the same place, when nothing is waiting", async () => {
    await seed("approved", "medium", 3);
    const seeded = await env.DB.prepare(`SELECT COUNT(*) AS n FROM approvals`).first<{ n: number }>();
    // Rule 0 again: "0 = 0" over an empty table is not evidence that the two agree.
    expect(seeded?.n).toBe(3);

    const list = await apiJson<{ data: any[] }>("/api/approvals?status=pending");
    const status = await apiJson<{ data: { counts: Record<string, number> } }>("/api/system/status");
    expect(list.body.data.length).toBe(0);
    expect(status.body.data.counts.pending_approvals).toBe(0);
  });

  it("moves the moment she decides, rather than after the next reload", async () => {
    await seed("pending", "medium", 3);
    const before = await apiJson<{ data: { counts: Record<string, number> } }>("/api/system/status");
    expect(before.body.data.counts.pending_approvals).toBe(3);

    const list = await apiJson<{ data: any[] }>("/api/approvals?status=pending");
    expect(list.body.data.length).toBe(3);
    await apiJson(`/api/approvals/${list.body.data[0].id}/decide`, {
      method: "POST",
      body: { decision: "approved" },
    });

    const after = await apiJson<{ data: { counts: Record<string, number> } }>("/api/system/status");
    const afterList = await apiJson<{ data: any[] }>("/api/approvals?status=pending");
    expect(after.body.data.counts.pending_approvals).toBe(2);
    expect(afterList.body.data.length).toBe(2);
  });
});
