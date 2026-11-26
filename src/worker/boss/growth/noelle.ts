/**
 * NOELLE'S RECORD (rebuilt 24 Nov 2026, brief noelle-builds: "what wakes is full Claude Code with a persona").
 *
 * Noelle is Claude Code with a persona on her Mac (scripts/ops/noelle.sh → ~/bin/ai-run --role brain,
 * scripts/ops/noelle/persona.md), held by Claude Code's OS sandbox (scripts/ops/lib/noelle-sandbox.sh) and her guard (scripts/ops/noelle-guard.mjs).
 * She decides and builds herself; Boss OS only records. Every route takes the machine token.
 *
 *   GET  /noelle/context   what she reads first: the roster's public fields, her rulings per business with
 *                          the privacy check already run, the scoreboard, recent runs, the ledger's results.
 *   POST /noelle/done      { id, day, slot, kind, state, stops, turns, line, reads, twice } → her run's row
 *                          (one per id: a replay writes nothing). The same failure twice → a Notices line.
 *   POST /noelle/notice    { business, what, where, link, key } → "Noelle published: …" on Notices, once per key.
 *   POST /noelle/ledger    one row, or { rows: [...] } from a posting job (H5): one row per thing acted on,
 *                          a post only with the platform's receipt id. A replay writes nothing twice.
 *
 * `duty_growth_director` (migration 0378) is her heartbeat on the Worker: 22:05 Central daily it runs
 * noelleWatch — no run row today → "Noelle did not run" in tomorrow's morning email; the same stop three
 * days running → one line to Sequoia; Sundays, the week ahead, results against floors and the posts
 * reconciliation (a post with no ledger row is red, POST_NOT_LEDGERED).
 *
 * Never here: a post, a spend, an account, a delete of anyone's data.
 */
import { parse as parseYaml } from "yaml";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { dayIdInZone } from "../../../shared/boss/timezone";
import manifest from "../../../shared/boss/scorecard/manifest.json";
import { summarize } from "../../../shared/boss/growth/scoreboard.mjs";
import { rulingsFor } from "../../../shared/boss/growth/roster.mjs";
import { privateOnlyTerms, leaksIn, termCount } from "../../../shared/boss/growth/privacy.mjs";
import { playbookBody } from "../../../shared/boss/growth/playbook.mjs";
import { AI_SITES } from "../../../shared/boss/growth/aiAnswers.mjs";
import { readGrid, season, slotFor, didNotRunLine, escalations, noticeLine, scheduleLines, zeroQueued, CHANNEL_NAMES, CHANNEL_OWNERS, LEDGER_STEP } from "../../../shared/boss/growth/noelle.mjs";
import { appendToSection } from "../../../shared/boss/mail/morningSections.mjs";
import { MAX_ACTED, cleanActed, floorsFor, measureFor, resultLines, postsWithoutRows, reportDue, fortnightReport, REPORT_KEY, REPORT_EVERY_DAYS } from "../../../shared/boss/growth/ledger.mjs";
import { getSetting, setSetting } from "../lib/settings";
import { latestReadings } from "../routes/growth";
import { putMorningSection } from "../mail/morningSection";
import { BOSS_ORIGIN } from "../../../shared/boss/research/page.mjs";
import { DIRECTOR, loadRoster } from "./run";
import { BACKLINKS, topicOf, namingProblems } from "../../../shared/boss/growth/director.mjs";

const DAY_MS = 86_400_000;
const parse = <T>(t: unknown, d: T): T => { try { return typeof t === "string" ? JSON.parse(t) : d; } catch { return d; } };
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d);

/**
 * What the Growth page says Noelle last saw queued, per business and channel: a number, or "not read: …"
 * when that read failed (never "nothing scheduled" on a failed read). No run in 2 days → every queue not read.
 */

export async function queueView(db: D1Database, now = Date.now()) {
  const r = await db.prepare(`SELECT day, state, stops, line, reads, created_at FROM noelle_runs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(now - 2 * DAY_MS).first<any>();
  if (!r) return { last: null, queues: {} as Record<string, Array<{ channel: string; value: number | null; unread: string | null; items: Array<{ at: string; text: string }> }>>, unread: "not read: Noelle has not run in two days" };
  const reads = parse<any>(r.reads, {});
  const out: Record<string, Array<{ channel: string; value: number | null; unread: string | null; items: Array<{ at: string; text: string }> }>> = {};
  const add = (k: string, value: number | null, unread: string | null) => { const [biz, ch] = k.split(":"); if (!biz || !ch) return; (out[biz] ??= []).push({ channel: ch, value, unread, items: unread ? [] : ((reads.items ?? {})[k] ?? []) }); };
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
  const month = today.slice(0, 7);
  const monthly = await db.prepare(`SELECT 1 FROM noelle_runs WHERE day BETWEEN ? AND ? AND kind = 'weekly'
    AND state = 'done' AND line LIKE ? LIMIT 1`).bind(`${month}-01`, today, `OUTPUT monthly review ${month}:%`).first();
  const { results: misses } = await db.prepare(`SELECT id, site, prompt, lane, fix_attempts, todo_key, last_missed_week, rivals, cited_sources
    FROM ai_misses WHERE fixed_week IS NULL AND site IN (SELECT value FROM json_each(?))
    ORDER BY site, last_missed_week DESC, first_missed_week LIMIT 120`).bind(JSON.stringify(Object.keys(AI_SITES))).all();
  return {
    today, season: season(today), slot: slotFor(today), monthlyReviewDone: monthly ? month : null,
    businesses, problems, summaries, grid: readGrid(roster, measures), linkedOpen: await linkedOpen(db, roster),
    runs: runs.slice(0, 10).map((r) => ({ day: r.day, kind: r.kind, state: r.state, stops: r.stops, line: r.line })),
    aiMisses: misses.map((miss) => ({ ...miss, rivals: parse<string[]>(miss.rivals, []), cited_sources: parse<string[]>(miss.cited_sources, []) })),
    results: await ledgerResults(db, today, Object.fromEntries(roster.map((e: any) => [e.key, e.label]))),
  };
}

/** A Notices line from Noelle, once per key (her run's tools and the twice line). */
async function noticeOnce(db: D1Database, key: string, line: string, needsHer: 0 | 1, now: number) {
  if (await db.prepare(`SELECT 1 FROM boss_task_notices WHERE task_id = ? LIMIT 1`).bind(key).first()) return false;
  await db.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Noelle','update',?,?,?,?)`)
    .bind(newId("ntc"), key, line.slice(0, 200), line, now, needsHer).run();
  return true;
}

const RUN_ID = /^noelle-[\w.-]{1,80}$/;
const SLOT = /^(\d\d:\d\d|call:[\w-]{1,60}|weekly)$/;

/**
 * Her run's end (scripts/ops/noelle.mjs finish). One row per run id: a replayed done writes nothing.
 * Rule 0 is the Mac's verdict on her last line; this records it. The same failure twice in a row (H6) is a
 * Notices line for Sequoia (needs_her) as well as the row's SAME_FAILURE_TWICE stop.
 */
export async function recordDone(env: Env, body: any, now = Date.now()) {
  const db = env.DB;
  const id = typeof body?.id === "string" && RUN_ID.test(body.id) ? body.id : null;
  if (!id) throw new Error("send the run's id (noelle-<dir>-<try>)");
  const day = isDay(body.day) ? body.day : dayIdInZone(now);
  const slot = typeof body.slot === "string" && SLOT.test(body.slot) ? body.slot : null;
  const state = body.state === "done" ? "done" : "stopped";
  const stops = (Array.isArray(body.stops) ? body.stops : []).map(String).filter((s: string) => /^[A-Z0-9_]{2,40}$/.test(s)).slice(0, 8);
  if (state === "stopped" && !stops.length) throw new Error("A stopped run must name its stop code");
  const reported = String(body.line ?? "");
  if (state === "done" && zeroQueued(reported)) throw new Error("[NOTHING_DONE] a zero-queue run cannot be recorded as done");
  const line = reported.slice(0, 600);
  const turns = Number.isInteger(body.turns) && body.turns >= 0 ? Math.min(body.turns, 10_000) : 0;
  const reads = body.reads && typeof body.reads === "object" ? JSON.stringify(body.reads).slice(0, 60_000) : "{}";
  const r = await db.prepare(`INSERT OR IGNORE INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, day, slot, body.kind === "weekly" ? "weekly" : "daily", state, JSON.stringify(stops), turns, line, reads, now, now).run();
  const written = Boolean(r.meta?.changes);
  let notices = 0;
  if (written && body.twice === true) {
    const code = stops[0] ?? "UNKNOWN";
    if (await noticeOnce(db, `noelle:twice:${day}:${code}`, `Noelle stopped the same way twice today (${code}); no more tries today. ${line.replace(/NAMED STOP \[[A-Z0-9_]+\]\s*/g, "").slice(0, 160)}`, 1, now)) notices++;
  }
  // Her 14-day report (kept 24 Nov 2026): the first finished run on its day writes it; a stopped run never does.
  const report = state === "done" && reportDue(await getSetting(db, REPORT_KEY), day) ? await writeReport(env, day, now) : false;
  return { run: id, written, state, notices, report };
}

/**
 * Her 14-day report into the morning email's 📈 Growth section, from the record (ledgerResults, the backlink
 * requests, her runs, the scoreboard readings). A fresh section already there (a heartbeat line) is kept under
 * it. A refused section is a NAMED STOP and the setting is not moved, so the next finished run tries again.
 */
export async function writeReport(env: Env, day: string, now: number) {
  const db = env.DB;
  const from = new Date(Date.parse(`${day}T12:00:00Z`) - (REPORT_EVERY_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  let labels: Record<string, string> = {};
  try { labels = Object.fromEntries((await loadRoster(db)).roster.map((e: any) => [e.key, e.label])); } catch { /* keys stand in for names */ }
  const actions = (await db.prepare(`SELECT day, kind, business, channel FROM noelle_actions WHERE day >= ? AND day <= ? LIMIT 2000`).bind(from, day).all<any>()).results ?? [];
  const orders: Record<string, number> = {};
  for (const r of (await db.prepare(`SELECT business, actions FROM growth_decisions WHERE created_at >= ?`).bind(now - REPORT_EVERY_DAYS * DAY_MS).all<any>()).results ?? [])
    orders[r.business] = (orders[r.business] ?? 0) + parse<any[]>(r.actions, []).filter((a) => a?.kind === "ordered").length;
  const runs = ((await db.prepare(`SELECT day, state, stops FROM noelle_runs WHERE day >= ? AND day <= ?`).bind(from, day).all<any>()).results ?? []).map((r) => ({ ...r, stops: parse<string[]>(r.stops, []) }));
  const waiting = Number((await db.prepare(`SELECT COUNT(*) AS n FROM boss_task_notices WHERE from_name = 'Noelle' AND needs_her = 1 AND created_at >= ?`).bind(now - REPORT_EVERY_DAYS * DAY_MS).first<{ n: number }>())?.n ?? 0);
  const { latest, before } = await latestReadings(db);
  const summaries = summarize(manifest, latest, before, day);
  const scorecard = (manifest as any).rows.find((r: any) => r.id === "growth-director") ?? null;
  const results = await ledgerResults(db, day, labels);
  const obj = fortnightReport({ today: day, actions, orders, runs, waiting, summaries, scorecard, labels, results, origin: BOSS_ORIGIN, at: now });
  const prev = parse<any>((await db.prepare(`SELECT body FROM morning_sections WHERE section = 'growth' AND status = 'fresh'`).first<{ body: string }>())?.body, null);
  const merged = prev ? { ...obj, ...appendToSection({ ...obj, at: obj.at }, "growth", { lines: prev.lines ?? [] }, now), title: obj.title, link: obj.link } : obj;
  const bad = await putMorningSection(db, { section: "growth", job: "duty_growth_director", day, obj: merged, now });
  if (bad.length) throw new Error(`NAMED STOP [GROWTH_REPORT_REFUSED] ${bad.join("; ")}`);
  await setSetting(db, REPORT_KEY, day);
  return true;
}

/** "Noelle published: …" (she MAY publish new things and tells Sequoia each time): one line per key. */
export async function recordNotice(env: Env, body: any, now = Date.now()) {
  const { roster } = await loadRoster(env.DB);
  const e = roster.find((x: any) => x.key === body?.business);
  if (!e) return { written: false, duplicate: false, why: "not a business on her roster" };
  if (typeof body.what !== "string" || !body.what.trim() || typeof body.where !== "string" || !body.where.trim()) return { written: false, duplicate: false, why: "send what and where" };
  const key = typeof body.key === "string" && body.key.startsWith(`noelle:${e.key}:`) ? body.key.slice(0, 200) : null;
  if (!key) return { written: false, duplicate: false, why: `the key starts noelle:${e.key}:` };
  const link = typeof body.link === "string" && /^https:\/\/\S+$/.test(body.link) ? body.link : null;
  const line = noticeLine({ label: e.label, what: body.what.slice(0, 160), where: body.where.slice(0, 80), link });
  const written = await noticeOnce(env.DB, key, line, 0, now);
  return { written, duplicate: !written, why: null };
}

/**
 * Her backlink requests to the backlink network (an outside publisher; her ruling is in the spry brain's
 * Growth rulings). One `growth_decisions` row per business per call, in the shape the network's read
 * (GET /backlink-orders, `backlinkOrders`) has always taken: { kind: "ordered", item: { channel: "backlinks",
 * topic, draft, why } }. A topic over TOPIC_MAX, an empty draft or a draft the naming guard stops is refused
 * by name; a business off her roster writes nothing; the same requests again write nothing twice.
 */
export const MAX_BACKLINKS = 12;
export async function recordBacklinks(env: Env, body: any, now = Date.now()) {
  const { roster } = await loadRoster(env.DB);
  const e = roster.find((x: any) => x.key === body?.business);
  if (!e) return { written: 0, duplicate: false, refused: [], why: "not a business on her roster" };
  const input = (Array.isArray(body?.requests) ? body.requests : []).slice(0, MAX_BACKLINKS);
  if (!input.length) return { written: 0, duplicate: false, refused: [], why: "send requests: [{ topic, draft, why }]" };
  const items: any[] = []; const refused: string[] = [];
  for (const r of input) {
    const topic = topicOf(r?.topic);
    const draft = typeof r?.draft === "string" ? r.draft.trim().slice(0, 4000) : "";
    const naming = draft ? namingProblems(draft) : [];
    if (!topic || !draft || naming.length) { refused.push(`${String(r?.topic ?? "?").slice(0, 60)}: ${!topic ? "topic is 1-120 characters on one line" : !draft ? "no draft" : naming[0]}`); continue; }
    items.push({ kind: "ordered", item: { channel: BACKLINKS, topic, draft, why: typeof r?.why === "string" ? r.why.slice(0, 300) : "" } });
  }
  if (!items.length) return { written: 0, duplicate: false, refused, why: "every request was refused" };
  const day = dayIdInZone(now);
  const actions = JSON.stringify(items);
  const id = `gdn-${day}-${e.key}-${(await sha256hex(actions)).slice(0, 12)}`;
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO growth_decisions (id, cycle, business, label, state, decision, actions, created_at) VALUES (?,?,?,?,'decided',?,?,?)`)
    .bind(id, day, e.key, e.label, `Noelle's backlink requests (${items.length})`, actions, now).run();
  const written = r.meta?.changes ? items.length : 0;
  return { written, duplicate: !written, refused, why: null };
}
async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The results ledger: one row per thing acted on, with its measure and floors. Her own call (run = her run
 * id) or a posting job's rows on the platform's confirmation (H5, .github/actions/ledger-rows: run_id
 * `job:<business>-<channel>`). A post needs its receipt id; a row the roster or the kinds do not know is
 * refused by name; a replay writes nothing twice (the unique index).
 */
export async function writeLedger(env: Env, body: any, now = Date.now()) {
  const db = env.DB;
  const many = Array.isArray(body?.rows);
  const input = (many ? body.rows : [body]).slice(0, MAX_ACTED);
  const { roster } = await loadRoster(db);
  const keys = new Set<string>(roster.map((e: any) => e.key));
  let written = 0, duplicate = 0;
  const refused: string[] = [];
  for (const raw of input) {
    const a = cleanActed(raw, keys);
    if (!a) { refused.push(`${String(raw?.business ?? "?")}:${String(raw?.channel ?? "?")}:${String(raw?.item ?? "?").slice(0, 40)}`); continue; }
    const run = typeof raw.run === "string" && RUN_ID.test(raw.run) ? raw.run : `job:${a.business}-${a.channel}`;
    const day = a.at ? dayIdInZone(Date.parse(a.at.length === 10 ? `${a.at}T18:00:00Z` : a.at)) : dayIdInZone(now);
    const m = measureFor(manifest, a.business, a.channel);
    const base = m ? await db.prepare(`SELECT value, unread FROM growth_readings WHERE measure = ? AND day <= ? ORDER BY day DESC LIMIT 1`).bind(m.id, day).first<{ value: number | null; unread: string | null }>() : null;
    const f = floorsFor(a.scorecard, base && !base.unread && base.value !== null ? Number(base.value) : null);
    const r = await db.prepare(`INSERT OR IGNORE INTO noelle_actions (id, run_id, day, kind, business, channel, item, post_at, measure, floor30, floor60, floor_source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId("nac"), run, day, a.kind, a.business, a.channel, a.item, a.at, m?.id ?? null, f.floor30, f.floor60, f.source, now).run();
    if (r.meta?.changes) written++; else duplicate++;
  }
  return many ? { written, duplicate, refused } : { written: written > 0, duplicate: duplicate > 0, why: refused.length ? `refused: ${refused[0]} (kind, business, channel, item; a post needs its receipt id)` : null };
}

/** Results against floors for the last 90 days of the ledger (item 11): her weekly context and Monday's email. */
export async function ledgerResults(db: D1Database, today: string, labels: Record<string, string> = {}) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 90 * DAY_MS).toISOString().slice(0, 10);
  const rows = (await db.prepare(`SELECT day, kind, business, channel, measure, floor30, floor60 FROM noelle_actions WHERE day >= ? ORDER BY day LIMIT 2000`).bind(from).all<any>()).results ?? [];
  const ids = [...new Set(rows.map((r) => r.measure).filter(Boolean))] as string[];
  const by: Record<string, any[]> = {};
  for (const id of ids) by[id] = (await db.prepare(`SELECT day, value, unread FROM growth_readings WHERE measure = ? AND day >= ? ORDER BY day`).bind(id, from).all<any>()).results ?? [];
  return resultLines(rows, by, { today, labels, names: CHANNEL_NAMES });
}

/**
 * The heartbeat (duty_growth_director, 22:05 Central). No run row today → the morning line (G16a) and a
 * NAMED STOP, so the duty is red, never a quiet green. The same stop three days running → one line to
 * Sequoia (G16b), once per stop per day.
 */
export async function noelleWatch(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const db = env.DB;
  const today = dayIdInZone(now);
  const runs = await recentRuns(db, today, 4);
  const lines: string[] = [];
  const missed = didNotRunLine(runs, today);
  if (missed) lines.push(missed);
  // Item 9: Sunday's heartbeat writes the week ahead, so it is in Monday's morning email.
  if (new Date(`${today}T12:00:00Z`).getUTCDay() === 0) lines.push(...(await weekSchedule(env, today, now, fetchImpl)));
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

/** The week ahead from the latest run (two days at most) that read queues; labels from the roster when it reads. */
export async function weekSchedule(env: Env, today: string, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const r = await env.DB.prepare(`SELECT day, reads FROM noelle_runs WHERE created_at >= ? AND reads IS NOT NULL AND reads <> '{}' ORDER BY created_at DESC LIMIT 1`).bind(now - 2 * DAY_MS).first<any>();
  let labels: Record<string, string> = {};
  try { labels = Object.fromEntries((await loadRoster(env.DB)).roster.map((e: any) => [e.key, e.label])); } catch { /* keys stand in for names */ }
  return [...scheduleLines(r ? { day: r.day, reads: parse<any>(r.reads, {}) } : null, { today, labels }), ...(await ledgerResults(env.DB, today, labels)), ...(await postsReconciled(env.DB, today, now, fetchImpl))];
}

const RAW = "https://raw.githubusercontent.com/seq23";

/**
 * H5, Monday's line, for every posting path she owns (CHANNEL_OWNERS): each post its job recorded in the last 7
 * days (the posted file on the repo's main, or the Pinterest profile feed) has its ledger row. A path is judged
 * only when its workflow on main carries the ledger step; otherwise it is named "not wired yet", never passed.
 * A post with no row → NAMED STOP [POST_NOT_LEDGERED]; a file, feed or workflow that could not be read → "not
 * read", never "every one has its row"; a path whose platform gives no receipt is named with its reason. Rows
 * are judged from the day of the path's first row (a job's first ledger run sends its last 8 days).
 */
export async function postsReconciled(db: D1Database, today: string, now = Date.now(), fetchImpl: typeof fetch = fetch) {
  const lines: string[] = [];
  const notWired: string[] = [];
  const cache = new Map<string, Promise<{ ok: true; body: string } | { ok: false; why: string }>>();
  const read = (url: string) => {
    if (!cache.has(url)) cache.set(url, (async () => {
      try {
        const res = await fetchImpl(url);
        return res.ok ? { ok: true as const, body: await res.text() } : { ok: false as const, why: `answered ${res.status}` };
      } catch (e) { return { ok: false as const, why: String((e as Error)?.message ?? e).slice(0, 80) }; }
    })());
    return cache.get(url)!;
  };
  const entries = Object.entries(CHANNEL_OWNERS) as Array<[string, any]>;
  let judged = 0, named = 0, unread = 0;
  for (const [path, o] of entries) {
    const [business = "", channel = ""] = path.split(":");
    const who = `Posts ledger, ${business} ${channel}`;
    if (o.noReceipt) { lines.push(`${who}: no receipt to read (${o.noReceipt})`); named++; continue; }
    const wfPath = `${o.repo}/.github/workflows/${o.workflow}`;
    const wf = await read(`${RAW}/${o.repo}/main/.github/workflows/${o.workflow}`);
    if (!wf.ok) { lines.push(`${who}: not read (${wfPath}: ${wf.why})`); unread++; continue; }
    let wired = false;
    try {
      const doc = parseYaml(wf.body) as { jobs?: Record<string, { environment?: unknown; steps?: Array<{ uses?: unknown; with?: Record<string, unknown> }> }> };
      wired = Object.values(doc?.jobs ?? {}).some((job) => job.environment === "reviewed-main" && Array.isArray(job.steps)
        && job.steps.some((step) => typeof step?.uses === "string" && step.uses.startsWith(LEDGER_STEP)
          && step.with?.business === business && (o.feed ? step.with?.feed === o.feed : step.with?.file === o.posted)
          && (!o.channel || step.with?.channel === o.channel)));
    } catch {
      lines.push(`${who}: not read (${wfPath}: invalid workflow YAML)`);
      unread++;
      continue;
    }
    if (!wired) { notWired.push(`${path} (${wfPath} has no ledger step)`); continue; }
    const src = o.feed ?? `${RAW}/${o.repo}/main/${o.posted}`;
    const srcName = o.feed ?? `${o.repo}/${o.posted}`;
    const got = await read(src);
    if (!got.ok) { lines.push(`${who}: not read (${srcName}: ${got.why})`); unread++; continue; }
    let doc: any = got.body;
    if (o.feed && (!/<rss\b/i.test(got.body) || !/<channel\b/i.test(got.body))) {
      lines.push(`${who}: not read (${srcName}: not a profile RSS feed)`); unread++; continue;
    }
    if (!o.feed) { try { doc = JSON.parse(got.body); } catch { lines.push(`${who}: not read (${srcName}: not JSON)`); unread++; continue; } }
    if (doc && typeof doc === "object" && !Array.isArray(doc) && doc.access === "none") {
      lines.push(`${who}: no receipt yet (${srcName} says access: none; the platform has not granted the page posting API)`); named++; continue;
    }
    const rows = (await db.prepare(`SELECT item, COALESCE(post_at, day) AS first_at FROM noelle_actions WHERE kind = 'post' AND business = ? AND channel = ?`).bind(business, channel).all<{ item: string; first_at: string }>()).results ?? [];
    const since = rows.map((x) => x.first_at).sort()[0] ?? null;
    const miss = postsWithoutRows(doc, rows.map((x) => x.item), { business, channel, since, now, days: 7 });
    judged++;
    lines.push(miss.missing.length
      ? `NAMED STOP [POST_NOT_LEDGERED] ${business} ${channel}: ${miss.missing.length} of ${miss.posted} posts this week have no ledger row (${miss.missing.slice(0, 3).join(", ")})${since ? "" : "; the path has no row at all yet"}`
      : miss.posted ? `${who}: ${miss.posted} posts this week, every one has its row` : `${who}: no post with a receipt this week`);
  }
  lines.push(notWired.length
    ? `Posts ledger: ${entries.length} paths, ${judged} reconciled, ${named} named without a receipt, ${unread} not read, ${notWired.length} not wired yet, so not reconciled: ${notWired.join(", ")}`
    : `Posts ledger: ${entries.length} paths, ${judged} reconciled, ${named} named without a receipt, ${unread} not read, 0 not wired yet`);
  return lines;
}

/*
 * ─── SEQUOIA CALLS NOELLE: ONE RUN OF HER AND ONE REPLY (24 Nov 2026, brief noelle-builds H3) ──────────
 *
 * Her words: "she has a schedule yes but she should be able to work when called too". Two doors, one path:
 * her own email to boss@ that names Noelle (a #noelle tag, "Noelle" in the subject, or a first line that
 * opens with her name; intake/inboundMail.ts, admitted only when isOwner && DMARC passed, H4) and her
 * message on Noelle's Boss OS page (POST /growth/noelle/message, her session). Both are a task on Noelle's
 * seat; the queue parks it for her Mac (queue/consumer.ts). Her Mac's tick (scripts/ops/noelle.sh, every
 * 30 minutes, 10:00-22:59 Central) claims it here and runs her full Claude Code session with the call in
 * her system prompt, then replies once: the card's output, and for an email the reply on its thread
 * (afterResult, signed Noelle). A stopped call goes back to waiting; a usage stop costs no try and waits
 * 2 hours; a Claude usage limit hands it to the Boss OS ladder; the third real stop replies with
 * what stopped it, so a call never waits forever unseen.
 */
export const CALL_TRIES = 3;
export const CALL_LIMIT_WAIT_MS = 2 * 3_600_000;
/** Her calls: her own email to boss@ (the owner check admitted it) or her message on Noelle's page (H3b). */
export const CALL_SOURCES = ["boss_inbound_mail", "boss_page"] as const;
const CALL_SOURCE_SQL = `json_extract(t.input, '$.source') IN ('boss_inbound_mail','boss_page') AND COALESCE(json_extract(t.input, '$.noelle_cloud'), 0) = 0`;
const CALL_WHERE = `t.employee_id = '${DIRECTOR}' AND t.status = 'queued' AND ${CALL_SOURCE_SQL}`;

/** A claimed call whose run died (Mac asleep, reboot) and never replied or released: no other reaper sees it. */
export const CALL_STALE_MS = 3 * 3_600_000;

async function returnStaleCalls(env: Env, now: number) {
  const stale = (await env.DB.prepare(
    `SELECT t.id, t.attempts FROM tasks t WHERE t.employee_id = '${DIRECTOR}' AND t.status = 'running'
       AND ${CALL_SOURCE_SQL}
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
    return { task_id: String(r.id), slot: `call:${r.id}`, source: String(input.source ?? ""), title: String(r.title ?? ""), subject: String(input.subject ?? r.title ?? ""), body: String(input.body ?? "").slice(0, 20_000), try: Number(r.attempts ?? 0) + 1 };
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
  // Claude usage limit: the Boss OS ladder (Workers AI, then Gemini) answers this call
  // (coordinator ruling 24 Nov 2026, the full chain, unmasked). Marked so the Mac never claims it again.
  if (/\[CLOUD_ANSWER\]/.test(stop)) {
    let input: Record<string, unknown> = {}; try { input = JSON.parse(t.input ?? "{}"); } catch { input = {}; }
    await env.DB.batch([
      env.DB.prepare(`UPDATE tasks SET status = 'queued', input = ? WHERE id = ? AND status = 'running'`).bind(JSON.stringify({ ...input, noelle_cloud: true }), id),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'noelle_call_cloud',?)`).bind(newId("tev"), id, now, JSON.stringify({ stop })),
    ]);
    await env.TASKS.send({ taskId: id, lane: t.lane });
    return { released: true, cloud: true, waits: false };
  }
  const limit = /\[CLAUDE_LIMIT\]|\[HELD_UNTIL\]/.test(stop);
  if (!limit && Number(t.attempts ?? 0) >= CALL_TRIES) {
    const r = await replyCall(env, { task_id: id, text: `I could not do this after ${CALL_TRIES} tries. What stopped me: ${stop.replace(/\s+/g, " ")}\n\nSend it again once that is fixed.\n\nNoelle` }, now);
    return { released: false, gave_up: true, replied: r.replied };
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'queued'${limit ? ", attempts = MAX(attempts - 1, 0)" : ""} WHERE id = ? AND status = 'running'`).bind(id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,?,?)`)
      .bind(newId("tev"), id, now, limit ? "noelle_call_waits" : "noelle_call_stopped", JSON.stringify({ stop })),
  ]);
  return { released: true, waits: limit };
}
