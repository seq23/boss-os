/**
 * The single gate between the internet and the whole system.
 *
 * Three things hold it shut. The passcode is compared without leaking a timing
 * signal; guessing is rate limited per caller, because an unlimited guessing
 * endpoint in front of one short secret is not a gate; and every session is
 * bound to a fingerprint of `SESSION_SECRET`, so rotating that secret really
 * does end every session the way the deployment notes say it does.
 */

import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, Vars } from "./env";
import { newId, sha256Hex } from "./lib/id";
import { AppError } from "./lib/http";

const COOKIE = "boss_session";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — this is your own phone

/** How many wrong passcodes one caller gets, and how long the window lasts. */
export const MAX_UNLOCK_ATTEMPTS = 10;
export const UNLOCK_WINDOW_SECONDS = 15 * 60;

/** Constant-time-ish compare so a wrong passcode leaks no timing signal. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A short fingerprint of the signing secret, stored with every session.
 *
 * The secret itself never leaves this function. Rotating `SESSION_SECRET`
 * changes the fingerprint, every stored session stops matching, and the whole
 * fleet of sessions dies at once — which is the entire point of having a
 * rotatable secret and is what `DEPLOY.md` promises.
 */
export async function sessionFingerprint(env: Env): Promise<string> {
  return (await sha256Hex(`boss-os/session/v1:${env.SESSION_SECRET ?? ""}`)).slice(0, 32);
}

/**
 * Counts a failed unlock against the caller and throws once the window is
 * spent. Counters live in KV and expire on their own; nothing here writes to
 * the database, so an unauthenticated caller cannot make this endpoint do work
 * that costs anything.
 *
 * What this is and is not: KV is eventually consistent, so a caller firing
 * requests in parallel can land a few more guesses than the budget before the
 * count catches up. It turns unlimited guessing into bounded guessing, which is
 * the difference that matters against a passcode; it is not a precise counter,
 * and the real strength of the door is still the length of BOSS_PASSCODE.
 */
async function throttleKey(env: Env, caller: string): Promise<string> {
  return `unlock_fail:${(await sha256Hex(caller)).slice(0, 24)}`;
}

export async function assertUnlockAllowed(env: Env, caller: string): Promise<void> {
  const raw = await env.SESSIONS.get(await throttleKey(env, caller));
  const attempts = raw ? Number(raw) : 0;
  if (attempts >= MAX_UNLOCK_ATTEMPTS) {
    throw new AppError(
      429,
      "Too many wrong passcodes",
      `Locked for up to ${UNLOCK_WINDOW_SECONDS / 60} minutes. If this was not you, rotate BOSS_PASSCODE.`,
    );
  }
}

async function recordFailure(env: Env, caller: string): Promise<void> {
  const key = await throttleKey(env, caller);
  const raw = await env.SESSIONS.get(key);
  // A sliding window: each wrong guess restarts the clock, so someone who keeps
  // trying stays locked out, and someone who stops is forgiven on schedule.
  await env.SESSIONS.put(key, String((raw ? Number(raw) : 0) + 1), {
    expirationTtl: UNLOCK_WINDOW_SECONDS,
  });
}

async function clearFailures(env: Env, caller: string): Promise<void> {
  await env.SESSIONS.delete(await throttleKey(env, caller));
}

export async function signIn(env: Env, passcode: string, caller = "unknown"): Promise<string> {
  if (!env.BOSS_PASSCODE) {
    throw new AppError(500, "No passcode is configured", "Set BOSS_PASSCODE in .dev.vars or as a Worker secret.");
  }

  await assertUnlockAllowed(env, caller);

  if (!safeEqual(passcode, env.BOSS_PASSCODE)) {
    await recordFailure(env, caller);
    throw new AppError(401, "That passcode does not match");
  }

  await clearFailures(env, caller);

  const token = newId("ses") + newId("k").slice(2);
  await env.SESSIONS.put(
    `session:${token}`,
    JSON.stringify({ id: token, issuedAt: Date.now(), fp: await sessionFingerprint(env) }),
    { expirationTtl: TTL_SECONDS },
  );
  return token;
}

export function setSessionCookie(c: any, token: string) {
  const https = new URL(c.req.url).protocol === "https:";
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: https,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function signOut(c: any, env: Env) {
  const token = getCookie(c, COOKIE);
  if (token) await env.SESSIONS.delete(`session:${token}`);
  deleteCookie(c, COOKIE, { path: "/" });
}

/**
 * Reads a session token and returns the session it names, or null.
 *
 * A stored session whose fingerprint does not match the current
 * `SESSION_SECRET` is not a session: the secret it was issued under has been
 * rotated away, and the record left in KV is a leftover, not an authorisation.
 */
export async function readSession(
  env: Env,
  token: string | undefined,
): Promise<{ id: string; issuedAt: number } | null> {
  if (!token) return null;
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;

  let parsed: { id: string; issuedAt: number; fp?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed.fp !== (await sessionFingerprint(env))) {
    // Rotated out from under this session. Clear the leftover so a rotation
    // actually shrinks what is stored rather than leaving dead keys behind.
    await env.SESSIONS.delete(`session:${token}`);
    return null;
  }
  return { id: parsed.id, issuedAt: parsed.issuedAt };
}

/** Gate for every /api route except /api/auth/*. */
export const requireSession: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new AppError(401, "Locked");
  const session = await readSession(c.env, token);
  if (!session) throw new AppError(401, "Session expired");
  c.set("session", session);
  await next();
};
