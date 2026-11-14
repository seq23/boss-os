/**
 * THE WEEKLY DRIFT LINES (owner, 13 Nov 2026): what each deliverable measured this week beside its
 * best run and the four-week trend, and the newest monthly read. Read by Simone's morning email on
 * Mondays (scripts/ops/your-day.mjs). The rule lives in duties/drift.ts. Behind the session.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok } from "../lib/http";
import { driftReport } from "../duties/drift";

export const quality = new Hono<{ Bindings: Env; Variables: Vars }>();

quality.get("/drift", async (c) => ok(c, await driftReport(c.env)));
