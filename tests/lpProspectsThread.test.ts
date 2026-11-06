import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { ADMIN_STEP, runVerdict, threadHeaders, token } from "../scripts/ops/lp-prospects.mjs";

// 4 Nov 2026: every follow-up since 11 Oct was held as "the thread is not in the mailbox" because the
// thread was read with the gmail.compose token (Google: 403 insufficientPermissions) and the error was
// swallowed. These pin the fixed path and the named stop.
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("a follow-up's thread lookup (4 Nov 2026)", () => {
  it("reads the last Message-ID and first Subject when Gmail answers", async () => {
    const r = await threadHeaders("tok", "t1", { fetchImpl: reply(200, { messages: [
      { payload: { headers: [{ name: "Subject", value: "Hello" }, { name: "Message-ID", value: "<a@x>" }] } },
      { payload: { headers: [{ name: "Message-Id", value: "<b@x>" }] } },
    ] }) });
    expect(r).toEqual({ messageId: "<b@x>", subject: "Hello" });
  });
  it("a refused read (403) is a NAMED STOP for the run with her admin step, never 'not in the mailbox'", async () => {
    const r: any = await threadHeaders("tok", "t1", { fetchImpl: reply(403, { error: { status: "PERMISSION_DENIED", errors: [{ reason: "insufficientPermissions" }] } }) });
    expect(r.stop).toMatch(/^NAMED STOP \[THREAD_READ_DENIED\]/);
    expect(r.stop).toContain("insufficientPermissions");
    expect(r.stop).toContain(ADMIN_STEP);
    expect(r.held).toBeUndefined();
  });
  it("a thread that really is gone (404) holds only that prospect", async () => {
    const r: any = await threadHeaders("tok", "t1", { fetchImpl: reply(404, {}) });
    expect(r.held).toMatch(/not in .*404/);
    expect(r.stop).toBeUndefined();
  });
  it("any other failure is a NAMED STOP with the status", async () => {
    const r: any = await threadHeaders("tok", "t1", { fetchImpl: reply(500, {}) });
    expect(r.stop).toMatch(/^NAMED STOP \[THREAD_LOOKUP_FAILED\].*500/);
  });
});

describe("the read token asks for gmail.readonly on the West Peek mailbox", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = { GSC_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sa@example.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }) };
  const claimsOf = (body: URLSearchParams) => JSON.parse(Buffer.from(String(body.get("assertion")).split(".")[1], "base64url").toString());
  it("mints a token whose scope is gmail.readonly and whose sub is the mailbox", async () => {
    let claims: any = null;
    const t = await token("https://www.googleapis.com/auth/gmail.readonly", { env, fetchImpl: (async (_u: string, init: any) => { claims = claimsOf(init.body); return new Response(JSON.stringify({ access_token: "r" }), { status: 200 }); }) as any });
    expect(t).toBe("r");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(claims.sub).toBe("sequoia@westpeek.ventures");
  });
  it("a refused read grant is NAMED STOP [NO_READ_GRANT] with the exact admin console step", async () => {
    await expect(token("https://www.googleapis.com/auth/gmail.readonly", { env, fetchImpl: reply(401, { error: "unauthorized_client" }) as any }))
      .rejects.toThrow(/NAMED STOP \[NO_READ_GRANT\][\s\S]*Manage Domain Wide Delegation[\s\S]*gmail\.readonly/);
  });
});

describe("Rule 0: a live run with sends due never ends complete having sent none", () => {
  it("due and none sent is NAMED STOP [NOTHING_SENT] with the first reason", () => {
    const v = runVerdict({ due: 20, sent: 0, held: ["the thread is not in x (Gmail 404)"] });
    expect(v.stop).toMatch(/^NAMED STOP \[NOTHING_SENT\] 20 .*0 sent.*404/);
    expect(v.line).toMatch(/20 were due/);
  });
  it("a lookup stop passes through as the run's stop", () => {
    expect(runVerdict({ due: 3, sent: 0, stop: "NAMED STOP [THREAD_READ_DENIED] x" }).stop).toMatch(/THREAD_READ_DENIED/);
  });
  it("sends that went, or nothing due, are not a stop", () => {
    expect(runVerdict({ due: 3, sent: 3 }).stop).toBeNull();
    expect(runVerdict({ due: 0, sent: 0 }).stop).toBeNull();
  });
});
