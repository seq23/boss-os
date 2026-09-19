import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { createDraftForOutreach, createGmailDraft, draftMime, BROKERAGE_MAILBOX } from "../../src/worker/boss/wealth/gmailDraft";

/**
 * THE GREEN BUTTON MAKES A DRAFT. NOTHING ON THIS PATH SENDS.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "it should never send — the green button should be to create the draft."
 *
 * Driven against a FAKE Gmail: a fetch that answers the token endpoint and `drafts.create`, and
 * records every URL it was asked for. The load-bearing assertion in every test is the one on that
 * record — no URL on this path ever names a send.
 */

const CAND = "src_gmail_test";

/** A throwaway RSA key, exported as the PEM a service-account JSON carries. */
async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ client_email: "gsc-bot@test.iam.gserviceaccount.com", private_key: pem, client_id: "109529914046573753934" });
}

/** A Gmail that creates drafts and remembers what it was asked. */
function fakeGmail(opts: { tokenStatus?: number; draftStatus?: number } = {}) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (opts.tokenStatus && opts.tokenStatus !== 200) return new Response(JSON.stringify({ error: "unauthorized_client" }), { status: opts.tokenStatus });
      return new Response(JSON.stringify({ access_token: "ya29.fake", expires_in: 3600 }), { status: 200 });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/drafts") {
      if (opts.draftStatus && opts.draftStatus !== 200) return new Response(JSON.stringify({ error: { code: opts.draftStatus, message: "Insufficient Permission" } }), { status: opts.draftStatus });
      return new Response(JSON.stringify({ id: "r7246198633093798718", message: { id: "1a0ba1769921afbd", labelIds: ["DRAFT"] } }), { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function seedApprovedLetter(): Promise<string> {
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM gmail_drafts`).run();
  await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE id = ?`).bind(CAND).run();
  await env.DB
    .prepare(
      `INSERT INTO sourcing_candidates (id, name, kind, source_url, source_name, read_at, origin, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(CAND, "Saints Capital", "buyer", "https://example.test/x", "their site", now, "public_research", "reviewed", now, now)
    .run();
  await apiJson(`/api/wealth/sourcing/${CAND}/status`, { method: "POST", body: { status: "reviewed" } });
  const d = await env.DB.prepare(`SELECT id, judgement_id FROM buyer_outreach_drafts`).first<{ id: string; judgement_id: string }>();
  const j = await env.DB.prepare(`SELECT approval_id FROM judgement_calls WHERE id = ?`).bind(d!.judgement_id).first<{ approval_id: string }>();
  // Her approval, through the real route. The harness has no key, so this records the named stop.
  await apiJson(`/api/approvals/${j!.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
  return d!.id;
}

describe("the green button creates a Gmail draft and never sends", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM gmail_drafts`).run();
  });

  it("creates the draft with the subject and body, records the id, and calls no send endpoint", async () => {
    const outreachId = await seedApprovedLetter();
    const key = await fakeServiceAccount();
    const gmail = fakeGmail();

    const out = await createDraftForOutreach({ ...env, GSC_SERVICE_ACCOUNT_JSON: key } as any, outreachId, gmail.fetchImpl);
    expect(out.state).toBe("created");
    expect(out.gmail_draft_id).toBe("r7246198633093798718");
    expect(out.gmail_message_id).toBe("1a0ba1769921afbd");
    expect(out.detail).toContain("In your Gmail drafts");
    expect(out.detail).toContain(BROKERAGE_MAILBOX);

    // Exactly two calls: a token, and drafts.create. NEITHER IS A SEND.
    expect(gmail.calls).toHaveLength(2);
    expect(gmail.calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(gmail.calls[1]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    for (const c of gmail.calls) expect(c.url).not.toMatch(/send/i);

    // The token asked for compose as HER mailbox, and nothing wider.
    const assertion = new URLSearchParams(gmail.calls[0]!.body!).get("assertion")!;
    const claims = JSON.parse(atob(assertion.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.sub).toBe(BROKERAGE_MAILBOX);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/gmail.compose");

    // The draft carried the letter — subject and body — and no From line.
    const raw = JSON.parse(gmail.calls[1]!.body!).message.raw as string;
    const mime = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const letter = await env.DB.prepare(`SELECT subject, body FROM buyer_outreach_drafts WHERE id = ?`).bind(outreachId).first<any>();
    expect(mime).toContain(`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(letter.subject)))}?=`);
    expect(mime).toContain(btoa(unescape(encodeURIComponent(letter.body))));
    expect(mime).not.toMatch(/^From:/m);

    // Recorded, and readable from the desk.
    const row = await env.DB.prepare(`SELECT * FROM gmail_drafts WHERE outreach_draft_id = ? AND state = 'created'`).bind(outreachId).first<any>();
    expect(row.gmail_draft_id).toBe("r7246198633093798718");
    expect(row.mailbox).toBe(BROKERAGE_MAILBOX);
    const desk = await apiJson<any>("/api/wealth/outreach");
    expect(desk.body.data.approved[0].gmail.state).toBe("created");
    expect(desk.body.data.approved[0].gmail.gmail_draft_id).toBe("r7246198633093798718");
  });

  it("a second press does not make a second draft in her mailbox", async () => {
    const outreachId = await seedApprovedLetter();
    const key = await fakeServiceAccount();
    const gmail = fakeGmail();
    const fakeEnv = { ...env, GSC_SERVICE_ACCOUNT_JSON: key } as any;
    await createDraftForOutreach(fakeEnv, outreachId, gmail.fetchImpl);
    const again = await createDraftForOutreach(fakeEnv, outreachId, gmail.fetchImpl);
    expect(again.already).toBe(true);
    expect(again.gmail_draft_id).toBe("r7246198633093798718");
    expect(gmail.calls).toHaveLength(2); // still the first press's two
  });

  it("a 403 from Google is the NAMED STOP 'waiting for the gmail.compose grant', not a bug", async () => {
    const outreachId = await seedApprovedLetter();
    const key = await fakeServiceAccount();
    const gmail = fakeGmail({ draftStatus: 403 });
    const out = await createDraftForOutreach({ ...env, GSC_SERVICE_ACCOUNT_JSON: key } as any, outreachId, gmail.fetchImpl);
    expect(out.state).toBe("blocked");
    expect(out.failure_code).toBe("grant_missing");
    expect(out.detail).toContain("gmail.compose grant");
    const row = await env.DB.prepare(`SELECT state, failure_code FROM gmail_drafts WHERE outreach_draft_id = ? ORDER BY updated_at DESC LIMIT 1`).bind(outreachId).first<any>();
    expect(row.state).toBe("blocked");
    expect(row.failure_code).toBe("grant_missing");
    for (const c of gmail.calls) expect(c.url).not.toMatch(/send/i);
  });

  it("a refused token (delegation absent) is the same named stop", async () => {
    const key = await fakeServiceAccount();
    const gmail = fakeGmail({ tokenStatus: 401 });
    const out = await createGmailDraft({ ...env, GSC_SERVICE_ACCOUNT_JSON: key } as any, { subject: "s", body: "b" }, gmail.fetchImpl);
    expect(out.state).toBe("blocked");
    expect(out.failure_code).toBe("grant_missing");
    expect(gmail.calls).toHaveLength(1);
  });

  it("no Worker key is a named stop that names the fix", async () => {
    const gmail = fakeGmail();
    const out = await createGmailDraft({ ...env, GSC_SERVICE_ACCOUNT_JSON: undefined } as any, { subject: "s", body: "b" }, gmail.fetchImpl);
    expect(out.state).toBe("blocked");
    expect(out.failure_code).toBe("no_worker_key");
    expect(out.detail).toContain("vault:sync:cloudflare");
    expect(gmail.calls).toHaveLength(0);
  });

  it("refuses to draft a letter she has not approved — her approval is the authorization", async () => {
    const now = Date.now();
    await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
    await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE id = ?`).bind(CAND).run();
    await env.DB
      .prepare(`INSERT INTO sourcing_candidates (id, name, kind, source_url, source_name, read_at, origin, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(CAND, "Saints Capital", "buyer", "https://example.test/x", "their site", now, "public_research", "reviewed", now, now)
      .run();
    await apiJson(`/api/wealth/sourcing/${CAND}/status`, { method: "POST", body: { status: "reviewed" } });
    const d = await env.DB.prepare(`SELECT id, state FROM buyer_outreach_drafts`).first<any>();
    expect(d.state).toBe("awaiting");

    const key = await fakeServiceAccount();
    const gmail = fakeGmail();
    await expect(createDraftForOutreach({ ...env, GSC_SERVICE_ACCOUNT_JSON: key } as any, d.id, gmail.fetchImpl)).rejects.toThrow(/Only an approved letter/);
    expect(gmail.calls).toHaveLength(0);
    const res = await apiJson<any>(`/api/wealth/outreach/${d.id}/gmail-draft`, { method: "POST", body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Only an approved letter");
  });

  it("the MIME never carries a From line — Gmail sets the sender from the mailbox", () => {
    const mime = draftMime("Late-stage secondaries — Saints Capital", "Body\n\nMore");
    expect(mime).not.toMatch(/^From:/m);
    expect(mime).not.toMatch(/^To:/m);
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?/m);
  });
});
