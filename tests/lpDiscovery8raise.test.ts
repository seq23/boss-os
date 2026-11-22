import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script
import { isMcpError } from "../scripts/ops/lp-prospect-discovery.mjs";

describe("8Raise discovery: a rejected call is not a search (15 Nov 2026)", () => {
  it("tells an MCP error from a queued job", () => {
    expect(isMcpError("MCP error -32602: Input validation error: Invalid arguments for tool enrich_companies: Required at firms")).toBe(true);
    expect(isMcpError('{"isError": true, "content": []}')).toBe(true);
    expect(isMcpError('{\n  "status": "running",\n  "job_id": "9dec6bdf-bce5-4272-a1f0-b7ab55c869a6"\n}')).toBe(false);
  });
});

describe("8Raise discovery: a lookup still running is kept, never lost (15 Nov 2026)", () => {
  it("keeps unfinished jobs with their firm, drops malformed ones", async () => {
    // @ts-expect-error plain .mjs script
    const { withPending } = await import("../scripts/ops/lp-prospect-discovery.mjs");
    const out = withPending({ updated_at: "x", leads: [{ firm: "Example Family Office" }] }, [
      { job: "9dec6bdf-0000-4000-8000-000000000001", firm: "Example Family Office", kind: "family_office" },
      { job: null, firm: "No Job Holdings" },
      { job: "9dec6bdf-0000-4000-8000-000000000002" },
    ]);
    expect(out.leads).toHaveLength(1);
    expect(out.pending_jobs).toEqual([{ job: "9dec6bdf-0000-4000-8000-000000000001", firm: "Example Family Office", kind: "family_office" }]);
    expect(withPending({ leads: [] }, undefined).pending_jobs).toEqual([]);
  });
  it("a kept lookup remembers the 8Raise account that started it, so the poll asks that account", async () => {
    // @ts-expect-error plain .mjs script
    const { withPending } = await import("../scripts/ops/lp-prospect-discovery.mjs");
    const out = withPending({ leads: [] }, [{ job: "9dec6bdf-0000-4000-8000-000000000003", firm: "F", account: "EIGHTRAISE_TIME_2_READ_API_KEY" }]);
    expect(out.pending_jobs[0].account).toBe("EIGHTRAISE_TIME_2_READ_API_KEY");
  });
  it("the second Monday slot only collects when today's full run is on file", async () => {
    // @ts-expect-error plain .mjs script
    const { collectOnly } = await import("../scripts/ops/lp-prospect-discovery.mjs");
    const now = Date.parse("2026-11-16T15:15:00Z"); // 09:15 Central
    expect(collectOnly({ fullRunAt: "2026-11-16T13:00:00Z", now })).toBe(true);
    expect(collectOnly({ fullRunAt: "2026-11-09T13:00:00Z", now })).toBe(false);
    expect(collectOnly({ fullRunAt: null, now })).toBe(false);
    expect(collectOnly({ collectFlag: true, now })).toBe(true);
    const { readFileSync } = await import("node:fs");
    const line = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8").split("\n").find((l) => l.startsWith("install_l_job com.seq.boss-prospect-discovery "));
    expect(line).toMatch(/<integer>11<\/integer><key>Minute<\/key><integer>35<\/integer>/); // the Mac's day: 10:35 full run, 11:35 collect
  });
});
