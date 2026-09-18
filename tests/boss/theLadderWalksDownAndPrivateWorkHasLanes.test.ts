import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateModel, type ModelRow } from "../../src/worker/boss/router/policy";
import { isPrivateModelRoute } from "../../src/worker/boss/router/modelAccess";
import { openrouter } from "../../src/worker/boss/router/openrouter";
import { orderCandidates } from "../../src/shared/boss/router/candidateOrder.mjs";
import { CLOUD_BACKENDS } from "../../src/worker/boss/router/backends";
import { COST_MODE_POLICY } from "../../src/shared/boss/governance";
import { MAX_FREE_HOPS } from "../../src/worker/boss/router";
import { all, stubFetch } from "./helpers";

/**
 * THE LADDER, AND THE HALF OF IT THE OWNER CARES ABOUT MOST.
 *
 * `scripts/validate/the-ladder-is-walkable-and-free-before-paid.mjs` proves the SHAPE of the ladder
 * against the replayed migrations. This proves the BEHAVIOUR, against the real database and the
 * real `evaluateModel` and the real adapter — because a row saying "this lane may hold an LP name"
 * is a note in a table until something is observed refusing the lanes that may not.
 *
 * Before 0256 exactly two model rows could carry private work, both on Workers AI. Every cloud
 * fallback was training-permitting, so the day Workers AI was down, private work stopped. The whole
 * point of registering six paid reasoning lanes was to end that, and the assertions here are the
 * ones that would go red if it were ever quietly undone.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const MODEL_COLUMNS =
  `SELECT m.id, m.slug, m.provider_id, m.display_name, m.in_micros_1k, m.out_micros_1k,
          m.enabled, m.privacy_class, m.capability_tier, m.benchmark_status,
          m.approved_task_kinds, m.forbidden_task_kinds, m.max_risk, m.data_use,
          m.reasoning, m.ladder_rung, p.base_url, p.api_key_var
     FROM models m JOIN providers p ON p.id = m.provider_id
    WHERE m.enabled = 1 AND p.enabled = 1 AND m.ladder_rung IS NOT NULL
    ORDER BY m.ladder_rung`;

const ladder = () => all<ModelRow & { ladder_rung: number; reasoning: number }>(MODEL_COLUMNS);

/** The screening context for ordinary public work in the live cost mode. */
const publicCtx = (over: Record<string, unknown> = {}) => ({
  policy: COST_MODE_POLICY.NORMAL,
  risk: "low",
  sensitivity: "private",
  intakeKind: "drafting",
  requireBenchmarkHighRisk: true,
  cloudForRestrictedAllowed: false,
  modelAccess: "public_model_approved" as const,
  modelAccessReason: "",
  ...over,
}) as Parameters<typeof evaluateModel>[1];

describe("the ladder exists and can actually be walked", () => {
  it("has rungs, and Rule 0 says an empty ladder is a failure rather than a pass", async () => {
    const rungs = await ladder();
    expect(rungs.length).toBeGreaterThan(0);
    // The numbers are the ones 0256 seeded; a ladder that shrank to one rung would pass every
    // ordering assertion below while doing nothing, which is why the count is pinned first.
    expect(rungs.length).toBeGreaterThanOrEqual(10);
  });

  it("puts every free rung before every paid rung, through the shipped comparator", async () => {
    const rungs = await ladder();
    const isFree = (m: typeof rungs[number]) =>
      m.slug.endsWith(":free") || m.provider_id === "prv_workers_ai";
    const costOf = (m: typeof rungs[number]) => (isFree(m) ? 0 : m.in_micros_1k + m.out_micros_1k);

    const ordered = orderCandidates([...rungs].reverse(), costOf);
    const firstPaid = ordered.findIndex((m) => !isFree(m));
    const lastFree = ordered.map(isFree).lastIndexOf(true);

    expect(firstPaid).toBeGreaterThan(-1);
    // Nothing billed may be reached before every free lane has been tried. This is her instruction
    // in one assertion: "move down the line from claude to anyone that is $0 ... last resort paid".
    expect(lastFree).toBeLessThan(firstPaid);
  });

  it("is not stopped short by a hop limit, which is what made thirteen lanes decoration", async () => {
    const rungs = await ladder();
    const free = rungs.filter((m) => m.slug.endsWith(":free") || m.provider_id === "prv_workers_ai");
    // A free attempt spends nothing, so the free walk must reach every free rung. This failed the
    // build once already at MAX_FREE_HOPS = 6 against 8 rungs.
    expect(MAX_FREE_HOPS).toBeGreaterThanOrEqual(free.length);
    // And the paid walk must have real depth. At 1 an outage on the cheapest paid lane ended the run.
    expect(COST_MODE_POLICY.NORMAL.maxFallbackHops).toBeGreaterThanOrEqual(3);
  });

  it("registers no rung the live cost mode refuses, so none of it is inert", async () => {
    const rungs = await ladder();
    const allowed = COST_MODE_POLICY.NORMAL.allowedTiers as readonly string[];
    for (const m of rungs) {
      // A `frontier` rung is refused at Stage 2 on every ordinary run and the ladder stops above it.
      expect(allowed, `${m.display_name} (rung ${m.ladder_rung}) is tier ${m.capability_tier}`)
        .toContain(m.capability_tier);
    }
  });

  it("gained a free reasoning brain, and reaches it first", async () => {
    const rungs = await ladder();
    const free = rungs.filter((m) => m.slug.endsWith(":free") || m.provider_id === "prv_workers_ai");
    // Before 0256 the free tier was Llama 3.3 70B and Gemma 3 27B, neither of which reasons.
    expect(free.filter((m) => m.reasoning === 1).length).toBeGreaterThan(0);
    expect(free[0].reasoning, `first free rung is ${free[0].display_name}`).toBe(1);
  });
});

describe("private work has somewhere to run, and it is never a free lane", () => {
  it("went from two lanes to many, which is the point of the whole change", async () => {
    const rungs = await ladder();
    const priv = rungs.filter((m) => isPrivateModelRoute(m.data_use));
    // Two Workers AI rows was the entire set before 0256 (see migration 0249). If this ever falls
    // back to two, the cloud fallback for private work has silently gone away again.
    expect(priv.length).toBeGreaterThan(2);
    expect(priv.some((m) => m.provider_id === "prv_openrouter")).toBe(true);
  });

  it("refuses every training-permitting lane the moment the work is private, with a reason", async () => {
    const rungs = await ladder();
    const ctx = publicCtx({
      modelAccess: "private_model_only",
      modelAccessReason: "this content carries a name this system holds as private",
    });

    let refused = 0;
    let admitted = 0;
    for (const m of rungs) {
      const verdict = evaluateModel(m, ctx);
      if (isPrivateModelRoute(m.data_use)) {
        // A non-training lane is admitted on the privacy stage; it may still be refused later for
        // an unrelated reason, so only the privacy stage is asserted here.
        expect(verdict.stage, `${m.display_name} was refused at ${verdict.stage}`).not.toBe("privacy");
        admitted++;
      } else {
        expect(verdict.eligible, `${m.display_name} accepted private work`).toBe(false);
        expect(verdict.stage).toBe("privacy");
        // AND NO CARD LIFTS IT. What would be approved is not one call but a permanent presence in
        // somebody's corpus, so this refusal is deliberately not approvable.
        expect(verdict.approvable).toBe(false);
        expect(verdict.reason).toMatch(/training/i);
        refused++;
      }
    }

    /* RULE 0: a loop that examined nothing must not read as a pass. */
    expect(refused, "no training-permitting lane was on the ladder to refuse").toBeGreaterThan(0);
    expect(admitted, "no lane was left that could take the work").toBeGreaterThan(0);
  });

  it("lets the same lanes take the same work when it is public, so this is a line and not a block", async () => {
    const rungs = await ladder();
    const free = rungs.filter((m) => m.slug.endsWith(":free"));
    expect(free.length).toBeGreaterThan(0);
    for (const m of free) {
      // The proof that the refusal above is about the CONTENT and not about the lane being broken.
      expect(evaluateModel(m, publicCtx()).stage).not.toBe("privacy");
    }
  });
});

describe("the privacy claim is asked of the vendor, not merely written down", () => {
  const req = (slug: string) => ({
    modelSlug: slug,
    messages: [{ role: "user" as const, content: "hello" }],
    maxOutputTokens: 64,
    temperature: 0,
  });
  const ctx = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key-not-a-real-credential" };
  const ok = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: {} }), {
      status: 200, headers: { "content-type": "application/json" },
    });

  it("sends data_collection=deny for a route recorded as non-training", async () => {
    let body: any = null;
    restore = stubFetch(async (r) => { body = await r.json(); return ok(); });

    await openrouter.complete({ ...req("anthropic/claude-sonnet-5"), requireNoTraining: true }, ctx);

    // OpenRouter refuses to route this call to any endpoint that collects, and answers 404 if it
    // cannot — so the row's claim fails closed instead of leaking.
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("does not send it for a free route, which would 404 and take the $0 tier off the air", async () => {
    let body: any = null;
    restore = stubFetch(async (r) => { body = await r.json(); return ok(); });

    await openrouter.complete(req("nvidia/nemotron-3-ultra-550b-a55b:free"), ctx);

    // Not a hole: a :free lane is TRAINS_ON_PROMPTS, so policy.ts refused it any private work long
    // before an adapter ran. Asking anyway would refuse the lane for public work too.
    expect(body.provider).toBeUndefined();
  });

  it("drives the flag off the row's data_use, so no caller has to remember", async () => {
    const rows = await ladder();
    const sonnet = rows.find((m) => m.id === "mdl_or_sonnet5");
    const nemotronFree = rows.find((m) => m.id === "mdl_or_nemotron_ultra_free");
    expect(sonnet && nemotronFree).toBeTruthy();

    // This is the expression `routeCompletion` passes as `requireNoTraining`. Pinning it here is
    // what stops it being quietly re-keyed to the caller's label, where it would be true only on
    // the calls somebody marked.
    expect(isPrivateModelRoute(sonnet!.data_use)).toBe(true);
    expect(isPrivateModelRoute(nemotronFree!.data_use)).toBe(false);
  });
});

describe("the wiring and the migrations are one list, not two", () => {
  it("prices every ladder rung identically in CLOUD_BACKENDS and in the database", async () => {
    const rows = await ladder();
    const wired = new Map(
      CLOUD_BACKENDS.flatMap((b) => b.models.map((m) => [m.id, { ...m, providerId: b.providerId }])),
    );

    let compared = 0;
    for (const row of rows) {
      const w = wired.get(row.id);
      if (!w) continue;
      compared++;
      expect(row.slug, row.id).toBe(w.slug);
      expect(row.display_name, row.id).toBe(w.displayName);
      expect(row.capability_tier, row.id).toBe(w.capabilityTier);
      // The prices are what the cost cap, the lane budget and the month line all compare against;
      // two lists holding them is this repository's most-named defect.
      expect(row.in_micros_1k, row.id).toBe(w.inMicros1k);
      expect(row.out_micros_1k, row.id).toBe(w.outMicros1k);
    }
    expect(compared, "no rung matched the wiring, so nothing was actually compared").toBeGreaterThan(0);
  });

  it("keeps every lane that would not serve out of the wiring provisioning reads", async () => {
    const dead = await all<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM models WHERE provider_id = 'prv_openrouter' AND enabled = 0`,
    );
    const wired = new Set(CLOUD_BACKENDS.flatMap((b) => b.models.map((m) => m.id)));

    // 0256 probed four lanes that refused. They stay registered so the refusal is readable, and
    // out of CLOUD_BACKENDS so the next provisioning run does not re-create them as routable.
    expect(dead.length).toBeGreaterThan(0);
    for (const m of dead) expect(wired.has(m.id), `${m.display_name} would be re-provisioned`).toBe(false);
  });
});
