import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A KINDLE RUN OPENS THE KDP CHROME WINDOW AT ONCE (her words 25 Nov 2026 on the old note-then-wait
 * before Chrome: "this rule is stupid, its useless").
 *
 * The real unattended run is driven here against a fake Boss OS, a fake browser and a recording clock,
 * with an approved book's draft on disk and the quality gate passing. Every timer the run schedules,
 * every POST it makes and every browser it opens is written to one ordered log. Before the visible
 * window opens there must be no timer of a second or more and no message to her of any kind (no
 * Updates line, no email). Synthetic data only.
 */
const events: string[] = [];
let profileDir = "";
let headedOpens = 0;
vi.mock("../scripts/ops/browser.mjs", () => ({
  profilePath: () => profileDir,
  openProfile: async (_p: string, { headed }: { headed: boolean }) => {
    events.push(headed ? "open:headed" : "open:headless");
    if (headed) { headedOpens += 1; throw new Error("Chrome did not open"); }
    // The headless bookshelf look fails like an offline Mac: the run must still go on to the window.
    const page = { goto: async () => { throw new Error("offline"); }, url: () => "about:blank", waitForTimeout: async () => {} };
    return { context: { pages: () => [page], newPage: async () => page, close: async () => {}, once: () => {} } };
  },
}));
vi.mock("../scripts/ops/kdp-books/quality-gate.mjs", () => ({ gateFolder: () => ({ pass: true, findings: [] }) }));
vi.mock("../scripts/ops/notify.mjs", () => ({
  ownerTo: () => "owner@example.invalid",
  sendAsEmployee: async (_who: string, m: { subject: string }) => { events.push(`email:${m.subject}`); return { ok: true }; },
}));

const TITLE = "The Workplace Incident Log"; // a KeepMyProof book (kdp-books/keepmyproof.json) not Live in the register

async function unattendedRun({ busy = false } = {}) {
  const drafts = mkdtempSync(join(tmpdir(), "kdp-kmp-"));
  mkdirSync(join(drafts, "workplace"));
  writeFileSync(join(drafts, "workplace", "book.epub"), "epub");
  writeFileSync(join(drafts, "workplace", "listing.json"), JSON.stringify({ title: TITLE, subtitle: "A synthetic subtitle", price_usd: 4.99 }));
  profileDir = mkdtempSync(join(tmpdir(), "kdp-profile-"));
  if (busy) symlinkSync(`synthetic-host-${process.pid}`, join(profileDir, "SingletonLock")); // a live process holds it
  Object.assign(process.env, { KMP_KDP_DIR: drafts, BOSS_PASSCODE: "test-passcode", BOSS_OS_ORIGIN: "https://boss.invalid" });
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
    const u = String(url);
    if (u.endsWith("/api/boss/auth/unlock")) return new Response("{}", { status: 200, headers: { "set-cookie": "boss=t; Path=/" } });
    if (u.endsWith("/api/boss/kdp/new-titles")) return Response.json({ data: { approved: [{ id: "jc_synth1", title: TITLE }] } });
    if (init?.method === "POST") events.push(`post:${u.replace("https://boss.invalid/api/boss", "")}`);
    return Response.json({ ok: true, data: {} });
  });
  // The recording clock: each timer is logged with its delay and fires at once, so a wait shows up
  // in the log instead of hanging the test.
  const realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", ((fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
    if ((ms ?? 0) >= 1000) events.push(`timer:${ms}`);
    return realSetTimeout(fn, 0, ...a);
  }) as typeof setTimeout);
  process.argv.push("--unattended");
  vi.resetModules();
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(String(m)); });
  const err = vi.spyOn(console, "error").mockImplementation((m: string) => { logs.push(String(m)); });
  try {
    // @ts-expect-error — plain .mjs ops script, no types
    const { run } = await import("../scripts/ops/kdp-new-title.mjs");
    const code = await run().then((c: number) => c, (e: Error) => `threw: ${e.message}`);
    return { code, logs };
  } finally {
    spy.mockRestore(); err.mockRestore();
    process.argv.splice(process.argv.indexOf("--unattended"), 1);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  events.length = 0; headedOpens = 0;
  for (const k of ["KMP_KDP_DIR", "BOSS_PASSCODE", "BOSS_OS_ORIGIN"]) delete process.env[k];
});

describe("an unattended Kindle run opens Chrome at once", () => {
  it("the visible window is the first thing after the bookshelf look: no wait, no note to her before it", async () => {
    const r = await unattendedRun();
    expect(headedOpens, "the run reached the visible window").toBe(1);
    const before = events.slice(0, events.indexOf("open:headed"));
    expect(before, "nothing but the headless bookshelf look comes before the window").toEqual(["open:headless"]);
    expect(before.filter((e) => e.startsWith("timer:")), "no wait before Chrome").toEqual([]);
    expect(before.filter((e) => e.startsWith("post:") || e.startsWith("email:")), "no note before Chrome").toEqual([]);
    // Outage: Chrome that does not open is never a pass. The run is refused, not exit 0.
    expect(r.code).toBe("threw: Chrome did not open");
  });

  it("the KDP profile already open is still the PROFILE_IN_USE stop (exit 5): nothing opened, no wait, no note", async () => {
    const r = await unattendedRun({ busy: true });
    expect(r.code).toBe(5);
    expect(r.logs.some((l) => l.startsWith("NAMED STOP [PROFILE_IN_USE]"))).toBe(true);
    expect(events).toEqual([]);
  });
});
