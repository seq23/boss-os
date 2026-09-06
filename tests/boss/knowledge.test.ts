import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row } from "./helpers";

/**
 * Phase 15 — Knowledge OS surfaces.
 *
 * Acceptance is three claims: the Manual generates from real promoted memory
 * and regenerates after new promotions; a retired memory stops surfacing
 * without being deleted; and restricted knowledge only leaves the system
 * through an explicit allowlist.
 */

let seq = 0;
const nextTitle = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

/** Captures a memory and promotes it by hand, the way the gate would. */
async function promotedMemory(over: Record<string, unknown> = {}) {
  const { body } = await apiJson("/api/memory", {
    method: "POST",
    body: {
      title: nextTitle("Learned"),
      body: "Something that earned its way up.",
      sensitivity: (over.sensitivity as string) ?? "private",
    },
  });
  const id = body.data.id;
  const tier = (over.tier as string) ?? "working";
  if (tier !== "capture") {
    await env.DB.prepare(`UPDATE memory_items SET tier = ?, promoted_at = ? WHERE id = ?`).bind(tier, Date.now(), id).run();
  }
  return { ...body.data, id, tier };
}

async function file(surface: string, itemId: string, note?: string) {
  return apiJson(`/api/knowledge/surfaces/${surface}/items`, {
    method: "POST",
    body: { item_id: itemId, note },
  });
}

describe("Phase 15 — the twelve surfaces", () => {
  it("ships canon's twelve, and two of them read Phase 14 rather than copying it", async () => {
    const { status, body } = await apiJson("/api/knowledge/surfaces");
    expect(status).toBe(200);
    expect(body.data).toHaveLength(12);

    const keys = body.data.map((s: any) => s.key);
    expect(keys).toEqual([
      "life_wiki", "operating_manual", "decision_vault", "prediction_vault",
      "lessons_learned", "failed_experiments", "breakthrough_library", "operating_patterns",
      "archive_of_self", "legacy_vault", "wisdom_canon", "offline_library",
    ]);

    const byKey = Object.fromEntries(body.data.map((s: any) => [s.key, s]));
    expect(byKey.decision_vault.backing).toBe("decisions");
    expect(byKey.prediction_vault.backing).toBe("predictions");
    expect(byKey.wisdom_canon.tier_floor).toBe("canon");
    expect(byKey.offline_library.offline).toBe(true);
    expect(body.data.filter((s: any) => s.in_manual).length).toBeGreaterThanOrEqual(4);
  });

  it("reads the Decision Vault from the Phase 14 journal", async () => {
    const { body: decision } = await apiJson("/api/investor/decisions", {
      method: "POST",
      body: {
        title: nextTitle("A recorded decision"), context: "It happened",
        options: [{ option: "Do" }, { option: "Do not" }], stakes: "low",
      },
    });

    const { body } = await apiJson("/api/knowledge/surfaces/decision_vault");
    expect(body.data.backing).toBe("decisions");
    expect(body.data.items.some((d: any) => d.id === decision.data.id)).toBe(true);
    expect(body.data.note).toMatch(/Nothing here is a copy/);

    // And nothing can be filed onto it by hand.
    const filed = await file("decision_vault", "mem_whatever");
    expect(filed.status).toBe(409);
    expect(filed.body.hint).toMatch(/Phase 14/);
  });

  it("files a memory onto a surface without copying it", async () => {
    const memory = await promotedMemory();
    const { status, body } = await file("lessons_learned", memory.id, "Learned the hard way");
    expect(status).toBe(201);
    expect(body.data.item_id).toBe(memory.id);

    const surface = await apiJson("/api/knowledge/surfaces/lessons_learned");
    const listed = surface.body.data.items.find((i: any) => i.id === memory.id);
    expect(listed.title).toBe(memory.title);
    expect(listed.note).toBe("Learned the hard way");

    // One row in the filing table, and the memory itself untouched.
    expect(await all(`SELECT * FROM knowledge_items WHERE item_id = ?`, memory.id)).toHaveLength(1);
    expect(await row(`SELECT COUNT(*) AS n FROM memory_items WHERE id = ?`, memory.id)).toMatchObject({ n: 1 });

    const again = await file("lessons_learned", memory.id);
    expect(again.status).toBe(409);
  });

  it("holds the Wisdom Canon to canon tier", async () => {
    const working = await promotedMemory({ tier: "working" });
    const refused = await file("wisdom_canon", working.id);
    expect(refused.status).toBe(409);
    expect(refused.body.hint).toMatch(/Promote it through the gate/);

    const canon = await promotedMemory({ tier: "canon" });
    const accepted = await file("wisdom_canon", canon.id);
    expect(accepted.status).toBe(201);
  });

  it("unfiles without deleting the memory", async () => {
    const memory = await promotedMemory();
    await file("life_wiki", memory.id);
    const { status, body } = await apiJson(`/api/knowledge/surfaces/life_wiki/items/${memory.id}/remove`, {
      method: "POST", body: {},
    });
    expect(status).toBe(200);
    expect(body.data.memory_kept).toBe(true);
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, memory.id)).toBeTruthy();
    expect(await all(`SELECT * FROM knowledge_items WHERE item_id = ?`, memory.id)).toHaveLength(0);
  });
});

describe("Phase 15 — the Personal Operating Manual", () => {
  it("generates from promoted memory and says so when it has none", async () => {
    const empty = await apiJson("/api/knowledge/manual");
    expect(empty.body.data.manual).toBeNull();
    expect(empty.body.data.note).toMatch(/never typed/);

    const lesson = await promotedMemory({ tier: "working" });
    await file("lessons_learned", lesson.id);
    const principle = await promotedMemory({ tier: "canon" });
    await file("wisdom_canon", principle.id);

    const { status, body } = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    expect(status).toBe(201);
    expect(body.data.version).toBe(1);
    expect(body.data.unchanged).toBe(false);
    expect(body.data.item_count).toBe(2);
    expect(body.data.sections.map((s: any) => s.surface)).toEqual(["lessons_learned", "wisdom_canon"]);
    expect(body.data.sections[0].entries[0].item_id).toBe(lesson.id);
    expect(body.data.sha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = await row(`SELECT * FROM manual_versions WHERE version = 1`);
    expect(JSON.parse(stored!.source_item_ids)).toContain(principle.id);
  });

  it("does not write a version when nothing changed", async () => {
    const memory = await promotedMemory();
    await file("lessons_learned", memory.id);
    const first = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    const second = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });

    expect(second.status).toBe(200);
    expect(second.body.data.unchanged).toBe(true);
    expect(second.body.data.version).toBe(first.body.data.version);
    expect(second.body.data.sha256).toBe(first.body.data.sha256);
    expect(await all(`SELECT id FROM manual_versions`)).toHaveLength(1);
  });

  it("regenerates after a new promotion, superseding the version before it", async () => {
    const first = await promotedMemory();
    await file("operating_patterns", first.id);
    const v1 = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });

    const second = await promotedMemory();
    await file("operating_patterns", second.id);
    const v2 = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });

    expect(v2.status).toBe(201);
    expect(v2.body.data.version).toBe(2);
    expect(v2.body.data.item_count).toBe(2);
    expect(v2.body.data.sha256).not.toBe(v1.body.data.sha256);
    expect(v2.body.data.supersedes_id).toBe(v1.body.data.id);

    const versions = await apiJson("/api/knowledge/manual/versions");
    expect(versions.body.data.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it("leaves capture-tier and restricted memory out, and counts what it left out", async () => {
    const promoted = await promotedMemory({ tier: "working" });
    await file("lessons_learned", promoted.id);
    const unpromoted = await promotedMemory({ tier: "capture" });
    await file("failed_experiments", unpromoted.id);
    const restricted = await promotedMemory({ tier: "working", sensitivity: "restricted" });
    await file("lessons_learned", restricted.id);

    const { body } = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    const ids = body.data.sections.flatMap((s: any) => s.entries.map((e: any) => e.item_id));
    expect(ids).toContain(promoted.id);
    expect(ids).not.toContain(unpromoted.id);
    expect(ids).not.toContain(restricted.id);
    expect(body.data.excluded.unpromoted).toBe(1);
    expect(body.data.excluded.restricted).toBe(1);
  });
});

describe("Phase 15 — memory retirement", () => {
  it("stops a memory surfacing without deleting it", async () => {
    const memory = await promotedMemory();
    await file("lessons_learned", memory.id);
    await file("offline_library", memory.id);
    await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });

    const { status, body } = await apiJson(`/api/memory/${memory.id}/retire`, {
      method: "POST", body: { reason: "The arrangement it describes ended." },
    });
    expect(status).toBe(200);
    expect(body.data.item.retired_at).toBeGreaterThan(0);
    expect(body.data.item.retired_reason).toMatch(/arrangement/);

    // Still there. Still filed. Still has its history.
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, memory.id)).toBeTruthy();
    expect(await all(`SELECT * FROM knowledge_items WHERE item_id = ?`, memory.id)).toHaveLength(2);

    // And gone from every surface it used to appear on.
    const surface = await apiJson("/api/knowledge/surfaces/lessons_learned");
    expect(surface.body.data.items.some((i: any) => i.id === memory.id)).toBe(false);

    const list = await apiJson("/api/memory");
    expect(list.body.data.some((m: any) => m.id === memory.id)).toBe(false);

    const withRetired = await apiJson("/api/memory?retired=only");
    expect(withRetired.body.data.some((m: any) => m.id === memory.id)).toBe(true);

    const regenerated = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    const ids = regenerated.body.data.sections.flatMap((s: any) => s.entries.map((e: any) => e.item_id));
    expect(ids).not.toContain(memory.id);
    // The counts are of filings on manual surfaces: this memory was filed on
    // one of those and on the offline library, which the manual never reads.
    expect(regenerated.body.data.excluded.retired).toBe(1);

    const ledger = await apiJson("/api/knowledge/retirements");
    expect(ledger.body.data[0]).toMatchObject({ item_id: memory.id, action: "retired" });
  });

  it("wants a reason, and refuses to retire twice", async () => {
    const memory = await promotedMemory();
    const noReason = await apiJson(`/api/memory/${memory.id}/retire`, { method: "POST", body: {} });
    expect(noReason.status).toBe(400);
    expect(noReason.body.hint).toMatch(/stopped being true/);

    await api(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Superseded." } });
    const again = await apiJson(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Again." } });
    expect(again.status).toBe(409);
  });

  it("restores a retired memory, and records both events", async () => {
    const memory = await promotedMemory();
    await file("life_wiki", memory.id);
    await api(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Thought it was over." } });

    const { status, body } = await apiJson(`/api/memory/${memory.id}/unretire`, {
      method: "POST", body: { reason: "It came back." },
    });
    expect(status).toBe(200);
    expect(body.data.item.retired_at).toBeNull();

    const surface = await apiJson("/api/knowledge/surfaces/life_wiki");
    expect(surface.body.data.items.some((i: any) => i.id === memory.id)).toBe(true);

    const ledger = await all(`SELECT action FROM knowledge_retirements WHERE item_id = ? ORDER BY ts ASC`, memory.id);
    expect(ledger.map((r: any) => r.action)).toEqual(["retired", "restored"]);
  });

  it("keeps retired memory out of the promotion sweep and the promotion gate", async () => {
    const memory = await promotedMemory({ tier: "capture" });
    await env.DB
      .prepare(`UPDATE memory_items SET hits = 50, confidence = 0.99, created_at = ? WHERE id = ?`)
      .bind(Date.now() - 30 * 86_400_000, memory.id)
      .run();
    await api(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Wrong from the start." } });

    const byHand = await apiJson(`/api/memory/${memory.id}/promote`, { method: "POST", body: { to_tier: "working" } });
    expect(byHand.status).toBe(409);
    expect(byHand.body.hint).toMatch(/canon rots/);

    await api("/api/memory/sweep", { method: "POST", body: {} });
    expect(await all(`SELECT id FROM promotion_events WHERE item_id = ?`, memory.id)).toHaveLength(0);
  });

  it("will not file a retired memory onto a surface", async () => {
    const memory = await promotedMemory();
    await api(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Done with it." } });
    const { status, body } = await file("life_wiki", memory.id);
    expect(status).toBe(409);
    expect(body.error).toMatch(/retired/);
  });
});

describe("Phase 15 — portable export and the restricted-class allowlist", () => {
  it("exports what is filed, with a manifest that verifies", async () => {
    const memory = await promotedMemory();
    await file("life_wiki", memory.id);
    await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });

    const { status, body } = await apiJson("/api/knowledge/exports", { method: "POST", body: {} });
    expect(status).toBe(201);
    expect(body.data.item_count).toBe(1);
    expect(body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.manifest.entries[0]).toMatchObject({ item_id: memory.id, surfaces: ["life_wiki"] });
    expect(body.data.manifest.entries[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.manifest.manual_version).toBe(1);

    const verify = await apiJson(`/api/knowledge/exports/${body.data.id}/verify`);
    expect(verify.body.data.ok).toBe(true);
    expect(verify.body.data.sha_match).toBe(true);
    expect(verify.body.data.items_present).toBe(1);

    // It really is in the bucket, and it really parses.
    const object = await env.VAULT.get(body.data.r2_key);
    expect(object).toBeTruthy();
    const parsed = JSON.parse(await object!.text());
    expect(parsed.documents[0].item_id).toBe(memory.id);
    expect(parsed.manual.version).toBe(1);
  });

  it("leaves restricted knowledge out unless it is explicitly allowlisted", async () => {
    const ordinary = await promotedMemory({ sensitivity: "private" });
    const restricted = await promotedMemory({ sensitivity: "restricted" });
    await file("life_wiki", ordinary.id);
    await file("archive_of_self", restricted.id);

    const withheld = await apiJson("/api/knowledge/exports", { method: "POST", body: {} });
    expect(withheld.body.data.item_count).toBe(1);
    expect(withheld.body.data.restricted_excluded).toBe(1);
    expect(withheld.body.data.restricted_included).toBe(0);
    expect(withheld.body.data.manifest.excluded[0]).toMatchObject({ item_id: restricted.id });
    expect(withheld.body.data.manifest.excluded[0].reason).toMatch(/restricted class/);

    const written = await env.VAULT.get(withheld.body.data.r2_key);
    expect(await written!.text()).not.toContain(restricted.title);

    // Asking for it is not enough; the confirmation is the allowlist.
    const unconfirmed = await apiJson("/api/knowledge/exports", {
      method: "POST", body: { include_restricted: true },
    });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.hint).toMatch(/INCLUDE RESTRICTED/);

    const wrongWords = await apiJson("/api/knowledge/exports", {
      method: "POST", body: { include_restricted: true, confirm: "yes please" },
    });
    expect(wrongWords.status).toBe(409);

    const allowlisted = await apiJson("/api/knowledge/exports", {
      method: "POST", body: { include_restricted: true, confirm: "INCLUDE RESTRICTED" },
    });
    expect(allowlisted.status).toBe(201);
    expect(allowlisted.body.data.item_count).toBe(2);
    expect(allowlisted.body.data.restricted_included).toBe(1);
    expect(allowlisted.body.data.restricted_excluded).toBe(0);

    // Both exports are on the record, and the one that carried restricted
    // content is marked as having done so.
    const stored = await all(`SELECT restricted_included FROM knowledge_exports ORDER BY ts ASC`);
    expect(stored.map((e: any) => e.restricted_included)).toEqual([0, 1]);
  });

  it("never exports retired memory", async () => {
    const memory = await promotedMemory();
    await file("life_wiki", memory.id);
    await api(`/api/memory/${memory.id}/retire`, { method: "POST", body: { reason: "Not true any more." } });

    const { body } = await apiJson("/api/knowledge/exports", { method: "POST", body: {} });
    expect(body.data.item_count).toBe(0);
    const object = await env.VAULT.get(body.data.r2_key);
    expect(await object!.text()).not.toContain(memory.title);
  });

  it("exports one surface when asked, and refuses a surface that does not exist", async () => {
    const wiki = await promotedMemory();
    const lesson = await promotedMemory();
    await file("life_wiki", wiki.id);
    await file("lessons_learned", lesson.id);

    const { body } = await apiJson("/api/knowledge/exports", { method: "POST", body: { scope: "life_wiki" } });
    expect(body.data.item_count).toBe(1);
    expect(body.data.manifest.entries[0].item_id).toBe(wiki.id);

    const bogus = await apiJson("/api/knowledge/exports", { method: "POST", body: { scope: "nope" } });
    expect(bogus.status).toBe(400);
  });

  it("reports a corrupted export instead of trusting its own record", async () => {
    const memory = await promotedMemory();
    await file("life_wiki", memory.id);
    const { body } = await apiJson("/api/knowledge/exports", { method: "POST", body: {} });

    await env.VAULT.put(body.data.r2_key, "not the file that was written");
    const verify = await apiJson(`/api/knowledge/exports/${body.data.id}/verify`);
    expect(verify.body.data.ok).toBe(false);
    expect(verify.body.data.sha_match).toBe(false);
    expect(verify.body.data.reason).toMatch(/hash does not match|did not parse/);
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 15 — acceptance", () => {
  it("manual generates and regenerates, retirement hides without deleting, restricted stays home", async () => {
    const lesson = await promotedMemory({ tier: "working" });
    const principle = await promotedMemory({ tier: "canon" });
    const secret = await promotedMemory({ tier: "working", sensitivity: "restricted" });
    await file("lessons_learned", lesson.id);
    await file("wisdom_canon", principle.id);
    await file("legacy_vault", secret.id);

    const v1 = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    expect(v1.body.data.version).toBe(1);
    expect(v1.body.data.item_count).toBe(2);

    // A new promotion changes the manual.
    const pattern = await promotedMemory({ tier: "working" });
    await file("operating_patterns", pattern.id);
    const v2 = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    expect(v2.body.data.version).toBe(2);
    expect(v2.body.data.item_count).toBe(3);
    expect(v2.body.data.supersedes_id).toBe(v1.body.data.id);

    // Retiring one hides it everywhere, and the row survives.
    await api(`/api/memory/${lesson.id}/retire`, { method: "POST", body: { reason: "Superseded by the pattern." } });
    const v3 = await apiJson("/api/knowledge/manual/generate", { method: "POST", body: {} });
    expect(v3.body.data.version).toBe(3);
    expect(v3.body.data.item_count).toBe(2);
    expect(await row(`SELECT id, retired_reason FROM memory_items WHERE id = ?`, lesson.id)).toMatchObject({ id: lesson.id });

    // The export carries the live knowledge, and leaves the restricted item home.
    const exported = await apiJson("/api/knowledge/exports", { method: "POST", body: {} });
    const ids = exported.body.data.manifest.entries.map((e: any) => e.item_id);
    expect(ids).toContain(principle.id);
    expect(ids).toContain(pattern.id);
    expect(ids).not.toContain(lesson.id);
    expect(ids).not.toContain(secret.id);
    expect(exported.body.data.restricted_excluded).toBe(1);

    const verify = await apiJson(`/api/knowledge/exports/${exported.body.data.id}/verify`);
    expect(verify.body.data.ok).toBe(true);
  });
});
