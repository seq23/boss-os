/**
 * The deletes the 22 Nov 2026 engineering sweep left unswept ("Not swept" in its result), each
 * held to the three ways a delete goes wrong:
 *   abuse     — a lying or malformed request deletes nothing it should not;
 *   data loss — a delete takes only what it names, and never runs without the write it pairs with;
 *   outage    — a write that fails part-way leaves what was there exactly as it was.
 *
 * A failing D1 write is a real one: a trigger that aborts inserts on one table, dropped after.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSnapshot, pruneSnapshots } from "../../src/worker/boss/routes/vault";
import { expireSecretHandoffs } from "../../src/worker/boss/service/secretHandoff";
import { importAlmanac, MAX_IMPORT_EVENTS } from "../../src/worker/boss/spirit/almanac_import";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { apiJson, insertMemory, row, all } from "./helpers";

const triggers: string[] = [];
async function failInsertsOn(table: string) {
  const name = `fail_${table}_${triggers.length}`;
  await env.DB.prepare(
    `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'simulated outage'); END`,
  ).run();
  triggers.push(name);
}
afterEach(async () => {
  while (triggers.length) await env.DB.prepare(`DROP TRIGGER IF EXISTS ${triggers.pop()}`).run();
  vi.restoreAllMocks();
});

describe("practice ticks and gates (routes/practice.ts)", () => {
  const today = () => dayIdInZone(Date.now());

  it("un-ticking takes that one item today, never another item or another day", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO today_ticks (day_id, item_key, done_at) VALUES (?,?,?)`).bind(today(), "morning:gratitude", 1),
      env.DB.prepare(`INSERT INTO today_ticks (day_id, item_key, done_at) VALUES (?,?,?)`).bind(today(), "morning:water", 1),
      env.DB.prepare(`INSERT INTO today_ticks (day_id, item_key, done_at) VALUES (?,?,?)`).bind("2020-01-01", "morning:gratitude", 1),
    ]);
    const { status } = await apiJson("/api/practice/tick", { method: "POST", body: { key: "morning:gratitude", done: false } });
    expect(status).toBe(200);
    const left = await all<{ day_id: string; item_key: string }>(`SELECT day_id, item_key FROM today_ticks ORDER BY day_id, item_key`);
    expect(left).toEqual([
      { day_id: "2020-01-01", item_key: "morning:gratitude" },
      { day_id: today(), item_key: "morning:water" },
    ]);
  });

  it("a key that is not one list item is refused and deletes nothing", async () => {
    await env.DB.prepare(`INSERT INTO today_ticks (day_id, item_key, done_at) VALUES (?,?,?)`).bind(today(), "morning:water", 1).run();
    for (const key of ["%", "morning:water' OR '1'='1", "", "x".repeat(121)]) {
      const { status } = await apiJson("/api/practice/tick", { method: "POST", body: { key, done: false } });
      expect(status).toBe(400);
    }
    expect((await all(`SELECT item_key FROM today_ticks`)).length).toBe(1);
  });

  it("resetting one gate leaves the other gates and earlier days alone; a made-up gate resets nothing", async () => {
    const items = JSON.stringify([{ key: "x", label: "Something kept" }]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO gate_templates (gate, items, updated_at) VALUES ('morning', ?, 1)`).bind(items),
      env.DB.prepare(`INSERT INTO gate_templates (gate, items, updated_at) VALUES ('midday', ?, 1)`).bind(items),
      env.DB.prepare(`INSERT INTO gate_days (day_id, gate, items, created_at) VALUES (?, 'morning', ?, 1)`).bind(today(), items),
      env.DB.prepare(`INSERT INTO gate_days (day_id, gate, items, created_at) VALUES ('2020-01-01', 'morning', ?, 1)`).bind(items),
    ]);
    const bad = await apiJson("/api/practice/gates/everything", { method: "PUT", body: { scope: "reset" } });
    expect(bad.status).toBe(400);
    expect((await all(`SELECT gate FROM gate_templates`)).length).toBe(2);

    const { status } = await apiJson("/api/practice/gates/morning", { method: "PUT", body: { scope: "reset" } });
    expect(status).toBe(200);
    expect(await all(`SELECT gate FROM gate_templates`)).toEqual([{ gate: "midday" }]);
    expect(await all(`SELECT day_id FROM gate_days WHERE gate = 'morning'`)).toEqual([{ day_id: "2020-01-01" }]);
  });
});

describe("vault restore and prune (routes/vault.ts)", () => {
  const restore = (body: unknown) => apiJson("/api/vault/restore", { method: "POST", body });

  it("a replace that carries no rows is refused and wipes nothing", async () => {
    const kept = await insertMemory({ title: "Kept through an empty replace" });
    const { status, body } = await restore({
      payload: JSON.stringify({ tables: { memory_items: [], lanes: [] } }),
      mode: "replace",
      confirm: "REPLACE",
    });
    expect(status).toBe(422);
    expect(body.error).toContain("holds no rows");
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, kept)).toBeTruthy();
    expect((await all(`SELECT id FROM lanes`)).length).toBeGreaterThan(0);
  });

  it("a table name the snapshot does not cover is never touched, however it is written", async () => {
    const kept = await insertMemory({ title: "Kept through a forged table name" });
    const { status } = await restore({
      payload: JSON.stringify({ tables: { "memory_items WHERE 1=1; --": [{ id: "forged" }] } }),
      mode: "replace",
      confirm: "REPLACE",
    });
    expect(status).toBe(201);
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, kept)).toBeTruthy();
  });

  it("a replace whose write fails part-way leaves every table as it was", async () => {
    const kept = await insertMemory({ title: "Kept through a failed replace" });
    const snapshot = await takeSnapshot(env, "outage");
    const lanesBefore = (await all(`SELECT id FROM lanes`)).length;
    await failInsertsOn("memory_items"); // memory_items are written after the lanes, so the failure is mid-way

    const { status, body } = await restore({ snapshot_id: snapshot.id, mode: "replace", confirm: "REPLACE" });
    expect(status).toBe(422);
    expect(body.error).toContain("rolled back");
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, kept)).toBeTruthy();
    expect((await all(`SELECT id FROM lanes`)).length).toBe(lanesBefore);
  });

  it("a prune whose bucket delete fails keeps the snapshot complete and says so", async () => {
    for (let i = 0; i < 3; i++) await takeSnapshot(env, `prune-outage-${i}`);
    vi.spyOn(env.VAULT, "delete").mockRejectedValue(new Error("bucket unreachable"));
    const result = await pruneSnapshots(env, 1);
    expect(result.deleted).toBe(0);
    expect(result.failures.length).toBe(2);
    expect((await all(`SELECT id FROM vault_snapshots WHERE status = 'complete'`)).length).toBe(3);
  });
});

describe("removing a contribution (routes/spirit.ts)", () => {
  const add = async (note: string) =>
    (await apiJson("/api/spirit/contributions", { method: "POST", body: { kind: "help", note } })).body.data.contribution.id as string;

  it("takes only the entry named", async () => {
    const gone = await add("Recorded by mistake");
    const kept = await add("Helped a neighbour move");
    expect((await apiJson(`/api/spirit/contributions/${gone}`, { method: "DELETE" })).status).toBe(200);
    expect(await all(`SELECT id FROM contributions`)).toEqual([{ id: kept }]);
  });

  it("if the audit record cannot be written, the entry stays (it is never removed without a trace)", async () => {
    const id = await add("Must not vanish untraced");
    await failInsertsOn("audit_log");
    const { status } = await apiJson(`/api/spirit/contributions/${id}`, { method: "DELETE" });
    expect(status).toBeGreaterThanOrEqual(500);
    expect(await row(`SELECT id FROM contributions WHERE id = ?`, id)).toBeTruthy();
  });
});

describe("expiring secret hand-offs (service/secretHandoff.ts)", () => {
  it("removes only the hand-offs past their expiry", async () => {
    const now = Date.now();
    const put = (id: string, expires: number) =>
      env.DB.prepare(
        `INSERT INTO boss_secret_handoff (id, name, ciphertext, iv, requested_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?)`,
      ).bind(id, "EXAMPLE_KEY", "c", "i", "test", now - 1000, expires);
    await env.DB.batch([put("sh_expired", now - 1), put("sh_live", now + 60 * 60_000)]);
    await expireSecretHandoffs(env);
    expect(await all(`SELECT id FROM boss_secret_handoff`)).toEqual([{ id: "sh_live" }]);
  });
});

describe("refreshing the hand-entered almanac (spirit/almanac_import.ts)", () => {
  const DAY = 86_400_000;
  const START = Date.parse("2027-02-09T00:00:00Z");
  const paste = (label: string, replace = false) => ({
    source_name: "Public almanac (example)",
    replace,
    events: [
      { kind: "retrograde", label, starts_at: START, ends_at: START + 21 * DAY },
      { kind: "shadow", label: `${label} shadow`, retrograde_label: label, phase: "pre", starts_at: START - 20 * DAY, ends_at: START },
    ],
  });
  const imported = () => all<{ label: string }>(`SELECT label FROM astro_calendar WHERE source = 'imported' ORDER BY label`);

  it("a refresh that fails part-way leaves the old copy exactly as it was", async () => {
    await importAlmanac(env.DB, paste("Mercury retrograde (first copy)"));
    const before = await imported();
    expect(before.length).toBe(2);
    await failInsertsOn("astro_calendar"); // the upsert of an existing row is an insert first

    await expect(importAlmanac(env.DB, paste("Mercury retrograde (corrected)", true))).rejects.toThrow();
    expect(await imported()).toEqual(before);
  });

  it("a paste larger than any real almanac is refused before anything is deleted", async () => {
    await importAlmanac(env.DB, paste("Mercury retrograde (first copy)"));
    const before = await imported();
    const events = Array.from({ length: MAX_IMPORT_EVENTS + 1 }, (_, i) => ({
      kind: "retrograde", label: `Forged ${i}`, starts_at: START + i * 2 * DAY, ends_at: START + i * 2 * DAY + DAY,
    }));
    await expect(importAlmanac(env.DB, { source_name: "Forged", replace: true, events })).rejects.toThrow(/at most/);
    expect(await imported()).toEqual(before);
  });
});
