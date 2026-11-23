import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { AppError, badRequest, notFound, ok } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import {
  AI_SITES, LANES, MAX_FIX_ATTEMPTS, NEXT_LANE, NO_LOOP_NOTE, WEEK_MAX_AGE_DAYS, expectedWeek, missId, pageOnHost, prefixOk, readSite,
  type SiteRead,
} from "../../../shared/boss/growth/aiAnswers.mjs";
import { loadRoster } from "./run";
import { machineTokenOk } from "../routes/openLoops";

/**
 * THE AI ANSWERS LOOP, STORED (her ask 22 Nov 2026; the rules: src/shared/boss/growth/aiAnswers.mjs).
 *
 *   POST /ai-week    (session) the Mac duty's weekly read, one entry per selling site. Every count is
 *                    recomputed here (readSite); a site that is not read is stored as not read with
 *                    its NAMED STOP and never overwrites a read week. The same week twice changes
 *                    nothing. Then each miss's lane is moved on when its fixes ran out. The fixes are
 *                    Noelle's (growth/noelle.ts `ai-fix`, attempt key noelle:<decision id>): this week is
 *                    stored whether or not she runs (G16e), and nothing here asks a model.
 *   GET  /ai-lanes   (session) each site's open misses and their lanes, for the reading session's
 *                    prompt (lanes are code-owned once set: the model only fills a new miss's lane).
 *   GET  /ai-misses  (machine token; public address /api/boss/growth/ai-misses) the "own" misses per
 *                    host for the search loop, exactly as
 *                    ~/Work/ai-visibility/CONTRACT.md (docs/OPERATIONS.md "AI answers loop").
 *
 * MONEY AND ACCOUNTS. Nothing here posts, sends or buys, and nothing here opens a to-do or a card.
 */
export const aiAnswerRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;
const parse = <T>(t: unknown, d: T): T => { try { return typeof t === "string" ? JSON.parse(t) : d; } catch { return d; } };
const MAX_SITES = Object.keys(AI_SITES).length;

type Strengthened = { id: string; page_url: string; at: string };
export interface WeekEntry { host: string; block?: unknown; stop?: string; prefix?: string | null; strengthened?: Strengthened[] | null }

/** Store one week for every site, then move lanes. Returns what happened per site. */
export async function recordAiWeek(env: Env, entries: WeekEntry[], now = Date.now()) {
  const db = env.DB;
  const out: any[] = [];
  for (const e of entries) {
    const site = AI_SITES[e.host];
    if (!site) { out.push({ host: e.host, status: "refused", why: "not one of the six selling sites" }); continue; }
    const prefix = site.loop && prefixOk(e.prefix) ? e.prefix! : null;
    const r: SiteRead = e.stop ? readSite({ site: e.host, stop: e.stop }, { host: e.host, now }) : readSite(e.block, { host: e.host, now, prefix });
    if (r.status === "not_read") {
      const week = r.week ?? expectedWeek(now);
      // A not-read week never replaces a read one (a second run that failed keeps the first's numbers).
      await db.prepare(`INSERT INTO ai_answer_reads (site, week, status, stop, loop, engines, read_at) VALUES (?,?,'not_read',?,?,'{}',?)
        ON CONFLICT(site, week) DO UPDATE SET stop = excluded.stop, read_at = excluded.read_at WHERE ai_answer_reads.status = 'not_read'`)
        .bind(e.host, week, r.stop, site.loop ? 1 : 0, now).run();
      out.push({ host: e.host, status: "not_read", week, stop: r.stop, why: r.why });
      continue;
    }
    const stored = await db.prepare(`SELECT status, run_id FROM ai_answer_reads WHERE site = ? AND week = ?`).bind(e.host, r.week).first<{ status: string; run_id: string | null }>();
    const same = stored?.status === "read" && stored.run_id === r.run_id;
    if (!same) {
      const stmts = [db.prepare(`INSERT INTO ai_answer_reads (site, week, run_id, run_at, status, stop, loop, prompts, answered, cited, mentioned, engines, read_at)
          VALUES (?,?,?,?,'read',NULL,?,?,?,?,?,?,?)
          ON CONFLICT(site, week) DO UPDATE SET run_id = excluded.run_id, run_at = excluded.run_at, status = 'read', stop = NULL, loop = excluded.loop,
            prompts = excluded.prompts, answered = excluded.answered, cited = excluded.cited, mentioned = excluded.mentioned, engines = excluded.engines, read_at = excluded.read_at`)
        .bind(e.host, r.week, r.run_id, r.run_at, site.loop ? 1 : 0, r.prompts, r.answered, r.cited, r.mentioned, JSON.stringify(r.engines), now),
        db.prepare(`DELETE FROM ai_answer_obs WHERE site = ? AND week = ?`).bind(e.host, r.week)];
      for (const o of r.obs) {
        stmts.push(db.prepare(`INSERT INTO ai_answer_obs (site, week, prompt_id, engine, prompt, obs_id, run_id, status, mentioned, cited, rivals, sources, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(e.host, r.week, o.prompt_id, o.engine, o.prompt, o.obs_id, r.run_id, o.status, o.mentioned === null ? null : o.mentioned ? 1 : 0, o.cited === null ? null : o.cited ? 1 : 0, JSON.stringify(o.rivals), JSON.stringify(o.sources), r.run_at));
      }
      await db.batch(stmts);
    }
    const lanes = await updateMisses(env, e, site, r, now);
    out.push({ host: e.host, status: "read", week: r.week, prompts: r.prompts, cited: r.cited, mentioned: r.mentioned, misses: r.misses.length, unchanged: same, lanes, notes: r.notes });
  }
  return out;
}

/** The misses table for one read week: new misses, still missed, fixed again; fixes counted once each. */
async function updateMisses(env: Env, e: WeekEntry, site: { loop: boolean }, r: Extract<SiteRead, { status: "read" }>, now: number) {
  const db = env.DB;
  const moved: string[] = [];
  const strengthened = (Array.isArray(e.strengthened) ? e.strengthened : []).filter((s) => s && typeof s.id === "string" && typeof s.at === "string" && !Number.isNaN(Date.parse(s.at)));
  const missed = new Set<string>();
  for (const m of r.misses) {
    const id = await missId(e.host, m.prompt);
    missed.add(id);
    const row = await db.prepare(`SELECT * FROM ai_misses WHERE id = ?`).bind(id).first<any>();
    if (!row) {
      const lane = m.lane && LANES.includes(m.lane) ? m.lane : "own";
      await db.prepare(`INSERT INTO ai_misses (id, site, prompt_id, prompt, lane, page_url, fit_url, source_domain, channel, engines_missed, rivals, cited_sources, why, first_missed_week, last_missed_week, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, e.host, m.prompt_id, m.prompt, lane, m.page_url, m.fit_url, m.source_domain, m.channel,
        JSON.stringify(m.engines_missed), JSON.stringify(m.rivals), JSON.stringify(m.cited_sources), m.why, r.week, r.week, now).run();
      continue;
    }
    if (row.last_missed_week > r.week) continue; // an older week read late never rewrites a newer one
    let lane: string = row.lane, attempts: number = row.fix_attempts, todo: string | null = row.todo_key;
    const counted: string[] = parse(row.counted, []), tried: string[] = parse(row.lanes_tried, []);
    // OWN: a fix is the search loop strengthening this page (search-loop-week ai_misses.strengthened[]),
    // made before this run collected its answers and still not cited.
    if (lane === "own" && site.loop && !row.fit_url) {
      for (const s of strengthened) {
        const tag = `own@${s.at}`;
        if (s.id === id && Date.parse(s.at) < r.run_at && !counted.includes(tag)) { attempts++; counted.push(tag); }
      }
    } else if (todo) {
      const f = await fixOutcome(db, todo, r.run_at);
      if (f.state === "no") { attempts = MAX_FIX_ATTEMPTS; todo = null; }
      else if (f.state === "yes") todo = f.key;
      else if (f.state === "gone") todo = null;
      else if (f.state === "closed" && !counted.includes(f.tag)) { attempts++; counted.push(f.tag); todo = null; }
    }
    const fresh = { page_url: m.page_url, fit_url: m.fit_url, source_domain: m.source_domain, channel: m.channel, why: m.why };
    if (attempts >= MAX_FIX_ATTEMPTS && NEXT_LANE[lane]) {
      tried.push(lane); lane = NEXT_LANE[lane]!; attempts = 0; todo = null;
      // The model's details were for the old lane; the next lane's are filled by next week's read.
      Object.assign(fresh, { page_url: null, fit_url: null, source_domain: null, channel: null, why: null });
      moved.push(`${id.slice(0, 8)}: ${tried.at(-1)} → ${lane}`);
    }
    await db.prepare(`UPDATE ai_misses SET lane = ?, page_url = ?, fit_url = ?, source_domain = ?, channel = ?, engines_missed = ?, rivals = ?, cited_sources = ?, why = COALESCE(?, why),
        last_missed_week = ?, fixed_week = NULL, fix_attempts = ?, counted = ?, lanes_tried = ?, todo_key = ?, updated_at = ? WHERE id = ?`)
      .bind(lane, fresh.page_url, fresh.fit_url, fresh.source_domain, fresh.channel, JSON.stringify(m.engines_missed), JSON.stringify(m.rivals), JSON.stringify(m.cited_sources), fresh.why,
        r.week, attempts, JSON.stringify(counted), JSON.stringify(tried), todo, now, id).run();
  }
  // Cited this week: fixed. A prompt no engine answered stays as it was (unknown is not fixed).
  const cited = new Set(r.obs.filter((o) => o.cited).map((o) => o.prompt_id));
  const open = (await db.prepare(`SELECT id, prompt_id FROM ai_misses WHERE site = ? AND fixed_week IS NULL`).bind(e.host).all<{ id: string; prompt_id: string }>()).results ?? [];
  for (const o of open) if (!missed.has(o.id) && cited.has(o.prompt_id)) await db.prepare(`UPDATE ai_misses SET fixed_week = ?, updated_at = ? WHERE id = ?`).bind(r.week, now, o.id).run();
  return moved;
}

/** What became of a miss's to-do or card: still open, done (one attempt), her yes, her no, or gone. */
async function fixOutcome(db: D1Database, todo: string, runAt: number): Promise<{ state: "open" | "closed" | "yes" | "no" | "gone"; tag: string; key: string }> {
  // Noelle's fix (growth/noelle.ts ai-fix): one attempt once her decision was made before this week's answers.
  if (todo.startsWith("noelle:")) {
    const d = await db.prepare(`SELECT created_at FROM growth_decisions WHERE id = ?`).bind(todo.slice(7)).first<{ created_at: number }>();
    if (!d) return { state: "gone", tag: "", key: "" };
    return d.created_at < runAt ? { state: "closed", tag: `${todo}@${d.created_at}`, key: todo } : { state: "open", tag: "", key: todo };
  }
  if (todo.startsWith("card:")) {
    const j = await db.prepare(`SELECT j.id, j.state, j.resume_detail FROM judgement_calls j WHERE j.approval_id = ?`).bind(todo.slice(5)).first<{ id: string; state: string; resume_detail: string | null }>();
    if (!j || j.state === "superseded") return { state: "gone", tag: "", key: "" };
    if (j.state === "try_again") return { state: "no", tag: "", key: "" };
    if (j.state === "approved") return { state: "yes", tag: "", key: `growth-yes#${parse<any>(j.resume_detail, {})?.business}#${j.id}` };
    return { state: "open", tag: "", key: todo };
  }
  const l = await db.prepare(`SELECT status, closed_at FROM owner_open_loops WHERE source_key = ?`).bind(todo).first<{ status: string; closed_at: number | null }>();
  if (!l) return { state: "gone", tag: "", key: "" };
  // A fix counts once it was finished before this week's answers were collected.
  if (l.status === "closed" && l.closed_at !== null && l.closed_at < runAt) return { state: "closed", tag: `todo:${todo}@${l.closed_at}`, key: todo };
  return { state: "open", tag: "", key: todo };
}

aiAnswerRoutes.post("/ai-week", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const sites = body?.sites;
  if (!Array.isArray(sites) || !sites.length || sites.length > MAX_SITES) throw badRequest("The week was refused", `sites must list 1 to ${MAX_SITES} selling sites.`);
  const hosts = sites.map((s: any) => String(s?.host ?? ""));
  if (new Set(hosts).size !== hosts.length) throw badRequest("The week was refused", "a site is listed twice.");
  const out = await recordAiWeek(c.env, sites as WeekEntry[]);
  return ok(c, { sites: out, read: out.filter((x) => x.status === "read").length }, 201);
});

aiAnswerRoutes.get("/ai-lanes", async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT site, prompt_id, lane, fix_attempts, lanes_tried FROM ai_misses WHERE fixed_week IS NULL ORDER BY site, prompt_id`).all<any>()).results ?? [];
  // The channels each site's business holds (its brain's Growth roster): a CLAIM names one of these, or none.
  const { roster } = await loadRoster(c.env.DB);
  const channels = Object.fromEntries(Object.entries(AI_SITES).map(([host, s]) => [host, (roster.find((r) => r.key === s.business)?.channels ?? []).map((x) => x.channel)]));
  return ok(c, { lanes: rows.map((r) => ({ ...r, lanes_tried: parse(r.lanes_tried, []) })), channels });
});

/** The search loop's read of one host's OWN misses (CONTRACT). Never a page off that host. */
export async function aiMisses(db: D1Database, host: string, now = Date.now()) {
  const site = AI_SITES[host];
  const latest = await db.prepare(`SELECT week, status, run_at, read_at FROM ai_answer_reads WHERE site = ? ORDER BY week DESC LIMIT 1`).bind(host).first<any>();
  const base = { host, week: latest?.week ?? expectedWeek(now), read_at: latest ? new Date(latest.read_at).toISOString() : null };
  if (!site!.loop) return { ...base, status: "read" as const, misses: [], note: NO_LOOP_NOTE };
  if (!latest || latest.status !== "read" || now - Number(latest.run_at) > WEEK_MAX_AGE_DAYS * DAY_MS) return { ...base, status: "not_read" as const, misses: [] };
  const rows = (await db.prepare(`SELECT * FROM ai_misses WHERE site = ? AND lane = 'own' AND fixed_week IS NULL AND last_missed_week = ? AND fit_url IS NULL ORDER BY first_missed_week, id`).bind(host, latest.week).all<any>()).results ?? [];
  return {
    ...base, status: "read" as const,
    misses: rows.map((m) => ({
      id: m.id, prompt: m.prompt, lane: "own",
      page_url: m.page_url && pageOnHost(m.page_url, host) ? m.page_url : null,
      engines_missed: parse(m.engines_missed, []), rivals: parse(m.rivals, []), cited_sources: parse(m.cited_sources, []),
      first_missed_week: m.first_missed_week, fix_attempts: m.fix_attempts,
    })),
  };
}

aiAnswerRoutes.get("/ai-misses", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const host = c.req.query("host") ?? "";
  if (!Object.prototype.hasOwnProperty.call(AI_SITES, host)) throw notFound("No such selling site");
  return c.json(await aiMisses(c.env.DB, host));
});

/** The path INSIDE the Boss app; its public address is `/api/boss/growth/ai-misses` (see BACKLINK_ORDERS_PATH). */
export const AI_MISSES_PATH = "/api/growth/ai-misses";
