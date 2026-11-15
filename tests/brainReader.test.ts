import { describe, expect, it, vi } from "vitest";

const rows: Record<string, { slug: string; title: string; body_md: string; updated_at: string; updated_by: string }> = {
  "west-peek": { slug: "west-peek", title: "", body_md: "## Partners\nfacts <!-- confidential -->secret total<!-- /confidential --> end", updated_at: "2026-11-15", updated_by: "x" },
  "west-peek-ventures": { slug: "west-peek-ventures", title: "", body_md: "fund", updated_at: "2026-11-15", updated_by: "x" },
};
vi.mock("../src/worker/bossMount", () => ({ toBossEnv: (e: unknown) => e }));
vi.mock("../src/worker/boss/brains/store", () => ({ oneBrain: async (_e: unknown, s: string) => rows[s] ?? Promise.reject(new Error("none")) }));

describe("BrainReader: what another Worker on the account may read", () => {
  it("serves the west-peek brain with every confidential span removed", async () => {
    const { readBrainForPeer } = await import("../src/worker/boss/brains/brainReader");
    const got = await readBrainForPeer({} as never, "west-peek");
    expect(got?.body_md).toContain("## Partners");
    expect(got?.body_md).not.toContain("secret total");
  });
  it("refuses every brain not on the list, including the fund brain", async () => {
    const { readBrainForPeer } = await import("../src/worker/boss/brains/brainReader");
    expect(await readBrainForPeer({} as never, "west-peek-ventures")).toBeNull();
    expect(await readBrainForPeer({} as never, "personal")).toBeNull();
  });
});
