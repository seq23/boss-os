/**
 * THE GROWTH SCOREBOARD (Growth Director, 21 Nov 2026). Behaviour, each proven negatively:
 *   - one counting stack: every measure names a Scorecard reader, and the list fails on a stranger;
 *   - outage: a source that fails is stored "not read: <reason>", never 0, and the Worker refuses a
 *     missing number with no reason; a business with nothing read is "no data";
 *   - noise: under 50 visits a month a business is "too little data", a separate state;
 *   - KeepMyProof's no-analytics promise: no visit or tagged-link reader, and its links are never tagged;
 *   - Porch & Party's requests are counted first; paused businesses carry no measure;
 *   - RevenueCat: a key without the overview permission is "not read" naming the key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreboardProblems, activeMeasures, toReading, readingProblems, summarize, MIN_VISITS_FOR_TESTS } from "../src/shared/boss/growth/scoreboard.mjs";
import { tagLink } from "../src/shared/boss/growth/taggedLink.mjs";
import { readAll } from "../scripts/ops/growth-scoreboard.mjs";
import { READERS } from "../scripts/ops/lib/scorecard-readers.mjs";

const manifest = JSON.parse(readFileSync(new URL("../src/shared/boss/scorecard/manifest.json", import.meta.url), "utf8"));
const clone = () => JSON.parse(JSON.stringify(manifest));

describe("the scoreboard list", () => {
  it("is clean, and counts something for each of the six businesses", () => {
    expect(scoreboardProblems(manifest)).toEqual([]);
    const biz = new Set(activeMeasures(manifest).map((m: any) => m.business));
    for (const b of ["porch-and-party", "keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"]) expect(biz.has(b)).toBe(true);
  });
  it("refuses a reader that is not one of the Scorecard's (no sixth counting stack)", () => {
    const m = clone(); m.scoreboard.measures[1].reader = "my-own-counter";
    expect(scoreboardProblems(m).join(" ")).toMatch(/not a Scorecard reader/);
  });
  it("counts Porch & Party's requests first", () => {
    const m = clone(); const pnp = m.scoreboard.measures.filter((x: any) => x.business === "porch-and-party");
    m.scoreboard.measures = [...m.scoreboard.measures.filter((x: any) => x.business !== "porch-and-party"), ...pnp];
    expect(scoreboardProblems(m).join(" ")).toMatch(/Porch & Party's requests must be the first/);
  });
  it("measures nothing for a paused business", () => {
    const m = clone(); m.scoreboard.measures.push({ ...m.scoreboard.measures[1], id: "hwk-x", business: "how-we-know" });
    expect(scoreboardProblems(m).join(" ")).toMatch(/is paused/);
    expect(activeMeasures(manifest).some((x: any) => ["how-we-know", "whisper-almanac"].includes(x.business))).toBe(false);
  });
  it("is empty → a named stop, never a quiet green", async () => {
    const m = clone(); m.scoreboard.measures = [];
    expect(scoreboardProblems(m).join(" ")).toMatch(/SCOREBOARD_EMPTY/);
    await expect(readAll(m, {} as any, "2026-11-21")).rejects.toThrow(/NAMED STOP/);
  });
});

describe("KeepMyProof promises no analytics", () => {
  it("has no site-visit or tagged-link measure, and the list refuses one", () => {
    const kmp = manifest.scoreboard.measures.filter((m: any) => m.business === "keepmyproof");
    expect(kmp.length).toBeGreaterThan(0);
    for (const m of kmp) expect(["revenuecat", "gsc", "none"]).toContain(m.reader);
    const m = clone(); m.scoreboard.measures.push({ id: "kmp-visits", business: "keepmyproof", kind: "visits", channel: "site", language: "en", label: "x", reader: "d1", params: { db: "keepmyproof", sql: "SELECT 1 AS n" } });
    expect(scoreboardProblems(m).join(" ")).toMatch(/promises no analytics/);
  });
  it("never tags a KeepMyProof link, and tags every other site's", () => {
    expect(() => tagLink("https://keepmyproof.com/es/", { source: "threads", medium: "social", campaign: "x" })).toThrow(/NO_TRACKING_PROMISE/);
    expect(() => tagLink("https://www.keepmyproof.com/", { source: "threads", medium: "social", campaign: "x" })).toThrow(/NO_TRACKING_PROMISE/);
    const u = new URL(tagLink("https://porchandparty901.com/request", { source: "instagram", medium: "social", campaign: "christmas-porch" }));
    expect([u.searchParams.get("utm_source"), u.searchParams.get("utm_medium"), u.searchParams.get("utm_campaign")]).toEqual(["instagram", "social", "christmas-porch"]);
    expect(() => tagLink("https://approvalprep.com/", { source: "Threads!", medium: "social", campaign: "x" })).toThrow();
  });
});

describe("outage: a failed source is 'not read', never 0", () => {
  const m = manifest.scoreboard.measures[0];
  it("stores an error as not read with the reason", () => {
    const r = toReading(m, { raw: null, error: "NAMED STOP [D1_QUERY_FAILED] pnp-admin: no such table" }, "2026-11-21");
    expect(r.value).toBeNull();
    expect(r.unread).toBe("not read: pnp-admin: no such table");
  });
  it("the Worker refuses a missing number with no reason, and a stranger measure", () => {
    expect(readingProblems({ day: "2026-11-21", readings: [{ measure: m.id, business: m.business, value: null }] }, manifest).join(" ")).toMatch(/no "not read" reason/);
    expect(readingProblems({ day: "2026-11-21", readings: [{ measure: "nope", value: 1 }] }, manifest).join(" ")).toMatch(/unknown measure/);
    expect(readingProblems({ day: "2026-11-21", readings: [] }, manifest).join(" ")).toMatch(/no readings/);
    expect(readingProblems({ day: "2026-11-21", readings: [{ measure: m.id, business: m.business, value: 1, unread: "a@b.co" }] }, manifest).join(" ")).toMatch(/address/);
  });
  it("a business with nothing read is 'no data'; holds are per channel; unread visits are never 'too little'", () => {
    const pnp = manifest.scoreboard.measures.filter((x: any) => x.business === "porch-and-party");
    const unread = pnp.map((x: any) => toReading(x, { raw: null, error: "NAMED STOP [KEY_MISSING] gone" }, "2026-11-21"));
    expect(summarize(manifest, unread).find((b: any) => b.key === "porch-and-party").state).toBe("no data");
    const thin = pnp.map((x: any) => toReading(x, { raw: x.kind === "visits" ? MIN_VISITS_FOR_TESTS - 1 : 2 }, "2026-11-21"));
    const s = summarize(manifest, thin).find((b: any) => b.key === "porch-and-party");
    expect(s.state).toBe("read");
    expect(s.totals.requests).toBe(2); // the "all" channel is the total, not the sum of channels
    expect(s.channels.find((c: any) => c.kind === "visits").hold).toBe("too little data");
    expect(s.channels.find((c: any) => c.measure === "pnp-requests").hold).toBeNull();
    // NEGATIVE: visits unread, money read → the visits channel is "no data", never "too little data", and its total is null, never 0.
    const half = pnp.map((x: any) => toReading(x, x.kind === "visits" ? { raw: null, error: "NAMED STOP [GSC_UNREADABLE] no" } : { raw: 3 }, "2026-11-21"));
    const h = summarize(manifest, half).find((b: any) => b.key === "porch-and-party");
    expect(h.channels.find((c: any) => c.kind === "visits").hold).toBe("no data");
    expect(h.totals.visits).toBeNull();
    const busy = pnp.map((x: any) => toReading(x, { raw: x.kind === "visits" ? MIN_VISITS_FOR_TESTS : 2 }, "2026-11-21"));
    expect(summarize(manifest, busy).find((b: any) => b.key === "porch-and-party").channels.find((c: any) => c.kind === "visits").hold).toBeNull();
    expect(summarize(manifest, []).find((b: any) => b.key === "how-we-know").state).toBe("paused");
  });
  it("a stopped job's old reading is 'not read: stale', never this week's number", () => {
    const m = manifest.scoreboard.measures[0];
    const old = [toReading(m, { raw: 5 }, "2026-11-14")];
    const row = summarize(manifest, old, [], "2026-11-21").find((b: any) => b.key === "porch-and-party").channels[0];
    expect(row.value).toBeNull();
    expect(row.unread).toBe("not read: stale since 2026-11-14");
    expect(summarize(manifest, old, [], "2026-11-15").find((b: any) => b.key === "porch-and-party").channels[0].value).toBe(5);
  });
});

describe("the RevenueCat reader", () => {
  const ctx = (overview: { status: number; body: any }) => ({
    env: { K: "sk" }, now: Date.now(),
    fetch: async (url: string) => ({
      status: url.endsWith("/projects") ? 200 : overview.status,
      ok: url.endsWith("/projects") ? true : overview.status < 300,
      json: async () => (url.endsWith("/projects") ? { items: [{ id: "proj1" }] } : overview.body),
    }),
  });
  it("reads one overview number", async () => {
    expect(await READERS.revenuecat!({ key: "K", metric: "revenue" }, ctx({ status: 200, body: { metrics: [{ id: "revenue", value: 12.5 }] } }))).toEqual({ raw: 12.5 });
  });
  it("a key without the permission throws a named stop naming the key", async () => {
    await expect(READERS.revenuecat!({ key: "K", metric: "revenue" }, ctx({ status: 403, body: {} }))).rejects.toThrow(/KEY_REFUSED.*K lacks/);
  });
  it("a missing key is KEY_MISSING", async () => {
    await expect(READERS.revenuecat!({ key: "NOPE", metric: "revenue" }, ctx({ status: 200, body: {} }))).rejects.toThrow(/KEY_MISSING/);
  });
});
