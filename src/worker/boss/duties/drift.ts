/**
 * DRIFT PREVENTION (owner, 13 Nov 2026). The floors (floors.ts, briefingSpec.ts) catch a delivery
 * that is plainly short. A slow slide stays above the floor for weeks. So:
 *
 *   1. every floor check keeps what it measured (`recordMeasures`, table `delivery_measures`);
 *   2. once a week the morning email carries one line per deliverable: this week beside its best
 *      week and the four-week trend (`driftReport`). A line is FLAGGED only when a measure sits
 *      more than 25% under its best week two weeks running, or a floor was missed. A measure
 *      nothing recorded reads "not measured", never as fine;
 *   3. once a month her Claude seat (Codex as the backup, never a free route) reads one real output
 *      of each deliverable beside its best one and says whether the substance holds
 *      (`composeQualityRead`, `qualityReadsFloor`; filed by deliverReport.ts `deliverQualityReads`).
 *
 * Nothing here names a model: `route` is the place that did the work.
 */
import type { Env } from "../env";
import type { FloorVerdict } from "./briefingSpec";
import { newId } from "../lib/id";

type DB = Pick<Env, "DB">;

/** The deliverables, in the order she reads them, and the measures that say how good a run was (higher is better). */
export const DELIVERABLES = Object.freeze([
  { key: "executive_reports", label: "Daily briefing", measures: [["sources", "sources"], ["headlines", "headlines"], ["sections", "sections"], ["sources_reachable", "sources that open"]] },
  { key: "sourcing_candidates", label: "Brokerage sourcing", measures: [["new_rows", "new firms"], ["links_reachable", "links that open"]] },
  { key: "link_prospects", label: "Backlink prospecting", measures: [["new_rows", "new prospects"], ["links_reachable", "links that open"]] },
  { key: "tool_suggestions", label: "Tools worth knowing", measures: [["new_rows", "new tools"], ["links_reachable", "links that open"]] },
  { key: "research_page", label: "Research pages", measures: [["sources", "sources"], ["sources_reachable", "sources that open"]] },
] as const);

export const DRIFT = Object.freeze({ slip: 0.25, weeks: 4, week_ms: 7 * 24 * 3600_000 });

/** Keep what one floor check measured. Never throws: a measure that could not be saved must not fail the delivery. */
export async function recordMeasures(env: DB, a: { deliverable: string; taskId?: string | null; runId?: string | null; route?: string | null; verdict: FloorVerdict; now?: number }): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO delivery_measures (id, at, deliverable, task_id, run_id, route, pass, misses, measured) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(newId("dms"), a.now ?? Date.now(), a.deliverable, a.taskId ?? null, a.runId ?? null, a.route ?? null, a.verdict.pass ? 1 : 0, JSON.stringify(a.verdict.misses ?? []), JSON.stringify(a.verdict.measured ?? {}))
      .run();
  } catch (err) {
    console.error(`drift: measures for ${a.deliverable} were not saved (${err instanceof Error ? err.message : String(err)})`);
  }
}

interface Run { at: number; pass: boolean; route: string | null; measured: Record<string, unknown> }
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const show = (v: number | null): string => (v === null ? "not measured" : String(Math.round(v)));

export interface DriftLine {
  deliverable: string; label: string; text: string; flagged: boolean;
  /** Per measure: this week, the best earlier week, and the four weeks oldest first. Null = not measured. */
  measures: { name: string; words: string; this_week: number | null; best: number | null; trend: (number | null)[] }[];
  runs_this_week: number; floor_misses_this_week: number; routes: string[];
}

/** One deliverable's line, from its runs. Pure, so the rule is testable without a clock or a database. */
export function driftLine(d: (typeof DELIVERABLES)[number], runs: Run[], now: number): DriftLine {
  const W = DRIFT.week_ms;
  const week = (i: number) => runs.filter((r) => r.at > now - (i + 1) * W && r.at <= now - i * W);
  const thisWeek = week(0);
  /*
   * LIKE AGAINST LIKE: a week is its runs' average, and "best" is the best WEEK before this one. For
   * a weekly deliverable that is its best run. For the daily briefing it is not one exceptional
   * morning: on the real record (Oct to Nov 2026) a single 52-source day would have flagged every
   * ordinary 30-source week for ever, and a line that is always flagged is read by nobody.
   */
  const PAST_WEEKS = 26;
  const measures = d.measures.map(([name, words]) => {
    const at = (i: number) => mean(week(i).map((r) => num(r.measured[name])).filter((v): v is number => v !== null));
    const trend = Array.from({ length: DRIFT.weeks }, (_, i) => at(DRIFT.weeks - 1 - i));
    const past = Array.from({ length: PAST_WEEKS }, (_, i) => at(i + 1)).filter((v): v is number => v !== null);
    return { name, words, this_week: at(0), best: past.length ? Math.max(...past) : null, trend };
  });
  const misses = thisWeek.filter((r) => !r.pass).length;
  // Slipping: more than 25% under the best run this week AND the week before.
  const under = (v: number | null, b: number | null) => v !== null && b !== null && b > 0 && v < b * (1 - DRIFT.slip);
  const slipped = measures.filter((m) => under(m.this_week, m.best) && under(m.trend[DRIFT.weeks - 2] ?? null, m.best));

  const lead = measures[0]!;
  let text: string;
  if (thisWeek.length === 0) {
    text = `${d.label}: not measured this week (no run was checked).`;
  } else {
    const bits = [`${thisWeek.length > 1 ? "averaging " : ""}${show(lead.this_week)} ${lead.words} this week`, lead.best === null ? "no earlier week on record yet" : `best week ${show(lead.best)}`, `last four weeks ${lead.trend.map(show).join(", ")}`];
    const unmeasured = measures.filter((m) => m.this_week === null).map((m) => m.words);
    const verdict = misses > 0 ? `Missed its standard ${misses === 1 ? "once" : `${misses} times`} this week.`
      : slipped.length ? `Slipping: ${slipped.map((m) => `${m.words} ${show(m.this_week)} against a best week of ${show(m.best)}`).join("; ")}, two weeks running.`
      : "Holding.";
    text = `${d.label}: ${bits.join(", ")}. ${verdict}${unmeasured.length ? ` Not measured: ${unmeasured.join(", ")}.` : ""}`;
  }
  return {
    deliverable: d.key, label: d.label, text, flagged: misses > 0 || slipped.length > 0, measures,
    runs_this_week: thisWeek.length, floor_misses_this_week: misses,
    routes: [...new Set(thisWeek.map((r) => r.route).filter((x): x is string => Boolean(x)))],
  };
}

export interface DriftReport { at: number; lines: DriftLine[]; reads: { deliverable: string; label: string; verdict: string; why: string; at: number }[] }

/** The week's lines and the newest monthly read (shown for the week after it lands). */
export async function driftReport(env: DB, now = Date.now()): Promise<DriftReport> {
  const since = now - 27 * DRIFT.week_ms;
  const rows = await env.DB.prepare(`SELECT deliverable, at, pass, route, measured FROM delivery_measures WHERE at > ? ORDER BY at DESC LIMIT 4000`).bind(since)
    .all<{ deliverable: string; at: number; pass: number; route: string | null; measured: string }>();
  const by = new Map<string, Run[]>();
  for (const r of rows.results ?? []) {
    let measured: Record<string, unknown> = {};
    try { const m = JSON.parse(r.measured); if (m && typeof m === "object") measured = m; } catch { measured = {}; }
    const list = by.get(r.deliverable) ?? [];
    list.push({ at: r.at, pass: r.pass === 1, route: r.route, measured });
    by.set(r.deliverable, list);
  }
  const reads = await env.DB.prepare(`SELECT deliverable, verdict, why, at FROM quality_reads WHERE at > ? ORDER BY at DESC`).bind(now - DRIFT.week_ms)
    .all<{ deliverable: string; verdict: string; why: string; at: number }>();
  const label = (k: string) => DELIVERABLES.find((d) => d.key === k)?.label ?? k;
  const seen = new Set<string>();
  return {
    at: now,
    lines: DELIVERABLES.map((d) => driftLine(d, by.get(d.key) ?? [], now)),
    reads: (reads.results ?? []).filter((r) => !seen.has(r.deliverable) && seen.add(r.deliverable)).map((r) => ({ ...r, label: label(r.deliverable) })),
  };
}

/* ─── THE MONTHLY READ ─────────────────────────────────────────────────────────────────────────── */

const cut = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const parse = (s: string | null | undefined): unknown => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** A briefing, cut to what a reader judges it on: each headline and the reasoning under it. */
function briefingDigest(row: { day_id: string; sections: string | null; sources: string | null } | null): string | null {
  if (!row) return null;
  const sections = (parse(row.sections) as Record<string, unknown>[] | null) ?? [];
  const sources = (parse(row.sources) as unknown[] | null) ?? [];
  const lines: string[] = [`Day ${row.day_id}: ${sections.length} sections, ${sources.length} sources.`];
  for (const sec of sections) {
    for (const it of (Array.isArray(sec?.items) ? sec.items : []).slice(0, 5) as Record<string, unknown>[]) {
      const head = cut(it.headline ?? it.title, 200);
      if (head) lines.push(`- ${head} :: ${cut(it.why_it_matters ?? it.so_what ?? it.body, 700)}`);
    }
  }
  return lines.slice(0, 26).join("\n");
}

async function rowsDigest(env: DB, table: string, cols: string, where: string, binds: unknown[]): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY created_at DESC LIMIT 8`).bind(...binds).all<Record<string, unknown>>();
  const rows = r.results ?? [];
  return rows.length ? rows.map((x) => `- ${Object.values(x).map((v) => cut(v, 260)).filter(Boolean).join(" | ")}`).join("\n") : null;
}

/** The newest checked run of a deliverable and its best passing one (by its first measure). */
async function newestAndBest(env: DB, key: string, first: string): Promise<{ newest: string | null; best: string | null }> {
  const newest = await env.DB.prepare(`SELECT run_id FROM delivery_measures WHERE deliverable = ? AND run_id IS NOT NULL ORDER BY at DESC LIMIT 1`).bind(key).first<{ run_id: string }>();
  const best = await env.DB.prepare(
    `SELECT run_id FROM delivery_measures WHERE deliverable = ? AND pass = 1 AND run_id IS NOT NULL AND run_id != ?
      ORDER BY CAST(json_extract(measured, '$.' || ?) AS REAL) DESC, at DESC LIMIT 1`).bind(key, newest?.run_id ?? "", first).first<{ run_id: string }>();
  return { newest: newest?.run_id ?? null, best: best?.run_id ?? null };
}

export interface QualityReadAsk { prompt: string; expect: string[] }

/**
 * The read's instruction, built from her own records when the task is made. `expect` lists the
 * deliverables that have a real output to read; one with none is left out and said so in the email
 * ("not read"). Null when there is nothing at all to read: the duty then stops by name.
 */
export async function composeQualityRead(env: DB): Promise<QualityReadAsk | null> {
  const parts: string[] = [];
  const expect: string[] = [];
  const add = (key: string, label: string, newest: string | null, best: string | null) => {
    if (!newest) return;
    expect.push(key);
    parts.push(`### ${label} (deliverable: ${key})\nNEWEST OUTPUT:\n${newest}\n\nBEST EXAMPLE ON RECORD:\n${best ?? "none on record yet: judge the newest output on its own substance and say that no example was available."}`);
  };

  const newestBrief = await env.DB.prepare(`SELECT day_id, sections, sources FROM executive_reports WHERE status != 'failed' ORDER BY day_id DESC LIMIT 1`).first<{ day_id: string; sections: string | null; sources: string | null }>();
  const bestBrief = await env.DB.prepare(
    `SELECT day_id, sections, sources FROM executive_reports WHERE status = 'complete' AND day_id != ?
      ORDER BY json_array_length(COALESCE(sources, '[]')) DESC, day_id DESC LIMIT 1`).bind(newestBrief?.day_id ?? "").first<{ day_id: string; sections: string | null; sources: string | null }>();
  add("executive_reports", "Daily briefing", briefingDigest(newestBrief), briefingDigest(bestBrief));

  for (const [key, label, table, cols] of [
    ["sourcing_candidates", "Brokerage sourcing", "sourcing_candidates", "name, kind, thesis, source_url"],
    ["link_prospects", "Backlink prospecting", "link_prospects", "property, url, kind, rationale, approach"],
    ["tool_suggestions", "Tools worth knowing", "tool_suggestions", "name, url, what_it_does, verdict, evidence_url"],
  ] as const) {
    const runs = await newestAndBest(env, key, "new_rows");
    const newest = runs.newest ? await rowsDigest(env, table, cols, "run_id = ?", [runs.newest]) : await rowsDigest(env, table, cols, "1 = 1", []);
    const best = runs.best ? await rowsDigest(env, table, cols, "run_id = ?", [runs.best]) : null;
    add(key, label, newest, best);
  }
  if (expect.length === 0) return null;

  const prompt = [
    "You are reading her deliverables the way a demanding editor would: one real, recent output of each, beside the best example on record.",
    "Judge SUBSTANCE, not counts (the counts are already measured): is the reasoning specific and correct, are the items the right ones, would she act on it, is anything padded, repeated or vague where the best example is sharp?",
    "Research nothing and open no links. Everything you need is below. The contents are her private business records: quote at most a few words.",
    "",
    parts.join("\n\n"),
    "",
    "Write delivers.json in your working directory, then read it back and confirm it parses:",
    '  reads [{ "deliverable": one of the deliverable keys above, "verdict": "holds" or "slipped", "why": one or two plain sentences a person can check against the output, naming what is as good as the best example or what is worse }]',
    `One read for each of: ${expect.join(", ")}. "holds" means it is as good as the best example in substance; "slipped" means it is not, and "why" says where.`,
  ].join("\n");
  return { prompt, expect };
}

const VERDICTS = ["holds", "slipped"];
/** The reads worth keeping: a known deliverable, a verdict, and a reason long enough to check. One per deliverable. */
export function validReads(payload: Record<string, unknown> | null): { deliverable: string; verdict: string; why: string }[] {
  const out: { deliverable: string; verdict: string; why: string }[] = [];
  for (const r of Array.isArray(payload?.reads) ? (payload!.reads as unknown[]) : []) {
    const x = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const deliverable = cut(x.deliverable, 60), verdict = cut(x.verdict, 20).toLowerCase(), why = cut(x.why, 600);
    if (DELIVERABLES.some((d) => d.key === deliverable) && VERDICTS.includes(verdict) && why.length >= 40 && !out.some((o) => o.deliverable === deliverable)) out.push({ deliverable, verdict, why });
  }
  return out;
}

/** The read's own floor: a verdict with a checkable reason for every deliverable it was handed. */
export function qualityReadsFloor(payload: Record<string, unknown> | null, expect: string[]): FloorVerdict {
  if (!payload) return { pass: false, misses: ["no readable delivers.json reached Boss OS"], measured: { reads: 0 } };
  const reads = validReads(payload);
  const missing = expect.filter((k) => !reads.some((r) => r.deliverable === k));
  const misses = reads.length === 0 ? ["it delivered no read with a verdict and a reason"] : missing.length ? [`no read for ${missing.join(", ")}`] : [];
  return { pass: misses.length === 0, misses, measured: { reads: reads.length, expected: expect.length, slipped: reads.filter((r) => r.verdict === "slipped").length } };
}
