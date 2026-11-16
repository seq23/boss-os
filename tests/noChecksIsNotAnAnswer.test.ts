import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error — plain ESM with no declaration file
import { noChecksVerdict, prTriggeredWorkflows, NO_CHECKS_GRACE_MS } from "../scripts/ops/repo-change.mjs";

/**
 * "NO CHECKS REPORTED" IS A WAIT, NEVER AN ANSWER (16 Nov 2026).
 * PR #417 opened at 2026-11-15T13:34:58Z; its eight checks started at 13:35:03Z. The lane read the
 * checks inside those five seconds, got "no checks reported", and failed the repair (NO_CHECKS).
 */
const opened = Date.parse("2026-11-15T13:34:58Z");
const read = Date.parse("2026-11-15T13:35:03Z");
const passed = { validators_passed: true, validators: ["npm run validate"] };

describe("noChecksVerdict", () => {
  it("the real #417 timings: read 5 seconds after the PR opened is pending, never none", () => {
    const v = noChecksVerdict({ prWorkflows: true, since: opened, now: read, proof: passed });
    expect(v.state).toBe("pending");
  });

  it("negative proof: with no grace the same read is the old settled none", () => {
    expect(noChecksVerdict({ prWorkflows: true, since: opened, now: read, graceMs: 0, proof: passed }).state).toBe("none");
  });

  it("inside the grace a repo with no PR workflow is still pending, never an early green", () => {
    expect(noChecksVerdict({ prWorkflows: false, since: opened, now: read, proof: passed }).state).toBe("pending");
  });

  it("past the grace with PR workflows present is none, and the detail names the likely cause", () => {
    const v = noChecksVerdict({ prWorkflows: true, since: opened, now: opened + NO_CHECKS_GRACE_MS + 1, proof: passed });
    expect(v.state).toBe("none");
    expect(v.detail).toMatch(/cannot parse/);
  });

  it("past the grace, no PR-triggered workflow and validators passed is green", () => {
    expect(noChecksVerdict({ prWorkflows: false, since: opened, now: opened + NO_CHECKS_GRACE_MS + 1, proof: passed }).state).toBe("green");
  });

  it("a repo WITH PR workflows is never green on local validators alone", () => {
    expect(noChecksVerdict({ prWorkflows: true, since: opened, now: opened + 2 * NO_CHECKS_GRACE_MS, proof: passed }).state).not.toBe("green");
    expect(noChecksVerdict({ prWorkflows: null, since: opened, now: opened + 2 * NO_CHECKS_GRACE_MS, proof: passed }).state).not.toBe("green");
  });

  it("no PR workflow but no passing validators recorded is none", () => {
    expect(noChecksVerdict({ prWorkflows: false, since: opened, now: opened + 2 * NO_CHECKS_GRACE_MS, proof: null }).state).toBe("none");
  });
});

describe("prTriggeredWorkflows", () => {
  const wf = (text: string) => [{ name: "x.yml", text }];
  it("block form", () => expect(prTriggeredWorkflows(wf("on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\njobs:\n  a: {}\n"))).toBe(true));
  it("inline-array form", () => expect(prTriggeredWorkflows(wf("on: [push, pull_request]\njobs: {}\n"))).toBe(true));
  it("pull_request_target", () => expect(prTriggeredWorkflows(wf("on:\n  pull_request_target:\njobs: {}\n"))).toBe(true));
  it("a push-only workflow is false", () => expect(prTriggeredWorkflows(wf("on:\n  push:\n    branches: [main]\njobs: {}\n"))).toBe(false));
  it("an if: mention outside on: is false", () =>
    expect(prTriggeredWorkflows(wf("on:\n  push:\njobs:\n  a:\n    if: github.event_name == 'pull_request'\n"))).toBe(false));
  it("a commented-out trigger is false", () => expect(prTriggeredWorkflows(wf("on:\n  push:\n  # pull_request:\njobs: {}\n"))).toBe(false));
  it("no files is null", () => expect(prTriggeredWorkflows([])).toBeNull());
  it("boss-os's own ci.yml runs on pull requests", () => {
    const text = readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
    expect(prTriggeredWorkflows([{ name: "ci.yml", text }])).toBe(true);
  });
});
