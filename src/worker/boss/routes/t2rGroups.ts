/**
 * TIME-2-READ GROUPS & INSTITUTIONS: the Mac job's desk (owner, 31 Oct 2026; Monique's duty).
 * Research rows, NeverBounce verdicts, code results and code use come in here; sending is the
 * outreach engine's (groups.ts). Behind the session like every other /api/boss route.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import {
  codesDue, importGroups, plan, queueReady, recordCode, recordUsage, recordVerdicts, setTier, summary, toVerify,
} from "../outreach/groups";

export const t2rGroups = new Hono<{ Bindings: Env; Variables: Vars }>();

t2rGroups.get("/plan", async (c) => ok(c, await plan(c.env.DB)));
t2rGroups.get("/to-verify", async (c) => ok(c, { emails: await toVerify(c.env.DB, Math.min(50, Number(c.req.query("cap") ?? 25) || 25)) }));
t2rGroups.get("/codes-due", async (c) => ok(c, { codes: await codesDue(c.env.DB, Date.now()) }));
t2rGroups.get("/summary", async (c) => ok(c, await summary(c.env.DB)));

// The setting that flips a tier: tier 3 (schools, districts) stays off until Phase 8 is built.
t2rGroups.put("/tiers/:tier", async (c) => {
  const tier = Number(c.req.param("tier"));
  const b = await c.req.json<any>().catch(() => null);
  if (![1, 2, 3].includes(tier) || typeof b?.enabled !== "boolean") throw badRequest("A tier (1–3) and enabled true or false are required.");
  return ok(c, await setTier(c.env.DB, tier, b.enabled, typeof b.why_off === "string" ? b.why_off.slice(0, 300) : null, Date.now()));
});

t2rGroups.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b || typeof b.op !== "string") throw badRequest("A job operation is required.");
  const db = c.env.DB;
  const now = Date.now();
  if (b.op === "import") {
    if (!Array.isArray(b.rows) || b.rows.length > 60) throw badRequest("Up to 60 researched rows are required.");
    return ok(c, await importGroups(db, b.rows, now));
  }
  if (b.op === "verdicts") {
    if (!Array.isArray(b.verdicts) || !b.verdicts.every((v: any) => typeof v?.email === "string" && typeof v?.result === "string")) throw badRequest("NeverBounce verdicts are required.");
    return ok(c, await recordVerdicts(db, b.verdicts, now));
  }
  if (b.op === "code") {
    if (typeof b.id !== "string" || typeof b.ok !== "boolean") throw badRequest("A group id and the code table's answer are required.");
    return ok(c, await recordCode(db, b.id, { ok: b.ok, already: Boolean(b.already), detail: typeof b.detail === "string" ? b.detail.slice(0, 300) : undefined }, now));
  }
  if (b.op === "usage") {
    if (!Array.isArray(b.codes)) throw badRequest("The code table's counts are required.");
    return ok(c, await recordUsage(db, b.codes, now));
  }
  if (b.op === "queue") return ok(c, { queued: await queueReady(db, now) });
  throw badRequest("Unknown job operation.");
});
