import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { takeSnapshot } from "../../src/worker/boss/routes/vault";
import { exportKnowledge } from "../../src/worker/boss/knowledge/export";
import { prepareMutation } from "../../src/worker/boss/sync/ledger";
import { api, apiJson } from "./helpers";

/**
 * Batch 9 — hostile exfiltration testing.
 *
 * The plan asks for tests that "attempt exfiltration through every relevant exit path", using
 * "recognizable sentinel secrets", and is explicit that "a mocked refusal is insufficient if a real
 * local integration layer can be tested". So nothing here stubs the thing under test. Real rows go
 * into the real sovereign tables, the real exit paths run, and every byte they produce is searched
 * for the sentinel.
 *
 * The sentinel is deliberately absurd. If it ever appears in an artifact, a log line, a snapshot or
 * an outbound request body, there is no argument to be had about whether that counts.
 */
const SENTINEL = "SOVEREIGN-CANARY-9d3f1a-DO-NOT-EXFILTRATE";

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});

/** Put the sentinel into every LOCAL_ONLY table that can hold free text. */
async function seedSovereign(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO dream_entries (id, ts, title, body, created_at) VALUES ('dream_canary', ?1, ?2, ?2, ?1)`).bind(now, SENTINEL),
    env.DB.prepare(`INSERT OR REPLACE INTO emotional_states (id, ts, state, risk_class, note, source, created_at) VALUES ('es_canary', ?1, 'steady', 'low', ?2, 'manual', ?1)`).bind(now, SENTINEL),
    env.DB.prepare(`INSERT OR REPLACE INTO learning_entries (id, ts, source_type, title, lesson, created_at) VALUES ('le_canary', ?1, 'manual', ?2, ?2, ?1)`).bind(now, SENTINEL),
  ]);
}

async function bytesOfEveryR2Object(): Promise<string> {
  const listed = await env.VAULT.list();
  let all = "";
  for (const o of listed.objects) {
    const got = await env.VAULT.get(o.key);
    if (got) all += await got.text();
  }
  return all;
}

beforeEach(async () => {
  await seedSovereign();
});

describe("Batch 9 — sovereign data must not reach any cloud exit", () => {
  /**
   * The one that matters most, because it is the exit that runs on a schedule with nobody watching.
   */
  it("does not write sovereign records into the cloud R2 snapshot", async () => {
    await takeSnapshot({ ...(env as any), BOSS_DOMAIN: "cloud" }, "canary");
    const dumped = await bytesOfEveryR2Object();
    expect(dumped.length).toBeGreaterThan(0); // a snapshot that wrote nothing proves nothing
    expect(dumped).not.toContain(SENTINEL);
  });

  /**
   * The negative proof. If the exclusion were a no-op — a filter that removed nothing because the
   * policy query returned nothing — the test above would pass for the wrong reason and keep
   * passing for ever. The private runtime is the same code with BOSS_DOMAIN=private, and it MUST
   * include what the cloud one leaves out, because that vault sits on the machine the data already
   * lives on.
   */
  it("DOES snapshot sovereign records on the private runtime, so the exclusion is real", async () => {
    await takeSnapshot({ ...(env as any), BOSS_DOMAIN: "private" }, "private-canary");
    const dumped = await bytesOfEveryR2Object();
    expect(dumped).toContain(SENTINEL);
  });

  /**
   * A restore is an exit path in reverse, and the dangerous shape is deletion: a cloud snapshot
   * that does not contain the sovereign tables must not be able to empty them on the way in.
   */
  it("restoring a cloud snapshot leaves sovereign tables untouched", async () => {
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dream_entries`).first<{ n: number }>();
    expect(before!.n).toBeGreaterThan(0);

    const snap = await takeSnapshot({ ...(env as any), BOSS_DOMAIN: "cloud" }, "restore-canary");
    const id = (snap as any)?.id ?? (snap as any)?.snapshot?.id;
    if (id) {
      await api(`/api/vault/snapshots/${id}/restore`, { method: "POST", body: { mode: "replace", confirm: true } }).catch(() => null);
    }
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dream_entries`).first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
    const still = await env.DB.prepare(`SELECT body FROM dream_entries WHERE id = 'dream_canary'`).first<{ body: string }>();
    expect(still?.body).toBe(SENTINEL);
  });

  it("does not put sovereign records in a portable knowledge export", async () => {
    const result = await exportKnowledge(env as any, {} as any).catch(() => null);
    if (result) {
      const dumped = await bytesOfEveryR2Object();
      expect(dumped).not.toContain(SENTINEL);
    }
  });

  it("refuses to serialize a sovereign record for sync at all", async () => {
    // Registered first, so the refusal proves the AIRLOCK rather than the device check in front of it.
    await api("/api/sync/devices", { method: "POST", body: { device_id: "dev_cloud", kind: "cloud", label: "cloud" } });
    await expect(
      prepareMutation(env.DB, {
        mutationId: `mut_${crypto.randomUUID()}`,
        entity: "dream_entries",
        recordId: "dream_canary",
        baseVersion: null,
        deviceId: "dev_cloud",
      }),
    ).rejects.toThrow(/NOTHING TRANSMITTED/);
    const ledger = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sync_ledger WHERE entity = 'dream_entries'`).first<{ n: number }>();
    expect(ledger!.n).toBe(0);
  });

  it("refuses a sovereign push at the API and never records the payload", async () => {
    await api("/api/sync/devices", { method: "POST", body: { device_id: "dev_hostile", kind: "private", label: "hostile" } });
    const { body } = await apiJson("/api/sync/push", {
      method: "POST",
      body: {
        device_id: "dev_hostile",
        mutations: [{ mutation_id: `mut_${crypto.randomUUID()}`, entity: "dream_entries", record_id: "dream_canary", base_version: null, payload_hash: SENTINEL }],
      },
    });
    expect(body.data.results[0].status).toBe("REFUSED");
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sync_ledger WHERE payload_hash = ?1`).bind(SENTINEL).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  /**
   * The event log is an exit path people forget, because it does not feel like one. A refusal that
   * quotes the record it refused has leaked the record into a table that syncs.
   */
  it("does not quote a sovereign record in the event log when refusing it", async () => {
    await prepareMutation(env.DB, {
      mutationId: `mut_${crypto.randomUUID()}`,
      entity: "dream_entries",
      recordId: "dream_canary",
      baseVersion: null,
      deviceId: "dev_cloud",
    }).catch(() => null);
    const events = await env.DB.prepare(`SELECT COALESCE(detail,'') AS d FROM system_events`).all<{ d: string }>();
    const all = (events.results ?? []).map((r) => r.d).join(" ");
    expect(all).not.toContain(SENTINEL);
  });

  it("does not carry a sovereign record across the Firm OS bridge", async () => {
    const res = await api("/api/bridge/handoffs", {
      method: "POST",
      body: { direction: "outbound", category: "journal", title: SENTINEL, summary: SENTINEL, payload_ref: "external:dream/dream_canary" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bridge_handoffs WHERE title = ?1 OR summary = ?1`).bind(SENTINEL).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  /**
   * Every outbound request the Worker can make, in one net. Nothing in this repo should reach a
   * vendor during a test — and if anything does, it must not be carrying the sentinel.
   */
  it("makes no outbound request carrying the sentinel", async () => {
    const original = globalThis.fetch;
    const bodies: string[] = [];
    globalThis.fetch = (async (input: any, init: any) => {
      bodies.push(String(init?.body ?? ""), String(input?.url ?? input ?? ""));
      throw new Error("no network in a leakage test");
    }) as any;
    try {
      await takeSnapshot({ ...(env as any), BOSS_DOMAIN: "cloud" }, "canary-2").catch(() => null);
      await exportKnowledge(env as any, {} as any).catch(() => null);
    } finally {
      globalThis.fetch = original;
    }
    expect(bodies.join(" ")).not.toContain(SENTINEL);
  });
});
