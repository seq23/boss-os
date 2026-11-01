import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { getSetting, setSetting } from "../lib/settings";
import { notFound } from "../lib/http";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";
import {
  BRAIN_SLUGS, applyEdit, brainBlock, brainsFor, cohesionLine, daysSince, isStale, missingCount,
  parseBrainEdits, scoreboardRows, shortName, whosWhoBlock, TEAM_SLUG, type BrainEdit, type BrainRow,
} from "../../../shared/boss/brains/brain.mjs";

/**
 * BRAINS IN D1 (migration 0323). One document per business; every change writes a revision with
 * who and how. The definition (sections, gaps, private spans, who reads what) is brain.mjs.
 */

export async function allBrains(env: Env): Promise<BrainRow[]> {
  const { results } = await env.DB
    .prepare(`SELECT slug, title, body_md, updated_at, updated_by FROM brains`)
    .all<BrainRow>();
  const order = new Map(BRAIN_SLUGS.map((s, i) => [s, i]));
  return (results ?? []).sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
}

export async function oneBrain(env: Env, slug: string): Promise<BrainRow> {
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
export async function saveBrain(env: Env, slug: string, body: string, by: string, note: string, now = Date.now()) {
  await oneBrain(env, slug);
  const id = newId("brv");
  await env.DB.batch([
    env.DB.prepare(`UPDATE brains SET body_md = ?, updated_at = ?, updated_by = ? WHERE slug = ?`).bind(body, now, by, slug),
    env.DB.prepare(`INSERT INTO brain_revisions (id, slug, body_md, changed_at, changed_by, note) VALUES (?,?,?,?,?,?)`)
      .bind(id, slug, body, now, by, note),
  ]);
  await audit(env.DB, { actor: by, lane: "ops", entityType: "brain", entityId: slug, action: "brain_edited", detail: { revision: id, note } });
  return id;
}

export async function revisions(env: Env, slug: string) {
  await oneBrain(env, slug);
  const { results } = await env.DB
    .prepare(`SELECT id, slug, body_md, changed_at, changed_by, note FROM brain_revisions WHERE slug = ? ORDER BY changed_at DESC LIMIT 100`)
    .bind(slug)
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

/** What the Monday email reads: this week's check, computed now if the tick has not run yet. */
export async function currentCohesion(env: Env, now = Date.now()) {
  const prev = await getSetting(env.DB, COHESION_KEY);
  try { if (prev) { const r = JSON.parse(prev); if (r.week === weekOf(now)) return r; } } catch { /* recompute */ }
  return computeCohesion(env, now);
}
