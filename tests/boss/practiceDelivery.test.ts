import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, insertTask, row, uid } from "./helpers";
import { deliverPracticeWeek } from "../../src/worker/boss/duties/deliverReport";
import { weekIdInZone } from "../../src/shared/boss/timezone";

/**
 * IMANI'S WEEK, WHICH FOR ELEVEN SUNDAYS WENT NOWHERE.
 *
 * `duty_practice_week` declared `delivers: 'practice_week'` in 0192. No handler guarded that key and
 * no table of that name existed. So the duty fired at 17:00 Central every Sunday, spent its ~$0.15,
 * wrote its `delivers.json`, and the payload matched none of the four handlers and was dropped —
 * with no error, because "this run delivers something else" is the ordinary answer for every other
 * kind of work.
 *
 * Nothing failed. That is what makes it worth a test file: the tests it would have needed are not
 * tests of the handler, they are tests that the handler is REACHED at all.
 */

const CHICAGO = "America/Chicago";

async function clean() {
  await env.DB.prepare(`DELETE FROM practice_week`).run();
}
beforeEach(clean);

async function practiceTask(over: Record<string, unknown> = {}) {
  return insertTask({
    title: "Practice — the week ahead",
    input: JSON.stringify({ delivers: over.delivers ?? "practice_week" }),
  });
}

describe("delivering the week", () => {
  it("writes a row the duty used to have nowhere to put", async () => {
    const taskId = await practiceTask();
    const id = await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded",
      payload: {
        status: "complete",
        rituals: [{ occasion: "New moon", ritual: "Write the sentence and burn it", minutes: 20, what_it_is_for: "Naming what is being started." }],
        practice: { technique: "Implementation intentions", claim: "If-then planning raises follow-through.", source_name: "Gollwitzer", source_url: "https://example.org/p", how_to_try_it: "Write three if-thens." },
        body: { suggestion: "Eat the same breakfast every day this week.", why: "One fewer decision at the hour adherence breaks." },
        gaps: [],
      },
    });
    expect(id).toBeTruthy();

    const stored = await row<any>(`SELECT * FROM practice_week WHERE id = ?`, id);
    expect(stored.status).toBe("complete");
    expect(JSON.parse(stored.rituals)).toHaveLength(1);
    expect(JSON.parse(stored.practice).technique).toBe("Implementation intentions");
  });

  it("ignores a run that was contracted to deliver something else", async () => {
    const taskId = await practiceTask({ delivers: "tool_suggestions" });
    const id = await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded", payload: { status: "complete" },
    });
    // Returning null here is the ORDINARY case for four other kinds of run, which is precisely why
    // a missing handler produced silence rather than an error for eleven weeks.
    expect(id).toBeNull();
  });

  it("files the week in her zone, not in UTC", async () => {
    /*
     * SUNDAY IS THE LAST DAY OF AN ISO WEEK, which is what makes this dangerous rather than merely
     * untidy. The duty fires at 17:00 Central — 22:00 UTC, still Sunday — so the scheduled run is
     * fine. A RETRY IS NOT: past 19:00 Central it is already Monday in UTC, which is the next ISO
     * week, so a re-run after a failed Sunday would file the week-ahead brief under the week that
     * had just ended, with a number that looks perfectly plausible. Retrying a bad run is exactly
     * when this happens, and it is exactly when nobody is checking week numbers.
     */
    const sundayEvening = Date.parse("2026-09-14T02:00:00Z"); // 21:00 Central, still Sunday for her
    expect(weekIdInZone(sundayEvening, CHICAGO)).not.toBe(weekIdInZone(sundayEvening, "UTC"));

    const taskId = await practiceTask();
    await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded", payload: { status: "complete" }, now: sundayEvening,
    });
    const stored = await row<any>(`SELECT week_id FROM practice_week LIMIT 1`);
    expect(stored.week_id).toBe(weekIdInZone(sundayEvening, CHICAGO));
  });

  it("corrects a week rather than producing a second opinion about it", async () => {
    const taskId = await practiceTask();
    const at = Date.parse("2026-09-13T22:00:00Z");
    await deliverPracticeWeek(env as any, { taskId, runId: uid("run"), runStatus: "succeeded", payload: { status: "partial" }, now: at });
    await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded",
      payload: { status: "complete", body: { suggestion: "Better answer", why: "Re-run" } }, now: at + 3600_000,
    });
    const rows = await env.DB.prepare(`SELECT status FROM practice_week`).all<{ status: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.status).toBe("complete");
  });
});

describe("honesty", () => {
  it("will not let a week call itself complete while naming gaps", async () => {
    const taskId = await practiceTask();
    await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded",
      payload: { status: "complete", gaps: [{ wanted: "A source for the technique", why: "Paywalled" }] },
    });
    const stored = await row<any>(`SELECT status FROM practice_week LIMIT 1`);
    expect(stored.status).toBe("partial");
  });

  it("writes a row even when the run failed, so a blank never means two things", async () => {
    const taskId = await practiceTask();
    await deliverPracticeWeek(env as any, { taskId, runId: uid("run"), runStatus: "failed", payload: null });
    const stored = await row<any>(`SELECT status FROM practice_week LIMIT 1`);
    // "The week's practice has not been prepared" and "nothing has ever run" are different facts and
    // the screen has to be able to tell them apart. It costs one row to say.
    expect(stored.status).toBe("failed");
  });

  it("keeps an empty ritual list empty instead of inventing an occasion", async () => {
    const taskId = await practiceTask();
    await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded", payload: { status: "complete", rituals: [] },
    });
    const stored = await row<any>(`SELECT rituals FROM practice_week LIMIT 1`);
    expect(JSON.parse(stored.rituals)).toEqual([]);
  });
});

describe("reading it back", () => {
  it("says who prepares it and when, rather than rendering a blank", async () => {
    const res = await apiJson<any>("/api/spirit/practice-week");
    expect(res.status).toBe(200);
    expect(res.body.data.prepared).toBe(false);
    expect(res.body.data.reason).toMatch(/Imani/);
  });

  it("says out loud when the newest week is not this week", async () => {
    const taskId = await practiceTask();
    await deliverPracticeWeek(env as any, {
      taskId, runId: uid("run"), runStatus: "succeeded",
      payload: { status: "complete", week_id: "2020-W01" },
    });
    const res = await apiJson<any>("/api/spirit/practice-week");
    // Last week's rituals read as this week's is exactly the quiet wrongness the block exists to end.
    expect(res.body.data.prepared).toBe(true);
    expect(res.body.data.stale).toBe(true);
  });
});
