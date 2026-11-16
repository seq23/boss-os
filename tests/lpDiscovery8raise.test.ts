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
});
