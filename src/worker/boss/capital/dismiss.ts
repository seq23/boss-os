/**
 * ─── DISMISSING A MATCH (owner, 25 Oct 2026) ─────────────────────────────────
 *
 * One table (`capital_dismissed`) that the Matches screen, Today and the morning email all read, and
 * three doors that write it: the Dismiss button on the trade's card in Boss OS, the one-tap link, and
 * her reply "dismiss <code>". A match is (pair, sig): the buyer and seller as parties, and both orders
 * as id and price. A dismissed pair never comes back while both orders stand; a new order from either
 * side — a new size or a new price is a new order — is a new sig, so it is a new match.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const DISMISS_CODE_RE = /^[a-hj-km-np-z2-9]{5}$/;
/** "dismiss k3m9q" anywhere at the start of a line of her reply. */
export const DISMISS_REPLY_RE = /(?:^|\n)\s*dismiss\s+([a-hj-km-np-z2-9]{5})\b/i;

function random(n: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export interface MatchRef { key?: string; pair: string; sig: string; company: string }
export const refKey = (pair: string, sig: string) => `${pair}#${sig}`;

/** Every dismissed (pair, sig), as `refKey`s. */
export async function dismissedSet(env: Env): Promise<Set<string>> {
  const r = await env.DB.prepare(`SELECT pair, sig FROM capital_dismissed`).all<{ pair: string; sig: string }>();
  return new Set((r.results ?? []).map((x) => refKey(x.pair, x.sig)));
}

/** The code and tap token for each match, minted once per (pair, sig) and kept. */
export async function tapsFor(env: Env, matches: MatchRef[], now = Date.now()): Promise<Map<string, { code: string; token: string }>> {
  const have = await env.DB.prepare(`SELECT pair, sig, code, token FROM capital_match_taps`).all<{ pair: string; sig: string; code: string; token: string }>();
  const out = new Map<string, { code: string; token: string }>();
  for (const t of have.results ?? []) out.set(refKey(t.pair, t.sig), { code: t.code, token: t.token });
  const stmts: D1PreparedStatement[] = [];
  const codes = new Set([...out.values()].map((v) => v.code));
  for (const m of matches) {
    if (!m?.pair || !m?.sig) continue;
    const k = refKey(m.pair, m.sig);
    if (out.has(k)) continue;
    let code = random(5, CODE_ALPHABET);
    while (codes.has(code)) code = random(5, CODE_ALPHABET);
    codes.add(code);
    const token = random(24, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
    out.set(k, { code, token });
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO capital_match_taps (code, token, pair, sig, company, created_at) VALUES (?,?,?,?,?,?)`)
      .bind(code, token, m.pair.slice(0, 400), m.sig.slice(0, 400), String(m.company).slice(0, 120), now));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return out;
}

export async function tapByCode(env: Env, code: string) {
  if (!DISMISS_CODE_RE.test(code)) return null;
  return env.DB.prepare(`SELECT * FROM capital_match_taps WHERE code = ?`).bind(code).first<{ code: string; token: string; pair: string; sig: string; company: string }>();
}
export async function tapByToken(env: Env, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return env.DB.prepare(`SELECT * FROM capital_match_taps WHERE token = ?`).bind(token).first<{ code: string; token: string; pair: string; sig: string; company: string }>();
}

/** Dismiss one match. Idempotent: a second dismissal of the same pair and orders changes nothing. */
export async function dismissMatch(env: Env, ref: MatchRef & { code?: string | null }, via: "screen" | "tap" | "reply" | "owner_session", now = Date.now()): Promise<{ dismissed: boolean; company: string }> {
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO capital_dismissed (pair, sig, company, code, via, dismissed_at) VALUES (?,?,?,?,?,?)`)
    .bind(ref.pair, ref.sig, ref.company, ref.code ?? null, via, now).run();
  const dismissed = Boolean(r.meta?.changes);
  if (dismissed) await audit(env.DB, { actor: "owner", lane: "ops", entityType: "capital_match", entityId: ref.pair.slice(0, 200), action: "dismissed", detail: { company: ref.company, via, code: ref.code ?? null } });
  return { dismissed, company: ref.company };
}

/**
 * The morning as kept, minus what she has since dismissed: any object carrying `match_pair` and
 * `match_sig` that is dismissed leaves the list it sits in, wherever it sits. So Today and each item
 * screen agree with the Matches screen the moment she dismisses.
 */
export function pruneDismissed<T>(value: T, dismissed: Set<string>): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === "object" && typeof x.match_pair === "string" && dismissed.has(refKey(x.match_pair, String(x.match_sig ?? ""))))).map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return dismissed.size ? walk(value) : value;
}

/** Her reply "dismiss <code>": the answer the mailbox records, or null when the reply is not one. */
export async function dismissFromMail(env: Env, text: string, now = Date.now()): Promise<{ note: string } | null> {
  const m = DISMISS_REPLY_RE.exec(String(text ?? ""));
  if (!m) return null;
  const code = m[1]!.toLowerCase();
  const tap = await tapByCode(env, code);
  if (!tap) return { note: `No match has the code ${code}, so nothing was dismissed. The five letters are on the trade's card in Boss OS.` };
  const r = await dismissMatch(env, { pair: tap.pair, sig: tap.sig, company: tap.company, code }, "reply", now);
  return { note: r.dismissed ? `Dismissed the ${tap.company} match (${code}). It will not come back unless one side sends a new order.` : `The ${tap.company} match (${code}) was already dismissed.` };
}
