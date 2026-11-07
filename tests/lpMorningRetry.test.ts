import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installerJobs } from "../scripts/ops/lib/schedule.mjs";
import { SENDING_PATTERNS } from "../scripts/ops/lib/email-map.mjs";
import manifest from "../src/shared/boss/schedule/manifest.json";

const installer = readFileSync(new URL("../scripts/ops/install-agent-launchd.sh", import.meta.url), "utf8");
const row = manifest.rows.find((r) => r.id === "lp-daily")!;
const label = "com.seq.boss-lp";
const files = ["lp-daily.mjs", "lp-positive.mjs", "lp-followups.mjs", "lp-bounces.mjs"];
const sources = files.map((f) => readFileSync(new URL(`../scripts/ops/${f}`, import.meta.url), "utf8"));

function problems(sh: string, code: string[]) {
  const errors: string[] = [];
  const slots = installerJobs(sh)[label] ?? [];
  if (!slots.length) errors.push("NAMED STOP [NO_LP_EVENTS]");
  if (slots.length < 2 || !slots.includes("daily 06:15")) errors.push("LP_RETRY_MISSING");
  const calls = sh.match(/duty-run\.sh lp-daily\.mjs[^<\n]*/g) ?? [];
  if (calls.length !== 1 || !/lp-daily\.mjs --only-if-due -- /.test(calls[0] ?? "")) errors.push("LP_DUE_GUARD_MISSING");
  if (JSON.stringify(slots) !== JSON.stringify(row.trigger.ticks?.[label])) errors.push("LP_TICKS_DIFFER");
  if (JSON.stringify(row.slots) !== JSON.stringify(["daily 06:15"])) errors.push("LP_PRIMARY_MOVED");
  if (!code.length || code.some((s) => !s.trim())) errors.push("NAMED STOP [NO_LP_SOURCES]");
  code.forEach((s, i) => { if (SENDING_PATTERNS.some((re) => re.test(s))) errors.push(`LP_SENDS: ${files[i]}`); });
  return errors;
}

describe("LP morning retry", () => {
  it("retries through one due-gated invocation, records its ticks, and never sends", () => {
    expect(problems(installer, sources)).toEqual([]);
    expect(installerJobs(installer)[label]).toEqual(["daily 06:15", "daily 06:30", "daily 08:45"]);
    expect(problems(installer.replace("lp-daily.mjs --only-if-due", "lp-daily.mjs"), sources)).toContain("LP_DUE_GUARD_MISSING");
    const extra = installer.replace('<key>Label</key><string>$LP_LABEL</string>', '<key>Label</key><string>$LP_LABEL</string><key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>');
    expect(problems(extra, sources)).toContain("LP_TICKS_DIFFER");
    expect(problems(installer, ['fetch("https://api.resend.com/emails")', ...sources.slice(1)])).toContain("LP_SENDS: lp-daily.mjs");
    expect(problems("", sources)).toContain("NAMED STOP [NO_LP_EVENTS]");
    expect(problems(installer, [])).toContain("NAMED STOP [NO_LP_SOURCES]");
  });
});
