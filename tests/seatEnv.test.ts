/**
 * THE CLI CHILD RUNS ON HER SEAT — the environment it is handed carries no API key.
 *
 * 21 Sep 2026, 13:00 CT: both of her first repo changes died in 3 s because the runner, running
 * under vault:run, spawned `claude` with the parent's environment — ANTHROPIC_API_KEY included —
 * and the CLI took the key over her login ("Credit balance is too low"). `seatEnv` is what every
 * vault-run CLI spawn now passes; this proves what it strips and what it keeps.
 */
import { describe, expect, it } from "vitest";
import { seatEnv, isSeatOverride } from "../scripts/ops/lib/seat-env.mjs";

describe("seatEnv", () => {
  it("strips every ANTHROPIC_* and CLAUDE_* auth override when the parent carries them", () => {
    const parent = {
      PATH: "/usr/bin:/opt/homebrew/bin", HOME: "/Users/sequoiataylor", BOSS_PASSCODE: "p", BOSS_OS_MAIL_KEY: "m",
      ANTHROPIC_API_KEY: "sk-ant-nope", ANTHROPIC_BASE_URL: "https://proxy", ANTHROPIC_AUTH_TOKEN: "t",
      CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_API_KEY: "k", CLAUDE_BIN: "/opt/homebrew/bin/claude", CLAUDE_CONFIG_DIR: "/x",
    };
    const child = seatEnv(parent);
    expect(child).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(child).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(child).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(child).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(child).not.toHaveProperty("CLAUDE_API_KEY");
    expect(Object.keys(child).filter((k) => /^ANTHROPIC_/.test(k))).toEqual([]);
    // The plumbing stays: PATH, HOME, the vault's own values the parent may still need, the CLI path and login dir.
    expect(child.PATH).toBe(parent.PATH);
    expect(child.HOME).toBe(parent.HOME);
    expect(child.BOSS_PASSCODE).toBe("p");
    expect(child.CLAUDE_BIN).toBe(parent.CLAUDE_BIN);
    expect(child.CLAUDE_CONFIG_DIR).toBe("/x");
    // And the parent is untouched — it still makes its own HTTP calls with its own secrets.
    expect(parent.ANTHROPIC_API_KEY).toBe("sk-ant-nope");
  });

  it("names the rule once", () => {
    for (const k of ["ANTHROPIC_API_KEY", "anthropic_base_url", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_SECRET"]) expect(isSeatOverride(k), k).toBe(true);
    for (const k of ["PATH", "CLAUDE_BIN", "CLAUDE_CONFIG_DIR", "BOSS_PASSCODE", "GSC_SERVICE_ACCOUNT_JSON"]) expect(isSeatOverride(k), k).toBe(false);
  });

  it("the real parent of this test process, with a key planted, yields a child without it", () => {
    process.env.ANTHROPIC_API_KEY = "planted";
    try {
      expect(seatEnv(process.env)).not.toHaveProperty("ANTHROPIC_API_KEY");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
