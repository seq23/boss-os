#!/usr/bin/env node
/**
 * HER PERSONAL GMAIL, READ-ONLY, IN ONE SIGN-IN (owner, 28 Nov 2026: "yes do this also now").
 *
 *   cd ~/GitHub/boss-os && npm run gmail:grant
 *
 * Toni's billing and lock checks, Danielle's Ahrefs digest and the arrival check on every email the
 * team sends her read her personal Gmail through `TONI_GMAIL_CLIENT_ID`, `TONI_GMAIL_CLIENT_SECRET`
 * and `TONI_GMAIL_REFRESH_TOKEN` (scripts/ops/lib/toni-mail.mjs `personalToken`). Until those exist
 * they read "couldn't check". This makes them with Google's installed-app loopback flow:
 *
 *   1. a one-shot server on 127.0.0.1 (a random port; never another interface), with PKCE (S256)
 *      and a random `state` it checks before it takes a code;
 *   2. her browser opens Google's consent page asking for ONE scope, gmail.readonly, offline;
 *   3. the code is exchanged, and the grant is refused unless Google granted exactly gmail.readonly,
 *      the account is the one in the vault's `BOSS_NOTIFY_TO` (her personal Gmail; the repo is public,
 *      so the address is never written here), and the refresh works the way Toni's jobs use it;
 *   4. only then are the three keys saved, in ONE vault write (`vault.mjs set-many`, stdin, never argv).
 *
 * The OAuth client: a Desktop-type client already in the vault (`RCLONE_MAC_BACKUP_OAUTH_CLIENT_*`,
 * the one rclone and the Blogger poster use; Google accepted a random 127.0.0.1 port for it on
 * 28 Nov 2026), or the saved `TONI_GMAIL_CLIENT_*` on a second run (after a password change).
 *
 * A RE-RUN REPLACES A WORKING GRANT ONLY AFTER THE NEW ONE HAS PASSED every check above; until the one
 * vault write, the old keys stay as they were.
 *
 * NOTHING IS REVOKED: not a refused grant, not the old one a re-run replaces. Google's revoke ends the
 * client's whole grant on that account, and this client also holds the nightly Drive backups of three
 * accounts (rclone remotes gdrive, gdrive-sl, gdrive-cc, read 28 Nov 2026), so a revoke here would stop
 * them and the new grant with them. An unused refresh token simply goes unused (Google keeps at most
 * 100 per account and client and retires the oldest); she can remove any at myaccount.google.com/permissions.
 *
 * No token, code, secret or address is ever printed or logged; the pages the browser lands on hold
 * none either, load nothing from elsewhere and send no referrer.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { gmailProfile, ownerGmail, personalToken } from "./lib/toni-mail.mjs";

export const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const VAULT = fileURLToPath(new URL("../vault/vault.mjs", import.meta.url));
const AGAIN = "Run `npm run gmail:grant` again.";
const NOTHING_SAVED = "Nothing was saved.";

/** A refusal with a name. Its message never holds a token, code, secret or address. */
export class GrantStop extends Error {
  constructor(code, message) {
    super(`NAMED STOP [${code}] ${message}`);
    this.code = code;
  }
}

const CONSOLE_CLIENT_STEPS = [
  "No Desktop sign-in app is in the vault. Make one (about two minutes, free):",
  "  1. console.cloud.google.com, signed in as your personal Gmail; pick (or create) a project.",
  "  2. APIs & Services → Library → Gmail API → Enable.",
  "  3. APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Desktop app → Create.",
  "  4. Save its two values (each asks with hidden input): npm run vault:set TONI_GMAIL_CLIENT_ID, then npm run vault:set TONI_GMAIL_CLIENT_SECRET.",
  `  5. ${AGAIN}`,
].join("\n");

/** The OAuth client: the grant's own on a re-run, else the Desktop client already in the vault. */
export function pickClient(env = process.env) {
  for (const [prefix, source] of [["TONI_GMAIL_CLIENT", "TONI_GMAIL_CLIENT_*"], ["RCLONE_MAC_BACKUP_OAUTH_CLIENT", "RCLONE_MAC_BACKUP_OAUTH_CLIENT_*"]]) {
    const id = String(env[`${prefix}_ID`] ?? "").trim();
    const secret = String(env[`${prefix}_SECRET`] ?? "").trim();
    if (id && secret) return { id, secret, source };
  }
  throw new GrantStop("NO_DESKTOP_CLIENT", CONSOLE_CLIENT_STEPS);
}

/**
 * Her personal Gmail address, from the vault's BOSS_NOTIFY_TO: the mailbox her team's mail is sent to,
 * which is exactly the mailbox the arrival check searches. Checked before the browser opens.
 */
export function ownerAddress(env = process.env) {
  const address = ownerGmail(env);
  if (!address) {
    throw new GrantStop("NO_OWNER_ADDRESS", "BOSS_NOTIFY_TO (your personal Gmail) is not in the vault, so the sign-in cannot be checked. Run this through the vault: `npm run gmail:grant`.");
  }
  return address;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Google's consent page for this one grant: gmail.readonly only, offline, consent shown every time. */
export function authUrl({ clientId, redirectUri, state, challenge, hint }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: READONLY,
    access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256",
  });
  if (hint) q.set("login_hint", hint);
  return `${AUTH}?${q}`;
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

function page(res, status, title, line) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff",
    connection: "close",
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
    + `<style>:root{color-scheme:light dark}body{font:17px/1.5 -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px}</style>`
    + `<h1 style="font-size:1.3rem">${title}</h1><p>${line}</p></html>`);
}

/**
 * The one-shot loopback server. Listens on 127.0.0.1 only, at a port the system picks. A request
 * whose `state` is not this run's is answered 400 and ignored (a stray page cannot end or hijack
 * the sign-in). The first request with the right state ends it, and the server closes. No answer
 * in `timeoutMs` (the tab was closed) is a refusal.
 */
export function waitForCode({ state, timeoutMs = SIGN_IN_TIMEOUT_MS, onListening }) {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let done = false;
    const server = createServer((req, res) => {
      if (done) { res.writeHead(410).end(); return; }
      if (req.method !== "GET") { res.writeHead(405).end(); return; }
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }
      if (!sameText(url.searchParams.get("state"), state)) {
        page(res, 400, "Not this sign-in", "This page was not opened by the sign-in running in your Terminal. Nothing was saved.");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        page(res, 200, "Sign-in not finished", `Google did not give access. ${NOTHING_SAVED} You can close this tab.`);
        finish(new GrantStop("SIGN_IN_NOT_GIVEN", `Google sent back no access${/^[a-z_]{1,40}$/.test(error ?? "") ? ` (${error})` : ""}. ${NOTHING_SAVED} ${AGAIN}`));
        return;
      }
      page(res, 200, "Signed in", "You can close this tab and go back to the Terminal.");
      finish(null, { code, redirectUri });
    });
    const timer = setTimeout(() => finish(new GrantStop("NO_SIGN_IN",
      `No sign-in came back within ${Math.round(timeoutMs / 60_000) || 1} minute(s): the tab was closed or Google did not answer. ${NOTHING_SAVED} ${AGAIN}`)), timeoutMs);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections?.();
      if (error) reject(error); else resolve(value);
    }
    server.on("error", (e) => finish(new GrantStop("NO_LOCAL_PORT", `The sign-in could not listen on this Mac (${e.code ?? "error"}). ${NOTHING_SAVED}`)));
    server.listen(0, "127.0.0.1", async () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      try { await onListening?.(redirectUri, server); } catch (e) { finish(e); }
    });
  });
}

async function google(fetchImpl, url, init, what) {
  try {
    return await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GrantStop("GOOGLE_UNREACHABLE", `Google could not be reached ${what}. ${NOTHING_SAVED} ${AGAIN}`);
  }
}

async function jsonOf(response) {
  try { return await response.json(); } catch { return null; }
}

/** The code for tokens. Refused unless it is a refresh token for gmail.readonly and nothing else. */
export async function exchangeCode({ fetchImpl = fetch, client, code, verifier, redirectUri }) {
  const response = await google(fetchImpl, TOKEN, {
    method: "POST",
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  }, "to finish the sign-in");
  const body = await jsonOf(response);
  if (!response.ok) {
    const why = /^[a-z_]{1,40}$/.test(body?.error ?? "") ? ` (${body.error})` : "";
    throw new GrantStop("SIGN_IN_REFUSED", `Google refused the sign-in code (${response.status}${why}). ${NOTHING_SAVED} ${AGAIN}`);
  }
  const scopes = new Set(String(body?.scope ?? "").split(/\s+/).filter(Boolean));
  if (scopes.size !== 1 || !scopes.has(READONLY)) {
    const names = [...scopes].map((s) => s.replace("https://www.googleapis.com/auth/", "")).filter((s) => /^[\w.:/-]{1,80}$/.test(s));
    throw new GrantStop("NOT_READ_ONLY", [
      `Google granted ${names.length ? names.join(", ") : "no scope"} instead of read-only Gmail alone, and the team's jobs accept read-only Gmail only. ${NOTHING_SAVED}`,
      "If this repeats, give the grant a sign-in app of its own:", ...CONSOLE_CLIENT_STEPS.split("\n").slice(1),
    ].join("\n"));
  }
  if (typeof body.access_token !== "string" || !body.access_token || typeof body.refresh_token !== "string" || !body.refresh_token) {
    throw new GrantStop("NO_REFRESH_TOKEN", `Google gave no lasting access (no refresh token). ${NOTHING_SAVED} ${AGAIN}`);
  }
  return { access: body.access_token, refresh: body.refresh_token };
}

/** Which mailbox the token reads: Gmail's own read-only profile (emailAddress), lower-cased. */
export async function grantedAddress({ fetchImpl = fetch, access }) {
  let profile;
  try { profile = await gmailProfile(access, fetchImpl); } catch {
    throw new GrantStop("GOOGLE_UNREACHABLE", `Google could not be reached to read which account signed in. ${NOTHING_SAVED} ${AGAIN}`);
  }
  if (profile.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(JSON.stringify(profile.body ?? {}))) {
    throw new GrantStop("GMAIL_API_OFF", [
      `The Gmail API is turned off in the Google Cloud project that owns this sign-in app. ${NOTHING_SAVED}`,
      "  console.cloud.google.com, signed in as your personal Gmail → the project that holds the Desktop OAuth client → APIs & Services → Library → Gmail API → Enable.",
      `  Then ${AGAIN.toLowerCase()}`,
    ].join("\n"));
  }
  if (!profile.address) throw new GrantStop("PROFILE_UNREADABLE", `Gmail did not say which account signed in (${profile.status}). ${NOTHING_SAVED} ${AGAIN}`);
  return profile.address;
}

/** The vault's own writer: all keys in one write, the values on stdin (never argv, never printed). */
export function vaultSetMany(map, { vault = VAULT, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vault, "set-many"], { stdio: ["pipe", "ignore", "pipe"], env });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", () => reject(new GrantStop("VAULT_WRITE_FAILED", `The vault could not be started. ${NOTHING_SAVED}`)));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new GrantStop("VAULT_WRITE_FAILED", `The vault refused the write (${err.split("\n")[0].replace(/^VAULT GATE: /, "").slice(0, 200) || `exit ${code}`}); it saves all three keys or none. ${NOTHING_SAVED}`));
    });
    child.stdin.end(JSON.stringify(map));
  });
}

function openInBrowser(url) {
  return new Promise((resolve, reject) => {
    execFile("open", [url], (e) => (e ? reject(e) : resolve()));
  });
}

/**
 * The whole grant. Every dependency that leaves this process is injected, so the tests run it end
 * to end against a mocked Google and a real loopback server.
 */
export async function runGrant({
  env = process.env, fetchImpl = fetch, openBrowser = openInBrowser, save = vaultSetMany,
  say = (line) => console.log(line), timeoutMs = SIGN_IN_TIMEOUT_MS,
} = {}) {
  const client = pickClient(env);
  const owner = ownerAddress(env);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(24));

  say("Opening Google in your browser. Sign in with your personal Gmail and click Allow (read-only: nothing can be sent, changed or deleted).");
  say(`Waiting up to ${Math.round(timeoutMs / 60_000) || 1} minute(s) for the sign-in…`);
  const { code, redirectUri } = await waitForCode({
    state, timeoutMs,
    onListening: async (redirect) => {
      const url = authUrl({ clientId: client.id, redirectUri: redirect, state, challenge, hint: owner });
      try { await openBrowser(url); } catch { say(`Your browser did not open. Paste this into it:\n${url}`); }
    },
  });

  const tokens = await exchangeCode({ fetchImpl, client, code, verifier, redirectUri });
  const address = await grantedAddress({ fetchImpl, access: tokens.access });
  if (address !== owner) {
    throw new GrantStop("WRONG_ACCOUNT", `That sign-in was a different Google account, not your personal Gmail. ${NOTHING_SAVED} ${AGAIN} and choose your personal Gmail.`);
  }

  const keys = { TONI_GMAIL_CLIENT_ID: client.id, TONI_GMAIL_CLIENT_SECRET: client.secret, TONI_GMAIL_REFRESH_TOKEN: tokens.refresh };
  // The jobs' own path, before anything is saved: refresh it exactly as Toni's jobs will.
  try {
    await personalToken({ env: keys, fetchImpl });
  } catch {
    throw new GrantStop("GRANT_DID_NOT_REFRESH", `The new access did not renew the way the team's jobs use it. ${NOTHING_SAVED} ${AGAIN}`);
  }
  await save(keys);
  say(`Done. Your personal Gmail is connected read-only (vault: TONI_GMAIL_CLIENT_ID, TONI_GMAIL_CLIENT_SECRET, TONI_GMAIL_REFRESH_TOKEN; app: ${client.source}).`);
  say("A Google password change ends this access; run `npm run gmail:grant` again if that happens.");
  return { saved: Object.keys(keys) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runGrant().then(() => { process.exitCode = 0; }, (e) => {
    console.error(e instanceof GrantStop ? e.message : `NAMED STOP [GRANT_FAILED] The sign-in stopped unexpectedly. ${NOTHING_SAVED} ${AGAIN}`);
    process.exitCode = e instanceof GrantStop ? 2 : 1;
  });
}
