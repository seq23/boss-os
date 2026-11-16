import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script with no types
import { scansFor, importsOf, relatedTests, SLOW, cleanEnv } from "../scripts/ops/check-changed.mjs";

describe("check:changed runs what the change can break (15 Nov 2026)", () => {
  const scripts = {
    "validate:scans": "npm run validate:fast && npm run validate:agent-poll",
    "validate:fast": "node scripts/validate/fast.mjs",
    "validate:agent-poll": "node scripts/validate/the-agent-polls-without-overlap.mjs",
  };
  const read = () => `const INSTALLER = "scripts/ops/install-agent-launchd.sh"; import x from "../lib/helper.mjs";`;

  it("a slow scan runs only when a path its script names changed; every fast scan always runs", () => {
    expect(SLOW).toContain("validate:agent-poll");
    expect(scansFor(["src/client/App.tsx"], scripts, read)).toEqual({ run: ["validate:fast"], skipped: ["validate:agent-poll"] });
    expect(scansFor(["scripts/ops/install-agent-launchd.sh"], scripts, read).run).toContain("validate:agent-poll");
    expect(scansFor(["scripts/lib/helper.mjs"], scripts, read).run).toContain("validate:agent-poll");
    expect(scansFor(["scripts/validate/the-agent-polls-without-overlap.mjs"], scripts, read).run).toContain("validate:agent-poll");
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

  it("no check inherits git's hook variables, so a scratch repo can never act on this one", () => {
    expect(cleanEnv({ GIT_DIR: "/repo/.git", GIT_INDEX_FILE: "x", PATH: "/bin", GITHUB_TOKEN: "t" })).toEqual({ PATH: "/bin", GITHUB_TOKEN: "t" });
  });
});
