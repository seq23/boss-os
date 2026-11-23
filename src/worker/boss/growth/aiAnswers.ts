import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { AppError, badRequest, notFound, ok } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import {
  AI_SITES, LANES, MAX_FIX_ATTEMPTS, NEXT_LANE, NO_LOOP_NOTE, WEEK_MAX_AGE_DAYS, expectedWeek, missId, pageOnHost, prefixOk, readSite,
  type SiteRead,
} from "../../../shared/boss/growth/aiAnswers.mjs";
import { ASKED_DAYS, MAX_CARDS, claimRules, claimsPrompt, namingProblems, parseClaims, routeItem } from "../../../shared/boss/growth/director.mjs";
import type { RosterEntry } from "../../../shared/boss/growth/roster.mjs";
import { askedRecently, brainMd, card, freeModel, loadRoster, openTodo, type Model } from "./run";
import { machineTokenOk } from "../routes/openLoops";

/**
 * THE AI ANSWERS LOOP, STORED (her ask 22 Nov 2026; the rules: src/shared/boss/growth/aiAnswers.mjs).
 *
 *   POST /ai-week    (session) the Mac duty's weekly read, one entry per selling site. Every count is
 *                    recomputed here (readSite); a site that is not read is stored as not read with
 *                    its NAMED STOP and never overwrites a read week. The same week twice changes
 *                    nothing. Then each miss's lane is moved on when its fixes ran out, and one
 *                    Growth to-do or Decide card is started per cited source (per page for OWN fits).
 *   GET  /ai-lanes   (session) each site's open misses and their lanes, for the reading session's
 *                    prompt (lanes are code-owned once set: the model only fills a new miss's lane).
 *   GET  /ai-misses  (machine token) the "own" misses per host for the search loop, exactly as
 *                    ~/Work/ai-visibility/CONTRACT.md (docs/OPERATIONS.md "AI answers loop").
 *
 * MONEY AND ACCOUNTS. Nothing here posts, sends or buys. A to-do opens only on an approved roster
 * channel and format (routeItem → mayAct) after the claims check; everything else is her card. A
 * CLAIM on a listing she does not hold is hers to open (agents never create accounts, R-AI-02).
 */
export const aiAnswerRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;
const parse = <T>(t: unknown, d: T): T => { try { return typeof t === "string" ? JSON.parse(t) : d; } catch { return d; } };
const MAX_SITES = Object.keys(AI_SITES).length;

type Strengthened = { id: string; page_url: string; at: string };
export interface WeekEntry { host: string; block?: unknown; stop?: string; prefix?: string | null; strengthened?: Strengthened[] | null }

/** Store one week for every site, then move lanes and start fixes. Returns what happened per site. */
export async function recordAiWeek(env: Env, entries: WeekEntry[], now = Date.now(), deps: { model?: Model } = {}) {
  const db = env.DB;
  const model = deps.model ?? freeModel;
  const out: any[] = [];
  const { roster } = await loadRoster(db);
  const riskMd = (await brainMd(db, "risk")) ?? "";
  const asked = await askedRecently(db, now);
  const budget = { cards: 0 };
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
    const actions = await startFixes(env, { host: e.host, business: site.business, loop: site.loop, week: r.week, runAt: r.run_at, roster, riskMd, asked, budget, model, now });
    out.push({ host: e.host, status: "read", week: r.week, prompts: r.prompts, cited: r.cited, mentioned: r.mentioned, misses: r.misses.length, unchanged: same, lanes, actions, notes: r.notes });
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

/** The OWN target when no page of a loop-less site fits: one new page on the site. */
const NEW_PAGE = "a new page";
const LANE_WORDS: Record<string, string> = { own: "strengthen", claim: "claim", earn: "earn a mention on", contest: "correct" };
const slugOf = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const plural = (n: number) => `${n} buyer question${n === 1 ? "" : "s"}`;

/**
 * One fix per cited source (per page for an OWN best fit that is not an engine page), ranked by the
 * prompts it touches; the rest wait in the table. A group already being worked (an open to-do or a
 * card she has not answered) is left alone, so a rerun opens nothing new.
 */
async function startFixes(env: Env, ctx: { host: string; business: string; loop: boolean; week: string; runAt: number; roster: RosterEntry[]; riskMd: string; asked: Set<string>; budget: { cards: number }; model: Model; now: number }) {
  const db = env.DB;
  const rows = (await db.prepare(`SELECT * FROM ai_misses WHERE site = ? AND fixed_week IS NULL AND last_missed_week = ? AND fix_attempts < ?`).bind(ctx.host, ctx.week, MAX_FIX_ATTEMPTS).all<any>()).results ?? [];
  const groups = new Map<string, { lane: string; target: string; channel: string | null; rows: any[] }>();
  for (const m of rows) {
    // OWN on a search-loop site is the loop's (GET ai-misses) unless the best fit is not an engine page.
    let target: string | null = null;
    // A site with no loop (aplayermode.com) has no one to write a new page, so "no page fits" is a to-do too.
    if (m.lane === "own") target = m.fit_url ?? (ctx.loop ? null : m.page_url ?? NEW_PAGE);
    else target = m.source_domain;
    if (!target) continue;
    const k = `${m.lane}|${target}`;
    const g = groups.get(k) ?? { lane: m.lane, target, channel: m.channel ?? null, rows: [] as any[] };
    g.rows.push(m); groups.set(k, g);
  }
  const entry = ctx.roster.find((x) => x.key === ctx.business);
  const actions: any[] = [];
  const ranked = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.target.localeCompare(b.target));
  for (const g of ranked) {
    const key = `growth#${ctx.business}#ai-${g.lane}-${slugOf(g.target)}`;
    const working = await workedBy(db, g.rows, ctx.runAt);
    if (working) { actions.push({ kind: "working", key: working, prompts: g.rows.length }); continue; }
    if (!entry) { actions.push({ kind: "refused", stop: "NOT_ON_ROSTER", why: `${ctx.business} has no Growth roster entry`, target: g.target }); continue; }
    const prompts = g.rows.map((m) => m.prompt);
    const ask = prompts.slice(0, 6).map((p) => `"${p}"`).join("; ");
    const draft = String(g.rows.find((m) => m.why)?.why ?? "").slice(0, 300);
    // OWN is a page on the site's own search-pages channel, in that channel's own format (Peace Be Still's is prayer-page).
    const pages = entry.channels.find((c) => c.channel === "search-pages");
    const item = g.lane === "own" ? { channel: "search-pages", format: pages?.formats[0] ?? "guide" }
      : g.lane === "claim" ? { channel: g.channel ?? "", format: "listing" }
      : g.lane === "earn" ? { channel: "outreach", format: "pitch" } : { channel: "outreach", format: "correction" };
    const what = g.lane === "own" && g.target === NEW_PAGE
      ? `own: write one page on ${ctx.host} that answers ${plural(prompts.length)} AI answers do not cite it for: ${ask}.`
      : g.lane === "own"
      ? `own: strengthen ${g.target} so it answers ${plural(prompts.length)} AI answers do not cite ${ctx.host} for: ${ask}.`
      : g.lane === "claim"
        ? `claim: ${ctx.host}'s listing on ${g.target}, which AI answers cite for ${plural(prompts.length)}: ${ask}. Fill it with the facts in the brain only.`
        : g.lane === "earn"
          ? `earn: a mention of ${ctx.host} on ${g.target}, which AI answers cite for ${plural(prompts.length)}: ${ask}. Draft the pitch only (outreach-voice: the editor's published contact, NeverBounce first, never a guessed address, no call, we never pay for a listing). Nothing is sent without her yes.`
          : `contest: ask ${g.target} to correct what AI answers cite it for on ${plural(prompts.length)}: ${ask}. Draft only; every claim checked against the risk brain; nothing is sent without her yes.`;
    const text = `${what}${draft ? ` Why: ${draft}` : ""}`;
    const named = namingProblems(text);
    if (named.length) { actions.push({ kind: "blocked", why: `naming: ${named.join("; ")}`, target: g.target }); continue; }
    const { rules, missing } = claimRules(entry, ctx.riskMd);
    if (missing.length) { actions.push({ kind: "held", why: `the risk brain has no words for ${missing.join(", ")}, so the claims check cannot run`, target: g.target }); continue; }
    const verdict = parseClaims(await ctx.model(env, claimsPrompt({ entry, rules, draft: text }) as any, "growth-claims"));
    if (!verdict) { actions.push({ kind: "held", why: "the claims check got no model answer, so it is held, never passed", target: g.target }); continue; }
    if (!verdict.pass) { actions.push({ kind: "blocked", why: `breaks ${verdict.broken.join(", ") || "a rule"}: ${verdict.why}`, target: g.target }); continue; }
    // CLAIM with no listing she holds: opening an account is hers (R-AI-02), so it is her card.
    const route = g.lane === "claim" && !g.channel ? { to: "card" as const, why: "the listing is not one she holds: opening it is her call (agents never open accounts)" }
      : g.lane === "contest" ? { to: "card" as const, why: "a correction to a third party is outreach and needs her yes" }
      : routeItem(ctx.roster, ctx.business, item);
    let todoKey: string | null = null;
    if (route.to === "refused") { actions.push({ kind: "refused", stop: route.stop, why: route.why, target: g.target }); continue; }
    if (route.to === "claims") {
      const q = await openTodo(db, entry, key, { title: `Growth Director: ${entry.label} — AI answers ${g.lane}: ${g.target}`, next: text, finish: `${g.target} ${g.lane === "own" ? "answers these questions" : "carries " + entry.label} and next week's AI answers are read` }, dayIdInZone(ctx.now));
      if (!q.id) { actions.push({ kind: "waiting", why: q.why, target: g.target }); continue; }
      todoKey = key;
      actions.push({ kind: "queued", key, lane: g.lane, target: g.target, prompts: prompts.length });
    } else {
      const title = `${entry.label}: AI answers ${g.lane}, ${LANE_WORDS[g.lane]} ${g.target}?`;
      if (ctx.asked.has(title.toLowerCase())) { actions.push({ kind: "waiting", why: `asked in the last ${ASKED_DAYS} days`, target: g.target }); continue; }
      if (ctx.budget.cards >= MAX_CARDS) { actions.push({ kind: "waiting", why: `${MAX_CARDS} cards already this run`, target: g.target }); continue; }
      const proposal = { what: g.lane === "claim" ? `${text} You open the account yourself; the agent sessions then fill it.` : text, why: route.why, evidence: `OpenSEO ${ctx.week}: ${plural(prompts.length)} not cited` };
      const approvalId = await card(env, entry, title, `${proposal.what}\n\nWhy it is a card: ${route.why}.`, { proposal, ai: { site: ctx.host, lane: g.lane, target: g.target, week: ctx.week } }, false);
      ctx.budget.cards++; ctx.asked.add(title.toLowerCase());
      todoKey = `card:${approvalId}`;
      actions.push({ kind: "card", lane: g.lane, target: g.target, prompts: prompts.length });
    }
    for (const m of g.rows) await db.prepare(`UPDATE ai_misses SET todo_key = ?, updated_at = ? WHERE id = ?`).bind(todoKey, ctx.now, m.id).run();
  }
  return actions;
}

/**
 * The to-do or card already working on this group, if any: an open to-do, a to-do finished after this
 * week's answers were collected (next week's read judges it), or a card she has not answered.
 */
async function workedBy(db: D1Database, rows: any[], runAt: number): Promise<string | null> {
  for (const key of new Set(rows.map((m) => m.todo_key).filter(Boolean) as string[])) {
    if (key.startsWith("card:")) {
      const j = await db.prepare(`SELECT state FROM judgement_calls WHERE approval_id = ?`).bind(key.slice(5)).first<{ state: string }>();
      if (j?.state === "awaiting") return key;
      continue;
    }
    const l = await db.prepare(`SELECT status, closed_at FROM owner_open_loops WHERE source_key = ?`).bind(key).first<{ status: string; closed_at: number | null }>();
    if (l && (l.status === "open" || (l.closed_at ?? 0) >= runAt)) return key;
  }
  return null;
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

export const AI_MISSES_PATH = "/api/growth/ai-misses";
