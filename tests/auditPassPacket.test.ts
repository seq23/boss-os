/**
 * THE AUDIT PASS'S ENVELOPE IS CODE (27 Nov 2026, the ahrefs-code-tools job). A Search Readiness /
 * Ahrefs repair pass cost 7.07M input tokens over 57.8 turns (165 Claude passes, 30 days); a slice of
 * those turns needed no judgement. Code now reads the queue, the repo map and the repo's open work
 * before the model starts (the pass packet) and crawls each claimed row's site after it ends.
 *
 * What must hold, and is proven here:
 *   · NOTHING DROPPED: every brief id the pass was handed reaches the model, verbatim, or is named as
 *     no longer in the queue.
 *   · AN OUTAGE IS NEVER "NONE": open work GitHub would not give is UNREAD (the model checks by hand),
 *     never an empty list; a crawl that fails, times out or reads no sitemap leaves the row uncrawled,
 *     and the verdict stays RED (NOT_CRAWLED); a queue that cannot be read stops the pass.
 *   · FINISHED WORK IS NOT WORK IN FLIGHT: a branch whose PR merged or closed, or with no commits of
 *     its own, is not listed.
 *   · THE REAL RUNNER does all of this: packet in the worker's prompt, crawl on the row after it.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
// @ts-expect-error — plain .mjs with no types; the functions under test are the ones the runner calls.
import { passPacket, packetText, readOpenWork, openWorkFrom, finishPass, crawlRecord, defaultCrawl, runVerdict, sessionTokensLine } from "../scripts/ops/site-audit-lib.mjs";

const QUEUE = {
  written_at: "2026-11-25T06:38:59.469Z",
  approved_sites: ["hicksconsulting.org"],
  briefs: [
    { id: "sr-a.example-b1", repo: "site-a", domain: "a.example", item_id: "b1", failure: "https://a.example/x/ title is 81 chars", evidence: ["https://a.example/x/ title is 81 chars"], missing_urls: [], protected: null },
    { id: "sr-a.example-j9", repo: "site-a", domain: "a.example", item_id: "j9", missing_urls: ["https://a.example/memphis/", "https://a.example/nashville/"], protected: null },
    { id: "so-a.example-quality", repo: "site-a", domain: "a.example", kind: "quality", item_id: "q1", brief: "Fix the generator, never the sampled pages by hand." },
    { id: "sr-b.example-b1", repo: "site-b", domain: "b.example", item_id: "b1" },
  ],
};
const OPEN = openWorkFrom([], []);

describe("the pass packet: every brief handed reaches the model", () => {
  it("named ids: each one is a brief, verbatim, or named as gone; another repo's brief never leaks in", () => {
    const pk = passPacket({ queue: QUEUE, queueFile: "/q.json", repo: "site-a", briefIds: ["sr-a.example-b1", "so-a.example-quality", "sr-a.example-gone"], openWork: OPEN, repoFor: (d: string) => `REPO for ${d}` });
    expect(pk.briefs).toEqual([QUEUE.briefs[0], QUEUE.briefs[2]]);
    expect(pk.missing_ids).toEqual(["sr-a.example-gone"]);
    const text = packetText(pk);
    for (const b of pk.briefs) expect(text).toContain(JSON.stringify(b));
    expect(text).toContain("sr-a.example-gone");
    expect(text).not.toContain("sr-b.example-b1");
    expect(text).toContain("- a.example: REPO for a.example");
    expect(text).toContain("APPROVED SITES this cycle: hicksconsulting.org");
  });

  it("no ids: every brief of the repo, and the count line says how many", () => {
    const pk = passPacket({ queue: QUEUE, queueFile: "/q.json", repo: "site-a", openWork: OPEN });
    expect(pk.briefs.map((b: { id: string }) => b.id)).toEqual(["sr-a.example-b1", "sr-a.example-j9", "so-a.example-quality"]);
    expect(pk.missing_ids).toEqual([]);
    const text = packetText(pk);
    expect(text).toMatch(/^BRIEFS \(3, exactly as the queue holds them\):$/m);
    // The hyperlocal list is the work: every missing URL reaches the model.
    expect(text).toContain("https://a.example/nashville/");
  });

  it("the real repo map is the one list (repo-for)", () => {
    const pk = passPacket({ queue: { briefs: [{ id: "x", repo: "keepmyproof", domain: "keepmyproof.com" }] }, queueFile: "/q.json", repo: "keepmyproof", openWork: OPEN });
    expect(pk.repo_for["keepmyproof.com"]).toMatch(/^REPO keepmyproof /);
  });
});

describe("open work: what is in flight, read by code, judged by the model", () => {
  const prs = [
    { number: 88, url: "https://github.com/seq23/x/pull/88", title: "Promise fixes", headRefName: "promise-fix", isDraft: false, files: Array.from({ length: 45 }, (_, i) => ({ path: `f${i}.ts` })) },
    { number: 90, url: "https://github.com/seq23/x/pull/90", title: "Salvaged: b1 titles", headRefName: "danielle/site-audit-20261124-225752", isDraft: true, files: [{ path: "site/build.mjs" }] },
  ];
  const fake = (over: Record<string, string | Error> = {}) => (args: string[]) => {
    const key = args[0] === "pr" ? `pr ${args[args.indexOf("--state") + 1]}` : args[1]?.startsWith("repos/x/y/compare/") ? `compare ${args[1].split("...")[1]}` : args[1] === "repos/x/y" ? "default" : "branches";
    const v = over[key] ?? ({
      "pr open": JSON.stringify(prs),
      "pr all": JSON.stringify([{ headRefName: "old-merged", state: "MERGED" }, { headRefName: "old-closed", state: "CLOSED" }, { headRefName: "promise-fix", state: "OPEN" }]),
      branches: JSON.stringify(["main", "promise-fix", "danielle/site-audit-20261124-225752", "old-merged", "old-closed", "facts/divorce", "never-diverged", "compare-fails"]),
      default: "main\n",
      "compare facts/divorce": JSON.stringify({ ahead_by: 13 }),
      "compare never-diverged": JSON.stringify({ ahead_by: 0 }),
      "compare compare-fails": new Error("HTTP 502"),
    } as Record<string, string | Error>)[key];
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`unexpected gh ${args.join(" ")}`);
    return v;
  };

  it("open PRs with what they change; pushed branches with their own commits; finished ones dropped", () => {
    const ow = readOpenWork("x/y", { run: fake() });
    expect(ow.unread).toBeUndefined();
    expect(ow.prs.map((p: { number: number }) => p.number)).toEqual([88, 90]);
    expect(ow.prs[0].files.length).toBe(40);
    expect(ow.prs[0].more_files).toBe(5);
    expect(ow.prs[1].own).toBe(true);
    // merged/closed PR heads, a branch with nothing ahead and open PR heads are not "branches in flight";
    // a branch whose compare could not be read is kept (possible work), never dropped as none.
    expect(ow.branches).toEqual([{ name: "facts/divorce", ahead: 13 }, { name: "compare-fails", ahead: "unknown" }]);
    const text = packetText({ repo: "y", queue_file: "/q", queue_written_at: null, briefs: [], missing_ids: [], approved_sites: [], repo_for: {}, open_work: ow });
    expect(text).toContain("PR #90 [draft] [OWN LANE]");
    expect(text).toContain("(+5 more: gh pr view 88)");
    expect(text).toContain("- branch facts/divorce (13 commit(s) ahead)");
    expect(text).not.toContain("old-merged");
  });

  for (const key of ["pr open", "pr all", "branches", "default"]) {
    it(`GitHub not answering (${key}) is UNREAD with the hand check named, never an empty list`, () => {
      const ow = readOpenWork("x/y", { run: fake({ [key]: new Error("could not resolve host api.github.com") }) });
      expect(ow.prs).toBeUndefined();
      expect(ow.unread).toMatch(/could not read x\/y's open PRs/);
      const text = packetText({ repo: "y", queue_file: "/q", queue_written_at: null, briefs: [], missing_ids: [], approved_sites: [], repo_for: {}, open_work: ow });
      expect(text).toMatch(/^OPEN WORK: UNREAD — /m);
      // the hand check names THIS checkout's helper, in the allow list's `~/…` form
      expect(text).toContain(`run \`node ${join(process.cwd(), "scripts/ops/site-audit-lib.mjs").replace(homedir(), "~")} inflight y <term...>\``);
    });
  }

  it("an answer that is not a list is UNREAD too", () => {
    expect(readOpenWork("x/y", { run: fake({ "pr open": "{}" }) }).unread).toBeTruthy();
    expect(readOpenWork("x/y", { run: fake({ default: "" }) }).unread).toBeTruthy();
  });
});

describe("the runner's crawl: a row that claims a defect gets one, or stays RED", () => {
  const ok = { pages_crawled: 117, sitemap_total: 117, counts: { broken_internal_image: 13 } };

  it("one crawl per domain, recorded on every claimed row; rows that carry a crawl or claim nothing are left alone", () => {
    const calls: string[] = [];
    const payload = { findings: [
      { project: "checklist:a.example", domain: "a.example", disposition: "fixed_pr", headline: "b1" },
      { project: "checklist:a.example", disposition: "surfaced", headline: "j9" }, // no domain field: the project names it
      { project: "checklist:b.example", domain: "b.example", disposition: "fixed_pr", headline: "b1", crawl: { pages_crawled: 5, sitemap_total: 5, counts: {} } },
      { project: "checklist:c.example", domain: "c.example", disposition: "in_flight", headline: "x" },
      { project: "checklist:c.example", domain: "c.example", disposition: "none", headline: "y" },
    ] };
    const lines = finishPass(payload, { crawl: (d: string) => { calls.push(d); return crawlRecord(d, ok); } });
    expect(calls).toEqual(["a.example"]);
    expect(payload.findings[0]).toMatchObject({ crawl: { pages_crawled: 117, sitemap_total: 117, counts: { broken_internal_image: 13 }, by: "runner" } });
    expect(payload.findings[1]).toMatchObject({ crawl: { pages_crawled: 117 } });
    expect(payload.findings[2]?.crawl).toEqual({ pages_crawled: 5, sitemap_total: 5, counts: {} });
    expect(payload.findings[3]).not.toHaveProperty("crawl");
    expect(payload.findings[4]).not.toHaveProperty("crawl");
    expect(lines).toEqual(["FINISH crawled a.example: pages=117/117"]);
  });

  const failures: [string, (d: string) => unknown, RegExp][] = [
    ["the crawler reports an error", (d) => ({ error: `the crawl of ${d} exited 1: boom` }), /exited 1/],
    ["the crawler throws", () => { throw new Error("spawn python3 ENOENT"); }, /threw: spawn python3 ENOENT/],
    ["the crawler returns nothing", () => undefined, /returned nothing/],
    ["the crawl read no sitemap (site or network down)", (d) => crawlRecord(d, { pages_crawled: 1, sitemap_total: 0, counts: {} }), /read no sitemap pages/],
    ["the crawl read no pages", (d) => crawlRecord(d, { pages_crawled: 0, sitemap_total: 10, counts: {} }), /read no sitemap pages/],
  ];
  for (const [name, crawl, why] of failures) {
    it(`${name}: no crawl is recorded, the reason is, and the verdict is RED (NOT_CRAWLED)`, () => {
      const payload = { findings: [{ project: "checklist:a.example", domain: "a.example", repo: "site-a", disposition: "fixed_pr", headline: "b1", pr_url: "https://github.com/seq23/site-a/pull/1", land: "landed" }] };
      const lines = finishPass(payload, { crawl });
      expect(payload.findings[0]).not.toHaveProperty("crawl");
      expect((payload.findings[0] as { crawl_error?: string }).crawl_error).toMatch(why);
      expect(lines[0]).toMatch(/^FINISH NOT_CRAWLED a\.example: /);
      const v = runVerdict(payload);
      expect(v.red).toBe(true);
      expect(v.reasons.join("\n")).toMatch(/^NOT_CRAWLED: /m);
    });
  }

  it("a row with no domain at all is named, never crawled as something else", () => {
    const payload = { findings: [{ project: "Mystery", disposition: "surfaced", headline: "x" }] };
    const lines = finishPass(payload, { crawl: () => { throw new Error("must not be called"); } });
    expect(lines[0]).toMatch(/FINISH NOT_CRAWLED Mystery: the row names no domain/);
    expect(runVerdict(payload).reasons.join("\n")).toMatch(/NOT_CRAWLED/);
  });

  it("the real crawl command: exit code, timeout and an unreadable result are each an error; a real result is a crawl", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-crawl-"));
    const crawler = join(dir, "crawl.py");
    const mode = join(dir, "mode");
    writeFileSync(crawler, `import sys, json, time\nm = open(${JSON.stringify(mode)}).read().strip()\nout = sys.argv[sys.argv.index("--out") + 1]\nif m == "fail": sys.exit(3)\nif m == "slow": time.sleep(5)\nif m == "garbage": open(out, "w").write("not json"); sys.exit(0)\nif m == "nowrite": sys.exit(0)\nopen(out, "w").write(json.dumps({"pages_crawled": 9, "sitemap_total": 9, "counts": {"missing_title": 2}}))\n`);
    const run = (m: string, timeoutS = 30) => { writeFileSync(mode, m); return defaultCrawl("a.example", { outDir: dir, crawler, timeoutS }); };
    expect(run("ok")).toEqual({ crawl: { pages_crawled: 9, sitemap_total: 9, counts: { missing_title: 2 }, by: "runner" } });
    expect(run("fail").error).toMatch(/exited 3/);
    expect(run("slow", 1).error).toMatch(/timed out/);
    expect(run("garbage").error).toMatch(/no readable result/);
    // A result left by an earlier crawl is never read as this one's.
    writeFileSync(mode, "ok"); defaultCrawl("a.example", { outDir: dir, crawler });
    expect(run("nowrite").error).toMatch(/no readable result/);
  }, 30000);
});

/** Two model calls; the first written as two lines (one per content block) sharing its message id. */
const TRANSCRIPT = [
  { type: "user", message: { content: "Do the thing." } },
  { type: "assistant", message: { id: "m1", usage: { input_tokens: 3, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000, output_tokens: 50 }, content: [{ type: "text", text: "a" }] } },
  { type: "assistant", message: { id: "m1", usage: { input_tokens: 3, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000, output_tokens: 50 }, content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
  { type: "assistant", message: { id: "m2", usage: { input_tokens: 2, cache_read_input_tokens: 10100, output_tokens: 20 }, content: [{ type: "text", text: "done" }] } },
  { type: "assistant", isSidechain: true, message: { id: "s1", usage: { input_tokens: 999999 }, content: [] } },
].map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("what a Claude pass cost is logged from its transcript", () => {
  it("each model call once, sub-agents aside; nothing to count is unread, never 0", () => {
    expect(sessionTokensLine(TRANSCRIPT)).toBe("SESSION-TOKENS input=20105 output=70 turns=2");
    expect(sessionTokensLine("")).toMatch(/^SESSION-TOKENS unread /);
    expect(sessionTokensLine("not json\n{}")).toMatch(/^SESSION-TOKENS unread /);
  });
});

/** The REAL runner, scoped, with a recording ai-run and a stub crawler. */
function scopedPass(o: { queue?: boolean; crawl: "ok" | "fail" }) {
  const home = mkdtempSync(join(tmpdir(), "audit-packet-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  if (o.queue !== false) {
    mkdirSync(join(home, ".boss-os/search-readiness"), { recursive: true });
    writeFileSync(join(home, ".boss-os/search-readiness/fix-queue.json"), JSON.stringify(QUEUE));
  }
  const crawler = join(home, "crawl.py");
  writeFileSync(crawler, o.crawl === "ok"
    ? `import sys, json\nout = sys.argv[sys.argv.index("--out") + 1]\nopen(out, "w").write(json.dumps({"pages_crawled": 40, "sitemap_total": 40, "counts": {"missing_title": 3}}))\n`
    : `import sys\nsys.exit(2)\n`);
  const sa = join(home, "sa");
  w("ai-run", `role=""; while [ $# -gt 0 ]; do case "$1" in --role) role="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
[ "$role" = worker ] || exit 0
printf '%s' "$1" > "$HOME/worker-prompt.txt"
sid="$(printf '%s' "$AI_RUN_CLAUDE_ARGS" | sed -n 's/.*--session-id \\([^ ]*\\).*/\\1/p')"
mkdir -p "$HOME/.claude/projects/-home" && cp "$HOME/transcript.jsonl" "$HOME/.claude/projects/-home/$sid.jsonl"
mkdir -p "$BOSS_OS_SITE_AUDIT_DIR"
echo '{"findings":[{"project":"checklist:a.example","domain":"a.example","repo":"site-a","disposition":"fixed_pr","headline":"b1: titles","pr_url":"https://github.com/seq23/site-a/pull/7","suggested_action":"The PR lands; re-measure next week."}]}' > "$BOSS_OS_SITE_AUDIT_DIR/findings.json"
echo "AHREFS-AUDIT-COMPLETE: projects=1 fixed=1"; exit 0`);
  w("gh", "exit 0");
  w("curl", "printf 200");
  w("npm", "exit 0");
  writeFileSync(join(home, "prompt.md"), "Do the thing.\n");
  writeFileSync(join(home, "transcript.jsonl"), TRANSCRIPT);
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: repoRoot, AHREFS_AUDIT_PROMPT: join(home, "prompt.md"), SR_SCOPE_REPO: "site-a", SR_SCOPE_BRIEFS: "sr-a.example-b1,sr-a.example-j9", BOSS_OS_SITE_AUDIT_DIR: sa, SITE_CRAWL_BIN: crawler },
    encoding: "utf8",
    timeout: 60000,
  });
  const prompt = existsSync(join(home, "worker-prompt.txt")) ? readFileSync(join(home, "worker-prompt.txt"), "utf8") : null;
  const file = join(sa, "sr-site-a", "findings.json"); // a scoped pass owns its own findings file
  const findings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  return { rc: r.status, out: `${r.stdout}${r.stderr}`, prompt, findings };
}

describe("the real runner (ahrefs-audit-fix.sh, scoped)", () => {
  it("hands the worker the packet (its briefs verbatim, the other ids absent) and crawls the claimed row after it", () => {
    const p = scopedPass({ crawl: "ok" });
    expect(p.prompt, p.out).not.toBeNull();
    expect(p.prompt).toContain("## YOUR PASS PACKET");
    expect(p.prompt).toContain(JSON.stringify(QUEUE.briefs[0]));
    expect(p.prompt).toContain(JSON.stringify(QUEUE.briefs[1]));
    expect(p.prompt).not.toContain("so-a.example-quality");
    expect(p.prompt).toMatch(/^OPEN WORK: UNREAD — /m); // gh answers nothing here: said, never "no open work"
    expect(p.out).toMatch(/scoped pass: Search Readiness queue, repo site-a \(2 briefs in the packet\)/);
    expect(p.out).toContain("FINISH crawled a.example: pages=40/40");
    expect(p.out).toMatch(/\] SESSION-TOKENS input=20105 output=70 turns=2$/m);
    expect(p.findings.findings[0].crawl).toEqual({ pages_crawled: 40, sitemap_total: 40, counts: { missing_title: 3 }, by: "runner" });
    expect(p.out).not.toMatch(/NOT_CRAWLED/);
  }, 90000);

  it("a crawl that fails leaves the row uncrawled and the pass RED with NOT_CRAWLED", () => {
    const p = scopedPass({ crawl: "fail" });
    expect(p.out).toMatch(/FINISH NOT_CRAWLED a\.example: the crawl of a\.example exited 2/);
    expect(p.findings.findings[0]).not.toHaveProperty("crawl");
    expect(p.out).toMatch(/NAMED STOP \[NOT_CRAWLED\]/);
    expect(p.rc).toBe(12);
  }, 90000);

  it("a queue that cannot be read stops the pass before the worker: NAMED STOP [NO_PASS_PACKET], exit 11", () => {
    const p = scopedPass({ queue: false, crawl: "ok" });
    expect(p.prompt).toBeNull();
    expect(p.out).toMatch(/NAMED STOP \[NO_PASS_PACKET\]/);
    expect(p.rc).toBe(11);
  }, 90000);
});
