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
  it("is recorded, and survives the duty being retired", async () => {
    /*
     * 0244 RETIRED `duty_kdp_publication`: the case closed on 14 September 2026 and production had
     * already lost the row by hand. A check arriving for a retired duty — a hand run, a stale Mac —
     * is still a fact about the case and is still recorded; there is simply no clock to advance.
     */
    const duty = await row<any>(`SELECT id FROM standing_duties WHERE id = 'duty_kdp_publication'`);
    expect(duty).toBeNull();
    const res = await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: {
        sentinel: "no-reply", determination: "Nothing new since her own reply. The case has fanned into four threads.",
        days_since_support: 1, nudges_unanswered: 0, threads_seen: 4,
      },
    });
    expect(res.status).toBe(201);
    const recorded = await row<any>(`SELECT sentinel FROM kdp_case_checks WHERE id = ?`, res.body.data.id);
    expect(recorded?.sentinel).toBe("no-reply");
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

  it("does not let a determination rewrite why the commitment is stuck", async () => {
    /*
     * CAUGHT ON PRODUCTION, NOT HERE. The first determination this endpoint received overwrote the
     * deliverable's `blocker`, so Today read "Simone is blocked on Every authored book published —
     * <whatever the last run happened to find>". The blocker is WHY the work is stuck: the account
     * flag, the case number, the three titles that published from this same account. It changes
     * deliberately. What a run found changes every run and already has its own table and screen.
     * Collapsing the two turns an escalation into a log line and loses the sentence she acts on.
     */
    const before = await row<any>(`SELECT blocker FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "no-reply", determination: "Nothing new; four threads, none of them answering the account alert." },
    });
    const after = await row<any>(`SELECT blocker FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    expect(after.blocker).toBe(before.blocker);
    expect(after.blocker).toMatch(/51496198/);
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
    // `duty_kdp_surface` is Simone's standing local job now that the case chase is retired.
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 1 WHERE id = 'duty_kdp_surface'`).run();
    const out = await materialiseDueDuties(env as any);
    expect(out.fired.some((f) => f.duty === "duty_kdp_surface")).toBe(false);
    expect(out.skipped.some((s) => s.duty === "duty_kdp_surface" && s.reason === "local_job")).toBe(true);

    // And its clock is untouched, so an unreported job reads as overdue rather than as fine.
    const d = await row<any>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_kdp_surface'`);
    expect(d.next_due_at).toBe(1);
  });
});


/**
 * 14 SEPTEMBER 2026, 09:23. Simone emailed her about a block that had cleared two days earlier.
 * Three things let it happen; these pin the two that live in the Worker. The third — the launchd
 * job outliving its duty — is pinned by `validate:launchd-duty-link` reading migration 0244.
 */
describe("a closed case is not chased", () => {
  const liveShelf = async () => {
    await env.DB.prepare(`UPDATE kdp_titles SET state = 'live', went_live_at = ? WHERE state = 'blocked'`).bind(Date.now()).run();
  };
  const blockedShelf = async () => {
    await env.DB.prepare(`UPDATE kdp_titles SET state = 'blocked', went_live_at = NULL WHERE title_ref NOT LIKE 'B0%'`).run();
    await env.DB.prepare(`UPDATE owned_deliverables SET state = 'blocked', killed_at = NULL, killed_reason = NULL WHERE id = 'del_kdp_publication'`).run();
  };

  it("says on the register whether there is anything left to chase", async () => {
    const before = await apiJson<any>("/api/kdp");
    expect(before.body.data.chase.open).toBe(true);
    await liveShelf();
    const after = await apiJson<any>("/api/kdp");
    expect(after.body.data.chase.open).toBe(false);
    expect(after.body.data.chase.why).toMatch(/No title is blocked/);
    await blockedShelf();
  });

  it("a needs-her for a shelf with nothing blocked does NOT re-block the commitment", async () => {
    /*
     * THE PRODUCTION DEFECT, EXACTLY. `needs-her` arrived at 09:25 for a register reading
     * `blocked: 0`, set the deliverable back to `blocked`, reset `blocked_since` to that minute, and
     * put a cleared case back at the top of Today. The sentinel describes what a run read in her
     * mail; whether a book is blocked is a fact about the register.
     */
    await liveShelf();
    await env.DB.prepare(`UPDATE owned_deliverables SET state = 'open', blocked_since = NULL WHERE id = 'del_kdp_publication'`).run();
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "needs-her", determination: "Covers prepared and ready; approve them and sign in to publish.", needs_owner: true },
    });
    const d = await row<any>(`SELECT state, blocked_since FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    expect(d.state).toBe("open");
    expect(d.blocked_since).toBeNull();
    await blockedShelf();
  });

  it("her stopping the commitment closes the chase even with a title in draft", async () => {
    // Six Live, one Draft — the real shelf on 14 September. Draft is outstanding for the terminal
    // check, and it is not a block, and her verdict outranks both for whether anyone chases.
    await liveShelf();
    await env.DB.prepare(`UPDATE kdp_titles SET state = 'draft', went_live_at = NULL WHERE title_ref = 'A1EYXUFGFV7CN6'`).run();
    await env.DB.prepare(
      `UPDATE owned_deliverables SET state = 'killed', killed_at = ?, killed_reason = 'please close out the kdp upload issue.' WHERE id = 'del_kdp_publication'`,
    ).bind(Date.now()).run();
    const res = await apiJson<any>("/api/kdp");
    expect(res.body.data.counts.draft).toBe(1);
    expect(res.body.data.chase.open).toBe(false);
    expect(res.body.data.chase.why).toMatch(/You stopped this/);
    expect(res.body.data.commitment.state).toBe("killed");
    // The register can say draft, and a draft is hers to set by hand.
    const set = await apiJson<any>("/api/kdp/titles/A1EYXUFGFV7CN6", { method: "POST", body: { state: "draft", note: "Draft on the bookshelf." } });
    expect(set.status).toBe(200);
    await blockedShelf();
  });
});
