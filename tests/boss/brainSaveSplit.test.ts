/**
 * A BRAIN SAVE NEVER SPLITS TEXT INTO CHARACTERS (4 Nov 2026, twice in production).
 * appendToSection spread its `lines`; one string became one character per line, and PUT saved it.
 * Synthetic data only.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { appendToSection, sectionBody, seedFor, BRAINS } from "../../src/shared/boss/brains/brain.mjs";

const SEED = seedFor("spry", "Spry Labs — the umbrella for every side business");

describe("appendToSection takes a string or an array of strings", () => {
  it("a single string adds exactly one line", () => {
    const out = appendToSection(SEED, "Settled decisions", "- 2026-11-04 — keep one price — simpler");
    expect(sectionBody(out, "Settled decisions")).toBe("- 2026-11-04 — keep one price — simpler");
  });
  it("an array adds each string as its own line", () => {
    const out = appendToSection(SEED, "Open questions", ["- first question", "- second question"]);
    expect(sectionBody(out, "Open questions")!.split("\n")).toEqual(["- first question", "- second question"]);
  });
  it("anything else throws a TypeError", () => {
    expect(() => appendToSection(SEED, "Open questions", 42 as any)).toThrow(TypeError);
    expect(() => appendToSection(SEED, "Open questions", [1, 2] as any)).toThrow(TypeError);
  });
});

describe("PUT /api/boss/brains/:slug refuses a save written one character per line", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM brain_revisions;");
    for (const b of BRAINS) await env.DB.prepare(`UPDATE brains SET body_md = ? WHERE slug = ?`).bind(seedFor(b.slug, b.title), b.slug).run();
  });

  it("30 single-character lines: 400, the stored brain unchanged, no revision", async () => {
    const before = (await row<any>(`SELECT body_md FROM brains WHERE slug = 'spry'`))!.body_md;
    const text = [..."Thesecharactersaresplitapart!!"].join("\n");
    const r = await apiJson<any>("/api/brains/spry", { method: "PUT", body: { section: "Company", text } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("This save would write text one character per line; nothing was saved.");
    expect((await row<any>(`SELECT body_md FROM brains WHERE slug = 'spry'`))!.body_md).toBe(before);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM brain_revisions WHERE slug = 'spry'`))!.n).toBe(0);
  });

  it("an ordinary save still goes through", async () => {
    const r = await apiJson<any>("/api/brains/spry", { method: "PUT", body: { section: "Company", text: "Spry Labs makes small useful products." } });
    expect(r.status).toBe(200);
  });
});
