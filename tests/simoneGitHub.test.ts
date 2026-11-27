import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { simoneGitHub } from "../scripts/ops/simone/github.mjs";
import { chiefSignoff } from "../scripts/ops/simone/chief-signoff.mjs";

it("uses real Git to draft then update a chief PR, requires verified repository settings, and stamps both commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "simone-github-fixture-"));
  const git = (params: string[], cwd = root, input = "") => execFileSync("git", params, {
    cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  const remote = join(root, "remote");
  try {
    git(["init", "--bare", remote]);
    git(["init", "-b", "main"]);
    writeFileSync(join(root, "hello.txt"), "before\n");
    git(["add", "hello.txt"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Seed"]);
    git(["push", remote, "main"]);
    const main = git(["rev-parse", "HEAD"]);
    let pr: any = null;
    let verified = false;
    let stopped = false;
    let publishCount = 0;
    let createCount = 0;
    const run = async (cmd: string, params: string[], input?: string, cwd?: string) => {
      if (cmd === "git") {
        if (params.includes("push")) publishCount++;
        return git(params.map((arg) => arg === "https://github.com/seq23/boss-os.git" ? remote : arg), cwd, input);
      }
      if (params[0] === "api" && params[1]?.includes("/pulls?")) {
        if (!pr) return JSON.stringify([]);
        const branch = pr.head.ref;
        return JSON.stringify([{ ...pr, head: { ref: branch, sha: git(["--git-dir", remote, "rev-parse", branch]) } }]);
      }
      if (params[0] === "pr" && params[1] === "create") {
        expect(params).toContain("--draft");
        const branch = params.find((arg) => arg.startsWith("--head="))!.slice("--head=".length);
        pr = { draft: true, number: 7, head: { ref: branch }, base: { ref: "main" } };
        createCount++;
        return "";
      }
      throw new Error("Unexpected external command");
    };
    const invoke = (args: Record<string, unknown>) => simoneGitHub({ id: "fixture-run" },
      JSON.stringify({ repo: "boss-os", title: "Clarify the fixture", ...args }), (value: string) => value.includes("fixture-private-token"),
      { run, verified: () => { if (!verified) throw new Error("Repository settings missing"); }, recheck: () => !stopped });
    const patch = (old: string, updated: string) => `diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-${old}\n+${updated}\n`;
    const draft = { action: "draft", base: main, patch: patch("before", "first") };
    await expect(invoke(draft)).resolves.toEqual({ ok: false, code: "REPO_SETTINGS" });
    verified = true;
    await expect(invoke({ ...draft, action: "merge" })).resolves.toEqual({ ok: false, code: "GITHUB_OPERATION_RESTRICTED" });
    await expect(invoke({ ...draft, action: "land" })).resolves.toEqual({ ok: false, code: "GITHUB_OPERATION_RESTRICTED" });
    await expect(invoke({ ...draft, patch: patch("before", "fixture-private-token") }))
      .resolves.toEqual({ ok: false, code: "GITHUB_PATCH_REQUIRED" });
    await expect(invoke({ ...draft, patch: "diff --git a/.github/workflows/proof.yml b/.github/workflows/proof.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/proof.yml\n@@ -0,0 +1 @@\n+unreviewed\n" }))
      .resolves.toEqual({ ok: false, code: "PROTECTED_PATH" });
    stopped = true;
    await expect(invoke(draft)).resolves.toEqual({ ok: false, code: "STALE_SIMONE_RUN" });
    expect(publishCount).toBe(0);
    stopped = false;

    const first = await invoke(draft);
    expect(first).toMatchObject({ ok: true, receipt: "https://github.com/seq23/boss-os/pull/7" });
    const second = await invoke({ ...draft, base: first.head, patch: patch("first", "second") });
    expect(second).toMatchObject({ ok: true, receipt: first.receipt });
    expect(createCount).toBe(1);
    const branch = pr.head.ref;
    expect(branch).toMatch(/^simone\//);
    expect(git(["--git-dir", remote, "show", branch + ":hello.txt"])).toBe("second");
    const messages = git(["--git-dir", remote, "log", "--format=%B%x00", `${main}..${branch}`]).split("\0").filter((value) => value.trim());
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.includes("Co-Authored-By: Simone <simone@sequoiataylor.com>"))).toBe(true);
    expect(chiefSignoff({ head: second.head!, branch, messages, paths: ["hello.txt"] })).toBeNull();
    await expect(invoke(draft)).resolves.toMatchObject({ ok: false, code: "GITHUB_HEAD_CHANGED" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
