import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";

/**
 * A FEATURED NAME KEEPS HER CASING (24 Oct 2026). Rules key on the lower-case name, and that key was
 * what the prospect email printed: Monique proposed "openai, anduril, databricks". And one reply
 * naming three companies sets all three (only the first was applied). Synthetic names.
 */
describe("her featured names, as she wrote them", () => {
  it("a list of three sets three rules, each in her casing, and a rule stays one per company", async () => {
    await env.DB.prepare(`DELETE FROM prospect_name_rules`).run();
    const r = await apiJson("/api/lp/prospects/names", { method: "POST", body: { text: "add AlphaAI, Beta Labs and GAMMA" } });
    expect(r.status).toBe(200);
    const got = await apiJson("/api/lp/prospects/names");
    const rules = [...got.body.data.rules].sort((a: any, b: any) => a.name.localeCompare(b.name));
    expect(rules).toEqual([{ name: "AlphaAI", rule: "add" }, { name: "Beta Labs", rule: "add" }, { name: "GAMMA", rule: "add" }]);
    await apiJson("/api/lp/prospects/names", { method: "POST", body: { text: "drop alphaai" } });
    const after = (await apiJson("/api/lp/prospects/names")).body.data.rules;
    // "alphaai" is not a capitalised name, so it changes nothing.
    expect(after.filter((x: any) => x.name.toLowerCase() === "alphaai")).toEqual([{ name: "AlphaAI", rule: "add" }]);
    await apiJson("/api/lp/prospects/names", { method: "POST", body: { text: "drop AlphaAI" } });
    const dropped = (await apiJson("/api/lp/prospects/names")).body.data.rules.filter((x: any) => x.name.toLowerCase() === "alphaai");
    expect(dropped).toEqual([{ name: "AlphaAI", rule: "drop" }]);
  });
  it("rows written before the casing was kept take it from her own words (migration 0301)", async () => {
    await env.DB.prepare(`DELETE FROM prospect_name_rules`).run();
    await env.DB.prepare(`INSERT INTO prospect_name_rules (name, rule, said, created_at) VALUES ('deltaco','add','add DeltaCo please',1)`).run();
    // The backfill in migration 0301, word for word (tests/outboundWords.test.ts pins the file says it).
    await env.DB.prepare(`UPDATE prospect_name_rules SET display = substr(said, instr(lower(said), name), length(name)) WHERE display IS NULL AND said IS NOT NULL AND instr(lower(said), name) > 0`).run();
    expect((await apiJson("/api/lp/prospects/names")).body.data.rules).toEqual([{ name: "DeltaCo", rule: "add" }]);
  });
});
