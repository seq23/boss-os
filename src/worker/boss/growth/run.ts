/**
 * THE GROWTH DIRECTOR'S WEEKLY CYCLE (21 Nov 2026). `duty_growth_director` (migration 0373) runs here,
 * on the Worker's hourly tick, Mondays at 06:00 Central (materialise.ts → `worker_job: "growth_director"`),
 * after the 05:20 scoreboard read. The rules are src/shared/boss/growth/director.mjs; this file reads
 * and writes:
 *
 *   1. MEASURE   the scoreboard (D1 growth_readings → summarize), the roster (the Growth sections of the
 *                porch-and-party and spry brains, nothing else of any brain), the risk rules by id.
 *   2. SCAN      Google's public US trending-searches feed (titles only); rivals' long-running ads are
 *                "not read" until a free source exists.
 *   3. DECIDE    per business, a FREE model (the router's free routes in order; none answering =
 *                "held: no model") reads the playbook, the roster entry, the counts and the to-dos.
 *   4. QUEUE     each item through mayAct, then the claims check (a free model reads the draft against
 *                that brand's rules; no answer = held). Passed → an Open Loops row for the Director;
 *                not approved / proposals → at most MAX_CARDS Decide cards; spend and accounts refused.
 *   5. REPORT    one growth_decisions row per business with its evidence; `OUTPUT n decisions`.
 *
 * It never posts, sends, spends, creates or deletes anything. Pinned by tests/boss/growthDirector.test.ts.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { GROWTH_BRAINS, growthSection, parseRoster, rosterProblems, type RosterEntry } from "../../../shared/boss/growth/roster.mjs";
import { playbookBody } from "../../../shared/boss/growth/playbook.mjs";
import {
  MAX_CARDS, decisionPrompt, parseDecision, enforceHolds, claimsPrompt, parseClaims, ruleText, routeItem, routeProposal, cycleEnd,
} from "../../../shared/boss/growth/director.mjs";
import { loopKey } from "../../../shared/boss/openLoops/openLoops.mjs";
import { latestReadings } from "../routes/growth";

export const DIRECTOR = "emp_growth";
const TREND_FEED = "https://trends.google.com/trending/rss?geo=US";

type Msg = { role: string; content: string };
/** The model seam: tests swap in a fake; production asks the router for a FREE route. null = no answer. */
export type Model = (env: Env, messages: Msg[], job: string) => Promise<string | null>;

export const freeModel: Model = async (env, messages, job) => {
  const { routeCompletion } = await import("../router");
  try {
    const r = await routeCompletion(env, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", risk: "low", employeeId: DIRECTOR,
      sensitivity: "private", freeOnly: true, maxOutputTokens: 1200, jobKey: job, messages,
    } as any);
    return r?.text ?? null;
  } catch { return null; }
};

export async function readTrends(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const r = await fetchImpl(TREND_FEED, { headers: { accept: "application/rss+xml" } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([^<]{2,120})<\/title>/g)].map((m) => m[1]!.trim()).slice(0, 20);
  } catch { return []; }
}

async function brainMd(db: D1Database, slug: string): Promise<string | null> {
  return (await db.prepare(`SELECT body_md FROM brains WHERE slug = ?`).bind(slug).first<{ body_md: string }>())?.body_md ?? null;
}

/** The roster from the growth brains only; a broken section is a named problem, never a quiet skip. */
export async function loadRoster(db: D1Database): Promise<{ roster: RosterEntry[]; problems: string[] }> {
  const roster: RosterEntry[] = []; const problems: string[] = [];
  for (const slug of GROWTH_BRAINS) {
    const md = await brainMd(db, slug);
    if (!md) { problems.push(`the ${slug} brain is missing`); continue; }
    try { const body = growthSection(slug, md); if (body) roster.push(...parseRoster(body, slug)); else problems.push(`the ${slug} brain has no Growth section`); }
    catch (e) { problems.push(String((e as Error).message)); }
  }
  return { roster, problems: [...problems, ...rosterProblems(roster)] };
}

async function openLoop(db: D1Database, title: string, finish: string, next: string, business: string, nextDate: string) {
  const open = (await db.prepare(`SELECT id, title FROM owner_open_loops WHERE status = 'open'`).all<{ id: string; title: string }>()).results ?? [];
  const same = open.find((l) => loopKey(l.title) === loopKey(title));
  if (same) return same.id;
  const id = newId("olp"); const now = Date.now();
  await db.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,'not_finished','open','agent_report',?,?)`).bind(id, title.slice(0, 200), finish.slice(0, 300), next.slice(0, 400), DIRECTOR, nextDate, business, now, now).run();
  return id;
}

async function card(db: D1Database, title: string, summary: string, payload: unknown) {
  const id = newId("apr"); const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
      VALUES (?,'ops',?,?,'growth_proposal','growth_director',?,'low',?,'pending',?,?)`).bind(id, title.slice(0, 200), summary.slice(0, 1000), DIRECTOR, JSON.stringify(payload), now, now + 14 * 86_400_000),
    db.prepare(`INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'raised',NULL)`).bind(newId("ape"), id, now),
  ]);
  return id;
}

export async function runGrowthDirector(env: Env, now = Date.now(), deps: { model?: Model; fetchImpl?: typeof fetch } = {}) {
  const model = deps.model ?? freeModel;
  const db = env.DB;
  const today = dayIdInZone(now);
  const cycle = today;
  const { latest, before } = await latestReadings(db);
  const summaries = summarize(manifest, latest, before, today);
  const { roster, problems } = await loadRoster(db);
  const riskMd = (await brainMd(db, "risk")) ?? "";
  const trends = await readTrends(deps.fetchImpl ?? fetch);
  const playbook = playbookBody();
  const openTodos = (await db.prepare(`SELECT title, business FROM owner_open_loops WHERE status = 'open' AND owner = ?`).bind(DIRECTOR).all<{ title: string; business: string }>()).results ?? [];
  let cards = 0;
  const results: { key: string; state: string }[] = [];
  const rows: any[] = [];

  for (const entry of roster) {
    const s = summaries.find((x: any) => x.key === entry.key);
    const base = { id: newId("gdc"), cycle, business: entry.key, label: entry.label, created_at: now };
    if (entry.paused) { results.push({ key: entry.key!, state: "paused" }); rows.push({ ...base, state: "paused", decision: `Paused: ${entry.paused}. Nothing measured, queued or posted.`, evidence: [], actions: [] }); continue; }
    if (!s || s.state !== "read") { results.push({ key: entry.key!, state: "held: no data" }); rows.push({ ...base, state: "held: no data", decision: "Held: nothing on the scoreboard was read for this business, so nothing is decided on zeros.", evidence: (s?.channels ?? []).map((c: any) => `${c.label}: ${c.unread}`), actions: [] }); continue; }
    const first = !(await db.prepare(`SELECT 1 FROM growth_decisions WHERE business = ? AND state = 'decided' LIMIT 1`).bind(entry.key).first());
    const todos = openTodos.filter((t) => t.business === entry.brain).map((t) => t.title);
    const answer = parseDecision(await model(env, decisionPrompt({ playbook, entry, summary: s, trends, today, todos, first }) as Msg[], "growth-decide"));
    if (!answer) { results.push({ key: entry.key!, state: "held: no model" }); rows.push({ ...base, state: "held: no model", decision: "Held: no free model answered (every free route was busy or spent); the next cycle tries again.", evidence: [], actions: [] }); continue; }
    const { decision, dropped } = enforceHolds(answer, s);
    const actions: any[] = [];
    if (dropped) actions.push({ kind: "held", why: dropped });
    const rules = entry.limits.map((id) => ({ id, text: ruleText(riskMd, id) ?? "(rule text not found in the risk brain)" }));
    for (const item of decision.queue) {
      const r = routeItem(roster, entry.key!, item);
      if (r.to === "refused") { actions.push({ kind: "refused", stop: r.stop, why: r.why, item }); continue; }
      if (r.to === "card") {
        if (cards >= MAX_CARDS) { actions.push({ kind: "proposal", why: r.why, item, card: null }); continue; }
        cards++; actions.push({ kind: "proposal", why: r.why, item, card: await card(db, `${entry.label}: try ${item.format || "a new format"} on ${item.channel}?`, `${item.why}\n\nDraft: ${item.draft}`, { business: entry.key, item }) });
        continue;
      }
      const verdict = parseClaims(await model(env, claimsPrompt({ entry, rules, draft: item.draft }) as Msg[], "growth-claims"));
      if (!verdict) { actions.push({ kind: "held", why: "the claims check got no model answer, so it is held, never passed", item }); continue; }
      if (!verdict.pass) { actions.push({ kind: "blocked", why: `breaks ${verdict.broken.join(", ") || "a rule"}: ${verdict.why}`, item }); continue; }
      const loop = await openLoop(db, `${entry.label}: ${item.channel} ${item.format} — ${item.draft.slice(0, 70)}`, `Posted on ${entry.label}'s ${item.channel} through its approved pipeline`, `Growth Director: hand this ${item.format} to the ${item.channel} pipeline as written; draft: ${item.draft.slice(0, 260)}`, entry.brain, decision.next_check ?? today);
      actions.push({ kind: "queued", loop, item });
    }
    for (const p of decision.proposals) {
      const r = routeProposal(roster, entry.key!, p);
      if (r.to === "refused") { actions.push({ kind: "refused", stop: r.stop, why: r.why, proposal: p }); continue; }
      if (cards >= MAX_CARDS) { actions.push({ kind: "proposal", proposal: p, card: null }); continue; }
      cards++; actions.push({ kind: "proposal", proposal: p, card: await card(db, `${entry.label}: ${p.what}`.slice(0, 200), `${p.why}\n\nEvidence: ${p.evidence}`, { business: entry.key, proposal: p }) });
    }
    results.push({ key: entry.key!, state: "decided" });
    rows.push({ ...base, state: "decided", decision: decision.decision, evidence: decision.evidence, test: decision.test, next_check: decision.next_check, actions });
  }

  const end = cycleEnd(results);
  const stmts = rows.map((r) => db.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, evidence, test, actions, next_check, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(r.id, r.cycle, r.business, r.label, r.state, r.decision, JSON.stringify(r.evidence ?? []), r.test ? JSON.stringify(r.test) : null, JSON.stringify(r.actions ?? []), r.next_check ?? null, r.created_at));
  if (stmts.length) await db.batch(stmts);
  await audit(db, { actor: "system", lane: "ops", entityType: "growth_cycle", entityId: cycle, action: end.ok ? "decided" : "held", detail: { line: end.line, problems, trends: trends.length } });
  if (!end.ok) throw new Error(`${end.line}${problems.length ? `; roster: ${problems.slice(0, 3).join("; ")}` : ""}`);
  return { written: results.filter((r) => r.state === "decided").length, line: end.line, problems, cards };
}
