/**
 * The Mac half of the whole-or-nothing grid push (eng sweep row 10, 22 Nov 2026): one push id,
 * every part carrying the total, the last part marked, and a push only counted as landed when
 * Boss OS says it committed.
 */
import { describe, expect, it } from "vitest";
import { gridRunEnd, onceEach, pushWhole } from "../scripts/ops/interest-grid.mjs";

function fakeSession(fail?: (n: number) => boolean, committed = true) {
  const calls: any[] = [];
  return {
    calls,
    post: async (_route: string, body: any) => {
      calls.push(body);
      if (fail?.(calls.length)) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ data: { committed: body.last && committed, stored: body.last && committed ? body.total : null } }) };
    },
  };
}

describe("pushWhole", () => {
  it("sends every part under one push id with the total, the last one marked", async () => {
    const s = fakeSession();
    const res = await pushWhole(s, "/capital/deals", "rows", Array.from({ length: 1100 }, (_, i) => i));
    expect(res.ok).toBe(true);
    expect(s.calls.map((c) => [c.rows.length, c.total, c.last])).toEqual([[500, 1100, false], [500, 1100, false], [100, 1100, true]]);
    expect(new Set(s.calls.map((c) => c.push)).size).toBe(1);
    expect(s.calls.every((c) => c.allowEmpty === undefined)).toBe(true);
  });

  it("never pushes an empty grid", async () => {
    const s = fakeSession();
    expect((await pushWhole(s, "/capital/deals", "rows", [])).ok).toBe(false);
    expect(s.calls).toHaveLength(0);
  });

  it("OUTAGE: stops at a failed part and reports not pushed", async () => {
    const s = fakeSession((n) => n === 2);
    const res = await pushWhole(s, "/capital/deals", "rows", Array.from({ length: 1100 }, (_, i) => i));
    expect(res.ok).toBe(false);
    expect(s.calls).toHaveLength(2);
  });

  it("a last part Boss OS did not commit is not a push", async () => {
    const s = fakeSession(undefined, false);
    expect((await pushWhole(s, "/capital/deals", "rows", [1, 2])).ok).toBe(false);
  });

  it("empty matches go only when asked, as one marked part", async () => {
    const s = fakeSession();
    expect((await pushWhole(s, "/capital/matches", "matches", [], { allowEmpty: true })).ok).toBe(true);
    expect(s.calls).toEqual([expect.objectContaining({ matches: [], total: 0, last: true, allowEmpty: true })]);
  });

  it("reports the rows Boss OS saved", async () => {
    expect((await pushWhole(fakeSession(), "/capital/deals", "rows", [1, 2, 3])).stored).toBe(3);
  });
});

describe("how the run ends", () => {
  it("OUTAGE: a push that did not land is a named stop and a non-zero exit, and OUTPUT counts only what was saved", () => {
    const good = gridRunEnd({ reached: true, grid: { ok: true, stored: 853 }, matches: { ok: true } });
    expect(good).toEqual({ stops: [], exitCode: 0, output: "OUTPUT 853 grid rows" });
    const grid = gridRunEnd({ reached: true, grid: { ok: false, why: "part 2: 503" }, matches: null });
    expect(grid.stops[0]).toMatch(/^NAMED STOP \[GRID_NOT_PUSHED\] part 2: 503/);
    expect(grid.exitCode).not.toBe(0);
    expect(grid.output).toBe("OUTPUT 0 grid rows");
    const m = gridRunEnd({ reached: true, grid: { ok: true, stored: 5 }, matches: { ok: false, why: "last part not committed" } });
    expect(m.stops[0]).toMatch(/MATCHES_NOT_PUSHED/);
    expect(m.exitCode).not.toBe(0);
    const away = gridRunEnd({ reached: false, grid: null, matches: null });
    expect(away.stops[0]).toMatch(/BOSS_UNREACHABLE/);
    expect([away.exitCode, away.output]).toEqual([4, "OUTPUT 0 grid rows"]);
  });

  it("each id once, first wins", () => {
    expect(onceEach([{ id: "a", n: 1 }, { id: "b" }, { id: "a", n: 2 }], (x: any) => x.id)).toEqual([{ id: "a", n: 1 }, { id: "b" }]);
  });
});
