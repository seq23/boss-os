import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reconcileSpend, WORKERS_AI_ALLOWANCE_NOTE } from "../../src/worker/boss/spend/reconcile";
import { apiJson } from "./helpers";

/**
 * THREE LEDGERS RECORD MONEY HERE AND NOTHING ADDED THEM UP.
 *
 * The tests that matter are the ones proving a cost in ONE ledger reaches the total, because the
 * defect being fixed is not "the arithmetic is wrong" — it is "a whole ledger was invisible". A
 * suite that only checked the sum of one source would pass on the broken version.
 *
 * The other load-bearing test is that an unmeasurable cost is reported as unmeasurable. A zero
 * meaning "we could not look" and a zero meaning "nothing was spent" render identically and only
 * one of them is good news.
 */

const WINDOW_START = 1_700_000_000_000;

describe("spend reconciliation", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM usage_ledger`).run();
  });

  it("names every ledger it read, so a wrong figure is traceable to its source", async () => {
    const r = await reconcileSpend(env as any, WINDOW_START);
    const sources = r.parts.map((p) => p.source);
    expect(sources).toContain("usage_ledger");
    // Each part carries its own basis and a sentence — a bare number with no provenance is the
    // thing this replaces.
    for (const p of r.parts) {
      expect(["measured", "estimated", "unobservable"]).toContain(p.basis);
      expect(p.note.length).toBeGreaterThan(20);
    }
  });

  it("carries a cost in Boss's ledger through to the total", async () => {
    const before = await reconcileSpend(env as any, WINDOW_START);

    await env.DB
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, model_id, in_tokens, out_tokens, cost_micros, status)
         VALUES ('usg_recon_probe', ?, 'ops', 'mdl_qwen_fast', 100, 100, 4242, 'ok')`,
      )
      .bind(WINDOW_START + 1000)
      .run();

    const after = await reconcileSpend(env as any, WINDOW_START);
    expect(after.total_micros - before.total_micros).toBe(4242);
  });

  it("does NOT count a call that was blocked or errored — the negative case", async () => {
    // A blocked call carries a zero cost. Counting its ROW would make the ledger look busier than
    // the spending was, which is how a reader talks themselves out of trusting the number.
    const before = await reconcileSpend(env as any, WINDOW_START);
    await env.DB
      .prepare(
        `INSERT INTO usage_ledger (id, ts, lane, model_id, in_tokens, out_tokens, cost_micros, status)
         VALUES ('usg_blocked_probe', ?, 'ops', 'mdl_qwen_fast', 0, 0, 0, 'blocked_by_budget')`,
      )
      .bind(WINDOW_START + 2000)
      .run();

    const after = await reconcileSpend(env as any, WINDOW_START);
    expect(after.parts.find((p) => p.source === "usage_ledger")!.rows)
      .toBe(before.parts.find((p) => p.source === "usage_ledger")!.rows);
  });

  it("reports the Workers AI allowance as UNOBSERVABLE rather than as zero spend", async () => {
    const r = await reconcileSpend(env as any, WINDOW_START);
    const allowance = r.unobservable.find((p) => p.source === "workers_ai_allowance");

    expect(allowance).toBeDefined();
    expect(allowance!.basis).toBe("unobservable");
    // It must not be inside `parts`, because everything in `parts` is summed and a guess of zero
    // would enter the total as if it were known.
    expect(r.parts.map((p) => p.source)).not.toContain("workers_ai_allowance");
    // And it must say where the real figure lives, or it is just a shrug with extra structure.
    expect(allowance!.note).toBe(WORKERS_AI_ALLOWANCE_NOTE);
    expect(allowance!.note).toContain("ops:workers-ai-usage");
  });

  it("never claims to be fully measured while any part is an estimate", async () => {
    const r = await reconcileSpend(env as any, WINDOW_START);
    // Boss's own ledger is arithmetic over stored prices, one of which is explicitly unconfirmed
    // (0174). So this total is an estimate, and saying otherwise would launder it.
    expect(r.parts.some((p) => p.basis === "estimated")).toBe(true);
    expect(r.fully_measured).toBe(false);
  });

  it("is reachable over HTTP and defaults to the ops month window", async () => {
    const { status, body } = await apiJson("/api/system/spend-reconciliation");
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("total_micros");
    expect(body.data).toHaveProperty("parts");
    expect(body.data).toHaveProperty("unobservable");
    expect(body.data.window_started_at).toBeGreaterThan(0);
  });
});
