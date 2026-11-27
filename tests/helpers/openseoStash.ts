/**
 * Synthetic OpenSEO replies, shaped like the real ones (field names as OpenSEO's MCP returned them in Nov
 * 2026), for the AI answers read's code half. No real prompt, domain or id: the repo is public.
 *
 * `stashFor(block)` turns a readSite-shaped week (tracker, run, summary_own, observations) into the stash
 * rows the session's hook would have kept for it: list_projects, tracker, results pages and sources pages,
 * paged at `limit` like the session asks. `weekFromStash` must then rebuild the same week.
 */
const P = "mcp__plugin_openseo_openseo__";
const reply = (data: unknown) => [{ type: "text", text: JSON.stringify({ status: "ok", data, meta: { url: "https://app.example/x" } }) }];
const projectIdOf = (host: string) => `proj-${host}`;

export function stashFor(block: any, { limit = 4, host = block.site, extraRun = null as any } = {}): any[] {
  const pid = projectIdOf(host);
  const rows: any[] = [];
  const add = (tool: string, input: any, data: any) => rows.push({ tool: P + tool, input, response: reply(data) });
  rows.push({ tool: P + "whoami", input: {}, response: [{ type: "text", text: JSON.stringify({ userEmail: "someone@example.com", scopes: ["read"], creditsRemaining: 900 }) }] });
  rows.push({ tool: P + "list_projects", input: {}, response: [{ type: "text", text: JSON.stringify({ projects: [{ id: pid, name: host, domain: host, url: `https://${host}` }, { id: "proj-other", name: "other", domain: "other.example" }] }) }] });
  const run = { ...block.run, status: "completed", trigger: "scheduled", pending: 0, completedAt: block.run.createdAt, pollAfterSeconds: 0 };
  add("get_ai_visibility_tracker", { projectId: pid }, {
    configured: true, providerConfigured: true,
    tracker: { id: "trk-1", projectId: pid, enabled: true, scheduleInterval: "weekly", createdAt: "2026-11-01T00:00:00Z" },
    topics: ["t"], prompts: block.tracker.prompts.map((p: any) => ({ ...p, topic: "t", paused: false, archived: false, branded: false, hasResults: true })),
    brands: [{ name: "Us", domain: host, own: true }], engines: block.tracker.engines,
    capabilities: [{ engine: "chatgpt", label: "ChatGPT", unsupportedLocationCodes: [], maxPromptLength: 500, note: "a long note ".repeat(20), modelApi: true }],
    recentRuns: [run, ...(extraRun ? [extraRun] : [])],
  });
  const obs = block.observations;
  const own = (o: any) => ({ name: "Us", domain: host, own: true, mentioned: o.mentioned === true, cited: o.cited === true, firstMention: null });
  const rowOf = (o: any) => ({
    id: o.id, runId: run.id, promptId: o.prompt_id, prompt: block.tracker.prompts.find((p: any) => p.id === o.prompt_id)?.text ?? "", topic: "t", branded: false,
    engine: o.engine, status: o.status === "failed" ? "failed" : "completed",
    brands: [own(o), ...(o.rivals ?? []).map((d: string) => ({ name: d, domain: d.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""), own: false, mentioned: true, cited: false, firstMention: null }))],
    answerStatus: o.status === "failed" ? null : o.status, citationCount: (o.sources ?? []).length, collectedAt: block.run.createdAt, error: o.status === "failed" ? "engine timeout" : null,
  });
  const ans = obs.filter((o: any) => o.status === "answered");
  const summaries = [{ name: "Us", domain: host, own: true, answers: ans.length, mentions: block.summary_own.mentions, citations: block.summary_own.citations, positionTotal: 0, positionCount: 0 }];
  for (let i = 0; i < obs.length; i += limit) {
    const next = i + limit < obs.length ? String(i + limit) : null;
    add("get_ai_visibility_results", { projectId: pid, runId: run.id, limit, ...(i ? { cursor: String(i) } : {}) },
      { runId: run.id, run, rows: obs.slice(i, i + limit).map(rowOf), totalCount: obs.length, nextCursor: next, summaries, coverage: { expected: run.expected, completed: run.completed, failed: run.failed, pending: 0, noAnswer: 0 }, appliedFilters: {}, truncated: false });
  }
  const byDomain = new Map<string, { promptIds: Set<string>; observationIds: string[] }>();
  for (const o of ans) for (const s of o.sources ?? []) {
    const d = String(s).replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
    const e = byDomain.get(d) ?? { promptIds: new Set(), observationIds: [] };
    e.promptIds.add(o.prompt_id); e.observationIds.push(o.id); byDomain.set(d, e);
  }
  const srcRows = [...byDomain].map(([d, e]) => ({ key: d, url: null, domain: d, title: null, ownership: d === host ? "own" : "other", answerCount: e.observationIds.length, promptCount: e.promptIds.size, promptIds: [...e.promptIds], engines: [], observationIds: e.observationIds, truncated: false }));
  const pages = Math.max(1, Math.ceil(srcRows.length / limit));
  for (let n = 0; n < pages; n++) {
    const i = n * limit;
    add("get_ai_visibility_sources", { projectId: pid, runId: run.id, groupBy: "domain", limit, ...(i ? { cursor: String(i) } : {}) },
      { runId: run.id, rows: srcRows.slice(i, i + limit), totalCount: srcRows.length, nextCursor: n + 1 < pages ? String(i + limit) : null, coverage: {}, appliedFilters: {}, groupBy: "domain", truncated: false });
  }
  return rows;
}

/** The stash as the file the hook writes: one JSON line per row. */
export const stashText = (rows: any[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
