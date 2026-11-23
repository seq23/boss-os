import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleRequest } from "../../src/worker/index";
import type { Env } from "../../src/worker/env";

/**
 * THE OWNER PASSWORD STILL OPENS EVERY BOSS OS DOOR, AND ONLY THE FUND API WENT (chassis
 * retirement, her yes 22 Nov 2026; her words: "the owner password should be accepted in every
 * fucking door"). Driven through the Worker's own outer handler, the one production runs: unlock
 * with her passcode, then the kept routes open with that session, each is shut without it, and an
 * old fund path is still 410 even with her session. That no fund table was dropped is held by the
 * chassis ratchet in schema.test.ts.
 */

const outer = {
  WP_OS_DB: env.DB,
  WP_OS_DOCUMENTS: env.VAULT,
  WP_OS_KV: env.SESSIONS,
  WP_OS_ENV: "local",
  BOSS_PASSCODE: env.BOSS_PASSCODE,
  BOSS_SESSION_SECRET: env.SESSION_SECRET,
  ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
} as unknown as Env;

/** Boss OS routes her screens and duties read every day: each must open with her session. */
const KEPT = [
  "/api/boss/auth/state",
  "/api/boss/today",
  "/api/boss/approvals",
  "/api/boss/employees",
  "/api/boss/tasks",
  "/api/boss/duties/all",
  "/api/boss/system/status",
];

async function unlock(passcode: string): Promise<{ status: number; cookie: string }> {
  const res = await handleRequest(
    new Request("https://boss.sequoiataylor.com/api/boss/auth/unlock", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
      body: JSON.stringify({ passcode }),
    }),
    outer,
  );
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { status: res.status, cookie };
}

const get = (path: string, cookie?: string) =>
  handleRequest(new Request(`https://boss.sequoiataylor.com${path}`, { headers: cookie ? { cookie } : {} }), outer);

describe("her passcode through the production handler", () => {
  it("unlocks, and the session opens every kept Boss OS route", async () => {
    const { status, cookie } = await unlock(env.BOSS_PASSCODE);
    expect(status).toBe(200);
    expect(cookie).toMatch(/^boss_session=.+/);
    for (const path of KEPT) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(200);
    }
  });

  it("a wrong passcode gets no session", async () => {
    const { status, cookie } = await unlock("not-her-passcode");
    expect(status).toBe(401);
    expect(cookie).not.toMatch(/^boss_session=/);
  });

  it("every kept route except the lock screen's state is shut without a session", async () => {
    for (const path of KEPT.filter((p) => p !== "/api/boss/auth/state")) {
      expect((await get(path)).status, path).toBe(401);
    }
  });

  it("her session does not reopen the retired fund API", async () => {
    const { cookie } = await unlock(env.BOSS_PASSCODE);
    for (const path of ["/api/me", "/api/companies", "/api/jobs/tick"]) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(410);
    }
  });
});

describe("her email's page links still reach Boss OS", () => {
  it("/tap, /p and /research are Boss OS's routes, never the retired API or the app shell", async () => {
    for (const path of ["/tap/aaaaaaaaaaaaaaaaaaaaaaaa", "/p/aaaaaaaaaaaaaaaaaaaa", "/research/rpg_missing"]) {
      const res = await get(path);
      expect(res.status, path).not.toBe(410);
      expect(await res.text(), path).not.toBe("<html>spa</html>");
    }
    // Locked research page: the calm page that says how in.
    const locked = await get("/research/rpg_missing");
    expect(locked.status).toBe(401);
    expect(locked.headers.get("content-type")).toMatch(/text\/html/);
  });
});
