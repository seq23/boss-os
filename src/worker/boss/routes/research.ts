/**
 * Research — the scans an instruction starts ("find firms that did X and draft the ask").
 *
 * Three doors, one row. `POST /firm-scans` is the desk's own door; Team → New task and the mail
 * intake reach the same `admitTask`, whose grammar recognises the shape. Every read here comes
 * from `firm_scans` / `firm_scan_findings` and the letters they raised — counts from rows, never
 * from a model's account of itself.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { admitTask } from "../tasks/admit";
import { parseFirmScan, scanReport } from "../research/firmScan";

export const research = new Hono<{ Bindings: Env; Variables: Vars }>();

research.get("/firm-scans", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.*, t.status AS task_status, t.error AS task_error, t.employee_id, e.name AS employee_name
         FROM firm_scans s
         LEFT JOIN tasks t ON t.id = s.task_id
         LEFT JOIN employees e ON e.id = t.employee_id
        ORDER BY s.requested_at DESC LIMIT 20`,
    )
    .all<any>();
  const items = (rows.results ?? []).map((s) => ({
    ...s,
    queries: s.queries ? JSON.parse(s.queries) : [],
    sentence: sentenceFor(s),
  }));
  return ok(c, { items });
});

research.get("/firm-scans/:id", async (c) => {
  const report = await scanReport(c.env, c.req.param("id"));
  if (!report) throw notFound("No scan with that id");
  return ok(c, { ...report, sentence: sentenceFor(report) });
});

/** The desk's door: the instruction as she would say it. */
research.post("/firm-scans", async (c) => {
  const b = await c.req.json<{ instruction?: string }>().catch(() => null);
  const instruction = String(b?.instruction ?? "").trim();
  if (!instruction) throw badRequest("Say what to find and what to ask", 'For example: "find me a list of firms that reported IPO participation in the release, and draft an email to ask if I can send investors to them".');
  const parsed = parseFirmScan(instruction);
  if (!parsed) {
    throw badRequest(
      "That sentence does not say both what to find and what to ask",
      'Use the shape "find (me a list of) firms that <did something>, and draft an email to ask <the question>". Both halves are needed: the first decides the search, the second decides the letter.',
    );
  }
  const admitted = await admitTask(c.env, { title: instruction, lane: "ops", input: { prompt: instruction } });
  if (!admitted.created || !admitted.task_id) {
    throw badRequest(`Intake declined it: ${admitted.reason ?? "no reason given"}`);
  }
  const scan = await c.env.DB.prepare(`SELECT * FROM firm_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
  return ok(c, { task_id: admitted.task_id, scan_id: scan?.id ?? null, find: parsed.find, ask: parsed.ask, queued: admitted.queued }, 201);
});

/** ONE sentence for the screen, from the counts. */
export function sentenceFor(s: any): string {
  const n = (v: unknown) => Number(v) || 0;
  switch (s.state) {
    case "queued": return "Queued for Camille — starts on the next drain, seconds away.";
    case "searching": return `Camille is searching the news${s.queries ? ` (${JSON.parse(typeof s.queries === "string" ? s.queries : JSON.stringify(s.queries)).join(" · ")})` : ""}…`;
    case "extracting": return `${n(s.sources_read)} of ${n(s.sources_found)} sources read · reading them for the firms…`;
    case "drafting": return `${n(s.sources_read)} sources read · ${n(s.verified_count)} firm${n(s.verified_count) === 1 ? "" : "s"} verified against the page · drafting the letters (${n(s.drafts_count)} so far)…`;
    case "done": return `${n(s.sources_read)} sources read · ${n(s.verified_count)} of ${n(s.findings_count)} firms named have the sentence on the page · ${n(s.drafts_count)} letter${n(s.drafts_count) === 1 ? "" : "s"} in your Inbox`;
    case "failed": return `Stopped: ${s.failure ?? "no reason recorded"}`;
    default: return String(s.state);
  }
}
