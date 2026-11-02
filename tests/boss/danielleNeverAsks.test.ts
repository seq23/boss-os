/**
 * WORK BOSS OS STARTED ITSELF NEVER ASKS HER (owner, 2 Nov 2026: "I'd rather Danielle have not asked
 * me anything and just fixed it all").
 *
 * Zora's register opened a dated check-in (wo_wpp_thin) as an ordinary task, so Danielle emailed her a
 * plan to approve and then "Stopped work on WPP-llm: the checks failed". Pinned here against the real
 * routes: a waiting-on action is a repair whose plan takes Danielle's own defaults with no email; red
 * checks go back to BUILD on the same PR (the rework budget); a landed repair reports one morning line
 * instead of an email. tests/danielleNeverAsks.test.ts pins the runner's side.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { MAX_REWORKS, canEnterBuild, claimablePhase } from "../../src/shared/boss/repoChange/lane.mjs";

const DEVICE = "mac-test";
const claim = (id: string) => apiJson<any>(`/api/repo-changes/${id}/claim`, { method: "POST", body: { device_id: DEVICE } });
const ASK = { question: "Count thin pages by word count or by section count?", default: "word count", why: "it is what the report already uses" };

async function openTask(input: Record<string, unknown>) {
  const res = await apiJson<any>("/api/tasks", { method: "POST", body: { title: "WPP-llm thin pages: measure today", lane: "ops", employee_id: "emp_repo", input: { prompt: "seq23/boss-os — measure the thin pages on WPP-llm and fix what is short.", ...input } } });
  expect(res.status).toBeLessThan(300);
  return row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.body.data.task.id);
}

/** Plan → build → landing on PR #7, through the real routes. */
async function toLanding(input: Record<string, unknown>) {
  const rc = await openTask(input);
  await claim(rc.id);
  const repair = rc.origin === "repair";
  await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true, ...(repair ? {} : { ask_message_id: "re_plan" }) } });
  if (!repair) await env.DB.prepare(`UPDATE repo_changes SET phase = 'build', answered_at = ?, answers_text = 'approved', answers_mode = 'approved' WHERE id = ?`).bind(Date.now(), rc.id).run();
  expect((await claim(rc.id)).status).toBe(201);
  const built = await apiJson<any>(`/api/repo-changes/${rc.id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/rc-x", pr_url: "https://github.com/seq23/boss-os/pull/7", pr_number: 7 } });
  expect(built.body.data.phase).toBe("landing");
  return rc;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM repo_changes");
});

describe("Danielle never asks her about work Boss OS started itself (2 Nov 2026)", () => {
  it("a waiting-on action is a repair: no plan email, every ask takes Danielle's default on the record, BUILD is claimable", async () => {
    const rc = await openTask({ origin: "waiting_on", waiting_on: "wo_wpp_thin" });
    expect(rc.origin).toBe("repair");
    expect(rc.repair_kind).toBe("waiting_on");
    await claim(rc.id);
    const planned = await apiJson<any>(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [ASK], publish_ready: true } });
    expect(planned.status, JSON.stringify(planned.body)).toBe(200);
    expect(planned.body.data.phase).toBe("build");
    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.ask_message_id).toBeNull();
    expect(JSON.parse(after.asks_json)).toEqual([]);
    expect(JSON.parse(after.decided_json).join("\n")).toMatch(/Count thin pages.*decided: word count/);
    expect(canEnterBuild(after).ok).toBe(true);
    expect(claimablePhase(after)).toBe("build");
  });

  it("red checks go back to BUILD on the same PR with the failing output as the brief, for hers and for a repair, until the budget", async () => {
    for (const input of [{ origin: "repair", repair_kind: "waiting_on" }, {}]) {
      const rc = await toLanding(input);
      for (let n = 1; n <= MAX_REWORKS; n++) {
        const r = await apiJson<any>(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "red", rework: true, detail: `unit: fail\nFailing output:\nexpected 3 got 2 (${n})` } });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.data).toMatchObject({ phase: "build", rework_count: n });
        const back = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
        expect(back.pr_url).toBe("https://github.com/seq23/boss-os/pull/7");
        expect(back.branch).toBe("work/rc-x");
        expect(back.rework_note).toMatch(/pull request #7 went red.*expected 3 got 2/s);
        expect(back.done_message_id).toBeNull();
        expect(claimablePhase(back)).toBe("build");
        expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, rc.task_id)).status).toBe("queued");
        await claim(rc.id);
        await apiJson(`/api/repo-changes/${rc.id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/rc-x", pr_url: "https://github.com/seq23/boss-os/pull/7", pr_number: 7 } });
      }
      const spent = await apiJson<any>(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "red", rework: true, detail: "unit: fail" } });
      expect(spent.status).toBe(409);
    }
  });

  it("a landed repair reports one morning line, no email; her own request still needs the DONE email", async () => {
    for (const [input, ok] of [[{ origin: "repair", repair_kind: "waiting_on" }, true], [{}, false]] as const) {
      const rc = await toLanding(input);
      await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "green", detail: "unit: pass" } });
      await claim(rc.id);
      const landed = await apiJson<any>(`/api/repo-changes/${rc.id}/land`, { method: "POST", body: { device_id: DEVICE, merge_sha: "abc1234def", live_proof: {}, done_line: "Danielle fixed it: the thin pages are filled." } });
      expect(landed.status, JSON.stringify(landed.body)).toBe(ok ? 200 : 400);
      if (ok) {
        const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
        expect(after.phase).toBe("done");
        expect(after.done_message_id).toBeNull();
        expect(JSON.parse((await row<any>(`SELECT output FROM tasks WHERE id = ?`, rc.task_id)).output).text).toMatch(/Morning line: Danielle fixed it/);
      }
    }
  });
});
