/**
 * THE SHARED FREE READER FOR OTHER REPOS (27 Nov 2026). seq-bin's post-land check and How We Know's comment
 * classifier call scripts/ops/free-read.mjs. Every status but "ok" exits 3 with a NAMED STOP and prints no
 * answer, so a caller can only read it as "unknown", never a verdict, a pass or "nothing found".
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freeRead, freeReadArgs } from "../scripts/ops/free-read.mjs";

const job = { worker: "danielle", instruction: "Answer with a verdict line.", source: "the output", maxOutputTokens: 64 };

describe("freeRead", () => {
  it("ok prints the answer and exits 0", async () => {
    const r = await freeRead(job, { read: async () => ({ status: "ok", provider: "workers-ai", text: "Outcome check (live): PASS — 3 rows" }) as any });
    expect(r).toMatchObject({ code: 0, out: "Outcome check (live): PASS — 3 rows" });
  });

  for (const [status, stop] of [["unavailable", "FREE_READER_UNAVAILABLE"], ["allowance-exhausted", "FREE_ALLOWANCE_EXHAUSTED"], ["uncertain", "FREE_READER_UNCERTAIN"], ["refused", "FREE_READER_REFUSED"]]) {
    it(`${status} exits 3 with NAMED STOP [${stop}] and no answer`, async () => {
      const r = await freeRead(job, { read: async () => ({ status, provider: "gemini" }) as any });
      expect(r.code).toBe(3);
      expect(r.out).toBe("");
      expect(r.err).toContain(`NAMED STOP [${stop}]`);
    });
  }

  it("--require is passed as an accept check, so an answer without the literal is not usable", async () => {
    let accept: ((t: string) => boolean) | undefined;
    await freeRead({ ...job, require: "Outcome check (live):" }, { read: async (input: any) => { accept = input.accept; return { status: "uncertain" } as any; } });
    expect(accept?.("PASS")).toBe(false);
    expect(accept?.("Outcome check (live): PASS — x")).toBe(true);
  });

  it("an empty source is refused before any read", async () => {
    let reads = 0;
    const r = await freeRead({ ...job, source: "  " }, { read: async () => { reads += 1; return { status: "ok" } as any; } });
    expect(r.code).toBe(2);
    expect(reads).toBe(0);
  });

  it("bad flags are named", () => {
    expect(freeReadArgs(["--instruction-file", "x"]).error).toMatch(/--worker/);
    expect(freeReadArgs(["--worker", "danielle"]).error).toMatch(/--instruction-file/);
    expect(freeReadArgs(["--worker", "danielle", "--instruction-file", "x", "--max-output", "0"]).error).toMatch(/max-output/);
  });

  it("the real CLI with no free credentials ends unsure: exit 3, nothing on stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "free-read-"));
    writeFileSync(join(dir, "i.txt"), "Say PASS.");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GEMINI_API_KEY|CF2_ACCOUNT_ID|CF2_WORKERS_AI_TOKEN)$/.test(k))) as Record<string, string>;
    const r = spawnSync(process.execPath, ["scripts/ops/free-read.mjs", "--worker", "danielle", "--instruction-file", join(dir, "i.txt")], { input: "source", env, encoding: "utf8" });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("NAMED STOP [FREE_READER_UNAVAILABLE]");
  });
});
