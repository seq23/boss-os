/**
 * THE ONE PLACE OUTREACH TOUCHES GMAIL. It impersonates exactly one mailbox, `OUTREACH_MAILBOX`
 * (st@time-2-read.com, the Workspace that owns the business domains), and nothing else: the mailbox
 * is a constant here, never a parameter, so no caller can point it at spry.vc or West Peek.
 *
 * ─── Why this file may send when gmailDraft.ts may not ─────────────────────────
 * The owner chose fully automatic outreach for her side businesses on 9 Oct 2026 ("u do it all").
 * That is an explicit exception to "the green button makes a draft", which still governs every
 * client and brokerage email. `scripts/validate/spry-vc-never-sends.mjs` names this file as the
 * second and last exception and holds it to: the pinned mailbox, compose and readonly scopes only,
 * no forbidden domain anywhere in it, and `assertSenderAllowed` before every send.
 *
 * Reading is narrow on purpose: only messages in threads outreach started, and bounce notices. A
 * message in that mailbox that belongs to no outreach thread is never fetched.
 */
import type { Env } from "../env";
import { serviceAccountFrom, type ServiceAccount } from "../wealth/gmailDraft";
import { OUTREACH_MAILBOX, assertOutreachMailboxAllowed, assertSenderAllowed, type Business } from "./catalog";
import { base64url } from "./compose";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
const TIMEOUT_MS = 15_000;

const b64url = (bytes: ArrayBuffer | string): string => {
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

async function timed(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function mintToken(creds: ServiceAccount, scope: string, fetchImpl: typeof fetch): Promise<string> {
  // Never West Peek's Workspace (owner, 9 Oct 2026): refused before any key is used.
  assertOutreachMailboxAllowed(OUTREACH_MAILBOX);
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email,
    sub: OUTREACH_MAILBOX,
    scope,
    aud: TOKEN_ENDPOINT,
    iat,
    exp: iat + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(creds.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await timed(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google refused the token for ${OUTREACH_MAILBOX} (${res.status}): ${text.slice(0, 160)}`);
  const token = (JSON.parse(text) as { access_token?: string }).access_token;
  if (!token) throw new Error("Google's token response carried no access_token.");
  return token;
}

export class GmailSession {
  private tokens = new Map<string, string>();
  constructor(private creds: ServiceAccount, private fetchImpl: typeof fetch) {}

  static from(env: Env, fetchImpl: typeof fetch = fetch): GmailSession | null {
    const creds = serviceAccountFrom(env);
    return creds ? new GmailSession(creds, fetchImpl) : null;
  }

  private async token(scope: string): Promise<string> {
    let t = this.tokens.get(scope);
    if (!t) {
      t = await mintToken(this.creds, scope, this.fetchImpl);
      this.tokens.set(scope, t);
    }
    return t;
  }

  /** Send one composed message as the business. Refuses a sender outside the business's domain. */
  async send(business: Business, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
    assertSenderAllowed(business);
    if (!raw.includes(`<${business.sender}>`)) throw new Error(`Refused: the message is not From ${business.sender}.`);
    const token = await this.token(SCOPE_COMPOSE);
    const res = await timed(this.fetchImpl, `${GMAIL}/messages/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(threadId ? { raw: base64url(raw), threadId } : { raw: base64url(raw) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gmail refused the send (${res.status}): ${text.slice(0, 200)}`);
    const j = JSON.parse(text) as { id: string; threadId: string };
    return { id: j.id, threadId: j.threadId };
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.token(SCOPE_READ);
    const res = await timed(this.fetchImpl, `${GMAIL}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gmail read ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 160)}`);
    return JSON.parse(text) as T;
  }

  /** The addresses Gmail will send as without rewriting the From (primary, or accepted aliases). */
  async sendAsAddresses(): Promise<Set<string>> {
    const j = await this.get<{ sendAs?: { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[] }>(`/settings/sendAs`);
    return new Set((j.sendAs ?? [])
      .filter((s) => s.isPrimary || !s.verificationStatus || s.verificationStatus === "accepted")
      .map((s) => s.sendAsEmail.toLowerCase()));
  }

  private async header(id: string, name: string): Promise<string> {
    const j = await this.get<RawMessage>(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=${encodeURIComponent(name)}`);
    return j.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  /** The From on Gmail's Sent copy: proof the alias was honoured rather than rewritten. */
  fromOf(id: string): Promise<string> {
    return this.header(id, "From");
  }

  /** The RFC Message-ID, so follow-ups thread in the recipient's mail client too. */
  messageIdOf(id: string): Promise<string> {
    return this.header(id, "Message-ID");
  }

  /** Message ids and threads matching a search. Ids only — nothing is read here. */
  async list(q: string, max = 50): Promise<{ id: string; threadId: string }[]> {
    const j = await this.get<{ messages?: { id: string; threadId: string }[] }>(
      `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
    );
    return j.messages ?? [];
  }

  /** One message, headers and plain-text body. Called only for outreach threads and bounces. */
  async read(id: string): Promise<GmailMessage> {
    const j = await this.get<RawMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
    const headers: Record<string, string> = {};
    for (const h of j.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
    return {
      id: j.id,
      threadId: j.threadId,
      labelIds: j.labelIds ?? [],
      headers,
      body: plainText(j.payload),
      internalDate: Number(j.internalDate ?? Date.now()),
    };
  }
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  headers: Record<string, string>;
  body: string;
  internalDate: number;
}

interface RawPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: RawPart[];
}
interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: RawPart;
}

function decode(data: string): string {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    return decodeURIComponent(escape(bin));
  } catch {
    return "";
  }
}

function plainText(part: RawPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const t = plainText(p);
    if (t) return t;
  }
  if (part.mimeType?.startsWith("text/") && part.body?.data) return decode(part.body.data).replace(/<[^>]+>/g, " ");
  return "";
}

/** "Jane <jane@x.com>" → jane@x.com */
export function addressOf(raw: string): string {
  const m = /<([^>]+)>/.exec(raw ?? "");
  return ((m ? m[1] : raw) ?? "").trim().toLowerCase();
}
