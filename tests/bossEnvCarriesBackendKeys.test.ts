/**
 * EVERY KEY A BOSS OS BACKEND NAMES CROSSES THE MOUNT (26 Oct 2026). The Anthropic and OpenAI keys
 * were Worker secrets that toBossEnv never passed, so both "enabled" backends had no key.
 */
import { describe, expect, it } from "vitest";
import { toBossEnv } from "../src/worker/bossMount";
import { CLOUD_BACKENDS } from "../src/worker/boss/router/backends";

describe("toBossEnv carries every env credential the backend wiring names", () => {
  it("each `env` credential set on the chassis reaches Boss OS under the same name", () => {
    const names = CLOUD_BACKENDS.filter((b) => b.credential.kind === "env").map((b) => b.credential.name);
    expect(names).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]));
    const chassis: any = { WP_OS_DB: {}, WP_OS_DOCUMENTS: {}, WP_OS_KV: {} };
    for (const n of names) chassis[n] = `value-of-${n}`;
    const boss: any = toBossEnv(chassis);
    for (const n of names) expect(boss[n], `${n} does not cross the mount`).toBe(`value-of-${n}`);
  });
});
