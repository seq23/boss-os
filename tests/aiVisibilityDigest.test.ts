/**
 * THE AI ANSWERS READ, CODE HALF (27 Nov 2026, the code-tools job). The session's PostToolUse hook keeps
 * every OpenSEO result and hands the model a digest; the post step builds the week from what it kept.
 * HOW IT BREAKS, each proven here:
 *   - tokens: the digest is a fraction of the raw reply (the filter dropped → red);
 *   - same results: the week rebuilt from the stash reads exactly as the week it came from;
 *   - outage: a missing page, an error reply, no project list, no stash → that site "not read", never a week;
 *   - permissions: the session's file allows only the nine read tools and runs only this one hook.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINES, readSite } from "../src/shared/boss/growth/aiAnswers.mjs";
import { digestFor, stashRows, weekFromStash } from "../scripts/ops/lib/ai-visibility-digest.mjs";
import { STASH_FAILED, handle } from "../scripts/ops/ai-visibility-hook.mjs";
import { entriesFrom, parseRun, sessionTokens } from "../scripts/ops/ai-visibility-report.mjs";
// @ts-expect-error plain .mjs
import { hookProblems, permissionProblems, scriptProblems } from "../scripts/validate/claude-runs-locked.mjs";
import { stashFor, stashText } from "./helpers/openseoStash";

const NOW = Date.parse("2026-11-24T18:00:00Z");
const HOST = "keepmyproof.com";
const P = "mcp__plugin_openseo_openseo__";
const id = (s: string, n: number) => `${s}${String(n).padStart(4, "0")}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;

/** A week the size of a real one: 12 questions × 3 engines, rivals and cited sources on most answers. */
function week(o: { failedOn?: (p: number, e: string) => boolean } = {}) {
  const prompts = Array.from({ length: 12 }, (_, i) => ({ id: id("p", i), text: `which app keeps proof of rent payment number ${i}` }));
  const observations = prompts.flatMap((p, i) => ENGINES.map((e, j) => {
    const failed = o.failedOn?.(i, e) ?? false;
    return {
      id: id("o", i * 3 + j), prompt_id: p.id, engine: e, status: failed ? "failed" : "answered",
      mentioned: failed ? null : i % 3 === 0, cited: failed ? null : i % 4 === 0 && e === "chatgpt",
      rivals: failed ? [] : [`rival-${i % 5}.example`, `rival-${(i + 1) % 5}.example`],
      sources: failed ? [] : Array.from({ length: 6 }, (_, k) => `source-${(i * 7 + k * 3 + j) % 40}.example`),
    };
  }));
  const ans = observations.filter((x) => x.status === "answered");
  return {
    site: HOST, tracker: { prompts, engines: [...ENGINES] },
    run: { id: id("r", 1), createdAt: "2026-11-24T04:00:00.000Z", expected: 36, completed: ans.length, failed: 36 - ans.length },
    summary_own: { mentions: ans.filter((x) => x.mentioned).length, citations: ans.filter((x) => x.cited).length },
    observations, lanes: [],
  };
}
const readOf = (b: any) => readSite(b, { host: HOST, now: NOW });
/** Order inside a domain list carries no meaning (OpenSEO lists sources by domain, the week by answer). */
const sorted = (x: any): any => (Array.isArray(x) ? (x.every((v) => typeof v === "string") ? [...x].sort() : x.map(sorted)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sorted(v)])) : x);

describe("weekFromStash: code builds the week from OpenSEO's own replies", () => {
  it("the week rebuilt from the stash reads exactly as the week it came from", () => {
    const b = week({ failedOn: (p, e) => p === 2 && e === "gemini" });
    const w: any = weekFromStash(stashFor(b, { limit: 5 }), HOST);
    expect(w.stop).toBeUndefined();
    const a: any = readOf(b), c: any = readOf(w.block);
    expect(a.status).toBe("read");
    expect(sorted(c)).toEqual(sorted(a));
    expect(c.obs).toHaveLength(36);
  });
  it("the newest run is the one read; a newer run whose pages were never read is a short read, not last week", () => {
    const b = week();
    const older = { ...b.run, id: "older", createdAt: "2026-11-17T04:00:00.000Z" };
    expect((weekFromStash(stashFor(b, { extraRun: older }), HOST) as any).block.run.id).toBe(b.run.id);
    const newer = { ...b.run, id: "newer", createdAt: "2026-11-25T04:00:00.000Z" };
    expect(weekFromStash(stashFor(b, { extraRun: newer }), HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ" });
  });
  it("a results page or a sources page never read makes the site a short read", () => {
    const rows = stashFor(week(), { limit: 5 });
    const results = rows.filter((r) => r.tool.endsWith("get_ai_visibility_results"));
    const sources = rows.filter((r) => r.tool.endsWith("get_ai_visibility_sources"));
    expect(results.length).toBeGreaterThan(2);
    expect(sources.length).toBeGreaterThan(2);
    expect(weekFromStash(rows.filter((r) => r !== results[3]), HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ", why: expect.stringMatching(/results: the page after cursor 15/) });
    expect(weekFromStash(rows.filter((r) => r !== sources.at(-1)), HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ", why: expect.stringMatching(/sources/) });
    expect(weekFromStash(rows.filter((r) => r !== results[0]), HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ", why: expect.stringMatching(/first page/) });
  });
  it("an error reply is never a page: the site is a short read", () => {
    const rows = stashFor(week(), { limit: 50 }).map((r) => (r.tool.endsWith("get_ai_visibility_results") ? { ...r, response: [{ type: "text", text: JSON.stringify({ status: "error", error: { message: "rate limited" } }) }] } : r));
    expect(weekFromStash(rows, HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ" });
  });
  it("no project list, no project for the host, no tracker, no run: each a named stop", () => {
    const rows = stashFor(week());
    expect(weekFromStash(rows.filter((r) => !r.tool.endsWith("list_projects")), HOST)).toMatchObject({ stop: "OPENSEO_UNREACHABLE" });
    expect(weekFromStash(rows, "approvalprep.com")).toMatchObject({ stop: "OPENSEO_NO_TRACKER" });
    expect(weekFromStash(rows.filter((r) => !r.tool.endsWith("tracker")), HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ" });
    const noTracker = rows.map((r) => (r.tool.endsWith("tracker") ? { ...r, response: [{ type: "text", text: JSON.stringify({ status: "ok", data: { configured: false, tracker: null } }) }] } : r));
    expect(weekFromStash(noTracker, HOST)).toMatchObject({ stop: "OPENSEO_NO_TRACKER" });
    expect(weekFromStash([], HOST)).toMatchObject({ stop: "OPENSEO_UNREACHABLE" });
  });
  it("a stash line that does not parse is counted, never guessed at", () => {
    expect(stashRows('{"tool":"a"}\nnot json\n\n{"tool":"b"}\n')).toEqual({ rows: [{ tool: "a" }, { tool: "b" }], bad: 1 });
  });
});

describe("digestFor: the model sees only what its next step needs", () => {
  const rows = stashFor(week(), { limit: 50 });
  const raw = rows.reduce((n, r) => n + (r.response[0].text as string).length, 0);
  const cut = rows.reduce((n, r) => n + JSON.stringify(digestFor(r.tool, r.response)).length, 0);
  it("the digest of a whole week is at most a quarter of OpenSEO's raw replies (measured on her real weeks: 12%)", () => {
    expect(cut / raw).toBeLessThan(0.25);
  });
  it("results become one line per question: answered, named, cited, rivals", () => {
    const r = rows.find((x) => x.tool.endsWith("get_ai_visibility_results"))!;
    const d = digestFor(r.tool, r.response);
    expect(d.questions).toHaveLength(12);
    expect(d.questions[0]).toEqual({ promptId: id("p", 0), answered: [...ENGINES], noAnswer: [], failed: [], namedUsOn: [...ENGINES], citedUsOn: ["chatgpt"], rivals: ["rival-0.example", "rival-1.example"] });
    expect(d).toMatchObject({ nextCursor: null, totalCount: 36, ownSummary: expect.any(Object) });
    expect(JSON.stringify(d)).not.toContain(id("o", 0));
  });
  it("sources become each question's cited domains", () => {
    const r = rows.find((x) => x.tool.endsWith("get_ai_visibility_sources"))!;
    const d = digestFor(r.tool, r.response);
    expect(d.citedByQuestion[id("p", 1)]).toEqual(expect.arrayContaining(["source-7.example"]));
    expect(JSON.stringify(d)).not.toContain(id("o", 1));
  });
  it("the tracker keeps the questions and the newest run, never capabilities or links", () => {
    const r = rows.find((x) => x.tool.endsWith("tracker"))!;
    const d = digestFor(r.tool, r.response);
    expect(d.prompts).toHaveLength(12);
    expect(d.newestRun.id).toBe(id("r", 1));
    expect(JSON.stringify(d)).not.toMatch(/long note|app\.example/);
  });
  it("whoami keeps the credits and drops the account's address", () => {
    const d = digestFor(P + "whoami", rows[0].response);
    expect(d).toEqual({ creditsRemaining: 900 });
  });
  it("an error, a non-JSON reply and an empty reply reach the model as an error, never as an empty list", () => {
    expect(digestFor(P + "get_ai_visibility_results", [{ type: "text", text: JSON.stringify({ status: "error", error: { message: "rate limited" } }) }])).toEqual({ error: "rate limited" });
    expect(digestFor(P + "get_ai_visibility_results", [{ type: "text", text: "Internal Server Error" }])).toEqual({ error: expect.stringMatching(/not JSON: Internal Server Error/) });
    expect(digestFor(P + "list_projects", [])).toEqual({ error: expect.stringMatching(/not JSON/) });
  });
  it("answer text is never handed on", () => {
    const d = digestFor(P + "get_ai_visibility_answer", [{ type: "text", text: JSON.stringify({ status: "ok", data: { text: "the whole answer" } }) }]);
    expect(JSON.stringify(d)).not.toContain("the whole answer");
  });
});

describe("the hook: keep the raw reply, hand on the digest", () => {
  const r = stashFor(week(), { limit: 50 }).find((x) => x.tool.endsWith("get_ai_visibility_results"))!;
  const event = { hook_event_name: "PostToolUse", tool_name: r.tool, tool_input: r.input, tool_response: r.response };
  it("appends the raw reply to the stash and replaces what the model sees", () => {
    const lines: string[] = [];
    const { output } = handle(event, { stash: "/x", append: (_p: string, s: string) => { lines.push(s); } });
    expect(JSON.parse(lines[0] ?? "null")).toEqual({ tool: r.tool, input: r.input, response: r.response });
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(JSON.parse(output.hookSpecificOutput.updatedMCPToolOutput[0].text)).toEqual(digestFor(r.tool, r.response));
  });
  it("no stash, or a stash that cannot be written, is a named stop the model sees", () => {
    expect(handle(event, { stash: "" }).output.hookSpecificOutput.updatedMCPToolOutput[0].text).toBe(STASH_FAILED);
    expect(handle(event, { stash: "/x", append: () => { throw new Error("EACCES"); } }).output.hookSpecificOutput.updatedMCPToolOutput[0].text).toMatch(/OPENSEO_STASH_FAILED/);
  });
  it("a tool that is not OpenSEO's is left alone", () => {
    expect(handle({ ...event, tool_name: "Read" }, { stash: "/x", append: () => { throw new Error("must not write"); } }).output).toBeNull();
  });
  it("the real hook process, as Claude Code runs it, writes the stash and prints the replacement", () => {
    const dir = mkdtempSync(join(tmpdir(), "aiv-hook-"));
    const stash = join(dir, "openseo.jsonl");
    const p = spawnSync(process.execPath, [join(__dirname, "../scripts/ops/ai-visibility-hook.mjs")], { input: JSON.stringify(event), env: { ...process.env, AI_VISIBILITY_STASH: stash }, encoding: "utf8" });
    expect(p.status).toBe(0);
    expect(JSON.parse(JSON.parse(p.stdout).hookSpecificOutput.updatedMCPToolOutput[0].text).questions).toHaveLength(12);
    expect(stashRows(readFileSync(stash, "utf8")).rows).toHaveLength(1);
  });
});

describe("the post step reads the week from the stash, the lanes from the session", () => {
  const STATE = { [HOST]: { host: HOST, prefix: null, stop: null, notes: [], engine: [], other: [], strengthened: [] } };
  const log = (body: unknown) => `SITE-BEGIN ${HOST}\n${JSON.stringify(body)}\nSITE-END ${HOST}`;
  const lanes = [{ prompt_id: id("p", 1), lane: "earn", source_domain: "source-7.example", why: "a round-up cites it" }];
  it("the session's own observations are never used, even when they lie", () => {
    const b = week();
    const lie = { site: HOST, observations: [{ id: "x", prompt_id: "x", engine: "chatgpt", status: "answered", mentioned: true, cited: true }], lanes };
    const out: any = entriesFrom(parseRun(log(lie)), STATE, NOW, stashFor(b)).find((e: any) => e.host === HOST);
    expect(out.read).toEqual({ prompts: 12, cited: (readOf(b) as any).cited });
    expect(out.block.observations).toHaveLength(36);
    expect(out.block.lanes).toEqual([expect.objectContaining({ prompt_id: id("p", 1), lane: "earn", source_domain: "source-7.example" })]);
  });
  it("no stash makes the site not read, never the session's numbers", () => {
    const out: any = entriesFrom(parseRun(log({ site: HOST, lanes })), STATE, NOW, null).find((e: any) => e.host === HOST);
    expect(out).toEqual({ host: HOST, stop: "OPENSEO_STASH_UNREAD" });
  });
  it("a stash missing a page makes that site a short read", () => {
    const rows = stashFor(week(), { limit: 5 }).filter((r, i, all) => r !== all.filter((x) => x.tool.endsWith("results"))[2]);
    expect(entriesFrom(parseRun(log({ site: HOST, lanes })), STATE, NOW, rows).find((e: any) => e.host === HOST)).toMatchObject({ stop: "OPENSEO_SHORT_READ" });
  });
  it("the stash file round-trips as the hook writes it", () => {
    const rows = stashFor(week());
    expect(stashRows(stashText(rows)).rows).toEqual(rows);
  });
});

describe("the run's token line (the outcome check reads it)", () => {
  it("is the session's own total from its result event", () => {
    const stream = [JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 9 } } }), JSON.stringify({ type: "result", num_turns: 9, usage: { input_tokens: 18, cache_read_input_tokens: 330985, cache_creation_input_tokens: 83537, output_tokens: 27131 } })].join("\n");
    expect(sessionTokens(stream)).toBe("SESSION-TOKENS input=414540 output=27131 turns=9");
  });
  it("a stream with no result event is unread, never 0", () => {
    expect(sessionTokens("not json\n")).toMatch(/^SESSION-TOKENS unread/);
  });
});

describe("the session's permissions: an allow list and one hook (A2)", () => {
  const real = JSON.parse(readFileSync(join(__dirname, "../scripts/ops/ai-visibility-permissions.json"), "utf8"));
  const sh = readFileSync(join(__dirname, "../scripts/ops/ai-visibility.sh"), "utf8");
  const clone = () => JSON.parse(JSON.stringify(real));
  it("the real file and script pass", () => {
    expect(permissionProblems(real)).toEqual([]);
    expect(scriptProblems(sh)).toEqual([]);
  });
  it("any extra tool is refused", () => {
    for (const extra of ["Bash", "WebFetch", P + "run_ai_visibility_check", "mcp__claude_ai_Gmail__search_threads"]) {
      const s = clone(); s.permissions.allow.push(extra);
      expect(permissionProblems(s).join(" ")).toMatch(/not one of the nine read tools/);
    }
  });
  it("the hook is exactly ours, on OpenSEO's tools only", () => {
    expect(hookProblems(real.hooks)).toEqual([]);
    expect(hookProblems(undefined)).not.toEqual([]);
    const s = clone(); s.hooks.PostToolUse[0].matcher = ".*";
    expect(hookProblems(s.hooks)).not.toEqual([]);
    const t = clone(); t.hooks.SessionStart = t.hooks.PostToolUse;
    expect(hookProblems(t.hooks)).not.toEqual([]);
  });
  it("the script hands the session the hook and the stash, and the post step reads it", () => {
    expect(scriptProblems(sh.replace(' "$WORK/openseo.jsonl")', ")"))).not.toEqual([]);
    expect(scriptProblems(sh.replace('AI_VISIBILITY_STASH="$WORK/openseo.jsonl"', 'AI_VISIBILITY_STASH=""'))).not.toEqual([]);
  });
});


