/**
 * ONE STUCK TITLE NEVER HALTS THE KINDLE QUEUE (18 Nov 2026). The Investment Banking title, Blocked by
 * Amazon's Content Review (case #52966733), was first in the queue; every per-title stop ended the
 * whole run, so ten approved books waited behind it each week. Only a stop about the window or the
 * account ends a run now; a stop about one title sets that title aside and the run goes on.
 * Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops libs, no types
import { stopEndsRun, RUN_STOPS, planTitle, queueOrder, underCaps } from "../scripts/ops/kdp-new-title.mjs";

describe("one stuck Kindle title never halts the queue", () => {
  it("only a stop about the window or the account ends the run", () => {
    for (const code of ["SIGNIN", "SIGNIN_NOT_DONE", "NO_PASSCODE", "UNLOCK_REFUSED", "PROFILE_IN_USE", "WEEKLY_TITLE_LIMIT"]) expect(stopEndsRun(code), code).toBe(true);
    for (const code of ["CONTENT_REJECTED", "BLOCKED", "QUALITY_GATE", "FIELD_NOT_FOUND", "UPLOAD_REFUSED", "PUBLISH_NOT_CONFIRMED", "SHELF_UNREADABLE", "FAILED", undefined, null])
      expect(stopEndsRun(code as any), String(code)).toBe(false);
    expect(RUN_STOPS.size).toBeGreaterThan(0);
  });

  it("every stop code the publisher can raise is judged, and the loop asks before it ends a run", () => {
    const src = readFileSync("scripts/ops/kdp-new-title.mjs", "utf8");
    const raised = new Set([...src.matchAll(/stop\("([A-Z_]+)"/g)].map((m) => m[1]));
    expect(raised.size).toBeGreaterThan(10);
    // A per-title catch that ends the run without asking stopEndsRun is the 16 Nov bug.
    const loop = src.slice(src.indexOf("} catch (e0) {"), src.indexOf("async function handBack"));
    expect(loop).toMatch(/if \(stopEndsRun\(e\.stop\)\) break;/);
    expect(loop).not.toMatch(/break; \/\/ the window is closed now/);
  });

  it("a Blocked title is set aside on the bookshelf read; the next approved titles still go, inside the caps", () => {
    const rows = [{ id: "A1", title: "Synthetic Blocked Book", lines: ["Synthetic Blocked Book", "Kindle eBook", "Blocked"] }];
    expect(planTitle("Synthetic Blocked Book", rows as any).action).toBe("blocked");
    const approved = [{ id: "j1", title: "Synthetic Blocked Book" }, ...Array.from({ length: 6 }, (_, i) => ({ id: `j${i + 2}`, title: `Synthetic Book ${i + 2}` }))];
    const ordered = queueOrder(approved, { titles: [{ title: "Synthetic Blocked Book", queue_priority: 1 }] });
    expect(ordered[0].title).toBe("Synthetic Blocked Book");
    const todo = ordered.slice(1).map((a: any) => ({ a, plan: { action: "create" } }));
    const { go, queued } = underCaps(todo, { drafts: 8, perRun: 5, draftCap: 10 });
    expect(go.map((t: any) => t.a.title)).toEqual(["Synthetic Book 2", "Synthetic Book 3"]);
    expect(queued).toHaveLength(4);
  });
});
