import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, completionResponse, insertTask, row, stubFetch } from "./helpers";

/**
 * "IF BOTH SEATS ARE GONE THEN WE STAY CHEAPO MODE ($0) UNLESS OTHERWISE ASKED."
 *
 * The whole end of the ladder, proven end to end with the shipped consumer, the shipped guard and the
 * shipped router — nothing stubbed but the network, and the network is asserted UNTOUCHED:
 *
 *   Free only + private work + Claude Code out of usage + Codex out of usage
 *     → the task stops, in words that name the two spent seats and the lever,
 *       no request leaves the Worker, no paid model is chosen, and no free lane sees the text.
 *   The same two spent seats, public-safe work → a `:free` rung answers, at $0.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const NOW = Date.now();

async function setLever(value: string) {
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever',?,?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(value, Date.now()).run();
}
/** Both seats report "out of usage", the way a real report stamps them (routes/backends.ts). */
async function bothSeatsSpent() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = ?, exhausted_reason = 'You have hit your usage limit' WHERE id IN ('bk_claude_code','bk_codex')`)
    .bind(NOW + 3 * 3600_000).run();
}
async function seatsReset() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
  await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run();
}
function withKey() {
  const e = Object.create(env) as typeof env;
  (e as any).OPENROUTER_API_KEY = "test-key";
  (e as any).ANTHROPIC_API_KEY = "test-key";
  (e as any).OPENAI_API_KEY = "test-key";
  return e;
}

beforeEach(async () => { await seatsReset(); });
afterEach(async () => { await seatsReset(); });

describe("Free only, both seats out of usage, private work", () => {
  it("stops the executive briefing, holds at the lever, names both spent seats, and never makes a network call", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;

    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("must not be reached"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });

    expect(hosts, "a request left the Worker while both seats were spent and the lever was Free only").toEqual([]);

    const steps = await all<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step' ORDER BY ts`, taskId);
    expect(steps.map((s) => JSON.parse(s.detail).backend_id)).toEqual(["bk_claude_code", "bk_codex"]);
    for (const s of steps) expect(JSON.parse(s.detail).refused).toMatch(/out of usage/);

    const t = await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId);
    // Held, not run: a budget block is the system stopping at a gate only she can open (consumer.ts,
    // `BudgetExceeded` / `holdForApproval`). The card says why, in the lever's own words.
    expect(t.status, "the task did not stop").toBe("awaiting_approval");
    const card = await row<any>(`SELECT kind, summary FROM approvals WHERE origin_id = ? ORDER BY requested_at DESC`, taskId);
    expect(card.kind).toBe("spend");
    expect(card.summary).toMatch(/FREE_ONLY/);
    expect(await row(`SELECT 1 FROM executive_reports WHERE task_id = ?`, taskId), "a report was written by nothing").toBeNull();

    // Whatever the router was asked, it chose nothing: no paid model (lever) and no free lane (privacy).
    const dec = await all<any>(`SELECT chosen_model_id, outcome, candidates FROM routing_decisions WHERE task_id = ?`, taskId);
    for (const d of dec) {
      expect(d.chosen_model_id ?? null).toBeNull();
      for (const c of JSON.parse(d.candidates) as { model_id: string; verdict: string; reason: string }[]) {
        expect(c.verdict, `${c.model_id} was left standing`).not.toMatch(/^(chosen|allowed|ok)$/i);
      }
    }
    const spend = await row<any>(`SELECT COALESCE(SUM(cost_micros),0) AS n FROM tasks WHERE id = ?`, taskId);
    expect(spend.n).toBe(0);
  });

  it("a one-seat duty on the same day stops with the plan-spent sentence, not a silent skip", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Private analysis", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], prompt: "Summarise the LP commitment schedule." }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/out of usage/);
    expect(t.error).toMatch(/bk_claude_code/);
    expect(t.error).toMatch(/bk_codex/);
  });
});

describe("the same two spent seats, public-safe work", () => {
  it("is answered by a :free rung at $0, and the lever never had to move", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Explain a public concept", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({
        backend_ladder: ["bk_claude_code", "bk_codex"], cloud_fallback: true,
        prompt: "In two sentences, explain what a lighthouse does.",
      }),
    });
    const models: string[] = [];
    restore = stubFetch(async (req) => {
      const body = await req.clone().json().catch(() => ({} as any));
      models.push(String((body as any).model ?? ""));
      return completionResponse("A lighthouse warns ships of hazards. It also marks a safe harbour.", 20, 15);
    });
    await handleTask(withKey() as any, { taskId, lane: "ops" });

    expect(models.length, "no cloud lane answered public work").toBeGreaterThan(0);
    for (const m of models) expect(m, `a paid model answered at Free only: ${m}`).toMatch(/:free$/);
    const d = await row<any>(`SELECT chosen_model_id FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC LIMIT 1`, taskId);
    const chosen = await row<any>(`SELECT slug, in_micros_1k, out_micros_1k FROM models WHERE id = ?`, d.chosen_model_id);
    expect(chosen.slug).toMatch(/:free$/);
    expect(chosen.in_micros_1k + chosen.out_micros_1k).toBe(0);
  });
});
