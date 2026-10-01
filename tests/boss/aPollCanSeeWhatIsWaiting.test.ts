import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";

/**
 * A POLL CAN SEE WHAT IS WAITING WITHOUT CLAIMING IT (1 Oct 2026). The five-minute poll on the owner's Mac asks the runs list for
 * `?status=running&unclaimed=1` before it refreshes the market and sky data and claims (review of #61: a poll that claimed the 06:00
 * briefing without refreshing them would write it from yesterday's files). The filter returns exactly what `/claim` would take: parked,
 * not finished, not claimed — and each row carries `claimed_at` so the agent can tell the Worker honoured the filter.
 */
const row = async (id: string, backend: string, over: { claimed_at?: number | null; finished_at?: number | null; status?: string }) =>
  env.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, started_at, claimed_at, finished_at, status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, null, backend, `env_${id}`, "{}", Date.now() - 60_000, over.claimed_at ?? null, over.finished_at ?? null, over.status ?? "running").run();

describe("GET /api/backends/runs?unclaimed=1", () => {
  it("returns only runs parked and waiting, each with claimed_at null; the unfiltered list still returns everything", async () => {
    await row("brn_wait_1", "bk_codex", {});
    await row("brn_claimed_1", "bk_codex", { claimed_at: Date.now() - 30_000 });
    await row("brn_done_1", "bk_codex", { finished_at: Date.now() - 10_000, status: "succeeded" });

    const waiting = await apiJson("/api/backends/runs?status=running&unclaimed=1");
    expect(waiting.status).toBe(200);
    const ids = waiting.body.data.runs.map((r: any) => r.id);
    expect(ids).toContain("brn_wait_1");
    expect(ids).not.toContain("brn_claimed_1");
    expect(ids).not.toContain("brn_done_1");
    for (const r of waiting.body.data.runs) {
      expect(Object.prototype.hasOwnProperty.call(r, "claimed_at")).toBe(true);
      expect(r.claimed_at).toBeNull();
      expect(r.finished_at).toBeNull();
    }

    const all = await apiJson("/api/backends/runs?status=running");
    const allIds = all.body.data.runs.map((r: any) => r.id);
    expect(allIds).toContain("brn_wait_1");
    expect(allIds).toContain("brn_claimed_1");
  });
});
