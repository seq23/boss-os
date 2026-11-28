/**
 * HER PERSONAL GMAIL, READ-ONLY, IN ONE SIGN-IN (owner, 28 Nov 2026: "yes do this also now").
 *
 * `npm run gmail:grant` (scripts/ops/gmail-grant.mjs) runs Google's loopback flow and saves the three
 * TONI_GMAIL_* keys. These tests run it end to end against a REAL 127.0.0.1 server and a mocked Google,
 * and hold the risks the brief named: no token in any output, a business account refused, any scope
 * but gmail.readonly refused, an outage or a closed tab ending non-zero with nothing saved, the server
 * on 127.0.0.1 only with its state checked and closed after one code. Then the consumers: with the
 * grant they read "arrived"/"not arrived", without it (or with a dead one) they fall back as before.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantStop, READONLY, authUrl, ownerAddress, pickClient, runGrant, vaultSetMany, waitForCode } from "../scripts/ops/gmail-grant.mjs";
import { probePersonalGrant } from "../scripts/ops/credential-check.mjs";
import { PERSONAL_GRANT_REJECTED, personalGrant, readToniMail } from "../scripts/ops/lib/toni-mail.mjs";
import { personalSearch, receiptFor } from "../scripts/ops/lib/simone-operations.mjs";
import { parseSecretMap } from "../scripts/lib/vault-env.mjs";

const OWNER = "owner.fixture@gmail.example";
const SECRET_VALUES = {
  clientId: "1234-fixture.apps.googleusercontent.com",
  clientSecret: "GOCSPX-fixture-client-secret",
  refresh: "1//fixture-refresh-token-value",
  access: "ya29.fixture-access-token-value",
  code: "4/fixture-authorization-code",
};
const ENV = {
  RCLONE_MAC_BACKUP_OAUTH_CLIENT_ID: SECRET_VALUES.clientId,
  RCLONE_MAC_BACKUP_OAUTH_CLIENT_SECRET: SECRET_VALUES.clientSecret,
  BOSS_NOTIFY_TO: `You <${OWNER.toUpperCase()}>`,
};
const TOKEN_SHAPED = /ya29\.|1\/\/|GOCSPX-|4\/fixture|fixture-(?:refresh|access|client-secret|authorization)/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A mocked Google: the token endpoint (code and refresh grants) and Gmail's profile. */
function google({ scope = READONLY, address = OWNER, exchange = 200, refresh = 200, profile = 200, down = false, refreshScope = READONLY } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), body });
    if (down) throw new TypeError("fetch failed");
    if (String(url) === "https://oauth2.googleapis.com/token") {
      const grant = new URLSearchParams(body).get("grant_type");
      if (grant === "authorization_code") {
        return exchange === 200
          ? json({ access_token: SECRET_VALUES.access, refresh_token: SECRET_VALUES.refresh, scope, token_type: "Bearer", expires_in: 3599 })
          : json({ error: "invalid_grant" }, exchange);
      }
      return refresh === 200 ? json({ access_token: SECRET_VALUES.access, scope: refreshScope, expires_in: 3599 }) : json({ error: "invalid_grant" }, refresh);
    }
    if (String(url) === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
      if (profile === 403) return json({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, 403);
      return profile === 200 ? json({ emailAddress: address, messagesTotal: 1 }) : json({}, profile);
    }
    throw new Error(`unexpected request to ${url}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

/** Plays Google's redirect back to the loopback server, as her browser would. */
function browser({ state, params }: { state?: string; params?: Record<string, string> } = {}) {
  const seen: { url?: URL; status?: number; page?: string } = {};
  const open = async (url: string) => {
    seen.url = new URL(url);
    const redirect = seen.url.searchParams.get("redirect_uri")!;
    const q = new URLSearchParams(params ?? { state: state ?? seen.url.searchParams.get("state")!, code: SECRET_VALUES.code, scope: READONLY });
    const response = await fetch(`${redirect}/?${q}`);
    seen.status = response.status;
    seen.page = await response.text();
  };
  return { open, seen };
}

async function grant(opts: Parameters<typeof runGrant>[0] & { googleOpts?: Parameters<typeof google>[0] } = {}) {
  const { fetchImpl } = google(opts.googleOpts);
  const lines: string[] = [];
  const save = vi.fn(async () => {});
  const nav = browser();
  let error: unknown = null;
  try {
    await runGrant({ env: ENV, fetchImpl, openBrowser: nav.open, save, say: (l) => lines.push(l), timeoutMs: 5_000, ...opts });
  } catch (e) { error = e; }
  const output = [...lines, error instanceof Error ? error.message : "", nav.seen.page ?? ""].join("\n");
  return { save, lines, error, output, seen: nav.seen };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the sign-in (scripts/ops/gmail-grant.mjs)", () => {
  it("happy path: asks Google for gmail.readonly only, offline, with PKCE, and saves exactly the three keys once, printing no token", async () => {
    const { save, error, output, seen } = await grant();
    expect(error).toBeNull();
    const url = seen.url!;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(READONLY);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      TONI_GMAIL_CLIENT_ID: SECRET_VALUES.clientId, TONI_GMAIL_CLIENT_SECRET: SECRET_VALUES.clientSecret, TONI_GMAIL_REFRESH_TOKEN: SECRET_VALUES.refresh,
    });
    expect(output).toMatch(/connected read-only/);
    expect(output).not.toMatch(TOKEN_SHAPED);
    expect(output.toLowerCase()).not.toContain(OWNER);
  });

  it("the exchange carries the PKCE verifier that matches the challenge, and the refresh is tried before anything is saved", async () => {
    const g = google();
    const nav = browser();
    const order: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      order.push(`${url}:${new URLSearchParams(String(init?.body ?? "")).get("grant_type") ?? ""}`);
      return g.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    await runGrant({ env: ENV, fetchImpl, openBrowser: nav.open, save: async () => { order.push("save"); }, say: () => {}, timeoutMs: 5_000 });
    const exchange = new URLSearchParams(g.calls.find((c) => c.body.includes("authorization_code"))!.body);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(nav.seen.url!.searchParams.get("code_challenge"));
    expect(exchange.get("redirect_uri")).toBe(nav.seen.url!.searchParams.get("redirect_uri"));
    // Saved once, and only after the refresh the jobs use has worked.
    expect(order.filter((step) => step === "save")).toHaveLength(1);
    expect(order.indexOf("save")).toBeGreaterThan(order.indexOf("https://oauth2.googleapis.com/token:refresh_token"));
    expect(order.indexOf("https://oauth2.googleapis.com/token:refresh_token")).toBeGreaterThan(-1);
  });

  it("a business account is refused and nothing is saved", async () => {
    const { save, error, output } = await grant({ googleOpts: { address: "owner@business.example" } });
    expect(error).toBeInstanceOf(GrantStop);
    expect((error as GrantStop).code).toBe("WRONG_ACCOUNT");
    expect(save).not.toHaveBeenCalled();
    expect(output).not.toMatch(TOKEN_SHAPED);
    expect(output).not.toContain("business.example");
  });

  it("any scope besides gmail.readonly is refused and nothing is saved", async () => {
    for (const scope of [`${READONLY} https://www.googleapis.com/auth/drive`, "https://www.googleapis.com/auth/gmail.modify", `openid ${READONLY}`, ""]) {
      const { save, error } = await grant({ googleOpts: { scope } });
      expect((error as GrantStop).code, scope).toBe("NOT_READ_ONLY");
      expect(save).not.toHaveBeenCalled();
    }
  });

  it("a refresh that comes back with another scope is refused before the save (the jobs' own check)", async () => {
    const { save, error } = await grant({ googleOpts: { refreshScope: `${READONLY} https://www.googleapis.com/auth/drive` } });
    expect((error as GrantStop).code).toBe("GRANT_DID_NOT_REFRESH");
    expect(save).not.toHaveBeenCalled();
  });

  it("outage: Google down, a refused code, a profile error or the Gmail API off all end with a named stop and nothing saved", async () => {
    for (const [googleOpts, code] of [
      [{ down: true }, "GOOGLE_UNREACHABLE"], [{ exchange: 400 }, "SIGN_IN_REFUSED"], [{ profile: 500 }, "PROFILE_UNREADABLE"],
      [{ profile: 403 }, "GMAIL_API_OFF"], [{ refresh: 400 }, "GRANT_DID_NOT_REFRESH"],
    ] as const) {
      const { save, error, output } = await grant({ googleOpts });
      expect((error as GrantStop).code, code).toBe(code);
      expect(save).not.toHaveBeenCalled();
      expect(output).not.toMatch(TOKEN_SHAPED);
    }
  });

  it("she clicks Cancel on Google's page: refused, nothing saved, and the page shows no code", async () => {
    const nav = browser();
    const save = vi.fn();
    const open = async (url: string) => {
      const state = new URL(url).searchParams.get("state")!;
      const redirect = new URL(url).searchParams.get("redirect_uri")!;
      const page = await (await fetch(`${redirect}/?state=${state}&error=access_denied`)).text();
      nav.seen.page = page;
    };
    await expect(runGrant({ env: ENV, fetchImpl: google().fetchImpl, openBrowser: open, save, say: () => {}, timeoutMs: 5_000 }))
      .rejects.toMatchObject({ code: "SIGN_IN_NOT_GIVEN" });
    expect(save).not.toHaveBeenCalled();
  });

  it("the tab is closed: after the timeout it stops non-zero, nothing saved, and the server no longer listens", async () => {
    let redirect = "";
    const save = vi.fn();
    await expect(runGrant({ env: ENV, fetchImpl: google().fetchImpl, openBrowser: async (url) => { redirect = new URL(url).searchParams.get("redirect_uri")!; },
      save, say: () => {}, timeoutMs: 300 })).rejects.toMatchObject({ code: "NO_SIGN_IN" });
    expect(save).not.toHaveBeenCalled();
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("the loopback server listens on 127.0.0.1 only, ignores a wrong state, and closes after one code", async () => {
    let address: unknown;
    let redirect = "";
    const wrong: number[] = [];
    const result = await waitForCode({
      state: "the-right-state", timeoutMs: 5_000,
      onListening: async (uri, server) => {
        address = server.address();
        redirect = uri;
        const forged = await fetch(`${uri}/?state=forged&code=${encodeURIComponent(SECRET_VALUES.code)}`);
        wrong.push(forged.status);
        expect(await forged.text()).not.toContain(SECRET_VALUES.code);
        const right = await fetch(`${uri}/?state=the-right-state&code=${encodeURIComponent(SECRET_VALUES.code)}`);
        expect(await right.text()).not.toContain(SECRET_VALUES.code);
        expect(right.headers.get("referrer-policy")).toBe("no-referrer");
      },
    });
    expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    expect(wrong).toEqual([400]);
    expect(result.code).toBe(SECRET_VALUES.code);
    await new Promise((r) => setTimeout(r, 50));
    await expect(fetch(`${redirect}/?state=the-right-state&code=second`)).rejects.toThrow();
  });

  it("stops before opening the browser when the vault has no address to compare, or no Desktop client", async () => {
    const open = vi.fn();
    await expect(runGrant({ env: { ...ENV, BOSS_NOTIFY_TO: "" }, openBrowser: open, save: vi.fn(), say: () => {} })).rejects.toMatchObject({ code: "NO_OWNER_ADDRESS" });
    await expect(runGrant({ env: { BOSS_NOTIFY_TO: OWNER }, openBrowser: open, save: vi.fn(), say: () => {} })).rejects.toMatchObject({ code: "NO_DESKTOP_CLIENT" });
    expect(open).not.toHaveBeenCalled();
    expect(ownerAddress(ENV)).toBe(OWNER);
  });

  it("a re-run uses the grant's own saved client first", () => {
    expect(pickClient({ ...ENV, TONI_GMAIL_CLIENT_ID: "own-id", TONI_GMAIL_CLIENT_SECRET: "own-secret" })).toMatchObject({ id: "own-id", source: "TONI_GMAIL_CLIENT_*" });
    expect(pickClient(ENV)).toMatchObject({ id: SECRET_VALUES.clientId, source: "RCLONE_MAC_BACKUP_OAUTH_CLIENT_*" });
    expect(new URL(authUrl({ clientId: "c", redirectUri: "http://127.0.0.1:1", state: "s", challenge: "x" })).searchParams.get("scope")).toBe(READONLY);
  });

  it("the real command, run with no address in the vault, exits non-zero before any browser opens", () => {
    const run = spawnSync(process.execPath, ["scripts/ops/gmail-grant.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH, ...ENV, BOSS_NOTIFY_TO: "" }, timeout: 30_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("NAMED STOP [NO_OWNER_ADDRESS]");
    expect(run.stdout + run.stderr).not.toMatch(TOKEN_SHAPED);
  });
});

describe("the save: one vault write, values on stdin only", () => {
  it("hands the vault all three keys on stdin, never in argv", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gmail-grant-"));
    const fake = join(dir, "vault.mjs");
    writeFileSync(fake, `import { writeFileSync } from "node:fs"; let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
      writeFileSync(${JSON.stringify(join(dir, "seen.json"))}, JSON.stringify({ argv: process.argv.slice(2), stdin: s })); });`);
    const keys = { TONI_GMAIL_CLIENT_ID: "a", TONI_GMAIL_CLIENT_SECRET: "b", TONI_GMAIL_REFRESH_TOKEN: SECRET_VALUES.refresh };
    await vaultSetMany(keys, { vault: fake, env: { PATH: process.env.PATH } });
    const seen = JSON.parse(readFileSync(join(dir, "seen.json"), "utf8"));
    expect(seen.argv).toEqual(["set-many"]);
    expect(JSON.parse(seen.stdin)).toEqual(keys);
  });

  it("a vault that refuses the write is a named stop that names no value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gmail-grant-"));
    const fake = join(dir, "vault.mjs");
    writeFileSync(fake, `process.stdin.resume(); process.stdin.on("end", () => { console.error("VAULT GATE: No vault master key in Keychain."); process.exit(1); });`);
    const err = await vaultSetMany({ TONI_GMAIL_REFRESH_TOKEN: SECRET_VALUES.refresh }, { vault: fake, env: { PATH: process.env.PATH } }).catch((e) => e);
    expect(err).toMatchObject({ code: "VAULT_WRITE_FAILED" });
    expect(err.message).not.toMatch(TOKEN_SHAPED);
  });

  it("set-many checks every key before anything is written: one bad entry refuses all", () => {
    expect(parseSecretMap(JSON.stringify({ A_KEY: " v ", B_KEY: "w" }))).toEqual({ A_KEY: "v", B_KEY: "w" });
    for (const bad of ["", "[]", "{}", "not json", JSON.stringify({ A_KEY: "v", "bad name": "w" }), JSON.stringify({ A_KEY: "v", B_KEY: "" }), JSON.stringify({ A_KEY: 1 })]) {
      expect(() => parseSecretMap(bad), bad).toThrow();
    }
    expect(() => parseSecretMap(JSON.stringify({ A_KEY: SECRET_VALUES.refresh, B_KEY: " " }))).toThrow(/B_KEY/);
    try { parseSecretMap(JSON.stringify({ A_KEY: SECRET_VALUES.refresh, B_KEY: " " })); } catch (e) { expect(String(e)).not.toMatch(TOKEN_SHAPED); }
  });
});

describe("the consumers: a grant reads, no grant or a dead one falls back as before", () => {
  const GRANT = { TONI_GMAIL_CLIENT_ID: "id", TONI_GMAIL_CLIENT_SECRET: "secret", TONI_GMAIL_REFRESH_TOKEN: "refresh", BOSS_NOTIFY_TO: OWNER };
  const NOW = Date.UTC(2026, 10, 28, 15);
  const row = (id: string) => ({ id: "pending:a", message_id: `<${id}@mail.example>`, sent_at: NOW - 1e7 });

  /** Google's token endpoint (scripted status) plus Gmail's message search, which only `found` matches. */
  function gmailWith(status = 200) {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.href === "https://oauth2.googleapis.com/token") return status === 200 ? json({ access_token: "tok", scope: READONLY }) : json({ error: "invalid_grant" }, status);
      if (u.pathname === "/gmail/v1/users/me/messages") return json(/rfc822msgid:found@/.test(u.searchParams.get("q") ?? "") ? { messages: [{ id: "m1" }] } : {});
      if (u.pathname === "/gmail/v1/users/me/profile") return json({ emailAddress: OWNER });
      throw new Error(`unexpected ${u.href}`);
    });
    vi.stubGlobal("fetch", fetchImpl);
    return fetchImpl as unknown as typeof fetch;
  }

  it("the arrival check: with the grant, arrived / not arrived; without it, couldn't check", async () => {
    const fetchImpl = gmailWith();
    const mailbox = await personalSearch(GRANT, fetchImpl);
    expect(mailbox).not.toBeNull();
    expect(await receiptFor(row("found"), { mailbox, now: NOW })).toBe("arrived");
    expect(await receiptFor(row("absent"), { mailbox, now: NOW })).toBe("not_arrived");
    const none = await personalSearch({}, fetchImpl);
    expect(none).toBeNull();
    expect(await receiptFor(row("found"), { mailbox: none, now: NOW })).toBe("unknown");
  });

  it("the arrival check: a rejected grant names the fix and falls back to Resend's receipt, never a whole unread run", async () => {
    const fetchImpl = gmailWith(400);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mailbox = await personalSearch(GRANT, fetchImpl);
    expect(mailbox).toBeNull();
    expect(errors).toHaveBeenCalledWith(PERSONAL_GRANT_REJECTED);
    expect(await receiptFor({ id: "0b1f3c2a-1111-4222-8333-944455556666", sent_at: NOW - 1e7 }, { mailbox, resend: async () => "delivered", now: NOW })).toBe("arrived");
  });

  it("the grant's four states: missing, ok, rejected (400/401, wrong scope), unreachable", async () => {
    expect(await personalGrant({ env: {} })).toEqual({ state: "missing" });
    expect(await personalGrant({ env: GRANT, fetchImpl: gmailWith() })).toEqual({ state: "ok", token: "tok" });
    expect((await personalGrant({ env: GRANT, fetchImpl: gmailWith(400) })).state).toBe("rejected");
    expect((await personalGrant({ env: GRANT, fetchImpl: gmailWith(401) })).state).toBe("rejected");
    expect((await personalGrant({ env: GRANT, fetchImpl: gmailWith(503) })).state).toBe("unreachable");
    const wide = (async () => json({ access_token: "tok", scope: `${READONLY} openid` })) as unknown as typeof fetch;
    expect((await personalGrant({ env: GRANT, fetchImpl: wide })).state).toBe("rejected");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await personalGrant({ env: GRANT, fetchImpl: down })).state).toBe("unreachable");
  });

  it("Toni: no grant or a rejected one reads through the connector; an ok grant reads Gmail directly", async () => {
    const rule = { days: 2, kinds: ["other"], instruction: "fixture" };
    const connectorScan = vi.fn(() => ({ notices: [], checkpoint: {}, count: 0, handled: 0, why: null, held: [], via: "connector" as const }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const state of ["missing", "rejected"] as const) {
      connectorScan.mockClear();
      const [box] = await readToniMail(rule, {}, NOW, { only: "personal", connectorScan, grantOf: async () => (state === "missing" ? { state } : { state, why: "x" }) });
      expect(connectorScan, state).toHaveBeenCalledTimes(1);
      expect(box?.via).toBe("connector");
    }
    connectorScan.mockClear();
    gmailWith();
    const [direct] = await readToniMail(rule, {}, NOW, { only: "personal", connectorScan, grantOf: async () => ({ state: "ok", token: "tok" }) });
    expect(connectorScan).not.toHaveBeenCalled();
    expect(direct?.via).toBeUndefined();
    expect(direct?.why).toBeNull();
  });

  it("the Ahrefs digest, run for real: a rejected grant exits 10, so the connector step reads that week", () => {
    const dir = mkdtempSync(join(tmpdir(), "ahrefs-grant-"));
    const stub = join(dir, "stub.mjs");
    writeFileSync(stub, `globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });`);
    const run = spawnSync(process.execPath, ["--import", stub, "scripts/ops/ahrefs-digest.mjs", "--out", join(dir, "digest.md")],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...GRANT }, timeout: 60_000 });
    expect(run.status).toBe(10);
    expect(run.stderr).toContain("TONI_PERSONAL_GMAIL_REJECTED");
  });

  it("the daily credential check reads a word only: MISSING, OK, REJECTED, UNKNOWN, and never an address", async () => {
    const probes = [
      await probePersonalGrant({ env: {} }),
      await probePersonalGrant({ env: GRANT, fetchImpl: gmailWith() }),
      await probePersonalGrant({ env: GRANT, fetchImpl: gmailWith(400) }),
      await probePersonalGrant({ env: { ...GRANT, BOSS_NOTIFY_TO: "someone.else@gmail.example" }, fetchImpl: gmailWith() }),
      await probePersonalGrant({ env: GRANT, fetchImpl: gmailWith(503) }),
    ];
    expect(probes.map((p) => [p.state, p.detail.split(":")[0]])).toEqual([
      ["dead", "MISSING"], ["live", "OK"], ["dead", "REJECTED"], ["dead", "REJECTED"], ["unknown", "UNKNOWN"],
    ]);
    for (const p of probes) {
      expect(p.id).toBe("cred_personal_gmail_grant");
      expect(p.detail).not.toContain("@");
    }
  });
});
