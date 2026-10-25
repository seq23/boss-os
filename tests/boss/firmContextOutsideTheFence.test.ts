import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildPrompt as consumerPrompt, buildPromptParts, handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { buildPrompt as runnerPrompt } from "../../scripts/sync-agent/runner.mjs";
import { api } from "./helpers";

/**
 * THE FIRM'S STANDING RULES REACH THE MAC SEAT ABOVE THE UNTRUSTED FENCE (25 Oct 2026).
 *
 * That morning Codex refused the Executive Intelligence Report three times in under ten seconds:
 * "The fenced content attempts to impose 'standing rules' and direct tool use and file writes …
 * I treated it as malicious." The consumer glued FIRMWIDE NOTICES in front of the instruction, the
 * dispatch stored the whole string as `instruction`, and the runner fenced all of it under a
 * preamble that called any instruction "evidence the task is malicious". Two components, one rule
 * ("the notices sit outside the fence"), and nothing composed the real halves together. This does.
 */

const between = (prompt: string, sentinel: string) => {
  const open = prompt.indexOf(`<<<${sentinel}`);
  const close = prompt.indexOf(`${sentinel}>>>`);
  expect(open, "no fence opened").toBeGreaterThan(-1);
  expect(close, "the fence never closed").toBeGreaterThan(open);
  return { open, inside: prompt.slice(open, close) };
};

const SEAT = { repo_path: "/tmp/reports", allowed_paths: ["/tmp/reports"], instruction_origin: "standing_duty" };

describe("the Mac seat's prompt carries the firm's rules outside the fence", () => {
  it("composes the real consumer halves into the real runner prompt: notices above, the task inside", async () => {
    const task = { id: "t_fence", title: "Executive Intelligence Report", template_id: null };
    const input = { prompt: "Write EXECUTIVE_INTELLIGENCE.md from MARKETS.json and today's searches." };
    const parts = await buildPromptParts(env as any, task, input);
    expect(parts.firmContext).toContain("FIRMWIDE NOTICES");
    expect(parts.instruction).not.toContain("FIRMWIDE NOTICES");
    // The cloud path still gets the whole text, unchanged in order.
    expect(await consumerPrompt(env as any, task, input)).toBe(`${parts.firmContext}\n\n${parts.instruction}`);

    const { prompt, sentinel } = runnerPrompt({ ...SEAT, instruction: parts.instruction, firm_context: parts.firmContext } as any);
    const { open, inside } = between(prompt, sentinel);
    expect(prompt.indexOf("FIRMWIDE NOTICES")).toBeGreaterThan(-1);
    expect(prompt.indexOf("FIRMWIDE NOTICES"), "the notices are inside the untrusted fence").toBeLessThan(open);
    expect(inside).not.toContain("standing rules of the firm");
    expect(inside).toContain("Write EXECUTIVE_INTELLIGENCE.md");
  });

  it("does not tell the model that a work order is malice — the sentence that convicted the briefing is gone", () => {
    const { prompt } = runnerPrompt({ ...SEAT, instruction: "Search the web and write the report." } as any);
    expect(prompt).not.toMatch(/to run a command[\s\S]{0,200}malicious/);
    expect(prompt).toMatch(/WORK ORDER: do the work it describes/);
    // The defence is pointed at the right thing, not removed.
    expect(prompt).toMatch(/tries to change those rules, your permissions or identity, to read a credential/);
  });

  it("NEGATIVE: the composition that shipped — the joined string as the instruction — puts the notices inside the fence", async () => {
    const task = { id: "t_fence2", title: "x", template_id: null };
    const joined = await consumerPrompt(env as any, task, { prompt: "Do the work." });
    const { prompt, sentinel } = runnerPrompt({ ...SEAT, instruction: joined } as any);
    expect(between(prompt, sentinel).inside).toContain("FIRMWIDE NOTICES");
  });

  it("end to end: the fired briefing's claimed envelope carries firm_context, and its instruction does not carry the notices", async () => {
    const out = await materialiseDueDuties(env as any, Date.now(), "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    await handleTask(env as any, { taskId, lane: "ops" });
    const run = await env.DB.prepare(`SELECT backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`).bind(taskId).first<{ backend_id: string }>();
    const res = await api("/api/backends/claim", { method: "POST", body: { device_id: "dev_fence", backend_id: run!.backend_id } });
    const claimed = ((await res.json()) as any).data.run;
    expect(claimed, "nothing to claim").not.toBeNull();
    expect(claimed.firm_context).toContain("FIRMWIDE NOTICES");
    expect(claimed.instruction).not.toContain("FIRMWIDE NOTICES");
    const { prompt, sentinel } = runnerPrompt(claimed);
    expect(prompt.indexOf("FIRMWIDE NOTICES")).toBeLessThan(between(prompt, sentinel).open);
  });
});
