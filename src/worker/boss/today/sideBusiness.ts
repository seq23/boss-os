import type { Env } from "../env";
import { daysBetween } from "../practice/lapse";

/**
 * THE WEALTH BLOCK'S SIDE BUSINESS — ONE A DAY, PICKED FROM REAL SIGNALS (owner, Today v4, 31 Oct 2026).
 *
 * The Wealth block has two parts: Core business in the morning (brokerage, LPs, West Peek) and Side
 * business in the afternoon. Boss OS picks ONE side business for the day and says why in one line:
 *
 *   1. leads waiting      — an interested reply to its outreach in the last 14 days (`outreach_replies`)
 *   2. a site broken / red — its latest health reading is `warn`, or a grid observation is open
 *   3. revenue coming in   — its income line measured an outcome this month (`line_returns`)
 *   4. longest untouched   — the one picked longest ago (`side_business_days`), never-picked first
 *
 * WEEKENDS LEAN SIDE. On a weekday a side business is picked only when a real signal (1–3) says so; a
 * quiet weekday says so and Core business has the day. On Saturday and Sunday one is always picked,
 * the longest untouched when nothing is calling.
 *
 * THE DAY IS THE PRIMARY KEY of `side_business_days`, so a reload never picks a second one.
 * The list is the grid's side businesses (src/shared/boss/grid.mjs, `owner: "hers"`, primary or the
 * guides generator they sell through), grouped the way she names them; client properties are never here.
 */

export interface SideBusiness {
  key: string;
  name: string;
  /** Grid property keys (src/shared/boss/grid.mjs) whose health counts for it. */
  grid: string[];
  /** Outreach business keys (outreach/catalog.ts) whose replies are its leads. */
  outreach: string[];
  /** Income line keys (today/projects.ts) whose returns are its revenue. */
  lines: string[];
  /** Where she works on it. */
  href: string;
}

export const SIDE_BUSINESSES: readonly SideBusiness[] = [
  { key: "industry_guides", name: "Industry Guides", grid: ["citation_velocity", "guides_generator"], outreach: ["uscisexam", "dentistryguides", "hormonesivhair", "neuroevalguides", "theaccidentguides", "memphisseniorcarehomes"], lines: ["industry_guides"], href: "/?tab=team&view=outreach" },
  { key: "a_player_mode", name: "A Player Mode", grid: ["hpc"], outreach: ["aplayermode"], lines: ["a_player_mode"], href: "/?tab=team&view=outreach" },
  { key: "time2read", name: "Time2Read", grid: ["saas_apps"], outreach: ["time2read"], lines: ["saas_apps", "time2read"], href: "/?tab=team&view=outreach" },
  { key: "approvalprep", name: "ApprovalPrep", grid: ["approvalprep"], outreach: ["approvalprep"], lines: ["approvalprep"], href: "/?tab=team&view=outreach" },
  { key: "wedding", name: "Wedding sites", grid: ["wedding"], outreach: ["weddingchecklist"], lines: ["wedding", "digital_products"], href: "/?tab=team&view=outreach" },
  { key: "how_we_know", name: "How We Know", grid: ["youtube"], outreach: [], lines: ["how_we_know"], href: "/?tab=systems&section=health" },
  { key: "virtual_agency", name: "Virtual Agency OS", grid: ["virtual_agency"], outreach: [], lines: ["virtual_agency"], href: "/?tab=systems&section=health" },
  { key: "creator_network", name: "Creator Network", grid: ["creator_network"], outreach: [], lines: ["creator_network"], href: "/?tab=systems&section=health" },
];

export type SideSignal = "leads" | "broken" | "revenue" | "untouched" | "none";

export interface SideSignals {
  leads: Record<string, number>;
  broken: Record<string, string>;
  revenue: Record<string, number>;
  /** The last day each was picked; absent means never. */
  lastPicked: Record<string, string>;
}

/**
 * PLAIN WORDS ONLY (make-it-calm). The reading behind "broken" can be a workflow file or a repo name;
 * none of that reaches her screen (31 Oct 2026, the first live pick printed a workflow path). The
 * detail lives on Systems → Health, one tap away.
 */
export const brokenLine = (name: string) => `${name}: a site check is red. Open it and see what needs you`;

export interface SidePick { key: string | null; name: string | null; line: string; why: string; signal: SideSignal; href: string | null }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Pure: the day's pick. The order of the checks is the order of the rule above. */
export function pickSide(sig: SideSignals, today: string, weekday: number): SidePick {
  const all = SIDE_BUSINESSES;
  const top = (score: (b: SideBusiness) => number) => all.map((b) => ({ b, n: score(b) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0] ?? null;
  const quiet = (b: SideBusiness) => (all.length > 1 ? "; the others are quiet today." : ".");

  const leads = top((b) => sig.leads[b.key] ?? 0);
  if (leads) return { key: leads.b.key, name: leads.b.name, signal: "leads", href: leads.b.href,
    line: `${leads.b.name}: ${plural(leads.n, "lead")} to answer`, why: `it has leads waiting${quiet(leads.b)}` };
  const broken = all.find((b) => sig.broken[b.key]);
  if (broken) return { key: broken.key, name: broken.name, signal: "broken", href: "/?tab=systems&section=health",
    line: brokenLine(broken.name), why: "its site needs a look before it costs you visitors" };
  const revenue = top((b) => sig.revenue[b.key] ?? 0);
  if (revenue) return { key: revenue.b.key, name: revenue.b.name, signal: "revenue", href: revenue.b.href,
    line: `${revenue.b.name}: money is coming in, so push what is working`, why: "it brought in money this month" };

  const weekend = weekday === 0 || weekday === 6;
  if (!weekend) return { key: null, name: null, signal: "none", href: null,
    line: "No side business today: none has leads, a broken site or money coming in", why: "a quiet weekday, so Core business has the day" };
  const untouched = [...all].sort((a, b) => {
    const da = sig.lastPicked[a.key]; const db = sig.lastPicked[b.key];
    if (!da && !db) return 0;
    if (!da) return -1;
    if (!db) return 1;
    return da.localeCompare(db);
  })[0]!;
  const last = sig.lastPicked[untouched.key];
  return { key: untouched.key, name: untouched.name, signal: "untouched", href: untouched.href,
    line: `${untouched.name}: one hour moving it forward`,
    why: last ? `nothing is calling, and it is the one left alone longest (${plural(daysBetween(last, today), "day")})` : "nothing is calling, and it has not had a weekend hour yet" };
}

/** Read the signals from D1. Each read fails soft: a missing table is "no signal", never a crash. */
export async function sideSignals(env: Env, today: string, now = Date.now()): Promise<SideSignals> {
  const db = env.DB;
  const safe = async <T,>(p: Promise<{ results?: T[] }>): Promise<T[]> => { try { return (await p).results ?? []; } catch { return []; } };
  const month = today.slice(0, 7);
  const [replies, health, obs, returns, picks] = await Promise.all([
    safe<{ business_key: string; n: number }>(db.prepare(`SELECT business_key, COUNT(*) AS n FROM outreach_replies WHERE classification = 'interested' AND received_at > ? AND approval_id IS NULL GROUP BY business_key`).bind(now - 14 * 86_400_000).all()),
    safe<{ property_key: string; state: string; summary: string }>(db.prepare(`SELECT h.property_key, h.state, h.summary FROM property_health_readings h JOIN (SELECT property_key, MAX(read_at) AS t FROM property_health_readings GROUP BY property_key) l ON l.property_key = h.property_key AND l.t = h.read_at`).all()),
    safe<{ property_key: string; headline: string }>(db.prepare(`SELECT property_key, headline FROM grid_observations WHERE state IN ('open','shown') AND kind IN ('ci_red','unreachable')`).all()),
    safe<{ line: string; n: number }>(db.prepare(`SELECT line, SUM(outcome_count) AS n FROM line_returns WHERE period = ? AND outcome_count > 0 GROUP BY line`).bind(month).all()),
    safe<{ business_key: string; d: string }>(db.prepare(`SELECT business_key, MAX(day) AS d FROM side_business_days WHERE day < ? GROUP BY business_key`).bind(today).all()),
  ]);
  const sig: SideSignals = { leads: {}, broken: {}, revenue: {}, lastPicked: {} };
  for (const b of SIDE_BUSINESSES) {
    const n = replies.filter((r) => b.outreach.includes(r.business_key)).reduce((s, r) => s + Number(r.n ?? 0), 0);
    if (n) sig.leads[b.key] = n;
    const warn = health.find((h) => b.grid.includes(h.property_key) && h.state === "warn");
    const red = obs.find((o) => b.grid.includes(o.property_key));
    if (warn || red) sig.broken[b.key] = "red";
    const rev = returns.filter((r) => b.lines.includes(r.line)).reduce((s, r) => s + Number(r.n ?? 0), 0);
    if (rev) sig.revenue[b.key] = rev;
  }
  for (const p of picks) sig.lastPicked[p.business_key] = p.d;
  return sig;
}

/** Today's pick, kept: the first read of the day writes it, every later read returns the same one. */
export async function sideBusinessToday(env: Env, today: string, weekday: number, now = Date.now()): Promise<SidePick> {
  const kept = await env.DB.prepare(`SELECT business_key, line, why, signal FROM side_business_days WHERE day = ?`).bind(today)
    .first<{ business_key: string; line: string; why: string; signal: SideSignal }>().catch(() => null);
  if (kept) {
    const b = SIDE_BUSINESSES.find((x) => x.key === kept.business_key) ?? null;
    // A kept "broken" pick is re-worded on read, so a line kept before the plain-words rule never shows.
    const line = kept.signal === "broken" && b ? brokenLine(b.name) : kept.line;
    return { key: b?.key ?? null, name: b?.name ?? null, line, why: kept.why, signal: kept.signal, href: b ? (kept.signal === "broken" ? "/?tab=systems&section=health" : b.href) : null };
  }
  const pick = pickSide(await sideSignals(env, today, now), today, weekday);
  await env.DB.prepare(`INSERT INTO side_business_days (day, business_key, line, why, signal, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(day) DO NOTHING`)
    .bind(today, pick.key ?? "none", pick.line, pick.why, pick.signal, now).run().catch(() => undefined);
  return pick;
}
