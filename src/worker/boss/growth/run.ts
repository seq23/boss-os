/**
 * THE GROWTH DIRECTOR'S WEEKLY CYCLE (21 Nov 2026). `duty_growth_director` (migration 0373) runs here,
 * on the Worker's hourly tick, Mondays at 06:00 Central (materialise.ts → `worker_job: "growth"`),
 * after the 05:20 scoreboard read. The rules are src/shared/boss/growth/director.mjs; this file reads
 * and writes:
 *
 *   1. MEASURE   the scoreboard (D1 growth_readings → summarize), the roster (the Growth sections of the
 *                porch-and-party and spry brains), her rulings (each business's groups of its brain's
 *                Settled decisions, rulingsFor in roster.mjs: nothing else of any brain), the risk rules
 *                by id. Rulings not read → that business is held; a missing group is a named problem.
 *   2. SCAN      Google's public US trending-searches feed (titles only); rivals' long-running ads are
 *                "not read" until a free source exists.
 *   3. DECIDE    per business, a FREE model (the router's free routes in order; none answering =
 *                "held: no model") reads the playbook, the roster entry, her rulings, the counts and
 *                the to-dos, within PROMPT_BUDGET_CHARS (over it, shared rulings are left out first,
 *                never the business's own, and the run says so). Ruling characters per business are
 *                logged on the cycle's audit row.
 *   4. QUEUE     each item through mayAct, then the claims check (a free model reads the draft against
 *                that brand's REQUIRED rules plus its roster limits; a rule with no words, or no answer =
 *                held). Passed → ONE Open Loops row per business × channel × format (source_key
 *                growth#…, owner "claude": the agent sessions that run her posting pipelines work it,
 *                posting only through that approved pipeline), at most MAX_OPEN_PER_BUSINESS open.
 *                A `backlinks` item is a link REQUEST to the outside backlink network (an `ordered` action,
 *                read by GET /api/boss/growth/backlink-orders; at most MAX_BACKLINKS_PER_CYCLE per business),
 *                never an Open Loops row or a card; unapproved, it is refused.
 *                Not approved / proposals → a judgement call in Decide (raiseJudgementCall, resume kind
 *                growth_proposal: her yes opens the follow-on row, her no is remembered ASKED_DAYS),
 *                at most MAX_CARDS a cycle, each cycle's cards replacing the last's. A proposal passes a
 *                model's spend/account check first; spend, accounts or no answer are refused.
 *   5. REPORT    one growth_decisions row per business, written as soon as it is decided (an error on a
 *                later business never loses it); `OUTPUT n decisions`.
 *
 * It never posts, sends, spends, creates or deletes anything. Pinned by tests/boss/growthDirector.test.ts.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { GROWTH_BRAINS, growthSection, parseRoster, rosterProblems, rulingsFor, type RosterEntry } from "../../../shared/boss/growth/roster.mjs";
import { playbookBody } from "../../../shared/boss/growth/playbook.mjs";
import {
  MAX_CARDS, MAX_OPEN_PER_BUSINESS, ASKED_DAYS, fitDecisionPrompt, PROMPT_BUDGET_CHARS, parseDecision, enforceHolds, claimsPrompt, parseClaims, claimRules,
  routeItem, routeProposal, spendPrompt, parseSpend, cycleEnd, namingProblems, pipelineKey, reportDue, reportSection, BACKLINKS, MAX_BACKLINKS_PER_CYCLE, TOPIC_MAX,
} from "../../../shared/boss/growth/director.mjs";
import { raiseJudgementCall } from "../approvals/raise";
import { latestReadings } from "../routes/growth";
import { getSetting, setSetting } from "../lib/settings";
import { putMorningSection } from "../mail/morningSection";
import { BOSS_ORIGIN } from "../../../shared/boss/research/page.mjs";

export const DIRECTOR = "emp_growth";
/** A row's own next step, without the Director's one line on top (written as "Growth Director, …\n"). */
export function withoutDirectorLine(step: string | null | undefined): string {
  return String(step ?? "").replace(/^Growth Director, [^\n]*\n/, "");
}
const REPORT_KEY = "growth_report_last_day";
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

export async function brainMd(db: D1Database, slug: string): Promise<string | null> {
  return (await db.prepare(`SELECT body_md FROM brains WHERE slug = ?`).bind(slug).first<{ body_md: string }>())?.body_md ?? null;
}

/** The roster from the growth brains only; a broken section is a named problem, never a quiet skip. */
/** Her words for the two growth brains, so a problem reads as a business, never a slug. */
const BRAIN_NAMES: Record<string, string> = { "porch-and-party": "Porch & Party", spry: "Spry Labs" };
export async function loadRoster(db: D1Database): Promise<{ roster: RosterEntry[]; problems: string[]; mds: Record<string, string | null> }> {
  const roster: RosterEntry[] = []; const problems: string[] = []; const mds: Record<string, string | null> = {};
  for (const slug of GROWTH_BRAINS) {
    const name = BRAIN_NAMES[slug] ?? slug;
    // One brain failing to read never stops the other's cycle, and never reads as "no rulings".
    let md: string | null = null;
    try { md = await brainMd(db, slug); } catch (e) { mds[slug] = null; problems.push(`${name}'s brain could not be read (${String((e as Error)?.message ?? e).slice(0, 120)}): its roster and rulings not read`); continue; }
    mds[slug] = md;
    if (!md) { problems.push(`${name}'s brain is missing: its roster and rulings not read`); continue; }
    try { const body = growthSection(slug, md); if (body) roster.push(...parseRoster(body, slug)); else problems.push(`${name}'s brain has no Growth section yet`); }
    catch (e) { problems.push(String((e as Error).message)); }
  }
  return { roster, problems: [...problems, ...rosterProblems(roster)], mds };
}

/** The pipeline to-do for one business × channel × format: one row, its draft refreshed each week. */
export const PIPELINE_OWNER = "claude";
async function queueRow(db: D1Database, entry: RosterEntry, item: { channel: string; format: string; draft: string }, nextDate: string): Promise<{ id: string | null; why?: string }> {
  return openTodo(db, entry, pipelineKey(entry.key!, item.channel, item.format), {
    title: `Growth Director: ${entry.label} — ${item.channel} ${item.format}`,
    next: `Post this through ${entry.label}'s approved ${item.channel} pipeline only, as written: ${item.draft}`,
    finish: `This week's ${item.format} is live on ${entry.label}'s ${item.channel}`,
  }, nextDate);
}

/**
 * One Growth to-do by its key (`growth#<business>#…`): refreshed when it exists, opened when the
 * business has under MAX_OPEN_PER_BUSINESS open. Shared by the Director's pipelines and the AI answers
 * loop (src/worker/boss/growth/aiAnswers.ts), so both count against the same cap.
 */
export async function openTodo(db: D1Database, entry: RosterEntry, key: string, t: { title: string; next: string; finish: string }, nextDate: string): Promise<{ id: string | null; why?: string }> {
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM owner_open_loops WHERE status = 'open' AND source_key LIKE ? AND source_key <> ?`).bind(`growth#${entry.key}#%`, key).first<{ n: number }>();
  const mine = await db.prepare(`SELECT id, status FROM owner_open_loops WHERE source_key = ?`).bind(key).first<{ id: string; status: string }>();
  if (!(mine?.status === "open") && (open?.n ?? 0) >= MAX_OPEN_PER_BUSINESS) return { id: null, why: `${entry.label} already has ${MAX_OPEN_PER_BUSINESS} growth to-dos open; this waits for one to finish` };
  const now = Date.now();
  const title = t.title.slice(0, 200), next = t.next.slice(0, 400), finish = t.finish.slice(0, 300);
  if (mine) {
    await db.prepare(`UPDATE owner_open_loops SET next_step = ?, next_date = ?, status = 'open', updated_at = ? WHERE id = ?`).bind(next, nextDate, now, mine.id).run();
    return { id: mine.id };
  }
  const id = newId("olp");
  await db.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,'not_finished','open','agent_report',?,?,?)`).bind(id, title, finish, next, PIPELINE_OWNER, nextDate, entry.brain, key, now, now).run();
  return { id };
}

/** Her card for something new: a judgement call whose yes opens the follow-on, never a dead approval. */
export async function card(env: Env, entry: RosterEntry, title: string, question: string, detail: Record<string, unknown>, first: boolean) {
  const r = await raiseJudgementCall(env, {
    title: title.slice(0, 200), question: question.slice(0, 1000), resumeKind: "growth_proposal",
    employeeId: DIRECTOR, lane: "ops", risk: "low",
    // Each cycle's cards replace the last cycle's still waiting: one current list, never a pile.
    supersedeKind: first ? "growth_proposal" : null,
    resumeDetail: { business: entry.key, brain: entry.brain, label: entry.label, ...detail },
  });
  return r.approvalId;
}

/** Titles she was asked about in the last ASKED_DAYS (answered or waiting): never asked again. */
export async function askedRecently(db: D1Database, now: number): Promise<Set<string>> {
  const rows = (await db.prepare(`SELECT title FROM judgement_calls WHERE resume_kind = 'growth_proposal' AND state <> 'superseded' AND created_at >= ?`).bind(now - ASKED_DAYS * 86_400_000).all<{ title: string }>()).results ?? [];
  return new Set(rows.map((r) => r.title.toLowerCase()));
}

/** What this business already has in motion, from its own earlier decisions (never Open Loops' titles). */
async function inMotion(db: D1Database, key: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT actions FROM growth_decisions WHERE business = ? AND state = 'decided' ORDER BY created_at DESC LIMIT 4`).bind(key).all<{ actions: string }>()).results ?? [];
  const out: string[] = [];
  for (const r of rows) {
    let acts: any[] = []; try { acts = JSON.parse(r.actions); } catch { acts = []; }
    for (const a of acts) if (a.kind === "queued" && a.item) out.push(`${a.item.channel} ${a.item.format} (queued)`); else if (a.kind === "proposal" && (a.proposal || a.item)) out.push(`asked her: ${a.proposal?.what ?? `${a.item.channel} ${a.item.format}`}`);
  }
  return [...new Set(out)].slice(0, 8);
}

/** The backlink topics this business already ordered, newest first, for the scale/stop rule (12 cycles). */
async function orderedTopics(db: D1Database, key: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT cycle, actions FROM growth_decisions WHERE business = ? AND state = 'decided' ORDER BY created_at DESC LIMIT 12`).bind(key).all<{ cycle: string; actions: string }>()).results ?? [];
  const out: string[] = [];
  for (const r of rows) {
    let acts: any[] = []; try { acts = JSON.parse(r.actions); } catch { acts = []; }
    if (Array.isArray(acts)) for (const a of acts) if (a?.kind === "ordered" && a.item?.topic) out.push(`${r.cycle}: ${a.item.topic}`);
  }
  return [...new Set(out)].slice(0, 24);
}

async function writeDecision(db: D1Database, r: any) {
  await db.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, evidence, test, actions, next_check, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(r.id, r.cycle, r.business, r.label, r.state, r.decision, JSON.stringify(r.evidence ?? []), r.test ? JSON.stringify(r.test) : null, JSON.stringify(r.actions ?? []), r.next_check ?? null, r.created_at).run();
}

export async function runGrowthDirector(env: Env, now = Date.now(), deps: { model?: Model; fetchImpl?: typeof fetch } = {}) {
  const model = deps.model ?? freeModel;
  const db = env.DB;
  const today = dayIdInZone(now);
  const cycle = today;
  const { latest, before } = await latestReadings(db);
  const summaries = summarize(manifest, latest, before, today);
  const { roster, problems, mds } = await loadRoster(db);
  const problem = (p: string) => { if (!problems.includes(p)) problems.push(p); };
  // Her rulings' size per business this cycle (characters added to the decision prompt), for the audit row.
  const rulingSizes: { business: string; chars: number; left: string[] }[] = [];
  const riskMd = (await brainMd(db, "risk")) ?? "";
  const trends = await readTrends(deps.fetchImpl ?? fetch);
  const playbook = playbookBody();
  const asked = await askedRecently(db, now);
  let cards = 0;
  const results: { key: string; state: string }[] = [];
  const rows: any[] = [];
  // Counted only once its row is written: a failed write is never a quiet "decided".
  const record = async (r: any) => { await writeDecision(db, r); rows.push(r); results.push({ key: r.business, state: r.state }); };

  for (const entry of roster) {
    const base = { id: newId("gdc"), cycle, business: entry.key ?? entry.label, label: entry.label, created_at: now };
    try {
      const s = summaries.find((x: any) => x.key === entry.key);
      if (entry.paused) { await record({ ...base, state: "paused", decision: `Paused: ${entry.paused}. Nothing measured, queued or posted.`, evidence: [], actions: [] }); continue; }
      if (entry.problems.length) { await record({ ...base, state: "held: roster", decision: `Held: its roster entry needs fixing first (${entry.problems.join("; ")}).`, evidence: [], actions: [] }); continue; }
      const rulings = rulingsFor(entry, mds[entry.brain] ?? null);
      for (const p of rulings.problems) problem(p);
      if (rulings.notRead) { await record({ ...base, state: "held: roster", decision: `Held: her rulings were not read (${rulings.notRead}), so nothing is decided without them; the next cycle tries again.`, evidence: [], actions: [] }); continue; }
      if (!s || s.state !== "read") { await record({ ...base, state: "held: no data", decision: "Held: nothing on the scoreboard was read for this business, so nothing is decided on zeros.", evidence: (s?.channels ?? []).map((c: any) => `${c.label}: ${c.unread}`), actions: [] }); continue; }
      const first = !(await db.prepare(`SELECT 1 FROM growth_decisions WHERE business = ? AND state = 'decided' LIMIT 1`).bind(entry.key).first());
      const todos = await inMotion(db, entry.key!);
      // The older work on this business's roster: the Director decides each row. Open Loops is LOCAL_ONLY
      // (migration 0331), so no row text goes to the model: it sees the id and the roster's own words for it
      // ("olp_x (what it is)" in the brain), and only open rows filed under this entry's brain, not hers, are
      // judged. A row's `business` is the BRAIN slug (the Director files its own rows that way, line above), so a
      // Spry Labs company's rows are 'spry', never its roster key: keying on the key hid every PBS row (22 Nov).
      const linkedIds = entry.linked.length ? ((await db.prepare(
        `SELECT id FROM owner_open_loops WHERE status = 'open' AND business = ? AND owner <> 'sequoia' AND id IN (SELECT value FROM json_each(?))`,
      ).bind(entry.brain, JSON.stringify(entry.linked)).all<{ id: string }>()).results ?? []).map((r) => r.id) : [];
      const linked = linkedIds.map((id) => ({ id, what: entry.linkedNotes[id] ?? "no description on the roster" }));
      const topics = entry.channels.some((c) => c.channel === BACKLINKS) ? await orderedTopics(db, entry.key!) : [];
      const fit = fitDecisionPrompt({ playbook, entry, summary: s, trends, today, todos, first, linked, topics, rulings });
      rulingSizes.push({ business: base.business, chars: fit.rulingChars, left: fit.left });
      if (fit.left.length) problem(`${entry.label}: the prompt was over ${PROMPT_BUDGET_CHARS} characters, so the shared rulings ${fit.left.map((h) => `"${h}"`).join(", ")} were left out this cycle`);
      if (fit.over) problem(`${entry.label}: the prompt is still over ${PROMPT_BUDGET_CHARS} characters with only its own rulings (${fit.chars})`);
      const answer = parseDecision(await model(env, fit.messages as Msg[], "growth-decide"));
      if (!answer) { await record({ ...base, state: "held: no model", decision: "Held: no free model answered (every free route was busy or spent); the next cycle tries again.", evidence: [], actions: [] }); continue; }
      const { decision, dropped } = enforceHolds(answer, s);
      const actions: any[] = [];
      if (dropped) actions.push({ kind: "held", why: dropped });
      if (decision.noTopic) actions.push({ kind: "held", why: `${decision.noTopic} backlink ${decision.noTopic === 1 ? "request had" : "requests had"} no topic of up to ${TOPIC_MAX} characters, so ${decision.noTopic === 1 ? "it was" : "they were"} dropped` });
      const { rules, missing } = claimRules(entry, riskMd);
      const raise = async (title: string, question: string, detail: Record<string, unknown>) => {
        if (asked.has(title.toLowerCase())) return { card: null, why: `asked in the last ${ASKED_DAYS} days` };
        if (cards >= MAX_CARDS) return { card: null, why: `${MAX_CARDS} cards already this week` };
        const id = await card(env, entry, title, question, detail, cards === 0);
        cards++; asked.add(title.toLowerCase());
        return { card: id };
      };
      let requested = 0;
      for (const item of decision.queue) {
        const named = namingProblems(item.draft);
        if (named.length) { actions.push({ kind: "blocked", why: `naming: ${named.join("; ")}`, item }); continue; }
        const r = routeItem(roster, entry.key!, item);
        if (r.to === "refused") { actions.push({ kind: "refused", stop: r.stop, why: r.why, item }); continue; }
        if (r.to === "card") {
          const c = await raise(`${entry.label}: try ${item.format || "a new format"} on ${item.channel}?`, `${item.why}\n\nDraft: ${item.draft}`, { item });
          actions.push({ kind: "proposal", why: c.why ?? r.why, item, card: c.card });
          continue;
        }
        // The network is an outside publisher: at most MAX_BACKLINKS_PER_CYCLE requests per business a cycle.
        if (item.channel === BACKLINKS && requested >= MAX_BACKLINKS_PER_CYCLE) { actions.push({ kind: "held", why: `at most ${MAX_BACKLINKS_PER_CYCLE} backlink request a week per business; this one was not sent`, item }); continue; }
        if (missing.length) { actions.push({ kind: "held", why: `the risk brain has no words for ${missing.join(", ")}, so the claims check cannot run`, item }); continue; }
        const verdict = parseClaims(await model(env, claimsPrompt({ entry, rules, draft: item.draft }) as Msg[], "growth-claims"));
        if (!verdict) { actions.push({ kind: "held", why: "the claims check got no model answer, so it is held, never passed", item }); continue; }
        if (!verdict.pass) { actions.push({ kind: "blocked", why: `breaks ${verdict.broken.join(", ") || "a rule"}: ${verdict.why}`, item }); continue; }
        // A backlinks item is a request to the outside network: written on this decision, never a to-do for anyone.
        if (item.channel === BACKLINKS) { requested++; actions.push({ kind: "ordered", item }); continue; }
        // A format on the roster is approved: it queues, first post included. Decide is only for a new
        // account, channel, price or anything paid (her ruling, 22 Nov 2026: "why are they asking me anything?").
        const q = await queueRow(db, entry, item, decision.next_check ?? today);
        actions.push(q.id ? { kind: "queued", loop: q.id, item } : { kind: "held", why: q.why, item });
      }
      for (const p of decision.proposals) {
        const named = namingProblems(`${p.what} ${p.why}`);
        if (named.length) { actions.push({ kind: "blocked", why: `naming: ${named.join("; ")}`, proposal: p }); continue; }
        const check = parseSpend(await model(env, spendPrompt(p) as Msg[], "growth-spend"));
        const r = routeProposal(roster, entry.key!, p, check);
        if (r.to === "refused") { actions.push({ kind: "refused", stop: r.stop, why: r.why, proposal: p }); continue; }
        const c = await raise(`${entry.label}: ${p.what}`, `${p.why}\n\nEvidence: ${p.evidence}`, { proposal: p });
        actions.push({ kind: "proposal", proposal: p, card: c.card, ...(c.why ? { why: c.why } : {}) });
      }
      // Her older rows get the Director's verdict, written where she and the working session read them.
      const judged = new Set<string>();
      for (const v of decision.linked ?? []) {
        if (judged.has(v.id) || !linked.some((l: any) => l.id === v.id)) continue; // once each, only rows it was shown
        judged.add(v.id);
        // The Director's line is ONE line on top; the step under it is the row's own (or the changed one).
        const say = `Growth Director, ${today}: ${v.verdict}. ${v.why.replace(/\s+/g, " ").trim()}`;
        if (v.verdict === "drop") {
          await db.prepare(`UPDATE owner_open_loops SET status = 'closed', closed_reason = ?, closed_at = ?, updated_at = ? WHERE id = ? AND business = ? AND status = 'open'`).bind(say.slice(0, 400), now, now, v.id, entry.brain).run();
        } else {
          const cur = await db.prepare(`SELECT next_step FROM owner_open_loops WHERE id = ?`).bind(v.id).first<{ next_step: string | null }>();
          const step = v.verdict === "change" ? v.next_step : withoutDirectorLine(cur?.next_step);
          await db.prepare(`UPDATE owner_open_loops SET next_step = ?, updated_at = ? WHERE id = ? AND business = ? AND status = 'open'`).bind(`${say}\n${step}`, now, v.id, entry.brain).run();
        }
        actions.push({ kind: "linked", id: v.id, verdict: v.verdict, why: v.why });
      }
      await record({ ...base, state: "decided", decision: decision.decision, evidence: decision.evidence, test: decision.test, next_check: decision.next_check, actions });
    } catch (e) {
      // One business's failure never loses the others' record, nor its own: it is written as held.
      const why = String((e as Error)?.message ?? e).slice(0, 300);
      if (!rows.some((r) => r.business === base.business)) await record({ ...base, state: "held: error", decision: `Held: the cycle failed for this business (${why}).`, evidence: [], actions: [] }).catch(() => undefined);
    }
  }

  const end = cycleEnd(results);
  await audit(db, { actor: "system", lane: "ops", entityType: "growth_cycle", entityId: cycle, action: end.ok ? "decided" : "held", detail: { line: end.line, problems, trends: trends.length, rulings: rulingSizes } });
  // Her report, every two weeks, as a section of Simone's morning email (written even on a held
  // cycle: "held, not guessed" is news too). The last day is kept so a missed Monday catches up.
  if (rows.length && reportDue(await getSetting(db, REPORT_KEY), today)) {
    const row = (manifest as any).rows.find((r: any) => r.id === "growth-director") ?? null;
    const obj = reportSection(rows, { cards, origin: BOSS_ORIGIN, at: now, summaries, scorecard: row });
    const bad = await putMorningSection(db, { section: "growth", job: "duty_growth_director", day: today, obj, now });
    if (bad.length) throw new Error(`NAMED STOP [GROWTH_REPORT_REFUSED] ${bad.join("; ")}`);
    await setSetting(db, REPORT_KEY, today);
  }
  if (!end.ok) throw new Error(`${end.line}${problems.length ? `; roster: ${problems.slice(0, 3).join("; ")}` : ""}`);
  return { written: results.filter((r) => r.state === "decided").length, line: end.line, problems, cards, rulings: rulingSizes };
}
