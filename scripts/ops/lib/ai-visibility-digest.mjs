/**
 * THE AI ANSWERS READ, SPLIT BY WHAT EACH HALF IS GOOD AT (27 Nov 2026, the code-tools job: "context size is the cost").
 *
 * Measured over the five November runs of scripts/ops/ai-visibility.sh: 3.5M input tokens a run, 82% of them
 * OpenSEO's raw tool results carried turn after turn (final context ~320K), and the session then copied
 * 36 observations per site back out as JSON by hand. On 24 and 26 Nov that copy broke mid-block on the
 * sixth site (OPENSEO_BAD_REPLY): a transcription job given to the model, failing as transcription does.
 *
 * So the reading is split:
 *   · CODE reads every OpenSEO result. `scripts/ops/ai-visibility-hook.mjs` is the session's PostToolUse hook:
 *     it keeps each raw result in the run's work dir (the stash, deleted with it) and hands the model
 *     `digestFor(tool, result)` instead: only what the model's next step needs.
 *   · CODE builds the week. `weekFromStash` makes tracker, run, OpenSEO's own summary and every observation
 *     from the stash, exactly; the post step joins it to the lanes the session chose.
 *   · THE MODEL decides only what is meaning: which tool to call next and, for each question that cited us
 *     nowhere, which lane fixes it (own / claim / earn / contest) and why.
 *
 * The OpenSEO calls themselves stay with the session: OpenSEO is reached only through her signed-in Claude
 * plugin (its OAuth token is Claude Code's, in her keychain), and no repo code calls OpenSEO over HTTP
 * (validate:claude-runs). A digest never hides a failure: an error or an unreadable result reaches the
 * model as `{"error": …}`, never as an empty list.
 */

export const TOOL_PREFIX = "mcp__plugin_openseo_openseo__";

const short = (tool) => String(tool ?? "").replace(TOOL_PREFIX, "");
const host = (d) => String(d ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const uniq = (xs) => [...new Set(xs)];

/** The text of an MCP tool result, however Claude Code hands it over (string, content blocks, or {content}). */
export function textOf(response) {
  if (typeof response === "string") return response;
  const blocks = Array.isArray(response) ? response : Array.isArray(response?.content) ? response.content : null;
  if (blocks) return blocks.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).join("");
  if (response?.structuredContent) return JSON.stringify(response.structuredContent);
  return response == null ? "" : JSON.stringify(response);
}

/** The parsed body of a result, or { error } (never a silent empty). */
export function parsed(response) {
  const text = textOf(response);
  let body;
  try { body = JSON.parse(text); } catch { return { error: `OpenSEO's reply was not JSON: ${text.replace(/\s+/g, " ").slice(0, 300) || "(empty)"}` }; }
  if (!body || typeof body !== "object") return { error: "OpenSEO's reply was not an object" };
  if (response?.isError === true || body.error || (body.status && body.status !== "ok" && body.status !== "success")) {
    return { error: String(body.error?.message ?? body.error ?? body.message ?? `status ${body.status}`).slice(0, 300) };
  }
  return { body, data: body.data ?? body };
}

const runOf = (r) => (r ? { id: r.id, status: r.status, trigger: r.trigger, createdAt: r.createdAt, expected: r.expected, completed: r.completed, failed: r.failed } : null);
const newest = (runs) => [...(Array.isArray(runs) ? runs : [])].sort((a, b) => Date.parse(b?.createdAt ?? "") - Date.parse(a?.createdAt ?? ""))[0] ?? null;

/** Observation status as the week reads it: answered, no_answer or failed. */
export function statusOf(row) {
  if (row?.status === "failed" || row?.error) return "failed";
  if (row?.answerStatus === "answered") return "answered";
  if (row?.answerStatus === "no_answer" || row?.answerStatus === "noAnswer") return "no_answer";
  return row?.status === "completed" ? "no_answer" : "failed";
}
const ownBrands = (row) => (Array.isArray(row?.brands) ? row.brands : []).filter((b) => b?.own === true);
const rivalsOf = (row) => uniq((Array.isArray(row?.brands) ? row.brands : []).filter((b) => b?.own !== true && b?.mentioned === true).map((b) => host(b.domain)).filter(Boolean));

/**
 * What the model sees in place of a raw OpenSEO result: the fields its next step needs and nothing else.
 * Ids the model must pass back (project, run, cursor) are kept whole; observation ids, answer text,
 * timestamps, capabilities and links are dropped (code reads those from the stash).
 */
export function digestFor(tool, response) {
  const p = parsed(response);
  if (p.error) return { error: p.error };
  const d = p.data;
  switch (short(tool)) {
    case "whoami":
      return { creditsRemaining: d.creditsRemaining ?? d.meta?.creditsRemaining ?? p.body.meta?.creditsRemaining ?? null };
    case "list_projects":
      return { projects: (d.projects ?? []).map((x) => ({ id: x.id, domain: host(x.domain) })) };
    case "get_ai_visibility_tracker": {
      if (!d.tracker) return { tracker: null, configured: d.configured ?? false };
      return {
        projectId: d.tracker.projectId,
        tracker: { enabled: d.tracker.enabled, scheduleInterval: d.tracker.scheduleInterval },
        engines: d.engines ?? [],
        prompts: (d.prompts ?? []).filter((x) => !x.archived).map((x) => ({ id: x.id, text: x.text, ...(x.paused ? { paused: true } : {}) })),
        newestRun: runOf(newest(d.recentRuns)),
      };
    }
    case "estimate_ai_visibility_cost":
      return { costCredits: d.costCredits ?? null, scheduleInterval: d.scheduleInterval ?? null };
    case "get_ai_visibility_run":
      return runOf(d);
    case "get_ai_visibility_results": {
      // One line per question: which engines answered, named us, cited us; the rivals named.
      const by = new Map();
      for (const r of d.rows ?? []) {
        const q = by.get(r.promptId) ?? { promptId: r.promptId, answered: [], noAnswer: [], failed: [], namedUsOn: [], citedUsOn: [], rivals: [] };
        const s = statusOf(r);
        q[s === "answered" ? "answered" : s === "no_answer" ? "noAnswer" : "failed"].push(r.engine);
        if (s === "answered" && ownBrands(r).some((b) => b.mentioned === true)) q.namedUsOn.push(r.engine);
        if (s === "answered" && ownBrands(r).some((b) => b.cited === true)) q.citedUsOn.push(r.engine);
        q.rivals = uniq([...q.rivals, ...rivalsOf(r)]);
        by.set(r.promptId, q);
      }
      const own = (d.summaries ?? []).find((s) => s?.own === true);
      return { runId: d.runId ?? d.run?.id, rows: (d.rows ?? []).length, totalCount: d.totalCount, nextCursor: d.nextCursor ?? null, ownSummary: own ? { mentions: own.mentions, citations: own.citations } : null, questions: [...by.values()] };
    }
    case "get_ai_visibility_sources": {
      // Inverted to what a lane needs: each question → the domains its answers cited.
      const byPrompt = {};
      for (const r of d.rows ?? []) for (const pid of r.promptIds ?? []) (byPrompt[pid] ??= []).push(host(r.domain));
      return { runId: d.runId, rows: (d.rows ?? []).length, totalCount: d.totalCount, nextCursor: d.nextCursor ?? null, citedByQuestion: byPrompt };
    }
    case "get_ai_visibility_answer":
      return { note: "answer text is not passed to this session; it is not needed for a lane" };
    default:
      return d;
  }
}

/** One stash line → { tool, input, p } (the parse kept, never re-done per caller). */
const read = (rows) => rows.map((r) => ({ tool: short(r.tool), input: r.input ?? {}, p: parsed(r.response) }));

/**
 * Follow a paged tool's cursor chain from the first page (no cursor) to a page with no next cursor.
 * Returns the pages in order, or { missing } naming the first page that was never read.
 */
function chain(calls, tool, projectId, runId, extra = () => true) {
  const pages = calls.filter((c) => c.tool === tool && c.input.projectId === projectId && c.input.runId === runId && extra(c.input) && !c.p.error);
  const at = (cursor) => pages.find((c) => (c.input.cursor ?? null) === cursor);
  const out = [];
  let cursor = null;
  for (let n = 0; n < 100; n++) {
    const page = at(cursor);
    if (!page) return { missing: cursor === null ? "the first page" : `the page after cursor ${cursor}` };
    out.push(page.p.data);
    cursor = page.p.data.nextCursor ?? null;
    if (cursor === null) return { pages: out };
  }
  return { missing: "a cursor chain that never ends" };
}

/**
 * The week for one site, built from the stash alone: { block } in readSite's shape (lanes empty, the
 * session's go in later), or { stop, why }. Never a number the stash does not hold.
 */
export function weekFromStash(rows, site) {
  const calls = read(Array.isArray(rows) ? rows : []);
  const stop = (s, why) => ({ stop: s, why });
  const projects = calls.filter((c) => c.tool === "list_projects" && !c.p.error).at(-1);
  if (!projects) return stop("OPENSEO_UNREACHABLE", "the project list was never read");
  const project = (projects.p.data.projects ?? []).find((x) => host(x.domain) === host(site));
  if (!project) return stop("OPENSEO_NO_TRACKER", `OpenSEO has no project for ${site}`);
  const tr = calls.filter((c) => c.tool === "get_ai_visibility_tracker" && c.input.projectId === project.id && !c.p.error).at(-1);
  if (!tr) return stop("OPENSEO_SHORT_READ", "the tracker was never read");
  const t = tr.p.data;
  if (!t.tracker) return stop("OPENSEO_NO_TRACKER");
  const latest = newest(t.recentRuns);
  if (!latest) return stop("OPENSEO_NOT_YET", "the tracker has no run yet");

  const results = chain(calls, "get_ai_visibility_results", project.id, latest.id);
  if (results.missing) return stop("OPENSEO_SHORT_READ", `the newest run's results: ${results.missing} was never read`);
  const sources = chain(calls, "get_ai_visibility_sources", project.id, latest.id, (i) => (i.groupBy ?? "domain") === "domain");
  if (sources.missing) return stop("OPENSEO_SHORT_READ", `the newest run's sources: ${sources.missing} was never read`);

  const cited = new Map();
  for (const page of sources.pages) for (const r of page.rows ?? []) for (const oid of r.observationIds ?? []) cited.set(oid, uniq([...(cited.get(oid) ?? []), host(r.domain)]));
  const first = results.pages[0];
  const own = (first.summaries ?? []).find((s) => s?.own === true);
  const run = first.run ?? latest;
  const observations = results.pages.flatMap((pg) => pg.rows ?? []).map((r) => {
    const status = statusOf(r);
    const answered = status === "answered";
    return {
      id: r.id, prompt_id: r.promptId, engine: r.engine, status,
      mentioned: answered ? ownBrands(r).some((b) => b.mentioned === true) : null,
      cited: answered ? ownBrands(r).some((b) => b.cited === true) : null,
      rivals: answered ? rivalsOf(r) : [], sources: answered ? cited.get(r.id) ?? [] : [],
    };
  });
  return {
    block: {
      site: host(site),
      tracker: { prompts: (t.prompts ?? []).filter((x) => !x.archived).map((x) => ({ id: x.id, text: x.text })), engines: t.engines ?? [] },
      run: { id: run.id, createdAt: run.createdAt, expected: run.expected, completed: run.completed, failed: run.failed },
      summary_own: own ? { mentions: own.mentions, citations: own.citations } : null,
      observations,
      lanes: [],
    },
  };
}

/** Read the stash file's lines; a line that does not parse is dropped and counted, never guessed at. */
export function stashRows(text) {
  const rows = [];
  let bad = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { bad++; }
  }
  return { rows, bad };
}
