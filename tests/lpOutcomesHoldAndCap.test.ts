/**
 * LP OUTCOMES: HOLD BEFORE NAMING, AND A PER-RUN READ CAP (follow-ups 1 and 3 of #583).
 * - A reply held after three uncertain reads is named in her morning email only after the hold is
 *   saved. A failed save names nothing; a failed name leaves the ids saved as unnamed for next run.
 * - lp-outcomes reads at most LP_READS_PER_RUN replies a run, like lp-daily; the rest stay unread.
 */
import { describe, expect, it, vi } from "vitest";
import { holdThenName, readOutcomeReplies } from "../scripts/ops/lp-outcomes.mjs";
import { LP_READS_PER_RUN } from "../scripts/ops/lp-positive.mjs";

describe("lp-outcomes holds a reply before naming it", () => {
  it("names nothing when the hold write fails, so the reply is read again next run", async () => {
    const name = vi.fn(async () => {});
    const save = vi.fn(() => { throw new Error("disk full"); });
    await expect(holdThenName({ held: ["m1"] }, { save, name })).rejects.toThrow("disk full");
    expect(name).not.toHaveBeenCalled();
  });

  it("names only after the hold is saved, then clears the unnamed mark", async () => {
    const order: string[] = [];
    const saved: string[][] = [];
    const save = (ids: string[]) => { order.push(`save:${ids.join(",")}`); saved.push(ids); };
    const name = async (ids: string[]) => { order.push(`name:${ids.join(",")}`); };
    await expect(holdThenName({ held: ["m1", "m2"] }, { save, name })).resolves.toEqual(["m1", "m2"]);
    expect(order).toEqual(["save:m1,m2", "name:m1,m2", "save:"]);
    expect(saved.at(-1)).toEqual([]);
  });

  it("keeps a reply whose naming failed saved as unnamed, and names it on the next run", async () => {
    let state: string[] = [];
    const save = (ids: string[]) => { state = ids; };
    const down = vi.fn(async () => { throw new Error("morning write failed"); });
    await expect(holdThenName({ held: ["m1"] }, { save, name: down })).rejects.toThrow("morning write failed");
    expect(state).toEqual(["m1"]);
    // Next run: nothing newly held, the unnamed one is named, and the mark is cleared.
    const name = vi.fn(async () => {});
    await holdThenName({ held: [], unnamed: state }, { save, name });
    expect(name).toHaveBeenCalledWith(["m1"]);
    expect(state).toEqual([]);
  });

  it("does nothing on a run with nothing held and nothing unnamed", async () => {
    const save = vi.fn();
    const name = vi.fn(async () => {});
    await expect(holdThenName({ held: [], unnamed: [] }, { save, name })).resolves.toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(name).not.toHaveBeenCalled();
  });
});

describe("lp-outcomes caps the model reads per run", () => {
  const address = "person@investor.test";
  const outgoing = { id: "sent", headers: { from: "sender@fund.test" }, body: "Would you like details?", internalDate: 1 };
  const reply = (id: string) => ({ id, headers: { from: address }, body: "Count us in.", internalDate: 2 });
  const ok = { status: "ok" as const, provider: "gemini" as const, text: JSON.stringify({ disposition: "warm", excerpt: "Count us in.", resumeOn: null, side: "unknown" }), inTokens: 1, outTokens: 1 };

  it(`stops at ${LP_READS_PER_RUN} reads and leaves the rest unread for the next run`, async () => {
    const extra = 3;
    const ids = Array.from({ length: LP_READS_PER_RUN + extra }, (_, i) => `m${i}`);
    const list = async () => ids.map((id) => [id, new Set([id])] as const);
    const load = async (id: string) => [outgoing, reply(id)];
    const read = vi.fn(async () => ok);
    const scan = await readOutcomeReplies({ token: "fixture", query: "fixture", known: new Set([address]), list, load, read });
    expect(LP_READS_PER_RUN).toBeGreaterThan(0);
    expect(read).toHaveBeenCalledTimes(LP_READS_PER_RUN);
    expect(scan.status).toBe("capped");
    expect(scan.records).toHaveLength(LP_READS_PER_RUN);
    expect(scan.unread.map((u) => u.id)).toEqual(ids.slice(LP_READS_PER_RUN));
    // The next run reads only what was left.
    const receipts = Object.fromEntries(scan.records.map((r) => [r.id, r]));
    const next = await readOutcomeReplies({ token: "fixture", query: "fixture", known: new Set([address]), list, load, read, receipts });
    expect(next).toMatchObject({ status: "complete", unread: [] });
    expect(read).toHaveBeenCalledTimes(LP_READS_PER_RUN + extra);
  });
});
