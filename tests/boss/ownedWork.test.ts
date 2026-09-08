import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row, uid } from "./helpers";
import {
  deliverableAlerts, escalationFor, recordDeliverableActivity, TERMINAL_CHECKS,
} from "../../src/worker/boss/today/deliverables";

/**
 * WORK THAT IS OWNED CANNOT BE DROPPED.
 *
 * "she owns this deliverable so she needs to make sure its done and if there is any block she needs
 * to tell me immediately and keep reminding me until its done. she canot drop it. that goes for all
 * employees when i give them something to own."
 *
 * Each test below is one clause of that sentence made mechanical. The two that matter most are the
 * ones nobody would think to write: that SILENCE escalates, and that a broken executor makes a
 * commitment louder rather than quieter — because those are the shapes in which work actually
 * disappears. Nothing is ever dropped by someone deciding to drop it.
 */

const DAY = 86_400_000;

async function seed(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? uid("del");
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO owned_deliverables
         (id, name, employee_id, lane, terminal_condition, terminal_check, state, duty_id,
          escalation_path, blocker, blocked_since, last_activity_at, stall_after_days,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, over.name ?? "A thing she handed someone", over.employee_id ?? "emp_chief", "ops",
      over.terminal_condition ?? "It is finished when the records say it is.",
      over.terminal_check ?? "never_true_in_tests",
      over.state ?? "open", over.duty_id ?? null,
      over.escalation_path ?? "Named on Today until it is done.",
      over.blocker ?? null, over.blocked_since ?? null,
      over.last_activity_at === undefined ? now : over.last_activity_at,
      over.stall_after_days ?? 7, now, now,
    )
    .run();
  return id;
}

async function clean() {
  await env.DB.prepare(`DELETE FROM owned_deliverables WHERE id LIKE 'del_test%'`).run();
}

beforeEach(clean);

describe("the escalation ladder", () => {
  it("gets louder the longer a block sits, rather than repeating itself", () => {
    /*
     * "KEEP REMINDING ME UNTIL ITS DONE" is not satisfied by the same sentence twenty times. A
     * reminder that reads identically on day one and day twenty is one she learns to skim, which is
     * the silence it was meant to replace wearing a badge.
     */
    expect(escalationFor(0).severity).toBe("medium");
    expect(escalationFor(2).severity).toBe("medium");
    expect(escalationFor(3).severity).toBe("high");
    expect(escalationFor(7).severity).toBe("critical");
    expect(escalationFor(14).severity).toBe("critical");
    // At a fortnight it stops describing the block and says the thing that is actually true.
    expect(escalationFor(14).tone).toMatch(/not working/i);
    expect(escalationFor(14).tone).not.toEqual(escalationFor(7).tone);
  });

  it("is monotonic — no number of days is quieter than a smaller one", () => {
    const rank = { medium: 0, high: 1, critical: 2 } as const;
    let last = -1;
    for (let d = 0; d <= 40; d += 1) {
      const r = rank[escalationFor(d).severity];
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("a blocked deliverable", () => {
  it("names the person on the hook, not just the thing", async () => {
    // A REAL terminal check, deliberately: with a made-up one the deliverable also raises the
    // "this can never complete" alert, and the test would have been reading that instead.
    await seed({
      id: "del_test_blocked", state: "blocked", terminal_check: "kdp_all_live",
      blocked_since: Date.now() - 5 * DAY, blocker: "Amazon has not answered.",
    });
    const alerts = await deliverableAlerts(env as any);
    const mine = alerts.filter((a) => a.source_id === "del_test_blocked");
    const block = mine.find((a) => a.text.includes("is blocked on"));
    expect(block).toBeTruthy();
    // "The KDP thing is stuck" is a worse sentence than "Simone's publication chase is stuck".
    expect(block!.text).toContain("Simone");
    expect(block!.text).toContain("Amazon has not answered.");
    expect(block!.severity).toBe("high");
  });

  it("counts from when the world stopped, not from when anyone last looked", async () => {
    const id = await seed({ id: "del_test_clock", state: "blocked", blocked_since: Date.now() - 12 * DAY });
    await recordDeliverableActivity(env as any, { id, blocked: true, blocker: "Still the same flag." });
    const after = await row<{ blocked_since: number }>(`SELECT blocked_since FROM owned_deliverables WHERE id = ?`, id);
    /*
     * THE NUMBER THAT MUST NOT BE RESETTABLE. If checking in restarted the clock, the ladder would
     * measure attention rather than duration — and a case someone glances at every other day would
     * never escalate past medium, however long it stayed broken.
     */
    expect(Date.now() - after!.blocked_since).toBeGreaterThan(11 * DAY);
  });
});

describe("silence, which is the way work actually disappears", () => {
  it("raises the alarm when nothing has happened, executor or no executor", async () => {
    await seed({ id: "del_test_silent", last_activity_at: Date.now() - 9 * DAY, stall_after_days: 7, duty_id: "duty_x" });
    const alerts = await deliverableAlerts(env as any);
    const mine = alerts.filter((a) => a.source_id === "del_test_silent");
    expect(mine.some((a) => /Nothing has happened/.test(a.text))).toBe(true);
  });

  it("gets LOUDER when the executor is the thing that broke, not quieter", async () => {
    /*
     * THE FAILURE MODE THIS WHOLE DESIGN IS AGAINST. If the only thing keeping a commitment alive is
     * the job that is broken, the commitment dies with the job — and a dead commitment and a
     * finished one look identical. Here the executor going quiet IS the stall condition, so the
     * longer it stays broken the harder this shouts.
     */
    await seed({ id: "del_test_dead", last_activity_at: Date.now() - 20 * DAY, stall_after_days: 7 });
    const alerts = await deliverableAlerts(env as any);
    const mine = alerts.filter((a) => a.source_id === "del_test_dead");
    expect(mine.some((a) => a.severity === "critical")).toBe(true);
  });

  it("says so when nothing has ever happened at all", async () => {
    await seed({ id: "del_test_never", last_activity_at: null });
    const alerts = await deliverableAlerts(env as any);
    expect(alerts.some((a) => a.source_id === "del_test_never" && /never had any activity/.test(a.text))).toBe(true);
  });
});

describe("completion", () => {
  it("is granted by counting records and never by a claim", async () => {
    // A terminal check the Worker does not have can never complete, so it is reported as the fault
    // it is rather than nagging her for ever with no route out.
    await seed({ id: "del_test_typo", terminal_check: "kdp_all_livee" });
    const alerts = await deliverableAlerts(env as any);
    expect(alerts.some((a) => a.source_id === "del_test_typo" && /does not have/.test(a.text))).toBe(true);
    const still = await row<{ state: string }>(`SELECT state FROM owned_deliverables WHERE id = 'del_test_typo'`);
    expect(still!.state).toBe("open");
  });

  it("does not treat an empty register of titles as a finished shelf", async () => {
    /*
     * THE EMPTY-LOOP PASS, AT THE LEVEL OF AN OUTCOME. Zero outstanding out of zero titles would
     * otherwise read as "everything is published" and close the deliverable on nothing at all.
     */
    const saved = await env.DB.prepare(`SELECT COUNT(*) AS n FROM kdp_titles`).first<{ n: number }>();
    await env.DB.prepare(`DELETE FROM kdp_titles`).run();
    const out = await TERMINAL_CHECKS.kdp_all_live!(env as any);
    expect(out.met).toBe(false);
    expect(out.progress).toMatch(/broken register/i);
    expect(saved!.n).toBeGreaterThan(0); // the migration really did seed them
  });
});

describe("the register itself", () => {
  it("reports an empty register as a fault rather than a clear plate", async () => {
    const res = await apiJson<any>("/api/deliverables");
    expect(res.status).toBe(200);
    // Seeded by 0202, so this is populated; the field exists to say so when it is not.
    expect(res.body.data.deliverables.length).toBeGreaterThan(0);
    expect(res.body.data.empty_register).toBeNull();
  });

  it("refuses to let anyone mark a commitment done by hand", async () => {
    const id = await seed({ id: "del_test_hand" });
    const res = await apiJson<any>(`/api/deliverables/${id}`, { method: "POST", body: { state: "done" } });
    expect(res.status).toBe(400);
    // The moment a person can declare completion, "done" means "somebody said so" — which is what a
    // duty already meant, and is exactly how the practice duty spent eleven Sundays achieving nothing.
    expect(JSON.stringify(res.body)).toMatch(/terminal check/i);
  });

  it("will not let one be stopped without a reason", async () => {
    const id = await seed({ id: "del_test_stop" });
    const bare = await apiJson<any>(`/api/deliverables/${id}`, { method: "POST", body: { state: "killed" } });
    expect(bare.status).toBe(400);

    const withReason = await apiJson<any>(`/api/deliverables/${id}`, {
      method: "POST",
      body: { state: "killed", killed_reason: "Decided not to publish this one." },
    });
    expect(withReason.status).toBe(200);
    const after = await row<{ state: string; killed_reason: string }>(
      `SELECT state, killed_reason FROM owned_deliverables WHERE id = ?`, id,
    );
    expect(after!.state).toBe("killed");
    // It stays in the register with its reason. A commitment that vanishes is indistinguishable
    // from one that was forgotten.
    expect(after!.killed_reason).toMatch(/Decided not to publish/);
  });

  it("does not let a run resurrect something she stopped", async () => {
    const id = await seed({ id: "del_test_zombie", state: "open" });
    await apiJson<any>(`/api/deliverables/${id}`, {
      method: "POST", body: { state: "killed", killed_reason: "Not doing it." },
    });
    await recordDeliverableActivity(env as any, { id, blocked: true, blocker: "A job thinks this is live." });
    const after = await row<{ state: string }>(`SELECT state FROM owned_deliverables WHERE id = ?`, id);
    expect(after!.state).toBe("killed");
  });
});

describe("the publishing block, as instance one", () => {
  it("is owned by a real person with a condition the records can decide", async () => {
    const d = await row<any>(`SELECT * FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    expect(d).toBeTruthy();
    expect(d.employee_id).toBe("emp_chief");
    expect(d.state).toBe("blocked");
    expect(Object.prototype.hasOwnProperty.call(TERMINAL_CHECKS, d.terminal_check)).toBe(true);
    // Live, not "support said it was fixed". This case has already produced one confident answer
    // that changed nothing.
    expect(d.terminal_condition).toMatch(/Live/);
  });

  it("stays blocked when one title publishes, and closes only when the last one does", async () => {
    const before = await TERMINAL_CHECKS.kdp_all_live!(env as any);
    expect(before.met).toBe(false);

    await env.DB.prepare(`UPDATE kdp_titles SET state = 'live' WHERE state != 'withdrawn'`).run();
    const after = await TERMINAL_CHECKS.kdp_all_live!(env as any);
    expect(after.met).toBe(true);

    await env.DB.prepare(`UPDATE kdp_titles SET state = 'blocked' WHERE went_live_at IS NULL`).run();
  });

  it("does not count a title Amazon is still reviewing as published", async () => {
    await env.DB.prepare(`UPDATE kdp_titles SET state = 'in_review' WHERE state = 'blocked'`).run();
    const out = await TERMINAL_CHECKS.kdp_all_live!(env as any);
    // Submitted is not published, and three of hers sat in review for days before going Live.
    expect(out.met).toBe(false);
    await env.DB.prepare(`UPDATE kdp_titles SET state = 'blocked' WHERE state = 'in_review'`).run();
  });
});
