import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { brokerageMove } from "../../src/worker/boss/today/pillars";
import { apiJson } from "./helpers";

/**
 * TODAY'S BROKERAGE MOVE USES HER REAL BOOK WITHOUT HER REAL BOOK BEING HERE.
 *
 * ─── The two facts that were in tension ────────────────────────────────────
 *
 * The brokerage line could not see the 2,145-row interest ledger on her Mac, so it fell through to
 * confirmed crossmatches and unsized book lots on most weekdays — while the most valuable thing the
 * system knows sat in an email. And the ledger may not be synced:
 *
 *   "Named counterparties, assets and sizes never reach the Boss OS database — not code-named,
 *    not counted."
 *
 * So Monique computes on her Mac, emails the detail from monique@sequoiataylor.com, and posts back a
 * COUNT, A KIND AND A CLOCK. `a-pointer-carries-no-names.mjs` asserts the shapes offline; this
 * asserts the BEHAVIOUR, which is the half a scan cannot reach.
 */

const MONDAY = 1;
const SATURDAY = 6;

async function clean() {
  for (const t of ["brokerage_pointers", "counterparty_crossmatches", "capital_book_line", "capital_book"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

/*
 * `/api/capital` here, `/api/boss/capital` in production: `bossMount` serves this app under the
 * `/api/boss` prefix, and the tests drive `src/worker/boss/index` directly. `capital-book.mjs`
 * already calls the prefixed form, and so does `postPointer`.
 */
const post = (body: unknown) => apiJson("/api/capital/brokerage-pointer", { method: "POST", body });

describe("a brokerage pointer carries no names", () => {
  beforeEach(clean);

  it("takes a count, a kind and a clock, and the contract points at the mail", async () => {
    const sentAt = Date.now() - 60_000;
    const { status } = await post({ kind: "cross", crossings: 3, sent_at: sentAt });
    expect(status).toBe(200);

    const move = await brokerageMove(env as any, MONDAY);
    expect(move).not.toBeNull();
    expect(move!.action).toContain("3 crossings");
    expect(move!.action).toContain("in your inbox");
  });

  /*
   * THE POINT OF THE WHOLE DESIGN. Not "the handler happens not to store it" — the row that comes
   * back out of the database is checked, character by character, for anything that looks like a
   * counterparty, an asset, a size or an address. If a future migration adds a column and a future
   * handler fills it, this fails here rather than being discovered in a breach.
   */
  it("stores nothing that could be a counterparty, an asset, a size or an address", async () => {
    await post({ kind: "cross", crossings: 2, sent_at: Date.now() });
    const rows = await env.DB.prepare(`SELECT * FROM brokerage_pointers`).all<Record<string, unknown>>();
    expect(rows.results.length).toBe(1);

    const stored = JSON.stringify(rows.results[0]);
    expect(stored).not.toContain("@");
    expect(stored).not.toContain("$");
    // Every value is a number, or one of the two words the kind enum permits.
    for (const [col, value] of Object.entries(rows.results[0]!)) {
      if (value === null) continue;
      if (typeof value === "number") continue;
      expect(["cross", "revival"], `${col} held ${String(value)}`).toContain(value);
    }
  });

  it("REFUSES a body that carries a name, rather than quietly dropping it", async () => {
    const { status, body } = await post({
      kind: "cross", crossings: 1, sent_at: Date.now(),
      top_counterparty: "Fidelity", asset: "OpenAI", size_usd: 500_000_000,
    });
    expect(status).toBe(400);
    expect(body.error).toContain("top_counterparty");
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM brokerage_pointers`).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("refuses a pointer to an empty mail — empty-handed beats noise", async () => {
    const { status } = await post({ kind: "cross", crossings: 0, sent_at: Date.now() });
    expect(status).toBe(400);
  });

  it("refuses a kind that is not one of the two", async () => {
    const { status } = await post({ kind: "summary", crossings: 1, sent_at: Date.now() });
    expect(status).toBe(400);
  });

  /*
   * ONE MORNING'S MAIL IS POINTED AT ONCE. A pointer that reappeared would send her back to a
   * message she has already worked, which is how she learns the line is decorative.
   */
  it("shows a pointer once and never again", async () => {
    await post({ kind: "revival", crossings: 4, sent_at: Date.now() });
    const first = await brokerageMove(env as any, MONDAY);
    expect(first!.action).toContain("4 conversations");
    const second = await brokerageMove(env as any, MONDAY);
    expect(second).toBeNull();
  });

  it("ignores a pointer from yesterday, so she is never sent after an old email", async () => {
    await post({ kind: "cross", crossings: 1, sent_at: Date.now() - 40 * 60 * 60 * 1000 });
    expect(await brokerageMove(env as any, MONDAY)).toBeNull();
  });

  it("says nothing on a Saturday, pointer or no pointer", async () => {
    await post({ kind: "cross", crossings: 9, sent_at: Date.now() });
    expect(await brokerageMove(env as any, SATURDAY)).toBeNull();
  });

});
