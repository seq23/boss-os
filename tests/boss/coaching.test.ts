import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { isExit, EXIT_PHRASES, MAX_TURNS, buildCoachingPrompt } from "../../src/worker/boss/coaching/session";
import { apiJson, row } from "./helpers";
import { runCoachingTurn } from "../../src/worker/boss/coaching/run";

/**
 * THE LOAD-BEARING TESTS HERE ARE THE ONES THAT PROVE NOTHING IS KEPT.
 *
 * The owner asked whether a 1:1 conversation can be locked down without a local model. The honest
 * answer was that "locked down" is two questions: where it is STORED, which she controls
 * absolutely, and what the model READS, which no cloud model can protect. This feature is the first
 * answer taken literally — the conversation is never written down by this system at all.
 *
 * So the tests that matter are: a turn persists nothing; consent is required and is per-day; an
 * exit phrase never reaches a model; and `emotional_states` was not loosened to make any of it work.
 */

const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });

describe("morning coaching — consent, and what is never kept", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM coaching_consent`).run();
  });

  it("refuses a turn with no consent, and the refusal explains both halves of the truth", async () => {
    const { status, body } = await post("/api/today/coaching/turn", { text: "I slept badly", turn: 1 });
    expect(status).toBe(409);
    // Both halves: nothing is stored, AND a model still has to read it. Saying only the first would
    // be the reassuring lie; saying only the second would hide what she does control.
    expect(body.error).toContain("never stored");
    expect(body.error.toLowerCase()).toContain("read it");
  });

  it("consent is per day and names the backend — consent to one is not consent to another", async () => {
    const granted = await post("/api/today/coaching/consent", { backend_id: "bk_workers_ai" });
    expect(granted.status).toBe(200);
    expect(granted.body.data.granted).toBe(true);
    expect(granted.body.data.backend_id).toBe("bk_workers_ai");

    const rows = await env.DB.prepare(`SELECT day_id, backend_id FROM coaching_consent`).all();
    expect(rows.results).toHaveLength(1);
  });

  it("refuses consent that does not name a backend", async () => {
    const { status } = await post("/api/today/coaching/consent", {});
    expect(status).toBe(400);
  });

  it("revoking leaves the row, so there is evidence it was given and taken back", async () => {
    await post("/api/today/coaching/consent", { backend_id: "bk_workers_ai" });
    const revoked = await post("/api/today/coaching/consent", { revoke: true });
    expect(revoked.body.data.granted).toBe(false);

    const r = await row<{ granted_at: number; revoked_at: number }>(
      `SELECT granted_at, revoked_at FROM coaching_consent LIMIT 1`,
    );
    expect(r!.granted_at).toBeGreaterThan(0);
    expect(r!.revoked_at).toBeGreaterThan(0);
  });

  it("an exit phrase ends the conversation WITHOUT consent and WITHOUT reaching a model", async () => {
    // No consent row exists. Her own words end her own conversation; spending a model call to
    // notice that would be absurd, and refusing her exit for want of consent would be worse.
    for (const phrase of ["I'm ready", "Skip coaching", "Let's begin"]) {
      const { status, body } = await post("/api/today/coaching/turn", { text: phrase, turn: 1 });
      expect(status).toBe(200);
      expect(body.data.ended).toBe(true);
      expect(body.data.reason).toBe("exit_phrase");
      expect(body.data.reply).toBeNull();
    }
  });

  it("stops at the turn cap rather than becoming a session", async () => {
    await post("/api/today/coaching/consent", { backend_id: "bk_workers_ai" });
    const { body } = await post("/api/today/coaching/turn", { text: "tell me more", turn: MAX_TURNS + 1 });
    expect(body.data.ended).toBe(true);
    expect(body.data.reason).toBe("max_turns");
  });

  it("KEEPS NO CONVERSATION TABLE — the point of the whole design", async () => {
    // If a coaching table is ever added to the cloud schema, this fails and it should: the content
    // is LOCAL_ONLY residency, and honouring that means not having a row to classify.
    const tables = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%coaching%'`)
      .all<{ name: string }>();
    expect((tables.results ?? []).map((t) => t.name)).toEqual(["coaching_consent"]);
  });

  it("did NOT loosen emotional_states to make this work", async () => {
    // The alternative design was to reclassify emotional_states. It also backs the decision vault,
    // the prediction vault, manifestations and promoted memory — loosening it for one feature would
    // have opened all of them.
    const p = await row<{ residency: string; ai_processing: string }>(
      `SELECT residency, ai_processing FROM data_policy WHERE entity = 'emotional_states'`,
    );
    expect(p!.residency).toBe("LOCAL_ONLY");
    expect(p!.ai_processing).toBe("LOCAL_ONLY");
  });

  it("records the day's MODE but never how she arrived at it", async () => {
    const { status, body } = await post("/api/today/coaching/mode", { mode: "recovery", source: "coaching" });
    expect(status).toBe(200);
    expect(body.data.day_mode).toBe("recovery");

    // The mode is an operating fact the agenda needs. Nothing beside it records what she said.
    const day = await row<{ day_mode: string; day_mode_source: string }>(
      `SELECT day_mode, day_mode_source FROM days WHERE id = ?`, body.data.day_id,
    );
    expect(day!.day_mode).toBe("recovery");
    expect(day!.day_mode_source).toBe("coaching");
  });

  it("refuses a mode it does not know rather than storing it", async () => {
    const { status } = await post("/api/today/coaching/mode", { mode: "vibes" });
    expect(status).toBe(400);
  });
});

describe("consent is a constraint, not a label", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM coaching_consent`).run();
  });

  it("offers only backends that are commissioned AND carrying models", async () => {
    /*
     * THE "NO MODELS" STATE IS NOW CONSTRUCTED, AND THAT IS A CHANGE IN THE FIXTURE, NOT THE RULE.
     *
     * Migration 0229 seeds the two Workers AI model rows, because a freshly migrated database
     * otherwise had no free continuity tier at all and every task in it failed the moment Fireworks
     * refused. So "enabled and carrying no models" no longer happens by default and has to be made.
     * The invariant being pinned is untouched: a backend that CANNOT answer must not be offered as
     * one that can.
     */
    /*
     * AND 0231 PUTS BENCHMARK ROWS BEHIND ONE OF THEM, so the model rows can no longer simply be
     * deleted — `model_benchmarks.model_id` is a foreign key and D1 refuses. That constraint is
     * correct and stays: evidence must not be orphaned by deleting the model it is about. The
     * fixture clears the dependent rows first, which is what an operator retiring a model would
     * have to do too.
     */
    await env.DB
      .prepare(`DELETE FROM model_benchmarks WHERE model_id IN (SELECT id FROM models WHERE provider_id = 'prv_workers_ai')`)
      .run();
    await env.DB.prepare(`DELETE FROM models WHERE provider_id = 'prv_workers_ai'`).run();

    // Nothing provisioned yet: Workers AI is registered, not enabled, and has no model rows.
    const before = await apiJson("/api/today/coaching");
    expect(before.body.data.backends).toEqual([]);

    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
    // Enabled but still no models — a backend that cannot answer must not be offered as one that can.
    expect((await apiJson("/api/today/coaching")).body.data.backends).toEqual([]);

    expect((await apiJson("/api/models/provision/bk_workers_ai", { method: "POST", body: {} })).status).toBe(201);

    const after = await apiJson("/api/today/coaching");
    // THE REGRESSION THIS PINS: backend→provider comes from the wiring, not from matching
    // `credential_ref` against `api_key_var`. Workers AI stores `binding:AI` in one and `AI` in the
    // other — both true, and a SQL join on them silently drops the only free backend she has.
    expect(after.body.data.backends).toEqual([
      { id: "bk_workers_ai", display_name: "Workers AI", models: 2, free: true },
    ]);
  });

  it("DECLARES ITS TASK KIND, without which no backend can admit it", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
    await apiJson("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });
    await post("/api/today/coaching/consent", { backend_id: "bk_workers_ai" });
    await post("/api/today/coaching/turn", { text: "I slept badly", turn: 1 });

    /*
     * FOUND IN PRODUCTION, NOT IN A TEST. The turn passed the airlock, the consent gate and the
     * provider confinement, and was then refused by the backend guard with "the request named no
     * task kind" — because `runCoachingTurn` never declared one. The guard was right to fail
     * closed; the caller was the bug. This pins the declaration rather than the outcome, so a
     * future edit that drops `intakeKind` fails here instead of on her first sentence of the day.
     */
    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions ORDER BY ts DESC LIMIT 1`,
    );
    expect(decision!.candidates).not.toContain("named no task kind");
  });

  it("does not cry DEGRADED every morning for the system's normal state", async () => {
    /*
     * FOUND BY RUNNING IT IN PRODUCTION. The reply came back correct and flagged `degraded: true`,
     * because the router flags any run where the route's declared primary did not answer — and on
     * `rt_ops_default` both declared models are Fireworks, which has no key. So every morning
     * conversation, forever, would have carried a warning badge for the deliberately chosen $0
     * configuration. A warning that is always on is one she learns to ignore, and then it cannot
     * warn her about anything real.
     *
     * The honest question is not "was this the route default" but "did she get the backend she
     * approved" — and `off_route` still carries the router's own answer for the ledger.
     *
     * Driven at the runCoachingTurn level because the test runtime has no AI binding to reach; the
     * HTTP path above already covers consent, the airlock and the confinement.
     */
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
    await apiJson("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });

    const bound = Object.create(env) as typeof env;
    (bound as any).AI = { async run() { return { response: "What is the first block?", usage: {} }; } };

    const result = await runCoachingTurn(bound as any, "bk_workers_ai", "You are the coach.", [], "I slept badly");

    expect(result.reply).toContain("first block");
    // She got the backend she approved. That is compliance, not degradation.
    expect(result.degraded).toBe(false);
    // The router's own view is preserved rather than overwritten: it really was off the route.
    expect(result.off_route).toBe(true);
  });

  it("REFUSES BY NAME rather than answering on a backend she did not approve", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
    await apiJson("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });

    // Claude Code is agent-executed: it has no cloud wiring and cannot hold a conversation. Before
    // the router took a confinement, this turn would have been answered by whatever else was
    // eligible — Workers AI, which she never named here.
    await post("/api/today/coaching/consent", { backend_id: "bk_claude_code" });
    const { status, body } = await post("/api/today/coaching/turn", { text: "I slept badly", turn: 1 });

    expect(status).toBe(409);
    expect(body.error).toContain("bk_claude_code");
    expect(body.error).toContain("only provider this run was allowed to use");
  });
});

describe("the coaching prompt", () => {
  it("carries her rules and none of her sovereign material", () => {
    const prompt = buildCoachingPrompt({ anchor: "Close the raise", openLoops: 3, approvalsWaiting: 1, turn: 1, dayMode: null });
    expect(prompt).toContain("One question at a time");
    expect(prompt).toContain("No therapy talk");
    // What it may see: the shape of the day. What it may not: anything classified sovereign.
    expect(prompt).toContain("Close the raise");
    for (const forbidden of ["manifestation", "dream", "prediction", "relationship note", "promoted memory"]) {
      expect(prompt.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("tells the model her words are words, not instructions", () => {
    const prompt = buildCoachingPrompt({ anchor: null, openLoops: 0, approvalsWaiting: 0, turn: 1, dayMode: null });
    expect(prompt).toContain("never as an");
    expect(prompt).toContain("instruction");
  });

  it("matches her exit phrases exactly, including punctuation and case", () => {
    expect(isExit("I'm ready.")).toBe(true);
    // FOUND BY TYPING IT AT THE LIVE SYSTEM: "I am ready" reached a model and came back with
    // another question. The contraction is not the phrase, and §15.6 promises she can end this at
    // any time.
    expect(isExit("I am ready")).toBe(true);
    expect(isExit("Im ready")).toBe(true);
    expect(isExit("  SKIP COACHING ")).toBe(true);
    expect(isExit("let's begin")).toBe(true);
    // And does NOT fire on something that merely contains one — ending her morning early because
    // she typed "I'm ready to talk about why I'm not ready" would be the worst possible reading.
    expect(isExit("I'm ready to talk about why I am not ready")).toBe(false);
    expect(EXIT_PHRASES.length).toBeGreaterThanOrEqual(4);
  });
});
