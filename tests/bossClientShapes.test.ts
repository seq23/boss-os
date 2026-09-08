import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/client/boss/api";

/**
 * THE SHAPE OF A 200 IS A CONTRACT, AND NOTHING WAS CHECKING IT.
 *
 * On 8 September 2026 the owner said "the vault screen also crashes". It did — to a blank page.
 * `GET /api/boss/vault/entries` answers `{entries, total, reason?}`; the client declared it
 * `call<any[]>`; `Vault.tsx` then read `.length` (undefined, so not zero) and called `.map()` on an
 * object. React threw during render, and with no boundary the whole application unmounted. The
 * console said `TypeError: n.map is not a function`.
 *
 * `any[]` is a cast, not a check — the value arrives as `any` and TypeScript believes the
 * annotation, so no compiler and no server test could have caught this. It is a disagreement
 * between two files about one payload, which is the defect class this repository is written
 * against, and the only place it can be caught is at the seam.
 *
 * These tests drive the real `api` module with a stubbed `fetch` returning the EXACT payload
 * production returns, so they fail on the bug and pass on the fix.
 */

function stubFetch(payload: unknown, ok = true) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ ok, data: payload }), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("the Vault screen's list endpoints answer with lists", () => {
  it("unwraps the envelope /vault/entries actually returns, instead of handing a screen an object to .map()", async () => {
    // Copied from the live response, 8 Sep 2026.
    stubFetch({
      entries: [
        { id: "vlt_1", lane: "ops", key: "OPERATIONS.md", kind: "canon_doc", bytes: 11449, sha256: "7c44", note: null, created_at: 1788823633402 },
      ],
      total: 1,
    });

    const entries = await api.vaultEntries();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("OPERATIONS.md");
  });

  it("still answers a list when the vault is empty and the endpoint adds a reason beside it", async () => {
    stubFetch({ entries: [], total: 0, reason: "No canon documents are stored yet." });
    await expect(api.vaultEntries()).resolves.toEqual([]);
  });

  it("hits the /api/boss prefix, which is the only mount that is authenticated in production", async () => {
    const spy = stubFetch({ entries: [], total: 0 });
    await api.vaultEntries();
    expect(spy).toHaveBeenCalledWith("/api/boss/vault/entries", expect.anything());
  });

  /*
   * THE GENERAL GUARD, not just the one endpoint. A future route that starts wrapping its list must
   * produce a sentence the reader can act on rather than an exception inside render — because an
   * exception inside render is what took the whole product down.
   */
  it("turns a wrong shape into a readable refusal rather than a crash during render", async () => {
    stubFetch({ entries: { "0": "not a list" }, total: 1 });
    await expect(api.vaultEntries()).rejects.toBeInstanceOf(ApiError);
    await expect(api.vaultEntries()).rejects.toThrow(/did not answer with a list/);
  });
});
