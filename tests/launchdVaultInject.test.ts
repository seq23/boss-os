import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// A launchd job whose script reads a vault key must run under `vault:run`, or the key is never
// injected and the job stops every week (6 Nov 2026: lp-prospect-discovery printed
// NAMED STOP [NO_8RAISE_KEY] while the key sat in the vault).
const installer = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");

describe("launchd jobs that need vault keys get them", () => {
  it("runs prospect discovery (8Raise) under vault:run", () => {
    const line = installer.split("\n").find((l) => l.includes("install_l_job com.seq.boss-prospect-discovery"));
    expect(line, "the prospect-discovery install line").toBeTruthy();
    expect(line).toMatch(/vault:run -- npm run --silent lp:discover/);
  });
});
