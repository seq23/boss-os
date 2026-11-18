/**
 * DROP FOR GOOD AND HER PLAIN-WORD REPLIES (owner, 18 Nov 2026). One store (`decide_dismissed`); the
 * tap acts on POST only; a reply acts on exact whole lines and never sends or approves. Invented data.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import { morningReplyFromMail } from "../../src/worker/boss/intake/morningReply";

const DAY = "2026-11-18";
const TOKEN = `drop_${"Q".repeat(24)}`;

async function tap(path: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, { method }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text() };
}
const dropped = async () => ((await apiJson<any>("/api/morning/dropped")).body.data.rows as any[]).map((r) => r.item_id).sort();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM decide_dismissed; DELETE FROM morning_drop_taps; DELETE FROM morning_digests;");
  const payload = {
    decide: [{ id: "decide-aaaaaaaa01", title: "Answer Dana Field", body: "" }, { id: "decide-bbbbbbbb02", title: "Approve the plan", body: "" }],
    still_yours: [{ id: "decide-cccccccc03", title: "Answer Rory Vale", line: "" }],
    drops: [{ token: TOKEN, item_id: "decide-aaaaaaaa01", label: "Answer Dana Field" }],
  };
  const r = await apiJson<any>("/api/morning", { method: "POST", body: { day: DAY, payload } });
  expect(r.body.data.drops).toBe(1);
});

describe("the one-tap Drop for good", () => {
  it("the GET page changes nothing; the POST drops it; the kept morning no longer shows it", async () => {
    const page = await tap(`/api/auth/tap/${TOKEN}`);
    expect(page.text).toContain("Answer Dana Field");
    expect(await dropped()).toEqual([]);
    await tap(`/api/auth/tap/${TOKEN}`, "POST");
    expect(await dropped()).toEqual(["decide-aaaaaaaa01"]);
    const kept = (await apiJson<any>(`/api/morning/${DAY}`)).body.data.payload;
    expect(kept.decide.map((d: any) => d.id)).toEqual(["decide-bbbbbbbb02"]);
  });
  it("an unknown token changes nothing", async () => {
    await tap(`/api/auth/tap/drop_${"Z".repeat(24)}`, "POST");
    expect(await dropped()).toEqual([]);
  });
});

describe("her reply to the morning email", () => {
  it("'drop 2' and 'drop Rory Vale' drop exactly those items, confirmed in one line each", async () => {
    const r = await morningReplyFromMail(env as any, { text: "drop 2\ndrop Rory Vale", refs: ["yd_20261118"], mailId: "m1" });
    expect(r!.onlyCommands).toBe(true);
    expect(r!.note.split("\n")).toHaveLength(2);
    expect(await dropped()).toEqual(["decide-bbbbbbbb02", "decide-cccccccc03"]);
  });
  it("words that are not a command are left alone: nothing is dropped, sent or approved", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM approvals").first<{ n: number }>().catch(() => ({ n: 0 }));
    expect(await morningReplyFromMail(env as any, { text: "send it\napprove 2\ndrop it", refs: ["yd_20261118"], mailId: "m2" })).toBeNull();
    expect(await dropped()).toEqual([]);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM approvals").first<{ n: number }>().catch(() => ({ n: 0 }));
    expect(after?.n).toBe(before?.n);
  });
  it("a drop outside a morning thread does nothing", async () => {
    expect(await morningReplyFromMail(env as any, { text: "drop 2", refs: [], mailId: "m3" })).toBeNull();
    expect(await dropped()).toEqual([]);
  });
});
