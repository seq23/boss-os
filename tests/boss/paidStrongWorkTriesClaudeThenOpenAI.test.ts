import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orderCandidates, vendorFamily } from "../../src/shared/boss/router/candidateOrder.mjs";
import { routeCompletion } from "../../src/worker/boss/router";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, completionResponse, row, stubFetch } from "./helpers";

/**
 * "CLAUDE FIRST AND OPENAI SECOND" for work that needs a strong model, once money is being spent.
 * Free routes still come first, and the lever still decides whether any paid route may run.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const NOW = Date.now();
const m = (slug: string, provider_id = "prv_openrouter", tier = "general") =>
  ({ slug, provider_id, display_name: slug, capability_tier: tier, ladder_rung: 200 });

describe("the comparator", () => {
  it("names the vendor by what the row is, not by its display name", () => {
    expect(vendorFamily(m("anthropic/claude-sonnet-5"))).toBe(0);
    expect(vendorFamily(m("claude-sonnet-5", "prv_anthropic"))).toBe(0);
    expect(vendorFamily(m("openai/gpt-5-mini"))).toBe(1);
    expect(vendorFamily(m("gpt-5", "prv_openai"))).toBe(1);
    expect(vendorFamily(m("google/gemini-2.5-flash-lite"))).toBe(2);
    expect(vendorFamily({ slug: "x", provider_id: "prv_openrouter", display_name: "Claude lookalike" } as any)).toBe(2);
  });
});

describe("the router, with a marker", () => {
  beforeEach(async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL WHERE id = 'bk_openrouter'`).run();
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever','OPEN',?) ON CONFLICT(key) DO UPDATE SET value = 'OPEN'`).bind(Date.now()).run();
  });
  afterEach(async () => { await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run(); });

  async function chosenSlug(prefer: boolean): Promise<{ slug: string; hosts: string[] }> {
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("ok", 10, 10); });
    const e = Object.create(env) as any; e.OPENROUTER_API_KEY = "k";
    // Deal wording reads as private, so the training-permitting free rungs are refused and only paid rungs survive.
    const r = await routeCompletion(e, {
      routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", intakeKind: "research",
      preferStrongVendors: prefer,
      messages: [{ role: "user", content: "Summarise the LP commitment, valuation and allocation schedule for the fund." }],
    } as any);
    const d = await row<any>(`SELECT chosen_model_id FROM routing_decisions WHERE id = (SELECT id FROM routing_decisions ORDER BY ts DESC LIMIT 1)`);
    const mm = await row<any>(`SELECT slug FROM models WHERE id = ?`, d.chosen_model_id ?? r.modelId);
    restore?.(); restore = null;
    return { slug: mm.slug, hosts };
  }

  it("without the marker the cheapest paid survivor answers; with it a Claude-family model does", async () => {
    const plain = await chosenSlug(false);
    const strong = await chosenSlug(true);
    expect(strong.slug, `plain=${plain.slug}`).toMatch(/^anthropic\//);
    expect(strong.hosts).toContain("openrouter.ai");
  });

  it("falls to OpenAI when no Claude model survives", async () => {
    await env.DB.prepare(`UPDATE models SET enabled = 0 WHERE slug LIKE 'anthropic/%'`).run();
    try {
      const r = await chosenSlug(true);
      expect(r.slug).toMatch(/^openai\//);
    } finally {
      await env.DB.prepare(`UPDATE models SET enabled = 1 WHERE slug LIKE 'anthropic/%'`).run();
    }
  });

  it("never lets the marker outrank a free route", () => {
    const ordered = orderCandidates([m("anthropic/claude-sonnet-5"), m("x/free-model:free")],
      (x: any) => (x.slug.endsWith(":free") ? 0 : vendorFamily(x) * 100_000_000 + 5000));
    expect(ordered[0]!.slug).toBe("x/free-model:free");
  });
});
