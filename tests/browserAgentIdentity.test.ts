import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, disposeTestDb, makeTestEnv, type TestDb } from "./helpers/db";
import { handleRequest } from "../src/worker/index";
import { resolveFirmUser } from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import { ACCESS_TEAM_DOMAIN, setAccessKeySourceForTests, verifyAccessAssertion } from "../src/worker/accessJwt";
import { ACCESS_APP_AUDS } from "../src/worker/auth";

/**
 * Access identity on Boss OS, and the ways it must NOT work.
 *
 * This is the only principal in the system that is not a person, and it exists so the firm can look
 * at its own interfaces — every page sits behind Cloudflare Access, so a design reviewer who can
 * critique any founder's homepage could not open ours.
 *
 * It is an auth path, so what is asserted here is mostly what it CANNOT do. Every one of these
 * would be a real hole:
 *   * a wrong or absent client id resolving to anybody;
 *   * the agent outranking a signed-in partner;
 *   * the agent holding a role, which would make it an approver;
 *   * the agent reading privacy-sensitive material.
 */

let t: TestDb;
let env: Env;
const CLIENT_ID = "test-client-id.access";

/**
 * An Access assertion, the way Access actually delivers one: RS256-signed by a key the Worker
 * reads from the team's certs. Here the "team" is a key pair made for this file and handed to the
 * Worker through setAccessKeySourceForTests — the real certs are never fetched from a test.
 * Since 3 Nov 2026 the Worker VERIFIES the signature (src/worker/accessJwt.ts), so a forged or
 * unsigned assertion must resolve to nobody; those cases are below.
 */
const APP_AUD = "3ee619ef7997f1d25f57d7ffe87bb3f2f6b66b801c6a31937f8dc734b3189b63";
const KID = "test-kid";
let teamKey: CryptoKeyPair;
let strangerKey: CryptoKeyPair;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function assertion(
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; kid?: string; alg?: string } = {},
): Promise<string> {
  const head = `${b64json({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID })}.${b64json(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? teamKey.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

const base = () => ({ iss: ACCESS_TEAM_DOMAIN, aud: [APP_AUD], exp: Math.floor(Date.now() / 1000) + 3600 });
function agentJwt(commonName: string, over: Record<string, unknown> = {}, opts = {}): Promise<string> {
  return assertion({ ...base(), common_name: commonName, ...over }, opts);
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://test.local/api/me", { headers });
}

async function newKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  t = await createTestDb();
  // WP_OS_ENV is "local" in the test env, so the dev header is the human path here — the agent
  // path is deliberately independent of which human header is in use.
  env = makeTestEnv(t.db, { CF_ACCESS_CLIENT_ID: CLIENT_ID } as Partial<Env>);
  teamKey = await newKeyPair();
  strangerKey = await newKeyPair();
  const jwk = (await crypto.subtle.exportKey("jwk", teamKey.publicKey)) as JsonWebKey;
  setAccessKeySourceForTests(async () => [{ kid: KID, kty: "RSA", alg: "RS256", n: jwk.n, e: jwk.e }]);
});

afterAll(async () => {
  setAccessKeySourceForTests(null);
  await disposeTestDb(t);
});

/*
 * BOSS OS HAS NO ACCESS APPLICATION (3 Nov 2026). boss.sequoiataylor.com is not behind Cloudflare
 * Access — Boss OS's own routes carry their passcode session — and a measured probe showed
 * Cloudflare passes a client-supplied Cf-Access-Jwt-Assertion straight through to it. The aud this
 * Worker used to accept was West Peek OS's, and the signature was never checked, so a forged (or a
 * West Peek OS) assertion naming the browser-agent token resolved to an identity here. Now the
 * Worker accepts assertions only for its own Access applications — none — and only signed.
 */
describe("no Access assertion resolves to anyone on Boss OS", () => {
  it("accepts no Access application at all", () => {
    expect(ACCESS_APP_AUDS).toEqual([]);
  });

  it("refuses a correctly signed West Peek OS assertion for the browser-agent token", async () => {
    expect(await resolveFirmUser(req({ "Cf-Access-Jwt-Assertion": await agentJwt(CLIENT_ID) }), env)).toBeNull();
  });

  it("refuses a correctly signed West Peek OS assertion for a person", async () => {
    const human = req({ "Cf-Access-Jwt-Assertion": await assertion({ ...base(), email: "sequoia@westpeek.ventures" }) });
    expect(await resolveFirmUser(human, env)).toBeNull();
  });

  it("refuses an unsigned assertion (what the old decode-only code accepted)", async () => {
    const [h, c] = (await agentJwt(CLIENT_ID)).split(".");
    expect(await resolveFirmUser(req({ "Cf-Access-Jwt-Assertion": `${h}.${c}.not-a-real-signature` }), env)).toBeNull();
  });

  it("in production reads no identity header", async () => {
    const prod = makeTestEnv(t.db, { WP_OS_ENV: "production", CF_ACCESS_CLIENT_ID: CLIENT_ID } as Partial<Env>);
    expect(await resolveFirmUser(req({ "Cf-Access-Authenticated-User-Email": "sequoia@westpeek.ventures" }), prod)).toBeNull();
    expect(await resolveFirmUser(req({ "x-wpos-dev-user": "sequoia@westpeek.ventures" }), prod)).toBeNull();
    expect(await resolveFirmUser(req({ "Cf-Access-Jwt-Assertion": await agentJwt(CLIENT_ID) }), prod)).toBeNull();
  });

  it("local dev keeps its dev header", async () => {
    expect((await resolveFirmUser(req({ "x-wpos-dev-user": "sequoia@westpeek.ventures" }), env))?.id).toBe("fu_sequoia_taylor");
  });

  it("the real /api/me answers 401 to a forged agent assertion", async () => {
    const [h, c] = (await agentJwt(CLIENT_ID)).split(".");
    const res = await handleRequest(req({ "Cf-Access-Jwt-Assertion": `${h}.${c}.forged` }), env);
    expect(res.status).toBe(401);
  });
});

describe("the verifier itself (shared with West Peek OS)", () => {
  const AUDS = [APP_AUD];
  it("accepts a team-signed assertion for a listed aud", async () => {
    expect((await verifyAccessAssertion(await agentJwt(CLIENT_ID), AUDS))?.common_name).toBe(CLIENT_ID);
  });
  it("refuses a bad signature, a stranger's key, another issuer, another aud, an expired one", async () => {
    const [h, c] = (await agentJwt(CLIENT_ID)).split(".");
    expect(await verifyAccessAssertion(`${h}.${c}.forged`, AUDS)).toBeNull();
    expect(await verifyAccessAssertion(await agentJwt(CLIENT_ID, {}, { key: strangerKey.privateKey }), AUDS)).toBeNull();
    expect(await verifyAccessAssertion(await agentJwt(CLIENT_ID, { iss: "https://evil.cloudflareaccess.com" }), AUDS)).toBeNull();
    expect(await verifyAccessAssertion(await agentJwt(CLIENT_ID, { aud: ["other"] }), AUDS)).toBeNull();
    expect(await verifyAccessAssertion(await agentJwt(CLIENT_ID, { exp: Math.floor(Date.now() / 1000) - 60 }), AUDS)).toBeNull();
    expect(await verifyAccessAssertion(await agentJwt(CLIENT_ID), [])).toBeNull();
  });
});
