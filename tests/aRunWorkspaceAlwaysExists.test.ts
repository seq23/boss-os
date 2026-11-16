import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPlaceMaterials } from "../scripts/sync-agent/runner.mjs";

/**
 * 16 Nov 2026: the Monthly quality read's run on Claude's seat died with "spawn claude ENOENT" because
 * its workspace (~/.boss-os/quality) was never made: only a run with materials created its directory.
 */
describe("a run's workspace", () => {
  it("is made before the run even when the run carries no materials", async () => {
    const root = mkdtempSync(join(tmpdir(), "ws-"));
    const ws = join(root, ".boss-os", "quality");
    try {
      expect(existsSync(ws)).toBe(false);
      expect(await defaultPlaceMaterials(ws, [])).toEqual([]);
      expect(existsSync(ws)).toBe(true);
      // A repository path outside a Boss OS workspace is never invented (negative proof).
      const repo = join(root, "GitHub", "example");
      await defaultPlaceMaterials(repo, []);
      expect(existsSync(repo)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
