import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { DEFAULT_MAILBOX } from "../../src/shared/boss/commands/parse.mjs";
import { BROKERAGE_MAILBOX } from "../../src/worker/boss/wealth/gmailDraft";
import { OUTREACH_MAILBOX } from "../../src/worker/boss/outreach/catalog";
import { claimSimone, fileSimoneMessage } from "../../src/worker/boss/agents/simone";
import { simoneTool } from "../../src/worker/boss/agents/simoneTools";
import { connectSimoneGoogle, disconnectSimoneGoogle, enableSickDay, simoneAccountGate, simoneAccounts, startSimoneGoogle } from "../../src/worker/boss/agents/simoneAccounts";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { apiJson, stubFetch } from "./helpers";

const account = "fixture-owner@example.test";
const google = () => ({
  ...env,
  BOSS_SIMONE_GOOGLE_CLIENT_ID: "fixture-google-client",
  BOSS_SIMONE_GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  BOSS_OS_SECRET_HANDOFF_KEY: btoa("0123456789abcdef0123456789abcdef"),
});

it("binds OAuth consent to one owner session and gates every Google service before credential use", async () => {
  const scoped = google();
  const session = "fixture-session";
  const authorization = new URL(await startSimoneGoogle(scoped, session));
  const state = authorization.searchParams.get("state")!;
  const refresh = "fixture-google-refresh";
  const access = "fixture-google-access";
  const requests: string[] = [];
  let outage = false;
  let leaking = false;
  const restore = stubFetch(async (req) => {
    const url = new URL(req.url);
    requests.push(req.method + " " + url.hostname + url.pathname);
    expect(req.redirect).toBe("manual");
    if (url.pathname === "/token") {
      const form = new URLSearchParams(await req.text());
      if (form.get("grant_type") === "authorization_code") {
        const challenge = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier")!)));
        expect(authorization.searchParams.get("code_challenge")).toBe(btoa(String.fromCharCode(...challenge))
          .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"));
        return Response.json({ access_token: access, refresh_token: refresh, scope: authorization.searchParams.get("scope") });
      }
      expect(form.get("refresh_token")).toBe(refresh);
      return Response.json({ access_token: access });
    }
    if (url.pathname === "/v1/userinfo") return Response.json({ email_verified: true, email: account });
    if (url.pathname === "/revoke") {
      expect(new URLSearchParams(await req.text()).get("token")).toBe(refresh);
      return new Response(null, { status: outage ? 503 : 200 });
    }
    expect(req.headers.get("authorization")).toBe("Bearer " + access);
    return Response.json({ result: leaking ? access : "fixture", email: account });
  });
  try {
    await expect(connectSimoneGoogle(scoped, "different-session", state, "code")).rejects.toThrow("expired");
    expect(requests).toHaveLength(0);
    await connectSimoneGoogle(scoped, session, state, "code");
    await expect(connectSimoneGoogle(scoped, session, state, "code")).rejects.toThrow("expired");
    const active = await simoneAccountGate(scoped, account);
    if (active?.source !== "oauth") throw new Error("OAuth account missing");
    const vaultKey = `simone/google/${active.tokenRef}`;
    expect(await (await env.VAULT.get(vaultKey))!.text()).not.toContain(refresh);
    expect(JSON.stringify(await simoneAccounts(scoped))).not.toContain(active.tokenRef);

    await fileSimoneMessage(env, { source: "boss_page", subject: "Fixture", body: "Check my Google Workspace." });
    const lease = (await claimSimone(env))!;
    const read = (tool: string, path: string, extra = {}) => simoneTool(scoped, {
      ...lease, tool, task: JSON.stringify({ account, path, ...extra }),
    });
    const tools = { gmail: "messages", calendar: "calendars/primary/events", drive: "files", docs: "fixture-doc", sheets: "fixture-sheet/values/Sheet1!A1" };
    for (const [service, path] of Object.entries(tools)) {
      await expect(read(service, path)).resolves.toMatchObject({ ok: true, receipt: service, evidence: expect.stringContaining("fixture") });
    }
    leaking = true;
    await expect(read("gmail", "profile")).resolves.toEqual({ ok: false, code: "SECRET_OUTPUT" });
    leaking = false;

    const start = requests.length;
    await expect(read("gmail", "messages/batchDelete", { method: "POST" })).resolves.toEqual({ ok: false, code: "GOOGLE_OPERATION_RESTRICTED" });
    await expect(read("drive", "files/../about")).resolves.toEqual({ ok: false, code: "GOOGLE_REQUEST_REQUIRED" });
    await expect(apiJson("/api/simone/accounts/switch", { method: "POST", body: { address: account, enabled: false } }))
      .resolves.toMatchObject({ status: 200 });
    for (const [service, path] of Object.entries(tools)) {
      await expect(read(service, path)).resolves.toEqual({ ok: false, code: "GOOGLE_ACCOUNT_OFF" });
    }
    expect(requests).toHaveLength(start);
    await expect(apiJson("/api/simone/accounts/switch", { method: "POST", body: { address: account, enabled: true } }))
      .resolves.toMatchObject({ status: 200 });
    expect(await simoneAccountGate(scoped, account)).toEqual(active);

    outage = true;
    await expect(disconnectSimoneGoogle(scoped, account)).rejects.toThrow("revocation is pending");
    expect(await simoneAccountGate(scoped, account)).toBeNull();
    expect(await env.VAULT.head(vaultKey)).not.toBeNull();
    outage = false;
    await disconnectSimoneGoogle(scoped, account);
    expect(await env.VAULT.head(vaultKey)).toBeNull();
    expect(await simoneAccounts(scoped)).not.toContainEqual(expect.objectContaining({ address: account }));
  } finally {
    restore();
  }
});

it("refuses legacy Google calls after an owner switches them off and refuses the generic settings back door", async () => {
  await apiJson("/api/simone/accounts/switch", { method: "POST", body: { address: OUTREACH_MAILBOX, enabled: false } });
  await fileSimoneMessage(env, { source: "boss_page", subject: "Fixture", body: "Find a date in my mail." });
  const call = (await claimSimone(env))!;
  expect(await simoneTool(env, { ...call, tool: "search_workspace_mail", task: "subject:review" }))
    .toEqual({ ok: false, code: "GOOGLE_ACCOUNT_OFF" });
  expect(await apiJson("/api/system/settings/simone_google:until:fixture", { method: "PUT", body: { value: "9999999999999" } }))
    .toMatchObject({ status: 400 });
});

it("accepts temporary access only from direct, authenticated owner mail and expires it without a job", async () => {
  const owner = "owner@example.test";
  const scoped = { ...env, BOSS_EXTRA_OWNER_SENDERS: owner, AI: undefined };
  const checked = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass";
  const words = `cover ${DEFAULT_MAILBOX}`;
  function deliver(body: string, from = owner, subject = "Boss OS", authentication = checked) {
    const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
    return handleBossInboundMail({ from, to: "simone@example.test", raw: new Response(raw).body!, rawSize: raw.length,
      headers: new Headers({ from, subject, "authentication-results": authentication }) }, scoped);
  }
  await expect(simoneAccountGate(scoped, DEFAULT_MAILBOX)).resolves.toBeNull();
  expect((await deliver(words, "peer@example.test")).outcome).not.toBe("OWNER_GOOGLE_ACCESS");
  expect((await deliver(`> ${words}`)).outcome).not.toBe("OWNER_GOOGLE_ACCESS");
  expect((await deliver(words, owner, "Fwd: Boss OS")).outcome).not.toBe("OWNER_GOOGLE_ACCESS");
  expect((await deliver(words, owner, "Boss OS", "mx.cloudflare.net; spf=pass; dmarc=pass")).outcome).not.toBe("OWNER_GOOGLE_ACCESS");
  await expect(simoneAccountGate(scoped, DEFAULT_MAILBOX)).resolves.toBeNull();
  await expect(deliver(words)).resolves.toMatchObject({ outcome: "OWNER_GOOGLE_ACCESS" });
  const temporary = (await simoneAccounts(scoped)).find(({ address }) => address === DEFAULT_MAILBOX)!;
  expect(temporary.enabled).toBe(true);
  await expect(simoneAccountGate(scoped, DEFAULT_MAILBOX, temporary.until!)).resolves.toBeNull();
});

it("delegates an enabled brokerage Gmail read to the Mac without a Worker provider call", async () => {
  await fileSimoneMessage(env, { source: "boss_page", subject: "Fixture", body: "Check the brokerage inbox." });
  const call = (await claimSimone(env))!;
  const request = { ...call, tool: "gmail", task: JSON.stringify({ account: BROKERAGE_MAILBOX, path: "messages", query: { q: "newer_than:1d" } }) };
  const attempts: string[] = [];
  const restore = stubFetch((req) => { attempts.push(req.url); throw new Error("Worker provider call"); });
  try {
    await expect(simoneTool(env, request)).resolves.toEqual({ ok: false, code: "GOOGLE_ACCOUNT_OFF" });
    const now = Date.now();
    await enableSickDay(env, { address: BROKERAGE_MAILBOX, until: now + 3_600_000 }, now);
    await expect(simoneTool(env, request)).resolves.toEqual({
      ok: true, brokerageRead: "/gmail/v1/users/me/messages?q=newer_than%3A1d",
    });
    expect(attempts).toEqual([]);
  } finally {
    restore();
  }
});
