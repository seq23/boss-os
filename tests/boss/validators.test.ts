/** The validator matrix route (1 Nov 2026): the Mac posts, the page reads, a wrong shape is refused. */
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { buildMatrix, parseReviewFile, registryFrom } from "../../src/shared/boss/validators/matrix.mjs";

describe("/api/validators", () => {
  it("says not read until the Mac posts, then serves the matrix with its count", async () => {
    const before = await apiJson<any>("/api/validators");
    expect(before.body.data).toMatchObject({ matrix: null, summary: null });
    const m = buildMatrix({
      reviews: [parseReviewFile("validators-alpha.json", [{ name: "validate:gone", protects: "p", why: "w", kind: "safety", runs: "pr" }])],
      registries: { alpha: registryFrom({ scripts: { "validate:other": "" } }) },
    });
    const put = await apiJson<any>("/api/validators", { method: "POST", body: m });
    expect(put.status).toBe(200);
    const after = await apiJson<any>("/api/validators");
    expect(after.body.data.matrix.rows).toHaveLength(1);
    expect(after.body.data.matrix.at).toBeGreaterThan(0);
    expect(after.body.data.summary).toBe("1 validator across 1 repo · 2 to tidy");
    expect(after.body.data.flagged).toMatch(/not in its repo's list \(alpha\)/);
  });
  it("refuses a snapshot of the wrong shape", async () => {
    const bad = await apiJson<any>("/api/validators", { method: "POST", body: { rows: "x" } });
    expect(bad.status).toBe(400);
  });
});
