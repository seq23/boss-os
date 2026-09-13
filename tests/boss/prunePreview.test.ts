import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { prunePreview, pruneSnapshots, takeSnapshot } from "../../src/worker/boss/routes/vault";
import { restorable } from "../../src/client/boss/pages/Vault";
import { all } from "./helpers";

/**
 * CLEARING OLD SNAPSHOTS FOR SPACE, AND WHAT MUST STAY TRUE WHILE IT HAPPENS.
 *
 * The owner asked to "be able to clear old ones for space". Nothing in the UI called `pruneSnapshots`
 * and production sat at 68 rows, 56 of them tombstones. Adding the control is the easy half; these
 * tests are the half that matters, because the control DELETES BACKUPS.
 *
 * Every case here is written against a way the feature could be wrong rather than a way it could be
 * right: a preview that describes different rows from the ones removed, a picker that offers a
 * snapshot nothing can be restored from, a retention number that empties the vault.
 */

async function makeSnapshots(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    // skipIfUnchanged deliberately off, and a distinct clock per snapshot: retention is an ordering
    // rule and rows written inside the same millisecond have no order to test.
    const s = await takeSnapshot(env as any, `probe-${i}`, { now: 1_700_000_000_000 + i * 60_000 });
    ids.push(s.id);
  }
  return ids;
}

describe("clearing old snapshots", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM vault_snapshots`).run();
  });

  describe("the preview describes the prune that follows it", () => {
    it("names the same rows the prune actually removes", async () => {
      await makeSnapshots(6);

      const preview = await prunePreview(env as any, 2);
      expect(preview.removing).toBe(4);
      expect(preview.keeping).toBe(2);
      expect(preview.ids.length).toBe(4);

      const result = await pruneSnapshots(env as any, 2);
      expect(result.deleted).toBe(4);

      /*
       * THE POINT OF THE WHOLE PANEL. A confirmation that describes different rows from the ones it
       * removes manufactures consent for something else, so the preview and the deletion share one
       * selection. This asserts the SET, not the count — four and four could still be four
       * different snapshots.
       */
      const gone = await all<{ id: string }>(`SELECT id FROM vault_snapshots WHERE status = 'pruned'`);
      expect(gone.map((r) => r.id).sort()).toEqual([...preview.ids].sort());
    });

    it("reports bytes it would reclaim, and the prune reports what it actually reclaimed", async () => {
      await makeSnapshots(4);

      const preview = await prunePreview(env as any, 1);
      expect(preview.bytes_reclaimed).toBeGreaterThan(0);

      const result = await pruneSnapshots(env as any, 1);
      expect(result.bytes_reclaimed).toBe(preview.bytes_reclaimed);
    });

    it("writes nothing — a preview that deleted something would be a trap", async () => {
      const ids = await makeSnapshots(5);

      await prunePreview(env as any, 1);
      await prunePreview(env as any, 1);

      const live = await all<{ id: string }>(`SELECT id FROM vault_snapshots WHERE status = 'complete'`);
      expect(live.length).toBe(ids.length);
    });

    it("says plainly when there is nothing to remove rather than offering a no-op deletion", async () => {
      await makeSnapshots(2);
      const preview = await prunePreview(env as any, 90);
      expect(preview.removing).toBe(0);
      expect(preview.keeping).toBe(2);
      expect(preview.ids).toEqual([]);
    });
  });

  describe("the newest complete snapshot always survives", () => {
    it("keeps the newest when asked to keep zero", async () => {
      const ids = await makeSnapshots(4);
      const newest = ids[ids.length - 1]!;

      const preview = await prunePreview(env as any, 0);
      expect(preview.keep).toBe(1);
      expect(preview.ids).not.toContain(newest);

      const result = await pruneSnapshots(env as any, 0);
      expect(result.kept).toBe(1);

      const live = await all<{ id: string }>(`SELECT id FROM vault_snapshots WHERE status = 'complete'`);
      expect(live.map((r) => r.id)).toEqual([newest]);
    });

    it("keeps the newest when asked to keep a negative number", async () => {
      const ids = await makeSnapshots(3);
      await pruneSnapshots(env as any, -50);
      const live = await all<{ id: string }>(`SELECT id FROM vault_snapshots WHERE status = 'complete'`);
      expect(live.map((r) => r.id)).toEqual([ids[ids.length - 1]]);
    });

    /**
     * PRUNING NEVER EMPTIES THE RESTORE SET. This is the composed property — it is not enough that
     * one snapshot survives in the table; the screen must still be able to offer one.
     */
    it("leaves at least one restorable snapshot however many times it runs", async () => {
      await makeSnapshots(5);
      for (let i = 0; i < 4; i += 1) {
        await pruneSnapshots(env as any, 0);
        const rows = await all<any>(`SELECT * FROM vault_snapshots ORDER BY ts DESC`);
        expect(restorable(rows).length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("the restore picker offers only what can be restored", () => {
    it("drops pruned rows and keeps complete ones", async () => {
      await makeSnapshots(5);
      await pruneSnapshots(env as any, 2);

      const rows = await all<any>(`SELECT * FROM vault_snapshots ORDER BY ts DESC`);
      expect(rows.length).toBe(5);

      const offered = restorable(rows);
      expect(offered.length).toBe(2);
      expect(offered.every((s: any) => s.status === "complete")).toBe(true);
      // The tombstones are still THERE — that is the evidence the design preserves — just not
      // offered as somewhere to restore from.
      expect(rows.filter((r: any) => r.status === "pruned").length).toBe(3);
    });

    it("drops a row whose object never finished writing, not only pruned ones", async () => {
      await makeSnapshots(1);
      await env.DB
        .prepare(
          `INSERT INTO vault_snapshots (id, ts, label, status, r2_key) VALUES ('snp_halfwritten', ?, 'x', 'complete', NULL)`,
        )
        .bind(1_800_000_000_000)
        .run();

      const rows = await all<any>(`SELECT * FROM vault_snapshots ORDER BY ts DESC`);
      const offered = restorable(rows);
      expect(offered.map((s: any) => s.id)).not.toContain("snp_halfwritten");
      expect(offered.length).toBe(1);
    });
  });
});
