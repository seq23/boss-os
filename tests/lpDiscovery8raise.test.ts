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
