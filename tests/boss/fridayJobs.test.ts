import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { recordPersonReminders } from "../../src/worker/boss/lp/reminders";
import { upsertLpRows, listLpRows } from "../../src/worker/boss/lp/desk";
import { waitingOnYou } from "../../src/worker/boss/today/waiting";
import { lpDecideItems, lpNudgeItems } from "../../src/shared/boss/lp/plan.mjs";
import { sendLpNudge } from "../../src/worker/boss/lp/nudge";
import { activeLists } from "../../src/worker/boss/capital/grid";
import { pairAllowed } from "../../src/shared/boss/capital/partyLists.mjs";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM person_reminders; DELETE FROM quiet_people; DELETE FROM rainmaker_addresses; DELETE FROM lp_reply_drafts; DELETE FROM capital_matches; DELETE FROM capital_dismissed; DELETE FROM morning_digests;");
});
const now = Date.now();
async function person() {
  await upsertLpRows(env.DB, [{ address: "waiting@example.com", name: "Example Person", bucket: "call", status: "drafted", first_seen: "2026-11-01", reply_from: "owner@example.com", draft_id: "example-draft" }]);
  return (await listLpRows(env.DB))[0];
}
it("third delivered unanswered reminder makes the person quiet across Today, plans and sending", async () => {
  const row = await person();
  // The real shape: the full card on day 1, then the thin "Still yours to answer" line (your-day.mjs).
  const full = { decide: [{ id: "decide-example", key: `lp:${row.id}`, title: "Waiting", body: "A reply" }] };
  const thin = { decide: [], still_yours: [{ id: "decide-example", key: `lp:${row.id}`, title: "Waiting", line: "Still yours" }] };
  for (const [i, day] of ["2026-11-01", "2026-11-02", "2026-11-03"].entries()) {
    const payload = i === 0 ? full : thin;
    if (i === 1) {
      // Two mornings in, the person is still on her list: not quiet yet.
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM quiet_people").first("n")).toBe(0);
    }
    await apiJson("/api/morning", { method: "POST", body: { day, payload } });
    await apiJson(`/api/morning/${day}/sent`, { method: "POST" });
    // Delivery retry on the same day must not count again.
    await apiJson(`/api/morning/${day}/sent`, { method: "POST" });
  }
  expect(await env.DB.prepare("SELECT reminder_count FROM person_reminders").first("reminder_count")).toBe(3);
  expect((await apiJson<any>("/api/morning/latest")).body.data.payload.still_yours).toEqual([]);
  const quiet = (await listLpRows(env.DB))[0];
  expect(quiet.quiet).toBe(1);
  expect(lpDecideItems([quiet], now)).toEqual([]);
  expect(lpNudgeItems([{ ...quiet, status: "sent", sent_at: now - 8 * 86400000 }], now)).toEqual([]);
  expect((await waitingOnYou(env, "2026-11-04")).items.some((x) => x.key === `lp:${row.id}`)).toBe(false);
  let calls = 0;
  const result = await sendLpNudge(env, { ...quiet, quiet: false, status: "sent", sent_at: now - 8 * 86400000 }, "one_tap", now, (async () => { calls++; throw new Error("Must not send"); }) as typeof fetch);
  expect(result.ok).toBe(false);
  expect(calls).toBe(0);
});
it("owner action resets the per-person streak instead of counting acted-on reminders", async () => {
  const row = await person();
  const payload = { decide: [{ key: `lp:${row.id}` }] };
  await recordPersonReminders(env, "2026-11-01", payload, now);
  await recordPersonReminders(env, "2026-11-02", payload, now);
  await env.DB.prepare("UPDATE lp_reply_drafts SET decided_at = ? WHERE id = ?").bind(now, row.id).run();
  await recordPersonReminders(env, "2026-11-03", payload, now + 1);
  expect(await env.DB.prepare("SELECT reminder_count FROM person_reminders").first("reminder_count")).toBe(1);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM quiet_people").first("n")).toBe(0);
});
it("bulk dismiss writes the shared table for old pairs and leaves fresh pairs and new orders", async () => {
  const match = (id: string, days: number, sig = id) => ({ key: id, pair: `pair-${id}`, sig, company: "Example Company", oldest_days: days });
  await apiJson("/api/capital/matches", { method: "POST", body: { replace: true, matches: [match("old", 31), match("fresh", 30)] } });
  expect((await apiJson("/api/capital/dismiss-older", { method: "POST", body: {} })).status).toBe(400);
  const result = await apiJson<any>("/api/capital/dismiss-older", { method: "POST", body: { confirmed: true } });
  expect(result.body.data.dismissed).toBe(1);
  expect((await apiJson<any>("/api/capital/matches")).body.data.matches.map((m: any) => m.key)).toEqual(["fresh"]);
  expect(await env.DB.prepare("SELECT pair FROM capital_dismissed").first("pair")).toBe("pair-old");
  await apiJson("/api/capital/matches", { method: "POST", body: { replace: true, matches: [match("old", 31, "new-order"), match("fresh", 30)] } });
  expect((await apiJson<any>("/api/capital/matches")).body.data.matches).toHaveLength(2);
});
it("RR-list repliers on outside domains refuse a Rainmaker pair and allow an outside pair", async () => {
  await apiJson("/api/capital/rainmaker-repliers", { method: "POST", body: { rows: [{ address: "reply@example.com", name: "Example Replier" }, { address: "broker@example.com", name: "Example Broker" }] } });
  const lists = await activeLists(env);
  expect(pairAllowed({ from: "reply@example.com" }, { from: "broker@example.com" }, lists)).toBe(false);
  expect(pairAllowed({ from: "reply@example.com" }, { from: "outside@example.com" }, lists)).toBe(true);
  expect(pairAllowed({ from: "unlisted@example.com" }, { from: "broker@example.com" }, lists)).toBe(true);
});
it("Matches hides orders over 90 days without deleting the retained push", async () => {
  await apiJson("/api/capital/matches", { method: "POST", body: { replace: true, matches: [
    { key: "day90", pair: "pair90", sig: "order90", company: "Example Company", oldest_days: 90 },
    { key: "day91", pair: "pair91", sig: "order91", company: "Example Company", oldest_days: 91 },
  ] } });
  const matches = (await apiJson<any>("/api/capital/matches")).body.data.matches;
  expect(matches.map((m: any) => m.key)).toEqual(["day90"]);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM capital_matches").first("n")).toBe(2);
});
