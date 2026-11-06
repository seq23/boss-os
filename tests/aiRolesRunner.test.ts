import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error — plain ESM with no declaration file
import { runPhaseModel } from "../scripts/ops/repo-change.mjs";
import { afterCodexLimit } from "../src/shared/boss/aiRoles.mjs";

/**
 * OWNER, 3 Nov 2026: "after today we need to default OpenAI and Claude just be the brains".
 * The repo-change runner reads each phase's role from src/shared/boss/aiRoles.mjs and launches it
 * through ~/bin/ai-run (here a stub that records its argv). A build is Codex's (worker); plan and land
 * are Claude's (brain); a Codex limit (exit 75) comes back as a retried note and Claude is never called.
 */
let dir = "";
const calls = () => (existsSync(path.join(dir, "calls")) ? readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean) : []);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ai-roles-"));
  const stub = path.join(dir, "ai-run");
  writeFileSync(stub, `#!/bin/bash
{ printf "%s" "$*" | tr "\\n" " " | cut -c1-2000; echo; } >> "${dir}/calls"
if [ "$STUB_MODE" = "limit" ]; then echo "NAMED STOP [CODEX_LIMIT] resets 3:00 PM" >&2; exit 75; fi
out=""; while [ $# -gt 0 ]; do [ "$1" = "--out" ] && out="$2"; [ "$1" = "--" ] && break; shift; done
[ -n "$out" ] && echo 'done. {"branch":"feat/x","proof":{"validators_passed":true}}' > "$out"
exit 0
`);
  chmodSync(stub, 0o755);
  process.env.AI_RUN_BIN = stub;
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.AI_RUN_BIN; delete process.env.STUB_MODE; });

function brainSpy() {
  const seen: string[] = [];
  return { seen, brain: async (o: { phase: string }) => { seen.push(o.phase); return { code: 0, rc: 0, timedOut: false, out: "", err: "", servedBy: "claude" }; } };
}

describe("Boss OS employees: Codex works, Claude is the brain", () => {
  it("a build phase runs on ai-run --role worker, never on Claude, and its last-message result is saved", async () => {
    rmSync(path.join(dir, "calls"), { force: true });
    const spy = brainSpy();
    const outFile = path.join(dir, "build.json");
    const r = await runPhaseModel({ phase: "build", prompt: "make the change", cwd: dir, outFile, timeoutMin: 1 }, { brain: spy.brain });
    expect(spy.seen).toEqual([]);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatch(/^--role worker --cwd .* --network --out .*build\.json\.last-message\.txt -- make the change/);
    expect(r.servedBy).toBe("codex");
    expect(r.codexLimit).toBeNull();
    expect(JSON.parse(readFileSync(outFile, "utf8")).branch).toBe("feat/x");
  });

  it("plan and land (planning, final review before land) run on the brain, and ai-run's worker is not called", async () => {
    rmSync(path.join(dir, "calls"), { force: true });
    const spy = brainSpy();
    for (const phase of ["plan", "land"]) await runPhaseModel({ phase, prompt: "p", cwd: dir, timeoutMin: 1 }, { brain: spy.brain });
    expect(spy.seen).toEqual(["plan", "land"]);
    expect(calls()).toEqual([]);
  });

  it("a Codex limit is a retried note with its reset time: one worker call, no Claude call, no result invented", async () => {
    rmSync(path.join(dir, "calls"), { force: true });
    process.env.STUB_MODE = "limit";
    const spy = brainSpy();
    const outFile = path.join(dir, "build-limited.json");
    const r = await runPhaseModel({ phase: "build", prompt: "make the change", cwd: dir, outFile, timeoutMin: 1 }, { brain: spy.brain });
    delete process.env.STUB_MODE;
    expect(r.code).toBe(75);
    expect(r.codexLimit).toEqual({ resets: "3:00 PM" });
    expect(spy.seen).toEqual([]);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatch(/^--role worker /);
    expect(existsSync(outFile)).toBe(false);
  });

  it("after a Codex limit, public work goes to the $0 free rung; confidential, LP/deal, Chrome and non-public work go to the Claude seat", () => {
    expect(afterCodexLimit({ sensitivity: "public" })).toBe("free_rung");
    expect(afterCodexLimit({ sensitivity: "public", confidential: true })).toBe("claude_seat");
    expect(afterCodexLimit({ sensitivity: "public", chromeJob: true })).toBe("claude_seat");
    for (const sensitivity of ["private", "restricted", "confidential", null, undefined]) expect(afterCodexLimit({ sensitivity })).toBe("claude_seat");
    // Cleared for public models on its card (6 Nov 2026) counts as public; LP/deal and Chrome still wait.
    expect(afterCodexLimit({ sensitivity: "internal", modelAccess: "public_model_approved" })).toBe("free_rung");
    expect(afterCodexLimit({ sensitivity: "internal", modelAccess: "public_model_approved", confidential: true })).toBe("claude_seat");
    expect(afterCodexLimit({ sensitivity: "internal", modelAccess: "private_model_only" })).toBe("claude_seat");
  });
});
