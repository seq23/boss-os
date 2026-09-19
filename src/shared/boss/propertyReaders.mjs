/**
 * WHICH HEALTH READER REACHES WHICH GRID PROPERTY — and, where one cannot, WHY, by name.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "Connect all the GSC and whatever else to measure the health and GitHub and all."
 *
 * ─── Four readers, one registry, and no blank cells ─────────────────────────
 *
 * The four readers are a FIXED set. Every grid property is crossed with every reader, and each cell
 * is one of exactly two things: WIRED (a code path writes a `property_health_readings` row for it)
 * or CANNOT with a sentence that says why. A cell that is merely absent is the defect this file
 * exists to prevent — "exists but nothing invokes it" wearing the shape of a dashboard with a gap in
 * it — and `scripts/validate/every-property-has-its-readers.mjs` fails the build on one.
 *
 * ─── Where each reader runs, and why that is not a preference ──────────────
 *
 *   uptime      WORKER. A GET to a public domain needs no credential. Runs from a standing duty
 *               with `executor = 'worker'` (0263) on the hourly tick.
 *   gsc         WORKER. `GSC_SERVICE_ACCOUNT_JSON` has been synced to the Worker since 19 Sep 2026
 *               (see scripts/vault/cloudflare-mapping.json `synced_reasons`), and Search Console
 *               properties are shared with the service account directly — no impersonation. Weekly,
 *               because GSC lags two to three days and a daily number is yesterday's weather.
 *   github      HER MAC. The vault holds no GitHub token (checked 19 Sep 2026 — `gh` carries her own
 *               login on the Mac and nothing in the vault could be synced to the Worker), so the
 *               reader is `scripts/ops/grid-watch.mjs`, which already reads every grid repo daily
 *               and now ALSO posts a reading per repo to `POST /api/grid/health/readings`.
 *   cloudflare  HER MAC, same script. `CLOUDFLARE_API_TOKEN` is deliberately NOT synced to the
 *               Worker — it is the credential the sync authenticates WITH, and uploading it would put
 *               the key that can rewrite every secret inside the thing it rewrites. The Mac holds it
 *               through the vault, so the deployment state is read there and posted.
 *
 * ─── The property-level reasons a reader cannot reach ──────────────────────
 *
 * These are facts about the grid, not about the readers. A YouTube channel has no domain to GET and
 * no Search Console property; the wedding cluster's four domains are not recorded in the grid
 * because she has not named them, and the grid's own rule is that they are never invented; the
 * authority network is repositories and no site. Each is written out so the card says the true
 * sentence rather than an empty box.
 *
 * `.mjs` beside a `.d.mts` for the same reason `grid.mjs` is: the Worker, the Mac script and the
 * validator all have to mean the same thing by "wired".
 */

import { GRID } from "./grid.mjs";

/** The four readers, in the order the card shows them. Fixed; adding one is a decision. */
export const READERS = ["uptime", "github", "gsc", "cloudflare"];

/** Where each reader executes. `worker` runs from a standing duty; `mac` posts from grid-watch. */
export const READER_RUNS_ON = {
  uptime: "worker",
  gsc: "worker",
  github: "mac",
  cloudflare: "mac",
};

/**
 * Per-property reasons a reader cannot reach it. Anything not listed here is WIRED.
 *
 * Keyed by property key, then reader. The sentence is what the card prints.
 */
export const CANNOT = {
  youtube: {
    uptime: "No canonical domain recorded — this property is a YouTube channel handle (@howweknowdeep), not a site to probe.",
    gsc: "Not a website: a YouTube channel has no Search Console property.",
    cloudflare: "Nothing of this property is deployed on Cloudflare; the channel is hosted by YouTube.",
  },
  wedding: {
    uptime: "The four canonical domains are not recorded in the grid — she has not named them, and the grid never invents one.",
    gsc: "The four canonical domains are not recorded in the grid, so there is no Search Console property to read by name.",
    cloudflare: "The four canonical domains are not recorded in the grid, so no deployment can be matched to this property by name.",
  },
  authority_network: {
    uptime: "No canonical domain recorded — this is plumbing (two repositories), not a public site.",
    gsc: "No public site of its own, so no Search Console property.",
    cloudflare: "No public site of its own, so no deployment to read.",
  },
};

/**
 * The full registry: every property × every reader, as `{ property_key, reader, runs_on, wired, cannot }`.
 * Computed from the grid rather than hand-copied, so a property added to the grid appears here with
 * every reader WIRED until somebody writes down why one cannot be.
 */
export function readerRegistry() {
  const out = [];
  for (const p of GRID) {
    for (const reader of READERS) {
      const cannot = CANNOT[p.key]?.[reader] ?? null;
      out.push({ property_key: p.key, reader, runs_on: READER_RUNS_ON[reader], wired: cannot === null, cannot });
    }
  }
  return out;
}

/** The named reason a reader cannot reach a property, or null when it is wired. */
export function cannotReason(propertyKey, reader) {
  return CANNOT[propertyKey]?.[reader] ?? null;
}
