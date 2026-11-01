import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { getSetting, setSetting } from "../lib/settings";
import { notFound } from "../lib/http";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";
import {
  BRAIN_SLUGS, applyEdit, historySlugsFor, resolveBrainSlug, brainBlock, brainsFor, cohesionCheckLine, cohesionLine, type MacCheck, daysSince, isStale, missingCount,
  parseBrainEdits, scoreboardRows, shortName, whosWhoBlock, TEAM_SLUG, type BrainEdit, type BrainRow,
} from "../../../shared/boss/brains/brain.mjs";

/**
 * BRAINS IN D1 (migration 0323). One document per business; every change writes a revision with
 * who and how. The definition (sections, gaps, private spans, who reads what) is brain.mjs.
 */

/**
 * The live brains only. A retired brain's row stays in D1 with its history (RETIRED_BRAINS, 1 Nov
 * 2026) but is never listed, scored or read: its successor holds its facts.
 */
export async function allBrains(env: Env): Promise<BrainRow[]> {
  const { results } = await env.DB
    .prepare(`SELECT slug, title, body_md, updated_at, updated_by FROM brains`)
    .all<BrainRow>();
  const order = new Map(BRAIN_SLUGS.map((s, i) => [s, i]));
  return (results ?? []).filter((b) => order.has(b.slug)).sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
}

/** One live brain. A retired slug (e.g. `industry-guides`) answers with its successor (`spry`). */
export async function oneBrain(env: Env, asked: string): Promise<BrainRow> {
  const slug = resolveBrainSlug(asked);
  if (!BRAIN_SLUGS.includes(slug)) throw notFound(`There is no brain called ${asked}`);
  const row = await env.DB
    .prepare(`SELECT slug, title, body_md, updated_at, updated_by FROM brains WHERE slug = ?`)
    .bind(slug)
    .first<BrainRow>();
  if (!row) throw notFound(`There is no brain called ${slug}`);
  return row;
}

export function listEntry(b: BrainRow, now = Date.now()) {
  return {
    slug: b.slug, title: b.title, updated_at: b.updated_at, updated_by: b.updated_by ?? null,
    missing_count: missingCount(b.body_md), stale: isStale(b.updated_at, now), days_since: daysSince(b.updated_at, now),
  };
}

/** Write the whole document and its revision in one batch. */
export async function saveBrain(env: Env, asked: string, body: string, by: string, note: string, now = Date.now()) {
  const { slug } = await oneBrain(env, asked);
  const id = newId("brv");
  await env.DB.batch([
    env.DB.prepare(`UPDATE brains SET body_md = ?, updated_at = ?, updated_by = ? WHERE slug = ?`).bind(body, now, by, slug),
    env.DB.prepare(`INSERT INTO brain_revisions (id, slug, body_md, changed_at, changed_by, note) VALUES (?,?,?,?,?,?)`)
      .bind(id, slug, body, now, by, note),
  ]);
  await audit(env.DB, { actor: by, lane: "ops", entityType: "brain", entityId: slug, action: "brain_edited", detail: { revision: id, note } });
  return id;
}

/** Its history, newest first, including the revisions of any brain retired into it. */
export async function revisions(env: Env, asked: string) {
  const { slug } = await oneBrain(env, asked);
  const slugs = historySlugsFor(slug);
  const { results } = await env.DB
    .prepare(`SELECT id, slug, body_md, changed_at, changed_by, note FROM brain_revisions WHERE slug IN (${slugs.map(() => "?").join(",")}) ORDER BY changed_at DESC LIMIT 100`)
    .bind(...slugs)
    .all();
  return results ?? [];
}

export async function scoreboard(env: Env) {
  const brains = await allBrains(env);
  return brains.flatMap((b) => scoreboardRows(b));
}

// ─── Employees read brains ───────────────────────────────────────────────────

/**
 * The brain block for one employee's job. `keepConfidential` only for the Claude seat; the router
 * and the dispatch strip private spans again before any request exists (fail closed).
 */
export async function brainBlockFor(env: Env, employeeId: string | null | undefined, keepConfidential = false): Promise<string> {
  if (!employeeId) return "";
  const { slugs, summarised } = brainsFor(employeeId);
  // Every employee also reads a short who's-who from the team doc, so work goes to the right colleague.
  const want = [...slugs, TEAM_SLUG];
  const { results } = await env.DB
    .prepare(`SELECT slug, title, body_md, updated_at FROM brains WHERE slug IN (${want.map(() => "?").join(",")})`)
    .bind(...want)
    .all<BrainRow>();
  const rows = (results ?? []).filter((r) => r && typeof r.body_md === "string");
  const team = rows.find((r) => r.slug === TEAM_SLUG) ?? null;
  const mine = rows.filter((r) => slugs.includes(r.slug)).sort((a, b) => slugs.indexOf(a.slug) - slugs.indexOf(b.slug));
  return [brainBlock(mine, { summarised, keepConfidential }), whosWhoBlock(team, { keepConfidential })].filter(Boolean).join("\n\n");
}

// ─── Edits by email ──────────────────────────────────────────────────────────

/**
 * Her brain edits in prose ("P&P brain: add settled decision …", "time-2-read priorities: 1 … 2 …"),
 * applied to the right section with a revision noted "by email". Null when the mail holds no edit.
 */
export async function brainEditsFromMail(env: Env, text: string, mailId: string, now = Date.now()): Promise<{ note: string; edits: BrainEdit[] } | null> {
  const today = dayIdInZone(now);
  const edits = parseBrainEdits(text, today);
  if (!edits.length) return null;
  const bySlug = new Map<string, BrainEdit[]>();
  for (const e of edits) bySlug.set(e.slug, [...(bySlug.get(e.slug) ?? []), e]);
  const said: string[] = [];
  for (const [slug, list] of bySlug) {
    const brain = await oneBrain(env, slug);
    let md = brain.body_md;
    for (const e of list) md = applyEdit(md, e, today);
    await saveBrain(env, slug, md, "Sequoia", "by email", now);
    const what = list.map((e) => e.op === "set_number" ? `${e.metric} is now ${e.value}` : e.op === "add" ? `added to ${e.section}` : `${e.section} now reads as you wrote it`);
    said.push(`${shortName(brain)} brain: ${what.join(", ")}. It now has ${plural(missingCount(md), "gap")} to fill.`);
  }
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "inbound_mail", entityId: mailId, action: "brain_edited_by_email", detail: { slugs: [...bySlug.keys()] } });
  return { note: ["Done. I updated the brain:", ...said].join("\n"), edits };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ─── The Monday check (rides the hourly tick) ────────────────────────────────

export const COHESION_KEY = "brains_cohesion";

/** The Monday of the week `now` falls in, on her clock, as YYYY-MM-DD. */
export function weekOf(now: number): string {
  const w = wallClock(now);
  const back = (w.dow + 6) % 7;
  return dayIdInZone(now - back * 86_400_000);
}

export async function computeCohesion(env: Env, now = Date.now()) {
  const brains = await allBrains(env);
  const rec = {
    week: weekOf(now), at: now, line: cohesionLine(brains, now), brains: brains.length,
    stale: brains.filter((b) => isStale(b.updated_at, now)).map((b) => b.slug),
    gaps: brains.reduce((s, b) => s + missingCount(b.body_md), 0),
  };
  await setSetting(env.DB, COHESION_KEY, JSON.stringify(rec));
  return rec;
}

/**
 * On the hourly tick: Mondays (her clock) once per week, the check is computed and kept. Every
 * other tick says why it did nothing, so a skip is a reason rather than silence.
 */
export async function runBrainsCohesion(env: Env, now = Date.now()) {
  if (wallClock(now).dow !== 1) return { ran: false as const, reason: "not_monday" };
  const prev = await getSetting(env.DB, COHESION_KEY);
  try { if (prev && JSON.parse(prev).week === weekOf(now)) return { ran: false as const, reason: "done_this_week" }; } catch { /* recompute */ }
  return { ran: true as const, ...(await computeCohesion(env, now)) };
}

// ─── The Mac half: memory, repo pointers, skills, the local copy ─────────────

export const MAC_COHESION_KEY = "brains_cohesion_mac";
const MAX_LIST = 200;
const str = (v: unknown, n = 300) => String(v ?? "").slice(0, n);
const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);

/**
 * Keep what the Mac's Sunday-evening check found (scripts/brains/cohesion-check.mjs). The week is stamped
 * from the moment it ARRIVED, never from a date the Mac claims, so a stale report cannot pass for
 * this week's.
 */
/**
 * The week a Mac check counts for. It runs SUNDAY evening (owner's rebalanced week, 1 Nov 2026) so
 * Monday's email carries it: a check that arrives on a Sunday counts for the week that starts the
 * next morning. Any other day counts for its own week.
 */
export function macCheckWeek(now: number): string {
  return weekOf(wallClock(now).dow === 0 ? now + 86_400_000 : now);
}

export async function recordMacCohesion(env: Env, body: unknown, now = Date.now()) {
  const b = (body ?? {}) as Record<string, unknown>;
  const rec: MacCheck & { week: string; at: number } = {
    week: macCheckWeek(now), at: now,
    strays_moved: list(b.strays_moved).map((x: any) => ({ from: str(x?.from), to: str(x?.to) })),
    memory_index_lines: Number(b.memory_index_lines) || 0,
    memory_index_too_big: b.memory_index_too_big === true,
    repos_checked: Number(b.repos_checked) || 0,
    repos_missing_pointer: list(b.repos_missing_pointer).map((x) => str(x, 100)),
    skills_checked: Number(b.skills_checked) || 0,
    skills_flagged: list(b.skills_flagged).map((x: any) => ({ skill: str(x?.skill, 100), phrase: str(x?.phrase, 100) })),
    skills_restating: list(b.skills_restating).slice(0, 200).map((x: any) => ({ skill: str(x?.skill, 100), line: Number(x?.line) || 0, source: str(x?.source, 100) })),
    copy_age_hours: b.copy_age_hours == null ? null : Number(b.copy_age_hours),
    copy_restarted: b.copy_restarted === true,
    copy_fresh_after: b.copy_fresh_after === true,
    unchecked: list(b.unchecked).map((x) => str(x, 100)),
    validators_checked: Number(b.validators_checked) || 0,
    validators_flag: typeof b.validators_flag === "string" && b.validators_flag ? str(b.validators_flag, 400) : null,
  };
  await setSetting(env.DB, MAC_COHESION_KEY, JSON.stringify(rec));
  await audit(env.DB, { actor: "mac", lane: "ops", entityType: "brain", entityId: "cohesion", action: "mac_cohesion_recorded", detail: { week: rec.week } });
  return rec;
}

/** This week's Mac record, or null (it did not run, or it ran last week). */
export async function macCohesionThisWeek(env: Env, now = Date.now()): Promise<(MacCheck & { week: string; at: number }) | null> {
  const raw = await getSetting(env.DB, MAC_COHESION_KEY);
  // A Sunday-evening check is stamped for the coming week (macCheckWeek); on that Sunday it is
  // also the current one, so the line read that evening shows it rather than "did not run".
  try { if (raw) { const r = JSON.parse(raw); if (r.week === weekOf(now) || r.week === macCheckWeek(now)) return r; } } catch { /* unreadable = not run */ }
  return null;
}

/**
 * What the Monday email reads: ONE line for the whole setup (`line`), from this week's brains check
 * (computed now if the tick has not run yet) and this week's Mac check. `brains_line` keeps the
 * brains-only words.
 */
export async function currentCohesion(env: Env, now = Date.now()) {
  const prev = await getSetting(env.DB, COHESION_KEY);
  let rec: any = null;
  try { if (prev) { const r = JSON.parse(prev); if (r.week === weekOf(now)) rec = r; } } catch { /* recompute */ }
  if (!rec) rec = await computeCohesion(env, now);
  const [brains, mac] = await Promise.all([allBrains(env), macCohesionThisWeek(env, now)]);
  return { ...rec, brains_line: rec.line, line: cohesionCheckLine(brains, mac, now), mac };
}
