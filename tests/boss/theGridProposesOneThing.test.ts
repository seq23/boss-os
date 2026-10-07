import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { humanTouch, herDay, SIDE_HUSTLE_KEYS } from "../../src/worker/boss/today/pillars";
import { GRID, suggestingKeys } from "../../src/shared/boss/grid.mjs";
import { apiJson, uid } from "./helpers";

/**
 * THE SIDE-HUSTLE SLOT GOES AND LOOKS, AND STILL ONLY EVER SHOWS ONE THING A DAY.
 *
 * ─── Her instructions ──────────────────────────────────────────────────────
 *
 *   "should suggest something that requires a human touch from one of the side hustles when
 *    appropriate n o more than 1 per day as appropriate"
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 *   "the agent needs to examine what is going on with those businesses and give me stuff to do"
 *
 * ─── What these assert that a scan cannot ──────────────────────────────────
 *
 * `validate:one-human-touch` and `validate:grid-examined` check the shapes. These check the
 * BEHAVIOUR, and specifically the two things that would each look fine in the source and be wrong at
 * runtime: that an item appears with NO HAND-FLAG ANYWHERE, and that the cap is a DAY rather than a
 * query — which is the half `LIMIT 1` never had.
 */

const A_PRIMARY = suggestingKeys()[0]!;
const SECONDARY = GRID.find((p) => p.tier === "secondary")!;

async function clean() {
  for (const t of ["human_touch_days", "grid_observations", "grid_examinations", "owned_deliverables", "tasks"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

function observation(over: Record<string, unknown> = {}) {
  return {
    property_key: A_PRIMARY,
    repo: "seq23/example",
    kind: "pr_stale",
    disposition: "needs_her",
    needs_her_why: "Review and approve PR #4 — you are the requested reviewer and have been for 5 days.",
    headline: "PR #4 is waiting on your review.",
    evidence: "https://github.com/seq23/example/pull/4",
    observed_at: Date.now() - 5 * 86_400_000,
    ...over,
  };
}

const file = (observations: unknown[], over: Record<string, unknown> = {}) =>
  apiJson("/api/grid/examination", {
    method: "POST",
    body: {
      started_at: Date.now(), finished_at: Date.now(),
      properties_expected: GRID.length, properties_examined: GRID.length,
      observations, ...over,
    },
  });

describe("the grid proposes one thing, and only when it needs her", () => {
  beforeEach(clean);

  it("knows the grid as data — every property carries its repos", () => {
    expect(GRID.length).toBeGreaterThan(0);
    for (const p of GRID) expect(p.repos.length).toBeGreaterThan(0);
    expect(SIDE_HUSTLE_KEYS).toEqual(suggestingKeys());
  });

  /*
   * THE DEFECT THIS WHOLE THING IS FOR. Before the examination existed the slot read a flag nobody
   * ever set, so it was silent from the day it shipped. There is no `owned_deliverables` row here
   * and no `needs_owner` anywhere: the item comes entirely from what a run went and found.
   */
  it("produces an item from real system state with NO hand-flag present", async () => {
    const { status } = await file([observation()]);
    expect(status).toBe(200);

    const touch = await humanTouch(env as any);
    expect(touch).not.toBeNull();
    expect(touch!.action).toContain("requested reviewer");
    expect(touch!.detail?.[0]).toContain("github.com");
  });

  it("caps at one per day even with three things open, and holds across reloads", async () => {
    await file([
      observation({ evidence: "https://github.com/seq23/example/pull/1", headline: "one" }),
      observation({ evidence: "https://github.com/seq23/example/pull/2", headline: "two" }),
      observation({ evidence: "https://github.com/seq23/example/pull/3", headline: "three" }),
    ]);

    const first = await humanTouch(env as any);
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i += 1) {
      const again = await humanTouch(env as any);
      expect(again!.action).toBe(first!.action);
    }

    const days = await env.DB.prepare(`SELECT COUNT(*) AS n FROM human_touch_days`).first<{ n: number }>();
    expect(days!.n).toBe(1);
    expect(
      (await env.DB.prepare(`SELECT day FROM human_touch_days`).first<{ day: string }>())!.day,
    ).toBe(herDay());
  });

  /*
   * THE FEATURE, NOT A FILTER ON IT. A red build is work and never reaches her contract. Since
   * 7 Oct 2026 it is not a task either: lane health is what the CI sweep's probe reads itself, and a
   * task for it was a copy nothing claimed — 48 of them piled up from 16 Sep.
   */
  it("records a red build for the CI sweep's probe, files NO task, and never shows it to her", async () => {
    const { status, body } = await file([
      observation({
        kind: "ci_red", disposition: "dispatch", needs_her_why: null,
        headline: "2 workflows still red.", evidence: "https://github.com/seq23/example/actions/runs/1",
      }),
    ]);
    expect(status).toBe(200);
    expect(body.data.dispatched).toBe(0);
    expect(body.data.handoff).toEqual([]);
    expect(await humanTouch(env as any)).toBeNull();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>())!.n).toBe(0);
    const obs = await env.DB.prepare(`SELECT state, task_id FROM grid_observations`).first<{ state: string; task_id: string | null }>();
    expect(obs).toEqual({ state: "open", task_id: null });
  });

  const stale = (repo: string, n: number) =>
    observation({
      repo, kind: "pr_stale", disposition: "dispatch", needs_her_why: null,
      headline: `PR #${n} has been open 5 days in ${repo}.`, evidence: `https://github.com/${repo}/pull/${n}`,
    });

  it("files ONE task per repo for stale PRs, claimed by the CI sweep through the handoff", async () => {
    const { status, body } = await file([stale("seq23/alpha", 1), stale("seq23/alpha", 2), stale("seq23/beta", 7)]);
    expect(status).toBe(200);
    expect(body.data.dispatched).toBe(2);

    const tasks = await env.DB
      .prepare(`SELECT id, employee_id, input, status FROM tasks ORDER BY json_extract(input, '$.grid_fix.repo')`)
      .all<{ id: string; employee_id: string; input: string; status: string }>();
    expect(tasks.results.length).toBe(2);
    for (const t of tasks.results) {
      expect(t.employee_id).toBe("emp_repo");
      expect(t.status).toBe("queued");
      // Kept off the model drain by `grid_fix`, and claimed by the sweep instead.
      expect(JSON.parse(t.input).executor).toBe("ci-sweep");
    }
    const alpha = tasks.results[0]!.id;
    expect(JSON.parse(tasks.results[0]!.input).grid_fix.repo).toBe("seq23/alpha");

    const handoff = body.data.handoff as Array<{ task_id: string; repo: string; kind: string; evidence: string }>;
    expect(handoff.map((h) => [h.repo, h.evidence, h.task_id === alpha])).toEqual([
      ["seq23/alpha", "https://github.com/seq23/alpha/pull/1", true],
      ["seq23/alpha", "https://github.com/seq23/alpha/pull/2", true],
      ["seq23/beta", "https://github.com/seq23/beta/pull/7", false],
    ]);

    // The next day the same PRs are still open: touched, not duplicated.
    const again = await file([stale("seq23/alpha", 1), stale("seq23/alpha", 2), stale("seq23/beta", 7)]);
    expect(again.body.data.dispatched).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks`).first<{ n: number }>())!.n).toBe(2);
  });

  it("closes a grid task when its condition clears, with the examination as evidence", async () => {
    await file([stale("seq23/alpha", 1), stale("seq23/alpha", 2)]);
    const task = await env.DB.prepare(`SELECT id FROM tasks`).first<{ id: string }>();

    // One of the two PRs landed: the task stays, the handoff shrinks.
    const one = await file([stale("seq23/alpha", 2)]);
    expect(one.body.data.closed).toBe(0);
    expect(one.body.data.handoff.map((h: { evidence: string }) => h.evidence)).toEqual(["https://github.com/seq23/alpha/pull/2"]);

    // Both gone: closed as done (not cancelled), the evidence on the row and in its events.
    const none = await file([]);
    expect(none.body.data.closed).toBe(1);
    expect(none.body.data.handoff).toEqual([]);
    const row = await env.DB.prepare(`SELECT status, output FROM tasks WHERE id = ?`).bind(task!.id).first<{ status: string; output: string }>();
    expect(row!.status).toBe("done");
    expect(JSON.parse(row!.output).grid_cleared).toMatch(/^cleared: examination gex/);
    const ev = await env.DB.prepare(`SELECT event FROM task_events WHERE task_id = ?`).bind(task!.id).first<{ event: string }>();
    expect(ev!.event).toBe("grid_cleared");
  });

  it("a partial run closes nothing — not found is not the same as not looked for", async () => {
    await file([stale("seq23/alpha", 1)]);
    const partial = await file([], { properties_examined: GRID.length - 1 });
    expect(partial.body.data.closed).toBe(0);
    expect((await env.DB.prepare(`SELECT status FROM tasks`).first<{ status: string }>())!.status).toBe("queued");
  });

  it("closes a grid task by hand only with evidence", async () => {
    await file([stale("seq23/alpha", 1)]);
    const task = await env.DB.prepare(`SELECT id FROM tasks`).first<{ id: string }>();
    const bare = await apiJson(`/api/grid/tasks/${task!.id}/cleared`, { method: "POST", body: { evidence: "fine now" } });
    expect(bare.status).toBe(400);
    const good = await apiJson(`/api/grid/tasks/${task!.id}/cleared`, { method: "POST", body: { evidence: "PR #1 merged 2026-10-07" } });
    expect(good.status).toBe(200);
    const row = await env.DB.prepare(`SELECT status, output FROM tasks WHERE id = ?`).bind(task!.id).first<{ status: string; output: string }>();
    expect(row).toEqual({ status: "done", output: JSON.stringify({ grid_cleared: "PR #1 merged 2026-10-07" }) });
    const twice = await apiJson(`/api/grid/tasks/${task!.id}/cleared`, { method: "POST", body: { evidence: "PR #1 merged 2026-10-07" } });
    expect(twice.status).toBe(400);
    const obs = await env.DB.prepare(`SELECT task_id, state FROM grid_observations`).first<{ task_id: string | null; state: string }>();
    expect(obs).toEqual({ task_id: null, state: "open" });
  });

  it("refuses a needs_her observation that cannot say what only she can do", async () => {
    const { status, body } = await file([observation({ needs_her_why: "  " })]);
    expect(status).toBe(400);
    expect(body.error).toContain("only she can do");
  });

  /*
   * "we really just include it in case something needs to be fixed but the content generator and all
   * the real work is in velocity." The generator is watched and fixed; it does not ask for her.
   */
  it("refuses a needs_her observation from the secondary property", async () => {
    const { status, body } = await file([observation({ property_key: SECONDARY.key })]);
    expect(status).toBe(400);
    expect(body.error).toContain(SECONDARY.key);
  });

  it("refuses a property key the grid does not declare", async () => {
    const { status } = await file([observation({ property_key: "west_peek_network_os" })]);
    expect(status).toBe(400);
  });

  /*
   * RULE 0, AT THE DOOR. Examining nothing and finding nothing render identically on her screen and
   * are opposite facts, so a run claiming it expected zero properties is refused outright.
   */
  it("refuses an examination that expected zero properties", async () => {
    const { status } = await file([], { properties_expected: 0, properties_examined: 0 });
    expect(status).toBe(400);
  });

  it("records a run that reached nothing as failed, not as a quiet day", async () => {
    await file([], { properties_examined: 0 });
    const row = await env.DB.prepare(`SELECT outcome FROM grid_examinations`).first<{ outcome: string }>();
    expect(row!.outcome).toBe("failed");
  });

  it("does not file the same pull request twice, and keeps the age of the original", async () => {
    const observedAt = Date.now() - 9 * 86_400_000;
    await file([observation({ observed_at: observedAt })]);
    await file([observation({ observed_at: Date.now() })]);

    const rows = await env.DB.prepare(`SELECT observed_at FROM grid_observations`).all<{ observed_at: number }>();
    expect(rows.results.length).toBe(1);
    // The age of the problem is the reason to report it. A daily job that refreshed it would make a
    // nine-day-old block permanently one day old.
    expect(rows.results[0]!.observed_at).toBe(observedAt);
  });

  it("resolves what a complete run no longer finds, and never on a partial one", async () => {
    await file([observation()]);
    await file([], { properties_examined: GRID.length - 1 });
    expect(
      (await env.DB.prepare(`SELECT state FROM grid_observations`).first<{ state: string }>())!.state,
    ).not.toBe("resolved");

    await file([]);
    expect(
      (await env.DB.prepare(`SELECT state FROM grid_observations`).first<{ state: string }>())!.state,
    ).toBe("resolved");
  });

  /*
   * DECLARED STILL OUTRANKS EXAMINED. 0233's flag is supported, unchanged; inference was added
   * beside it, never in place of it.
   */
  it("prefers a flag she set by hand over anything the examination found", async () => {
    await file([observation()]);
    const id = uid("odl");
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO owned_deliverables
           (id, name, employee_id, lane, terminal_condition, terminal_check, state, escalation_path,
            project_key, needs_owner, needs_owner_why, created_at, updated_at)
         VALUES (?,?,?,'ops',?,'kdp_all_live','blocked','Today',?,1,?,?,?)`,
      )
      .bind(id, "The thing she flagged", "emp_repo", "Done when she says so", A_PRIMARY,
        "Sign the contract — it is your signature or nobody's.", now, now)
      .run();

    const touch = await humanTouch(env as any);
    expect(touch!.action).toContain("your signature");

    const chosen = await env.DB.prepare(`SELECT source FROM human_touch_days`).first<{ source: string }>();
    expect(chosen!.source).toBe("declared");
  });

  it("says nothing at all when nothing needs her, which is most days", async () => {
    await file([]);
    expect(await humanTouch(env as any)).toBeNull();
    const days = await env.DB.prepare(`SELECT COUNT(*) AS n FROM human_touch_days`).first<{ n: number }>();
    // AND CLAIMS NO DAY. A silent day that burned its own slot would make tomorrow silent too.
    expect(days!.n).toBe(0);
  });
});
