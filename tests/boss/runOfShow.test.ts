import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { scoreDay, FLOORS } from "../../src/worker/boss/today/verdict";
import { lensFor, TRACKS, coachingFocus } from "../../src/worker/boss/today/faculty";
import { selectSomatic, logSomatic, buildBodyContract, MOVEMENT_LANES } from "../../src/worker/boss/today/body";

/**
 * THE FOUR DOCUMENTS, AND THE THINGS ABOUT THEM THAT ARE EASY TO BREAK.
 *
 * These tests are not about whether the seven blocks render — that is obvious the moment anyone
 * looks. They pin the rules that live in her documents and would otherwise be silently violated by a
 * later edit: that a verdict is never guessed, that the movement engine actually rotates, that the
 * background track stays background, and that Law 4 cannot be broken by default.
 */

const DAY = "2031-04-07";
const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });

describe("the Run of Show — her seven blocks, not the machine's five", () => {
  it("renders seven in her order, and none of them is a system stage", async () => {
    const { body } = await apiJson(`/api/today?date=${DAY}`);
    const flow = body.data.blocks.find((b: any) => b.key === "day_flow");

    expect(flow.content.blocks.map((b: any) => b.title)).toEqual([
      "Morning Launch", "First Wealth Block", "Midday Stabilizer", "Afternoon Wealth / Admin",
      "Food Guardrail Check", "Evening Close", "Night Reset",
    ]);

    // THE REGRESSION THIS PINS: the block used to show Morning Gate / Agenda Calculation / Today's
    // Contract / Midday Reset / Night Gate — this system's plumbing, on the screen that is supposed
    // to be her day. The gates are still available, just not as the day.
    const rendered = JSON.stringify(flow.content.blocks);
    for (const stage of ["Morning Gate", "Agenda Calculation", "Night Gate", "Midday Reset"]) {
      expect(rendered).not.toContain(stage);
    }
    expect(flow.content.gates).toBeTruthy();
  });

  it("a gate closes the blocks it speaks for, and only those", async () => {
    await post("/api/today/gates/morning", { day_id: DAY, priorities: ["Close the raise"] });

    const { body } = await apiJson(`/api/today?date=${DAY}`);
    const blocks = body.data.blocks.find((b: any) => b.key === "day_flow").content.blocks;
    const by = Object.fromEntries(blocks.map((b: any) => [b.key, b]));

    expect(by.morning_launch.done).toBe(true);
    expect(by.morning_launch.done_source).toBe("gate");
    // Nothing this system watched proves a brokerage move happened. Claiming it would be the
    // system asserting something it cannot know.
    expect(by.first_wealth_block.done).toBe(false);
    expect(by.food_guardrail_check.done).toBe(false);
  });

  it("she can close and reopen the three blocks no gate can speak for", async () => {
    const closed = await post("/api/today/run-of-show/first_wealth_block", { day_id: DAY, done: true });
    expect(closed.status).toBe(200);
    expect(closed.body.data.blocks.find((b: any) => b.key === "first_wealth_block").done_source).toBe("boss");

    const reopened = await post("/api/today/run-of-show/first_wealth_block", { day_id: DAY, done: false });
    expect(reopened.body.data.blocks.find((b: any) => b.key === "first_wealth_block").done).toBe(false);
  });

  it("refuses a block that is not one of the seven", async () => {
    const { status } = await post("/api/today/run-of-show/lunch", { day_id: DAY });
    expect(status).toBe(404);
  });

  it("a gate never overwrites a block she closed herself", async () => {
    const day = "2031-04-09";
    await post("/api/today/run-of-show/midday_stabilizer", { day_id: day, done: true });
    const mine = await row<{ done_at: number }>(
      `SELECT done_at FROM run_of_show WHERE day_id = ? AND block_key = 'midday_stabilizer'`, day,
    );

    await post("/api/today/gates/midday", { day_id: day, checks: ["water"] });

    const after = await row<{ done_at: number; done_source: string }>(
      `SELECT done_at, done_source FROM run_of_show WHERE day_id = ? AND block_key = 'midday_stabilizer'`, day,
    );
    // "She did it at 9" and "a gate implied it at 2" are different facts, and the specific one wins.
    expect(after!.done_at).toBe(mine!.done_at);
    expect(after!.done_source).toBe("boss");
  });
});

describe("Law 4 versus the Midday Reset", () => {
  it("REFUSES a drop with no reason, because renegotiation must be explicit", async () => {
    const { status, body } = await post("/api/today/gates/midday", {
      day_id: "2031-04-11", checks: ["water"], dropped: ["The second wealth block"],
    });
    expect(status).toBe(400);
    expect(body.hint).toContain("REALITY changes");
  });

  it("allows the drop once reality is named, and records what was said", async () => {
    const day = "2031-04-12";
    const { status } = await post("/api/today/gates/midday", {
      day_id: day, checks: ["water"], dropped: ["The second wealth block"],
      because: "The seller moved the call to 4pm and it took the block.",
    });
    expect(status).toBe(201);

    const stored = await row<{ midday_adjustments: string }>(`SELECT midday_adjustments FROM days WHERE id = ?`, day);
    const adj = JSON.parse(stored!.midday_adjustments);
    expect(adj.because).toContain("seller moved the call");
    expect(adj.classification).toBe("stabilised");
  });

  it("does not stand in the way of a normal reset", async () => {
    const { status } = await post("/api/today/gates/midday", { day_id: "2031-04-13", checks: ["water"] });
    expect(status).toBe(201);
  });
});

describe("the Night Gate verdict — §14.2, which says do not guess", () => {
  it("scores a full day only when all five floors are met", () => {
    const all = Object.fromEntries(FLOORS.map((f) => [f.key, true]));
    expect(scoreDay(all).verdict).toBe("full");
  });

  it("an unanswered floor is unknown — never quietly counted either way", () => {
    const result = scoreDay({ movement: true });
    expect(result.floors.movement).toBe("met");
    expect(result.floors.hydration).toBe("unknown");
    expect(result.unknown).toHaveLength(4);
    // One floor met and continuity preserved is an MVD, not a failure. Law 5: zeros are allowed.
    expect(result.verdict).toBe("mvd");
  });

  it("will not call a day a Miss while floors are still unanswered", () => {
    // Nothing reported met, but nothing reported missed either. Scoring this a Miss would be the
    // guess §14.2 forbids, at the exact moment the guess costs something.
    const result = scoreDay({});
    expect(result.verdict).toBe("mvd");
    expect(result.reason).toContain("held open");
  });

  it("a Miss requires every floor answered and none met", () => {
    const none = Object.fromEntries(FLOORS.map((f) => [f.key, false]));
    const result = scoreDay(none);
    expect(result.verdict).toBe("miss");
    expect(result.reason).toContain("Law 1");
  });

  it("flexible items cannot create a Miss, because they are not floors at all", () => {
    // §13.3: BP medicine, supplements, skincare, tea. A day where all five floors are met is a Full
    // Day no matter what these say — the mechanism is that they are absent from FLOORS.
    const all = Object.fromEntries(FLOORS.map((f) => [f.key, true]));
    const result = scoreDay({ ...all, skincare: false, supplements: false, bp_medicine: false });
    expect(result.verdict).toBe("full");
    expect(FLOORS.map((f) => f.key)).not.toContain("skincare");
  });

  it("the gate stores the verdict and the floors behind it", async () => {
    const day = "2031-04-15";
    const { body } = await post("/api/today/gates/night", {
      day_id: day,
      attention: [{ focus_area: "Raise", pct: 60 }],
      floors: { manifestation: true, meaningful_work: true, movement: true, hydration: false, diet: true },
    });
    expect(body.data.verdict.verdict).toBe("mvd");

    const stored = await row<{ verdict: string; verdict_floors: string }>(
      `SELECT verdict, verdict_floors FROM days WHERE id = ?`, day,
    );
    // The report is kept, not just the conclusion. A verdict with no floor record behind it would
    // be exactly the guess the rule forbids, one step later.
    expect(stored!.verdict).toBe("mvd");
    expect(JSON.parse(stored!.verdict_floors).hydration).toBe("missed");
  });

  it("closes the night without a verdict rather than demanding five answers at 11pm", async () => {
    const day = "2031-04-16";
    const { status } = await post("/api/today/gates/night", {
      day_id: day, attention: [{ focus_area: "Raise", pct: 60 }],
    });
    expect(status).toBe(201);
    const stored = await row<{ verdict: string | null }>(`SELECT verdict FROM days WHERE id = ?`, day);
    expect(stored!.verdict).toBeNull();
  });
});

describe("blocks 08 and 09 — the faculty that was never actually missing", () => {
  it("rotates the lens on the date, so the same day always reads the same", () => {
    expect(lensFor("2031-04-07").key).toBe(lensFor("2031-04-07").key);
    const week = ["2031-04-07", "2031-04-08", "2031-04-09", "2031-04-10"].map((d) => lensFor(d).key);
    expect(new Set(week).size).toBe(4);
  });

  it("KEEPS THE BACKGROUND TRACK IN THE BACKGROUND", () => {
    // §10.6: Investor + AI Leverage "remains background unless explicitly promoted". Putting it in
    // the rotation would be this system promoting it on her behalf.
    const year = Array.from({ length: 40 }, (_, i) => lensFor(`2031-05-${String((i % 28) + 1).padStart(2, "0")}`).key);
    expect(year).not.toContain("investor_ai_leverage");
    expect(TRACKS.find((t) => t.key === "investor_ai_leverage")!.background).toBe(true);
  });

  it("names Recovery Mode on a recovery day, and says why", async () => {
    const focus = await coachingFocus(env as any, DAY, "recovery");
    expect(focus.mode.key).toBe("recovery");
    expect(focus.because).toContain("Recovery Day");
    expect(focus.law.n).toBe(2);
  });

  it("after a Miss, Law 1 is the one under pressure", async () => {
    await env.DB.prepare(`INSERT OR REPLACE INTO days (id, date_ts, created_at, verdict) VALUES (?,?,?,'miss')`)
      .bind("2031-06-01", Date.parse("2031-06-01T00:00:00Z"), Date.now())
      .run();
    const focus = await coachingFocus(env as any, "2031-06-02", null);
    expect(focus.law.n).toBe(1);
    expect(focus.mode.key).toBe("high_pressure");
    // It names the evidence rather than describing a mood.
    expect(focus.because).toContain("2031-06-01");
  });
});

describe("the Body contract and the novelty engine", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM movement_log`).run();
  });

  it("prints the stored morning sequence exactly, in order", async () => {
    const body = await buildBodyContract(env as any, DAY, null);
    // §6.9: "Print this exactly, in order." Not paraphrased, reordered or trimmed.
    expect(body.launch_sequence).toEqual([
      "10 in-bed leg raises per side",
      "10 seated knee-to-chest pulls per side",
      "10 seated torso twists per side",
      "30 seconds shoulder rolls",
      "30 seconds deep breathing",
    ]);
  });

  it("ACTUALLY ROTATES — the same movement does not come up two days running", async () => {
    const first = await selectSomatic(env as any, "2031-07-01");
    await logSomatic(env as any, "2031-07-01", first);
    const second = await selectSomatic(env as any, "2031-07-02");

    // The Somatic brain's §10: "avoid using the exact same major movement on consecutive days".
    // A novelty engine with no history is a random number generator, and would fail this by luck.
    for (const lane of MOVEMENT_LANES) {
      const a = first.find((s) => s.lane === lane.key)!;
      const b = second.find((s) => s.lane === lane.key)!;
      expect(b.movement).not.toBe(a.movement);
    }
  });

  it("logging is idempotent for a day, so re-rendering does not skew the rotation", async () => {
    const pick = await selectSomatic(env as any, "2031-07-05");
    await logSomatic(env as any, "2031-07-05", pick);
    await logSomatic(env as any, "2031-07-05", pick);
    const n = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM movement_log WHERE day_id = '2031-07-05'`);
    expect(n!.n).toBe(MOVEMENT_LANES.length);
  });

  it("THE MINIMUM VIABLE FALLBACK IS BED-ONLY, and nothing standing exists to leak into it", async () => {
    const reduced = await buildBodyContract(env as any, DAY, "recovery");
    expect(reduced.bed_only).toBe(true);

    // §6.8: "No standing, walking pad, outdoor walking, or out-of-bed exercise may appear in the
    // minimum-viable fallback." Checked against the whole contract, not just the fallback list,
    // because the way this rule breaks is a standing movement being added to a lane later.
    const everything = JSON.stringify(reduced).toLowerCase();
    for (const banned of ["walking pad", "outdoor walk", "standing", "treadmill", "jog"]) {
      expect(everything).not.toContain(banned);
    }
  });

  it("carries the safety stop and the language rule onto the screen", async () => {
    const body = await buildBodyContract(env as any, DAY, null);
    expect(body.safety_stop).toContain("do not push through");
    // §6.10 is explicit about what this lane may not claim, and the constraint has to be visible
    // where the text is, not filed in a policy document.
    expect(body.language_rule).toContain("does not cure trauma");
  });
});
