import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { parsePositionSizes, listSizes, moneyShort } from "../../src/shared/wealth/positionSizes";

/**
 * HER POSITION SIZES RECORD, THE WAY SHE TYPES THEM.
 *
 * ─── The defect, CONFIRMED 19 September 2026 ──────────────────────────────
 *
 *   "I cannot even input my position sizes; it doesn't record."
 *
 * The field ran `Number()` over what she typed and rendered its only error ~3,000px above the
 * input. `Number("$5M, 12M and 40M")` is NaN, so no request left the browser — production holds no
 * position key and no setting write for the day. The first test below is that exact input.
 */

describe("the parser reads what she writes", () => {
  it("reads the sentence she actually typed — several positions with units and 'and'", () => {
    // THE OLD DEFECT, STATED: this is NaN under Number(), which is why nothing recorded.
    expect(Number("$5M, 12M and 40M")).toBeNaN();
    const r = parsePositionSizes("$5M, 12M and 40M");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.positions_usd).toEqual([40_000_000, 12_000_000, 5_000_000]);
    expect(listSizes(r.positions_usd)).toBe("$40M, $12M and $5M");
  });

  it.each([
    ["5", [5_000_000]],
    ["5M", [5_000_000]],
    ["$5m", [5_000_000]],
    ["500k", [500_000]],
    ["1.2B", [1_200_000_000]],
    ["5,000,000", [5_000_000]],
    ["2.5 million", [2_500_000]],
    ["5 12 40", [40_000_000, 12_000_000, 5_000_000]],
    ["5M; 12M / 40M", [40_000_000, 12_000_000, 5_000_000]],
    ["5M, 5M", [5_000_000]],
  ])("reads %s", (text, expected) => {
    const r = parsePositionSizes(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.positions_usd).toEqual(expected);
  });

  it.each(["", "   ", "five", "5M and some", "-5M", "0", "$"])("names what it cannot read in %j", (text) => {
    const r = parsePositionSizes(text);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.hint).toContain("5M");
  });

  it("prints money the way the letter and the screen say it", () => {
    expect(moneyShort(5_000_000)).toBe("$5M");
    expect(moneyShort(500_000)).toBe("$500k");
    expect(moneyShort(1_200_000_000)).toBe("$1.2B");
    expect(moneyShort(12_500_000)).toBe("$12.5M");
  });
});

describe("the route records the sizes and reads them back", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM settings WHERE key IN ('brokerage_working_position_usd','brokerage_working_positions_usd')`).run();
  });

  it("type a size → saved → read back equals the typed value, on every surface that shows it", async () => {
    const put = await apiJson<any>("/api/wealth/working-positions", { method: "PUT", body: { text: "$5M, 12M and 40M" } });
    expect(put.status).toBe(200);
    // THE RESPONSE IS READ FROM THE TABLE, not echoed from the parse.
    expect(put.body.data.positions_usd).toEqual([40_000_000, 12_000_000, 5_000_000]);
    expect(put.body.data.largest_usd).toBe(40_000_000);

    const rows = await env.DB
      .prepare(`SELECT key, value FROM settings WHERE key IN ('brokerage_working_position_usd','brokerage_working_positions_usd') ORDER BY key`)
      .all<{ key: string; value: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results![0]!.value).toBe("40000000");
    expect(JSON.parse(rows.results![1]!.value)).toEqual([40_000_000, 12_000_000, 5_000_000]);

    // The desk's recommendation basis carries the list AND ranks against the largest.
    const rec = await apiJson<any>("/api/wealth/recommendations");
    expect(rec.body.data.basis.working_positions_usd).toEqual([40_000_000, 12_000_000, 5_000_000]);
    expect(rec.body.data.basis.working_position_usd).toBe(40_000_000);

    // And the act is on the audit log, with what she typed.
    const audit = await env.DB
      .prepare(`SELECT detail FROM audit_log WHERE entity_type = 'setting' AND entity_id = 'brokerage_working_positions_usd' ORDER BY ts DESC LIMIT 1`)
      .first<{ detail: string }>();
    expect(JSON.parse(audit!.detail).typed).toBe("$5M, 12M and 40M");
  });

  it("refuses what it cannot read BY NAME, and writes nothing", async () => {
    const put = await apiJson<any>("/api/wealth/working-positions", { method: "PUT", body: { text: "5M and some more" } });
    expect(put.status).toBe(400);
    expect(put.body.error).toContain('"some"');
    expect(put.body.hint).toContain("5M");
    const n = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM settings WHERE key IN ('brokerage_working_position_usd','brokerage_working_positions_usd')`)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("the two keys can never disagree: a second save replaces both", async () => {
    await apiJson("/api/wealth/working-positions", { method: "PUT", body: { text: "5M" } });
    const second = await apiJson<any>("/api/wealth/working-positions", { method: "PUT", body: { text: "12M, 3M" } });
    expect(second.body.data.positions_usd).toEqual([12_000_000, 3_000_000]);
    expect(second.body.data.largest_usd).toBe(12_000_000);
    const rec = await apiJson<any>("/api/wealth/recommendations");
    expect(rec.body.data.basis.working_positions_usd).toEqual([12_000_000, 3_000_000]);
    expect(rec.body.data.basis.working_position_usd).toBe(12_000_000);
  });
});
