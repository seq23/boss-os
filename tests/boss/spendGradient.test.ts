import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion, BudgetExceeded, RoutingBlocked } from "../../src/worker/boss/router";
import { windowStart } from "../../src/worker/boss/router/budget";
import { setSpendLever } from "../../src/worker/boss/router/spend";
import {
  GRADIENT_CAUTIOUS_MICROS, GRADIENT_CHEAPER_MICROS, GRADIENT_HARD_STOP_MICROS,
  GRADIENT_NOTIFY_MICROS, appliesAt, gradientEffect, gradientState, isProtectedWork, monthPace,
} from "../../src/worker/boss/router/gradient";
import {
  MIN_HUMAN_CONFIRMATIONS, MIN_RUNS, judge, mayBePreferredForProtectedWork, rank, sufficiency,
} from "../../src/worker/boss/router/experience";
import { row, all, stubFetch, completionResponse } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const D = 1_000_000;

/** A mid-month moment, so a test about pacing is never a test about what day it is run. */
const JUN_1 = Date.UTC(2026, 5, 1);
const JUNE_DAYS = 30;
const onJune = (day: number) => JUN_1 + (day - 1) * 86_400_000 + 12 * 3_600_000;

const ordinary = {
  routeId: "rt_ops_default",
  lane: "ops",
  intakeKind: "drafting",
  messages: [{ role: "user" as const, content: "Say something short." }],
};

/**
 * PROTECTED WORK, as the system defines it rather than as a test asserts it. `decision_support` is
 * on `PROTECTED_INTAKE_KINDS`, it is allowed on every model on this route, and it maps to the
 * `research` backend kind Fireworks accepts — so the only thing that can stop it below is the
 * gradient, which is the point.
 */
const protectedWork = { ...ordinary, intakeKind: "decision_support" };

async function commissionFireworks(position: "FREE_ONLY" | "MODERATE" | "OPEN" = "MODERATE") {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_fireworks'`).run();
  await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
  await setSpendLever(env.DB, { position }, "test");
}

/**
 * Put money on the month WITHOUT tripping a lane's own hard stop.
 *
 * The window is stamped to this month deliberately: `rollBudgetWindows` runs first thing in
 * `routeCompletion` and zeroes any row whose window has lapsed, so a figure written against a stale
 * window is a figure the router never sees.
 */
async function spendThisMonth(opsMicros: number, tradingMicros = 0) {
  const start = windowStart("month", Date.now());
  await env.DB
    .prepare(`UPDATE budgets SET spent_micros = ?, window_started_at = ? WHERE lane='ops' AND period='month'`)
    .bind(opsMicros, start).run();
  await env.DB
    .prepare(`UPDATE budgets SET spent_micros = ?, window_started_at = ? WHERE lane='trading' AND period='month'`)
    .bind(tradingMicros, start).run();
}

/**
 * The Workers AI binding this test config does not attach, supplied by hand — the same helper
 * `router.test.ts` uses. Without it the free route is refused at AVAILABILITY for a missing
 * credential, which would make this test pass for the wrong reason: no substitution was available
 * to decline.
 */
function withAi(text = "Free tier answer.") {
  const calls: string[] = [];
  const bound = Object.create(env) as typeof env & { AI: { run: (m: string, i: unknown) => Promise<unknown> } };
  (bound as any).AI = {
    async run(model: string) {
      calls.push(model);
      return { response: text, usage: { prompt_tokens: 20, completion_tokens: 10 } };
    },
  };
  return { bound, calls };
}

beforeEach(async () => {
  await spendThisMonth(0, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the gradient is pro-rated against the month elapsed", () => {
  /**
   * HER OWN EXAMPLE, BOTH HALVES. "$8 on the 3rd is over pace and should tighten; $8 on the 25th is
   * on pace and should not." A raw total cannot tell those apart — it is the same $8.
   */
  it("reads $8 on the 3rd and $8 on the 25th as different postures", () => {
    const third = monthPace(8 * D, onJune(3));
    const twentyFifth = monthPace(8 * D, onJune(25));

    expect(third.spentMicros).toBe(twentyFifth.spentMicros);
    expect(third.pacedMicros).toBeGreaterThan(GRADIENT_CAUTIOUS_MICROS * 5);
    expect(twentyFifth.pacedMicros).toBeLessThan(GRADIENT_CAUTIOUS_MICROS);
    expect(third.pacedMicros).toBeGreaterThan(twentyFifth.pacedMicros);
  });

  it("floors the elapsed fraction at one day, so the 1st is not an austerity cliff made of the clock", () => {
    const fiveMinutesIn = monthPace(1 * D, JUN_1 + 5 * 60_000);
    expect(fiveMinutesIn.elapsedFloored).toBe(true);
    // A whole day's share of a 30-day month, not five minutes' share.
    expect(fiveMinutesIn.elapsed).toBeCloseTo(1 / JUNE_DAYS, 6);
    expect(fiveMinutesIn.pacedMicros).toBe(30 * D);
  });

  it("is continuous rather than a cliff — the per-run factor slides with no step", async () => {
    const factors: number[] = [];
    for (const spent of [0, 2 * D, 4 * D, 6 * D, 8 * D, 10 * D]) {
      await spendThisMonth(spent);
      // Mid-month, so `paced` is roughly double `spent` and the whole ladder is walked.
      const state = await gradientState(env.DB, "MODERATE", onJune(15));
      factors.push(state.paidCeilingFactor);
    }
    // Monotone with no step anywhere, and strictly falling until it reaches its floor. The floor is
    // the one place two readings may be equal: below the cautious rung it must always be moving.
    for (let i = 1; i < factors.length; i++) expect(factors[i]).toBeLessThanOrEqual(factors[i - 1]);
    for (let i = 1; i < 4; i++) expect(factors[i]).toBeLessThan(factors[i - 1]);
    expect(factors[0]).toBe(1);
    expect(factors[factors.length - 1]).toBeCloseTo(0.2, 6);
  });

  it("reads the raw total for the two money rungs and the paced one for the three care rungs", async () => {
    // $52 spent one day into the month: pacing says catastrophic, the raw total says "notify".
    await spendThisMonth(52 * D);
    const state = await gradientState(env.DB, "MODERATE", JUN_1 + 3_600_000);
    expect(state.band).toBe("CAUTIOUS");
    expect(state.notify).toBe(true);
    expect(state.hardStop).toBe(false); // $52 raw, nowhere near $75, whatever the forecast says.

    // And a forecast alone never raises the alarm: $4 on day one paces past $50 and must not notify.
    await spendThisMonth(4 * D);
    const early = await gradientState(env.DB, "MODERATE", JUN_1 + 3_600_000);
    expect(early.pacedMicros).toBeGreaterThan(GRADIENT_NOTIFY_MICROS);
    expect(early.notify).toBe(false);
    expect(early.hardStop).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("her hand always wins — the gradient never moves the lever", () => {
  it("runs only inside MODERATE", () => {
    expect(appliesAt("MODERATE")).toBe(true);
    expect(appliesAt("FREE_ONLY")).toBe(false);
    expect(appliesAt("OPEN")).toBe(false);
  });

  it("stays free at FREE_ONLY with $0 spent, and stays open at OPEN with $40 spent", async () => {
    await spendThisMonth(0);
    const free = await gradientState(env.DB, "FREE_ONLY", onJune(15));
    expect(free.applies).toBe(false);
    expect(gradientEffect(free, false)).toMatchObject({ freeFirst: false, perRunFactor: 1 });

    await spendThisMonth(40 * D);
    const open = await gradientState(env.DB, "OPEN", onJune(15));
    expect(open.applies).toBe(false);
    expect(gradientEffect(open, false)).toMatchObject({ paidForProtectedOnly: false, perRunFactor: 1 });
  });

  it("leaves settings.spend_lever exactly where she put it, at every rung", async () => {
    await setSpendLever(env.DB, { position: "MODERATE" }, "test");
    for (const spent of [0, 6 * D, 12 * D, 55 * D, 80 * D]) {
      await spendThisMonth(spent);
      await gradientState(env.DB, "MODERATE", onJune(20));
      const stored = await row<{ value: string }>(`SELECT value FROM settings WHERE key = 'spend_lever'`);
      expect(stored!.value).toBe("MODERATE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("protected work is never downgraded, anywhere on the gradient", () => {
  it("recognises protected work by risk, sensitivity and intake kind", () => {
    expect(isProtectedWork({ risk: "high" })).toBe(true);
    expect(isProtectedWork({ sensitivity: "restricted" })).toBe(true);
    expect(isProtectedWork({ intakeKind: "trading" })).toBe(true);
    expect(isProtectedWork({ intakeKind: "decision_support" })).toBe(true);
    expect(isProtectedWork({ risk: "low", sensitivity: "private", intakeKind: "drafting" })).toBe(false);
  });

  /** Drive the spend past EVERY threshold and assert nothing is ever taken away from it. */
  it("applies no effect at all to protected work at any spend level", async () => {
    const levels = [0, GRADIENT_CHEAPER_MICROS + 1, GRADIENT_CAUTIOUS_MICROS + 1, GRADIENT_NOTIFY_MICROS + 1, GRADIENT_HARD_STOP_MICROS + 1];
    expect(levels.length).toBeGreaterThan(0); // Rule 0: an empty loop proves nothing.
    for (const spent of levels) {
      await spendThisMonth(Math.min(spent, 70 * D), Math.max(0, spent - 70 * D));
      const state = await gradientState(env.DB, "MODERATE", onJune(20));
      const effect = gradientEffect(state, true);
      expect(effect.perRunFactor).toBe(1);
      expect(effect.freeFirst).toBe(false);
      expect(effect.paidForProtectedOnly).toBe(false);
      expect(effect.allowFrontierForOrdinaryWork).toBe(true);
    }
  });

  /**
   * AND IN THE ROUTER, NOT ONLY IN THE ARITHMETIC. The same work is routed for real at every rung
   * the gradient has, and must come back on the capable declared model each time.
   */
  it("still routes protected work to the capable model past every gradient rung", async () => {
    await commissionFireworks("MODERATE");
    const levels = [0, GRADIENT_CHEAPER_MICROS + D, GRADIENT_CAUTIOUS_MICROS + D, GRADIENT_NOTIFY_MICROS + D];
    expect(levels.length).toBe(4);
    let n = 0;
    for (const spent of levels) {
      await spendThisMonth(spent);
      restore?.();
      restore = stubFetch(() => completionResponse("Considered.", 100, 50));
      const result = await routeCompletion(env, { ...protectedWork, taskId: `tsk_prot_${n++}` });
      expect(result.modelId).toBe("mdl_kimi_k2");
      expect(result.freeTier).toBe(false);
      expect(result.degraded).toBe(false);
    }
  });

  it("holds ORDINARY work off the same paid model at the cautious rung, and says why", async () => {
    await commissionFireworks("MODERATE");
    await spendThisMonth(GRADIENT_CAUTIOUS_MICROS + D);
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("should not run"); });

    await expect(routeCompletion(env, { ...ordinary, taskId: "tsk_ord_1" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);

    const decision = await row<{ candidates: string }>(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_ord_1'`);
    expect(decision!.candidates).toContain("held back");
    expect(decision!.candidates).toContain("protected work is unaffected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("at FREE_ONLY, work that needs a paid model fails loudly", () => {
  it("stops and names the work and the lever instead of substituting a free model", async () => {
    // Fireworks commissioned and reachable, but the lever is at $0. The free Workers AI route is
    // provisioned and working, which is exactly the substitution that must NOT happen.
    await commissionFireworks("FREE_ONLY");
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
    let paidCalled = false;
    restore = stubFetch(() => { paidCalled = true; return completionResponse("should not run"); });

    /*
     * `relationship` rather than `decision_support`, and the difference is the whole test. It is
     * protected work either way, but it maps to the `document` backend kind, which Workers AI
     * accepts — so `mdl_cf_llama33_70b` IS a live, eligible, free candidate sitting right behind the
     * paid primary. Without the stop, the loop reaches it and answers. This is the substitution
     * being available and not taken.
     */
    const { bound, calls } = withAi();
    const err = await routeCompletion(bound, { ...ordinary, intakeKind: "relationship", taskId: "tsk_free_1" }).catch((e) => e);

    expect(err).toBeInstanceOf(RoutingBlocked);
    expect(err.message).toContain("protected work");
    expect(err.message).toContain("FREE_ONLY");
    expect(err.message).toContain("Nothing was substituted.");
    expect(err.hint).toContain("lever");
    expect(paidCalled).toBe(false);
    // THE SUBSTITUTION WAS THERE AND WAS NOT TAKEN. The free 70B was eligible and reachable.
    expect(calls).toEqual([]);
    const considered = await row<{ candidates: string }>(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_free_1'`);
    expect(considered!.candidates).toContain("mdl_cf_llama33_70b");
    expect(considered!.candidates).toContain("Nothing was substituted.");

    const usage = await all(`SELECT id FROM usage_ledger WHERE task_id = 'tsk_free_1' AND status = 'ok'`);
    expect(usage.length).toBe(0);
  });

  it("does not stop ordinary work, which is allowed to take the free route", async () => {
    await commissionFireworks("FREE_ONLY");
    const state = await gradientState(env.DB, "FREE_ONLY", onJune(15));
    expect(state.applies).toBe(false);
    expect(state.capabilityCost).toContain("stops and says so");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the $75 line stops everything, and a bypass she raised moves it", () => {
  it("refuses a billed call once the month's spend crosses $75, even though neither lane has", async () => {
    await commissionFireworks("MODERATE");
    // $70 ops (limit $75) and $8 trading (limit $10): neither lane hard-stops, the month is $78.
    await spendThisMonth(70 * D, 8 * D);
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("should not run"); });

    await expect(routeCompletion(env, { ...protectedWork, taskId: "tsk_line_1" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);
    const decision = await row<{ candidates: string }>(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_line_1'`);
    expect(decision!.candidates).toContain("$75.00 line");
  });

  it("runs again under a month bypass the owner raised, and the ceiling moves rather than vanishing", async () => {
    await commissionFireworks("MODERATE");
    await spendThisMonth(70 * D, 8 * D);
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO spend_bypass (id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind("byp_test_month", "month", null, 100 * D, "closing the quarter and I want this finished", "owner", now - 1000, now + 3_600_000)
      .run();

    restore = stubFetch(() => completionResponse("Ran under the bypass.", 100, 50));
    const result = await routeCompletion(env, { ...protectedWork, taskId: "tsk_line_2" });
    expect(result.modelId).toBe("mdl_kimi_k2");

    // And the moved ceiling is still a ceiling: past $100 it refuses again.
    await spendThisMonth(95 * D, 8 * D);
    let called = false;
    restore?.();
    restore = stubFetch(() => { called = true; return completionResponse("should not run"); });
    await expect(routeCompletion(env, { ...protectedWork, taskId: "tsk_line_3" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("an unproven model is unknown, not good", () => {
  it("will not call a model proven on router rows alone", () => {
    const routerOnly = judge("drafting", "mdl_x", { runs: 40, succeeded: 40, reworked: 0, rejected: 0, human: 0 });
    expect(routerOnly.verdict).toBe("unknown");
    expect(routerOnly.sentence).toContain("Unknown, not good.");
    expect(routerOnly.sentence).toContain("a person decided");
  });

  it("will not call a model proven on too few runs", () => {
    const thin = judge("drafting", "mdl_x", { runs: MIN_RUNS - 1, succeeded: MIN_RUNS - 1, reworked: 0, rejected: 0, human: MIN_HUMAN_CONFIRMATIONS });
    expect(thin.verdict).toBe("unknown");
  });

  it("calls a model proven only with both enough runs and enough human decisions", () => {
    const proven = judge("drafting", "mdl_x", { runs: MIN_RUNS, succeeded: MIN_RUNS, reworked: 0, rejected: 0, human: MIN_HUMAN_CONFIRMATIONS });
    expect(proven.verdict).toBe("proven");
    const poor = judge("drafting", "mdl_y", { runs: MIN_RUNS + 5, succeeded: 2, reworked: 3, rejected: 5, human: MIN_HUMAN_CONFIRMATIONS });
    expect(poor.verdict).toBe("poor");
  });

  it("ranks proven above unknown above poor, and lets nothing but proven be preferred for protected work", () => {
    const proven = judge("drafting", "a", { runs: 10, succeeded: 10, reworked: 0, rejected: 0, human: 5 });
    const unknown = judge("drafting", "b", { runs: 1, succeeded: 1, reworked: 0, rejected: 0, human: 1 });
    const poor = judge("drafting", "c", { runs: 10, succeeded: 1, reworked: 0, rejected: 9, human: 5 });
    expect(rank(proven)).toBeLessThan(rank(unknown));
    expect(rank(unknown)).toBeLessThan(rank(poor));
    expect(rank(undefined)).toBe(rank(unknown));

    expect(mayBePreferredForProtectedWork(proven)).toBe(true);
    expect(mayBePreferredForProtectedWork(unknown)).toBe(false);
    expect(mayBePreferredForProtectedWork(undefined)).toBe(false);
  });

  it("says out loud that there is not enough evidence yet, and how much it needs", async () => {
    const s = await sufficiency(env.DB);
    expect(s.sufficient).toBe(false);
    expect(s.provenPairs).toBe(0);
    expect(s.sentence).toContain("UNKNOWN");
    expect(s.sentence).toContain(String(MIN_RUNS));
    expect(s.sentence).toContain(String(MIN_HUMAN_CONFIRMATIONS));
  });

  it("records a router-sourced outcome when a real run completes", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => completionResponse("Drafted.", 100, 50));
    await routeCompletion(env, { ...ordinary, taskId: "tsk_exp_1" });

    const rows = await all<{ task_kind: string; model_id: string; outcome: string; source: string }>(
      `SELECT task_kind, model_id, outcome, source FROM model_job_outcome WHERE task_id = 'tsk_exp_1'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ task_kind: "drafting", model_id: "mdl_kimi_k2", outcome: "succeeded", source: "router" });

    // And one router row still leaves the pair UNKNOWN. That is the honest limit, asserted.
    const s = await sufficiency(env.DB);
    expect(s.sufficient).toBe(false);
  });
});
