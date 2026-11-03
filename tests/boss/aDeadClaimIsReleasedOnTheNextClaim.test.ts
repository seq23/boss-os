import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { all, apiJson, row } from "./helpers";

/**
 * A DEAD CLAIM IS RELEASED ON THE DEVICE'S OWN NEXT CLAIM (3 Nov 2026).
 *
 * 3 November's morning briefing fired on time and the Mac restarted eleven minutes into the run.
 * The restart left the run's `backend_runs` row stamped `claimed_by = dev_mac_seq`, and nothing
 * on earth could then take it: `POST /claim` only ever offers `claimed_at IS NULL` runs, so a run
 * held by a device that no longer exists is invisible to every device, including the one that is
 * recorded as holding it. The five-minute poll answered "nothing waiting" for the rest of the
 * morning while the one thing waiting carried its own machine's name, and the hourly reaper did
 * not reach it until 08:00 — fifteen minutes after the morning email had already given up at
 * 07:45. See the plan for the full timeline and the three ruled-out causes (daylight saving, the
 * installed launchd hours, the email's own clock, a stale lock file, the 25-minute leash).
 *
 * This is the one guard where the behaviour lives. The first test asserts the DEFECT as a fact —
 * not a precondition, the thing the fix must change.
 */

const DEVICE = "dev_mac_seq";
const OTHER = "dev_other_mac";

const DISPATCH = {
  title: "Write the morning briefing",
  prompt: "Produce the executive briefing for today.",
  kind: "repo_work",
  backend_id: "bk_claude_code",
  repo_path: "/Users/owner/GitHub/boss-os",
  allowed_paths: ["src/worker/boss/duties/**"],
  verification: ["npx tsc --noEmit"],
  requires: "agentic_coding",
};

async function forceEnable(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = ?`).bind(id).run();
}

async function forceShut(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = ?`).bind(id).run();
}

afterEach(async () => {
  await forceShut("bk_claude_code");
});

/** A dispatched, then claimed, run — carrying a real receipt, exactly as production has one. */
async function claimedByDevice(deviceId: string) {
  await forceEnable("bk_claude_code");
  const dispatched = await apiJson("/api/backends/dispatch", { method: "POST", body: DISPATCH });
  const runId = dispatched.body.data.run_id as string;
  const taskId = dispatched.body.data.run.task_id as string;
  await apiJson("/api/backends/claim", { method: "POST", body: { device_id: deviceId, backend_id: "bk_claude_code" } });
  return { runId, taskId };
}

describe("a dead claim is released on the device's own next claim (3 Nov 2026)", () => {
  it("TODAY'S DEFECT: a plain claim from the very device holding the dead claim sees nothing", async () => {
    await claimedByDevice(DEVICE);

    const { body } = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: DEVICE, backend_id: "bk_claude_code" },
    });
    expect(body.data.run).toBeNull();
  });

  it("release_claims: true releases this device's own dead claim and hands it back in the SAME call", async () => {
    const { runId, taskId } = await claimedByDevice(DEVICE);
    const before = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE id = ?`, runId);

    const { status, body } = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: DEVICE, backend_id: "bk_claude_code", release_claims: true },
    });
    expect(status).toBe(200);
    expect(body.data.run?.run_id).toBe(runId);
    expect(body.data.run.approved).toBe(true);

    const after = await row<any>(`SELECT backend_id, claimed_by, claimed_at, requested FROM backend_runs WHERE id = ?`, runId);
    expect(after.claimed_by).toBe(DEVICE);
    expect(after.claimed_at).toBeGreaterThan(0);
    // The ladder it was parked on is untouched by the release — only claimed_at/claimed_by move.
    expect(after.backend_id).toBe(before.backend_id);
    expect(after.requested).toBe(before.requested);

    const events = await all<any>(`SELECT event FROM task_events WHERE task_id = ? ORDER BY ts`, taskId);
    expect(events.map((e) => e.event)).toContain("claim_released_dead");
  });

  it("the peek read (unclaimed=1&held_by) sees the device's own dead claim, every row carrying claimed_by", async () => {
    const { runId } = await claimedByDevice(DEVICE);

    const mine = await apiJson(`/api/backends/runs?status=running&unclaimed=1&held_by=${DEVICE}`);
    expect(mine.status).toBe(200);
    const ids = mine.body.data.runs.map((r: any) => r.id);
    expect(ids).toContain(runId);
    for (const r of mine.body.data.runs) {
      expect(Object.prototype.hasOwnProperty.call(r, "claimed_by")).toBe(true);
      expect(r.claimed_at === null || r.claimed_by === DEVICE).toBe(true);
    }

    // held_by is additive, not a replacement: a plain unclaimed=1 (no held_by) still excludes it —
    // the behaviour `tests/boss/aPollCanSeeWhatIsWaiting.test.ts` pins is unmoved.
    const plain = await apiJson(`/api/backends/runs?status=running&unclaimed=1`);
    expect(plain.body.data.runs.map((r: any) => r.id)).not.toContain(runId);

    // And a device that does NOT hold it never sees it as "mine" either.
    const someoneElse = await apiJson(`/api/backends/runs?status=running&unclaimed=1&held_by=${OTHER}`);
    expect(someoneElse.body.data.runs.map((r: any) => r.id)).not.toContain(runId);
  });

  it("a run claimed by ANOTHER device is never released, by either path", async () => {
    const { runId } = await claimedByDevice(OTHER);

    const { body } = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: DEVICE, backend_id: "bk_claude_code", release_claims: true },
    });
    expect(body.data.run).toBeNull();

    const run = await row<any>(`SELECT claimed_by FROM backend_runs WHERE id = ?`, runId);
    expect(run.claimed_by).toBe(OTHER);

    const peek = await apiJson(`/api/backends/runs?status=running&unclaimed=1&held_by=${DEVICE}`);
    expect(peek.body.data.runs.map((r: any) => r.id)).not.toContain(runId);

    const events = await all<any>(`SELECT event FROM task_events WHERE event = 'claim_released_dead'`);
    expect(events).toHaveLength(0);
  });
});
