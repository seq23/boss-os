/**
 * THE BUFFER DRIFT GUARD (owner, 18 Nov 2026: "we need to make sure we have a table of all accounts and
 * which buffers they are in"). The Accounts map's Buffer rows (buffer-*) say which channels sit in which
 * Buffer; this reads every Buffer's live channels, one GraphQL query per vault key (read-only), and names
 * every difference. Runs weekly inside the Sunday cohesion check (scripts/brains/cohesion-check.mjs
 * runMapChecks, under vault:run so the keys are in the environment); `npm run buffer:check` by hand.
 * RULE 0: a key that could not be read is a problem by name, and zero channels read in all is a NAMED STOP.
 */
import { isBufferRow } from "../../../src/shared/boss/maps/chain.mjs";

export const API = "https://api.buffer.com";
const key = (c) => `${String(c.platform).toLowerCase()} ${String(c.handle).toLowerCase()}`;

/** vault key → the channels the map says it holds. A multi-key row (the four creators) expects none per key. */
export function expectedByKey(accounts) {
  const out = new Map();
  for (const a of (accounts?.rows ?? []).filter(isBufferRow)) {
    const keys = a.vault_keys ?? [];
    for (const k of keys) out.set(k, { account: a.id, channels: keys.length === 1 ? (a.channels ?? []) : (a.channels ?? []).filter((c) => c.key === k) });
  }
  return out;
}

/**
 * live: Map(vault key → { channels: [{platform, handle}] } | { error }). Returns { problems, stop, read }.
 * `stop` is set when nothing was read at all (no key, or zero channels across every Buffer).
 */
export function driftProblems(accounts, live) {
  const want = expectedByKey(accounts);
  const problems = [];
  if (!want.size) return { problems, read: 0, stop: "NAMED STOP [BUFFER_NOTHING_CHECKED] the Accounts map has no Buffer vault keys" };
  let read = 0;
  for (const [k, { account, channels }] of want) {
    const got = live.get(k);
    if (!got || got.error) { problems.push(`${account}: ${k} could not be read (${got?.error ?? "not in the environment"})`); continue; }
    read += got.channels.length;
    const have = new Set(got.channels.map(key)), map = new Set(channels.map(key));
    for (const c of channels) if (!have.has(key(c))) problems.push(`${account}: the map lists ${c.platform} ${c.handle}, but that Buffer does not hold it`);
    for (const c of got.channels) if (!map.has(key(c))) problems.push(`${account}: that Buffer holds ${c.platform} ${c.handle}, which the map does not list`);
  }
  const stop = read === 0 ? `NAMED STOP [BUFFER_NOTHING_READ] zero channels read from ${want.size} Buffer key(s); the check saw nothing` : null;
  return { problems, read, stop };
}

/** Read one Buffer's channels. Never throws; an unreadable key comes back as { error }. */
export async function readChannels(token, fetchImpl = fetch) {
  if (!token) return { error: "not in the environment" };
  const q = async (query, variables) => {
    const r = await fetchImpl(API, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new Error(String(j.errors[0]?.message ?? "error").slice(0, 80));
    return j.data;
  };
  try {
    const orgs = (await q("{ account { organizations { id } } }"))?.account?.organizations ?? [];
    if (!orgs.length) return { error: "no organization" };
    const channels = [];
    for (const o of orgs) {
      const d = await q("query($id: OrganizationId!) { channels(input: { organizationId: $id }) { service name } }", { id: o.id });
      for (const c of d?.channels ?? []) channels.push({ platform: c.service, handle: c.name });
    }
    return { channels };
  } catch (e) { return { error: String(e?.message ?? e).slice(0, 80) }; }
}

export async function runBufferCheck({ accounts, env = process.env, fetchImpl = fetch }) {
  const live = new Map();
  for (const k of expectedByKey(accounts).keys()) live.set(k, await readChannels(env[k], fetchImpl));
  const r = driftProblems(accounts, live);
  return { ...r, census: `${live.size} Buffer keys; ${[...live.values()].filter((v) => !v.error).length} read; ${r.read} channels live` };
}
