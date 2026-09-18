import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { all, api, apiJson, insertApproval, insertTask, row, uid } from "./helpers";
import { executeDecision, type ApprovalRow } from "../../src/worker/boss/approvals/execute";
import { setSpendLever, spendLeverState, type SpendLeverState } from "../../src/worker/boss/router/spend";
import {
  ROUTE_ORDER,
  checkBackend,
  eligibleFor,
  getBackend,
  listBackends,
} from "../../src/worker/boss/backends/registry";
import {
  FREE_ONLY_FALLBACK,
  credentialState,
  effectiveAllowance,
  evaluateBackend,
  freeTier,
  laneAllowance,
  outcomeClass,
  windowState,
  type LaneAllowance,
  type Refusal,
  type Verdict,
} from "../../src/worker/boss/backends/guard";

/**
 * Stage 1 — the execution backend registry and its refusal layer.
 *
 * EVERY GUARD IN HERE HAS A NEGATIVE TEST, and that is the point of the file rather than a
 * courtesy. A detector that fires on everything is as useless as one that fires on nothing, so
 * each refusal is proven twice: once refusing the thing it exists to refuse, and once NOT refusing
 * the nearest legitimate request.
 *
 * The seeded rows are shared state. Every test that moves one puts it back, so a failure here
 * cannot become a mystery in somebody else's suite.
 */

/*
 * THE SHIPPED STATE THIS FILE PUTS BACK, and it is the STATE AFTER EVERY MIGRATION rather than the
 * state 0173 seeded. `restoreSeed()` runs between tests, so a stale row here does not merely make
 * one assertion wrong — it rewrites the database out from under every test that follows. When 0256
 * enabled bk_openrouter and gave it a $5 sub-cap, a map still saying `registered, 0` would have
 * quietly reverted both after the first test that touched it.
 */
const SEEDED = {
  bk_claude_code: { status: "registered", ceiling: 0 },
  // Enabled by 0256, with a figure of its own: effectiveAllowance treats a 0 ceiling as NO SUB-CAP
  // STATED, so enabling at 0 would have let it spend the whole lane budget once the lever moves.
  bk_openrouter: { status: "enabled", ceiling: 5_000_000 },
  // The second $0 subscription seat, 0256. Enabled because its executor ships with it.
  bk_codex: { status: "enabled", ceiling: 0 },
  bk_workers_ai: { status: "registered", ceiling: 0 },
  bk_fireworks: { status: "registered", ceiling: 0 },
  bk_local_runtime: { status: "disabled", ceiling: 0 },
} as const;

async function restoreSeed() {
  for (const [id, s] of Object.entries(SEEDED)) {
    await env.DB
      .prepare(
        `UPDATE execution_backends
            SET status = ?, monthly_ceiling_micros = ?, spent_micros = 0, window_started_at = NULL
          WHERE id = ?`,
      )
      .bind(s.status, s.ceiling, id)
      .run();
  }
  await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run();
  delete (env as any).OPENROUTER_API_KEY;
}

/** Enables a row directly, bypassing `setBackendStatus`, so credential rules can be tested alone. */
async function forceEnable(id: string, ceilingMicros = 0) {
  await env.DB
    .prepare(`UPDATE execution_backends SET status = 'enabled', monthly_ceiling_micros = ? WHERE id = ?`)
    .bind(ceilingMicros, id)
    .run();
  return (await getBackend(env.DB, id))!;
}

/**
 * Put a backend back to `registered`.
 *
 * NEEDED SINCE 0256, which enables three backends in the shipped state. Tests whose subject is "no
 * backend may take this" used to get that posture for free, from a registry where nothing was on.
 * Reaching it now is a deliberate setup step — which is better, because the posture is stated in the
 * test rather than inherited from a seed that can change underneath it.
 */
async function forceShut(...ids: string[]) {
  for (const id of ids) {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = ?`).bind(id).run();
  }
}

async function setLever(value: string) {
  await env.DB
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever',?,?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(value, Date.now())
    .run();
}

/**
 * A lever state built by hand, so a guard test does not need the database to say "she pulled it".
 * `spendLeverState` itself is proven separately, against real settings rows.
 */
const leverAt = (position: "FREE_ONLY" | "MODERATE" | "OPEN", allowanceMicros = 25_000_000): SpendLeverState => ({
  position,
  allowanceMicros: position === "MODERATE" ? allowanceMicros : 0,
  uncapped: position === "OPEN",
  moderateMicros: allowanceMicros,
  moderateSource: "owner_set",
  label: position,
  remedy: `Move the lever in Settings. It is at ${position}.`,
});

const lane = (over: Partial<LaneAllowance> = {}): LaneAllowance => ({
  lane: "ops",
  remaining_micros: 25_000_000,
  blocked: false,
  blocked_period: null,
  ...over,
});

const asRefusal = (v: Verdict): Refusal => {
  expect(v.refused).toBe(true);
  return v as Refusal;
};

afterEach(restoreSeed);

// ─────────────────────────────────────────────────────────────────────────────

describe("Stage 1 — the registry as seeded", () => {
  it("holds eight backends, and every enabled one has something built for it", async () => {
    const rows = await listBackends(env.DB);
    /*
     * SEVEN SINCE 0211. The two frontier providers were added for coaching alone, on her
     * instruction — "i think for coaching it is imperative that i use the best models with the best
     * thinking brains and the most integrity" — and they arrive REGISTERED, not enabled, because
     * neither key is in the vault yet. That is the rule this file has asserted from the beginning
     * and the new rows obey it: registering is not commissioning.
     */
    expect(rows.map((b) => b.id).sort()).toEqual([
      "bk_anthropic", "bk_claude_code", "bk_codex", "bk_fireworks", "bk_local_runtime",
      "bk_openai", "bk_openrouter", "bk_workers_ai",
    ]);
    for (const b of rows) {
      /*
       * $0 EXCEPT WHERE A CEILING IS THE POINT. Every backend shipped at zero, which meant "may not
       * spend" — correct while nothing was commissioned. `bk_claude_code` now carries a real $25
       * ceiling because it turned out to cost her Claude Max capacity while being reported as free,
       * and a budget of zero on the one backend that actually runs would stop everything.
       *
       * The invariant that survives is the one that mattered: no backend may spend without a
       * deliberate, reviewable number against its name.
       */
      /*
       * A REAL CEILING WHERE ZERO WOULD MEAN NEVER. Zero means free-tier-only, which for a paid
       * provider is a backend that can never run — "exists but nothing invokes it" with a budget
       * line. The two coaching backends carry $5/month each, which is a deliberate reviewable
       * number against a name, which is the invariant this loop is actually about.
       */
      /*
       * AND bk_openrouter JOINED THEM AT 0256. It is the one backend that is enabled AND metered,
       * so it is the one where a missing figure actually costs money: a 0 here is read by
       * effectiveAllowance as "no sub-cap stated" and leaves it bounded only by the lane. The rule
       * this loop enforces is therefore sharpened rather than relaxed — an ENABLED backend that can
       * be billed must carry a deliberate reviewable number against its name.
       */
      if (b.id === "bk_claude_code" || b.id === "bk_anthropic" || b.id === "bk_openai" || b.id === "bk_openrouter") {
        expect(b.monthly_ceiling_micros, b.id).toBeGreaterThan(0);
      } else expect(b.monthly_ceiling_micros, b.id).toBe(0);
      // The forbidden list is the invariant that never moves, enabled or not. No backend may commit,
      // merge, push, deploy or read a secret, and enabling one does not buy it any of those.
      expect(b.forbidden_actions).toEqual(expect.arrayContaining(["commit", "merge", "push", "deploy", "secret_read"]));
    }

    /*
     * REGISTERING IS STILL NOT COMMISSIONING, and that is what this now asserts rather than "nothing
     * is enabled". `bk_claude_code` is enabled because Stage 2 shipped — the sync agent claims runs
     * and executes them — and 0180 updated the row, which had been sitting at `registered` with the
     * reason "Awaiting Stage 2" long after Stage 2 existed. The other four have had nothing built
     * for them and must stay shut.
     */
    const enabled = rows.filter((b) => b.status === "enabled").map((b) => b.id).sort();
    expect(enabled).toEqual(["bk_claude_code", "bk_codex", "bk_openrouter"]);
    const claude = rows.find((b) => b.id === "bk_claude_code")!;
    expect(claude.status_reason).toMatch(/Stage 2 shipped/);

    /*
     * THE RULE IS UNCHANGED AND IS NOW ASSERTED DIRECTLY RATHER THAN BY COUNTING TO ONE.
     * "Registering is not commissioning" never meant "only one backend may be enabled"; it meant
     * nothing may be enabled until the thing that runs it exists. Pinning the literal list
     * `["bk_claude_code"]` encoded the count instead of the rule, so it went red for a change that
     * obeys it. Each enabled backend must now SAY what was built for it, which is stricter: the old
     * form let a fourth be enabled with an empty reason as long as the array was updated.
     */
    for (const b of rows.filter((x) => x.status === "enabled")) {
      expect(b.status_reason ?? "", `${b.id} is enabled with no reason recorded`).not.toHaveLength(0);
      expect(b.status_reason, b.id).toMatch(/Stage 2 shipped|Enabled 17 September 2026/);
    }
    // And the converse, which is the half that actually guards the money: nothing is enabled that
    // has no executor and no key.
    const shut = rows.filter((b) => b.status !== "enabled").map((b) => b.id).sort();
    expect(shut).toEqual(["bk_anthropic", "bk_fireworks", "bk_local_runtime", "bk_openai", "bk_workers_ai"]);
  });

  it("says DEFERRED for the local runtime rather than anything that reads like readiness", async () => {
    const local = (await getBackend(env.DB, "bk_local_runtime"))!;
    expect(local.status).toBe("disabled");
    expect(local.status_reason).toMatch(/DEFERRED - NO LOCAL HOST/);
    expect(local.credential_ref).toBe("local:none");
  });

  it("publishes the addendum's route order with cost last", () => {
    expect(ROUTE_ORDER.map((r) => r.criterion)).toEqual([
      "Permission and data sensitivity",
      "Required capability",
      "Availability",
      "Approved budget",
      "Cost preference",
    ]);
    expect(ROUTE_ORDER[4]!.step).toBe(5);
  });
});

// ─── Credentials ─────────────────────────────────────────────────────────────

describe("Stage 1 — a credential is a name, and its presence is not guessed at", () => {
  it("reports present, absent and unverifiable as three different things", () => {
    expect(credentialState(env as any, "FIREWORKS_API_KEY").presence).toBe("present");
    expect(credentialState(env as any, "OPENROUTER_API_KEY").presence).toBe("absent");
    // Declared in wrangler config, not attached to this Worker. Absence, recorded as absence.
    expect(credentialState(env as any, "binding:AI").presence).toBe("absent");
    expect(credentialState(env as any, "local:claude-code-session").presence).toBe("unverifiable_here");
    expect(credentialState(env as any, "local:none").presence).toBe("absent");
    expect(credentialState(env as any, null).presence).toBe("absent");
  });

  it("never puts a credential's value in what it says about it", () => {
    const state = credentialState(env as any, "FIREWORKS_API_KEY");
    expect(state.note).toContain("FIREWORKS_API_KEY");
    expect(state.note).not.toContain("test-key-not-a-real-credential");
  });

  it("refuses a backend whose credential is absent, and names which one", async () => {
    const backend = await forceEnable("bk_openrouter");
    const refusal = asRefusal(evaluateBackend(env as any, backend, "research", { laneBudget: lane() }));
    expect(refusal.code).toBe("credential_absent");
    expect(refusal.sentence).toContain("OPENROUTER_API_KEY");
  });

  it("does NOT refuse the one whose credential lives on the owner's machine", async () => {
    const backend = await forceEnable("bk_claude_code");
    const verdict = evaluateBackend(env as any, backend, "repo_work", { laneBudget: lane() });
    expect(verdict.refused).toBe(false);
  });
});

// ─── The spend lever ─────────────────────────────────────────────────────────

describe("Stage 1 — the spend lever cannot be reached by accident", () => {
  it("resolves an absent, empty, unrecognised or mis-cased position to FREE_ONLY", async () => {
    for (const raw of ["", "   ", "open", "Open", "OPEN_SESAME", "unlimited", "true", "1", "MODERATE!"]) {
      await setLever(raw);
      const state = await spendLeverState(env.DB);
      expect(state.position, `"${raw}" must not be permissive`).toBe("FREE_ONLY");
      expect(state.uncapped).toBe(false);
      expect(state.allowanceMicros).toBe(0);
    }
  });

  it("reads FREE_ONLY from a database with no lever row at all", async () => {
    expect((await spendLeverState(env.DB)).position).toBe("FREE_ONLY");
  });

  it("reaches OPEN only from an exact, deliberate OPEN", async () => {
    await setLever("OPEN");
    expect((await spendLeverState(env.DB)).uncapped).toBe(true);
  });

  it("treats a request carrying no lever at all as FREE_ONLY, never as OPEN", async () => {
    expect(FREE_ONLY_FALLBACK.position).toBe("FREE_ONLY");
    expect(FREE_ONLY_FALLBACK.uncapped).toBe(false);
    expect(FREE_ONLY_FALLBACK.allowanceMicros).toBe(0);

    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", { laneBudget: lane(), estimatedCostMicros: 1 }),
    );
    expect(refusal.code).toBe("lever_free_only");
  });

  it("refuses a misspelled position on the way in rather than resolving it silently", async () => {
    const { status, body } = await apiJson("/api/system/spend-lever", {
      method: "POST", body: { position: "open" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not a lever position/);
    expect((await spendLeverState(env.DB)).position).toBe("FREE_ONLY");
  });

  it("moves the lever, audits the move, and reports it in both spellings", async () => {
    const before = await apiJson("/api/system/spend-lever");
    expect(before.status).toBe(200);
    expect(before.body.data.position).toBe("FREE_ONLY");
    expect(before.body.data.allowance_micros).toBe(before.body.data.allowanceMicros);

    const moved = await apiJson("/api/system/spend-lever", {
      method: "POST", body: { position: "MODERATE", moderate_micros: 5_000_000 },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.position).toBe("MODERATE");
    expect(moved.body.data.moderate_micros).toBe(5_000_000);

    const rows = await all(`SELECT actor, action, detail FROM audit_log WHERE entity_type = 'spend_lever' ORDER BY ts DESC`);
    expect(rows[0].action).toBe("moved");
    expect(rows[0].actor).toBe("boss");
    const detail = JSON.parse(rows[0].detail);
    expect(detail).toMatchObject({ from: "FREE_ONLY", to: "MODERATE", moderateTo: 5_000_000 });
  });
});

// ─── The $0 posture ──────────────────────────────────────────────────────────

describe("Stage 1 — a ceiling of $0 means free tiers only", () => {
  it("is not 'nothing may ever run': a route that costs nothing runs at $0", async () => {
    const backend = await forceEnable("bk_claude_code", 0);
    const verdict = evaluateBackend(env as any, backend, "repo_work", { laneBudget: lane() });
    expect(verdict.refused).toBe(false);
    if (!verdict.refused) {
      expect(verdict.spend.kind).toBe("no_cost");
      expect(verdict.cost_basis.kind).toBe("no_vendor_call");
    }
  });

  it("is not 'unlimited': a metered route is refused at $0 and told which lever to pull", async () => {
    const backend = await forceEnable("bk_fireworks", 0);
    const refusal = asRefusal(evaluateBackend(env as any, backend, "research", { laneBudget: lane() }));
    expect(refusal.code).toBe("lever_free_only");
    expect(refusal.sentence).toMatch(/spend lever is at \$0/);
    // The remedy wording comes from the lever service, so there is one place that says how to fix it.
    expect(refusal.sentence).toMatch(/Move the lever/);
  });

  it("lets an OpenRouter :free model through at $0 and refuses the paid one beside it", async () => {
    (env as any).OPENROUTER_API_KEY = "test-key-not-a-real-credential";
    const backend = await forceEnable("bk_openrouter", 0);

    const free = evaluateBackend(env as any, backend, "research", {
      laneBudget: lane(), model: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(free.refused).toBe(false);
    if (!free.refused) expect(free.cost_basis.kind).toBe("free_model_slug");

    const paid = asRefusal(
      evaluateBackend(env as any, backend, "research", { laneBudget: lane(), model: "openai/gpt-4o" }),
    );
    expect(paid.code).toBe("lever_free_only");
  });

  it("refuses to call a route free because nobody named a model", async () => {
    (env as any).OPENROUTER_API_KEY = "test-key-not-a-real-credential";
    const backend = await forceEnable("bk_openrouter", 0);
    const unnamed = asRefusal(evaluateBackend(env as any, backend, "research", { laneBudget: lane() }));
    expect(unnamed.code).toBe("lever_free_only");
    expect(freeTier(backend, null).free).toBe(false);
    expect(freeTier(backend, null).basis).toMatch(/named none/);
  });
});

// ─── The lever's three positions ─────────────────────────────────────────────

describe("Stage 1 — MODERATE and OPEN", () => {
  it("treats a $0 backend ceiling as 'no sub-cap stated' once the lever is pulled", async () => {
    // At FREE_ONLY the distinction cannot matter: the lever's own allowance is 0.
    const backend = await forceEnable("bk_fireworks", 0);
    expect(
      asRefusal(evaluateBackend(env as any, backend, "research", {
        laneBudget: lane(), estimatedCostMicros: 1000,
      })).code,
    ).toBe("lever_free_only");

    // At MODERATE it does: a backend with no figure of its own defers to the lever, otherwise the
    // lever would do nothing until every row was edited by hand.
    const verdict = evaluateBackend(env as any, backend, "research", {
      laneBudget: lane(), lever: leverAt("MODERATE", 9_000_000), estimatedCostMicros: 1000,
    });
    expect(verdict.refused).toBe(false);
    if (!verdict.refused && verdict.spend.kind === "capped") expect(verdict.spend.bound_by).toBe("lever");
  });

  it("holds ONE backend at $0 by disabling it, which is a statement that says why", async () => {
    await forceEnable("bk_fireworks", 0);
    await env.DB
      .prepare(`UPDATE execution_backends SET status = 'disabled', status_reason = 'Too expensive for now' WHERE id = 'bk_fireworks'`)
      .run();
    const backend = (await getBackend(env.DB, "bk_fireworks"))!;
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        laneBudget: lane(), lever: leverAt("MODERATE"), estimatedCostMicros: 1000,
      }),
    );
    expect(refusal.code).toBe("backend_not_enabled");
    expect(refusal.sentence).toContain("Too expensive for now");
  });

  it("runs uncapped at OPEN, and says out loud that no ceiling was consulted", async () => {
    const backend = await forceEnable("bk_fireworks", 0);
    const verdict = evaluateBackend(env as any, backend, "research", {
      lever: leverAt("OPEN"), estimatedCostMicros: 999_000_000,
    });
    expect(verdict.refused).toBe(false);
    if (!verdict.refused) {
      expect(verdict.spend.kind).toBe("uncapped");
      expect(verdict.spend.note).toMatch(/still recorded/);
    }
  });

  it("OPEN buys money and nothing else — a forbidden action is still forbidden", async () => {
    const backend = await forceEnable("bk_claude_code", 0);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "repo_work", {
        lever: leverAt("OPEN"), actions: ["commit"], laneBudget: lane(),
      }),
    );
    expect(refusal.code).toBe("action_forbidden");
  });

  it("OPEN does not enable a disabled backend or conjure a missing credential", async () => {
    const openRouter = await forceEnable("bk_openrouter", 50_000_000);
    expect(
      asRefusal(evaluateBackend(env as any, openRouter, "research", { lever: leverAt("OPEN") })).code,
    ).toBe("credential_absent");

    const local = (await getBackend(env.DB, "bk_local_runtime"))!;
    expect(
      asRefusal(evaluateBackend(env as any, local, "research", { lever: leverAt("OPEN") })).code,
    ).toBe("backend_not_enabled");
  });
});

// ─── min(lane, backend ceiling) ──────────────────────────────────────────────

describe("Stage 1 — the lane budget is the dollar authority, the ceiling is a sub-cap", () => {
  it("computes one allowance and names which side bound it", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const window = windowState(backend, Date.now());

    const boundByLane = effectiveAllowance(backend, window, lane({ remaining_micros: 1_000_000 }), leverAt("MODERATE", 90_000_000));
    expect(boundByLane).toMatchObject({ micros: 1_000_000, bound_by: "lane" });

    const boundByCeiling = effectiveAllowance(backend, window, lane({ remaining_micros: 90_000_000 }), leverAt("MODERATE", 90_000_000));
    expect(boundByCeiling).toMatchObject({ micros: 10_000_000, bound_by: "backend_ceiling" });
  });

  it("refuses on the lane when the lane is the tighter of the two, and says so", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        lever: leverAt("MODERATE"),
        laneBudget: lane({ remaining_micros: 1_000_000 }),
        estimatedCostMicros: 2_000_000,
      }),
    );
    expect(refusal.code).toBe("budget_ceiling_breached");
    expect(refusal.detail.bound_by).toBe("lane");
    expect(refusal.sentence).toMatch(/needs \$2\.00 and only \$1\.00 is available/);
    expect(refusal.sentence).toMatch(/ops lane's remaining budget is the tightest/);
    expect(refusal.sentence).toMatch(/Raise the ops lane's budget/);
  });

  it("refuses on the ceiling when the ceiling is the tighter of the two, and says so", async () => {
    const backend = await forceEnable("bk_fireworks", 1_000_000);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        lever: leverAt("MODERATE"),
        laneBudget: lane({ remaining_micros: 90_000_000 }),
        estimatedCostMicros: 2_000_000,
      }),
    );
    expect(refusal.code).toBe("budget_ceiling_breached");
    expect(refusal.detail.bound_by).toBe("backend_ceiling");
    expect(refusal.sentence).toMatch(/Fireworks's own monthly ceiling is the tightest/);
    expect(refusal.sentence).toMatch(/Raise Fireworks's own monthly ceiling/);
  });

  it("permits the same call once it fits inside BOTH", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const verdict = evaluateBackend(env as any, backend, "research", {
      lever: leverAt("MODERATE"),
      laneBudget: lane({ remaining_micros: 5_000_000 }),
      estimatedCostMicros: 1_000_000,
    });
    expect(verdict.refused).toBe(false);
    if (!verdict.refused && verdict.spend.kind === "capped") {
      expect(verdict.spend.allowance_micros).toBe(5_000_000);
      expect(verdict.spend.bound_by).toBe("lane");
    }
  });

  it("refuses a metered call with no lane budget attached at all", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        lever: leverAt("MODERATE"), estimatedCostMicros: 1_000,
      }),
    );
    expect(refusal.code).toBe("lane_budget_absent");
  });

  it("tells an unfunded lane apart from a spent one", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const unfunded = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        lever: leverAt("MODERATE"),
        laneBudget: lane({ remaining_micros: null }),
        estimatedCostMicros: 1_000,
      }),
    );
    expect(unfunded.code).toBe("lane_budget_absent");
    expect(unfunded.sentence).toMatch(/absence of permission, not a \$0 allowance/);

    const spent = asRefusal(
      evaluateBackend(env as any, backend, "research", {
        lever: leverAt("MODERATE"),
        laneBudget: lane({ remaining_micros: 0, blocked: true, blocked_period: "day" }),
        estimatedCostMicros: 1_000,
      }),
    );
    expect(spent.code).toBe("lane_budget_exhausted");
    expect(spent.sentence).toMatch(/Free tiers are unaffected/);
  });

  it("lets a free route through a hard-stopped lane, because it spends nothing", async () => {
    const backend = await forceEnable("bk_claude_code", 0);
    const verdict = evaluateBackend(env as any, backend, "repo_work", {
      laneBudget: lane({ remaining_micros: 0, blocked: true, blocked_period: "month" }),
    });
    expect(verdict.refused).toBe(false);
  });

  it("reads the real lane budget rather than a second copy of it", async () => {
    const allowance = await laneAllowance(env.DB, "ops");
    expect(allowance.remaining_micros).not.toBeNull();
    const absent = await laneAllowance(env.DB, "no_such_lane");
    expect(absent.remaining_micros).toBeNull();
  });

  it("refuses a metered call carrying no cost estimate rather than guessing one", async () => {
    const backend = await forceEnable("bk_fireworks", 10_000_000);
    const refusal = asRefusal(
      evaluateBackend(env as any, backend, "research", { lever: leverAt("MODERATE"), laneBudget: lane() }),
    );
    expect(refusal.code).toBe("cost_estimate_absent");
    expect(refusal.sentence).toMatch(/refused rather than guessed at/);
  });

  it("refuses spend it cannot place in a window, and rolls a lapsed one to zero", async () => {
    await forceEnable("bk_fireworks", 10_000_000);
    await env.DB
      .prepare(`UPDATE execution_backends SET spent_micros = 9_000_000, window_started_at = NULL WHERE id = 'bk_fireworks'`)
      .run();
    const orphaned = (await getBackend(env.DB, "bk_fireworks"))!;
    const refusal = asRefusal(
      evaluateBackend(env as any, orphaned, "research", {
        lever: leverAt("MODERATE"), laneBudget: lane(), estimatedCostMicros: 1,
      }),
    );
    expect(refusal.code).toBe("spend_window_absent");

    // A window from a previous month has lapsed: last month's spend does not block this month.
    const lapsed = { ...orphaned, window_started_at: Date.UTC(2020, 0, 1) };
    expect(windowState(lapsed, Date.now())).toMatchObject({ spent_micros: 0, lapsed: true, unusable: false });
  });
});

// ─── Permission, sensitivity, capability ─────────────────────────────────────

describe("Stage 1 — a cheaper route never bypasses a rule above it", () => {
  it("refuses a backend that is registered rather than enabled", async () => {
    /*
     * This used to use `bk_claude_code`, which is now enabled — so it moved to one that is still
     * registered rather than being deleted. The rule it protects is unchanged and is the one that
     * caught a real dispatch this morning: a registered backend may not take work, and the refusal
     * carries the row's own reason so the sentence a person reads is the truth about that backend
     * rather than a generic denial.
     */
    const backend = (await getBackend(env.DB, "bk_fireworks"))!;
    expect(backend.status).toBe("registered");
    const refusal = asRefusal(evaluateBackend(env as any, backend, "research", { laneBudget: lane() }));
    expect(refusal.code).toBe("backend_not_enabled");
    expect(refusal.sentence).toContain(backend.status_reason);
  });

  it("refuses a task kind outside the allowed list, and takes one inside it", async () => {
    const backend = await forceEnable("bk_claude_code");
    const refusal = asRefusal(evaluateBackend(env as any, backend, "trading", { laneBudget: lane() }));
    expect(refusal.code).toBe("task_kind_not_allowed");
    expect(refusal.sentence).toContain("repo_work");
    expect(evaluateBackend(env as any, backend, "research", { laneBudget: lane() }).refused).toBe(false);
  });

  it("refuses a request that names no task kind at all", async () => {
    const backend = await forceEnable("bk_claude_code");
    for (const kind of [null, undefined, "", "   "]) {
      expect(asRefusal(evaluateBackend(env as any, backend, kind as any, { laneBudget: lane() })).code)
        .toBe("task_kind_absent");
    }
  });

  it("refuses a forbidden action and permits a benign one in the same request shape", async () => {
    const backend = await forceEnable("bk_claude_code");
    for (const action of ["commit", "merge", "push", "deploy", "secret_read"]) {
      const refusal = asRefusal(
        evaluateBackend(env as any, backend, "repo_work", { actions: [action], laneBudget: lane() }),
      );
      expect(refusal.code).toBe("action_forbidden");
      expect(refusal.sentence).toMatch(/proposal in the approval inbox/);
    }
    expect(
      evaluateBackend(env as any, backend, "repo_work", { actions: ["test_run", "read"], laneBudget: lane() }).refused,
    ).toBe(false);
  });

  it("refuses a capability the backend does not have", async () => {
    const backend = await forceEnable("bk_claude_code");
    expect(
      asRefusal(evaluateBackend(env as any, backend, "repo_work", { requires: "video_editing", laneBudget: lane() })).code,
    ).toBe("capability_missing");
    expect(
      evaluateBackend(env as any, backend, "repo_work", { requires: "agentic_coding", laneBudget: lane() }).refused,
    ).toBe(false);
  });

  it("leaves exactly one backend standing for LOCAL_ONLY processing, and it is not Claude Code", async () => {
    const claude = await forceEnable("bk_claude_code");
    const refusal = asRefusal(
      evaluateBackend(env as any, claude, "repo_work", { aiProcessing: "LOCAL_ONLY", laneBudget: lane() }),
    );
    expect(refusal.code).toBe("local_only_processing");
    expect(refusal.sentence).toMatch(/Nothing is transmitted/);

    // The local runtime clears the sovereignty gate and then fails on the honest next thing:
    // there is no host, so its credential is declared absent.
    const local = await forceEnable("bk_local_runtime");
    expect(
      asRefusal(evaluateBackend(env as any, local, "research", { aiProcessing: "LOCAL_ONLY", laneBudget: lane() })).code,
    ).toBe("credential_absent");
  });

  it("holds restricted content back from every backend that calls an external model", async () => {
    const claude = await forceEnable("bk_claude_code");
    const refusal = asRefusal(
      evaluateBackend(env as any, claude, "repo_work", { sensitivity: "restricted", laneBudget: lane() }),
    );
    expect(refusal.code).toBe("restricted_needs_routing_card");
    expect(refusal.approvable).toBe(true);

    // An approved sensitive-routing card is the only thing that changes it.
    expect(
      evaluateBackend(env as any, claude, "repo_work", {
        sensitivity: "restricted", cloudForRestrictedAllowed: true, laneBudget: lane(),
      }).refused,
    ).toBe(false);
  });

  it("refuses an unknown backend id rather than treating it as merely disabled", async () => {
    const verdict = await checkBackend(env as any, "bk_not_a_thing", "research");
    const refusal = asRefusal(verdict);
    expect(refusal.code).toBe("backend_unknown");
    expect(refusal.sentence).toMatch(/allowlist/);
  });
});

// ─── Route order ─────────────────────────────────────────────────────────────

describe("Stage 1 — eligibleFor", () => {
  it("orders the survivors by cost and lists every refusal with its reason", async () => {
    (env as any).OPENROUTER_API_KEY = "test-key-not-a-real-credential";
    await forceEnable("bk_claude_code");
    await forceEnable("bk_openrouter");
    await forceEnable("bk_fireworks");

    /*
     * THE LEVER IS SET, NOT INHERITED — a contract change from migration 0253, written down rather
     * than worked around. `settings.spend_lever` had never been seeded, so this test's posture came
     * from an ABSENCE that `spendLeverState` resolved to FREE_ONLY. 0253 seeds the live default as
     * MODERATE, because an unseeded row meant every paid backend commissioned in 0247 was
     * unreachable and nothing said so. The fail-closed CODE default is unchanged and still
     * FREE_ONLY. A test about the FREE_ONLY posture now asks for it, which is also what production
     * would take.
     */
    await setSpendLever(env.DB, { position: "FREE_ONLY" }, "test");

    const result = await eligibleFor(env as any, "research", { model: "x/y:free" });
    expect(result.task_kind_known).toBe(true);
    expect(result.lever.position).toBe("FREE_ONLY");

    /*
     * BOTH SUBSCRIPTION SEATS SORT AHEAD OF THE FREE-TIER CLOUD MODEL, and that ordering is the
     * whole of rung 0. A seat costs this system nothing at all (`no_vendor_call`, rank 0); an
     * OpenRouter `:free` slug costs nothing either but is still a vendor call (rank 2).
     *
     * STRENGTHENED RATHER THAN RENUMBERED. The old form pinned a two-element list, which happened
     * to encode "there is exactly one $0 seat" — a fact about the roster, not about the rule. What
     * is asserted now is the rule: every rank-0 seat precedes every cloud route, the ranks
     * ascend, and nothing metered appears at all.
     */
    expect(result.order.map((o) => o.backend_id)).toEqual(["bk_claude_code", "bk_codex", "bk_openrouter"]);
    expect(result.order.map((o) => o.cost_rank)).toEqual([0, 0, 2]);
    const ranks = result.order.map((o) => o.cost_rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(result.order.filter((o) => o.cost_rank === 0).length).toBe(2);

    // Fireworks is metered, so it is refused rather than quietly dropped from the list.
    const fireworks = result.refused.find((r) => r.backend_id === "bk_fireworks");
    expect(fireworks?.code).toBe("lever_free_only");
    for (const r of result.refused) expect(r.sentence.length).toBeGreaterThan(20);
  });

  it("tells 'no backend may' apart from 'no such task kind'", async () => {
    await forceEnable("bk_claude_code");
    const unknown = await eligibleFor(env as any, "underwater_basket_weaving");
    expect(unknown.task_kind_known).toBe(false);
    expect(unknown.order).toHaveLength(0);

    /*
     * THE SECOND HALF NEEDS "classify" TO REACH NOTHING, and since 0256 two more backends take it:
     * bk_codex lists classify among its allowed kinds and bk_openrouter always did. They are shut
     * here explicitly rather than the assertion being relaxed, because the distinction under test —
     * an UNKNOWN kind versus a known kind nobody may take — is unchanged and still worth pinning.
     * bk_claude_code stays enabled and is refused on its own allowed_kinds, which is the case that
     * makes `task_kind_known: true` meaningful.
     */
    await forceShut("bk_codex", "bk_openrouter");
    const known = await eligibleFor(env as any, "classify");
    expect(known.task_kind_known).toBe(true);
    expect(known.order).toHaveLength(0);
    expect(known.refused.length).toBeGreaterThan(0);
    // And the refusal is about the KIND, not about the backend being off — otherwise shutting the
    // two above would have made this pass for the wrong reason.
    expect(known.refused.some((r) => r.code === "task_kind_not_allowed")).toBe(true);
  });

  it("returns nothing permitted, and every reason, when nothing is enabled", async () => {
    // 0256 ships three backends enabled, so "nothing is enabled" is now a posture this test has to
    // create rather than inherit. Stating it here is what keeps the subject of the test honest.
    await forceShut("bk_claude_code", "bk_codex", "bk_openrouter");

    const result = await eligibleFor(env as any, "research");
    expect(result.order).toHaveLength(0);
    // EIGHT since 0256 added bk_codex: every backend in the registry is refused BY NAME, which is
    // the property under test — a backend that is off must appear as a refusal with a sentence,
    // never be silently missing from the list.
    expect(result.refused).toHaveLength(8);
    expect(new Set(result.refused.map((r) => r.code))).toEqual(new Set(["backend_not_enabled"]));
    // The count above is only meaningful if it matches the registry, so tie the two together.
    expect(result.refused).toHaveLength((await listBackends(env.DB)).length);
  });
});

// ─── The HTTP surface ────────────────────────────────────────────────────────

describe("Stage 1 — /api/backends", () => {
  it("lists the registry with readiness, the lever and the route order, and no secret", async () => {
    /*
     * THE SEEDED LIVE DEFAULT IS MODERATE (migration 0253), and this asserts it rather than
     * asserting the absence that used to stand in for it. The endpoint's job here is to REPORT the
     * position, not to have a particular one; the fail-closed resolution of an unreadable value is
     * asserted directly by "resolves an absent, empty, unrecognised or mis-cased position" above.
     */
    const res = await api("/api/backends");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("test-key-not-a-real-credential");

    const body = JSON.parse(text);
    expect(body.data.backends).toHaveLength(8);
    expect(body.data.lever.position).toBe("MODERATE");
    // Five route-order criteria, which is a different five and does not move.
    expect(body.data.route_order).toHaveLength(5);
    for (const b of body.data.backends) {
      // Every row explains itself whether it is ready or not — a blank readiness sentence is the
      // thing this asserts against, not readiness itself.
      expect(b.readiness.sentence).toBeTruthy();
      expect(b.credential.ref === null || typeof b.credential.ref === "string").toBe(true);
      /*
       * READY IS NOW THREE, and the rule is stated rather than the roster. A backend is ready when
       * it is enabled AND its credential is present; 0256 enabled bk_codex (a session on her Mac,
       * no key) and bk_openrouter (OPENROUTER_API_KEY). Listing the ready ones by name would pin
       * the roster again, so this asserts the IMPLICATION in both directions instead.
       */
      if (b.readiness.ready) expect(b.status, b.id).toBe("enabled");
      if (b.status !== "enabled") expect(b.readiness.ready, b.id).toBe(false);
    }
  });

  it("404s an id nobody registered", async () => {
    const { status } = await apiJson("/api/backends/bk_nope");
    expect(status).toBe(404);
  });

  it("shows one backend with its lane budget said in dollars", async () => {
    const { status, body } = await apiJson("/api/backends/bk_claude_code");
    expect(status).toBe(200);
    expect(body.data.backend.id).toBe("bk_claude_code");
    expect(body.data.lane_budget.remaining).toMatch(/^\$/);
  });
});

describe("Stage 1 — PATCH /api/backends/:id", () => {
  it("refuses a change with no reason, and an unknown status", async () => {
    const noReason = await apiJson("/api/backends/bk_claude_code", {
      method: "PATCH", body: { status: "enabled" },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toMatch(/needs a reason/);

    const badStatus = await apiJson("/api/backends/bk_claude_code", {
      method: "PATCH", body: { status: "on", reason: "because" },
    });
    expect(badStatus.status).toBe(400);

    const empty = await apiJson("/api/backends/bk_claude_code", { method: "PATCH", body: { reason: "because" } });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/Nothing to change/);
  });

  it("refuses to enable a backend whose credential is absent", async () => {
    /*
     * 0256 SHIPS bk_openrouter ENABLED, so reaching the case under test means putting it back —
     * and `restoreSeed()` deletes OPENROUTER_API_KEY, so from here the credential really is absent.
     * "Enabling follows the key and never precedes it" is the rule, and it is unchanged.
     */
    await forceShut("bk_openrouter");
    const { status, body } = await apiJson("/api/backends/bk_openrouter", {
      method: "PATCH", body: { status: "enabled", reason: "Trying it out" },
    });
    expect(status).toBe(409);
    expect(body.error).toContain("OPENROUTER_API_KEY");
    expect((await getBackend(env.DB, "bk_openrouter"))!.status).toBe("registered");

    /*
     * AND A SECOND BACKEND, which is the strengthening rather than a repeat. The case above now
     * depends on this test having just shut a row, so on its own it could pass against a guard that
     * only ever refuses a row it had seen change. bk_anthropic has never been touched here, so it
     * proves the guard reads the CREDENTIAL rather than the history.
     *
     * NOT bk_fireworks, which was the obvious pick and is wrong: `vitest.boss.config.ts` injects a
     * FIREWORKS_API_KEY binding, so that row is credentialled inside this suite and the PATCH
     * correctly returns 200. Writing the assertion first and discovering that is exactly what this
     * second case is for — a guard proven against one row is a guard proven once.
     */
    const anth = await apiJson("/api/backends/bk_anthropic", {
      method: "PATCH", body: { status: "enabled", reason: "Trying it out" },
    });
    expect(anth.status).toBe(409);
    expect(anth.body.error).toContain("ANTHROPIC_API_KEY");
    expect((await getBackend(env.DB, "bk_anthropic"))!.status).toBe("registered");
  });

  it("enables the one whose credential is held on the owner's machine, and audits it", async () => {
    const { status, body } = await apiJson("/api/backends/bk_claude_code", {
      method: "PATCH", body: { status: "enabled", reason: "Stage 2 runner is ready" },
    });
    expect(status).toBe(200);
    expect(body.data.backend.status).toBe("enabled");
    expect(body.data.backend.status_reason).toBe("Stage 2 runner is ready");

    const entries = await all(
      `SELECT action, detail FROM audit_log WHERE entity_type = 'execution_backend' AND entity_id = 'bk_claude_code' ORDER BY ts DESC`,
    );
    expect(entries.map((e: any) => e.action)).toContain("backend_enabled");
  });

  it("moves a ceiling on the record, and says the lane still caps it", async () => {
    const { status, body } = await apiJson("/api/backends/bk_fireworks", {
      method: "PATCH", body: { monthly_ceiling_micros: 5_000_000, reason: "Feeling rich" },
    });
    expect(status).toBe(200);
    expect(body.data.backend.monthly_ceiling_micros).toBe(5_000_000);
    expect(body.data.caps.note).toMatch(/tighter of the two/);

    const entries = await all(
      `SELECT action FROM audit_log WHERE entity_type = 'execution_backend' AND entity_id = 'bk_fireworks'`,
    );
    expect(entries.map((e: any) => e.action)).toContain("backend_ceiling_changed");
  });

  it("refuses a negative or fractional ceiling", async () => {
    for (const micros of [-1, 1.5]) {
      const { status } = await apiJson("/api/backends/bk_fireworks", {
        method: "PATCH", body: { monthly_ceiling_micros: micros, reason: "no" },
      });
      expect(status).toBe(409);
    }
    expect((await getBackend(env.DB, "bk_fireworks"))!.monthly_ceiling_micros).toBe(0);
  });
});

// ─── Refusals are recorded, and never coloured as failures ───────────────────

describe("Stage 1 — a refusal is recorded, and is not a failure", () => {
  it("writes a refused run when a backend is asked for a kind it may not take", async () => {
    await forceEnable("bk_claude_code");
    const taskId = await insertTask({ title: "Refactor the guard" });

    const { status, body } = await apiJson("/api/backends/bk_claude_code/check", {
      method: "POST", body: { task_kind: "trading", task_id: taskId },
    });
    expect(status).toBe(200);
    expect(body.data.permitted).toBe(false);
    expect(body.data.verdict.code).toBe("task_kind_not_allowed");

    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, body.data.recorded_run_id);
    expect(run.status).toBe("refused");
    expect(run.task_id).toBe(taskId);
    expect(run.cost_micros).toBe(0);
    expect(run.finished_at).not.toBeNull();
    expect(run.error).toBeNull();
    expect(JSON.parse(run.refusal_reason).code).toBe("task_kind_not_allowed");
  });

  it("records nothing when the check passes, because nothing ran", async () => {
    await forceEnable("bk_claude_code");
    const before = (await all(`SELECT id FROM backend_runs`)).length;
    const { body } = await apiJson("/api/backends/bk_claude_code/check", {
      method: "POST", body: { task_kind: "repo_work" },
    });
    expect(body.data.permitted).toBe(true);
    expect(body.data.recorded_run_id).toBeNull();
    expect((await all(`SELECT id FROM backend_runs`)).length).toBe(before);
  });

  it("keeps refusal and failure apart wherever a run is read", async () => {
    await forceEnable("bk_claude_code");
    await apiJson("/api/backends/bk_claude_code/check", { method: "POST", body: { task_kind: "trading" } });

    const list = await apiJson("/api/backends/runs?status=refused");
    expect(list.status).toBe(200);
    expect(list.body.data.runs.length).toBeGreaterThan(0);
    for (const r of list.body.data.runs) expect(r.outcome_class).toBe("refusal");

    const one = await apiJson(`/api/backends/runs/${list.body.data.runs[0].id}`);
    expect(one.body.data.run.outcome_class).toBe("refusal");
    expect(one.body.data.run.refusal_reason.code).toBeTruthy();

    expect(outcomeClass("failed")).toBe("failure");
    expect(outcomeClass("succeeded")).toBe("success");
    expect(outcomeClass("refused")).toBe("refusal");
    // An unrecognised status is never rounded up to success.
    expect(outcomeClass("who_knows")).toBe("failure");
  });

  it("404s an unknown run and refuses a check against an unknown task", async () => {
    expect((await apiJson("/api/backends/runs/brn_nope")).status).toBe(404);
    await forceEnable("bk_claude_code");
    const { status } = await apiJson("/api/backends/bk_claude_code/check", {
      method: "POST", body: { task_kind: "repo_work", task_id: "tsk_nope" },
    });
    expect(status).toBe(400);
  });
});

// ─── The approval payload kind ───────────────────────────────────────────────

async function insertRun(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? uid("brn");
  await env.DB
    .prepare(
      `INSERT INTO backend_runs (id, task_id, backend_id, requested, summary, started_at, finished_at, status, refusal_reason)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, over.task_id ?? null, over.backend_id ?? "bk_claude_code",
      over.requested ?? "Tidy the guard", over.summary ?? "Two files changed, tests pass.",
      Date.now(), over.finished_at ?? Date.now(), over.status ?? "succeeded",
      over.refusal_reason ?? null,
    )
    .run();
  return id;
}

const loadApproval = async (id: string) =>
  (await row<ApprovalRow>(`SELECT * FROM approvals WHERE id = ?`, id))!;

describe("Stage 1 — the backend_run approval kind", () => {
  it("accepts a proposal, closes its task, and applies nothing", async () => {
    const taskId = await insertTask({ title: "Tidy the guard" });
    const runId = await insertRun({ task_id: taskId });
    const aprId = await insertApproval({ kind: "backend_run", payload: { run_id: runId } });

    const result = await executeDecision(env as any, await loadApproval(aprId), "approved");
    expect(result.status).toBe("executed");
    expect(result.detail.nothing_applied).toBe(true);
    expect(result.detail.note).toMatch(/commits, merges, pushes or deploys/);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("done");
    // The run's own facts are untouched: what it did is not changed by what she decided about it.
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("succeeded");
  });

  it("cannot be used to approve a refusal", async () => {
    const runId = await insertRun({
      status: "refused",
      refusal_reason: JSON.stringify({ code: "action_forbidden", sentence: "commit is forbidden" }),
    });
    const aprId = await insertApproval({ kind: "backend_run", payload: { run_id: runId } });

    const result = await executeDecision(env as any, await loadApproval(aprId), "approved");
    expect(result.status).toBe("not_applicable");
    expect(String(result.detail.reason)).toMatch(/refused at the boundary/);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("refused");
  });

  it("cancels a run still in flight when the proposal is rejected, and leaves a finished one alone", async () => {
    const runningId = await insertRun({ status: "running", finished_at: null });
    const rejected = await executeDecision(
      env as any,
      await loadApproval(await insertApproval({ kind: "backend_run", payload: { run_id: runningId } })),
      "rejected",
      "Not what I asked for",
    );
    expect(rejected.status).toBe("executed");
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runningId)).status).toBe("cancelled");

    const doneId = await insertRun({ status: "succeeded" });
    await executeDecision(
      env as any,
      await loadApproval(await insertApproval({ kind: "backend_run", payload: { run_id: doneId } })),
      "rejected",
    );
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, doneId)).status).toBe("succeeded");
  });

  it("reports a vanished run without losing the decision", async () => {
    const aprId = await insertApproval({ kind: "backend_run", payload: { run_id: "brn_gone" } });
    const result = await executeDecision(env as any, await loadApproval(aprId), "approved");
    expect(result.status).toBe("failed");
    expect(String(result.detail.error)).toMatch(/no longer exists/);
  });

  it("expires into a rejection rather than sitting there", async () => {
    const taskId = await insertTask();
    const runId = await insertRun({ task_id: taskId, status: "running", finished_at: null });
    const aprId = await insertApproval({ kind: "backend_run", payload: { run_id: runId } });

    const result = await executeDecision(env as any, await loadApproval(aprId), "expired");
    expect(result.detail.outcome).toBe("rejected");
    expect(String(result.detail.reason)).toMatch(/expired/);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("cancelled");
  });
});

// ─── Launch → claim → report ─────────────────────────────────────────────────

import { REQUIRED_FORBIDDEN, validateEnvelope } from "../../scripts/sync-agent/runner.mjs";

const DISPATCH = {
  title: "Tidy the guard",
  prompt: "Split the refusal copy out of the guard.",
  kind: "repo_work",
  backend_id: "bk_claude_code",
  repo_path: "/Users/owner/GitHub/boss-os",
  allowed_paths: ["src/worker/boss/backends/**"],
  verification: ["npx tsc --noEmit"],
  requires: "agentic_coding",
};

async function dispatchOne(over: Record<string, unknown> = {}) {
  return apiJson("/api/backends/dispatch", { method: "POST", body: { ...DISPATCH, ...over } });
}

describe("Stage 1 — POST /candidates", () => {
  it("returns refusals as first-class results beside the permitted ones", async () => {
    await forceEnable("bk_claude_code");
    const { status, body } = await apiJson("/api/backends/candidates", {
      method: "POST", body: { title: "Tidy the guard", prompt: "…", kind: "repo_work" },
    });
    expect(status).toBe(200);

    const permitted = body.data.candidates.filter((c: any) => c.refused === false);
    const refused = body.data.candidates.filter((c: any) => c.refused === true);
    /*
     * TWO SEATS TAKE repo_work SINCE 0256, and that is the point of the second one: coding work no
     * longer has a single place to go. Both are $0 and on her own machine.
     */
    expect(permitted.map((c: any) => c.backend_id).sort()).toEqual(["bk_claude_code", "bk_codex"]);
    /*
     * AND EVERY OTHER BACKEND STILL APPEARS AS A REFUSAL WITH A SENTENCE rather than being silently
     * absent — which is the actual subject of this test. Derived from the roster instead of typed,
     * so adding a backend cannot make it pass by arithmetic.
     */
    expect(refused.length).toBe((await listBackends(env.DB)).length - permitted.length);
    expect(permitted.length + refused.length).toBe(body.data.candidates.length);

    // The client renders these verbatim and invents nothing, so they must all be present.
    for (const c of body.data.candidates) {
      expect(c.display_name).toBeTruthy();
      if (c.refused) expect(c.sentence.length).toBeGreaterThan(20);
      else expect(["no_cost", "capped", "uncapped"]).toContain(c.spend.kind);
    }
  });

  it("records an absent task kind as absent rather than guessing one", async () => {
    await forceEnable("bk_claude_code");
    const { body } = await apiJson("/api/backends/candidates", {
      method: "POST", body: { title: "Something", prompt: "…" },
    });
    expect(body.data.task_kind_known).toBe(false);
    expect(body.data.candidates.every((c: any) => c.refused)).toBe(true);
    expect(body.data.candidates.some((c: any) => c.code === "task_kind_absent")).toBe(true);
  });

  it("needs a title", async () => {
    expect((await apiJson("/api/backends/candidates", { method: "POST", body: {} })).status).toBe(400);
  });
});

describe("Stage 1 — POST /dispatch", () => {
  it("queues the work, executes nothing, and records the authorisation", async () => {
    await forceEnable("bk_claude_code");
    const { status, body } = await dispatchOne();
    expect(status).toBe(201);
    expect(body.data.run_id).toBe(body.data.id);

    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, body.data.run_id);
    expect(run.status).toBe("running");
    expect(run.finished_at).toBeNull();
    expect(run.cost_micros).toBe(0);

    const task = await row<any>(`SELECT * FROM tasks WHERE id = ?`, run.task_id);
    expect(task.status).toBe("queued");
    expect(task.envelope_id).toBeTruthy();

    const receipt = JSON.parse(run.requested).receipt;
    expect(await row<any>(`SELECT id FROM audit_log WHERE id = ?`, receipt)).toBeTruthy();
  });

  it("refuses at the boundary and records the refusal instead of queueing it", async () => {
    await forceEnable("bk_claude_code");
    const before = (await all(`SELECT id FROM tasks`)).length;
    const { status, body } = await dispatchOne({ kind: "trading" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not allowed to take trading work/);
    expect(body.hint).toMatch(/Nothing was queued/);
    expect((await all(`SELECT id FROM tasks`)).length).toBe(before);
    expect((await all(`SELECT id FROM backend_runs WHERE status = 'refused'`)).length).toBeGreaterThan(0);
  });

  it("refuses a dispatch missing its instruction, backend or title", async () => {
    await forceEnable("bk_claude_code");
    for (const missing of ["title", "prompt", "backend_id"]) {
      const body: any = { ...DISPATCH };
      delete body[missing];
      expect((await apiJson("/api/backends/dispatch", { method: "POST", body })).status).toBe(400);
    }
    expect((await dispatchOne({ backend_id: "bk_nope" })).status).toBe(404);
  });
});

describe("Stage 2 — POST /claim", () => {
  it("hands over an envelope the runner's own validator accepts", async () => {
    await forceEnable("bk_claude_code");
    const dispatched = await dispatchOne();

    const { status, body } = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: "dev_mac", backend_id: "bk_claude_code" },
    });
    expect(status).toBe(200);
    const envelope = body.data.run;
    expect(envelope.run_id).toBe(dispatched.body.data.run_id);
    expect(envelope.approved).toBe(true);
    expect(envelope.approval_receipt).toBeTruthy();

    // BOTH HALVES CHECK. This is the runner's real validator, run against the real envelope this
    // route builds — so the two sides cannot drift apart without this test failing.
    const verdict = validateEnvelope(envelope, {});
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    for (const action of REQUIRED_FORBIDDEN) expect(envelope.forbidden_actions).toContain(action);
  });

  it("is exclusive, sequentially and under a simultaneous claim", async () => {
    await forceEnable("bk_claude_code");
    await dispatchOne();

    const first = await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_a" } });
    const second = await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_b" } });
    expect(first.body.data.run).not.toBeNull();
    expect(second.body.data.run).toBeNull();

    // TWO DEVICES ARRIVING TOGETHER. The read cannot separate them — both see the same queued row —
    // so the conditional UPDATE is the only thing that does. Exactly one envelope, or one job runs
    // twice on the owner's machine.
    await dispatchOne({ title: "A second job" });
    const [a, b] = await Promise.all([
      apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_a" } }),
      apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_b" } }),
    ]);
    const handed = [a.body.data.run, b.body.data.run].filter(Boolean);
    expect(handed).toHaveLength(1);
  });

  it("hands over nothing when the backend is not enabled, and needs a device", async () => {
    await dispatchOne().catch(() => null);
    const disabled = await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_mac" } });
    expect(disabled.body.data.run).toBeNull();
    expect(disabled.body.data.reason).toMatch(/may not take work/);

    expect((await apiJson("/api/backends/claim", { method: "POST", body: {} })).status).toBe(400);
  });

  it("refuses to build an envelope for a run whose authorisation receipt has gone", async () => {
    await forceEnable("bk_claude_code");
    const dispatched = await dispatchOne();
    const runId = dispatched.body.data.run_id;
    const receipt = JSON.parse((await row<any>(`SELECT requested FROM backend_runs WHERE id = ?`, runId)).requested).receipt;
    await env.DB.prepare(`DELETE FROM audit_log WHERE id = ?`).bind(receipt).run();

    const { body } = await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_mac" } });
    expect(body.data.run).toBeNull();
    const run = await row<any>(`SELECT status, refusal_reason FROM backend_runs WHERE id = ?`, runId);
    expect(run.status).toBe("refused");
    expect(JSON.parse(run.refusal_reason).code).toBe("unapproved_envelope");
  });
});

describe("Stage 2 — POST /report", () => {
  async function claimed() {
    await forceEnable("bk_claude_code");
    const dispatched = await dispatchOne();
    await apiJson("/api/backends/claim", { method: "POST", body: { device_id: "dev_mac" } });
    return dispatched.body.data.run_id as string;
  }

  const packet = (runId: string, over: Record<string, unknown> = {}) => ({
    device_id: "dev_mac",
    evidence: {
      run_id: runId, status: "succeeded", summary: "Two files changed, tests pass.",
      files_touched: ["src/worker/boss/backends/guard.ts"],
      commands: [{ cmd: "npx tsc --noEmit", exit_code: 0 }],
      checks_run: { run: 1, passed: 1, failed: 0, detail: [] },
      remaining_risks: [], violations: [], rollback_ref: null,
      refusal_reason: null, error: null, cost_micros: 0,
      ...over,
    },
  });

  it("records a success, raises the proposal, and writes the evidence packet", async () => {
    const runId = await claimed();
    const { status, body } = await apiJson("/api/backends/report", { method: "POST", body: packet(runId) });
    expect(status).toBe(200);
    expect(body.data.outcome_class).toBe("success");
    expect(body.data.approval_id).toBeTruthy();

    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, runId);
    expect(run.status).toBe("succeeded");
    expect(run.error).toBeNull();
    expect(run.refusal_reason).toBeNull();

    const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, run.task_id);
    expect(task.status).toBe("awaiting_approval");
    const evidence = await row<any>(`SELECT * FROM evidence_packets WHERE task_id = ?`, run.task_id);
    expect(evidence.final_status).toBe("succeeded");
    expect(evidence.approval_needed).toBe(1);
  });

  it("records a failure carrying its failure, and raises nothing to approve", async () => {
    const runId = await claimed();
    const { body } = await apiJson("/api/backends/report", {
      method: "POST", body: packet(runId, { status: "failed", error: "tsc exited 2" }),
    });
    expect(body.data.outcome_class).toBe("failure");
    expect(body.data.approval_id).toBeNull();

    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, runId);
    expect(run.error).toBe("tsc exited 2");
    expect(run.refusal_reason).toBeNull();
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, run.task_id)).status).toBe("failed");
  });

  it("never records a failure as an absence when the runner named no error", async () => {
    const runId = await claimed();
    await apiJson("/api/backends/report", { method: "POST", body: packet(runId, { status: "failed", error: null }) });
    const run = await row<any>(`SELECT error FROM backend_runs WHERE id = ?`, runId);
    expect(run.error).toMatch(/named no error/);
  });

  it("keeps a refusal a refusal: refusal_reason set, error null", async () => {
    const runId = await claimed();
    const { body } = await apiJson("/api/backends/report", {
      method: "POST", body: packet(runId, { status: "refused", refusal_reason: "no_allowed_paths", error: null }),
    });
    expect(body.data.outcome_class).toBe("refusal");
    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, runId);
    expect(run.error).toBeNull();
    expect(JSON.parse(run.refusal_reason).code).toBe("no_allowed_paths");
  });

  it("records a detected forbidden action as a FAILURE, however politely it was reported", async () => {
    const runId = await claimed();
    const { body } = await apiJson("/api/backends/report", {
      method: "POST",
      body: packet(runId, {
        status: "refused",
        refusal_reason: "just declining, honestly",
        violations: [{ action: "commit", evidence: "a new HEAD appeared" }],
      }),
    });
    expect(body.data.status).toBe("failed");
    expect(body.data.outcome_class).toBe("failure");
    const run = await row<any>(`SELECT * FROM backend_runs WHERE id = ?`, runId);
    expect(run.error).toMatch(/FORBIDDEN_ACTION_DETECTED: commit/);
    expect(run.refusal_reason).toBeNull();
  });

  it("accrues spend and rolls the window, so OPEN still counts what it spends", async () => {
    const runId = await claimed();
    await apiJson("/api/backends/report", { method: "POST", body: packet(runId, { cost_micros: 1234 }) });
    const backend = await row<any>(`SELECT spent_micros, window_started_at FROM execution_backends WHERE id = 'bk_claude_code'`);
    expect(backend.spent_micros).toBe(1234);
    expect(backend.window_started_at).toBeGreaterThan(0);
  });

  it("changes nothing about the backend itself", async () => {
    const runId = await claimed();
    const before = await row<any>(`SELECT status, monthly_ceiling_micros FROM execution_backends WHERE id = 'bk_claude_code'`);
    await apiJson("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_mac",
        evidence: { ...packet(runId).evidence, status: "succeeded" },
        // Nothing in a report body can reach these, and this is the test that says so.
        monthly_ceiling_micros: 999_000_000,
        status: "disabled",
      },
    });
    const after = await row<any>(`SELECT status, monthly_ceiling_micros FROM execution_backends WHERE id = 'bk_claude_code'`);
    expect(after).toEqual(before);
  });

  it("refuses an unknown outcome, an unknown run, and a second report of the same run", async () => {
    const runId = await claimed();
    expect((await apiJson("/api/backends/report", { method: "POST", body: packet(runId, { status: "probably_fine" }) })).status).toBe(400);
    expect((await apiJson("/api/backends/report", { method: "POST", body: packet("brn_nope") })).status).toBe(404);
    expect((await apiJson("/api/backends/report", { method: "POST", body: { device_id: "dev_mac" } })).status).toBe(400);

    expect((await apiJson("/api/backends/report", { method: "POST", body: packet(runId) })).status).toBe(200);
    const second = await apiJson("/api/backends/report", { method: "POST", body: packet(runId) });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already succeeded/);
  });
});
