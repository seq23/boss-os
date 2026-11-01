import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";

/**
 * POST/GET /api/morning/sections (Mac→cloud move, 1 Nov 2026): a writer on a cloud runner and one
 * on her Mac feed the same section; "told" clears it the way the file's rename did.
 */
const BTN = [{ label: "Open", url: "https://boss.test/x" }];
const post = (body: unknown) => apiJson("/api/morning/sections", { method: "POST", body });
const read = async () => (await apiJson("/api/morning/sections")).body.data.rows as any[];

describe("the morning sections store", () => {
  beforeEach(async () => { await env.DB.prepare(`DELETE FROM morning_sections`).run(); });

  it("replace keeps the section whole; append from two jobs adds to one section", async () => {
    expect((await post({ section: "lp", job: "lp-daily", mode: "replace", body: { at: new Date().toISOString(), lines: ["a"], decide: [{ title: "Reply", buttons: BTN }] } })).status).toBe(201);
    expect((await post({ section: "notices", job: "waiting-on", mode: "append", body: { lines: ["from the cloud"] } })).status).toBe(201);
    expect((await post({ section: "notices", job: "simone-commands", mode: "append", body: { lines: ["from the Mac", "from the cloud"] } })).status).toBe(201);
    const rows = await read();
    expect(rows.map((r) => r.section)).toEqual(["lp", "notices"]);
    const notices = rows.find((r) => r.section === "notices");
    expect(notices.body.lines).toEqual(["from the cloud", "from the Mac"]);
    expect(notices.job).toBe("simone-commands");
    expect(rows.find((r) => r.section === "lp").body.decide).toHaveLength(1);
  });

  it("told sections leave the read, and the next append starts fresh", async () => {
    await post({ section: "notices", job: "waiting-on", mode: "append", body: { lines: ["told once"] } });
    expect((await apiJson("/api/morning/sections/told", { method: "POST", body: { sections: ["notices"] } })).status).toBe(200);
    expect(await read()).toEqual([]);
    await post({ section: "notices", job: "waiting-on", mode: "append", body: { lines: ["new"] } });
    expect((await read())[0].body.lines).toEqual(["new"]);
  });

  it("refuses an unknown section, a decision with no button, and a bad mode — nothing is kept", async () => {
    expect((await post({ section: "nope", job: "x", mode: "replace", body: { at: new Date().toISOString() } })).status).toBe(400);
    expect((await post({ section: "lp", job: "x", mode: "replace", body: { at: new Date().toISOString(), decide: [{ title: "t" }] } })).status).toBe(400);
    expect((await post({ section: "lp", job: "x", mode: "merge", body: {} })).status).toBe(400);
    expect(await read()).toEqual([]);
  });
});
