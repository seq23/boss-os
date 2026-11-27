import { DEFAULT_MAILBOX, WORKSPACE_MAILBOXES } from "../../../shared/boss/commands/parse.mjs";
import { INVITE_INBOXES } from "../../../shared/boss/invitations/invitations.mjs";
import { BOSS_ORIGIN } from "../../../shared/boss/research/page.mjs";
import type { Env } from "../env";
import { AppError } from "../lib/http";
import { sha256Hex } from "../lib/id";
import { operatingStopped } from "../lib/operatingStop";
import { BROKERAGE_MAILBOX } from "../wealth/gmailDraft";
import { decryptSecret, encryptSecret, secretDoorConfigured } from "../service/secretHandoff";

export const GOOGLE_ACCOUNT_PREFIX = "simone_google:";
const ACCOUNT = GOOGLE_ACCOUNT_PREFIX + "account:";
const SICK_DAY = GOOGLE_ACCOUNT_PREFIX + "until:";
const FLOW = GOOGLE_ACCOUNT_PREFIX + "flow:";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const DAY = 86_400_000;
const REDIRECT = BOSS_ORIGIN + "/api/boss/simone/accounts/callback";
const RESTRICTED = INVITE_INBOXES.filter(({ address, writable }) => address === DEFAULT_MAILBOX || !writable)
  .map(({ address }) => address);
const SCOPES = ["openid", "email", ...["gmail.readonly", "calendar.readonly", "drive.readonly"]
  .map((scope) => "https://www.googleapis.com/auth/" + scope)];

function canonicalAddress(value: unknown) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value.toLowerCase() : null;
}

type GoogleAccount = { address: string; enabled: boolean; tokenRef?: string; disconnecting?: boolean };
const accountKey = async (address: string) => ACCOUNT + await sha256Hex(address);
const vaultKey = (id: string) => `simone/google/${id}`;
const delegated = (address: string) => WORKSPACE_MAILBOXES.includes(address) || RESTRICTED.includes(address);

async function setting<T>(db: D1Database, key: string) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : null;
}

export async function simoneAccountGate(env: Env, address: string | null, now = Date.now()) {
  if (!address || await operatingStopped(env.DB)) return null;
  const stored = await setting<GoogleAccount>(env.DB, await accountKey(address));
  if (stored && (!stored.enabled || stored.disconnecting)) return null;
  if (RESTRICTED.includes(address)) {
    const until = await setting<number>(env.DB, SICK_DAY + address);
    if (!Number.isSafeInteger(until) || until! <= now) return null;
  }
  if (stored?.tokenRef) return { source: "oauth", tokenRef: stored.tokenRef } as const;
  if (delegated(address)) return { source: "delegation" } as const;
  if (address === canonicalAddress(env.BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT)) return { source: "personal" } as const;
  return null;
}

export async function simoneAccounts(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare("SELECT value FROM settings WHERE key >= ? AND key < ?")
    .bind(ACCOUNT, ACCOUNT + "~").all<{ value: string }>();
  const known = new Map<string, GoogleAccount>();
  const personal = canonicalAddress(env.BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT);
  for (const address of [...new Set([...WORKSPACE_MAILBOXES, ...RESTRICTED, ...(personal ? [personal] : [])])]) {
    known.set(address, { address, enabled: true });
  }
  for (const { value } of results) {
    const entry = JSON.parse(value) as GoogleAccount;
    known.set(entry.address, entry);
  }
  return Promise.all([...known.values()].map(async ({ address, enabled, tokenRef, disconnecting }) => {
    const restricted = RESTRICTED.includes(address);
    const until = restricted ? await setting<number>(env.DB, SICK_DAY + address) : null;
    return {
      address, enabled: enabled && !disconnecting && (!restricted || (until ?? 0) > now),
      until: enabled && (until ?? 0) > now ? until : null,
      restricted, disconnecting: disconnecting === true, canDisconnect: Boolean(tokenRef),
    };
  }));
}

export async function switchSimoneAccount(env: Env, value: unknown, enabled: boolean, now = Date.now()) {
  const address = canonicalAddress(value);
  if (!address) throw new AppError(400, "Choose a Google account.");
  if (enabled && RESTRICTED.includes(address)) throw new AppError(403, "Use your authenticated email to start temporary access.");
  const key = await accountKey(address);
  const known = delegated(address) || address === canonicalAddress(env.BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT);
  const result = known
    ? await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = json_set(settings.value, '$.enabled', json(?)), updated_at = excluded.updated_at
      WHERE json_extract(settings.value, '$.disconnecting') IS NOT 1`)
      .bind(key, JSON.stringify({ address, enabled }), now, JSON.stringify(enabled)).run()
    : await env.DB.prepare(`UPDATE settings SET value = json_set(value, '$.enabled', json(?)), updated_at = ?
      WHERE key = ? AND json_type(value, '$.tokenRef') = 'text' AND json_extract(value, '$.disconnecting') IS NOT 1`)
      .bind(JSON.stringify(enabled), now, key).run();
  if (!result.meta.changes) throw new AppError(409, "This Google account is not connected.");
}

export function simoneSickDayCommand(words: string, now: number) {
  const match = /^cover (\S+?)(?: until (\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)))?$/i.exec(words.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const address = RESTRICTED.find((known) => known === name || known.split("@")[1] === name);
  if (!address) return null;
  const until = match[2] ? Date.parse(match[2]) : now + 3 * DAY;
  return { address, until: until > now && until <= now + 7 * DAY ? until : null };
}

export async function enableSickDay(env: Env, { address, until }: { address: string; until: number }, now: number) {
  if (!RESTRICTED.includes(address) || !Number.isSafeInteger(until) || until <= now || until > now + 7 * DAY) {
    throw new AppError(400, "Choose a temporary access end time within seven days.");
  }
  const key = await accountKey(address);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.updated_at <= excluded.updated_at`)
      .bind(SICK_DAY + address, String(until), now),
    env.DB.prepare(`UPDATE settings SET value = json_set(value, '$.enabled', json('true')), updated_at = ?
      WHERE key = ? AND updated_at <= ?`).bind(now, key, now),
  ]);
}

async function googleConfig(env: Env) {
  if (!env.BOSS_SIMONE_GOOGLE_CLIENT_ID || !env.BOSS_SIMONE_GOOGLE_CLIENT_SECRET || !await secretDoorConfigured(env)) {
    throw new AppError(503, "Google account connection needs its OAuth client and vault key.");
  }
  return { client_id: env.BOSS_SIMONE_GOOGLE_CLIENT_ID, client_secret: env.BOSS_SIMONE_GOOGLE_CLIENT_SECRET };
}

export async function startSimoneGoogle(env: Env, session: string, now = Date.now()) {
  const { client_id } = await googleConfig(env);
  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const key = FLOW + await sha256Hex(session + ":" + state);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key >= ? AND key < ? AND updated_at < ?").bind(FLOW, FLOW + "~", now - 600_000),
    env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind(key, JSON.stringify({ verifier }), now),
  ]);
  const params = new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent select_account", state, code_challenge_method: "S256", code_challenge: challenge });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params;
}

type GoogleToken = { access_token?: string; refresh_token?: string; scope?: string; error?: string };

const googleFetch: typeof fetch = (url, init = {}) =>
  fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });

async function form(url: string, fields: Record<string, string>) {
  return googleFetch(url, { method: "POST", body: new URLSearchParams(fields) });
}

export async function connectSimoneGoogle(env: Env, session: string, state: string, code: string, now = Date.now()) {
  if (!/^[\da-f-]{36}$/.test(state) || !code || code.length > 2048) throw new AppError(400, "Google connection expired. Try again.");
  const config = await googleConfig(env);
  const key = FLOW + await sha256Hex(session + ":" + state);
  const pending = await env.DB.prepare("DELETE FROM settings WHERE key = ? AND updated_at >= ? RETURNING value")
    .bind(key, now - 600_000).first<{ value: string }>();
  if (!pending) throw new AppError(400, "Google connection expired. Try again.");
  const { verifier } = JSON.parse(pending.value) as { verifier: string };
  const exchanged = await form(TOKEN, { ...config, grant_type: "authorization_code", redirect_uri: REDIRECT, code, code_verifier: verifier });
  const token = exchanged.ok ? await exchanged.json<GoogleToken>() : null;
  if (!token?.access_token || !token.refresh_token) throw new AppError(502, "Google did not finish connecting this account.");
  const identity = await googleFetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + token.access_token },
  });
  const profile = identity.ok ? await identity.json<{ email?: string; email_verified?: boolean }>() : null;
  const address = profile?.email_verified === true ? canonicalAddress(profile.email) : null;
  if (!address) throw new AppError(502, "Google did not confirm the account address.");
  if (address === BROKERAGE_MAILBOX) throw new AppError(403, "The brokerage inbox uses Mac delegation.");
  const granted = new Set(token.scope?.split(" "));
  if (!SCOPES.slice(2).every((scope) => granted.has(scope))) throw new AppError(409, "Allow all five Google services to finish connecting.");
  const acct = await accountKey(address);
  const id = crypto.randomUUID();
  const encrypted = await encryptSecret(env, JSON.stringify({ address, token: token.refresh_token }));
  if (!encrypted) throw new AppError(503, "The Google token vault is unavailable.");
  await env.VAULT.put(vaultKey(id), JSON.stringify(encrypted));
  const inserted = await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = json_set(settings.value, '$.tokenRef', ?, '$.disconnecting', json('false')),
      updated_at = excluded.updated_at WHERE json_extract(settings.value, '$.tokenRef') IS NULL`)
    .bind(acct, JSON.stringify({ address, enabled: true, tokenRef: id }), now, id).run();
  if (!inserted.meta.changes) {
    await env.VAULT.delete(vaultKey(id));
    throw new AppError(409, "This Google account already has an OAuth connection.");
  }
}

async function refreshToken(env: Env, address: string, id: string) {
  const obj = await env.VAULT.get(vaultKey(id));
  if (!obj) return null;
  const stored = await decryptSecret(env, await obj.json<{ ciphertext: string; iv: string }>());
  if (!stored) throw new AppError(503, "The Google token vault is unavailable.");
  const value = JSON.parse(stored) as { address: string; token: string };
  if (value.address !== address || !value.token) throw new AppError(503, "The Google token vault is unavailable.");
  return value.token;
}

async function oauthAccess(env: Env, address: string, ref: string) {
  const config = await googleConfig(env);
  const token = await refreshToken(env, address, ref);
  if (!token) return null;
  const response = await form(TOKEN, { ...config, grant_type: "refresh_token", refresh_token: token });
  const access = response.ok ? (await response.json<GoogleToken>()).access_token : null;
  return access ? { access, refresh: token } : null;
}

export async function disconnectSimoneGoogle(env: Env, value: unknown, now = Date.now()) {
  const address = canonicalAddress(value);
  if (!address) throw new AppError(400, "Choose a Google account.");
  const key = await accountKey(address);
  const record = await env.DB.prepare(`UPDATE settings SET value = json_set(value, '$.enabled', json('false'),
    '$.disconnecting', json('true')), updated_at = ? WHERE key = ? AND json_type(value, '$.tokenRef') = 'text'
    RETURNING value`).bind(now, key).first<{ value: string }>();
  if (!record) throw new AppError(409, "This Google account has no OAuth connection.");
  const { tokenRef } = JSON.parse(record.value) as Required<GoogleAccount>;
  const token = await refreshToken(env, address, tokenRef);
  if (token) {
    const result = await form(REVOKE, { token }).catch(() => null);
    if (!result || (!result.ok && (result.status !== 400 || (await result.json<GoogleToken>().catch(() => null))?.error !== "invalid_token"))) {
      throw new AppError(502, "Google revocation is pending. Access is off. Retry Disconnect.");
    }
    await env.VAULT.delete(vaultKey(tokenRef));
  }
  if (delegated(address) || address === canonicalAddress(env.BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT)) {
    await env.DB.prepare(`UPDATE settings SET value = json_remove(value, '$.tokenRef', '$.disconnecting')
      WHERE key = ? AND json_extract(value, '$.tokenRef') = ?`).bind(key, tokenRef).run();
  } else {
    await env.DB.prepare(`DELETE FROM settings WHERE key = ? AND json_extract(value, '$.tokenRef') = ?`).bind(key, tokenRef).run();
  }
}

const WORKSPACE_APIS = {
  gmail: ["https://gmail.googleapis.com", "/gmail/v1/users/me/"],
  calendar: ["https://www.googleapis.com", "/calendar/v3/"],
  drive: ["https://www.googleapis.com", "/drive/v3/"],
  docs: ["https://docs.googleapis.com", "/v1/documents/"],
  sheets: ["https://sheets.googleapis.com", "/v4/spreadsheets/"],
} as const;

async function delegatedAccess(env: Env, address: string, service: keyof typeof WORKSPACE_APIS) {
  if (service === "calendar") {
    const { calendarFor } = await import("../commands/google");
    const result = await calendarFor(env, address);
    return result.ok ? result.token : null;
  }
  if (service === "gmail") {
    const { serviceAccountFrom } = await import("../wealth/gmailDraft");
    const { readToken } = await import("../invitations/run");
    const creds = serviceAccountFrom(env);
    return creds ? readToken(creds, address, googleFetch) : null;
  }
  if (address !== DEFAULT_MAILBOX) return null;
  const { driveToken } = await import("../intake/readFiles");
  return driveToken(env, googleFetch);
}

export async function simoneWorkspace(env: Env, service: keyof typeof WORKSPACE_APIS, task: unknown, now: number) {
  const refusal = (code: string) => ({ ok: false, code } as const);
  if (typeof task !== "string" || task.length > 8_192) return refusal("GOOGLE_REQUEST_REQUIRED");
  let args: { account?: unknown; path?: unknown; query?: unknown; method?: unknown };
  try { args = JSON.parse(task); } catch { return refusal("GOOGLE_REQUEST_REQUIRED"); }
  const address = canonicalAddress(args?.account);
  const path = args?.path;
  if (!address || typeof path !== "string" || path.length > 512 ||
      /[\x00-\x1F\x7F#?%\\]/.test(path) ||
      path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      Object.keys(args).some((key) => !["account", "path", "query", "method"].includes(key))) {
    return refusal("GOOGLE_REQUEST_REQUIRED");
  }
  if (args.method !== undefined && args.method !== "GET") return refusal("GOOGLE_OPERATION_RESTRICTED");
  if ((service === "gmail" && !/^(?:profile|labels|messages|threads|history|drafts)(?:\/|$)/.test(path)) ||
      (service === "calendar" && !/^(?:calendars|users\/me\/(?:calendarList|settings))(?:\/|$)/.test(path)) ||
      (service === "drive" && !/^(?:about|files|changes|drives)(?:\/|$)/.test(path))) {
    return refusal("GOOGLE_OPERATION_RESTRICTED");
  }
  const [origin, base] = WORKSPACE_APIS[service];
  const url = new URL(origin + base + path);
  if (args.query !== undefined) {
    if (!args.query || typeof args.query !== "object" || Array.isArray(args.query)) return refusal("GOOGLE_REQUEST_REQUIRED");
    for (const [key, value] of Object.entries(args.query)) {
      if (!/^[\w.]+$/.test(key) || /^(?:access_token|oauth_token|key|quotaUser)$/i.test(key)) {
        return refusal("GOOGLE_REQUEST_REQUIRED");
      }
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
          return refusal("GOOGLE_REQUEST_REQUIRED");
        }
        url.searchParams.append(key, String(item));
      }
    }
  }
  try {
    const account = await simoneAccountGate(env, address, now);
    if (!account) return refusal("GOOGLE_ACCOUNT_OFF");
    if (address === BROKERAGE_MAILBOX) {
      return service === "gmail"
        ? { ok: true, brokerageRead: url.pathname + url.search } as const
        : refusal("BROKERAGE_MAC_READ_REQUIRED");
    }
    if (account.source === "personal") return refusal("GOOGLE_OAUTH_CONNECTION_REQUIRED");
    const oauth = account.source === "oauth" ? await oauthAccess(env, address, account.tokenRef) : null;
    const access = account.source === "delegation" ? await delegatedAccess(env, address, service) : oauth?.access;
    if (!access) return refusal("GOOGLE_SIGN_IN_UNAVAILABLE");
    const current = await simoneAccountGate(env, address);
    if (current?.source !== account.source || (current.source === "oauth" && current.tokenRef !== account.tokenRef)) {
      return refusal("GOOGLE_ACCOUNT_OFF");
    }
    const response = await googleFetch(url, { headers: { Authorization: "Bearer " + access } });
    if (!response.ok || !response.body) return refusal("GOOGLE_COULD_NOT_CHECK");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 240_000) {
        await reader.cancel();
        return refusal("GOOGLE_NARROW_THE_READ");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const after = await simoneAccountGate(env, address);
    if (after?.source !== account.source || (after.source === "oauth" && after.tokenRef !== account.tokenRef)) {
      return refusal("GOOGLE_ACCOUNT_OFF");
    }
    if (text.includes(access) || (oauth && text.includes(oauth.refresh))) return refusal("SECRET_OUTPUT");
    return { ok: true, receipt: service, evidence: text } as const;
  } catch {
    return refusal("GOOGLE_COULD_NOT_CHECK");
  }
}
