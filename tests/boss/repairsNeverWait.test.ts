/**
 * REPAIRS NEVER WAIT ON THE OWNER (owner, 25 Oct 2026).
 *
 * A repo change Boss OS opened itself to repair something broken is planned, built and landed with
 * no "reply approved" step, and she gets at most one short plain report afterwards. Work she asked
 * for keeps its approval email. Both directions are pinned here against the real routes,;
 * tests/repairReport.test.ts pins the runner's source and the plain report.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { canEnterBuild, claimablePhase, planWaitsForOwner, repairOriginOf, REPAIR_KINDS } from "../../src/shared/boss/repoChange/lane.mjs";

const DEVICE = "mac-test";
const claim = (id: string) => apiJson(`/api/repo-changes/${id}/claim`, { method: "POST", body: { device_id: DEVICE } });
const PROMPT = "seq23/boss-os — an email to the owner was held by the plain-email check and not sent. Fix the sender at source.";

async function openTask(input: Record<string, unknown>) {
  const res = await apiJson<any>("/api/tasks", { method: "POST", body: { title: "Fix a held email: Plan for boss-os", lane: "ops", employee_id: "emp_repo", input: { prompt: PROMPT, ...input } } });
  expect(res.status).toBeLessThan(300);
  const taskId = res.body.data.task.id;
  const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, taskId);
  expect(rc).toBeTruthy();
  return rc;
}

const ASK = { question: "Raise the length cap or move the plan into an attachment?", options: ["attachment", "raise"], default: "attachment", why: "the cap protects her inbox" };

beforeEach(async () => {
  await env.DB.exec("DELETE FROM repo_changes");
});

describe("repairs never wait on the owner (25 Oct 2026)", () => {
  it("only a known repair kind from the API door is a repair; everything else is hers", () => {
    expect(repairOriginOf({ origin: "repair", repair_kind: "held_mail" })).toEqual({ origin: "repair", repair_kind: "held_mail" });
    expect(repairOriginOf({ origin: "repair", repair_kind: "anything" }).origin).toBe("owner");
    expect(repairOriginOf({ origin: "repair" }).origin).toBe("owner");
    expect(repairOriginOf({}).origin).toBe("owner");
    expect(REPAIR_KINDS).toEqual(expect.arrayContaining(["held_mail", "failed_task", "refused_run", "red_check", "self_repair", "rework"]));
    expect(planWaitsForOwner({ origin: "repair" })).toBe(false);
    expect(planWaitsForOwner({ origin: "owner" })).toBe(true);
    expect(planWaitsForOwner({})).toBe(true);
  });

  it("a REPAIR's plan goes straight to build: no plan email id needed, asks become decisions, BUILD is claimable", async () => {
    const rc = await openTask({ origin: "repair", repair_kind: "held_mail" });
    expect(rc.origin).toBe("repair");
    expect(rc.repair_kind).toBe("held_mail");
    expect((await claim(rc.id)).status).toBe(201);
    const planned = await apiJson<any>(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: ["keep the cap"], asks: [ASK], publish_ready: true } });
    expect(planned.status, JSON.stringify(planned.body)).toBe(200);
    expect(planned.body.data.phase).toBe("build");
    expect(planned.body.data.repair).toBe(true);
    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("build");
    expect(after.ask_message_id).toBeNull();
    expect(after.answers_mode).toBe("approved");
    expect(after.answers_text).toMatch(/^repair — /);
    expect(after.plan_approved_by).toMatch(/repairs never wait on the owner/);
    expect(JSON.parse(after.asks_json)).toEqual([]);
    expect(JSON.parse(after.decided_json).join("\n")).toMatch(/attachment/);
    expect(canEnterBuild(after).ok).toBe(true);
    expect(claimablePhase(after)).toBe("build");
  });

  it("work she ASKED for keeps the approval email: no email id is refused, and with one it waits in asking", async () => {
    const rc = await openTask({});
    expect(rc.origin).toBe("owner");
    await claim(rc.id);
    const noMail = await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [ASK], publish_ready: true } });
    expect(noMail.status).toBe(400);
    const planned = await apiJson<any>(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [ASK], publish_ready: true, ask_message_id: "re_owner" } });
    expect(planned.body.data.phase).toBe("asking");
    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.answered_at).toBeNull();
    expect(claimablePhase(after)).toBeNull();
  });

  it("an invented repair kind is her request, and waits for her", async () => {
    const rc = await openTask({ origin: "repair", repair_kind: "because_i_said_so" });
    expect(rc.origin).toBe("owner");
    await claim(rc.id);
    expect((await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true } })).status).toBe(400);
  });

  it("a plan email overtaken by events is SUPERSEDED: the row closes with its reason and no longer waits on her", async () => {
    const rc = await openTask({});
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true, ask_message_id: "re_old" } });
    expect((await apiJson(`/api/repo-changes/${rc.id}/supersede`, { method: "POST", body: {} })).status).toBe(400);
    const r = await apiJson<any>(`/api/repo-changes/${rc.id}/supersede`, { method: "POST", body: { reason: "built by hand in a pull request", pr_url: "https://github.com/seq23/boss-os/pull/1" } });
    expect(r.body.data).toEqual({ id: rc.id, phase: "done", superseded: true });
    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("done");
    expect(after.superseded_reason).toBe("built by hand in a pull request");
    expect(claimablePhase(after)).toBeNull();
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, rc.task_id)).status).toBe("done");
    const listed = await apiJson<any>("/api/repo-changes/claimable");
    expect(JSON.stringify(listed.body.data)).not.toContain(rc.id);
    expect((await apiJson(`/api/repo-changes/${rc.id}/supersede`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
  });
});
