/**
 * THE DEALS GRID AND THE MATCHES ARE REPLACED WHOLE OR NOT AT ALL (eng sweep row 10, 22 Nov 2026).
 *
 * A replace used to delete every row and then insert the new ones in separate batches and pushes,
 * so a failure part-way left a half-written grid, and a push of zero rows wiped it. Each case below
 * fails on the old code. Synthetic names only: the repo is public.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, apiJson } from "./helpers";

const today = new Date().toISOString().slice(0, 10);
const hex = (n: number) => n.toString(16).padStart(24, "0");
const deal = (n: number, o: Record<string, unknown> = {}) => ({
  id: hex(n), company: `Example Co ${n}`, side: "buy", direction: "buy", size_usd: 1e6,
  size_text: "$1M", price_text: "—", structure_text: "—", from_text: "Pat Example", rainmaker: 0,
  received_on: today, email_url: null, parties: "pat example", ...o,
});
const match = (n: number) => ({ key: `b${n}|s${n}`, company: `Example Co ${n}`, seller: { who: "Seller" }, buyer: { who: "Buyer" } });

const pushDeals = (body: Record<string, unknown>) => api("/api/capital/deals", { method: "POST", body });
const pushMatches = (body: Record<string, unknown>) => api("/api/capital/matches", { method: "POST", body });
const gridIds = async () => ((await apiJson<any>("/api/capital/deals")).body.data.rows as any[]).map((r) => r.id).sort();
const matchKeys = async () => ((await apiJson<any>("/api/capital/matches")).body.data.matches as any[]).map((m) => m.key).sort();
const staged = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM capital_deal_rows_staging").first<{ n: number }>())!.n;

const OLD = [deal(1), deal(2), deal(3)];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_deal_rows; DELETE FROM capital_deal_rows_staging; DELETE FROM capital_matches; DELETE FROM capital_matches_staging; DELETE FROM capital_party_lists;");
  expect((await pushDeals({ rows: OLD, total: 3 })).status).toBe(200);
  expect((await pushMatches({ matches: [match(1), match(2)], total: 2 })).status).toBe(200);
});

describe("a grid push in parts", () => {
  it("shows the old grid until the last part, then the whole new one", async () => {
    const push = "mac-test-push-0001";
    expect((await pushDeals({ rows: [deal(10), deal(11)], push, total: 4, last: false })).status).toBe(200);
    expect(await gridIds()).toEqual(OLD.map((d) => d.id).sort());
    const last = await apiJson<any>("/api/capital/deals", { method: "POST", body: { rows: [deal(12), deal(13)], push, total: 4, last: true } });
    expect(last.body.data.committed).toBe(true);
    expect(await gridIds()).toEqual([10, 11, 12, 13].map(hex));
    expect(await staged()).toBe(0);
  });

  it("DATA LOSS: a part that never arrives leaves the previous grid whole", async () => {
    const push = "mac-test-push-0002";
    await pushDeals({ rows: [deal(10)], push, total: 3, last: false });
    // Part 2 failed on the Mac; part 3 arrives marked last.
    const res = await pushDeals({ rows: [deal(12)], push, total: 3, last: true });
    expect(res.status).toBe(409);
    expect(await gridIds()).toEqual(OLD.map((d) => d.id).sort());
  });

  it("DATA LOSS: a statement failing inside the swap rolls the whole swap back", async () => {
    const push = "mac-test-push-0003";
    await pushDeals({ rows: [deal(10)], push, total: 2, last: false });
    // A staged row the live table refuses (its CHECK on side): the delete before it must not stand.
    await env.DB.prepare(
      `INSERT INTO capital_deal_rows_staging (push_id, id, company, side, direction, size_text, price_text, structure_text, from_text, rainmaker, received_on, parties, staged_at)
       VALUES (?, ?, 'Example Co 99', 'maybe', 'buy', '—', '—', '—', '—', 0, ?, '', ?)`,
    ).bind(push, hex(99), today, Date.now()).run();
    const res = await pushDeals({ rows: [], push, total: 2, last: true });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await gridIds()).toEqual(OLD.map((d) => d.id).sort());
  });

  it("sweeps a staged push older than a day on the next commit", async () => {
    await env.DB.prepare(
      `INSERT INTO capital_deal_rows_staging (push_id, id, company, side, direction, size_text, price_text, structure_text, from_text, rainmaker, received_on, parties, staged_at)
       VALUES ('mac-abandoned-01', ?, 'Example Co 98', 'buy', 'buy', '—', '—', '—', '—', 0, ?, '', ?)`,
    ).bind(hex(98), today, Date.now() - 2 * 86_400_000).run();
    await pushDeals({ rows: OLD, total: 3 });
    expect(await staged()).toBe(0);
  });
});

describe("ABUSE: a client that lies about the push", () => {
  it("refuses a zero-row replace of the grid and keeps it", async () => {
    expect((await pushDeals({ rows: [], total: 0 })).status).toBe(400);
    expect((await pushDeals({ rows: [], push: "mac-test-push-0004", total: 0, last: true })).status).toBe(400);
    expect(await gridIds()).toHaveLength(3);
  });

  it("refuses a half push sent as a whole one (rows ≠ total)", async () => {
    expect((await pushDeals({ rows: [deal(10)], total: 3 })).status).toBe(409);
    expect(await gridIds()).toEqual(OLD.map((d) => d.id).sort());
  });

  it("refuses more rows than the declared total", async () => {
    const push = "mac-test-push-0005";
    await pushDeals({ rows: [deal(10), deal(11)], push, total: 1, last: false });
    expect((await pushDeals({ rows: [], push, total: 1, last: true })).status).toBe(409);
    expect(await gridIds()).toHaveLength(3);
  });

  it("refuses the old unguarded shape (replace with no total)", async () => {
    expect((await pushDeals({ rows: [deal(10)], replace: true })).status).toBe(400);
    expect(await gridIds()).toHaveLength(3);
  });
});

describe("the Matches screen, the same way", () => {
  it("keeps the old matches on a zero-row replace, empties only with allowEmpty", async () => {
    expect((await pushMatches({ matches: [], total: 0 })).status).toBe(400);
    expect(await matchKeys()).toEqual(["b1|s1", "b2|s2"]);
    expect((await pushMatches({ matches: [], total: 0, allowEmpty: true })).status).toBe(200);
    expect(await matchKeys()).toEqual([]);
  });

  it("DATA LOSS: a missing part leaves the old matches whole", async () => {
    const push = "mac-test-push-0006";
    await pushMatches({ matches: [match(5)], push, total: 3, last: false, offset: 0 });
    expect((await pushMatches({ matches: [match(7)], push, total: 3, last: true, offset: 2 })).status).toBe(409);
    expect(await matchKeys()).toEqual(["b1|s1", "b2|s2"]);
  });

  it("refuses a match with no key instead of dropping it and miscounting", async () => {
    expect((await pushMatches({ matches: [match(5), { company: "Example Co" }], total: 2 })).status).toBe(400);
    expect(await matchKeys()).toEqual(["b1|s1", "b2|s2"]);
  });
});
