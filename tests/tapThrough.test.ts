/**
 * THE APP TAP-THROUGH (owner, 22 Nov 2026: "a factory standard that we live by"). The browser half is
 * proven on GitHub by `tap-through.mjs --self-test` (a good fixture app passes; a broken one fails with
 * DEAD_BUTTON and PROMISE_UNBUILT; an empty flow, a flow that taps nothing and a preview that is down
 * are named stops). This file proves the pure rules that decide the run and the review.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowProblems, outcome, promiseFailures, MAX_STEPS } from "../scripts/ops/tap-through.mjs";
import { parseArgs, readTapThrough } from "../scripts/ops/ship-review.mjs";
import { DEFAULT_SURFACE, KINDS, reviewPrompt, withTapFailures } from "../src/shared/boss/shipReview/review.mjs";

const fixture = (n: string) => JSON.parse(readFileSync(`scripts/ops/fixtures/tap-through/${n}`, "utf8"));
const flow = { app: "X", journeys: [{ name: "paywall", steps: [{ tap: "See plans", id: "plans" }, { tap: "Export", id: "export" }] }], promises: [{ text: "Export to PDF", on: "paywall:plans", built: "paywall:export" }] };

describe("a flow file that cannot prove anything never runs", () => {
  it("the fixtures the self-test drives are valid, and an empty one is refused", () => {
    expect(flowProblems(fixture("good.flow.json"))).toEqual([]);
    expect(flowProblems(fixture("broken.flow.json"))).toEqual([]);
    expect(flowProblems(fixture("empty.flow.json")).join(" ")).toMatch(/taps nothing/);
  });
  it("a promise must name its price screen, and a native-only promise a declared feature", () => {
    expect(flowProblems({ ...flow, promises: [{ text: "Scan receipts", on: "paywall:nope" }] }).join(" ")).toMatch(/`on` must name/);
    expect(flowProblems({ ...flow, promises: [{ text: "Scan receipts", on: "paywall:plans", native_only: "camera" }] }).join(" ")).toMatch(/not in the flow's native_only/);
    expect(flowProblems({ ...flow, native_only: [{ feature: "camera", why: "no camera in a browser" }], promises: [{ text: "Scan receipts", on: "paywall:plans", native_only: "camera" }] })).toEqual([]);
  });
  it("a fill needs a test value, and a flow too long for one review is refused", () => {
    expect(flowProblems({ app: "X", journeys: [{ name: "a", steps: [{ fill: "Email" }] }] }).join(" ")).toMatch(/test "value"/);
    const long = { app: "X", journeys: [{ name: "a", steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ tap: "Next" })) }] };
    expect(flowProblems(long).join(" ")).toMatch(/split the flow/);
  });
});

describe("a price-screen promise with no screen behind it fails (app-review check 13)", () => {
  const screen = (text: string) => new Map([["paywall:plans", { ok: true, text }], ["paywall:export", { ok: true, text: "Export" }]]);
  it("a mapped promise whose screen was reached passes", () => {
    expect(promiseFailures(flow, screen("Plans Export to PDF"))).toEqual([]);
  });
  it("an unmapped promise, an unreached screen and a stale map each fail by name", () => {
    expect(promiseFailures({ ...flow, promises: [{ text: "Voice notes", on: "paywall:plans" }] }, screen("Voice notes"))[0]).toMatchObject({ code: "PROMISE_UNBUILT" });
    const unreached = new Map([["paywall:plans", { ok: true, text: "Export to PDF" }], ["paywall:export", { ok: false, text: "" }]]);
    expect(promiseFailures(flow, unreached)[0]!.what).toMatch(/was not reached/);
    expect(promiseFailures(flow, screen("Plans"))[0]!.what).toMatch(/does not show it/);
  });
});

describe("rule 0: the run never passes having done nothing", () => {
  it("zero taps is a named stop even with no failures; a stop beats everything", () => {
    expect(outcome({ taps: 0, failures: [] })).toMatchObject({ exit: 9, line: expect.stringContaining("[FLOW_TAPS_NOTHING]") });
    expect(outcome({ taps: 5, failures: [], stopped: { code: "PREVIEW_DOWN", why: "x" } }).exit).toBe(9);
    expect(outcome({ taps: 5, failures: [{ code: "DEAD_BUTTON", where: "a", what: "b" }] }).exit).toBe(1);
    expect(outcome({ taps: 5, failures: [] }).exit).toBe(0);
  });
});

describe("ship-review --kind tap-through", () => {
  const base = ["--kind", "tap-through", "--target", "https://x.pages.dev/", "--builder", "b", "--brand", "keepmyproof"];
  it("runs on GitHub only, with a flow repo and a brand", () => {
    expect(() => parseArgs([...base, "--flow", "seq23/keepmyproof"])).toThrow(/GitHub only/);
    expect(() => parseArgs([...base, "--on-github"])).toThrow(/--flow owner\/repo/);
    expect(() => parseArgs(["--kind", "tap-through", "--target", "u", "--builder", "b", "--on-github", "--flow", "seq23/k"])).toThrow(/--brand/);
    expect(parseArgs([...base, "--on-github", "--flow", "seq23/keepmyproof@feat/x"]).flow).toBe("seq23/keepmyproof@feat/x");
    expect(KINDS).toContain("tap-through");
    expect(DEFAULT_SURFACE["tap-through"]).toBe("app-screen");
  });
  it("a run that stopped, tapped nothing or left no report is CAPTURE_INCOMPLETE, never judged", () => {
    const dir = mkdtempSync(join(tmpdir(), "tap-"));
    expect(() => readTapThrough(dir)).toThrow(/CAPTURE_INCOMPLETE.*no tap-report/);
    writeFileSync(join(dir, "tap-report.json"), JSON.stringify({ stopped: { code: "PREVIEW_DOWN", why: "502" }, taps: 0 }));
    expect(() => readTapThrough(dir)).toThrow(/CAPTURE_INCOMPLETE.*PREVIEW_DOWN/);
    writeFileSync(join(dir, "tap-report.json"), JSON.stringify({ stopped: null, taps: 0 }));
    expect(() => readTapThrough(dir)).toThrow(/CAPTURE_INCOMPLETE.*FLOW_TAPS_NOTHING/);
  });
  it("a run whose videos cannot be read is incomplete; readable ones become sheets the reviewer must open", () => {
    const dir = mkdtempSync(join(tmpdir(), "tap-"));
    writeFileSync(join(dir, "s1.png"), "x"); writeFileSync(join(dir, "v.webm"), "x");
    writeFileSync(join(dir, "capture.json"), JSON.stringify({ shots: [{ label: "s1.png", file: "s1.png" }], facts: ["f"] }));
    writeFileSync(join(dir, "tap-report.json"), JSON.stringify({ stopped: null, taps: 3, failures: [], videos: [{ journey: "first-open", scheme: "light", file: "v.webm" }] }));
    expect(() => readTapThrough(dir, { sheet: () => 0 })).toThrow(/CAPTURE_INCOMPLETE/);
    const c = readTapThrough(dir, { runId: 42, sheet: (_f, s) => { writeFileSync(s, "x"); return 10; } });
    expect(c.shots.map((s) => s.label)).toEqual(["s1.png", "video-sheet-light-first-open.png"]);
    expect(c.facts.join(" ")).toMatch(/run 42/);
  });
  it("a failure the robot measured fails the review even when the reviewer passed it", () => {
    const pass = { verdict: "PASS" as const, findings: [] as Array<{ where: string; what: string; feels: string }>, already: [], unseen: [] };
    const v = withTapFailures(pass, [{ code: "DEAD_BUTTON", where: "first-open step 2", what: "tapping \"Help\" changed nothing", shot: "02-first-open-help.png" }]);
    expect(v.verdict).toBe("FAIL");
    expect(v.findings[0]!.what).toMatch(/^DEAD_BUTTON/);
    expect(withTapFailures(pass, [])).toBe(pass);
    const unseen = { verdict: "UNSEEN" as const, findings: [], already: [], unseen: ["x"] };
    expect(withTapFailures(unseen, [{ code: "DEAD_BUTTON", where: "a", what: "b" }]).verdict).toBe("UNSEEN");
  });
  it("the reviewer is told native-only features are out of scope and unmapped promises fail", () => {
    const p = reviewPrompt({ kind: "tap-through", target: "u", builder: "b", checklist: "c", shots: [{ label: "a.png" }] });
    expect(p).toMatch(/NOT RUN ON THE WEB PREVIEW/);
    expect(p).toMatch(/check 13/);
    expect(p).toMatch(/SURFACE: app-screen/);
  });
});
