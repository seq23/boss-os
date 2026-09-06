import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { classify, assertMayEnterCloud, assertMayReachExternalModel, tighten, AirlockRefusal } from "../../src/worker/boss/policy/airlock";

/**
 * The airlock, tested the way it will actually be attacked: not "does it allow the allowed", but
 * "can anything make it allow the forbidden".
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});

describe("Boss OS v20.1 §3 — the airlock", () => {
  it("refuses an entity nobody classified, rather than trusting it", async () => {
    const c = await classify(env.DB, "a_table_that_does_not_exist");
    expect(c.source).toBe("unclassified");
    expect(c.residency).toBe("LOCAL_ONLY");
    expect(c.ai_processing).toBe("LOCAL_ONLY");
    await expect(assertMayEnterCloud(env.DB, "a_table_that_does_not_exist")).rejects.toThrow(AirlockRefusal);
    await expect(assertMayReachExternalModel(env.DB, "a_table_that_does_not_exist")).rejects.toThrow(AirlockRefusal);
  });

  it("keeps Spirit OS out of the cloud and away from a hosted model", async () => {
    for (const entity of ["dream_entries", "manifestations", "rituals", "ancestor_entries", "contributions"]) {
      await expect(assertMayEnterCloud(env.DB, entity)).rejects.toThrow(/NOTHING TRANSMITTED/);
      await expect(assertMayReachExternalModel(env.DB, entity)).rejects.toThrow(/NOTHING TRANSMITTED/);
    }
  });

  it("keeps the computed sky out of that rule, because arithmetic is not confession", async () => {
    const c = await classify(env.DB, "astro_days");
    expect(c.residency).toBe("CLOUD_SYNC");
    await expect(assertMayEnterCloud(env.DB, "astro_days")).resolves.toBeTruthy();
  });

  it("refuses the decision and prediction vaults, and the emotional-state record", async () => {
    for (const entity of ["decisions", "predictions", "red_team_reviews", "emotional_states"]) {
      await expect(assertMayEnterCloud(env.DB, entity)).rejects.toThrow(AirlockRefusal);
    }
  });

  it("lets operating machinery through, or nothing would work", async () => {
    for (const entity of ["tasks", "approvals", "employees", "capabilities"]) {
      await expect(assertMayEnterCloud(env.DB, entity)).resolves.toBeTruthy();
      await expect(assertMayReachExternalModel(env.DB, entity)).resolves.toBeTruthy();
    }
  });

  it("holds an approval-class entity until an approval is actually held", async () => {
    await expect(assertMayReachExternalModel(env.DB, "people")).rejects.toThrow(/APPROVAL REQUIRED/);
    await expect(assertMayReachExternalModel(env.DB, "people", null, true)).resolves.toBeTruthy();
  });

  it("lets one record be tightened below its entity, and records that it happened", async () => {
    const after = await tighten(env.DB, {
      entity: "tasks",
      recordId: "task_private_1",
      residency: "LOCAL_ONLY",
      ai_processing: "LOCAL_ONLY",
      reason: "This one names a person's health.",
      by: "owner",
    });
    expect(after.residency).toBe("LOCAL_ONLY");
    await expect(assertMayEnterCloud(env.DB, "tasks", "task_private_1")).rejects.toThrow(AirlockRefusal);
    // The entity default is untouched: tightening one record does not close the door on the rest.
    await expect(assertMayEnterCloud(env.DB, "tasks", "task_ordinary_1")).resolves.toBeTruthy();

    const log = await env.DB
      .prepare(`SELECT from_residency, to_residency, changed_by FROM policy_change_log WHERE entity = 'tasks' AND record_id = 'task_private_1'`)
      .first<{ from_residency: string; to_residency: string; changed_by: string }>();
    expect(log?.from_residency).toBe("CLOUD_SYNC");
    expect(log?.to_residency).toBe("LOCAL_ONLY");
    expect(log?.changed_by).toBe("owner");
  });

  /**
   * The attack the whole design exists to stop: §3.3 forbids "an override that converts a
   * sovereign request into external inference".
   */
  it("cannot be loosened — not through the API, and not by a row written behind its back", async () => {
    await expect(
      tighten(env.DB, {
        entity: "dream_entries",
        recordId: "dream_1",
        residency: "CLOUD_SYNC",
        reason: "trying to publish a dream",
        by: "attacker",
      }),
    ).rejects.toThrow(/may only tighten/);

    // And with the guard bypassed entirely — a row inserted straight into the table — classify()
    // still returns the tighter of the two, so a planted override buys nothing.
    await env.DB
      .prepare(
        `INSERT INTO record_policy (entity, record_id, residency, ai_processing, reason, set_by)
         VALUES ('dream_entries', 'dream_2', 'CLOUD_SYNC', 'EXTERNAL_OK', 'planted', 'attacker')`,
      )
      .run();
    const c = await classify(env.DB, "dream_entries", "dream_2");
    expect(c.residency).toBe("LOCAL_ONLY");
    expect(c.ai_processing).toBe("LOCAL_ONLY");
    await expect(assertMayEnterCloud(env.DB, "dream_entries", "dream_2")).rejects.toThrow(AirlockRefusal);
  });

  it("names the entity in a refusal and never the record", async () => {
    try {
      await assertMayEnterCloud(env.DB, "dream_entries", "dream_3");
      throw new Error("should have refused");
    } catch (e) {
      const r = e as AirlockRefusal;
      expect(r.entity).toBe("dream_entries");
      expect(r.axis).toBe("residency");
      expect(r.message).toContain("NOTHING TRANSMITTED");
    }
  });
});
