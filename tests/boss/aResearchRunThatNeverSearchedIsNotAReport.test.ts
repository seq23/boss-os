import { describe, expect, it } from "vitest";
import { executeRun, REQUIRED_FORBIDDEN } from "../../scripts/sync-agent/runner.mjs";
// @ts-expect-error — codex.mjs ships no declaration file, like the tests that import it elsewhere.
import { buildArgs as codexArgs, codexExecutor } from "../../scripts/sync-agent/backends/codex.mjs";
import { parseCodexSearch, researchWasSeen } from "../../scripts/lib/codex-search.mjs";
// Vite's ?raw import: the Workers test runtime has no fs.
import FIXTURE from "../fixtures/codex-search-probe.jsonl?raw";
import type { Envelope } from "../../scripts/sync-agent/runner.d.mts";

/**
 * A RESEARCH RUN THAT NEVER SEARCHED IS NOT A REPORT (1 Oct 2026).
 *
 * The Codex seat was sent to read the web for the executive briefing and graded on a file the model wrote and the last
 * line of stdout. Nothing in either says whether one search ran, so a briefing written from memory — figures and
 * citations the model never opened — was filed exactly like one written from twenty pages. West Peek OS had the same
 * hole and closed it by counting `web_search` events in the CLI's own `--json` stream; this is that rule in this repo.
 *
 * The stream below is VERBATIM from the owner's Mac (West Peek OS probe, 1 Oct 2026). Nothing here starts a CLI.
 *
 * WHAT THIS DOES NOT PROVE: a complete briefing on a live Codex seat, and that this adapter's argv behaves on the
 * Mac as the probe's did (the probe ran West Peek's args; these add `--sandbox workspace-write` and a network setting).
 */
const withoutSearches = (FIXTURE as string).split("\n").filter((l) => !l.includes('"type":"web_search"')).join("\n");

function fakeSpawn({ stdout = "", stderr = "", code = 0 }: { stdout?: string; stderr?: string; code?: number }) {
  return (_bin?: string, _args?: string[], _opts?: unknown) => {
    const stream = (text: string) => ({
      on(event: string, cb: (chunk: string) => void) { if (event === "data" && text) queueMicrotask(() => cb(text)); return this; },
    });
    return {
      stdout: stream(stdout),
      stderr: stream(stderr),
      stdin: { end(_v: string) { return true; } },
      kill() { return true; },
      on(event: string, cb: (...a: any[]) => void) {
        if (event === "close") setTimeout(() => cb(code), 1);
        return this;
      },
    };
  };
}

const envelope = (over: Partial<Envelope> = {}): Envelope => ({
  run_id: "run_search",
  task_id: "task_search",
  backend_id: "bk_codex",
  envelope_id: "env_search",
  approved: true,
  approval_receipt: "rcpt_search",
  kind: "research",
  repo_path: "/Users/owner/.boss-os/reports",
  allowed_paths: ["/Users/owner/.boss-os/reports"],
  instruction: "Write this morning's report.",
  instruction_origin: "owner",
  verification: [],
  forbidden_actions: [...REQUIRED_FORBIDDEN],
  allowed_kinds: ["research"],
  capabilities: ["agentic_coding"],
  credential_ref: "local:codex-session",
  max_seconds: 60,
  web_tools: ["WebSearch", "WebFetch"],
  ...over,
} as Envelope);

const REPORT = { status: "complete", sections: [{ title: "Rates", body: "The ten-year yield is 4.3% [1]." }], sources: [{ url: "https://example.com/rates" }] };
const run = (stdout: string, over: { stderr?: string; code?: number; delivers?: unknown } = {}) =>
  codexExecutor(
    { envelope: envelope(), prompt: "p", cwd: "/work" },
    { spawnImpl: fakeSpawn({ stdout, stderr: over.stderr, code: over.code }), readDelivers: async () => (over.delivers === undefined ? JSON.stringify(REPORT) : over.delivers === null ? null : JSON.stringify(over.delivers)) },
  ) as Promise<any>;

describe("the CLI's own record of what the seat searched", () => {
  it("counts every search and page-open in the real stream, and reads the last message as the answer", () => {
    const p = parseCodexSearch(FIXTURE);
    expect(p.events).toBeGreaterThan(0);
    expect(p.terminal).toBe("completed");
    expect(p.answer.length).toBeGreaterThan(0);
    expect(p.queries.length).toBeGreaterThan(0);
    expect(researchWasSeen(p)).toEqual({ ok: true, searches: p.events });
  });

  it("is not fooled by an answer with no searches, a failed turn, or output that is not a JSON stream", () => {
    const none = researchWasSeen(parseCodexSearch(withoutSearches));
    expect(none.ok).toBe(false);
    expect((none as any).reason).toMatch(/without running a single web search/);
    expect(researchWasSeen(parseCodexSearch('{"type":"turn.failed","error":{"message":"network down"}}')).ok).toBe(false);
    // A CLI that ignored --json is not judged: refusing every briefing on a format change is the worse fault.
    expect(researchWasSeen(parseCodexSearch("The reserve ratio is 0.35."))).toEqual({ ok: true, searches: null });
  });
});

describe("the Codex adapter on a research run", () => {
  it("a run whose stream shows searches delivers its report and records how many searches ran", async () => {
    const out = await run(FIXTURE);
    expect(out.search_refused).toBe(false);
    expect(out.delivery).toEqual({ present: true, status: "complete" });
    expect(out.delivers).toEqual(REPORT);
    expect(out.web_searches).toBe(parseCodexSearch(FIXTURE).events);
    expect(out.error).toBeNull();
  });

  it("a run that wrote a report WITHOUT searching has the report set aside and fails with a sentence", async () => {
    const out = await run(withoutSearches);
    expect(out.search_refused).toBe(true);
    expect(out.delivers).toBeNull();
    expect(out.delivery.present).toBe(false);
    expect(out.error).toMatch(/without running a single web search/);
    expect(out.remaining_risks.join(" ")).toMatch(/did not search, so it was set aside/);
  });

  it("a run killed on its time limit after writing a report with NO search on the record is refused too (review of #57)", async () => {
    // A spawn whose `close` never fires: the adapter's own leash (max_seconds) kills it and reports a timeout.
    const hung = (_b?: string, _a?: string[], _o?: unknown) => {
      const stream = (text: string) => ({ on(ev: string, cb: (c: string) => void) { if (ev === "data" && text) queueMicrotask(() => cb(text)); return this; } });
      return { stdout: stream(withoutSearches), stderr: stream(""), stdin: { end(_v: string) { return true; } }, kill() { return true; }, on(_e: string, _cb: (...a: any[]) => void) { return this; } };
    };
    const out = await codexExecutor(
      { envelope: envelope({ max_seconds: 1 } as any), prompt: "p", cwd: "/work" },
      { spawnImpl: hung, readDelivers: async () => JSON.stringify(REPORT) },
    ) as any;
    expect(out.exit_code).toBe(124);
    expect(out.search_refused).toBe(true);
    expect(out.delivers).toBeNull();
    expect(out.error).toMatch(/without running a single web search/);
  });

  it("a run killed on its time limit that DID search keeps its report", async () => {
    const hung = (_b?: string, _a?: string[], _o?: unknown) => {
      const stream = (text: string) => ({ on(ev: string, cb: (c: string) => void) { if (ev === "data" && text) queueMicrotask(() => cb(text)); return this; } });
      return { stdout: stream(FIXTURE as string), stderr: stream(""), stdin: { end(_v: string) { return true; } }, kill() { return true; }, on(_e: string, _cb: (...a: any[]) => void) { return this; } };
    };
    const out = await codexExecutor(
      { envelope: envelope({ max_seconds: 1 } as any), prompt: "p", cwd: "/work" },
      { spawnImpl: hung, readDelivers: async () => JSON.stringify(REPORT) },
    ) as any;
    expect(out.exit_code).toBe(124);
    expect(out.search_refused).toBe(false);
    expect(out.delivers).toEqual(REPORT);
  });

  it("a spent plan reported as a failed turn is still read as a spent plan", async () => {
    const out = await run('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again in 3 hours."}}', { delivers: null, code: 1 });
    expect(out.seat_exhausted?.retry_after_seconds).toBe(3 * 3600);
    expect(out.search_refused).toBe(true);
    expect(out.error).toContain("Codex has run out of usage");
  });

  it("output that was not a JSON stream is not refused, and the packet says nothing was counted", async () => {
    const out = await run("Done. Report written.");
    expect(out.search_refused).toBe(false);
    expect(out.web_searches).toBeNull();
    expect(out.remaining_risks.join(" ")).toMatch(/could not be counted/);
  });

  it("a run with no web tools is untouched: same argv, no JSON, no search rule", async () => {
    const args = codexArgs({ kind: "repo_work" } as any, "p") as string[];
    expect(args).not.toContain("--json");
    expect(args.join(" ")).not.toContain("web_search");
    const plain = await codexExecutor(
      { envelope: envelope({ web_tools: undefined, kind: "repo_work" } as any), prompt: "p", cwd: "/work" },
      { spawnImpl: fakeSpawn({ stdout: "Done." }), readDelivers: async () => null },
    ) as any;
    expect(plain.search_refused).toBe(false);
    expect(plain.web_searches).toBeNull();
  });
});

describe("the runner", () => {
  const gitClean = async () => ({ head: "a", branch: "work", upstream: "b", dirty: false, changed_files: [] as string[] });
  it("files a run that never searched as FAILED even though the process exited 0", async () => {
    const result = await run(withoutSearches);
    const out = await executeRun(envelope(), {
      clearStaleDelivers: async () => false,
      readMaterialJson: async () => null,
      execute: async () => result,
      gitProbe: gitClean,
    });
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/without running a single web search/);
    expect(out.delivers).toBeNull();
  });

  it("files one that searched as SUCCEEDED and carries the count beside the report", async () => {
    const result = await run(FIXTURE);
    const out = await executeRun(envelope(), {
      clearStaleDelivers: async () => false,
      readMaterialJson: async () => null,
      execute: async () => result,
      gitProbe: gitClean,
    });
    expect(out.status).toBe("succeeded");
    expect(out.web_searches).toBe(parseCodexSearch(FIXTURE).events);
    expect(out.delivers).toEqual(REPORT);
  });
});
