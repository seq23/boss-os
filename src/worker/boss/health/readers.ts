/**
 * THE WORKER-SIDE HEALTH READERS — uptime and Search Console, per grid property.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "Connect all the GSC and whatever else to measure the health and GitHub and all."
 *
 * ─── What this is, and what it is not ──────────────────────────────────────
 *
 * Two of the four readers in `src/shared/boss/propertyReaders.mjs` run HERE, inside the Worker,
 * because nothing about them needs her Mac: a GET to a public domain needs no credential, and the
 * Search Console read uses `GSC_SERVICE_ACCOUNT_JSON`, which the Worker has held since 19 Sep 2026.
 * The other two — GitHub and Cloudflare — run from `scripts/ops/grid-watch.mjs` on her Mac and
 * POST their readings to `/api/grid/health/readings`, because the credentials they need (her `gh`
 * login; `CLOUDFLARE_API_TOKEN`) are deliberately not in this Worker. The registry says which is
 * which and why; this file does not decide it.
 *
 * ─── Every property gets a row, every run ──────────────────────────────────
 *
 * A reader never skips a property. Where it cannot read — no domain recorded, no key bound, the
 * service account not a user on that Search Console property — it writes a `blocked` row carrying
 * the sentence, so the card prints the true reason rather than an empty box. RULE 0 at the end: a
 * run that wrote zero rows throws, which fails the duty by name on the roster.
 *
 * ─── Egress ────────────────────────────────────────────────────────────────
 *
 * `fetchImpl` is injected so tests hand in a fake and the scan in `no-unauthorized-effects.mjs`
 * names this file on its allowlist with the reason. Every request has a hard timeout; a probe that
 * hangs is itself a reading ("did not answer in 10 s") and must not hang the tick.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { GRID } from "../../../shared/boss/grid.mjs";
import { cannotReason, type Reader } from "../../../shared/boss/propertyReaders.mjs";

export type ReadingState = "ok" | "warn" | "blocked";

export interface Reading {
  property_key: string;
  reader: Reader;
  target: string;
  state: ReadingState;
  summary: string;
  numbers: Record<string, unknown>;
  evidence_url: string | null;
  error: string | null;
}

const PROBE_TIMEOUT_MS = 10_000;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GSC_SITES = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const GSC_QUERY = (site: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
/** Search Console publishes a day two to three days late; the window ends before the lag. */
const GSC_LAG_DAYS = 3;
const GSC_WINDOW_DAYS = 7;

/** One row per reading, in one batch. Returns how many were written. */
export async function recordReadings(db: D1Database, readings: Reading[], now: number): Promise<number> {
  if (readings.length === 0) return 0;
  await db.batch(
    readings.map((r) =>
      db.prepare(
        `INSERT INTO property_health_readings
           (id, property_key, reader, target, state, summary, numbers, evidence_url, error, read_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        newId("phr"), r.property_key, r.reader, r.target, r.state, r.summary,
        JSON.stringify(r.numbers ?? {}), r.evidence_url, r.error, now, now,
      ),
    ),
  );
  return readings.length;
}

/** The blocked row a property gets when the registry says this reader cannot reach it. */
function registryBlock(propertyKey: string, reader: Reader): Reading | null {
  const why = cannotReason(propertyKey, reader);
  if (!why) return null;
  return {
    property_key: propertyKey, reader, target: "—", state: "blocked",
    summary: why, numbers: {}, evidence_url: null, error: why,
  };
}

// ─── Uptime ──────────────────────────────────────────────────────────────────

async function probe(url: string, fetchImpl: typeof fetch): Promise<{ status: number | null; ms: number; final_url: string | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "user-agent": "boss-os-uptime/1 (+https://boss.sequoiataylor.com)" } });
    // Read and discard the body so the connection closes; cap the wait with the same timer.
    await res.arrayBuffer().catch(() => null);
    return { status: res.status, ms: Date.now() - started, final_url: res.url || url, error: null };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return { status: null, ms: Date.now() - started, final_url: null, error: aborted ? `did not answer in ${PROBE_TIMEOUT_MS / 1000} s` : (err as Error)?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A GET to every canonical domain in the grid. One row per domain; a property with none recorded
 * gets its registry sentence.
 */
export async function readUptime(fetchImpl: typeof fetch): Promise<Reading[]> {
  const out: Reading[] = [];
  for (const p of GRID) {
    const blocked = registryBlock(p.key, "uptime");
    if (blocked) { out.push(blocked); continue; }
    if (p.domains.length === 0) {
      out.push({ property_key: p.key, reader: "uptime", target: "—", state: "blocked", summary: "No canonical domain recorded for this property.", numbers: {}, evidence_url: null, error: "no domain recorded" });
      continue;
    }
    for (const domain of p.domains) {
      const url = `https://${domain}/`;
      const r = await probe(url, fetchImpl);
      const ok = r.status !== null && r.status >= 200 && r.status < 400;
      out.push({
        property_key: p.key, reader: "uptime", target: domain,
        state: ok ? "ok" : "warn",
        summary: r.status === null
          ? `${domain} did not answer: ${r.error}.`
          : `${domain} answered ${r.status} in ${r.ms} ms.`,
        numbers: { status: r.status, ms: r.ms, final_url: r.final_url },
        evidence_url: url,
        error: ok ? null : (r.error ?? `HTTP ${r.status}`),
      });
    }
  }
  return out;
}

// ─── Search Console ──────────────────────────────────────────────────────────

interface ServiceAccount { client_email: string; private_key: string }

function serviceAccountFrom(env: Env): ServiceAccount | null {
  const raw = env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.client_email !== "string" || typeof parsed?.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch { return null; }
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string): string => {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * A read-only Search Console token AS THE SERVICE ACCOUNT — no `sub`, no impersonation. Properties
 * are shared with the account directly, exactly as the spreadsheets are.
 */
export async function mintGscToken(creds: ServiceAccount, fetchImpl: typeof fetch, now = Date.now()):
  Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, scope: GSC_SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(creds.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(signature)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `token endpoint answered ${res.status}: ${text.slice(0, 200)}` };
    const token = (JSON.parse(text) as { access_token?: string }).access_token;
    return token ? { ok: true, token } : { ok: false, detail: "token response carried no access_token" };
  } catch (err) {
    return { ok: false, detail: (err as Error)?.message ?? String(err) };
  } finally { clearTimeout(timer); }
}

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Seven days of clicks and impressions per readable domain. A domain the service account is not a
 * user on is a blocked row that names the account — the sentence she needs to fix it.
 */
export async function readGsc(env: Env, fetchImpl: typeof fetch, now = Date.now()): Promise<Reading[]> {
  const out: Reading[] = [];
  const creds = serviceAccountFrom(env);
  const account = creds?.client_email ?? "the service account";

  let token: string | null = null;
  let blockedWhy: string | null = null;
  let readable = new Set<string>();
  if (!creds) {
    blockedWhy = "The Worker holds no Google service-account key (GSC_SERVICE_ACCOUNT_JSON is not bound). Run `npm run vault:sync:cloudflare`.";
  } else {
    const minted = await mintGscToken(creds, fetchImpl, now);
    if (!minted.ok) blockedWhy = `Search Console refused a token for ${account}: ${minted.detail}`;
    else {
      token = minted.token;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetchImpl(GSC_SITES, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        const json = (await res.json().catch(() => ({}))) as { siteEntry?: { siteUrl: string }[] };
        if (!res.ok) blockedWhy = `Search Console's site list answered ${res.status}.`;
        else readable = new Set((json.siteEntry ?? []).map((s) => s.siteUrl));
      } catch (err) {
        blockedWhy = `Search Console's site list did not answer: ${(err as Error)?.message ?? String(err)}`;
      } finally { clearTimeout(timer); }
    }
  }

  const end = dayStr(now - GSC_LAG_DAYS * 86_400_000);
  const start = dayStr(now - (GSC_LAG_DAYS + GSC_WINDOW_DAYS - 1) * 86_400_000);

  for (const p of GRID) {
    const blocked = registryBlock(p.key, "gsc");
    if (blocked) { out.push(blocked); continue; }
    if (p.domains.length === 0) {
      out.push({ property_key: p.key, reader: "gsc", target: "—", state: "blocked", summary: "No canonical domain recorded for this property.", numbers: {}, evidence_url: null, error: "no domain recorded" });
      continue;
    }
    for (const domain of p.domains) {
      const site = `sc-domain:${domain}`;
      const evidence = `https://search.google.com/search-console?resource_id=${encodeURIComponent(site)}`;
      if (blockedWhy || !token) {
        out.push({ property_key: p.key, reader: "gsc", target: domain, state: "blocked", summary: blockedWhy ?? "No token.", numbers: {}, evidence_url: evidence, error: blockedWhy ?? "no token" });
        continue;
      }
      if (!readable.has(site)) {
        const why = `${account} is not a user on this Search Console property (${site}). Add it as a user in Search Console and this reads next week.`;
        out.push({ property_key: p.key, reader: "gsc", target: domain, state: "blocked", summary: why, numbers: {}, evidence_url: evidence, error: "no_gsc_access" });
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetchImpl(GSC_QUERY(site), {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ startDate: start, endDate: end, dimensions: [], rowLimit: 1 }),
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({}))) as { rows?: { clicks: number; impressions: number; ctr: number; position: number }[] };
        if (!res.ok) {
          out.push({ property_key: p.key, reader: "gsc", target: domain, state: "blocked", summary: `Search Console answered ${res.status} for ${domain}.`, numbers: {}, evidence_url: evidence, error: `HTTP ${res.status}` });
          continue;
        }
        const row = json.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
        const clicks = Math.round(row.clicks ?? 0);
        const impressions = Math.round(row.impressions ?? 0);
        out.push({
          property_key: p.key, reader: "gsc", target: domain,
          state: impressions === 0 ? "warn" : "ok",
          summary: `${domain}: ${clicks} clicks from ${impressions} impressions, ${start} to ${end}${row.position ? `, average position ${Number(row.position).toFixed(1)}` : ""}.`,
          numbers: { clicks, impressions, ctr: row.ctr ?? 0, position: row.position ?? null, start, end },
          evidence_url: evidence,
          error: impressions === 0 ? "zero impressions in the window" : null,
        });
      } catch (err) {
        out.push({ property_key: p.key, reader: "gsc", target: domain, state: "blocked", summary: `Search Console did not answer for ${domain}: ${(err as Error)?.message ?? String(err)}`, numbers: {}, evidence_url: evidence, error: (err as Error)?.message ?? String(err) });
      } finally { clearTimeout(timer); }
    }
  }
  return out;
}

// ─── The duty entry point ────────────────────────────────────────────────────

export const WORKER_READERS: Record<string, (env: Env, fetchImpl: typeof fetch, now: number) => Promise<Reading[]>> = {
  uptime: (_env, fetchImpl) => readUptime(fetchImpl),
  gsc: (env, fetchImpl, now) => readGsc(env, fetchImpl, now),
};

/**
 * Run one Worker-executed duty's reader and write its rows. Called by `materialiseDueDuties` for a
 * duty with `executor = 'worker'`; the duty row records ok/failed from what happens here.
 *
 * RULE 0: zero rows written throws. The grid has properties, so a reader that produced nothing did
 * not read; that is a failure with a name, never a quiet day.
 */
export async function runWorkerReader(
  env: Env, readerName: string, now: number, fetchImpl: typeof fetch = fetch,
): Promise<{ reader: string; written: number; blocked: number; warn: number }> {
  const reader = WORKER_READERS[readerName];
  if (!reader) throw new Error(`No Worker reader is called "${readerName}". The registry names: ${Object.keys(WORKER_READERS).join(", ")}.`);
  if (GRID.length === 0) throw new Error("The grid is empty, so this reader examined nothing. src/shared/boss/grid.mjs is the list.");
  const readings = await reader(env, fetchImpl, now);
  const written = await recordReadings(env.DB, readings, now);
  if (written === 0) throw new Error(`Reader "${readerName}" wrote zero readings across ${GRID.length} properties. Not a quiet day — a reader that reads nothing is broken.`);
  const blocked = readings.filter((r) => r.state === "blocked").length;
  const warn = readings.filter((r) => r.state === "warn").length;
  await logEvent(env.DB, {
    level: blocked === readings.length ? "warn" : "info", scope: "duties", event: "property_reader_ran",
    entityId: readerName, detail: { written, blocked, warn, properties: GRID.length },
  }).catch(() => {});
  return { reader: readerName, written, blocked, warn };
}
