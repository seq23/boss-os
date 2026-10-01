import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson, insertTask, row } from "./helpers";
// Vite's ?raw import: the Workers test runtime has no fs.
import TODAY_SOURCE from "../../src/client/boss/pages/Today.tsx?raw";
import API_SOURCE from "../../src/client/boss/api.ts?raw";

/**
 * THE BRIEFING HAS A BUTTON (1 Oct 2026). "There is no button to retry or re-run briefing in Boss OS." The Worker route
 * (`POST /api/duties/:id/run-now`) existed and nothing on screen called it, so a failed or unresearched briefing could only be
 * redone by waiting for 06:00. The Today card now fires the Executive Intelligence Report duty through it.
 *
 * WHAT THIS PROVES: the id the button sends is a real duty, the route queues it and answers in a person's words, a second press while
 * one is queued is answered rather than doubled, and the client is wired to that id and route. WHAT IT DOES NOT PROVE: the button in
 * a browser (no e2e), or that her Mac then runs the task (that is the agent's side, proven separately).
 */
const BUTTON_ID = (TODAY_SOURCE as string).match(/BRIEFING_DUTY_ID = "([a-z_]+)"/)?.[1];

describe("the briefing's run-now button", () => {
  it("is wired: the client sends the duty id through api.runDutyNow to the run-now route", () => {
    expect(BUTTON_ID).toBe("duty_exec_intel");
    expect(TODAY_SOURCE).toContain("api.runDutyNow(BRIEFING_DUTY_ID)");
    expect(TODAY_SOURCE).toContain('data-testid="run-briefing-now"');
    expect(API_SOURCE).toMatch(/runDutyNow: \(id: string\) =>[\s\S]*`\/duties\/\$\{id\}\/run-now`/);
  });

  it("the id on the button is a real standing duty, and it is the one the Worker retries the briefing with", async () => {
    const duty = await row<any>(`SELECT id, name, suspended, executor FROM standing_duties WHERE id = ?`, BUTTON_ID);
    expect(duty?.id).toBe(BUTTON_ID);
    expect(String(duty.name)).toMatch(/executive/i);
  });

  it("the route queues the duty and says so, and a repeat press is answered in words rather than failing", async () => {
    const first = await apiJson(`/api/duties/${BUTTON_ID}/run-now`, { method: "POST", body: {} });
    expect([200, 201]).toContain(first.status);
    expect(typeof first.body.data.fired).toBe("boolean");
    if (first.body.data.fired) {
      const queued = await row<any>(`SELECT COUNT(*) AS n FROM tasks WHERE input LIKE '%"delivers":"executive_reports"%'`);
      expect(queued.n).toBeGreaterThan(0);
    } else {
      // A refusal is a real outcome and carries its sentence for the screen to show.
      expect(String(first.body.data.note ?? "")).not.toBe("");
    }
    const again = await apiJson(`/api/duties/${BUTTON_ID}/run-now`, { method: "POST", body: {} });
    expect([200, 201]).toContain(again.status);
    expect(typeof again.body.data.fired).toBe("boolean");
    if (!again.body.data.fired) expect(String(again.body.data.note ?? "")).not.toBe("");
  });

  it("a press while a run is queued or running is answered, not doubled; a finished or failed run never blocks a retry", async () => {
    const before = await row<any>(`SELECT COUNT(*) AS n FROM tasks`);
    for (const status of ["queued", "running"]) {
      const taskId = await insertTask({ status, title: "Executive Intelligence Report", input: JSON.stringify({ delivers: "executive_reports" }), intake_kind: "research" });
      await env.DB.prepare(`UPDATE standing_duties SET last_task_id = ? WHERE id = ?`).bind(taskId, BUTTON_ID).run();
      const res = await apiJson(`/api/duties/${BUTTON_ID}/run-now`, { method: "POST", body: {} });
      expect(res.status).toBe(200);
      expect(res.body.data.fired).toBe(false);
      expect(res.body.data.reason).toBe("already_in_flight");
      expect(res.body.data.task_id).toBe(taskId);
      expect(String(res.body.data.note)).toMatch(/already has a run/);
    }
    // Nothing was queued by those presses (only the two seeded tasks above exist beyond `before`).
    const after = await row<any>(`SELECT COUNT(*) AS n FROM tasks`);
    expect(after.n).toBe(before.n + 2);
    for (const status of ["failed", "done"]) {
      const taskId = await insertTask({ status, title: "Executive Intelligence Report", input: JSON.stringify({ delivers: "executive_reports" }), intake_kind: "research" });
      await env.DB.prepare(`UPDATE standing_duties SET last_task_id = ? WHERE id = ?`).bind(taskId, BUTTON_ID).run();
      const res = await apiJson(`/api/duties/${BUTTON_ID}/run-now`, { method: "POST", body: {} });
      expect(res.body.data.reason).not.toBe("already_in_flight");
    }
  });

  it("an unknown duty is a 404, not a queued task", async () => {
    const res = await apiJson(`/api/duties/no_such_duty/run-now`, { method: "POST", body: {} });
    expect(res.status).toBe(404);
  });
});
