import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { anchorStreak, stalledDeals, STAGE_STALE_DAYS } from "../../src/worker/boss/today/close";
import { executionContract } from "../../src/worker/boss/today/pillars";
import { row, uid, apiJson } from "./helpers";

/**
 * THE TWO INSTRUMENTS THAT KEEP THE AGENDA FROM BECOMING FICTION.
 *
 * The Morning Gate proposes a first money move every day and nothing ever asked whether it
 * happened. A system in that state proposes the same thing for a fortnight, watches it go undone
 * every time, and keeps proposing it with complete confidence — it stops describing her life and
 * starts describing its own intentions, which is worse than no agenda because it still looks like
 * one.
 *
 * And `deals` could not measure stalling, which was one of her three stated symptoms: it has
 * `updated_at`, which moves for any edit at all, so adding a note to a dying deal made it look
 * freshly worked.
 */

const DAY = (n: number) => `2026-06-${String(n).padStart(2, "0")}`;

async function seedDay(id: string, outcome: string | null) {
  await env.DB.prepare(
    `INSERT INTO days (id, date_ts, morning_completed_at, anchor_outcome, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET morning_completed_at = excluded.morning_completed_at, anchor_outcome = excluded.anchor_outcome`,
  ).bind(id, Date.parse(`${id}T00:00:00Z`), Date.now(), outcome, Date.now()).run();
}

describe("the anchor streak", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM days WHERE id LIKE '2026-06-%'`).run();
  });

  it("says nothing about a single miss, because one missed anchor is a Tuesday", async () => {
    /*
     * Treating one miss as a failure is how a system teaches someone to stop telling it the truth,
     * and every number here depends on her being honest with it.
     */
    await seedDay(DAY(1), "done");
    await seedDay(DAY(2), "missed");
    const s = await anchorStreak(env as any, DAY(3));
    expect(s.consecutive_missed).toBe(1);
    expect(s.warning).toBeNull();
  });

  it("speaks once a run is long enough to be a pattern", async () => {
    await seedDay(DAY(1), "missed");
    await seedDay(DAY(2), "missed");
    await seedDay(DAY(3), "missed");
    const s = await anchorStreak(env as any, DAY(4));
    expect(s.consecutive_missed).toBe(3);
    expect(s.warning).toContain("3 days running");
    // A fact about the plan, not about her — the only reading she can act on.
    expect(s.warning).toContain("either the day is wrong or the move is");
  });

  it("does not count an unanswered night as a miss", async () => {
    /*
     * §14.2: DO NOT GUESS COMPLETION. A night she was too tired to close the gate is not a day she
     * skipped the work, and conflating them would make the streak mean nothing.
     */
    await seedDay(DAY(1), "missed");
    await seedDay(DAY(2), null);
    await seedDay(DAY(3), "missed");
    const s = await anchorStreak(env as any, DAY(4));
    // Silence neither breaks the run nor extends it: two known misses, not three, and not one.
    expect(s.consecutive_missed).toBe(2);
    /*
     * THE WINDOW IS TEN CALENDAR DAYS NOW, SO THE UNTOUCHED ONES ARE IN IT. That is the fix, not a
     * side effect — see the next test. The unanswered day she opened is one of them; the rest are
     * days that do not exist as rows at all.
     */
    expect(s.days.find((d) => d.id === DAY(2))?.outcome).toBe("unknown");
    expect(s.days.find((d) => d.id === DAY(2))?.touched).toBe(true);
    expect(s.unknown).toBe(s.untouched + 1);
  });

  it("stops the run at the last day she actually did it", async () => {
    await seedDay(DAY(1), "missed");
    await seedDay(DAY(2), "done");
    await seedDay(DAY(3), "missed");
    const s = await anchorStreak(env as any, DAY(4));
    expect(s.consecutive_missed).toBe(1);
  });

  it("counts a day she never touched, instead of dropping it out of the window", async () => {
    /*
     * ── THE BUG SHE FOUND BY ASKING THE RIGHT QUESTION ────────────────────────
     *
     * "if nothing is clicked does it track which days were skipped?"
     *
     * It did not. The query was `WHERE id < ? AND morning_completed_at IS NOT NULL ... LIMIT 10`,
     * so a day she never opened was NOT counted as unknown — it was excluded from the window
     * entirely and `LIMIT 10` reached further back to fill the gap. This test used to assert that,
     * approvingly, under the heading "ignores days whose morning gate never ran".
     *
     * AND IT FLATTERED. Ten fully-skipped days shrank the window rather than showing up in it, so
     * the one number meant to show her a pattern was structurally unable to show the pattern that
     * matters most. A metric that cannot report the bad case is not a metric.
     *
     * The window is the CALENDAR now. A missing row is a day nothing happened on, which is exactly
     * what she was asking to see, and `untouched` separates "opened it and never closed the night"
     * from "never opened it at all" — two different facts that were both called unknown.
     */
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?)`)
      .bind(DAY(9), Date.parse(`${DAY(9)}T00:00:00Z`), Date.now()).run();
    const s = await anchorStreak(env as any, DAY(10));

    expect(s.examined).toBe(10);
    expect(s.days).toHaveLength(10);
    // Nine days with no row at all, plus DAY(9) whose row exists and whose morning gate never ran.
    expect(s.untouched).toBe(10);
    expect(s.unknown).toBe(10);
    expect(s.done + s.missed).toBe(0);
    // And the window really is the ten days before it, rather than whatever rows happened to exist.
    expect(s.days[0]!.id).toBe(DAY(9));
  });
});

describe("the night gate closes the loop on the anchor", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM days WHERE id LIKE '2026-06-%'`).run();
  });

  const body = (over: Record<string, unknown> = {}) => ({
    day_id: DAY(15),
    attention: [{ focus_area: "brokerage", pct: 60 }],
    ...over,
  });

  it("records that it happened", async () => {
    const { status, body: b } = await apiJson("/api/today/gates/night", { method: "POST", body: body({ anchor: { done: true } }) });
    expect(status).toBe(201);
    expect(b.data.anchor.outcome).toBe("done");
    expect((await row<any>(`SELECT anchor_outcome FROM days WHERE id = ?`, DAY(15))).anchor_outcome).toBe("done");
  });

  it("records that it did not, with her reason", async () => {
    const { body: b } = await apiJson("/api/today/gates/night", {
      method: "POST", body: body({ day_id: DAY(16), anchor: { done: false, note: "All day on a fire" } }),
    });
    expect(b.data.anchor.outcome).toBe("missed");
    expect((await row<any>(`SELECT anchor_note FROM days WHERE id = ?`, DAY(16))).anchor_note).toBe("All day on a fire");
  });

  it("closes without the answer rather than refusing", async () => {
    /*
     * Law 2 puts continuity above completeness. A gate that will not close without five answers and
     * an anchor is one she abandons at 11pm, and an abandoned gate records nothing at all.
     */
    const { status, body: b } = await apiJson("/api/today/gates/night", { method: "POST", body: body({ day_id: DAY(17) }) });
    expect(status).toBe(201);
    expect(b.data.anchor.outcome).toBe("unknown");
  });
});

describe("deals that stopped moving", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM deals`).run();
    await env.DB.prepare(`DELETE FROM open_loops`).run();
  });

  const addDeal = async (over: Record<string, unknown>) => {
    const o = { id: uid("deal"), lane: "ops", name: "A deal", kind: "secondary", stage: "diligence", stage_since: Date.now(), ...over };
    await env.DB.prepare(
      `INSERT INTO deals (id, lane, name, kind, stage, stage_since, next_step, next_step_due_at, opened_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(o.id, o.lane, o.name, o.kind, o.stage, o.stage_since, (o as any).next_step ?? null,
           (o as any).next_step_due_at ?? null, Date.now(), Date.now(), Date.now()).run();
    return o.id;
  };

  const daysAgo = (n: number) => Date.now() - n * 86_400_000;

  it("measures age in STAGE, not age of last edit", async () => {
    /*
     * THE WHOLE REASON FOR A NEW COLUMN. `updated_at` moves for any change — so adding a note to a
     * dying deal, which is exactly what you do while worrying about one, made it look freshly
     * worked. `stage_since` moves only when the stage does.
     */
    await addDeal({ name: "Stuck", stage: "diligence", stage_since: daysAgo(30) });
    // Touched just now at the row level; the stage has not moved in 30 days.
    await env.DB.prepare(`UPDATE deals SET updated_at = ?, notes = 'worrying about this' WHERE name = 'Stuck'`).bind(Date.now()).run();

    const stalled = await stalledDeals(env as any);
    expect(stalled).toHaveLength(1);
    expect(stalled[0]!.days_in_stage).toBeGreaterThanOrEqual(30);
  });

  it("uses a different threshold per stage, because a week means different things", async () => {
    // 10 days is fine in screening (14) and late in committed (7).
    await addDeal({ name: "Screening", stage: "screening", stage_since: daysAgo(10) });
    await addDeal({ name: "Committed", stage: "committed", stage_since: daysAgo(10) });
    const stalled = await stalledDeals(env as any);
    expect(stalled.map((d) => d.name)).toEqual(["Committed"]);
    expect(STAGE_STALE_DAYS.committed!).toBeLessThan(STAGE_STALE_DAYS.screening!);
  });

  it("never calls a finished deal stale", async () => {
    for (const stage of ["closed", "passed", "dead"]) {
      await addDeal({ name: `Done ${stage}`, stage, stage_since: daysAgo(400) });
    }
    expect(await stalledDeals(env as any)).toHaveLength(0);
  });

  it("ranks by how overdue it is for its own stage, not by raw age", async () => {
    // 25 days sourced (threshold 21) is 1.19x; 14 days committed (threshold 7) is 2x.
    await addDeal({ name: "Old sourced", stage: "sourced", stage_since: daysAgo(25) });
    await addDeal({ name: "Late committed", stage: "committed", stage_since: daysAgo(14) });
    const stalled = await stalledDeals(env as any);
    expect(stalled[0]!.name).toBe("Late committed");
  });

  it("falls back to opened_at rather than exempting a row with no stage_since", async () => {
    // A migration that silently exempts old data from a new alarm is the wrong shape.
    const id = await addDeal({ name: "Legacy", stage: "diligence", stage_since: daysAgo(40) });
    await env.DB.prepare(`UPDATE deals SET stage_since = NULL, opened_at = ? WHERE id = ?`).bind(daysAgo(40), id).run();
    const stalled = await stalledDeals(env as any);
    expect(stalled[0]!.days_in_stage).toBeGreaterThanOrEqual(40);
  });

  it("puts the stalling deal ahead of the oldest open loop in the day's execution slot", async () => {
    /*
     * A loop is something she wrote down and can see. A deal that has quietly aged past its stage
     * threshold is the one she would otherwise discover at the point it is already dead.
     */
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(DAY(20), Date.parse(`${DAY(20)}T00:00:00Z`), Date.now()).run();
    await env.DB.prepare(`INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`)
      .bind(uid("loop"), DAY(20), "other", "An old loop", 1, daysAgo(60), Date.now()).run();
    await addDeal({ name: "Stalling deal", stage: "committed", stage_since: daysAgo(20), next_step: "Send the docs" });

    const c = await executionContract(env as any, 1);
    expect(c.action).toContain("Stalling deal");
    expect(c.action).toContain("Send the docs");
    expect(c.why).toContain("committed");
  });
});
