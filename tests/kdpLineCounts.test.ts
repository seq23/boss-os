/*
 * KINDLE BOOKS PER LINE (owner, 7 Nov 2026, spry brain): Simone's monthly KDP run records each line's
 * book count in the spry brain's Numbers; an unreadable count is "not read: <reason>", never 0.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs
import { lineCounts, readRegister, run } from "../scripts/ops/kdp-line-counts.mjs";

const register = JSON.parse(readFileSync("scripts/ops/kdp-register.json", "utf8"));

describe("kdp-line-counts", () => {
  it("counts the real register by line, KeepMyProof included", () => {
    const v = lineCounts(register);
    // The KDP overhaul (8 Nov 2026): two new lines, and the 11 series books are on the register with
    // their true state (2 In review, 9 approved and queued behind Amazon's weekly title limit).
    expect(Object.keys(v)).toEqual(["Kindle books: ApprovalPrep", "Kindle books: Dream Wedding", "Kindle books: A Player Mode", "Kindle books: KeepMyProof", "Kindle books: Time-2-Read", "Kindle books: Industry Guides (uscisexam)", "Kindle books: Ambitious Grads"]);
    // Ambitious Grads (owner, 9 Nov 2026): her two own career guides, approved and queued, none live yet.
    expect(v["Kindle books: Ambitious Grads"]).toBe("2 (0 live)");
    expect(v["Kindle books: ApprovalPrep"]).toMatch(/^6 \(\d live\)$/);
    expect(v["Kindle books: Dream Wedding"]).toMatch(/^6 \(\d live\)$/);
    expect(v["Kindle books: A Player Mode"]).toMatch(/^1 \(\d live\)$/);
    expect(v["Kindle books: Time-2-Read"]).toMatch(/^1 \(\d live\)$/);
    expect(v["Kindle books: Industry Guides (uscisexam)"]).toMatch(/^1 \(\d live\)$/);
    // The divorce book (The Co-Parenting Log) is Live since 7 Nov 2026, confirmed on the bookshelf 8 Nov;
    // five KeepMyProof series books joined it on 8 Nov (one In review, four queued).
    expect(v["Kindle books: KeepMyProof"]).toBe("6 (1 live)");
    expect(register.lines.keepmyproof.plan).toMatch(/divorce first/);
  });

  it("an unreadable register, or a title with no line, is 'not read', never a 0", () => {
    const missing = readRegister("/nonexistent/kdp-register.json");
    for (const v of Object.values(lineCounts(missing.register, missing.problem))) expect(v).toMatch(/^not read: could not read the KDP register/);
    const stray = lineCounts({ ...register, titles: [...register.titles, { title: "Loose", status: "LIVE" }] });
    for (const v of Object.values(stray)) expect(v).toMatch(/^not read: 1 title\(s\) name no listed line/);
  });

  it("writes the rows into the spry brain's Numbers and nothing else", async () => {
    const md = "# Spry\n\n## Company\nx\n\n## Numbers\n| Metric | Definition | Source | Value | Last updated |\n|---|---|---|---|---|\n| Sales | s | src | 2 | 2026-11-01 |\n\n## Priorities\ny\n";
    const calls: any[] = [];
    const fetchImpl = async (url: string, init: any = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/unlock")) return new Response("{}", { headers: { "set-cookie": "s=1; Path=/" } });
      if (!init.method) return new Response(JSON.stringify({ data: { body_md: md } }));
      return new Response("{}");
    };
    const r = await run({ env: { BOSS_PASSCODE: "x" }, fetchImpl, now: Date.parse("2026-12-01T15:00:00Z") });
    expect(r.written).toBe(true);
    const put = JSON.parse(calls.at(-1).init.body);
    expect(put.section).toBe("Numbers");
    expect(put.text).toMatch(/\| Sales \|/);
    expect(put.text).toMatch(/\| Kindle books: KeepMyProof \|.*\| 6 \(1 live\) \| 2026-12-01 \|/);
    await expect(run({ env: {}, fetchImpl })).rejects.toThrow(/NO_PASSCODE/);
  });
});
