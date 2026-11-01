/**
 * THE SEARCH LOOP'S WEEKLY REPORT, READ (owner, 1 Nov 2026: the search growth loop on every selling
 * site; the spec is the spry brain's Settled decisions, "Search growth loop on every selling site").
 *
 * Every site that runs the shared engine (seq23/search-loop) uploads one GitHub Actions artifact a
 * week named `search-loop-week`, holding JSON of schema `search-loop-week-v1`:
 *   { site, generated_at, state, published, indexed, pace, ai_visitors, ai_bot_hits, conversions,
 *     wins, undone, merged, notes[], run_url }
 * Two readers use it, through this one module so they cannot disagree:
 *   - the Monday Search Readiness audit (f2, f7, f8, f10, f11: is each loop stage really running?)
 *   - the Wednesday Spry Labs email (one plain line per site of hers).
 *
 * Pure: no network. The fetch lives in scripts/ops/lib/search-loop-week.mjs.
 *
 * RULE 0: a number that is missing is NOT READ, never a zero. A report that did not arrive says so,
 * and a site that has not adopted the engine yet says "not started yet", never "0 pages".
 */

export const LOOP_ARTIFACT = "search-loop-week";
export const LOOP_SCHEMA = "search-loop-week-v1";
export const LOOP_ENGINE_REPO = "seq23/search-loop";
/** A weekly report older than this is last week's, not this week's. */
export const LOOP_MAX_AGE_DAYS = 8;
/** The pace rule (10 a day to start, +5 a week while indexing holds, cap 30, halve on a drop). */
export const PACE = Object.freeze({ start: 10, step: 5, cap: 30, min: 1 });
/** The report's `state` (schema search-loop-week-v1): running (normal), slow / off (the global throttle), stopped (a named stop). */
export const LOOP_STATES = Object.freeze(["running", "slow", "off", "stopped"]);
export const NUMBER_FIELDS = Object.freeze(["published", "indexed", "pace", "ai_visitors", "ai_bot_hits", "conversions", "wins", "undone", "merged"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bare = (h) => String(h ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Why one parsed report cannot be used, or null. */
export function weekProblem(week, { now = Date.now(), maxAgeDays = LOOP_MAX_AGE_DAYS } = {}) {
  if (!week || typeof week !== "object") return "it could not be read";
  if (week.schema !== LOOP_SCHEMA) return "it was in a format Boss OS does not know";
  if (!week.site) return "it named no site";
  const at = Date.parse(week.generated_at ?? "");
  if (Number.isNaN(at)) return "it carried no date";
  if (now - at > maxAgeDays * 86_400_000) return `the newest one is ${Math.round((now - at) / 86_400_000)} days old`;
  return null;
}

/**
 * The newest usable report for one site. A report names its site by domain; a repo that runs one
 * loop for all its sites may name the repo instead, and then it speaks for each of them.
 * Returns `{ week }`, `{ problem }` (there were reports, none usable), or `{ none: true }`.
 */
export function weekFor(weeks, { domain, repo = null, now = Date.now(), maxAgeDays = LOOP_MAX_AGE_DAYS } = {}) {
  const d = bare(domain);
  const mine = (weeks ?? []).filter((w) => w && (bare(w.site) === d || (repo && String(w.site ?? "").toLowerCase() === String(repo).toLowerCase())));
  if (!mine.length) return { none: true };
  const newest = [...mine].sort((a, b) => (Date.parse(b.generated_at ?? "") || 0) - (Date.parse(a.generated_at ?? "") || 0))[0];
  const p = weekProblem(newest, { now, maxAgeDays });
  return p ? { problem: p, week: newest } : { week: newest };
}

/** Is new-page publishing on (the 1 Nov rule: straight away, under the quality gate)? */
export function publishingOn(week) {
  const state = String(week?.state ?? "");
  if (!LOOP_STATES.includes(state)) return { ok: false, why: `the report's state "${state}" is not one the engine writes` };
  if (state === "off") return { ok: false, why: "the search loop is switched off (mode=off)" };
  if (state === "stopped") return { ok: false, why: `the loop stopped: ${(week.notes ?? []).find((n) => /NAMED STOP/.test(n)) ?? "a named stop (see the report's notes)"}` };
  if (num(week?.published) == null) return { ok: false, why: "the report does not say how many pages were published" };
  return { ok: true, why: `${week.published} pages published this week` };
}

/** Is the pace inside the rule (1 to 30 a day) and set from a measured indexing count? */
export function paceOk(week) {
  const pace = num(week?.pace), indexed = num(week?.indexed);
  if (pace == null) return { ok: false, why: "the report carries no pace" };
  if (indexed == null) return { ok: false, why: "the report carries no indexing count, so the pace was not set by indexing" };
  if (pace < PACE.min || pace > PACE.cap) return { ok: false, why: `pace ${pace} a day is outside 1 to ${PACE.cap}` };
  return { ok: true, why: `pace ${pace} a day with ${indexed} pages indexed` };
}

/** Did the 2/4/8-week checks run (wins, undone and merged are each a number)? */
export function checksRan(week) {
  const missing = ["wins", "undone", "merged"].filter((k) => num(week?.[k]) == null);
  return missing.length ? { ok: false, why: `the 2/4/8-week checks did not report ${missing.join(", ")}` } : { ok: true, why: `${week.wins} strengthened wins, ${week.undone} undone, ${week.merged} merged` };
}

/** Are AI-referral visits and AI-bot reads both measured? */
export function aiMeasured(week) {
  const missing = [["ai_visitors", "AI-referral visits"], ["ai_bot_hits", "AI-bot reads"]].filter(([k]) => num(week?.[k]) == null).map(([, w]) => w);
  return missing.length ? { ok: false, why: `not measured: ${missing.join(" and ")}` } : { ok: true, why: `${week.ai_visitors} AI-referral visits, ${week.ai_bot_hits} AI-bot reads` };
}

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/**
 * The one plain line for her email, from the fresh reports of one site of hers (several when a
 * business runs several sites). Any number a report did not carry is said as "not read", never 0.
 *   "Published 21 pages · 38 indexed · 4 AI visitors · 2 form fills · 2 wins, 1 undone"
 */
export function loopLine(weeks, { actionWord = "form fills" } = {}) {
  const ws = (weeks ?? []).filter(Boolean);
  if (!ws.length) return null;
  const sum = (k) => (ws.every((w) => num(w[k]) != null) ? ws.reduce((a, w) => a + w[k], 0) : null);
  const p = sum("published"), i = sum("indexed"), ai = sum("ai_visitors"), c = sum("conversions"), w = sum("wins"), u = sum("undone"), m = sum("merged");
  const parts = [
    p == null ? "pages published not read" : `Published ${plural(p, "page")}`,
    i == null ? "indexing not read" : `${i} indexed`,
    ai == null ? "AI visitors not read" : `${plural(ai, "AI visitor")}`,
    c == null ? `${actionWord} not read` : `${c} ${actionWord}`,
    w == null || u == null ? "the 2/4/8-week checks not read" : `${plural(w, "win")}, ${u} undone${m ? `, ${m} merged` : ""}`,
  ];
  const line = parts.join(" · ");
  return (ws.length > 1 ? `${line} (${ws.length} sites)` : line).replace(/^./, (ch) => ch.toUpperCase());
}
