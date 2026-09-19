/**
 * THE GRID HEALTH READERS — every property gets a row, a blocked reader says why, and Rule 0 holds.
 *
 * Her words, 19 September 2026: "Connect all the GSC and whatever else to measure the health and
 * GitHub and all."
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { readUptime, readGsc, recordReadings, runWorkerReader } from "../../src/worker/boss/health/readers";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { GRID } from "../../src/shared/boss/grid.mjs";
import { READERS, readerRegistry, cannotReason } from "../../src/shared/boss/propertyReaders.mjs";
import { apiJson, all, row } from "./helpers";

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (input: any, init?: RequestInit) => handler(typeof input === "string" ? input : input.url, init)) as typeof fetch;

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM property_health_readings`).run();
});

describe("the registry", () => {
  it("crosses every grid property with every one of the four readers, and every cell is wired or names why not", () => {
    const reg = readerRegistry();
    expect(GRID.length).toBeGreaterThan(0);
    expect(reg).toHaveLength(GRID.length * READERS.length);
    for (const cell of reg) {
      if (!cell.wired) expect((cell.cannot ?? "").length, `${cell.property_key}/${cell.reader} is not wired and gives no reason`).toBeGreaterThan(40);
      else expect(cell.cannot).toBeNull();
    }
    // The three she named on 13 Sep have no domain and say so; a channel is not a site.
    expect(cannotReason("youtube", "uptime")).toMatch(/YouTube channel/);
    expect(cannotReason("wedding", "gsc")).toMatch(/not recorded/);
    expect(cannotReason("guides_generator", "uptime")).toBeNull();
  });
});

describe("the uptime reader", () => {
  it("records a 200 with its latency, a 5xx as attention, and a domain that did not answer — one row per domain, and the domainless properties blocked by name", async () => {
    const readings = await readUptime(fakeFetch((url) => {
      if (url.includes("approvalprep.com")) return new Response("boom", { status: 503 });
      if (url.includes("hicksconsulting.org")) throw new Error("ECONNRESET");
      return new Response("ok", { status: 200 });
    }));
    const byKey = (k: string) => readings.filter((r) => r.property_key === k);
    // Every property has at least one row.
    for (const p of GRID) expect(byKey(p.key).length, `${p.key} has no uptime row`).toBeGreaterThan(0);
    expect(byKey("guides_generator")).toHaveLength(5);
    const up = byKey("citation_velocity")[0]!;
    expect(up.state).toBe("ok");
    expect(up.numbers.status).toBe(200);
    expect(typeof up.numbers.ms).toBe("number");
    expect(up.evidence_url).toBe("https://theindustryguides.com/");
    const down = byKey("approvalprep")[0]!;
    expect(down.state).toBe("warn");
    expect(down.error).toBe("HTTP 503");
    const gone = byKey("hicks_consulting")[0]!;
    expect(gone.state).toBe("warn");
    expect(gone.summary).toMatch(/did not answer: ECONNRESET/);
    const yt = byKey("youtube")[0]!;
    expect(yt.state).toBe("blocked");
    expect(yt.summary).toMatch(/YouTube channel handle/);
    const wedding = byKey("wedding")[0]!;
    expect(wedding.state).toBe("blocked");
    expect(wedding.summary).toMatch(/not recorded/);
  });
});

describe("the Search Console reader", () => {
  it("is a NAMED STOP for every domain when the Worker holds no key — never silence", async () => {
    const saved = (env as any).GSC_SERVICE_ACCOUNT_JSON;
    (env as any).GSC_SERVICE_ACCOUNT_JSON = undefined;
    try {
      let calls = 0;
      const readings = await readGsc(env as any, fakeFetch(() => { calls++; return new Response("{}"); }));
      expect(calls).toBe(0);
      const wired = readings.filter((r) => cannotReason(r.property_key, "gsc") === null);
      expect(wired.length).toBeGreaterThan(0);
      for (const r of wired) {
        expect(r.state).toBe("blocked");
        expect(r.summary).toMatch(/GSC_SERVICE_ACCOUNT_JSON is not bound/);
      }
      expect(readings.filter((r) => r.property_key === "guides_generator")).toHaveLength(5);
    } finally {
      (env as any).GSC_SERVICE_ACCOUNT_JSON = saved;
    }
  });

  it("names the account that is not a user on a property, and reads clicks and impressions where it is", async () => {
    // A throwaway RSA key so the JWT can be signed; the fake token endpoint never checks it.
    const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(pkcs8)))}\n-----END PRIVATE KEY-----\n`;
    const saved = (env as any).GSC_SERVICE_ACCOUNT_JSON;
    (env as any).GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "gsc-bot@example.iam.gserviceaccount.com", private_key: pem });
    try {
      const readings = await readGsc(env as any, fakeFetch((url, init) => {
        if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "tok" }));
        if (url.endsWith("/webmasters/v3/sites")) return new Response(JSON.stringify({ siteEntry: [{ siteUrl: "sc-domain:theindustryguides.com", permissionLevel: "siteFullUser" }] }));
        if (url.includes("searchAnalytics/query")) {
          expect(init?.method).toBe("POST");
          return new Response(JSON.stringify({ rows: [{ clicks: 24, impressions: 7642, ctr: 0.003, position: 41.2 }] }));
        }
        throw new Error(`unexpected ${url}`);
      }), Date.UTC(2026, 8, 19, 12));
      const read = readings.find((r) => r.property_key === "citation_velocity")!;
      expect(read.state).toBe("ok");
      expect(read.numbers).toMatchObject({ clicks: 24, impressions: 7642, start: "2026-09-10", end: "2026-09-16" });
      expect(read.summary).toMatch(/24 clicks from 7642 impressions/);
      const notUser = readings.find((r) => r.property_key === "approvalprep")!;
      expect(notUser.state).toBe("blocked");
      expect(notUser.error).toBe("no_gsc_access");
      expect(notUser.summary).toMatch(/gsc-bot@example\.iam\.gserviceaccount\.com is not a user on this Search Console property/);
    } finally {
      (env as any).GSC_SERVICE_ACCOUNT_JSON = saved;
    }
  });
});

describe("running a reader as a duty", () => {
  it("writes one row per reading, marks the duty ok, and the route answers every property × reader", async () => {
    const result = await runWorkerReader(env as any, "uptime", Date.now(), fakeFetch(() => new Response("ok")));
    expect(result.written).toBeGreaterThan(GRID.length - 1);
    const rows = await all<any>(`SELECT property_key, reader, state FROM property_health_readings`);
    expect(rows.length).toBe(result.written);
    expect(new Set(rows.map((r) => r.property_key)).size).toBe(GRID.length);

    const { status, body } = await apiJson("/api/grid/health");
    expect(status).toBe(200);
    expect(body.data.readers).toEqual(["uptime", "github", "gsc", "cloudflare"]);
    expect(body.data.properties).toHaveLength(GRID.length);
    for (const p of body.data.properties) {
      expect(p.readers).toHaveLength(4);
      for (const r of p.readers) {
        // Every cell is one of the four true states — never blank.
        expect(["ok", "warn", "blocked", "never", "cannot"]).toContain(r.state);
        if (r.state === "cannot") expect(r.cannot).toMatch(/\w+/);
        if (r.state === "never") expect(r.never_read_hint).toMatch(/Not read yet/);
      }
    }
    const gh = body.data.properties[0].readers.find((r: any) => r.reader === "github");
    expect(gh.state).toBe("never");
    expect(gh.runs_on).toBe("mac");
  });

  it("refuses a reader nobody declared, and Rule 0 fails a run that wrote nothing", async () => {
    await expect(runWorkerReader(env as any, "moon_phase", Date.now())).rejects.toThrow(/No Worker reader is called "moon_phase"/);
    expect(await recordReadings(env.DB, [], Date.now())).toBe(0);
  });

  it("the migration's worker duties are materialised by the Worker itself: the duty runs, records ok, and fires with no task", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 0, suspended = 0 WHERE id = 'duty_property_uptime'`).run();
    // HERMETIC: the duty path uses the global fetch, so it is stubbed here — the first run of this
    // test reached the live domains from inside workerd, which is a network test wearing a unit
    // test's name.
    const realFetch = globalThis.fetch;
    let probes = 0;
    globalThis.fetch = fakeFetch(() => { probes++; return new Response("ok"); });
    let out;
    try { out = await materialiseDueDuties(env as any, Date.now(), "duty_property_uptime"); } finally { globalThis.fetch = realFetch; }
    expect(probes).toBeGreaterThan(0);
    const fired = out.fired.find((f) => f.duty === "duty_property_uptime");
    expect(fired, JSON.stringify(out.skipped)).toBeTruthy();
    expect(fired!.task_id).toBeNull();
    const duty = await row<any>(`SELECT executor, last_outcome, last_failure_reason, next_due_at FROM standing_duties WHERE id = ?`, "duty_property_uptime");
    expect(duty.executor).toBe("worker");
    expect(duty.last_outcome).toBe("ok");
    expect(duty.next_due_at).toBeGreaterThan(Date.now());
    const n = await row<any>(`SELECT COUNT(*) AS n FROM property_health_readings WHERE reader = 'uptime'`);
    expect(n.n).toBeGreaterThan(0);
    // No task and no queue row: the reading happened here.
    const tasks = await row<any>(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE 'Is every property up%'`);
    expect(tasks.n).toBe(0);
  });
});

describe("readings posted from her Mac", () => {
  it("accepts GitHub and Cloudflare rows, refuses a property the grid does not declare, a fifth reader, a Worker reader, and a blocked row with no reason", async () => {
    const good = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [
      { property_key: "hpc", reader: "github", target: "seq23/sprylabs-hpc-site", state: "warn", summary: "last run failed", numbers: { open_prs: 2 }, evidence_url: "https://github.com/seq23/sprylabs-hpc-site/actions", error: "last run failure" },
      { property_key: "hpc", reader: "cloudflare", target: "spryexecutiveos.com", state: "ok", summary: "Pages project sprylabs-hpc-site deployed 0d ago", numbers: { kind: "pages" }, evidence_url: "https://dash.cloudflare.com/x" },
    ] } });
    expect(good.status).toBe(201);
    expect(good.body.data.written).toBe(2);
    const { body } = await apiJson("/api/grid/health");
    const hpc = body.data.properties.find((p: any) => p.key === "hpc");
    expect(hpc.readers.find((r: any) => r.reader === "github").state).toBe("warn");
    expect(hpc.readers.find((r: any) => r.reader === "cloudflare").readings[0].summary).toMatch(/sprylabs-hpc-site/);

    const notGrid = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [{ property_key: "west_peek", reader: "github", target: "x", state: "ok", summary: "s" }] } });
    expect(notGrid.status).toBe(400);
    expect(notGrid.body.error).toMatch(/not a grid property/);
    const fifth = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [{ property_key: "hpc", reader: "vibes", target: "x", state: "ok", summary: "s" }] } });
    expect(fifth.status).toBe(400);
    const workerOne = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [{ property_key: "hpc", reader: "uptime", target: "x", state: "ok", summary: "s" }] } });
    expect(workerOne.status).toBe(400);
    expect(workerOne.body.error).toMatch(/runs in the Worker/);
    const noWhy = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [{ property_key: "hpc", reader: "github", target: "x", state: "blocked", summary: "could not" }] } });
    expect(noWhy.status).toBe(400);
    expect(noWhy.body.error).toMatch(/must say why/);
    const empty = await apiJson("/api/grid/health/readings", { method: "POST", body: { readings: [] } });
    expect(empty.status).toBe(400);
  });
});
