/**
 * QUALITY: the weekly drift lines (owner, 13 Nov 2026) and the shared ship-ready reviewer's verdicts
 * (owner, 19 Nov 2026, "VETERAN QUALITY BAR, HANDS-OFF").
 *
 * /drift   what each deliverable measured this week beside its best run, and the newest monthly read.
 *          Read by Simone's morning email on Mondays (scripts/ops/your-day.mjs); rule in duties/drift.ts.
 * /reviews the reviewer's verdicts (scripts/ops/ship-review.mjs writes them; anything in Boss OS that
 *          must wait for a PASS reads them). One store: quality_reads, kind 'ship' (migration 0369).
 * Behind the session.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { badRequest, ok } from "../lib/http";
import { driftReport } from "../duties/drift";
import { KINDS, PASS_LINE_RE } from "../../../shared/boss/shipReview/review.mjs";

export const quality = new Hono<{ Bindings: Env; Variables: Vars }>();

quality.get("/drift", async (c) => ok(c, await driftReport(c.env)));

export interface ShipReview {
  id: string; at: number; subject: string; verdict: "PASS" | "FAIL"; why: string;
  builder: string | null; looked_at: string | null; findings: unknown[]; route: string | null;
}

type Row = { id: string; at: number; deliverable: string; verdict: string; why: string; builder: string | null; looked_at: string | null; findings: string | null; route: string | null };
const shape = (r: Row): ShipReview => {
  let findings: unknown[] = [];
  try { const f = JSON.parse(r.findings ?? "[]"); if (Array.isArray(f)) findings = f; } catch { findings = []; }
  return { id: r.id, at: r.at, subject: r.deliverable, verdict: r.verdict === "PASS" ? "PASS" : "FAIL", why: r.why, builder: r.builder, looked_at: r.looked_at, findings, route: r.route };
};

/** The newest verdict on a subject, or null. What a sender, poster or lane waits on. */
export async function latestShipReview(env: Pick<Env, "DB">, subject: string): Promise<ShipReview | null> {
  const r = await env.DB.prepare(`SELECT id, at, deliverable, verdict, why, builder, looked_at, findings, route FROM quality_reads WHERE kind = 'ship' AND deliverable = ? ORDER BY at DESC LIMIT 1`)
    .bind(subject).first<Row>();
  return r ? shape(r) : null;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

quality.post("/reviews", async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) throw badRequest("A review is a JSON body.");
  const id = str(b.id, 40), subject = str(b.subject, 500), builder = str(b.builder, 200), lookedAt = str(b.looked_at, 2000);
  const verdict = str(b.verdict, 8).toUpperCase(), route = str(b.route, 120), kind = str(b.kind, 20);
  const findings = Array.isArray(b.findings) ? b.findings.slice(0, 40) : [];
  if (!/^sr_[a-z0-9]+$/.test(id)) throw badRequest("id must be the reviewer's sr_… id.");
  if (!subject || !builder || !lookedAt || !route) throw badRequest("subject, builder, looked_at and route are all required: a verdict that does not say what it looked at is no verdict.");
  if (!(KINDS as readonly string[]).includes(kind)) throw badRequest(`kind must be one of ${KINDS.join(", ")}.`);
  if (verdict !== "PASS" && verdict !== "FAIL") throw badRequest("verdict must be PASS or FAIL.");
  if (verdict === "FAIL" && findings.length === 0) throw badRequest("A FAIL carries its numbered findings.");
  const line = str(b.line, 2500);
  if (verdict === "PASS" && !PASS_LINE_RE.test(line)) throw badRequest("A PASS carries the line land reads: Ship-ready: PASS — <reviewer> looked at <what>.");
  const why = verdict === "PASS" ? line : `${findings.length} finding(s): ${str((findings[0] as { what?: string })?.what, 300)}`;
  await c.env.DB.prepare(`INSERT INTO quality_reads (id, at, deliverable, verdict, why, task_id, run_id, route, kind, builder, looked_at, findings) VALUES (?,?,?,?,?,NULL,?,?, 'ship', ?,?,?)`)
    .bind(id, Date.now(), subject, verdict, why, id, route, builder, lookedAt, JSON.stringify(findings)).run();
  return ok(c, { id, subject, verdict }, 201);
});

quality.get("/reviews", async (c) => {
  const subject = c.req.query("subject");
  if (subject) {
    const latest = await latestShipReview(c.env, subject);
    return ok(c, { subject, latest, passed_before: latest ? Boolean(await c.env.DB.prepare(`SELECT 1 FROM quality_reads WHERE kind = 'ship' AND deliverable = ? AND verdict = 'PASS' LIMIT 1`).bind(subject).first()) : false });
  }
  const rows = await c.env.DB.prepare(`SELECT id, at, deliverable, verdict, why, builder, looked_at, findings, route FROM quality_reads WHERE kind = 'ship' ORDER BY at DESC LIMIT 50`).all<Row>();
  return ok(c, { reviews: (rows.results ?? []).map(shape) });
});
