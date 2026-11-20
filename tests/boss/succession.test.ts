/**
 * The Succession Book is private: a logged-out request never reads or writes it, and what the Mac
 * stores is what the page reads back (src/worker/boss/routes/succession.ts).
 */
import { env, createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";

const BOOK = "# Succession Book for Scooter\n\n## 0. If you read only one page\n\n- Example line\n";

describe("the Succession Book route", () => {
  it("refuses a logged-out read and write", async () => {
    await env.VAULT.put("succession/book.md", BOOK);
    const get = await worker.fetch(new Request("https://boss.test/api/succession"), env, createExecutionContext());
    expect(get.status).toBe(401);
    expect(await get.text()).not.toContain("Scooter");
    const put = await worker.fetch(new Request("https://boss.test/api/succession", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: "# Replaced\n" }) }), env, createExecutionContext());
    expect(put.status).toBe(401);
    expect(await (await env.VAULT.get("succession/book.md"))!.text()).toBe(BOOK);
  });

  it("stores the Mac's build and reads it back after unlock; refuses a body that is not the book", async () => {
    const stored = await apiJson("/api/succession", { method: "PUT", body: { markdown: BOOK, built_at: "2026-12-01T12:20:00.000Z" } });
    expect(stored.status).toBe(200);
    const read = await apiJson("/api/succession");
    expect(read.body.data.markdown).toBe(BOOK);
    expect(read.body.data.built_at).toBe("2026-12-01T12:20:00.000Z");
    expect((await apiJson("/api/succession", { method: "PUT", body: { markdown: "" } })).status).toBe(400);
    expect((await apiJson("/api/succession", { method: "PUT", body: { markdown: `# T\n${"x".repeat(900_001)}` } })).status).toBe(400);
    expect((await apiJson("/api/succession")).body.data.markdown).toBe(BOOK);
  });
});
