/**
 * THE HEALTH OF EVERY GRID PROPERTY, PER READER — read here, and written here by her Mac.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "Connect all the GSC and whatever else to measure the health and GitHub and all."
 *
 * ─── Two routes ────────────────────────────────────────────────────────────
 *
 *   GET  /            every property × every reader: the latest reading per target, its age, and
 *                     — where the registry says a reader cannot reach the property — the sentence
 *                     that says why. THE GRID ITSELF IS PART OF THE ANSWER: a card that shows three
 *                     readings cannot tell "healthy" from "never looked", and those are opposite
 *                     facts. Every cell is filled with a reading, a blocked reason, or the honest
 *                     "never read" with what would read it.
 *
 *   POST /readings    the two readers that run on her Mac — GitHub and Cloudflare — post their rows
 *                     here from `scripts/ops/grid-watch.mjs`. The property key is checked against
 *                     the grid and the reader against the registry, so this table cannot drift into
 *                     a second list of properties or a fifth reader nobody declared.
 *
 * Mounted at `/api/grid/health` inside the `=== Her jobs ===` block, ABOVE nothing: `/api/grid` is
 * a separate Hono app whose only routes are `/` and `/examination`, so `/health` cannot be
 * shadowed by it.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { audit } from "../lib/audit";
import { GRID, propertyFor } from "../../../shared/boss/grid.mjs";
import { READERS, readerRegistry } from "../../../shared/boss/propertyReaders.mjs";
import { recordReadings, type Reading, type ReadingState } from "../health/readers";

export const gridHealth = new Hono<{ Bindings: Env; Variables: Vars }>();

interface Latest {
  property_key: string; reader: string; target: string; state: ReadingState; summary: string;
  numbers: string; evidence_url: string | null; error: string | null; read_at: number;
}

/** What would produce a reading for a wired cell that has none yet — so "never read" says who. */
const NEVER_READ_HINT: Record<string, string> = {
  uptime: "Not read yet. The Worker probes every canonical domain at 06:00 America/Chicago (duty_property_uptime); run it now from Duties.",
  gsc: "Not read yet. The Worker reads Search Console on Monday at 07:00 America/Chicago (duty_property_gsc); run it now from Duties.",
  github: "Not read yet. Her Mac's grid watch (grid-watch.mjs, 06:20 daily) posts the GitHub reading when it next runs.",
  cloudflare: "Not read yet. Her Mac's grid watch (grid-watch.mjs, 06:20 daily) posts the Cloudflare reading when it next runs.",
};

gridHealth.get("/", async (c) => {
  /*
   * ONE STATEMENT. The latest row per (property, reader, target) via a correlated MAX; the table is
   * small (a few hundred rows a week) and the index makes the subquery cheap. One round trip is the
   * budget rule in STATUS.md, not the SQL.
   */
  const rows = await c.env.DB
    .prepare(
      `SELECT property_key, reader, target, state, summary, numbers, evidence_url, error, read_at
         FROM property_health_readings r
        WHERE read_at = (SELECT MAX(read_at) FROM property_health_readings x
                          WHERE x.property_key = r.property_key AND x.reader = r.reader AND x.target = r.target)
        ORDER BY property_key, reader, target`,
    )
    .all<Latest>();
  const latest = rows.results ?? [];
  const registry = readerRegistry();
  const now = Date.now();

  const properties = GRID.map((p) => ({
    key: p.key,
    label: p.label,
    domains: p.domains,
    repos: p.repos,
    owner: p.owner,
    tier: p.tier,
    readers: READERS.map((reader) => {
      const cell = registry.find((r) => r.property_key === p.key && r.reader === reader)!;
      const readings = latest
        .filter((l) => l.property_key === p.key && l.reader === reader)
        .map((l) => {
          let numbers: unknown = {};
          try { numbers = JSON.parse(l.numbers); } catch { numbers = {}; }
          return { target: l.target, state: l.state, summary: l.summary, numbers, evidence_url: l.evidence_url, error: l.error, read_at: l.read_at, age_ms: now - l.read_at };
        });
      const worst: ReadingState | "never" = readings.length === 0
        ? "never"
        : readings.some((r) => r.state === "blocked") ? "blocked"
          : readings.some((r) => r.state === "warn") ? "warn" : "ok";
      return {
        reader,
        runs_on: cell.runs_on,
        wired: cell.wired,
        cannot: cell.cannot,
        state: cell.wired ? worst : "cannot",
        never_read_hint: cell.wired && readings.length === 0 ? NEVER_READ_HINT[reader] ?? "Not read yet." : null,
        readings,
      };
    }),
  }));

  return ok(c, {
    readers: READERS,
    properties,
    // Counts up front, so the screen can say "9 of 12 properties read by every wired reader".
    totals: {
      properties: properties.length,
      cells: properties.length * READERS.length,
      wired: registry.filter((r) => r.wired).length,
      cannot: registry.filter((r) => !r.wired).length,
      read: properties.flatMap((p) => p.readers).filter((r) => r.wired && r.readings.length > 0).length,
    },
  });
});

/**
 * Readings posted from her Mac. Only the two `mac` readers are accepted here; the Worker's own two
 * write through `health/readers.ts` and never through a request, so a post cannot forge an uptime.
 */
gridHealth.post("/readings", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b || !Array.isArray(b.readings) || b.readings.length === 0) {
    throw badRequest("A readings post needs a non-empty `readings` list", "Zero readings is Rule 0: a run that read nothing must fail by name on the Mac, not file an empty post here.");
  }
  const registry = readerRegistry();
  const readings: Reading[] = [];
  for (const raw of b.readings as any[]) {
    const property = propertyFor(String(raw?.property_key ?? ""));
    if (!property) {
      throw badRequest(`"${raw?.property_key}" is not a grid property`, "src/shared/boss/grid.mjs is the grid. A key it does not declare is refused rather than stored.");
    }
    const reader = String(raw?.reader ?? "");
    const cell = registry.find((r) => r.property_key === property.key && r.reader === reader);
    if (!cell) throw badRequest(`"${reader}" is not one of the four readers`, `The registry names: ${READERS.join(", ")}.`);
    if (cell.runs_on !== "mac") {
      throw badRequest(`The ${reader} reader runs in the Worker and is not accepted over a request`, "Only the GitHub and Cloudflare readers post from her Mac.");
    }
    const state = raw?.state;
    if (state !== "ok" && state !== "warn" && state !== "blocked") throw badRequest(`state must be ok, warn or blocked (got "${state}")`);
    const summary = String(raw?.summary ?? "").trim();
    if (!summary) throw badRequest("Every reading carries a one-sentence summary", "A row with no sentence is a number nobody can read on the card.");
    if (state === "blocked" && !String(raw?.error ?? "").trim()) {
      throw badRequest("A blocked reading must say why", "`error` is the sentence the card prints. A blocked row with no reason is a blank with extra steps.");
    }
    readings.push({
      property_key: property.key,
      reader: reader as Reading["reader"],
      target: String(raw?.target ?? "—"),
      state,
      summary,
      numbers: raw?.numbers && typeof raw.numbers === "object" ? raw.numbers : {},
      evidence_url: typeof raw?.evidence_url === "string" ? raw.evidence_url : null,
      error: typeof raw?.error === "string" && raw.error.trim() ? raw.error : null,
    });
  }

  const now = Date.now();
  const written = await recordReadings(c.env.DB, readings, now);
  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "property_health", action: "readings_posted",
    detail: { written, readers: [...new Set(readings.map((r) => r.reader))], properties: [...new Set(readings.map((r) => r.property_key))].length },
  });
  return ok(c, { written, read_at: now }, 201);
});
