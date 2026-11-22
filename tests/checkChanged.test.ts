import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script with no types
import { scansFor, importsOf, relatedTests, cleanEnv, SLOW } from "../scripts/ops/check-changed.mjs";

describe("check:changed runs what the change can break (15 Nov 2026)", () => {
  const scripts = {
    "validate:scans": "npm run validate:fast && npm run validate:agent-poll",
    "validate:fast": "node scripts/validate/fast.mjs",
    "validate:agent-poll": "node scripts/validate/the-agent-polls-without-overlap.mjs",
  };
  const read = () => `const INSTALLER = "scripts/ops/install-agent-launchd.sh"; import x from "../lib/helper.mjs";`;

  it("every scan runs only when a path its own script names changed; a scan naming nothing, or a SLOW one, is left to CI", () => {
    const named = (f: string) => (f.includes("fast") ? `const ROOTS = ["src/client"];` : read());
    expect(SLOW).toContain("validate:agent-poll");
    expect(scansFor(["src/client/main.tsx"], scripts, named)).toEqual({ run: ["validate:fast"], skipped: ["validate:agent-poll"] });
    expect(scansFor(["src/worker/index.ts"], scripts, named)).toEqual({ run: [], skipped: ["validate:fast", "validate:agent-poll"] });
    expect(scansFor(["scripts/validate/the-agent-polls-without-overlap.mjs"], scripts, named).run).toEqual([]);
    expect(scansFor(["package.json"], scripts, named).run).toEqual(["validate:fast"]);
  });

  it("reads relative and aliased imports, and strips ?raw", () => {
    expect(importsOf(`import { a } from "./check-changed.mjs"; import p from "./practice.mjs?raw";`, "scripts/ops/x.mjs"))
      .toEqual(["scripts/ops/check-changed.mjs", "scripts/ops/practice.mjs"]);
  });

  it("a change to the Worker entry runs the suites that load it (what #423 broke), and a test is its own answer", () => {
    const related: string[] = relatedTests(["src/worker/index.ts"]);
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((f) => /^tests\/.+\.test\.tsx?$/.test(f))).toBe(true);
    expect(relatedTests(["tests/checkChanged.test.ts"])).toEqual(["tests/checkChanged.test.ts"]);
  });

  it("runs the suites that reach a changed file without importing it: by path, through a fixture, or importing a deleted file (what #537 pushed red twice)", () => {
    // workerEntryExports reads src/worker/index.ts with readFileSync; mimeMemory spawns fixtures/mimeMemoryChild.mjs,
    // which imports mimeAttachments.ts. Neither imports the changed module, and both went red on CI only.
    expect(relatedTests(["src/worker/index.ts"])).toContain("tests/workerEntryExports.test.ts");
    expect(relatedTests(["src/worker/effects/mimeAttachments.ts"])).toContain("tests/mimeMemory.test.ts");
    // A deleted module: every suite (or fixture's suite) still importing it runs, though the file is gone.
    const gone: string[] = relatedTests([], 2, ["src/worker/effects/mimeAttachments.ts"]);
    expect(gone).toContain("tests/mimeMemory.test.ts");
    expect(gone.length).toBeGreaterThan(1);
    // An extensionless import ("../src/worker/effects/browserClient") names no full path, so only the import read finds it.
    // (allocation.test.ts no longer imports runAi since #537, which turned this red on main.)
    expect(relatedTests([], 2, ["src/worker/effects/browserClient.ts"])).toContain("tests/browserClient.test.ts");
    // Negative: nothing changed, nothing deleted → nothing picked by these rules.
    expect(relatedTests([], 2, [])).toEqual([]);
  });

  it("no check inherits git's hook variables, so a scratch repo can never act on this one", () => {
    expect(cleanEnv({ GIT_DIR: "/repo/.git", GIT_INDEX_FILE: "x", PATH: "/bin", GITHUB_TOKEN: "t" })).toEqual({ PATH: "/bin", GITHUB_TOKEN: "t" });
  });
});
