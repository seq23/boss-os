/**
 * THE CAPITAL CHAIN RESUMES BY ITSELF (3 Nov 2026) — same defect class, same fix, as
 * com.seq.boss-sr-resume (tests/searchReadinessNetworkResume.test.ts). A kernel panic rebooted the
 * Mac mid-chain on 3 Nov 2026 and the day's monique_found morning section — step 4 of 5 — never ran,
 * silently, because nothing marked the chain "in flight" and nothing retried it. See
 * src/shared/boss/capital/chainMark.mjs for the pure decision and scripts/ops/capital-chain.mjs for
 * the filesystem/launchctl half.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_RESUMES, UNFINISHED_PATH, resumeDecision } from "../src/shared/boss/capital/chainMark.mjs";

const INSTALLER = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");

describe("resumeDecision — pure, over the mark and a live pid check", () => {
  const record = (over: Partial<{ day: string; pid: number; attempts: number }> = {}) =>
    ({ chain: "capital", day: "2026-11-03", pid: 123, started_at: "2026-11-03T05:30:00.000Z", attempts: 0, ...over });

  it("no record at all: none", () => {
    expect(resumeDecision({ record: null, today: "2026-11-03", pidAlive: false })).toMatchObject({ action: "none" });
  });

  it("the recorded pid is alive: wait, never a second start", () => {
    expect(resumeDecision({ record: record(), today: "2026-11-03", pidAlive: true })).toMatchObject({ action: "wait" });
  });

  it("today, pid dead, a resume still owed (attempts 0 or 1): resume", () => {
    expect(resumeDecision({ record: record({ attempts: 0 }), today: "2026-11-03", pidAlive: false })).toMatchObject({ action: "resume" });
    expect(resumeDecision({ record: record({ attempts: 1 }), today: "2026-11-03", pidAlive: false })).toMatchObject({ action: "resume" });
  });

  it("both resumes spent (attempts === MAX_RESUMES): stale, a NAMED STOP, never a third kickstart", () => {
    expect(MAX_RESUMES).toBe(2);
    expect(resumeDecision({ record: record({ attempts: 2 }), today: "2026-11-03", pidAlive: false })).toMatchObject({ action: "stale" });
  });

  it("the unfinished run is from a day that is no longer today: stale, never retried", () => {
    expect(resumeDecision({ record: record({ day: "2026-11-02" }), today: "2026-11-03", pidAlive: false })).toMatchObject({ action: "stale" });
  });
});

describe("the installer wires the chain mark and the recorded producer", () => {
  it("RULE 0: the capital plist stanza is not empty", () => {
    expect(INSTALLER).toContain('CAPITAL_LABEL="com.seq.boss-capital"');
    const block = INSTALLER.slice(INSTALLER.indexOf('CAPITAL_LABEL="com.seq.boss-capital"'), INSTALLER.indexOf("\nCAPEOF"));
    expect(block.length).toBeGreaterThan(100);
  });

  it("the capital chain marks itself unfinished from --start to --done, and interest-grid.mjs finally runs through duty-run.sh", () => {
    const block = INSTALLER.slice(INSTALLER.indexOf('CAPITAL_LABEL="com.seq.boss-capital"'), INSTALLER.indexOf("\nCAPEOF"));
    expect(block).toContain("capital:chain -- --start");
    expect(block).toContain("capital:chain -- --done");
    expect(block).toContain("duty-run.sh interest-grid.mjs -- npm run --silent capital:grid");
    // the pid handed to --start is the live chain's own $$, escaped in the heredoc so it is read at
    // the chain's own runtime (install time would instead capture the installer script's own pid)
    expect(block).toContain("capital:chain -- --start \\$\\$");
  });

  it("the resume job is a KeepAlive PathState on UNFINISHED_PATH, throttled to 15 minutes, naming no duty", () => {
    expect(UNFINISHED_PATH).toBe(".boss-os/capital/chain-unfinished.json");
    const block = INSTALLER.slice(INSTALLER.indexOf('CAPR_LABEL="com.seq.boss-capital-resume"'), INSTALLER.indexOf("\nCAPREOF"));
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain("capital:chain -- --resume-if-unfinished");
    expect(block).toContain(`<key>PathState</key><dict><key>$HOME/${UNFINISHED_PATH}</key><true/></dict>`);
    expect(block).toMatch(/<key>ThrottleInterval<\/key><integer>900<\/integer>/);
    expect(block).not.toMatch(/duty-run\.sh/);
  });

  it("interest-grid.mjs is in the one list INSTALLED_LOCAL_JOBS reads against", async () => {
    const { INSTALLED_LOCAL_JOBS } = await import("../src/shared/boss/duties/lane.mjs");
    expect(INSTALLED_LOCAL_JOBS).toContain("interest-grid.mjs");
  });
});
