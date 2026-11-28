import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, disposeTestDb, latestMigrationName, makeTestEnv, type TestDb } from "./helpers/db";
import { handleRequest } from "../src/worker/index";
import { mapsHealth } from "../src/shared/boss/emailMap/mapsHealth";
import emailManifest from "../src/shared/boss/emailMap/manifest.json";
import ownersFile from "../docs/outbound_email_owners.json";

/**
 * THE COPIED FUND API IS GONE, AND EVERY OLD DOOR SAYS WHERE IT WENT (chassis retirement, her yes
 * 22 Nov 2026). Whatever comes with the request (nothing, the old local dev identity, a forged
 * Access assertion or cookie), an old fund /api path answers 410 with West Peek OS's address and
 * never a byte of data, a 500 or an empty 200. The health check and the app's pages are untouched.
 */

const OLD_PATHS = ["/api/me", "/api/companies", "/api/opportunities", "/api/funds", "/api/jobs/tick", "/api/does-not-exist"];

const FORGED_JWT = "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InNjb290ZXJAZXhhbXBsZS5jb20iLCJhdWQiOlsieCJdfQ.c2ln";
const CREDENTIALS: Record<string, Record<string, string>> = {
  "no credentials": {},
  "the old local dev identity header": { "x-wpos-dev-user": "scooter@example.com" },
  "a forged Access assertion": { "Cf-Access-Jwt-Assertion": FORGED_JWT },
  "a forged Access cookie": { cookie: `CF_Authorization=${FORGED_JWT}` },
};

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await disposeTestDb(t); });

describe("an old fund /api path is 410 with where to go, whoever asks", () => {
  for (const [who, headers] of Object.entries(CREDENTIALS)) {
    for (const method of ["GET", "POST"] as const) {
      it(`${method} with ${who}`, async () => {
        const env = makeTestEnv(t.db); // WP_OS_ENV "local": the dev header's old home
        for (const path of OLD_PATHS) {
          const res = await handleRequest(
            new Request(`https://boss.sequoiataylor.com${path}`, {
              method,
              headers: { ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
              body: method === "POST" ? JSON.stringify({ name: "x" }) : undefined,
            }),
            env,
          );
          expect(res.status, path).toBe(410);
          expect(res.headers.get("cache-control"), path).toBe("no-store");
          const body = (await res.json()) as Record<string, unknown>;
          expect(Object.keys(body).sort(), path).toEqual(["error", "message", "moved_to", "path"]);
          expect(body).toMatchObject({ error: "gone", moved_to: "https://os.joinwestpeek.com", path });
          expect(String(body.message)).toMatch(/West Peek OS/);
        }
      });
    }
  }
});

describe("what stays open", () => {
  it("/api/health answers 200 without a session, with the database and its schema version", async () => {
    const res = await handleRequest(new Request("https://boss.sequoiataylor.com/api/health"), makeTestEnv(t.db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; d1: { reachable: boolean; schemaVersion: string } };
    expect(body.ok).toBe(true);
    expect(body.d1.reachable).toBe(true);
    expect(body.d1.schemaVersion).toBe(latestMigrationName());
  });

  it("/api/health reports what Email Map and Team -> Duties were built from, counts only (#591 outcome)", async () => {
    const res = await handleRequest(new Request("https://boss.sequoiataylor.com/api/health"), makeTestEnv(t.db));
    const raw = await res.text();
    const body = JSON.parse(raw) as { maps: { emailMap: { rows: number; withScheduleAndPause: number }; teamDuties: { paths: number } } };
    const manifestRows = (emailManifest as { rows: unknown[] }).rows.length;
    const ownerPaths = Object.keys((ownersFile as { owners: Record<string, unknown> }).owners).length;
    expect(manifestRows).toBeGreaterThanOrEqual(100);
    expect(body.maps.emailMap.rows).toBe(manifestRows);
    expect(body.maps.emailMap.withScheduleAndPause).toBe(manifestRows);
    expect(body.maps.teamDuties.paths).toBe(ownerPaths);
    // Public answer: counts, never a sender address, schedule or pause step.
    expect(raw).not.toMatch(/@|launchctl|\.yml|Central/);
  });

  it("a map row with no schedule or no pause step is not counted, and an empty map counts 0", () => {
    expect(mapsHealth({ rows: [{ when: "Daily", pause: "Disable x" }, { when: "", pause: "Disable y" }, { when: "Daily" }] }, { owners: {} }))
      .toEqual({ emailMap: { rows: 3, withScheduleAndPause: 1 }, teamDuties: { paths: 0 } });
    expect(mapsHealth({}, {})).toEqual({ emailMap: { rows: 0, withScheduleAndPause: 0 }, teamDuties: { paths: 0 } });
  });

  it("an unreachable database reads as not ok, never as healthy", async () => {
    const broken = { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database;
    const res = await handleRequest(new Request("https://boss.sequoiataylor.com/api/health"), makeTestEnv(broken));
    const body = (await res.json()) as { ok: boolean; d1: { reachable: boolean } };
    expect(body.ok).toBe(false);
    expect(body.d1.reachable).toBe(false);
  });

  it("a page address is served by the app, not the retired API", async () => {
    for (const path of ["/", "/boss", "/boss/today", "/dealflow"]) {
      const res = await handleRequest(new Request(`https://boss.sequoiataylor.com${path}`), makeTestEnv(t.db));
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe("<html>spa</html>");
    }
  });
});
