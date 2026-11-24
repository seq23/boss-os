import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A TITLE ALREADY LIVE IS NEVER PUT UP AGAIN, AND NEVER COSTS HER A SIGN-IN (23-24 Nov 2026).
 *
 * "How to Get a Job in Tech" went Live on 23 Nov 2026 (Amazon's email, 09:02 CT). The register still
 * said APPROVED_QUEUED, so Simone's publish run kept opening the KDP window to put it up, found the
 * session signed out, and emailed her to sign in (22 Nov 23:32 and 23 Nov 22:48 CT). The real run is
 * driven here against a fake Boss OS, with the book's draft on disk and the gate passing, so the only
 * thing between it and the browser is the register: it must close the approval as LIVE and open nothing.
 */
const opened: string[] = [];
vi.mock("../scripts/ops/browser.mjs", () => ({
  profilePath: () => join(tmpdir(), "kdp-profile-never-used"),
  openProfile: async (p: string) => { opened.push(p); throw new Error("the browser was opened"); },
}));
vi.mock("../scripts/ops/kdp-books/quality-gate.mjs", () => ({ gateFolder: () => ({ pass: true, findings: [] }) }));

const register = JSON.parse(readFileSync("scripts/ops/kdp-register.json", "utf8"));
const row = (slug: string) => register.titles.find((t: { slug?: string }) => t.slug === slug);

async function publishRun(approved: { id: string; title: string }[], attemptStatus = 201) {
  const books = mkdtempSync(join(tmpdir(), "kdp-books-"));
  for (const slug of ["ambitious-grads-silicon-valley", "ambitious-grads-wall-street"]) {
    mkdirSync(join(books, slug));
    writeFileSync(join(books, slug, "book.epub"), "epub");
    writeFileSync(join(books, slug, "listing.json"), JSON.stringify({ title: row(slug).title, subtitle: row(slug).subtitle, price_usd: 2.99 }));
  }
  Object.assign(process.env, { KDP_BOOKS_DIR: books, BOSS_PASSCODE: "test-passcode", BOSS_OS_ORIGIN: "https://boss.invalid" });
  const attempts: { id: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.endsWith("/api/boss/auth/unlock")) return new Response("{}", { status: 200, headers: { "set-cookie": "boss=t; Path=/" } });
    if (u.endsWith("/api/boss/kdp/new-titles")) return Response.json({ data: { approved } });
    const m = /\/kdp\/new-titles\/([^/]+)\/attempt$/.exec(u);
    if (m && init?.method === "POST") { attempts.push({ id: m[1]!, body: JSON.parse(init.body ?? "{}") }); return Response.json({ ok: attemptStatus < 300 }, { status: attemptStatus }); }
    return Response.json({ ok: true });
  });
  vi.resetModules();
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(String(m)); });
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  // @ts-expect-error — plain .mjs ops script, no types
  const { run } = await import("../scripts/ops/kdp-new-title.mjs");
  const code = await run().catch((e: Error) => `threw: ${e.message}`);
  spy.mockRestore(); err.mockRestore();
  return { code, attempts, logs };
}

afterEach(() => { vi.unstubAllGlobals(); opened.length = 0; for (const k of ["KDP_BOOKS_DIR", "BOSS_PASSCODE", "BOSS_OS_ORIGIN"]) delete process.env[k]; });

describe("the publish run settles a Live title without opening KDP", () => {
  it("the register holds both Ambitious Grads books as LIVE, with the day each went live", () => {
    expect(row("ambitious-grads-silicon-valley")).toMatchObject({ title: "How to Get a Job in Tech", status: "LIVE", status_as_of: "2026-11-23" });
    expect(row("ambitious-grads-wall-street")).toMatchObject({ title: "How to Break Into Investment Banking", status: "LIVE", status_as_of: "2026-11-19" });
  });

  it("an approval for a Live title is closed as LIVE; no browser, no sign-in, no Create", async () => {
    const r = await publishRun([{ id: "jc_tech", title: "How to Get a Job in Tech" }, { id: "jc_ib", title: "how to break into investment banking" }]);
    expect(opened).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.attempts.map((a) => [a.id, a.body.resulting_state, a.body.publish_attempted]).sort()).toEqual([["jc_ib", "LIVE", false], ["jc_tech", "LIVE", false]]);
    expect(r.logs.filter((l) => l.startsWith("KDP-NEW-TITLE: LIVE"))).toHaveLength(2);
    expect(r.logs.join("\n")).toContain("OUTPUT 0 kindle-titles-submitted");
  });

  it("Boss OS refuses the update: still no browser, and the line says it is not settled (never 'marked done')", async () => {
    const r = await publishRun([{ id: "jc_tech", title: "How to Get a Job in Tech" }], 500);
    expect(opened).toEqual([]);
    const line = r.logs.find((l) => l.startsWith("KDP-NEW-TITLE: LIVE"))!;
    expect(line).toContain("did not take the update");
    expect(line).not.toContain("marked done");
  });
});
