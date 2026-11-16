import { describe, expect, it, vi } from "vitest";
import { spend8r, pickAccount, NEVER_KEYS } from "../scripts/ops/lp-eightraise.mjs";
import { canSpend, monthSpent } from "../src/shared/boss/lp/plan.mjs";

// Her ruling 16 Nov 2026: "use the 2 brokerage ones" — the free accounts first, then the paid one.
describe("prospecting spends the two free brokerage accounts before the paid one", () => {
  const env = { EIGHTRAISE_CRYPTOCLEARR_API_KEY: "c", EIGHTRAISE_TIME_2_READ_API_KEY: "t", EIGHTRAISE_SEQ_TAYLOR_API_KEY: "p", EIGHTRAISE_WESTPEEK_API_KEY: "w" };
  const left: Record<string, number> = { EIGHTRAISE_CRYPTOCLEARR_API_KEY: 0, EIGHTRAISE_TIME_2_READ_API_KEY: 10, paid: 100 };
  const call = vi.fn((tool: string, _args?: unknown, key?: string | null) => tool === "get_usage" ? JSON.stringify({ credits_remaining: left[key ?? "paid"] }) : "ok");

  it("a spent free account falls to the next free one; the paid budget is never asked", async () => {
    const api = { post: vi.fn(async (_p: string, _b: Record<string, unknown>) => ({ allowed: true })) };
    const r = await spend8r(api, { purpose: "prospecting", tool: "search_investors", args: {}, credits: 1 }, { call, env });
    expect(r.account).toBe("EIGHTRAISE_TIME_2_READ_API_KEY");
    expect(call).toHaveBeenCalledWith("search_investors", {}, "EIGHTRAISE_TIME_2_READ_API_KEY");
    expect(api.post.mock.calls.every((c) => c[1].purpose === "free_prospecting")).toBe(true);
  });
  it("both free accounts at 0 → the paid account, under the paid budget", async () => {
    left.EIGHTRAISE_TIME_2_READ_API_KEY = 0;
    const api = { post: vi.fn(async (_p: string, _b: Record<string, unknown>) => ({ allowed: true })) };
    const r = await spend8r(api, { purpose: "prospecting", tool: "search_investors", args: {}, credits: 1 }, { call, env });
    expect(r.account).toBeUndefined();
    expect(api.post.mock.calls[0]![1].purpose).toBe("prospecting");
  });
  it("the West Peek account is never used, and buyers work never uses a free account", () => {
    expect(NEVER_KEYS).toContain("EIGHTRAISE_WESTPEEK_API_KEY");
    expect(pickAccount({ purpose: "prospecting", credits: 1, env, names: ["EIGHTRAISE_WESTPEEK_API_KEY"], remaining: () => 10 })).toBeNull();
    expect(pickAccount({ purpose: "buyers_for_supply", credits: 1, env, remaining: () => 10 })).toBeNull();
  });
  it("free spends are not counted against the paid month or the floor", () => {
    const month = "2026-12";
    const ledger = [{ month, purpose: "free_prospecting", credits: 10, company: "A" }, { month, purpose: "prospecting", credits: 3, company: null }];
    expect(monthSpent(ledger, month)).toBe(3);
    expect(canSpend({ purpose: "free_prospecting", credits: 1, ledger, balance: 1, month }).ok).toBe(true);
    expect(canSpend({ purpose: "free_prospecting", credits: 1, ledger, balance: 0, month }).ok).toBe(false);
    expect(canSpend({ purpose: "free_prospecting", credits: 1, company: "a", ledger, balance: 5, month }).ok).toBe(false);
  });
});
