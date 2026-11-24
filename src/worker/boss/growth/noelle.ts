/**
 * NOELLE'S RECORD (23 Nov 2026; plan artifact 8LfYgMaHj7XLVB1fJ1vYxM, gap review G1-G21).
 *
 * Noelle is a scheduled Claude session on her Mac (scripts/ops/noelle.sh → ~/bin/ai-run --role brain)
 * with NO tools: code collects what she reads, she writes one plan, code acts. This file is the Boss OS
 * half, and it is the authority: the Mac's plan is re-checked here (checkPlan, the same gate the Mac ran)
 * against the roster read HERE, before anything is written or handed back to act on.
 *
 *   GET  /noelle/context   (machine token) the roster (public fields), her rulings per business with the
 *                          privacy check already run (a leak holds that business, the words never leave),
 *                          the scoreboard grid, the open linked rows, recent runs, this week's calls.
 *   POST /noelle/plan      (machine token) { day, slot, kind, calls, plan, reads, facts } → re-checked;
 *                          growth_decisions (one per business), cards for her calls, linked verdicts;
 *                          returns only the ACCEPTED acts for the Mac to carry out. The same day, slot
 *                          and kind posted again is a replay: the first run's id, nothing accepted, no rows.
 *   POST /noelle/done      (machine token) { run, published, failed, checked } or { day, slot, kind, stop }
 *                          → the Notices lines ("Noelle published: …"), the run's end, the 14-day report.
 *
 * `duty_growth_director` (migration 0378) is Noelle's heartbeat on the Worker: 22:05 Central daily it runs
 * noelleWatch — no run row today → "Noelle did not run" in tomorrow's morning email (G16a); the same stop
 * three days running → one line to Sequoia (G16b).
 *
 * Never: a post, an email, a spend, an account, a delete of anyone's data. Pinned by tests/boss/noelleRun.test.ts.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { rulingsFor } from "../../../shared/boss/growth/roster.mjs";
import { privateOnlyTerms, leaksIn, termCount } from "../../../shared/boss/growth/privacy.mjs";
import { playbookBody } from "../../../shared/boss/growth/playbook.mjs";
import { MAX_CARDS, reportDue, reportSection } from "../../../shared/boss/growth/director.mjs";
import {
  checkPlan, slotOf, sourceProblems, missingDecisions, readGrid, season, slotFor, callBudget, didNotRunLine, escalations, noticeLine,
  WEEK_CALLS, KINDS, MAC_KINDS,
} from "../../../shared/boss/growth/noelle.mjs";
import { appendToSection } from "../../../shared/boss/mail/morningSections.mjs";
import { latestReadings } from "../routes/growth";
import { getSetting, setSetting } from "../lib/settings";
import { putMorningSection } from "../mail/morningSection";
import { BOSS_ORIGIN } from "../../../shared/boss/research/page.mjs";
import { DIRECTOR, askedRecently, card, loadRoster, withoutDirectorLine } from "./run";

const DAY_MS = 86_400_000;
const REPORT_KEY = "growth_report_last_day";
const MAX_ACTIONS = 120;
const MAX_PUBLISHED = 60;
const parse = <T>(t: unknown, d: T): T => { try { return typeof t === "string" ? JSON.parse(t) : d; } catch { return d; } };
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d);
const weekOf = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/**
 * What the Growth page says Noelle last saw queued, per business and channel: a number, or "not read: …"
 * when that read failed (never "nothing scheduled" on a failed read). No run in 2 days → every queue not read.
 */
/** Stops that are a Notices line as well as the run card (Rule 0 and the 3-days alarm). */
export const NOTICE_STOPS = new Set(["NOTHING_ACTED", "UNDER_3_DAYS", "CHANNEL_UNREAD", "CALENDAR_UNREAD", "NOTHING_TO_RENDER"]);

export async function queueView(db: D1Database, now = Date.now()) {
  const r = await db.prepare(`SELECT day, state, stops, line, reads, created_at FROM noelle_runs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(now - 2 * DAY_MS).first<any>();
  if (!r) return { last: null, queues: {} as Record<string, Array<{ channel: string; value: number | null; unread: string | null }>>, unread: "not read: Noelle has not run in two days" };
  const reads = parse<any>(r.reads, {});
  const out: Record<string, Array<{ channel: string; value: number | null; unread: string | null }>> = {};
  const add = (k: string, value: number | null, unread: string | null) => { const [biz, ch] = k.split(":"); if (!biz || !ch) return; (out[biz] ??= []).push({ channel: ch, value, unread }); };
  for (const [k, v] of Object.entries(reads.queues ?? {})) if (!(reads.unread ?? {})[k]) add(k, Number(v), null);
  for (const [k, v] of Object.entries(reads.unread ?? {})) add(k, null, `not read: ${v}`);
  return { last: { day: r.day, state: r.state, stops: parse<string[]>(r.stops, []), line: r.line }, queues: out, unread: null };
}

/** The runs of the last `days` days, newest first, each with its stops as a list. */
export async function recentRuns(db: D1Database, today: string, days = 10) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
  const rows = (await db.prepare(`SELECT * FROM noelle_runs WHERE day >= ? ORDER BY created_at DESC`).bind(from).all<any>()).results ?? [];
  return rows.map((r) => ({ ...r, stops: parse<string[]>(r.stops, []) }));
}

async function weekCalls(db: D1Database, today: string) {
  const r = await db.prepare(`SELECT COALESCE(SUM(calls), 0) AS n FROM noelle_runs WHERE day >= ?`).bind(weekOf(today)).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Backlink requests ordered in the last 28 days per business (the 1-in-4 rule counts against these). */
async function orderedRecent(db: D1Database, now: number) {
  const rows = (await db.prepare(`SELECT business, actions FROM growth_decisions WHERE state = 'decided' AND created_at >= ?`).bind(now - 28 * DAY_MS).all<{ business: string; actions: string }>()).results ?? [];
  const out: Record<string, number> = {};
  for (const r of rows) for (const a of parse<any[]>(r.actions, [])) if (a?.kind === "ordered") out[r.business] = (out[r.business] ?? 0) + 1;
  return out;
}

/** The open rows each roster entry links (her older work, G15 keeps three of them open on purpose). */
async function linkedOpen(db: D1Database, roster: any[]) {
  const ids = [...new Set(roster.flatMap((e) => e.linked ?? []))];
  if (!ids.length) return [] as string[];
  const rows = (await db.prepare(`SELECT id FROM owner_open_loops WHERE status = 'open' AND owner <> 'sequoia' AND id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{ id: string }>()).results ?? [];
  return rows.map((r) => r.id);
}

/**
 * What the session may read, built and checked HERE. Each business's rulings pass the privacy check
 * (privateOnlyTerms over every growth brain): a private word or a personal address holds that business
 * (NAMED STOP [PRIVATE_IN_PROMPT]); no private word known at all is [PRIVACY_UNREAD] for every business.
 * Only the counts and the headings are said, never the word.
 */
export async function noelleContext(env: Env, now = Date.now()) {
  const db = env.DB;
  const today = dayIdInZone(now);
  const { roster, problems, mds } = await loadRoster(db);
  const { latest, before } = await latestReadings(db);
  const summaries = summarize(manifest, latest, before, today);
  const playbook = playbookBody();
  let terms: ReturnType<typeof privateOnlyTerms> | null = null;
  try { terms = privateOnlyTerms(mds, playbook); } catch { terms = null; }
  const businesses = roster.map((e: any) => {
    const pub = { key: e.key, label: e.label, brain: e.brain, tier: e.tier, buyer: e.buyer, offer: e.offer, money: e.money, channels: e.channels, languages: e.languages, limits: e.limits, season: e.season, paused: e.paused, problems: e.problems, linked: e.linked, linkedNotes: e.linkedNotes };
    const r = rulingsFor(e, mds[e.brain] ?? null);
    const text = [...r.own, ...r.shared].map((g: any) => `### ${g.heading}\n${g.body}`).join("\n\n");
    if (r.notRead) return { ...pub, rulings: "", held: `her rulings were not read (${r.notRead})` };
    if (!terms || !termCount(terms)) return { ...pub, rulings: "", held: "NAMED STOP [PRIVACY_UNREAD] no confidential word could be read from her growth brains, so a client name cannot be told from any other word" };
    const hit = leaksIn(`${JSON.stringify(pub)}\n${text}`, terms);
    if (hit.private || hit.mail) return { ...pub, rulings: "", held: `NAMED STOP [PRIVATE_IN_PROMPT] ${hit.private} private word(s) and ${hit.mail} personal address(es) in this business's rulings or roster; mark them confidential in the brain` };
    return { ...pub, rulings: text, held: null };
  });
  const measures = summaries.flatMap((s: any) => (s.channels ?? []).map((c: any) => ({ business: s.key, channel: c.channel, language: c.language, value: c.value, unread: c.unread })));
  const runs = await recentRuns(db, today);
  const calls = await weekCalls(db, today);
  const misses = (await db.prepare(`SELECT id, site, prompt, lane, fix_attempts, todo_key FROM ai_misses WHERE fixed_week IS NULL ORDER BY site, first_missed_week LIMIT 120`).all<any>()).results ?? [];
  const asked = [...(await askedRecently(db, now))];
  return {
    today, season: season(today), slot: slotFor(today), budget: callBudget({ weekUsed: calls }), weekCalls: calls, weekLimit: WEEK_CALLS,
    businesses, problems, summaries, grid: readGrid(roster, measures), linkedOpen: await linkedOpen(db, roster),
    orderedRecent: await orderedRecent(db, now), runs: runs.slice(0, 10).map((r) => ({ day: r.day, kind: r.kind, state: r.state, stops: r.stops, line: r.line })),
    aiMisses: misses, asked,
  };
}

/** Facts only the Mac can read (queues, caps, articles, accounts); any other key is dropped. */
function cleanFacts(f: any) {
  const nums = (o: any) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => typeof k === "string" && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
  const strs = (a: any) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.length < 80).slice(0, 60) : []);
  const why = (o: any) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => k.length < 80 && typeof v === "string" && v.trim()).slice(0, 80).map(([k, v]) => [k, String(v).slice(0, 160)]));
  return { queues: nums(f?.queues), caps: nums(f?.caps), articles: nums(f?.articles), accounts: strs(f?.accounts), bufferFull: strs(f?.bufferFull), unread: why(f?.unread) };
}

export function planProblems(body: any): string[] {
  const p: string[] = [];
  if (!body || typeof body !== "object") return ["not an object"];
  if (!isDay(body.day)) p.push("no day");
  if (!["daily", "weekly"].includes(body.kind)) p.push("kind is daily or weekly");
  if (!Number.isInteger(body.calls) || body.calls < 0) p.push("calls is a whole number");
  if (!body.plan || !Array.isArray(body.plan.actions)) p.push("no plan.actions");
  else if (body.plan.actions.length > MAX_ACTIONS) p.push(`at most ${MAX_ACTIONS} actions`);
  if (!body.reads || typeof body.reads !== "object") p.push("no reads");
  if (!slotOf(body.slot)) p.push("slot is HH:MM, or call:<task id> for a #noelle call (one plan per slot)");
  if (JSON.stringify(body).length > 400_000) p.push("over 400 KB");
  return p;
}

/**
 * The plan, re-checked and recorded. Returns { run, accepted, refused, lines, stops } — `accepted` is the
 * only list the Mac acts on. A run over its call budget is refused whole, never half-acted.
 */
export async function recordPlan(env: Env, body: any, now = Date.now()) {
  const db = env.DB;
  const today = body.day as string;
  // A replay (the Mac retried, a second launch of the same slot): the first run stands, and nothing is acted twice.
  // A prior row still 'planned' is a run that died between /plan and /done (the Mac rebooted): the Mac
  // always posts /done after act, under one lock. It is closed [ACT_LOST] and the answer says so, so the
  // Mac marks the day stopped and the 2-hour retry runs as a new slot; a lost day never reads "done".
  const prior = await db.prepare(`SELECT id, state FROM noelle_runs WHERE day = ? AND slot = ? AND kind = ? AND state IN ('planned','done')`).bind(today, slotOf(body.slot), body.kind).first<{ id: string; state: string }>();
  if (prior?.state === "planned") {
    await db.prepare(`UPDATE noelle_runs SET state = 'stopped', stops = ?, line = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(["ACT_LOST"]), "NAMED STOP [ACT_LOST] planned but never finished; the retry runs as a new slot", now, prior.id).run();
    return { run: prior.id, replay: true, lost: true, accepted: [], refused: [], lines: [], notices: [], roster: [], stops: ["NAMED STOP [ACT_LOST]"], decisions: 0 };
  }
  if (prior) return { run: prior.id, replay: true, accepted: [], refused: [], lines: [], notices: [], roster: [], stops: [], decisions: 0 };
  const runId = newId("nrn");
  const { roster } = await loadRoster(db);
  const used = await weekCalls(db, today);
  const budget = callBudget({ weekUsed: used, runUsed: 0 });
  const stops: string[] = [];
  const slot = slotOf(body.slot);
  if (used + body.calls > WEEK_CALLS || !budget.left) {
    const stop = budget.stop ?? `NAMED STOP [WEEK_CALL_BUDGET] this run's ${body.calls} calls would pass the week's ${WEEK_CALLS}`;
    await db.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES (?,?,?,?,'stopped',?,?,?,?,?)`)
      .bind(runId, today, slot, body.kind, JSON.stringify([stop.match(/\[([A-Z0-9_]+)\]/)?.[1] ?? "WEEK_CALL_BUDGET"]), body.calls, stop, now, now).run();
    return { run: runId, accepted: [], refused: [], lines: [], stops: [stop] };
  }
  // Claim the slot BEFORE any row is written: two posts racing for one slot, the second meets the unique index.
  try {
    await db.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES (?,?,?,?,'planned','[]',?,'planning',?,?)`)
      .bind(runId, today, slot, body.kind, body.calls, now, now).run();
  } catch (e) {
    if (!/UNIQUE/i.test(String((e as Error)?.message ?? e))) throw e;
    const won = await db.prepare(`SELECT id FROM noelle_runs WHERE day = ? AND slot = ? AND kind = ? AND state IN ('planned','done')`).bind(today, slot, body.kind).first<{ id: string }>();
    return { run: won?.id ?? null, replay: true, accepted: [], refused: [], lines: [], notices: [], roster: [], stops: [], decisions: 0 };
  }
  // The slot is claimed: a throw from here on marks the claimed row stopped, so a retry is a new run, never a replay of nothing.
  try {
    return await planClaimed(env, body, { runId, roster, stops, today, now });
  } catch (e) {
    const why = `NAMED STOP [PLAN_FAILED] ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    await db.prepare(`UPDATE noelle_runs SET state = 'stopped', stops = '["PLAN_FAILED"]', line = ?, updated_at = ? WHERE id = ?`).bind(why, now, runId).run();
    throw e;
  }
}

async function planClaimed(env: Env, body: any, { runId, roster, stops, today, now }: { runId: string; roster: any[]; stops: string[]; today: string; now: number }) {
  const db = env.DB;
  const facts = cleanFacts(body.facts);
  const { unread, ...gateFacts } = facts;
  const ctx = { roster, today, ...gateFacts, orderedRecent: await orderedRecent(db, now), linkedOpen: await linkedOpen(db, roster) };
  const checked = checkPlan(body.plan, ctx);
  for (const s of sourceProblems(body.reads, now)) stops.push(`NAMED STOP [${s.stop}] ${s.why}`);
  // B2/G14: every source gets a decision per business per WEEK, so only the weekly run owes them all.
  const owed = body.kind === "weekly" ? missingDecisions(roster.filter((e: any) => !e.problems?.length), checked.accepted) : [];
  const asked = await askedRecently(db, now);
  let cards = 0;
  const raise = async (e: any, title: string, question: string, detail: Record<string, unknown>) => {
    if (asked.has(title.toLowerCase())) return { card: null, why: "asked in the last four weeks" };
    if (cards >= MAX_CARDS) return { card: null, why: `${MAX_CARDS} cards already this run` };
    const id = await card(env, e, title, question, detail, false);
    cards++; asked.add(title.toLowerCase());
    return { card: id, why: null };
  };
  const rows: any[] = [];
  for (const e of roster as any[]) {
    const mine = (x: any) => x?.business === e.key;
    const decisions = checked.accepted.filter((a: any) => mine(a) && a.kind === "decision");
    const acts = checked.accepted.filter((a: any) => mine(a) && a.kind !== "decision");
    const refused = checked.refused.filter((r: any) => mine(r.action));
    const lines = checked.lines.filter(mine);
    const missing = owed.filter(mine);
    if (!decisions.length && !acts.length && !refused.length && !lines.length && !missing.length) continue;
    const id = newId("gdc");
    const actions: any[] = [];
    for (const a of acts) {
      if (a.kind === "backlink") { actions.push({ kind: "ordered", item: { channel: "backlinks", format: "article", topic: a.topic, draft: a.draft ?? a.why ?? "", why: a.why ?? "" } }); continue; }
      if (a.kind === "proposal" || a.kind === "sequoia-line") {
        const c = await raise(e, `${e.label}: ${String(a.what ?? "").slice(0, 160)}`, `${a.why ?? ""}${a.evidence ? `\n\nEvidence: ${a.evidence}` : ""}`, { proposal: { what: a.what, why: a.why, evidence: a.evidence, from: a.from ?? "noelle" } });
        actions.push({ kind: "proposal", proposal: { what: a.what, why: a.why }, card: c.card, ...(c.why ? { why: c.why } : {}) });
        continue;
      }
      if (a.kind === "linked") {
        const say = `Growth Director, ${today}: ${a.verdict}. ${String(a.why ?? "").replace(/\s+/g, " ").trim()}`;
        const cur = await db.prepare(`SELECT next_step FROM owner_open_loops WHERE id = ? AND business = ? AND status = 'open'`).bind(a.id, e.brain).first<{ next_step: string | null }>();
        if (!cur) { actions.push({ kind: "refused", stop: "NOT_LINKED", why: `${a.id} is not an open row of ${e.label}` }); continue; }
        const step = a.verdict === "change" && typeof a.next_step === "string" ? a.next_step : withoutDirectorLine(cur.next_step);
        await db.prepare(`UPDATE owner_open_loops SET next_step = ?, updated_at = ? WHERE id = ? AND business = ? AND status = 'open'`).bind(`${say}\n${step}`, now, a.id, e.brain).run();
        actions.push({ kind: "linked", id: a.id, verdict: a.verdict, why: a.why });
        continue;
      }
      actions.push({ ...a, kind: a.kind });
    }
    for (const l of lines) {
      const c = await raise(e, String(l.what).slice(0, 200), l.why ?? "", { line: l });
      actions.push({ kind: "proposal", proposal: { what: l.what, why: l.why }, card: c.card, ...(c.why ? { why: c.why } : {}) });
    }
    for (const r of refused) actions.push({ kind: "refused", stop: r.stop, why: r.why, action: { kind: r.action?.kind, channel: r.action?.channel, format: r.action?.format } });
    const evidence = decisions.map((d: any) => `${d.source}${d.sha ? `@${String(d.sha).slice(0, 12)}` : ""}${d.file ? ` (${d.file})` : ""}: ${String(d.decision ?? "").slice(0, 400)}`);
    for (const m of missing) evidence.push(`NAMED STOP [NO_DECISION] no decision on ${m.source}`);
    const test = acts.find((a: any) => a.kind === "test") ?? null;
    const row = {
      // An accepted act (a backlink order, a target) is a decision too: a row held "no data" would hide it from the
      // backlink network's read and from the 1-in-4 count.
      id, cycle: today, business: e.key, label: e.label, state: decisions.length || acts.length ? "decided" : "held: no data",
      decision: decisions.length ? String(decisions[0].decision ?? "").slice(0, 600)
        : acts.length ? `Acted: ${[...new Set(acts.map((a: any) => a.kind))].join(", ")}.`
        : `Held: no decision was made on ${missing.map((m: any) => m.source).join(", ") || "its sources"}.`,
      evidence, test: test ? { channel: test.channel, format: test.format, what: test.what, number: test.number, stop: test.stop } : null, actions, next_check: null, created_at: now,
    };
    await db.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, evidence, test, actions, next_check, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.id, row.cycle, row.business, row.label, row.state, row.decision, JSON.stringify(row.evidence), row.test ? JSON.stringify(row.test) : null, JSON.stringify(row.actions), null, now).run();
    rows.push(row);
  }
  for (const m of owed) stops.push(`NAMED STOP [NO_DECISION] ${m.business}: no decision on ${m.source}`);
  const codes = [...new Set(stops.map((s) => s.match(/\[([A-Z0-9_]+)\]/)?.[1]).filter(Boolean) as string[])];
  const sources = Object.fromEntries(Object.entries(body.reads ?? {}).slice(0, 80).map(([k, v]: [string, any]) => [k.slice(0, 80), { at: v?.at ?? null, sha: v?.sha ? String(v.sha).slice(0, 40) : null, error: v?.error ? String(v.error).slice(0, 160) : null }]));
  await db.prepare(`UPDATE noelle_runs SET stops = ?, line = ?, reads = ?, notices = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(codes), `${checked.accepted.length} accepted, ${checked.refused.length} refused, ${cards} cards`, JSON.stringify({ sources, queues: facts.queues, unread }), JSON.stringify(checked.notices.map((x: any) => x.key)), now, runId).run();
  await audit(db, { actor: DIRECTOR, lane: "ops", entityType: "noelle_run", entityId: runId, action: "planned", detail: { accepted: checked.accepted.length, refused: checked.refused.map((r: any) => r.stop), stops: codes, cards } });
  // The acts the Mac carries out: only kinds with a lever there (owned jobs' targets, Studio, search-loop, outreach lists, tests).
  const toAct = checked.accepted.filter((a: any) => MAC_KINDS.includes(a.kind));
  return { run: runId, accepted: toAct, refused: checked.refused, lines: checked.lines, notices: checked.notices, roster: checked.roster, stops, decisions: rows.length };
}

/** The run's end: publish notices (one per NEW thing, deduped by key), the stop, the 14-day report. */
export async function recordDone(env: Env, body: any, now = Date.now()) {
  const db = env.DB;
  let today = isDay(body?.day) ? body.day : dayIdInZone(now);
  // A run that stopped before any plan (exit 76 out of credits, a NAMED STOP in the Mac's read).
  if (!body?.run) {
    const stop = String(body?.stop ?? "").slice(0, 400);
    const code = stop.match(/\[([A-Z0-9_]+)\]/)?.[1];
    if (!code) throw new Error("A stopped run must name its stop code in brackets, e.g. [CLAUDE_LIMIT]");
    const id = newId("nrn");
    await db.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES (?,?,?,?,'stopped',?,?,?,?,?)`)
      .bind(id, today, slotOf(body.slot), body.kind === "weekly" ? "weekly" : "daily", JSON.stringify([code]), Number.isInteger(body.calls) ? body.calls : 0, stop, now, now).run();
    return { run: id, state: "stopped", notices: 0 };
  }
  const run = await db.prepare(`SELECT * FROM noelle_runs WHERE id = ?`).bind(String(body.run)).first<any>();
  if (!run || run.state !== "planned") throw new Error("No planned run by that id");
  // The run's own day, never the clock: a 22:00 run whose render ends after midnight still reports its decisions.
  if (isDay(run.day)) today = run.day;
  const { roster } = await loadRoster(db);
  let notices = 0;
  // Only a new thing the gate passed for THIS run may be announced (an injected plan or a confused act cannot).
  const passed = new Set(parse<string[]>(run.notices, []));
  const published = (Array.isArray(body.published) ? body.published : []).slice(0, MAX_PUBLISHED);
  for (const p of published) {
    const e = roster.find((x: any) => x.key === p?.business);
    if (!e || typeof p.what !== "string" || typeof p.where !== "string" || typeof p.key !== "string" || !passed.has(p.key) || !p.key.startsWith(`noelle:${e.key}:`)) continue;
    const link = typeof p.link === "string" && /^https:\/\//.test(p.link) ? p.link : null;
    const line = noticeLine({ label: e.label, what: p.what.slice(0, 160), where: p.where.slice(0, 80), link });
    const have = await db.prepare(`SELECT 1 FROM boss_task_notices WHERE task_id = ? AND kind = 'update' LIMIT 1`).bind(p.key.slice(0, 200)).first();
    if (have) continue;
    await db.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Noelle','update',?,?,?,0)`)
      .bind(newId("ntc"), p.key.slice(0, 200), line.slice(0, 200), line, now).run();
    notices++;
  }
  // Each job change she opened is told once on Notices (she publishes; "just tell me explicitly").
  for (const j of (Array.isArray(body.jobs) ? body.jobs : []).slice(0, 20)) {
    const e = roster.find((x: any) => x.key === String(j?.tag ?? "").split(" ")[0]);
    if (!e || typeof j.pr !== "string" || !/^seq23\/[\w.-]+#\d+$/.test(j.pr)) continue;
    const key = `noelle:job:${j.pr}`;
    if (await db.prepare(`SELECT 1 FROM boss_task_notices WHERE task_id = ? LIMIT 1`).bind(key).first()) continue;
    const channel = String(j.tag).split(" ")[1] ?? "";
    const line = `Noelle changed ${e.label} ${channel}: ${String(j.what ?? "a job change").slice(0, 160)} (lands on green checks) https://github.com/${j.pr.replace("#", "/pull/")}`;
    await db.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Noelle','update',?,?,?,0)`)
      .bind(newId("ntc"), key, line.slice(0, 200), line, now).run();
    notices++;
  }
  // RULE 0: a red stop (nothing acted, a channel under 3 days ahead or unread) is a Notices line too, once per run and stop.
  for (const f of (Array.isArray(body.failed) ? body.failed : []).slice(0, 40)) {
    const why = String(f?.why ?? "");
    const code = why.match(/NAMED STOP \[([A-Z0-9_]+)\]/)?.[1];
    if (!code || !NOTICE_STOPS.has(code)) continue;
    const key = `noelle:stop:${run.id}:${code}:${why.slice(0, 80)}`.slice(0, 200);
    if (await db.prepare(`SELECT 1 FROM boss_task_notices WHERE task_id = ? LIMIT 1`).bind(key).first()) continue;
    const line = `Noelle: ${why.replace(/NAMED STOP \[[A-Z0-9_]+\]\s*/, "").slice(0, 180)}`;
    await db.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Noelle','update',?,?,?,0)`)
      .bind(newId("ntc"), key, line.slice(0, 200), line, now).run();
  }
  const failed = (Array.isArray(body.failed) ? body.failed : []).slice(0, 40).map((f: any) => `${String(f?.kind ?? "act")}: ${String(f?.why ?? "").slice(0, 200)}`);
  // A failure that names its stop keeps its code (POST_NOT_PUBLISHED, CALENDAR_UNREAD), so the
  // three-days-running line (G16b) can see the same stop repeat; any other is ACT_FAILED.
  const stops = [...new Set([...parse<string[]>(run.stops, []), ...failed.map((f: string) => f.match(/NAMED STOP \[([A-Z0-9_]+)\]/)?.[1] ?? "ACT_FAILED")])];
  // The run's calls grow with the reviewer and the remake; never shrink (the week's budget reads them).
  const calls = Number.isInteger(body.calls) && body.calls > run.calls ? Math.min(body.calls, 10_000) : run.calls;
  await db.prepare(`UPDATE noelle_runs SET state = 'done', stops = ?, calls = ?, line = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(stops), calls, `${run.line}; ${notices} published${failed.length ? `; ${failed.length} failed: ${failed.join(" | ").slice(0, 600)}` : ""}`, now, run.id).run();
  // Her report, every two weeks (G5: decisions go to the page; the email gets the report, notices and stops).
  if (reportDue(await getSetting(db, REPORT_KEY), today)) {
    const rows = ((await db.prepare(`SELECT * FROM growth_decisions WHERE cycle = ?`).bind(today).all<any>()).results ?? []).map((r) => ({ ...r, actions: parse(r.actions, []), evidence: parse(r.evidence, []) }));
    if (rows.length) {
      const { latest, before } = await latestReadings(db);
      const summaries = summarize(manifest, latest, before, today);
      const row = (manifest as any).rows.find((r: any) => r.id === "growth-director") ?? null;
      const cards = rows.reduce((n: number, r: any) => n + r.actions.filter((a: any) => a.kind === "proposal" && a.card).length, 0);
      const obj = reportSection(rows, { cards, origin: BOSS_ORIGIN, at: now, summaries, scorecard: row });
      const bad = await putMorningSection(db, { section: "growth", job: "duty_growth_director", day: today, obj, now });
      if (bad.length) throw new Error(`NAMED STOP [GROWTH_REPORT_REFUSED] ${bad.join("; ")}`);
      await setSetting(db, REPORT_KEY, today);
    }
  }
  return { run: run.id, state: "done", notices };
}

/**
 * The heartbeat (duty_growth_director, 22:05 Central). No run row today → the morning line (G16a) and a
 * NAMED STOP, so the duty is red, never a quiet green. The same stop three days running → one line to
 * Sequoia (G16b), once per stop per day.
 */
export async function noelleWatch(env: Env, now = Date.now()) {
  const db = env.DB;
  const today = dayIdInZone(now);
  const runs = await recentRuns(db, today, 4);
  const lines: string[] = [];
  const missed = didNotRunLine(runs, today);
  if (missed) lines.push(missed);
  for (const x of escalations(runs.filter((r) => r.day <= today))) {
    const key = `noelle:escalate:${x.stop}:${today}`;
    const have = await db.prepare(`SELECT 1 FROM boss_task_notices WHERE task_id = ? LIMIT 1`).bind(key).first();
    if (have) continue;
    await db.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Noelle','update',?,?,?,1)`)
      .bind(newId("ntc"), key, x.line.slice(0, 200), x.line, now).run();
    lines.push(x.line);
  }
  if (lines.length) {
    const prevRow = await db.prepare(`SELECT body FROM morning_sections WHERE section = 'growth' AND status = 'fresh'`).first<{ body: string }>();
    const base = parse<any>(prevRow?.body, null);
    const merged = appendToSection(base ? { ...base, at: base.at } : null, "growth", { lines }, now);
    const obj = { title: base?.title ?? "📈 Growth, from Noelle", link: base?.link ?? { label: "See every business on the Growth page", url: `${BOSS_ORIGIN}/?tab=growth` }, ...merged, at: new Date(now).toISOString() };
    const bad = await putMorningSection(db, { section: "growth", job: "duty_growth_director", day: today, obj, now });
    if (bad.length) throw new Error(`NAMED STOP [GROWTH_REPORT_REFUSED] ${bad.join("; ")}`);
  }
  if (missed) throw new Error(`NAMED STOP [NOELLE_DID_NOT_RUN] ${missed}`);
  return { written: runs.filter((r) => r.day === today).length, line: `OUTPUT ${runs.filter((r) => r.day === today).length} runs today`, escalated: lines.length - (missed ? 1 : 0) };
}

export const NOELLE_KINDS = KINDS;

/*
 * ─── A #noelle EMAIL IS ONE RUN OF NOELLE AND ONE REPLY (24 Nov 2026) ───────────────────────────────
 *
 * Her words: "she has a schedule yes but she should be able to work when called too". An email tagged
 * #noelle is admitted as a task on her seat (intake/inboundMail.ts); the queue parks it for her Mac
 * (queue/consumer.ts: a cloud model asked to "do" it would answer without her tools). Her Mac's tick
 * (scripts/ops/noelle.sh, every 30 minutes, after the hold check) claims it here, runs her full session
 * with the email in her context under the slot `call:<task id>` (so the slot's unique index makes one
 * email one run), then replies once: the card's output and, through afterResult, the email signed Noelle.
 * A stopped call goes back to waiting; a usage stop costs no try and waits 2 hours; the third real stop
 * replies with what stopped it, so an email never waits forever unseen.
 */
export const CALL_TRIES = 3;
export const CALL_LIMIT_WAIT_MS = 2 * 3_600_000;
const CALL_WHERE = `t.employee_id = '${DIRECTOR}' AND t.status = 'queued' AND json_extract(t.input, '$.source') = 'boss_inbound_mail'`;

/** A claimed call whose run died (Mac asleep, reboot) and never replied or released: no other reaper sees it. */
export const CALL_STALE_MS = 3 * 3_600_000;

async function returnStaleCalls(env: Env, now: number) {
  const stale = (await env.DB.prepare(
    `SELECT t.id, t.attempts FROM tasks t WHERE t.employee_id = '${DIRECTOR}' AND t.status = 'running'
       AND json_extract(t.input, '$.source') = 'boss_inbound_mail'
       AND COALESCE((SELECT MAX(e.ts) FROM task_events e WHERE e.task_id = t.id AND e.event = 'noelle_call_claimed'), 0) < ?
     LIMIT 20`).bind(now - CALL_STALE_MS).all<any>()).results ?? [];
  for (const r of stale) await releaseCall(env, { task_id: String(r.id), stop: "NAMED STOP [CALL_RUN_LOST] her run on the Mac ended without a reply or a stop (asleep or restarted)" }, now);
}

export async function claimCall(env: Env, deviceId: string, now = Date.now()) {
  const db = env.DB;
  await returnStaleCalls(env, now);
  const rows = (await db.prepare(
    `SELECT t.id, t.title, t.input, t.attempts FROM tasks t WHERE ${CALL_WHERE}
       AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.event = 'noelle_call_waits' AND e.ts > ?)
     ORDER BY t.created_at LIMIT 5`).bind(now - CALL_LIMIT_WAIT_MS).all<any>()).results ?? [];
  for (const r of rows) {
    const won = await db.prepare(`UPDATE tasks SET status = 'running', started_at = COALESCE(started_at, ?), attempts = attempts + 1 WHERE id = ? AND status = 'queued'`).bind(now, r.id).run();
    if (!won.meta?.changes) continue; // another tick took it
    await db.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'noelle_call_claimed',?)`)
      .bind(newId("tev"), r.id, now, JSON.stringify({ device_id: deviceId.slice(0, 80), try: Number(r.attempts ?? 0) + 1 })).run();
    let input: any = {}; try { input = JSON.parse(r.input ?? "{}"); } catch { input = {}; }
    return { task_id: String(r.id), slot: `call:${r.id}`, title: String(r.title ?? ""), subject: String(input.subject ?? r.title ?? ""), body: String(input.body ?? "").slice(0, 20_000), try: Number(r.attempts ?? 0) + 1 };
  }
  return null;
}

async function callTask(db: D1Database, id: string) {
  return db.prepare(`SELECT id, lane, title, input, attempts, employee_id, status FROM tasks WHERE id = ? AND employee_id = ?`).bind(id, DIRECTOR).first<any>();
}

/** Her answer: the card's output and, once, the email back signed Noelle. A second reply changes nothing. */
export async function replyCall(env: Env, body: any, now = Date.now()) {
  const id = typeof body?.task_id === "string" ? body.task_id : "";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 30_000) : "";
  if (!id || !text) return { replied: false, why: "send { task_id, text }" };
  const t = await callTask(env.DB, id);
  if (!t) return { replied: false, why: "not a call on Noelle's seat" };
  const won = await env.DB.prepare(`UPDATE tasks SET status = 'done', output = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
    .bind(JSON.stringify({ text, model: "Noelle (Claude, her own session)" }), now, id).run();
  if (!won.meta?.changes) return { replied: false, why: `already ${t.status}: nothing is answered twice` };
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'completed',?)`)
    .bind(newId("tev"), id, now, JSON.stringify({ by: "noelle_call", run: typeof body.run === "string" ? body.run.slice(0, 40) : null })).run();
  let input: Record<string, unknown> = {}; try { input = JSON.parse(t.input ?? "{}"); } catch { input = {}; }
  const { afterResult } = await import("../service/afterResult");
  const after = await afterResult(env, { id, lane: t.lane, title: String(t.title), employee_id: DIRECTOR, input, attempts: Number(t.attempts ?? 0) }, text, { done: true, fromName: "Noelle" });
  return { replied: true, emailed: after.told };
}

/** A call that stopped goes back to waiting; a usage stop costs no try; the last try replies with the stop. */
export async function releaseCall(env: Env, body: any, now = Date.now()) {
  const id = typeof body?.task_id === "string" ? body.task_id : "";
  const stop = typeof body?.stop === "string" ? body.stop.slice(0, 400) : "NAMED STOP [CALL_STOPPED]";
  const t = id ? await callTask(env.DB, id) : null;
  if (!t || t.status !== "running") return { released: false, why: "not a running call" };
  const limit = /\[CLAUDE_LIMIT\]|\[HELD_UNTIL\]/.test(stop);
  if (!limit && Number(t.attempts ?? 0) >= CALL_TRIES) {
    const r = await replyCall(env, { task_id: id, text: `I could not do this after ${CALL_TRIES} tries. What stopped me: ${stop.replace(/\s+/g, " ")}\n\nNothing was posted or changed for it. Send it again once that is fixed.\n\nNoelle` }, now);
    return { released: false, gave_up: true, replied: r.replied };
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'queued'${limit ? ", attempts = MAX(attempts - 1, 0)" : ""} WHERE id = ? AND status = 'running'`).bind(id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,?,?)`)
      .bind(newId("tev"), id, now, limit ? "noelle_call_waits" : "noelle_call_stopped", JSON.stringify({ stop })),
  ]);
  return { released: true, waits: limit };
}
