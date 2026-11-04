import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { runEightraiseDaily } from "../../src/worker/boss/lp/eightraiseSection";
import { morningSectionProblems } from "../../src/shared/boss/mail/morningSections.mjs";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM morning_sections").run();
  await env.DB.prepare("DELETE FROM eightraise_ledger").run();
});
it("writes ledger totals from 05:00 Central once daily, including empty days, preserving the Mac copy", async () => {
  const now = Date.parse("2026-11-03T11:00:00Z");
  expect((await runEightraiseDaily(env, now - 1)).ran).toBe(false);
  expect(await env.DB.prepare("SELECT section FROM morning_sections").first()).toBeNull();
  await env.DB.prepare("INSERT INTO eightraise_ledger (id, month, purpose, tool, credits, at) VALUES ('test', '2026-11', 'prospecting', 'find_firms', 7, ?)").bind(now).run();
  await env.DB.prepare("INSERT INTO eightraise_ledger (id, month, purpose, tool, credits, at) VALUES ('balance', '2026-11', 'balance_read', 'get_usage', 50, ?)").bind(now).run();
  expect(await runEightraiseDaily(env, now)).toMatchObject({ ran: true, used: 7 });
  const row = await env.DB.prepare("SELECT body FROM morning_sections WHERE section = 'eightraise'").first<{ body: string }>();
  const obj = JSON.parse(row!.body);
  expect(morningSectionProblems(obj)).toEqual([]);
  expect(obj.credits).toEqual({ used: 7, budget: 75, kept: 30 });
  expect((await runEightraiseDaily(env, now + 3600000)).ran).toBe(false);
  await env.DB.prepare("UPDATE morning_sections SET job = 'lp-eightraise', body = 'mac copy'").run();
  expect((await runEightraiseDaily(env, now + 7200000)).ran).toBe(false);
  expect((await env.DB.prepare("SELECT body FROM morning_sections").first<{body: string}>())!.body).toBe('mac copy');
  expect(await runEightraiseDaily(env, Date.parse("2026-12-01T11:00:00Z"))).toMatchObject({ ran: true, used: 0 });
});
