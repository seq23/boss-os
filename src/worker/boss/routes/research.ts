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
import { privateLexicon, scanForModelAccess } from "../router/modelAccess";
import { groundedSearchPrompt, writeFromPagesPrompt, keepGroundedFacts, guestPages } from "../../../shared/boss/meetingPrep/prep.mjs";
import { browsePage } from "../../effects/browserClient";
import { braveSearch, type BraveResult } from "../../effects/braveSearchClient";
import { claimFreeSearch } from "../research/searchQuota";
import { GROUNDING_REDIRECT, followGroundingLink } from "../../effects/groundingLinkClient";

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
  // Her Mac's notice sender reads the page as data to lay out the Done email (`?format=json`).
  if (c.req.query("format") === "json") {
    return ok(c, {
      id: row.id, task_id: row.task_id, state: row.state, status: row.status, title: row.title, summary: row.summary ?? "",
      markdown: row.markdown ?? "", sources: parse(row.sources), gaps: parse(row.gaps), delivered_at: row.delivered_at,
    });
  }
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
/** JSON out of a model's answer, or null. */
function jsonIn(text: string): any {
  const m = /```json\s*([\s\S]*?)```/.exec(text) ?? /(\{[\s\S]*\})\s*$/.exec(text.trim());
  try { return m ? JSON.parse(m[1]!) : null; } catch { return null; }
}
/**
 * GOOGLE'S GROUNDING LINKS ARE REDIRECTS (6 Nov 2026). Each source arrives as a ~250-character
 * vertexaisearch.cloud.google.com link that expires; her prep showed those as "Source". Each is
 * followed once (no body read) and replaced by the page it points to; one that will not resolve
 * keeps Google's link, so a fact never loses its source.
 */
export async function realLinks(json: any, sources: { title: string; url: string }[], follow: (url: string) => Promise<string | null>) {
  const urls = [...new Set(sources.map((s) => s.url).filter((u) => GROUNDING_REDIRECT.test(u)))];
  const to = new Map<string, string>();
  await Promise.all(urls.map(async (u) => { const real = await follow(u).catch(() => null); if (real) to.set(u, real); }));
  const fix = (f: any) => (f && typeof f.url === "string" && to.has(f.url) ? { ...f, url: to.get(f.url) } : f);
  const out = { ...json };
  for (const k of ["title", "firm", "background", "focus"]) out[k] = fix(json[k]);
  out.upcoming = Array.isArray(json.upcoming) ? json.upcoming.map(fix) : json.upcoming;
  return { json: out, sources: sources.map((s) => (to.has(s.url) ? { ...s, url: to.get(s.url)! } : s)) };
}

/** Each page's text exactly as the prompt quotes it, so the router can find it verbatim. */
export function publicSpans(prompt: string, pages: { text: string }[]): string[] {
  return pages.map((p) => String(p.text ?? "").slice(0, 6000)).filter((t) => t.length && prompt.includes(t));
}
const sourcedCount = (j: any) => (j && j.found !== false ? ["title", "firm", "background", "focus"].filter((k) => j[k]).length + (j.upcoming?.length ?? 0) : 0);

/**
 * WHO A MEETING GUEST IS, RESEARCHED BEFORE THE PREP GOES (owner, 4 Nov 2026). Called by Simone's
 * meeting prep (scripts/ops/meeting-prep.mjs). Free Gemini only, each step pinned by its job row
 * (model_job_policies, 0338):
 *   1. meeting_prep_search — gemini-2.5-flash with Google Search grounding (the one free model where
 *      search works; it retires 1 Dec 2026). Facts kept only when Google reported the page. When it
 *      errors (retired, quota) research goes on to 2 and 3, never to a billed grounded search.
 *   Writing (meeting_prep_write, steps 2 and 3) walks the next free Gemini models (3.8, 3.6, 3 Flash
 *   preview), then OpenRouter's free models (migration 0354), so prep survives 2.5-flash retiring.
 *   2. else Brave Search (owner, 5 Nov 2026), at most 20 searches a day: the top results' pages are
 *      read with the browser binding (Brave's own snippet when a page will not load), and a free
 *      Gemini 3 Flash (meeting_prep_write) writes ONLY from that text, citing each result's link.
 *   3. else meeting_prep_write — their company site and public pages fetched with the Cloudflare
 *      browser binding, and a free Gemini 3 Flash writes ONLY from that text, citing each page.
 *   4. else `{ ok: false, stop, why }`: the prep says "Couldn't research <name>: <why>".
 * A committed LP is private-model-only (owner ruling, 4 Nov 2026) and never reaches Gemini: the answer
 * says `private: true` and the Mac researches on her own seat. Prospects are public.
 *   POST { name, email?, firm?, domain?, today? } → { ok: true, json, sources, via } | { ok: false, stop, why, private? }
 */
export async function researchPerson(
  env: Env,
  b: { name?: string | null; email?: string | null; firm?: string | null; domain?: string | null; today?: string | null },
  browse: (env: Env, url: string) => Promise<{ ok: boolean; text: string | null; finalUrl: string | null }> = (e, u) => browsePage(e as any, u),
  search: (env: Env, query: string) => Promise<{ ok: true; results: BraveResult[] } | { ok: false; detail: string }> = (e, q) => braveSearch(e.BRAVE_SEARCH_API_KEY, q),
  follow: (url: string) => Promise<string | null> = followGroundingLink,
): Promise<any> {
  const name = b.name ?? null, email = b.email ?? null, firm = b.firm ?? null, domain = b.domain ?? null;
  const today = b.today ?? new Date().toISOString().slice(0, 10);
  const access = scanForModelAccess([{ role: "user", content: [name, email, firm].filter(Boolean).join(" ") }], await privateLexicon(env.DB));
  if (access.access === "private_model_only") {
    return { ok: false, private: true, stop: "RESEARCH_PRIVATE", why: "they are a committed LP, so their name stays off free models" };
  }
  const base = { routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", employeeId: "emp_chief", intakeKind: "research" } as const;
  const reasons: string[] = [];

  // 1. Google-grounded.
  try {
    const r = await routeCompletion(env, {
      ...base, onlyProviderId: "prv_gemini", jobKey: "meeting_prep_search", webSearch: true, maxOutputTokens: 1500,
      messages: [{ role: "user", content: groundedSearchPrompt({ name, email, firm, domain, today }) }],
    });
    const sources = (r.sources ?? []).filter((s) => /^https:\/\//.test(s.url)).slice(0, 20);
    const grounded = sources.length ? keepGroundedFacts(jsonIn(r.text), sources) : null;
    const { json, sources: realSources } = grounded ? await realLinks(grounded, sources, follow) : { json: grounded, sources };
    if (json && json.found === false) return { ok: false, stop: "RESEARCH_NOT_FOUND", why: String(json.why ?? "Google found nothing that says who they are").slice(0, 160) };
    if (sourcedCount(json)) return { ok: true, json, sources: realSources, via: "google_search" };
    reasons.push(sources.length ? "Google search found nothing it could source" : "Google search returned no pages");
  } catch (e) {
    reasons.push(`Google search was not available (${String((e as Error)?.message ?? e).slice(0, 120)})`);
  }

  // Pages → a free model writes from that text only; a fact is kept only when it cites one of them.
  const writeFrom = async (pages: { url: string; text: string }[]) => {
    const content = writeFromPagesPrompt({ name, pages });
    const w = await routeCompletion(env, {
      ...base, jobKey: "meeting_prep_write", maxOutputTokens: 1200,
      messages: [{ role: "user", content }],
      // The pages are public web text; deal-term patterns skip them, committed-LP names do not.
      publicWebText: publicSpans(content, pages),
    });
    const sources = pages.map((p) => ({ title: p.url, url: p.url }));
    return { json: keepGroundedFacts(jsonIn(w.text), sources), sources };
  };

  // 2. Brave Search, at most 20 a day (FREE_ROUTES.svc_brave_search), claimed before the call.
  if (!env.BRAVE_SEARCH_API_KEY) {
    reasons.push("Brave Search has no key on this Worker");
  } else if (!(await claimFreeSearch(env.DB, "svc_brave_search")).ok) {
    reasons.push("today's 20 Brave searches are used");
  } else {
    const query = [name ? `"${name}"` : null, firm, domain && !firm ? domain : null].filter(Boolean).join(" ") || String(email ?? "");
    const found = await search(env, query).catch((e) => ({ ok: false as const, detail: String((e as Error)?.message ?? e).slice(0, 120) }));
    if (!found.ok) {
      reasons.push(found.detail);
    } else if (!found.results.length) {
      reasons.push("Brave Search found no pages");
    } else {
      const pages: { url: string; text: string }[] = [];
      for (const r of found.results.slice(0, 3)) {
        const p = await browse(env, r.url).catch(() => null);
        if (p?.ok && p.text && p.text.trim().length >= 200) pages.push({ url: r.url, text: p.text });
        else if (r.text) pages.push({ url: r.url, text: r.text });
      }
      try {
        const { json, sources } = await writeFrom(pages);
        if (sourcedCount(json)) return { ok: true, json, sources, via: "brave_search" };
        reasons.push("Brave Search's pages did not say who they are");
      } catch (e) {
        reasons.push(`the writing model could not run (${String((e as Error)?.message ?? e).slice(0, 120)})`);
      }
    }
  }

  // 3. Their own pages, fetched; a free model writes from that text only.
  const pages: { url: string; text: string }[] = [];
  for (const url of guestPages(domain)) {
    const p = await browse(env, url).catch(() => null);
    if (p?.ok && p.text && p.text.trim().length >= 200) pages.push({ url: p.finalUrl ?? url, text: p.text });
  }
  if (!pages.length) {
    reasons.push(domain ? `their website (${domain}) could not be read` : "there is no company website to read");
    return { ok: false, stop: "RESEARCH_NO_SOURCES", why: reasons.join("; ") };
  }
  try {
    const { json, sources } = await writeFrom(pages);
    if (sourcedCount(json)) return { ok: true, json, sources, via: "their_pages" };
    reasons.push("their pages did not say who they are");
  } catch (e) {
    reasons.push(`the writing model could not run (${String((e as Error)?.message ?? e).slice(0, 120)})`);
  }
  return { ok: false, stop: "RESEARCH_NO_SOURCES", why: reasons.join("; ") };
}

research.post("/person", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const body = { name: str(b?.name, 120), email: str(b?.email, 200), firm: str(b?.firm, 160), domain: str(b?.domain, 160), today: str(b?.today, 10) };
  if (!body.name && !body.email) throw badRequest("Send the person's name or email");
  return ok(c, await researchPerson(c.env, body));
});

research.post("/summarize", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const text = String(b?.text ?? "").slice(0, 24_000);
  if (text.length < 200) throw badRequest("text is required (at least 200 characters)");
  try {
    const r = await routeCompletion(c.env, {
      routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", employeeId: "emp_chief",
      intakeKind: "research", maxOutputTokens: 400, jobKey: "summarise",
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
