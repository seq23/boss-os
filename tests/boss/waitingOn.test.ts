/** Zora's register and Monique's pre-seed page through the Worker (26 Oct 2026). Fake names only. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { commandFromMail } from "../../src/worker/boss/commands/run";

describe("the waiting-on register", () => {
  it("lists the seed, takes an item, and records what Zora did", async () => {
    const list = await apiJson("/api/waiting-on");
    const ids = (list.body as any).data.items.map((i: any) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["wo_wpp_thin", "wo_pnp_social", "wo_unsubscribe"]));
    const add = await apiJson("/api/waiting-on", { method: "POST", body: { what: "Check the fake thing", owner: "emp_repo", due_on: "2026-12-01", action: "check it", kind: "measurement" } });
    expect(add.status).toBe(201);
    const id = (add.body as any).data.id;
    await apiJson(`/api/waiting-on/${id}`, { method: "POST", body: { state: "actioned", task_id: "tsk_x" } });
    const row = await env.DB.prepare(`SELECT state, task_id FROM waiting_on WHERE id = ?`).bind(id).first<any>();
    expect(row).toEqual({ state: "actioned", task_id: "tsk_x" });
  });

  it("her reply to Simone adds to and ticks off her own list; an ordinary email is left alone", async () => {
    const base = { subject: "Re: Monday", mailId: "m1", sender: "owner", refs: ["yd_2026-11-02"], now: Date.now(), to: "simone@example.com" };
    const r = await commandFromMail(env as any, { ...base, text: "add to my list: call the fake printer\ndone: Instagram" });
    expect(r?.reply).toContain("Added to your list: call the fake printer.");
    expect(r?.reply).toContain("Done and off your list: Porch & Party: set up Instagram, TikTok and Buffer.");
    const open = (await env.DB.prepare(`SELECT what FROM waiting_on WHERE kind = 'her_todo' AND state = 'open'`).all<any>()).results.map((x: any) => x.what);
    expect(open).toEqual(["call the fake printer"]);
    expect(await commandFromMail(env as any, { ...base, text: "Done - I sent it this morning." })).toBeNull();
  });
});

describe("the pre-seed watch page", () => {
  it("keeps the newest week's two lists and the comparison", async () => {
    expect((await apiJson("/api/capital/preseed")).body.data.week).toBeNull();
    const body = { week: "2026-11-02", crossed: [{ company: "Fakeco", sector: "AI" }], funded: [{ company: "Otherco", sector: "Fintech", round: "pre-seed (reported)" }], compare: { alike: [], gaps: [{ sector: "Fintech", market: ["Otherco"] }] } };
    expect((await apiJson("/api/capital/preseed", { method: "POST", body })).status).toBe(201);
    const got = (await apiJson("/api/capital/preseed")).body.data;
    expect(got).toMatchObject({ week: "2026-11-02", crossed: [{ company: "Fakeco" }], funded: [{ round: "pre-seed (reported)" }] });
  });
});
