import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { TODAY_BLOCKS, TODAY_GROUPS } from "../../src/worker/boss/routes/today";
import { TODAY_GROUPS as CLIENT_GROUPS } from "../../src/client/boss/pages/Today";
import { monthAhead } from "../../src/worker/boss/spirit/month";

/**
 * THE SCREEN ARRIVES IN PIECES, AND THE PIECES ARE THE WHOLE.
 *
 * ─── What happened, 13 September 2026 ──────────────────────────────────────
 *
 * Today answered 403 and Spirit went blank. Cloudflare's log for the requests: `outcome:
 * exceededCpu`, `cpuTime: 18`. The Worker is on the Free plan, which allows 10 ms of CPU per
 * request, and the owner's decision is that it stays there — "i'm not paying cloudflare." Nothing
 * on the screen was wrong. There was just too much of it in one request.
 *
 * So Today is now fetched as seven groups in parallel, each its own request, and the month's
 * important dates are computed in the browser from the inputs the Worker sends. These tests guard
 * the seams that split introduced:
 *
 *   1. THE GROUPS COVER THE THIRTEEN, EXACTLY ONCE. A key in no group would never be fetched — a
 *      block that exists and nothing invokes, the defect this repo keeps naming. A key in two would
 *      render twice.
 *   2. THE CLIENT'S LIST IS THE WORKER'S LIST. Two components each keeping their own list with no
 *      link is another named defect; this is the link.
 *   3. A GROUP RETURNS ITS BLOCKS IN CANON ORDER, and the groups stitched together are
 *      indistinguishable from the one-pass build the cron still does.
 *   4. THE MONTH'S DATES SURVIVE THE MOVE. The payload carries what the page needs to compute them,
 *      and computing them from it gives the month asked for.
 */

const ALL = TODAY_BLOCKS.map((b) => b.key);

describe("Today's groups", () => {
  it("cover every canon block exactly once", () => {
    const seen = Object.values(TODAY_GROUPS).flat();
    expect([...seen].sort()).toEqual([...ALL].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("are the same list on the client", () => {
    const worker = Object.values(TODAY_GROUPS).map((g) => [...g]);
    const client = CLIENT_GROUPS.map((g) => [...g]);
    expect(client).toEqual(worker);
  });

  it("each return only their blocks, in canon order", async () => {
    for (const group of Object.values(TODAY_GROUPS)) {
      const { status, body } = await apiJson(`/api/today?blocks=${group.join(",")}`);
      expect(status).toBe(200);
      const keys = body.data.blocks.map((b: any) => b.key);
      expect(keys).toEqual(ALL.filter((k) => (group as readonly string[]).includes(k)));
      for (const b of body.data.blocks) expect(b.order).toBe(ALL.indexOf(b.key) + 1);
      // Every group carries the day and the gates, so any one of them can stand in for the screen.
      expect(body.data.day.id).toBeTruthy();
      expect(Array.isArray(body.data.gates)).toBe(true);
    }
  });

  it("stitched together are the one-pass build", async () => {
    const pieces: any[] = [];
    for (const group of Object.values(TODAY_GROUPS)) {
      const { body } = await apiJson(`/api/today?blocks=${group.join(",")}`);
      pieces.push(...body.data.blocks);
    }
    pieces.sort((a, b) => a.order - b.order);
    const { body: whole } = await apiJson("/api/today");
    expect(pieces.map((b) => b.key)).toEqual(whole.data.blocks.map((b: any) => b.key));
    expect(pieces.map((b) => b.title)).toEqual(whole.data.blocks.map((b: any) => b.title));
    expect(pieces.map((b) => b.source_type)).toEqual(whole.data.blocks.map((b: any) => b.source_type));
  });

  it("leave the persisted day whole after a partial build", async () => {
    // Full build first, so every block is on disk; then one group, which must not shrink the column.
    await apiJson("/api/today");
    const { body } = await apiJson(`/api/today?blocks=executive_briefing`);
    const day = await env.DB
      .prepare(`SELECT day_flow_json FROM days WHERE id = ?`).bind(body.data.day.id)
      .first<{ day_flow_json: string }>();
    const stored = JSON.parse(day!.day_flow_json!) as { key: string; order: number }[];
    expect(stored.map((b) => b.key)).toEqual(ALL);
  });

  it("refuse a list naming no known block", async () => {
    expect((await apiJson("/api/today?blocks=nothing,here")).status).toBe(400);
  });
});

describe("the month's dates, computed where the CPU is free", () => {
  it("come from inputs the payload carries", async () => {
    const { body } = await apiJson("/api/spirit/month?month=2026-10");
    const inputs = body.data.highlights_inputs;
    expect(inputs).toBeTruthy();
    expect(typeof inputs.at).toBe("number");
    const highlights = monthAhead(inputs.birth ?? null, inputs.at);
    expect(highlights.month).toBe("2026-10");
    expect(Array.isArray(highlights.dates)).toBe(true);
    // The Worker no longer spends its budget on this.
    expect(body.data.highlights).toBeUndefined();
  });
});
