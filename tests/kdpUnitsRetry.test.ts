import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { gotoTwice } from "../scripts/ops/kdp-units.mjs";

// 16 Nov 2026: right after boot both report pages timed out and 8 Scorecard rows read "No number".
describe("a KDP report page that times out once is tried once more", () => {
  const page = (fails: string[]) => ({ calls: 0, async goto() { this.calls++; const f = fails.shift(); if (f) throw new Error(f); return "ok"; } });
  it("a timeout, then the page: read", async () => {
    const p = page(["page.goto: Timeout 60000ms exceeded."]);
    expect(await gotoTwice(p, "u", {}, { sleep: async () => {} })).toBe("ok");
    expect(p.calls).toBe(2);
  });
  it("two timeouts or any other error: thrown, never a third try", async () => {
    const twice = page(["Timeout", "Timeout"]);
    await expect(gotoTwice(twice, "u", {}, { sleep: async () => {} })).rejects.toThrow(/Timeout/);
    expect(twice.calls).toBe(2);
    const other = page(["net::ERR_NAME_NOT_RESOLVED"]);
    await expect(gotoTwice(other, "u", {}, { sleep: async () => {} })).rejects.toThrow(/ERR_NAME/);
    expect(other.calls).toBe(1);
  });
});
