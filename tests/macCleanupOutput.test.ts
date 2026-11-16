import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs ops script, no types
import { censusOutput } from "../scripts/ops/mac-cleanup.mjs";

// duty-run.sh reads the LAST line matching this as the run's census (16 Nov 2026: 8 days of NO_OUTPUT_LINE).
const DUTY_RUN = /^OUTPUT [0-9]{1,9} .{1,80}$/;

describe("every mac-cleanup run ends on one census line duty-run.sh can read", () => {
  it("a healthy day with nothing removed is still a census, not a stop", () => {
    expect(censusOutput({ removed: 0, cleanedGb: 0.04, freeGb: 31.2 })).toBe("OUTPUT 0 items removed (cleaned 0.0 GB, 31.2 GB free)");
    expect(censusOutput({ removed: 0, cleanedGb: 0.04, freeGb: 31.2 })).toMatch(DUTY_RUN);
  });
  it("main() in DRY mode prints it as its last OUTPUT line", () => {
    const home = mkdtempSync(join(tmpdir(), "mac-cleanup-"));
    mkdirSync(join(home, "GitHub"));
    try {
      const r = spawnSync(process.execPath, ["scripts/ops/mac-cleanup.mjs", "--dry-run"], { encoding: "utf8", env: { ...process.env, HOME: home, BOSS_PASSCODE: "" }, timeout: 60_000 });
      const outputs = String(r.stdout).split("\n").filter((l) => l.startsWith("OUTPUT"));
      expect(r.status, r.stderr).toBe(0);
      expect(outputs.at(-1)).toMatch(DUTY_RUN);
      expect(outputs.at(-1)).toMatch(/^OUTPUT 0 items removed/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
