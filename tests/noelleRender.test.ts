/**
 * ITEM 10 (brief noelle-v2, 24 Nov 2026): THE RENDER NEVER WAITS ON THE MAC.
 * Before: renderOnGitHub ran `gh run watch` for up to 6000 s inside her slot. Now `act` starts the render and
 * parks the run (exit 20); each later tick runs `collect`, which looks at the render ONCE.
 * HOW IT BREAKS, each proven here:
 *   - wait: a render still running costs one look and exit 21; nothing is queued, the run stays parked;
 *   - outage: GitHub not answering is "not read yet" (wait), never a failure or a pass, until the cap;
 *   - hang: a render past RENDER_MAX_MS is NAMED STOP [RENDER_TIMEOUT], a red run (Rule 0), never left parked;
 *   - failure: a failed render is NAMED STOP [RENDER_FAILED] on the run, the pending record cleared;
 *   - replay: while a run renders, the day's slot never starts again (mark "rendering");
 *   - the shell: a parked run that is still rendering stays parked and is never "done"; a collected run
 *     goes through done and its mark, once; act's exit 20 parks the run and marks the day rendering.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain ESM with no declaration file
import { EXIT_RENDERING, EXIT_STILL_RENDERING, RENDER_MAX_MS, renderStatus, tickDecision } from "../scripts/ops/noelle.mjs";
import { slotFor } from "../src/shared/boss/growth/noelle.mjs";

const ROOT = resolve(__dirname, "..");
const T0 = Date.parse("2026-11-28T20:00:00Z");

describe("one look at a render", () => {
  it("running → wait; finished well → ready; failed or cancelled → RENDER_FAILED; unreadable → wait until the cap", () => {
    expect(renderStatus({ status: "in_progress", conclusion: "" }, T0, T0 + 60_000)).toBe("wait");
    expect(renderStatus({ status: "queued", conclusion: "" }, T0, T0 + 60_000)).toBe("wait");
    expect(renderStatus({ status: "completed", conclusion: "success" }, T0, T0 + 60_000)).toBe("ready");
    expect(renderStatus({ status: "completed", conclusion: "success" }, T0, T0 + 20 * 3_600_000)).toBe("ready");
    expect(renderStatus({ status: "completed", conclusion: "failure" }, T0, T0 + 60_000)).toEqual({ stop: expect.stringMatching(/^NAMED STOP \[RENDER_FAILED\].*failure/) });
    expect(renderStatus({ status: "completed", conclusion: "cancelled" }, T0, T0 + 60_000)).toEqual({ stop: expect.stringMatching(/RENDER_FAILED/) });
    expect(renderStatus(null, T0, T0 + 60_000)).toBe("wait");
    expect(renderStatus(null, T0, T0 + RENDER_MAX_MS + 60_000)).toEqual({ stop: expect.stringMatching(/RENDER_TIMEOUT.*not readable/) });
    expect(renderStatus({ status: "in_progress" }, T0, T0 + RENDER_MAX_MS + 60_000)).toEqual({ stop: expect.stringMatching(/RENDER_TIMEOUT.*still in_progress 151 minutes/) });
  });

  it("while a run renders, the day's slot never starts again", () => {
    const day = "2026-11-28";
    const s = slotFor(day);
    const slot = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
    const env = { NOELLE_START_AT: "2026-11-01T00:00:00-05:00" };
    expect(tickDecision({ env, day, now: slot, nowMs: T0, mark: null })).toMatchObject({ run: true });
    expect(tickDecision({ env, day, now: slot, nowMs: T0, mark: { state: "rendering", at: T0, tries: 1 } })).toMatchObject({ run: false, why: expect.stringMatching(/rendering on GitHub/) });
  });
});

/** `noelle.mjs collect` for real, with a fake `gh` that answers `run view` from GH_VIEW and logs every call. */
function collect(view: string | null, startedAgoMs: number) {
  const dir = mkdtempSync(join(tmpdir(), "noelle-collect-"));
  const bin = join(dir, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/bash\necho "$*" >> "${dir}/gh.log"\nif [ "$1 $2" = "run view" ]; then [ -n "$GH_VIEW" ] || exit 1; echo "$GH_VIEW"; fi\nif [ "$1 $2" = "run download" ]; then echo "no artifact engine-out"; exit 1; fi\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const state = {
    day: "2026-11-28", cs: join(dir, "no-cs"), calendar: { queues: {}, unread: {}, days: {} }, calls: 1,
    renders: [{ name: "noelle-x", runId: 77, stop: null }], failed: [], published: [], queued: [], jobs: [],
    pending: { stage: "first", name: "noelle-x", runId: 77, planFile: join(dir, "noelle-x.json"), plan: { pieces: [{ id: "pnp-1" }] }, at: Date.now() - startedAgoMs, remakeOf: [] },
  };
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  const r = spawnSync("node", [join(ROOT, "scripts/ops/noelle.mjs"), "collect", dir], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_VIEW: view ?? "" } });
  return { rc: r.status, out: `${r.stdout}${r.stderr}`, state: JSON.parse(readFileSync(join(dir, "state.json"), "utf8")), gh: existsSync(join(dir, "gh.log")) ? readFileSync(join(dir, "gh.log"), "utf8") : "" };
}

describe("collect: one look, never a wait", () => {
  it("a render still running: exit 21, one `gh run view`, never `gh run watch`, the run stays parked", () => {
    const r = collect('{"status":"in_progress","conclusion":""}', 10 * 60_000);
    expect(r.rc).toBe(EXIT_STILL_RENDERING);
    expect(r.out).toMatch(/WAIT render 77 is still running/);
    expect(r.gh.trim().split("\n")).toEqual(["run view 77 -R seq23/creator-studios --json status,conclusion"]);
    expect(r.state.pending?.runId).toBe(77);
    expect(r.state.queued).toEqual([]);
  });

  it("GitHub not answering: still parked (not read is never a failure)", () => {
    const r = collect(null, 10 * 60_000);
    expect(r.rc).toBe(EXIT_STILL_RENDERING);
    expect(r.state.pending?.runId).toBe(77);
  });

  it("a failed render: RENDER_FAILED on the run, the pending record cleared, a red exit (nothing acted)", () => {
    const r = collect('{"status":"completed","conclusion":"failure"}', 10 * 60_000);
    expect(r.rc).toBe(14);
    expect(r.state.pending).toBeUndefined();
    expect(r.state.failed.map((f: any) => f.why).join("\n")).toMatch(/RENDER_FAILED.*run 77/);
    expect(r.state.renders[0].stop).toMatch(/RENDER_FAILED/);
    expect(r.gh).not.toMatch(/download|watch/);
  });

  it("a render past the cap: RENDER_TIMEOUT, cleared, red", () => {
    const r = collect('{"status":"in_progress","conclusion":""}', RENDER_MAX_MS + 5 * 60_000);
    expect(r.rc).toBe(14);
    expect(r.state.pending).toBeUndefined();
    expect(r.state.failed.map((f: any) => f.why).join("\n")).toMatch(/RENDER_TIMEOUT/);
  });

  it("a finished render whose download fails: RENDER_DOWNLOAD on the run, never queued from nothing", () => {
    const r = collect('{"status":"completed","conclusion":"success"}', 30 * 60_000);
    expect(r.gh).toMatch(/run download 77 -R seq23\/creator-studios -n engine-out-noelle-x/);
    expect(r.state.failed.map((f: any) => f.why).join("\n")).toMatch(/RENDER_DOWNLOAD/);
    expect(r.state.queued).toEqual([]);
    expect(r.rc).toBe(14);
  });
});

/**
 * The shell, for real (noelle.sh), in a fake repo: its own noelle.sh and flock.sh, and a noelle.mjs stand-in
 * that logs each step and answers from env (DUE, ACT_RC, COLLECT_RC). Nothing here reaches the vault or GitHub.
 */
function fakeRepo() {
  const home = mkdtempSync(join(tmpdir(), "noelle-sh-"));
  const repo = join(home, "repo");
  for (const d of ["scripts/ops/lib", "scripts/validate"]) mkdirSync(join(repo, d), { recursive: true });
  for (const f of ["scripts/ops/noelle.sh", "scripts/ops/lib/flock.sh", "scripts/ops/noelle-prompt.md", "scripts/ops/noelle-permissions.json", "scripts/ops/noelle-review-permissions.json"]) copyFileSync(join(ROOT, f), join(repo, f));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fake", private: true, scripts: { "vault:run": "env" } }));
  writeFileSync(join(repo, "scripts/ops/lib/ai-run.mjs"), `console.log("brain");\n`);
  writeFileSync(join(repo, "scripts/validate/noelle-no-tools.mjs"), `process.exit(0);\n`);
  writeFileSync(join(repo, "scripts/ops/noelle.mjs"), `
import { appendFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
const [cmd, a, b, c, d] = process.argv.slice(2);
appendFileSync(process.env.STEPS, [cmd, a, b, c, d].filter((x) => x !== undefined).join(" ") + "\\n");
if (cmd === "due") { console.log(process.env.DUE); process.exit(0); }
if (cmd === "mark") { writeFileSync(a, JSON.stringify({ state: b, code: c || null, tries: Number(d) || 1 })); process.exit(0); }
if (cmd === "call-claim") { console.log("NONE"); process.exit(0); }
if (cmd === "context") { mkdirSync(a, { recursive: true }); writeFileSync(join(a, "context.txt"), "ctx"); writeFileSync(join(a, "noelle-tools"), "#!/bin/sh\\n"); chmodSync(join(a, "noelle-tools"), 0o755); process.exit(0); }
if (cmd === "act") { console.log("RENDERING first render 77"); process.exit(Number(process.env.ACT_RC)); }
if (cmd === "collect") { process.exit(Number(process.env.COLLECT_RC)); }
process.exit(0);
`);
  const aiRun = join(home, "ai-run");
  writeFileSync(aiRun, `#!/bin/bash\nwhile [ "$1" != "--out" ]; do shift; done\nprintf 'NOELLE-PLAN-BEGIN {} NOELLE-PLAN-END' > "$2"\n`);
  chmodSync(aiRun, 0o755);
  const sh = (env: Record<string, string>) => {
    const steps = join(home, `steps-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(steps, "");
    const r = spawnSync("bash", [join(repo, "scripts/ops/noelle.sh")], { encoding: "utf8", timeout: 60_000, env: { PATH: process.env.PATH ?? "", HOME: home, BOSS_OS_REPO: repo, AI_RUN_BIN: aiRun, NOELLE_DAY: "2026-11-28", NOELLE_NOW: "15:00", NOELLE_NO_CALLS: "1", STEPS: steps, ...env } });
    return { rc: r.status, out: `${r.stdout}${r.stderr}`, steps: readFileSync(steps, "utf8").trim().split("\n").filter(Boolean) };
  };
  const runs = join(home, ".boss-os/noelle/runs");
  return { home, runs, pending: join(runs, "rendering"), sh };
}

describe("noelle.sh parks a rendering run and collects it on a later tick", () => {
  it("act's exit 20: the run is parked with its facts, the day marked rendering, done NOT called", () => {
    const f = fakeRepo();
    const r = f.sh({ DUE: "RUN 14:37 daily 1", ACT_RC: String(EXIT_RENDERING) });
    expect(r.rc).toBe(0);
    expect(r.steps.map((s) => s.split(" ")[0])).toEqual(["due", "context", "plan", "act", "mark"]);
    expect(JSON.parse(readFileSync(join(f.runs, "2026-11-28.json"), "utf8")).state).toBe("rendering");
    const parked = readdirSync(f.pending);
    expect(parked).toEqual(["2026-11-28-1437.env"]);
    expect(readFileSync(join(f.pending, parked[0] ?? ""), "utf8")).toMatch(/WORK=.*2026-11-28-1437\nMARK=.*2026-11-28\.json\nTRY=1\nSLOT=14:37\nCALL=''/);
  });

  it("a later tick: still rendering (21) stays parked and is never done; finished (0) runs done and marks the day done, once", () => {
    const f = fakeRepo();
    f.sh({ DUE: "RUN 14:37 daily 1", ACT_RC: String(EXIT_RENDERING) });
    const wait = f.sh({ DUE: "WAIT today's run is rendering on GitHub", COLLECT_RC: String(EXIT_STILL_RENDERING) });
    expect(wait.steps.map((s) => s.split(" ")[0])).toEqual(["collect", "due"]);
    expect(readdirSync(f.pending)).toHaveLength(1);
    const remake = f.sh({ DUE: "WAIT x", COLLECT_RC: String(EXIT_RENDERING) });
    expect(remake.steps.map((s) => s.split(" ")[0])).toEqual(["collect", "due"]);
    expect(readdirSync(f.pending)).toHaveLength(1);
    const end = f.sh({ DUE: "WAIT x", COLLECT_RC: "0" });
    expect(end.steps.map((s) => s.split(" ").slice(0, 2).join(" "))).toEqual([expect.stringMatching(/^collect /), expect.stringMatching(/^done /), expect.stringMatching(/^mark /), "due 2026-11-28"]);
    expect(JSON.parse(readFileSync(join(f.runs, "2026-11-28.json"), "utf8")).state).toBe("done");
    expect(readdirSync(f.pending)).toEqual([]);
    const after = f.sh({ DUE: "WAIT x", COLLECT_RC: "0" });
    expect(after.steps.map((s) => s.split(" ")[0])).toEqual(["due"]);
  });

  it("a collected run that queued nothing is red (14): marked stopped NOTHING_ACTED, never done", () => {
    const f = fakeRepo();
    f.sh({ DUE: "RUN 14:37 daily 1", ACT_RC: String(EXIT_RENDERING) });
    f.sh({ DUE: "WAIT x", COLLECT_RC: "14" });
    expect(JSON.parse(readFileSync(join(f.runs, "2026-11-28.json"), "utf8"))).toMatchObject({ state: "stopped", code: "NOTHING_ACTED" });
    expect(readdirSync(f.pending)).toEqual([]);
  });
});
