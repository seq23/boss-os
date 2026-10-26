/**
 * THE CREDENTIALS ONLY THE WORKER HOLDS, PROVEN BY USING THEM.
 *
 * 26 Oct 2026, Today: "Nothing has ever checked The Anthropic key" and "… The OpenAI key", both HIGH.
 * Both backends were enabled on 17 Sep with their keys set as Worker secrets, and both alerts were
 * TRUE: `npm run credentials:check` runs on her Mac and probes what the vault and her Mac hold — the
 * service account, the calendars, the Gmail connector — and nothing on the Mac can see a Worker
 * secret. So the two probes had no prober at all; running the check could never clear them.
 *
 * Now the Worker probes its own. When the Mac's check reports (`POST /api/credentials/probe`), the
 * Worker calls each provider's model list with the secret it holds — a GET that costs nothing and
 * spends no tokens (agents never spend money) — and writes live, dead or unknown onto the row.
 * 401 is dead (the key is wrong or revoked); 403 is NOT dead (a real key without this permission),
 * so it is unknown with that said; a network failure is unknown.
 */

import type { Env } from "../env";
import { WIRING_BY_BACKEND, KEY_PROBES } from "../router/backends";

type SecretName = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";

/**
 * Each Worker-held credential, the backend whose host it is checked against, and the adapter's own
 * probe. The vendor hosts stay in router/backends.ts and the calls in the two adapters, the only
 * files allowed to reach a model provider (validate: no-direct-provider-calls).
 */
export const WORKER_PROBES: Record<string, { secret: SecretName; backendId: string; probe: (baseUrl: string, key: string) => Promise<number> }> = {
  cred_anthropic_key: { secret: "ANTHROPIC_API_KEY", backendId: "bk_anthropic", probe: (b, k) => KEY_PROBES.bk_anthropic!(b, k) },
  cred_openai_key: { secret: "OPENAI_API_KEY", backendId: "bk_openai", probe: (b, k) => KEY_PROBES.bk_openai!(b, k) },
};

export interface WorkerProbeResult { id: string; state: "live" | "dead" | "unknown"; detail: string }

/** Probe one Worker-held credential. Never returns or logs the key. */
export async function probeOne(env: Env, id: string): Promise<WorkerProbeResult | null> {
  const p = WORKER_PROBES[id];
  if (!p) return null;
  const key = (env as unknown as Record<string, string | undefined>)[p.secret];
  if (!key) return { id, state: "dead", detail: `${p.secret} is not set on the Worker, and the backend it unlocks is switched on.` };
  const baseUrl = WIRING_BY_BACKEND.get(p.backendId)?.baseUrl;
  if (!baseUrl) return { id, state: "unknown", detail: `No wiring for ${p.backendId}; nothing to check the key against.` };
  try {
    const status = await p.probe(baseUrl, key);
    const res = { ok: status >= 200 && status < 300, status };
    if (res.ok) return { id, state: "live", detail: "The provider's model list answered with this key (a free read, no tokens)." };
    if (res.status === 401) return { id, state: "dead", detail: "The provider refused the key (401): it is wrong or was revoked." };
    if (res.status === 403) return { id, state: "unknown", detail: "The provider answered 403: the key is real but may not list models, so it is not proven dead." };
    return { id, state: "unknown", detail: `The provider answered ${res.status}; asked again on the next check.` };
  } catch {
    return { id, state: "unknown", detail: "The provider could not be reached; asked again on the next check." };
  }
}

/**
 * Probe every Worker-held credential whose backend is switched ON, and write the answer. A probe whose
 * backend is off is a decision in force (0238) and is left alone.
 */
export async function probeWorkerCredentials(env: Env, now = Date.now()): Promise<WorkerProbeResult[]> {
  const ids = Object.keys(WORKER_PROBES);
  const rows = await env.DB
    .prepare(
      `SELECT p.id, b.status AS backend_status FROM credential_probes p
         LEFT JOIN execution_backends b ON b.id = p.backend_id
        WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<{ id: string; backend_status: string | null }>();
  const out: WorkerProbeResult[] = [];
  for (const r of rows.results ?? []) {
    if (r.backend_status !== "enabled") continue;
    const res = await probeOne(env, r.id);
    if (!res) continue;
    await env.DB
      .prepare(
        `UPDATE credential_probes
            SET state = ?, detail = ?, checked_at = ?,
                last_live_at = CASE WHEN ? = 'live' THEN ? ELSE last_live_at END,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(res.state, res.detail, now, res.state, now, now, res.id)
      .run();
    out.push(res);
  }
  return out;
}
