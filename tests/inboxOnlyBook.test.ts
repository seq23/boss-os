/**
 * INBOX ONLY (owner, 26 Oct 2026: "Yes, inbox only"). Monique works from the inbox deal grid; a book
 * she emails is an optional extra that still lands in the grid and the hunts, never required.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs with no types
import { bookGridRows } from "../scripts/ops/interest-grid.mjs";
// @ts-expect-error — plain .mjs with no types
import { herLots } from "../scripts/ops/lib/her-lots.mjs";

const mirror = { book: { version: 3, received_at: Date.parse("2026-09-16T04:31:59Z") }, lines: [
  { asset: "Alpha Co", side: "sell", size_usd: 20e6, size_text: "$20M" },
  { asset: "Beta Co", side: "sell", size_usd: null, size_text: "" },
] };

describe("a book she emails still lands in the grid, as an extra", () => {
  it("each book line becomes a Yours row; a company the inbox already shows on that side is not doubled", () => {
    const inbox = [{ id: "x", company: "Alpha Co", side: "yours", direction: "sell" }];
    const rows = bookGridRows(mirror, inbox);
    expect(rows.map((r: any) => r.company)).toEqual(["Beta Co"]);
    expect(rows[0]).toMatchObject({ side: "yours", direction: "sell", from_text: "Your book", received_on: "2026-09-16" });
    expect(bookGridRows(mirror, []).length).toBe(2);
    expect(bookGridRows(null, [])).toEqual([]);
  });

  it("the hunts take the book as an extra and never require it: no inbox and no book is a stop that asks for nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cap-"));
    expect(herLots("sell", { book: null, dir })).toBeNull();
    const withBook = herLots("sell", { book: { positions: [{ asset: "Beta Co", side: "sell" }], source: "book v3" }, dir });
    expect(withBook.positions.map((p: any) => p.asset)).toEqual(["Beta Co"]);
    expect(withBook.source).toMatch(/inbox grid \(0 of yours\) plus 1 from book v3/);
  });

  it("the nag is gone: no bookNag module, and no hunt asks her to email a book", async () => {
    const { readFileSync } = await import("node:fs");
    const root = join(__dirname, "..");
    expect(existsSync(join(root, "src/worker/boss/capital/bookNag.ts"))).toBe(false);
    for (const f of ["scripts/ops/buyer-hunt.mjs", "scripts/ops/filing-hunt.mjs", "src/worker/boss/routes/today.ts", "src/worker/boss/routes/capital.ts"]) {
      const code = readFileSync(join(root, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, f).not.toMatch(/Email (it|your book) to boss@|bookNagAlerts|still working v/);
    }
  });
});
