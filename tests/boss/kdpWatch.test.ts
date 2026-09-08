import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";

/**
 * SIMONE'S PUBLICATION CHASE.
 *
 * Seven authored books cannot be published — a server-side flag on the KDP account, with case
 * #51496198 as the only route to it. The watcher that reads the support mail has run Mon/Wed/Fri
 * since 2 September and worked; what it did NOT do was tell this system anything, so the
 * determination landed in a log file and Simone owned a duty whose output was invisible.
 *
 * The two tests that matter here are the boundary ones: that no mail content can cross into the
 * database, and that the cron never materialises an agent task for work no agent can do.
 */

async function clean() {
  await env.DB.prepare(`DELETE FROM kdp_case_checks`).run();
}
beforeEach(clean);

describe("the boundary", () => {
  it("refuses a determination carrying an address", async () => {
    /*
     * The determination is prose written by a run that has just read her mail, and prose is exactly
     * where an address or a quoted header arrives without anyone intending it. The relationships
     * sync carries the identical guard and it caught a real leak on its first run.
     */
    const res = await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "replied", determination: "Rohan at kdp-support@amazon.com sent a template." },
    });
    expect(res.status).toBe(400);
    const n = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM kdp_case_checks`);
    // REFUSED, NOT STRIPPED. A silently-edited determination is one she would read as complete.
    expect(n!.n).toBe(0);
  });

  it("refuses an address hiding in the next action as well", async () => {
    const res = await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "needs-her", determination: "They asked for a document.", next_action: "Reply to seq.taylor@gmail.com" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a sentinel the watcher's prompt does not produce", async () => {
    const res = await apiJson<any>("/api/kdp/check", { method: "POST", body: { sentinel: "probably-fine" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/no-reply/);
  });
});

describe("a check that arrives", () => {
  it("is recorded, and advances the duty's clock — which nothing else can", async () => {
    const before = await row<any>(`SELECT last_run_at, next_due_at FROM standing_duties WHERE id = 'duty_kdp_publication'`);
    const res = await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: {
        sentinel: "no-reply", determination: "Nothing new since her own reply. The case has fanned into four threads.",
        days_since_support: 1, nudges_unanswered: 0, threads_seen: 4,
      },
    });
    expect(res.status).toBe(201);

    const after = await row<any>(`SELECT last_run_at, next_due_at FROM standing_duties WHERE id = 'duty_kdp_publication'`);
    /*
     * A `local_job` duty is never materialised by the cron, so this is the ONLY thing that can say
     * the duty ran — which is the correct place for it: the duty ran when the work happened, not
     * when a scheduler believed it had.
     */
    expect(after.last_run_at).toBeGreaterThan(before.last_run_at ?? 0);
    expect(after.next_due_at).toBeGreaterThan(Date.now());
  });

  it("marks a title Live only when the watcher actually published one", async () => {
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "cleared", determination: "Support says the flag is removed.", published_title_ref: "A2C99P6JESFOP0" },
    });
    const stillBlocked = await row<any>(`SELECT state FROM kdp_titles WHERE title_ref = 'A2C99P6JESFOP0'`);
    // "cleared" is a claim about a flag; publishing is a fact about a book. Only the second moves it.
    expect(stillBlocked.state).toBe("blocked");

    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "published", determination: "One title went through.", published_title_ref: "A2C99P6JESFOP0" },
    });
    const live = await row<any>(`SELECT state FROM kdp_titles WHERE title_ref = 'A2C99P6JESFOP0'`);
    expect(live.state).toBe("live");

    await env.DB.prepare(`UPDATE kdp_titles SET state = 'blocked', went_live_at = NULL WHERE title_ref = 'A2C99P6JESFOP0'`).run();
  });

  it("keeps the commitment blocked when one book of seven goes out", async () => {
    await apiJson<any>("/api/kdp/check", { method: "POST", body: { sentinel: "published", determination: "One went through." } });
    const d = await row<any>(`SELECT state FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    // One title proves the account flag is gone and leaves six books unpublished, which is not the
    // terminal condition. Only counting them closes it.
    expect(d.state).not.toBe("done");
  });
});

describe("what the screen is told", () => {
  it("names who acts when support says the block is cleared", async () => {
    await apiJson<any>("/api/kdp/check", { method: "POST", body: { sentinel: "cleared", determination: "Flag removed, they say." } });
    const res = await apiJson<any>("/api/kdp");
    expect(res.status).toBe(200);
    // The honest half of "can it just try again": sometimes, and the screen says which happened.
    expect(res.body.data.action.who).toBe("her");
    expect(res.body.data.action.headline).toMatch(/publish one title/i);
  });

  it("hands a stalled case back to her, because more email will not move it", async () => {
    await apiJson<any>("/api/kdp/check", {
      method: "POST", body: { sentinel: "stalled", determination: "Three nudges unanswered.", nudges_unanswered: 3 },
    });
    const res = await apiJson<any>("/api/kdp");
    expect(res.body.data.action.who).toBe("her");
    expect(res.body.data.latest.needs_owner).toBe(1);
  });

  it("says how old the last determination is, because a stopped watcher looks like good news", async () => {
    const res = await apiJson<any>("/api/kdp");
    expect(res.body.data).toHaveProperty("days_since_last_check");
    expect(res.body.data.counts.blocked).toBeGreaterThan(0);
  });
});

describe("the cron and a job it cannot do", () => {
  it("never materialises an agent task for locally-executed work", async () => {
    // Force it due: without the guard this would queue a task the agent would claim, fail at, or
    // invent an answer for — a run that never happened, reported as success.
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 1 WHERE id = 'duty_kdp_publication'`).run();
    const out = await materialiseDueDuties(env as any);
    expect(out.fired.some((f) => f.duty === "duty_kdp_publication")).toBe(false);
    expect(out.skipped.some((s) => s.duty === "duty_kdp_publication" && s.reason === "local_job")).toBe(true);

    // And its clock is untouched, so an unreported job reads as overdue rather than as fine.
    const d = await row<any>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_kdp_publication'`);
    expect(d.next_due_at).toBe(1);
  });
});
