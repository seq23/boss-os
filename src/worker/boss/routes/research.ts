/**
 * Research — the scans an instruction starts ("find firms that did X and draft the ask").
 *
 * Three doors, one row. `POST /firm-scans` is the desk's own door; Team → New task and the mail
 * intake reach the same `admitTask`, whose grammar recognises the shape. Every read here comes
 * from `ask_scans` / `ask_scan_findings` and the letters they raised — counts from rows, never
 * from a model's account of itself.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { admitTask } from "../tasks/admit";
import { newId } from "../lib/id";
import { parseFirmScan, scanReport } from "../research/firmScan";
import { routeCompletion } from "../router";

export const research = new Hono<{ Bindings: Env; Variables: Vars }>();

research.get("/firm-scans", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.*, t.status AS task_status, t.error AS task_error, t.employee_id, e.name AS employee_name
         FROM ask_scans s
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
  const scan = await c.env.DB.prepare(`SELECT * FROM ask_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
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

/*
 * ─── CAMILLE'S RESEARCH PAGES (22 Oct 2026) ─────────────────────────────────
 *
 * The page she asked for, as a page: self-contained HTML, readable on a phone. The list is JSON —
 * the "one findable list" of everything delivered is `GET /api/boss/research/delivered`, which
 * reads `delivered_work` (research pages filed on delivery, every other piece filed by Zora's
 * Friday duty). No screen is added here; she has not approved one.
 */
research.get("/pages/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM research_pages WHERE id = ?`).bind(c.req.param("id")).first<any>();
  if (!row) throw notFound("No research page with that id");
  if (row.state !== "delivered") {
    return ok(c, { id: row.id, state: row.state, question: row.question, failure_reason: row.failure_reason ?? null });
  }
  const { renderResearchPageHtml } = await import("../../../shared/boss/research/page.mjs");
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return c.html(renderResearchPageHtml({
    title: row.title, summary: row.summary ?? "", markdown: row.markdown ?? "", sources: parse(row.sources),
    gaps: parse(row.gaps), question: row.question, delivered_at: row.delivered_at,
  }));
});

research.get("/pages", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, task_id, question, state, title, summary, status, failure_reason, requested_at, delivered_at FROM research_pages ORDER BY requested_at DESC LIMIT 50`)
    .all<any>();
  return ok(c, { items: rows.results ?? [] });
});

research.get("/delivered", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, kind, title, location, owner_seat, delivered_at, filed_at, filed_by FROM delivered_work ORDER BY delivered_at DESC LIMIT 500`)
    .all<any>();
  return ok(c, { items: rows.results ?? [] });
});

/*
 * Zora's Friday filing (archive-audit.mjs on her Mac): every delivered piece she found that is not on
 * the list yet. Upsert by location; titles and links only — never a body, never a customer or LP name.
 */
research.post("/delivered", async (c) => {
  const b = await c.req.json<{ items?: { kind?: string; title?: string; location?: string; owner_seat?: string | null; delivered_at?: number | null }[] }>().catch(() => ({} as any));
  const items = Array.isArray(b?.items) ? b.items : [];
  if (items.length === 0) throw badRequest("Send { items: [{ kind, title, location, delivered_at }] } — an empty filing is not a filing.");
  const KINDS = ["research_page", "mockup", "playbook", "page", "report", "plan"];
  const now = Date.now();
  let filed = 0;
  const refused: string[] = [];
  for (const it of items.slice(0, 500)) {
    const title = String(it?.title ?? "").trim().slice(0, 200);
    const location = String(it?.location ?? "").trim();
    const kind = KINDS.includes(String(it?.kind)) ? String(it?.kind) : "page";
    if (!title || !/^https:\/\/\S+$/.test(location) || /@/.test(title)) { refused.push(location || title || "(blank)"); continue; }
    await c.env.DB.prepare(
      `INSERT INTO delivered_work (id, kind, title, location, owner_seat, delivered_at, filed_at, filed_by)
       VALUES (?,?,?,?,?,?,?, 'zora')
       ON CONFLICT(location) DO UPDATE SET title = excluded.title, kind = excluded.kind, delivered_at = COALESCE(excluded.delivered_at, delivered_work.delivered_at)`,
    ).bind(newId("dlw"), kind, title, location, it?.owner_seat ?? null, Number(it?.delivered_at) || now, now).run();
    filed += 1;
  }
  return ok(c, { filed, refused });
});

/**
 * FIVE BULLETS OF A PUBLIC EPISODE OR ARTICLE, for Simone's meeting prep (26 Oct 2026). Through the
 * router like every model call: free routes first, the spend lever decides, and the content scan
 * keeps LP names and deal terms off any route that trains. `{ bullets: [] }` when nothing answered;
 * the Mac then shows the show notes, labelled, and never invents.
 */
research.post("/summarize", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const text = String(b?.text ?? "").slice(0, 24_000);
  if (text.length < 200) throw badRequest("text is required (at least 200 characters)");
  try {
    const r = await routeCompletion(c.env, {
      routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", employeeId: "emp_chief",
      intakeKind: "research", maxOutputTokens: 400,
      messages: [
        { role: "system", content: "Summarise the public episode or article below in exactly five short plain-English bullets, one per line, each starting with '- '. Only what the text says; no opinions, no names that are not in it." },
        { role: "user", content: `${b?.title ? `Title: ${String(b.title).slice(0, 200)}\n\n` : ""}${text}` },
      ],
    });
    const bullets = String(r.text ?? "").split("\n").map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter((l) => l.length > 8).slice(0, 5);
    return ok(c, { bullets, model: r.modelId });
  } catch (e) {
    return ok(c, { bullets: [], error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
});
