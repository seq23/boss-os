/**
 * TONI'S COUNTS REACH THE DAILY CHECK (27 Nov 2026, #584 Not built). Her billing and lock jobs keep each day's
 * listed and handled counts in their own state files; the generic worker check reads them, so her rows show
 * real numbers instead of "couldn't check". An unread mailbox, a missing state file or a day with no run is
 * "unknown", never a pass.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mailCounts } from "../scripts/ops/lib/toni-mail.mjs";
import { readMailCounts, workerChecks } from "../scripts/ops/lib/worker-checks.mjs";
import manifest from "../src/shared/boss/schedule/manifest.json";

const NOW = Date.parse("2026-11-26T16:40:00Z"); // 10:40 Central, the day's risk watch
const box = (id: string, count: number, handled: number, why: string | null = null) => ({ id, count, handled, why });

describe("mailCounts", () => {
  it("sums both mailboxes for the day, names an unread one, and keeps eight days", () => {
    const old = { "2026-11-10": { source: 1, handled: 1, unread: [] }, "2026-11-20": { source: 2, handled: 2, unread: [] } };
    const counts = mailCounts([box("spry", 4, 4), box("personal", 3, 1, "authorization failed")], old, NOW);
    expect(counts["2026-11-26"]).toEqual({ source: 7, handled: 5, unread: ["personal"] });
    expect(counts["2026-11-20"]).toBeDefined();
    expect(counts["2026-11-10"]).toBeUndefined();
  });
});

function check(states: Record<string, unknown> | null, day = "2026-11-26") {
  const dir = mkdtempSync(join(tmpdir(), "toni-counts-"));
  for (const [name, state] of Object.entries(states ?? {})) writeFileSync(join(dir, `${name}.json`), JSON.stringify(state));
  return readMailCounts(day, manifest, { BOSS_OS_STATE_DIR: dir }).then((mailCounts) => {
    const rows = workerChecks(manifest as any, { duties: [], workerEvidence: { day, mailCounts } }, { disabled: new Set(), activity: {} });
    return { risk: rows.find((r) => r.id === "worker-check:risk-watch")!, locks: rows.find((r) => r.id === "worker-check:outside-locks")! };
  });
}

describe("the daily check reads Toni's counts", () => {
  it("real numbers: handled all is verified, with the counts in the evidence", async () => {
    const { risk } = await check({ "risk-watch": { counts: { "2026-11-26": { source: 12, handled: 12, unread: [] } } } });
    expect(risk).toMatchObject({ state: "verified", evidence: "2026-11-26: handled 12 of 12 source items." });
  });

  it("fewer handled than listed is missing", async () => {
    const { risk } = await check({ "risk-watch": { counts: { "2026-11-26": { source: 12, handled: 9, unread: [] } } } });
    expect(risk).toMatchObject({ state: "missing", evidence: "2026-11-26: handled 9 of 12 source items." });
  });

  it("zero listed with both mailboxes read is a reading: nothing to handle", async () => {
    const { risk } = await check({ "risk-watch": { counts: { "2026-11-26": { source: 0, handled: 0, unread: [] } } } });
    expect(risk.state).toBe("nothing_due");
  });

  it("an unread mailbox (free reader down, allowance spent) is unknown, never verified", async () => {
    const { risk } = await check({ "risk-watch": { counts: { "2026-11-26": { source: 5, handled: 5, unread: ["personal"] } } } });
    expect(risk.state).toBe("unknown");
  });

  it("no state file, or no run that day, is unknown", async () => {
    expect((await check(null)).risk.state).toBe("unknown");
    expect((await check({ "risk-watch": { counts: { "2026-11-25": { source: 1, handled: 1, unread: [] } } } })).risk.state).toBe("unknown");
  });

  it("the weekly lock check reads its own file on its Friday", async () => {
    const { locks } = await check({ "outside-locks": { counts: { "2026-11-27": { source: 3, handled: 3, unread: [] } } } }, "2026-11-27");
    expect(locks).toMatchObject({ state: "verified", evidence: "2026-11-27: handled 3 of 3 source items." });
  });
});
