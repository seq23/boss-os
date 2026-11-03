/**
 * THE SEARCH LOOP'S WEEKLY REPORT, READ (owner, 1 Nov 2026: the search growth loop on every selling
 * site; the spec is the spry brain's Settled decisions, "Search growth loop on every selling site").
 *
 * Every site that runs the shared engine (seq23/search-loop) uploads one GitHub Actions artifact a
 * week named `search-loop-week`, holding JSON of schema `search-loop-week-v1`:
 *   { site, generated_at, state, published, indexed, pace, ai_visitors, ai_bot_hits, conversions,
 *     wins, undone, merged, held_by_cap, redirected[], cap, notes[], run_url }
 * Since engine v1.3.0 (owner, 3 Nov 2026) there is no fixed pace: new pages publish only while the
 * site's live engine pages are under a per-site cap that grows 10% a week only when Google
 * impressions grow (falls 10% on a drop, holds when Search Console has no numbers), and a search with
 * the same intent as an existing page becomes a strengthen brief for that URL instead of a new page.
 * `cap` = { max_live_pages, live, room, why }; `held_by_cap` = searches the cap kept back this week;
 * `redirected` = [{ query, strengthen: <existing URL> }]. `pace` is now only the free-lane run guard.
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
/**
 * The cap rule (engine v1.3.0, src/cap.mjs): start at the site's distinct live pages (at least 20),
 * +10% a week only when Google impressions beat the 28 days before, -10% on a drop (never under 10);
 * at most 10 new pages a day as a run guard for the shared free lanes, never a pace that grows.
 */
export const CAP = Object.freeze({ start_pages: 20, min_pages: 10, grow_share: 0.1, max_per_day: 10 });
/** The report's `state` (schema search-loop-week-v1): running (normal), slow / off (the global throttle), stopped (a named stop). */
export const LOOP_STATES = Object.freeze(["running", "slow", "off", "stopped"]);
export const NUMBER_FIELDS = Object.freeze(["published", "indexed", "pace", "ai_visitors", "ai_bot_hits", "conversions", "wins", "undone", "merged", "held_by_cap"]);

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

/**
 * Is publishing held to the outcome-gated cap (v1.3.0)? The report must carry the cap with its size
 * and why, the count it held back, and each same-intent search sent to an existing URL. A report
 * without them is from an engine older than v1.3.0 (or a broken one), never a pass.
 */
export function capOk(week) {
  const cap = week?.cap;
  if (!cap || typeof cap !== "object") return { ok: false, why: "the report carries no cap, so publishing is not held to results (the engine is older than v1.3.0)" };
  const max = num(cap.max_live_pages);
  if (max == null || !Number.isInteger(max) || max < CAP.min_pages) return { ok: false, why: `the cap's size ${cap.max_live_pages ?? "is missing"}${max != null ? ` is under ${CAP.min_pages} live pages` : ""}` };
  if (!String(cap.why ?? "").trim()) return { ok: false, why: "the cap does not say why it is that size" };
  if (num(week?.held_by_cap) == null) return { ok: false, why: "the report does not say how many searches the cap held back" };
  if (!Array.isArray(week?.redirected) || week.redirected.some((x) => !x || !/^https?:\/\//.test(String(x.strengthen ?? "")))) return { ok: false, why: "the report does not list each same-intent search with the existing page it strengthens" };
  const live = num(cap.live), room = num(cap.room);
  const r = week.redirected.length;
  return { ok: true, why: `cap ${max} live pages${live != null ? ` (${live} live${room != null ? `, room for ${room}` : ""})` : ""}: ${cap.why}; ${week.held_by_cap} held back, ${r} sent to strengthen an existing page` };
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
 *   "Published 21 pages · 38 indexed · 4 AI visitors · 2 form fills · 2 wins, 1 undone · cap 40 pages, 2 waiting"
 */
export function loopLine(weeks, { actionWord = "form fills" } = {}) {
  const ws = (weeks ?? []).filter(Boolean);
  if (!ws.length) return null;
  const sum = (k) => (ws.every((w) => num(w[k]) != null) ? ws.reduce((a, w) => a + w[k], 0) : null);
  const p = sum("published"), i = sum("indexed"), ai = sum("ai_visitors"), c = sum("conversions"), w = sum("wins"), u = sum("undone"), m = sum("merged");
  const capped = ws.every((x) => num(x?.cap?.max_live_pages) != null && num(x.held_by_cap) != null && Array.isArray(x.redirected));
  const capMax = capped ? ws.reduce((a, x) => a + x.cap.max_live_pages, 0) : null, held = capped ? ws.reduce((a, x) => a + x.held_by_cap, 0) : null;
  const sent = capped ? ws.reduce((a, x) => a + x.redirected.length, 0) : null;
  const parts = [
    p == null ? "pages published not read" : `Published ${plural(p, "page")}`,
    i == null ? "indexing not read" : `${i} indexed`,
    ai == null ? "AI visitors not read" : `${plural(ai, "AI visitor")}`,
    c == null ? `${actionWord} not read` : `${c} ${actionWord}`,
    w == null || u == null ? "the 2/4/8-week checks not read" : `${plural(w, "win")}, ${u} undone${m ? `, ${m} merged` : ""}`,
    capMax == null ? "the page cap not read" : `cap ${capMax} pages, ${held} waiting${sent ? `, ${sent} sent to existing pages` : ""}`,
  ];
  const line = parts.join(" · ");
  return (ws.length > 1 ? `${line} (${ws.length} sites)` : line).replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * WHICH KIND OF SEARCH WINS, PER SITE (engine v1.6.0, owner 3 Nov 2026: "sometimes we find where we
 * can just be 1 or closer to 1 and move forward"). The engine picks searches in two lanes and its
 * report's `lanes` block says, per lane, `pages`, `measured` (pages past their 2-week Search Console
 * check), `top3` (of those, how many reached Google's top 3) and `hit_rate` (a number, or
 * "not read: <reason>"). Engine src/compete.mjs `laneStats`, src/report.mjs `lanesBlock`.
 */
export const LANE_LABELS = Object.freeze({ can_be_one: "Can be #1 now", striking: "Striking distance" });
export const LANES_NOT_YET = "lanes start with engine v1.6";

/** One lane in plain words: "3 of 5 pages reached Google's top 3", or "not read: <reason>". Never a guessed 0. */
export function laneText(x, { first = false } = {}) {
  if (!x || typeof x !== "object") return "not read: the report does not carry this lane";
  const hr = x.hit_rate;
  if (typeof hr === "string" && hr.startsWith("not read: ")) return hr;
  const measured = Number.isInteger(x.measured) ? x.measured : null, top3 = Number.isInteger(x.top3) ? x.top3 : null;
  if (measured == null || top3 == null || top3 > measured) return "not read: the report's counts for this lane are missing or do not add up";
  if (typeof hr !== "number" && hr !== undefined) return "not read: the report's hit rate for this lane is not a number";
  if (measured === 0) return "not read: no page in this lane has reached its 2-week check yet";
  return first ? `${top3} of ${plural(measured, "page")} reached Google's top 3` : `${top3} of ${measured}`;
}

/**
 * The lane line for one site's report: "Can be #1 now: 3 of 5 pages reached Google's top 3 ·
 * Striking distance: 1 of 4". A report from an engine older than v1.6.0 has no `lanes` block and
 * says "lanes start with engine v1.6"; a block that is there but unreadable says "not read".
 */
export function laneLine(week) {
  if (!week || typeof week !== "object") return null;
  if (!("lanes" in week)) return LANES_NOT_YET;
  const L = week.lanes;
  if (!L || typeof L !== "object") return "Lanes not read: the report's lanes block could not be read";
  const one = laneText(L.can_be_one, { first: true });
  const two = laneText(L.striking, { first: !/^\d/.test(one) });
  return `${LANE_LABELS.can_be_one}: ${one} · ${LANE_LABELS.striking}: ${two}`;
}
