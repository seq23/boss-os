/**
 * THE AI ANSWERS LOOP, PURE RULES (her ask, 22 Nov 2026: "build the ai visibility loop"; weekly by her yes).
 *
 * Once a week the Mac duty `ai-visibility` (scripts/ops/ai-visibility.sh) has a locked Claude session
 * read OpenSEO's weekly run for each selling site through the openseo plugin (9 read-only tools:
 * scripts/ops/ai-visibility-permissions.json). The session prints one JSON block per site, over many
 * turns; those blocks are read from the run's own event stream (`sessionTranscript`: every assistant
 * text block, in order), never from the run's final message alone, which carries only its last turn
 * (24 Nov 2026: two runs in a row read 0 sites because the blocks were printed in earlier turns).
 * This file is the ONE reading of that block, used twice so the two sides cannot disagree:
 *   - on the Mac (scripts/ops/ai-visibility-report.mjs), with the site's fetched sitemap, so an OWN page
 *     is one of that site's engine question pages (A3);
 *   - in the Worker (src/worker/boss/growth/aiAnswers.ts), which stores it and never trusts the Mac's
 *     arithmetic: every count is recomputed here from the observations.
 *
 * RULE 0 SHAPES. A site that cannot be read is `not_read` with a NAMED STOP (never 0, never "no
 * misses"): OpenSEO down, out of credits, the plugin missing, no answers, a run older than 8 days,
 * a short read (fewer observations than prompts × engines), or counts that do not add up to
 * OpenSEO's own summary. A model reply that is not this shape is that site's `OPENSEO_BAD_REPLY`.
 *
 * PRIVACY. Rows keep prompts (ours, neutral, no names) and DOMAINS only: never the AI answer's text.
 */

export const ENGINES = Object.freeze(["chatgpt", "gemini", "google_ai_overview"]);
export const LANES = Object.freeze(["own", "claim", "earn", "contest"]);
/** After MAX_FIX_ATTEMPTS fixes that did not get us cited, a miss moves on (contest is the last lane). */
export const NEXT_LANE = Object.freeze({ own: "claim", claim: "earn", earn: "contest", contest: null });
export const MAX_FIX_ATTEMPTS = 2;
/** A week older than this is not this week's: the scoreboard says "not read", never last week's number. */
export const WEEK_MAX_AGE_DAYS = 8;
/** Under this share of the expected answers collected, the run is too thin to count (OPENSEO_NO_ANSWERS). */
export const MIN_COMPLETED_SHARE = 0.75;
/** At most this many prompts a site (her plan: 10-15). */
export const MAX_PROMPTS = 15;
/** Her plan is ~432 credits a week (6 sites × 12 prompts × 3 engines × 2); 500 is the hard stop (A8). */
export const OVER_PLAN_CREDITS = 500;

/** The named stops a site's week can end on. Every one is "not read". */
export const STOPS = Object.freeze({
  OPENSEO_UNREACHABLE: "OpenSEO could not be reached",
  OPENSEO_CREDITS: "OpenSEO is out of credits",
  PLUGIN_NOT_LOADED: "the OpenSEO tools did not load in the reading session",
  OPENSEO_NOT_REACHED: "the reading session never made a successful OpenSEO call, so anything it printed would be a guess",
  OPENSEO_NO_TRACKER: "OpenSEO has no answer tracker for this site",
  OPENSEO_NO_ANSWERS: "OpenSEO collected too few answers this week",
  OPENSEO_NOT_YET: "OpenSEO's newest weekly run is not in yet",
  OPENSEO_SHORT_READ: "the reading session did not read every answer",
  OPENSEO_BAD_REPLY: "the reading session's reply for this site was not usable",
  SITE_MISSING: "the reading session did not report this site",
  OPENSEO_STASH_UNREAD: "the run's own copy of OpenSEO's results could not be read, so code could not build the week",
  LOOP_CONFIG_UNREAD: "the site's search-loop settings could not be read, so its own pages cannot be checked",
  SITEMAP_UNREAD: "the site's sitemap could not be read, so its own pages cannot be checked",
});

/**
 * The six selling sites: host → business (the scoreboard and roster key) and whether the site runs
 * the search loop (it then reads its OWN misses through GET ai-misses). aplayermode.com has no loop:
 * its search-loop config belongs to another domain (A6), so its OWN misses are Director to-dos.
 */
export const AI_SITES = Object.freeze({
  "porchandparty901.com": Object.freeze({ business: "porch-and-party", repo: "p-n-p", loop: true }),
  "approvalprep.com": Object.freeze({ business: "approvalprep", repo: "approvalprep", loop: true }),
  "weddingchecklistpdf.com": Object.freeze({ business: "dream-wedding", repo: "dream-wedding-builder", loop: true }),
  "keepmyproof.com": Object.freeze({ business: "keepmyproof", repo: "keepmyproof", loop: true }),
  "peacebestillapp.com": Object.freeze({ business: "peace-be-still", repo: "peace-be-still", loop: true }),
  "aplayermode.com": Object.freeze({ business: "a-player-mode", repo: "sprylabs-hpc-site", loop: false }),
});
export const NO_LOOP_NOTE = "no search loop on this host";

const DAY_MS = 86_400_000;

/** An OpenSEO tool, by its plugin name (mcp__plugin_openseo_openseo__whoami and the like). */
export const OPENSEO_TOOL_RE = /^mcp__plugin_openseo_openseo__/;

/** Each line of a stream-json run, parsed; a line that is not JSON is `{ raw }` (ai-run's own NAMED STOP lines). */
function streamEvents(stream) {
  const out = [];
  for (const line of String(stream ?? "").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { out.push({ raw: line }); continue; }
    out.push(e && typeof e === "object" ? e : { raw: line });
  }
  return out;
}
const contentOf = (e) => (Array.isArray(e?.message?.content) ? e.message.content : []);

/**
 * Did the run's OWN events show a successful OpenSEO call? A tool_use on an OpenSEO tool whose
 * tool_result is not an error. A model without the tool answers anyway (CONFIRMED 22 Oct 2026, the
 * rule duty-kit.mjs `readClaudeStream` keeps), so a run that never reached OpenSEO reads nothing.
 */
export function openseoReached(stream) {
  const calls = new Map();
  for (const e of streamEvents(stream)) {
    if (e.type === "assistant") for (const c of contentOf(e)) if (c?.type === "tool_use" && OPENSEO_TOOL_RE.test(String(c.name ?? ""))) calls.set(c.id, false);
    if (e.type === "user") for (const c of contentOf(e)) if (c?.type === "tool_result" && calls.has(c.tool_use_id) && c.is_error !== true) calls.set(c.tool_use_id, true);
  }
  return [...calls.values()].some(Boolean);
}

/**
 * The session's own printed words from its stream-json run: every ASSISTANT text block, in order,
 * verbatim (a tool's result is never included, so a SITE-BEGIN block inside OpenSEO's data can never
 * become a week). With no assistant text at all, the result event's text (a usage-limit notice still
 * reaches the log). Lines that are not JSON pass through. `openseo` says whether OpenSEO was reached.
 */
export function sessionTranscript(stream) {
  const events = streamEvents(stream);
  const said = [];
  const raw = [];
  let result = null;
  for (const e of events) {
    if (e.raw !== undefined) { raw.push(e.raw); continue; }
    if (e.type === "assistant") for (const c of contentOf(e)) if (c?.type === "text" && typeof c.text === "string") said.push(c.text);
    if (e.type === "result" && typeof e.result === "string") result = e.result;
  }
  const text = said.length ? said : result ? [result] : [];
  return { lines: [...text, ...raw].join("\n"), final: result ?? "", raw: raw.join("\n"), openseo: openseoReached(stream) };
}

/** ISO 8601 week of a moment, in UTC: "2026-W48". */
export function isoWeek(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

/** OpenSEO's weekly checks all run Tuesday 04:00 UTC (A9). */
export const RUN_DAY_UTC = 2;
export const RUN_HOUR_UTC = 4;
/**
 * The week a read with no run of its own belongs to: the week of the newest scheduled run at or before
 * `now`. A by-hand rerun on a Monday that cannot reach OpenSEO is stamped with LAST Tuesday's week (so
 * it never hides that week's read behind a newer "not read" one), never the calendar week it ran in.
 */
export function expectedWeek(now) {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC);
  while (new Date(t).getUTCDay() !== RUN_DAY_UTC || t > now) t -= DAY_MS;
  return isoWeek(t);
}

/** A bare domain ("example.com") from a domain or URL, or null when it is not one. */
export function domainOf(s) {
  const d = String(s ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, "");
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d) ? d : null;
}

/** A URL on exactly this host (https, no port, no credentials), under `prefix` when one is given. */
export function pageOnHost(url, host, prefix = null) {
  let u;
  try { u = new URL(String(url ?? "")); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  if (h !== host && h !== `www.${host}`) return false;
  if (prefix && !u.pathname.startsWith(prefix)) return false;
  return true;
}

/** A search-loop `output.url_prefix` we accept: "/questions/" and the like. */
export const prefixOk = (p) => typeof p === "string" && /^\/[a-z0-9][a-z0-9-]{0,40}\/$/.test(p);

/** Stable miss id: sha1(host + prompt text), hex (CONTRACT). WebCrypto, so the Mac and the Worker agree. */
export async function missId(host, prompt) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${host}${prompt}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v, n) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const domains = (xs, own) => [...new Set((Array.isArray(xs) ? xs : []).map(domainOf).filter((d) => d && d !== own))].slice(0, 20);
const notRead = (stop, why, extra = {}) => ({ status: "not_read", stop, why: why ?? STOPS[stop], ...extra });
const hasAddress = (s) => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(s);

/**
 * One site's week from the reading session's block. `pages` (Mac only) = { engine: Set, all: Set } from
 * the fetched sitemap; `prefix` = the site's search-loop url_prefix, or null when it runs no loop.
 * Returns { status: "read", week, run_id, run_at, prompts, answered, cited, mentioned, engines, obs,
 * misses, notes } or { status: "not_read", stop, why, week? }.
 */
export function readSite(block, { host, now = Date.now(), prefix = null, pages = null } = {}) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return notRead("OPENSEO_BAD_REPLY", "the reply for this site was not a JSON object");
  if (domainOf(block.site) !== host) return notRead("OPENSEO_BAD_REPLY", "the reply named a different site");
  if (block.stop != null) {
    const stop = String(block.stop);
    return STOPS[stop] ? notRead(stop) : notRead("OPENSEO_BAD_REPLY", "the reply's stop is not one this loop knows");
  }
  const prompts = Array.isArray(block.tracker?.prompts) ? block.tracker.prompts : null;
  if (!prompts || !prompts.length) return notRead("OPENSEO_NO_TRACKER");
  if (prompts.length > MAX_PROMPTS) return notRead("OPENSEO_BAD_REPLY", `the tracker has ${prompts.length} prompts, over the ${MAX_PROMPTS} planned`);
  const text = new Map();
  for (const p of prompts) {
    const id = str(p?.id, 80), t = str(p?.text, 300);
    if (!id || !t || text.has(id) || hasAddress(t)) return notRead("OPENSEO_BAD_REPLY", "a prompt had no id, no text, a repeat id or an address");
    text.set(id, t);
  }
  const engines = Array.isArray(block.tracker?.engines) ? block.tracker.engines.map(String) : [];
  if (engines.length !== ENGINES.length || !ENGINES.every((e) => engines.includes(e))) return notRead("OPENSEO_BAD_REPLY", `the tracker's engines are not ${ENGINES.join(", ")}`);

  const run = block.run ?? {};
  const runAt = Date.parse(String(run.createdAt ?? ""));
  if (!str(run.id, 80) || Number.isNaN(runAt)) return notRead("OPENSEO_BAD_REPLY", "the run had no id or no date");
  if (runAt > now + 3_600_000) return notRead("OPENSEO_BAD_REPLY", "the run is dated in the future");
  const week = isoWeek(runAt);
  if (now - runAt > WEEK_MAX_AGE_DAYS * DAY_MS) return notRead("OPENSEO_NOT_YET", `the newest run is ${Math.floor((now - runAt) / DAY_MS)} days old`, { week: expectedWeek(now) });
  const expected = prompts.length * ENGINES.length;
  if (Number(run.expected) !== expected) return notRead("OPENSEO_SHORT_READ", `the run expected ${run.expected} answers, not ${expected} (prompts × engines)`, { week });

  // Every prompt × engine exactly once, each with its own observation id.
  const obsIn = Array.isArray(block.observations) ? block.observations : [];
  const seen = new Set(), ids = new Set(), obs = [];
  for (const o of obsIn) {
    const pid = str(o?.prompt_id, 80), engine = String(o?.engine ?? ""), oid = str(o?.id, 80);
    const status = String(o?.status ?? "");
    if (!text.has(pid) || !ENGINES.includes(engine) || !oid || ids.has(oid) || seen.has(`${pid}|${engine}`)) return notRead("OPENSEO_SHORT_READ", "an observation was unknown, repeated or had no id", { week });
    if (!["answered", "no_answer", "failed"].includes(status)) return notRead("OPENSEO_SHORT_READ", "an observation had no status", { week });
    const answered = status === "answered";
    if (answered && (typeof o.mentioned !== "boolean" || typeof o.cited !== "boolean")) return notRead("OPENSEO_SHORT_READ", "an answered observation did not say whether we were named and cited", { week });
    seen.add(`${pid}|${engine}`); ids.add(oid);
    obs.push({ prompt_id: pid, engine, obs_id: oid, status, mentioned: answered ? o.mentioned : null, cited: answered ? o.cited : null,
      rivals: answered ? domains(o.rivals, host) : [], sources: answered ? domains(o.sources, host) : [] });
  }
  if (obs.length !== expected) return notRead("OPENSEO_SHORT_READ", `read ${obs.length} of ${expected} answers`, { week });

  const got = obs.filter((o) => o.status !== "failed").length;
  if (Number(run.completed) !== got) return notRead("OPENSEO_SHORT_READ", `OpenSEO says ${run.completed} answers came back; the reply has ${got}`, { week });
  const answeredObs = obs.filter((o) => o.status === "answered");
  if (!answeredObs.length || got < expected * MIN_COMPLETED_SHARE) return notRead("OPENSEO_NO_ANSWERS", `${got} of ${expected} answers came back`, { week });
  // Cross-check against OpenSEO's own summary for our brand: counts the session made up are refused.
  const sum = block.summary_own ?? {};
  const mentionObs = answeredObs.filter((o) => o.mentioned).length, citeObs = answeredObs.filter((o) => o.cited).length;
  if (Number(sum.mentions) !== mentionObs || Number(sum.citations) !== citeObs) return notRead("OPENSEO_SHORT_READ", `the answers add up to ${mentionObs} mentions and ${citeObs} citations; OpenSEO's summary says ${sum.mentions} and ${sum.citations}`, { week });

  const per = Object.fromEntries(ENGINES.map((e) => [e, { answered: 0, mentioned: 0, cited: 0 }]));
  for (const o of answeredObs) { per[o.engine].answered++; if (o.mentioned) per[o.engine].mentioned++; if (o.cited) per[o.engine].cited++; }
  const byPrompt = new Map([...text.keys()].map((k) => [k, answeredObs.filter((o) => o.prompt_id === k)]));
  const answeredPrompts = [...byPrompt.values()].filter((a) => a.length).length;
  const cited = [...byPrompt.values()].filter((a) => a.some((o) => o.cited)).length;
  const mentioned = [...byPrompt.values()].filter((a) => a.some((o) => o.mentioned)).length;

  // The misses: answered on some engine, cited on none. A prompt no engine answered is unknown, not a miss.
  const lanes = new Map((Array.isArray(block.lanes) ? block.lanes : []).map((l) => [str(l?.prompt_id, 80), l]));
  const notes = [];
  const misses = [];
  for (const [pid, a] of byPrompt) {
    if (!a.length || a.some((o) => o.cited)) continue;
    const l = lanes.get(pid) ?? {};
    const lane = LANES.includes(l.lane) ? l.lane : null;
    const sources = [...new Set(a.flatMap((o) => o.sources))];
    const rivals = [...new Set(a.flatMap((o) => o.rivals))];
    // OWN: an engine question page of this site, else the best fit becomes a "strengthen" to-do (A3).
    let page_url = null, fit_url = null;
    const want = typeof l.page_url === "string" ? l.page_url : null;
    const fit = typeof l.fit_url === "string" ? l.fit_url : null;
    const engineOk = (u) => prefix && pageOnHost(u, host, prefix) && (!pages || pages.engine.has(u));
    const anyOk = (u) => pageOnHost(u, host) && (!pages || pages.all.has(u) || pages.engine.has(u));
    if (want && engineOk(want)) page_url = want;
    else if (want && anyOk(want)) fit_url = want;
    else if (want) notes.push(`${pid}: page ${want} is not one of this site's pages, dropped`);
    if (!fit_url && fit && !engineOk(fit) && anyOk(fit)) fit_url = fit;
    if (page_url) fit_url = null;
    // CLAIM / EARN / CONTEST: the source must be one this prompt's answers actually cited.
    const sd = domainOf(l.source_domain);
    const source_domain = sd && sources.includes(sd) ? sd : null;
    if (sd && !source_domain) notes.push(`${pid}: source ${sd} was not cited for this question, dropped`);
    const draft = str(l.draft, 600);
    misses.push({
      prompt_id: pid, prompt: text.get(pid), lane, why: str(l.why, 300) || null,
      page_url, fit_url, source_domain, channel: /^[a-z0-9-]{2,30}$/.test(String(l.channel ?? "")) ? l.channel : null,
      draft: draft && !hasAddress(draft) ? draft : null,
      engines_missed: ENGINES.filter((e) => a.some((o) => o.engine === e)),
      rivals, cited_sources: sources,
    });
  }
  return { status: "read", week, run_id: str(run.id, 80), run_at: runAt, prompts: text.size, answered: answeredPrompts, cited, mentioned, engines: per, obs: obs.map((o) => ({ ...o, prompt: text.get(o.prompt_id) })), misses, notes };
}

/** The credit lines the session prints before and after: both numbers, and equal (A8: the duty only reads). */
export function creditsProblem(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "NAMED STOP [OPENSEO_CREDITS_UNREAD] the session did not report OpenSEO's credits before and after, so a read-only run is not proven";
  if (before !== after) return `NAMED STOP [OPENSEO_CREDITS_MOVED] OpenSEO's credits went from ${before} to ${after} during a read-only run`;
  return null;
}

/** The weekly estimate across the sites, or a named stop: unknown is never "within plan". */
export function planProblem(perSite) {
  const vals = Object.values(perSite ?? {});
  if (vals.length !== Object.keys(AI_SITES).length || vals.some((v) => !Number.isFinite(v) || v < 0)) return { total: null, stop: "NAMED STOP [OPENSEO_ESTIMATE_UNREAD] OpenSEO's weekly estimate was not read for every site, so the plan cannot be checked" };
  const total = vals.reduce((a, v) => a + v, 0);
  return total > OVER_PLAN_CREDITS ? { total, stop: `NAMED STOP [OPENSEO_OVER_PLAN] OpenSEO's weekly checks would cost ${total} credits, over the ${OVER_PLAN_CREDITS} plan` } : { total, stop: null };
}

/**
 * The page's "AI answers" card for one site from its stored weeks: the newest week, when it was read and
 * is no older than WEEK_MAX_AGE_DAYS, beside the read week before it. Otherwise "not read" with why.
 */
export function aiCard(reads, now = Date.now()) {
  const rows = [...(reads ?? [])].sort((a, b) => String(b.week).localeCompare(String(a.week)));
  const read = rows.filter((r) => r.status === "read" && Number.isFinite(r.run_at));
  // The NEWEST week decides: a week that was not read is "not read", never last week's number again.
  const cur = rows[0] === read[0] && read[0] && now - read[0].run_at <= WEEK_MAX_AGE_DAYS * DAY_MS ? read[0] : null;
  if (!cur) {
    const last = rows[0];
    const why = last?.status === "not_read" ? (STOPS[last.stop] ?? "not read") : read[0] ? `the newest read week (${read[0].week}) is over ${WEEK_MAX_AGE_DAYS} days old` : "no week read yet";
    return { state: "not read", why, stop: last?.status === "not_read" ? last.stop : null, week: last?.week ?? null };
  }
  const prev = read[1] ?? null;
  const parse = (t) => { try { return typeof t === "string" ? JSON.parse(t) : t ?? {}; } catch { return {}; } };
  const e = parse(cur.engines), pe = prev ? parse(prev.engines) : null;
  return {
    state: "read", week: cur.week, day: new Date(cur.run_at).toISOString().slice(0, 10), prompts: cur.prompts, cited: cur.cited, mentioned: cur.mentioned, answered: cur.answered,
    before: prev ? { week: prev.week, cited: prev.cited, mentioned: prev.mentioned } : null,
    engines: ENGINES.map((k) => ({ engine: k, answered: e[k]?.answered ?? 0, mentioned: e[k]?.mentioned ?? 0, cited: e[k]?.cited ?? 0,
      before: pe ? { mentioned: pe[k]?.mentioned ?? 0, cited: pe[k]?.cited ?? 0 } : null })),
  };
}

/** The engines in her words. */
export const ENGINE_LABEL = Object.freeze({ chatgpt: "ChatGPT", gemini: "Gemini", google_ai_overview: "Google AI Overviews" });
