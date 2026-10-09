import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";

/**
 * THE GREEN BUTTON MAKES A DRAFT IN HER GMAIL. NOTHING HERE SENDS, AND NOTHING HERE CAN.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "it should never send — the green button should be to create the draft."
 *
 * So the primary action on a letter in her Inbox creates a draft in `staylor@spry.vc`, with the
 * subject and body filled, and she reads it once more in Gmail and presses Send there, herself.
 *
 * ─── How it reaches her mailbox ────────────────────────────────────────────
 *
 * The gsc-bot service account impersonates the mailbox under domain-wide delegation — the same
 * mechanism `scripts/ops/gmail-metadata.mjs` reads it with — under ONE scope, `gmail.compose`,
 * which the owner granted on client 109529914046573753934 the same day. Probed before this was
 * written: token minted, one draft created to herself, read back by id, deleted (204, then 404).
 *
 * ─── What is deliberately not here ─────────────────────────────────────────
 *
 *   · No `users.messages.send`, no `drafts.send`, no send transport of any kind. This file names
 *     exactly one Gmail endpoint and it creates a draft. `scripts/validate/the-inbox-draft-never-sends.mjs`
 *     fails the build if a send endpoint or a send scope appears anywhere on this path, and
 *     `spry-vc-never-sends.mjs` permits `gmail.compose` in THIS file alone.
 *   · No `From` header. Gmail sets the sender from the authenticated mailbox; writing one here
 *     would be a sender line, and the validator treats a sender line on spry.vc as a violation.
 *   · No recipient. `sourcing_candidates` holds public institutions and no addresses; the letter's
 *     `to_hint` names where the contact route is, and she puts the address in herself.
 *
 * ─── A missing key or grant is a NAMED STOP, not a bug ─────────────────────
 *
 * `blocked` with `failure_code = no_worker_key` means the Worker was deployed without
 * `GSC_SERVICE_ACCOUNT_JSON` (run `npm run vault:sync:cloudflare`). `grant_missing` means Google
 * answered 401/403 to the token or the draft call — the delegation for `gmail.compose` is absent or
 * has not propagated. Both are printed on the card in those words.
 */

/** The mailbox the draft is created in. Hers, at the broker-dealer; never a sender line here. */
export const BROKERAGE_MAILBOX = "staylor@spry.vc";

/** The one scope, and the one endpoint. Both constants, never read from a request. */
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRAFTS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const TIMEOUT_MS = 10_000;

export type GmailDraftState = "created" | "blocked" | "failed";

export interface GmailDraftOutcome {
  state: GmailDraftState;
  gmail_draft_id: string | null;
  gmail_message_id: string | null;
  failure_code: "no_worker_key" | "grant_missing" | "gmail_refused" | "unreachable" | null;
  failure_detail: string | null;
  /** One sentence for the card. */
  detail: string;
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/, "").replace(/-----END [A-Z ]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Read the service account out of the Worker secret. `null` when the Worker has no key at all. */
export function serviceAccountFrom(env: Env): ServiceAccount | null {
  const raw = env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.client_email !== "string" || typeof parsed?.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/**
 * A signed assertion for `gmail.compose` as the mailbox, exchanged for an access token.
 *
 * Written against WebCrypto rather than a library for the same reason the Mac scripts sign with
 * `node:crypto`: this touches her most confidential mailbox and a dependency here is a supply-chain
 * surface in the one place it matters most.
 */
export async function mintComposeToken(
  creds: ServiceAccount,
  mailbox: string,
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<{ ok: true; token: string } | { ok: false; status: number; detail: string }> {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email,
    // THE IMPERSONATION, NAMED. Without `sub` the service account acts as itself and has no mailbox.
    sub: mailbox,
    scope: COMPOSE_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat,
    exp: iat + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(creds.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 300) };
    const token = (JSON.parse(text) as { access_token?: string }).access_token;
    if (!token) return { ok: false, status: res.status, detail: "token response carried no access_token" };
    return { ok: true, token };
  } finally {
    clearTimeout(timer);
  }
}

/** RFC 5322, plain text, UTF-8. No From (Gmail sets it), no To (she puts the address in). */
export function draftMime(subject: string, body: string, to?: string | null): string {
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  return [
    // A To line only when the caller names one (an outreach reply to a business that wrote back).
    // The brokerage letters still carry none: she puts that address in herself.
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${encodedSubject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(body))),
  ].join("\r\n");
}

/**
 * Create the draft. Returns an outcome, never throws: every failure is a state the card can print.
 */
export async function createGmailDraft(
  env: Env,
  letter: { subject: string; body: string; to?: string | null },
  fetchImpl: typeof fetch = fetch,
  mailbox: string = BROKERAGE_MAILBOX,
): Promise<GmailDraftOutcome> {
  const creds = serviceAccountFrom(env);
  if (!creds) {
    return {
      state: "blocked", gmail_draft_id: null, gmail_message_id: null,
      failure_code: "no_worker_key",
      failure_detail: "GSC_SERVICE_ACCOUNT_JSON is not bound to this Worker.",
      detail: "Blocked: the Worker holds no Google key, so it cannot reach your Gmail. Run `npm run vault:sync:cloudflare` and press again. The letter is approved and on the desk.",
    };
  }

  let token: string;
  try {
    const minted = await mintComposeToken(creds, mailbox, fetchImpl);
    if (!minted.ok) {
      const grant = minted.status === 401 || minted.status === 403 || /unauthorized_client|invalid_grant|access_denied/i.test(minted.detail);
      return {
        state: grant ? "blocked" : "failed", gmail_draft_id: null, gmail_message_id: null,
        failure_code: grant ? "grant_missing" : "gmail_refused",
        failure_detail: `token ${minted.status}: ${minted.detail}`,
        detail: grant
          ? "Waiting for the gmail.compose grant: Google refused the token for ${mailbox}. The delegation for `https://www.googleapis.com/auth/gmail.compose` on client 109529914046573753934 is missing or has not propagated. The letter is approved and on the desk."
          : `Gmail refused the token (HTTP ${minted.status}). The letter is approved and on the desk; press "Create the draft" there to try again.`,
      };
    }
    token = minted.token;
  } catch (err) {
    return {
      state: "failed", gmail_draft_id: null, gmail_message_id: null,
      failure_code: "unreachable", failure_detail: (err as Error)?.message ?? String(err),
      detail: "Google could not be reached to mint a token. The letter is approved and on the desk; try again from there.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(DRAFTS_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw: b64url(draftMime(letter.subject, letter.body, letter.to)) } }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const grant = res.status === 401 || res.status === 403;
      return {
        state: grant ? "blocked" : "failed", gmail_draft_id: null, gmail_message_id: null,
        failure_code: grant ? "grant_missing" : "gmail_refused",
        failure_detail: `drafts.create ${res.status}: ${text.slice(0, 300)}`,
        detail: grant
          ? `Waiting for the gmail.compose grant: Gmail answered ${res.status} to the draft call for staylor@spry.vc. The letter is approved and on the desk.`
          : `Gmail refused the draft (HTTP ${res.status}). The letter is approved and on the desk; try again from there.`,
      };
    }
    const created = JSON.parse(text) as { id?: string; message?: { id?: string } };
    if (!created.id) {
      return {
        state: "failed", gmail_draft_id: null, gmail_message_id: null,
        failure_code: "gmail_refused", failure_detail: "drafts.create answered 200 with no draft id",
        detail: "Gmail answered without a draft id, so nothing can be shown as created. Try again from the desk.",
      };
    }
    return {
      state: "created", gmail_draft_id: created.id, gmail_message_id: created.message?.id ?? null,
      failure_code: null, failure_detail: null,
      detail: `In your Gmail drafts (${mailbox}). Open Gmail, read it once more, add the address, and send it yourself.`,
    };
  } catch (err) {
    return {
      state: "failed", gmail_draft_id: null, gmail_message_id: null,
      failure_code: "unreachable", failure_detail: (err as Error)?.message ?? String(err),
      detail: "Gmail could not be reached. The letter is approved and on the desk; try again from there.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create the draft for an APPROVED outreach letter and record the outcome on `gmail_drafts`.
 *
 * Her approval is the authorization: this refuses any letter that is not `approved`, so a draft can
 * never exist for a letter she has not said yes to. Idempotent on success — a letter that already
 * has a `created` row returns it rather than making a second draft in her mailbox.
 */
export async function createDraftForOutreach(
  env: Env,
  outreachDraftId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailDraftOutcome & { gmail_drafts_id: string; already: boolean }> {
  const letter = await env.DB
    .prepare(`SELECT id, candidate_id, subject, body, state FROM buyer_outreach_drafts WHERE id = ?`)
    .bind(outreachDraftId)
    .first<{ id: string; candidate_id: string; subject: string; body: string; state: string }>();
  if (!letter) throw new Error("No letter with that id");
  if (letter.state !== "approved" && letter.state !== "sent") {
    throw new Error(`Only an approved letter can go to your drafts; this one is ${letter.state}.`);
  }

  const existing = await env.DB
    .prepare(`SELECT id, gmail_draft_id, gmail_message_id FROM gmail_drafts WHERE outreach_draft_id = ? AND state = 'created' ORDER BY updated_at DESC LIMIT 1`)
    .bind(outreachDraftId)
    .first<{ id: string; gmail_draft_id: string; gmail_message_id: string | null }>();
  if (existing) {
    return {
      state: "created", gmail_draft_id: existing.gmail_draft_id, gmail_message_id: existing.gmail_message_id,
      failure_code: null, failure_detail: null,
      detail: `Already in your Gmail drafts (${BROKERAGE_MAILBOX}).`,
      gmail_drafts_id: existing.id, already: true,
    };
  }

  const now = Date.now();
  const id = newId("gmd");
  await env.DB
    .prepare(
      `INSERT INTO gmail_drafts (id, outreach_draft_id, candidate_id, mailbox, state, requested_at, updated_at)
       VALUES (?,?,?,?,'requested',?,?)`,
    )
    .bind(id, letter.id, letter.candidate_id, BROKERAGE_MAILBOX, now, now)
    .run();

  const outcome = await createGmailDraft(env, { subject: letter.subject, body: letter.body }, fetchImpl);
  const done = Date.now();
  await env.DB
    .prepare(
      `UPDATE gmail_drafts SET state = ?, gmail_draft_id = ?, gmail_message_id = ?, failure_code = ?, failure_detail = ?,
              created_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      outcome.state, outcome.gmail_draft_id, outcome.gmail_message_id, outcome.failure_code, outcome.failure_detail,
      outcome.state === "created" ? done : null, done, id,
    )
    .run();
  await audit(env.DB, {
    actor: "system", lane: "ops", entityType: "gmail_draft", entityId: id,
    action: outcome.state, detail: { outreach_draft_id: letter.id, failure_code: outcome.failure_code },
  });
  return { ...outcome, gmail_drafts_id: id, already: false };
}
