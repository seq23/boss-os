/**
 * The Mac's day (her ruling 21 Nov 2026): the proof script fails each way the day can break, on real plist
 * text, and passes the boss-os installer's own plists as they will be installed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardPlist, macWindows } from "../scripts/ops/plist-central.mjs";
import { FAMILIES, macDayProblems, rowProblems, slotsOf } from "../scripts/ops/mac-day-check.mjs";
import manifest from "../src/shared/boss/schedule/manifest.json";

const plist = (label: string, slots: string, extra = "") =>
  `<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/bin/bash</string></array>${extra}<key>StartCalendarInterval</key><array>${slots}</array></dict></plist>`;
const at = (h: number, m: number, k = "") => `<dict>${k}<key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
const M = (rows: any[]) => ({ rows: rows.map(([l, c, w]) => ({ system: "mac", macWindow: c, trigger: { launchd: [l] }, ...(w ? { worstMin: { minutes: w } } : {}) })) });
const g = (text: string, cls: string) => guardPlist(text, cls, "/u/bin/mac-window");

describe("mac-day:check", () => {
  it("passes a day that keeps every rule", () => {
    const m = M([["com.seq.a", "LIGHT"], ["com.seq.h", "HEAVY"], ["com.seq.m", "MORNING", 10]]);
    const jobs = { "com.seq.a": g(plist("com.seq.a", at(10, 5)), "LIGHT"), "com.seq.h": g(plist("com.seq.h", at(22, 15)), "HEAVY"), "com.seq.m": g(plist("com.seq.m", at(6, 10)), "MORNING") };
    expect(macDayProblems(jobs, m)).toEqual([]);
  });
  it("fails a slot in the rest, a heavy job by day, a light job at night, a rushed morning job, and an unguarded job", () => {
    const m = M([["com.seq.a", "LIGHT"], ["com.seq.h", "HEAVY"], ["com.seq.m", "MORNING", 10], ["com.seq.n", "MORNING"], ["com.seq.u", "LIGHT"]]);
    const p = macDayProblems({
      "com.seq.a": g(plist("com.seq.a", at(7, 0) + at(9, 59) + at(23, 0)), "LIGHT"),
      "com.seq.h": g(plist("com.seq.h", at(13, 40) + at(6, 56)), "HEAVY"),
      "com.seq.m": g(plist("com.seq.m", at(6, 15)), "MORNING"),
      "com.seq.n": g(plist("com.seq.n", at(5, 0)), "MORNING"),
      "com.seq.u": plist("com.seq.u", at(11, 0)),
    }, m).join("\n");
    expect(p).toContain("com.seq.a 07:00: inside 07:00-09:59");
    expect(p).toContain("com.seq.a 09:59: inside 07:00-09:59");
    expect(p).toContain("com.seq.a 23:00: a LIGHT job outside 10:00-21:59");
    expect(p).toContain("com.seq.h 13:40: a HEAVY job outside 22:00-06:55");
    expect(p).toContain("com.seq.h 06:56: a HEAVY job outside 22:00-06:55");
    expect(p).toContain("com.seq.m 06:15: starts + 2 x 10 min worst = 06:35, after 06:30");
    expect(p).toContain("com.seq.n 05:00: a MORNING job with no measured worst runtime");
    expect(p).toContain("com.seq.u: does not run behind mac-window");
    const inScript = { rows: [...m.rows, { system: "mac", macWindow: "HEAVY", macWindowIn: "run.sh", trigger: { launchd: ["com.seq.s"] } }] };
    expect(macDayProblems({ "com.seq.s": plist("com.seq.s", at(23, 0)) }, inScript)).toEqual([]);
  });
  it("fails four starts in one 5-minute slot after 10:00 on a real date (a weekly and a daily together)", () => {
    const ls = ["com.seq.p1", "com.seq.p2", "com.seq.p3", "com.seq.p4"];
    const m = M(ls.map((l) => [l, "LIGHT"]));
    const jobs: Record<string, string> = {};
    ls.forEach((l, i) => { jobs[l] = g(plist(l, i === 3 ? at(10, 24, "<key>Weekday</key><integer>2</integer>") : at(10, 20 + i)), "LIGHT"); });
    const p = macDayProblems(jobs, m);
    expect(p.some((x: string) => / 10:20: 4 jobs start in one 5-minute slot/.test(x))).toBe(true);
    delete jobs["com.seq.p4"];
    expect(macDayProblems(jobs, M(ls.slice(0, 3).map((l) => [l, "LIGHT"])))).toEqual([]);
  });
  it("fails a job with no class on its row, and a guard whose class or label disagrees with the row", () => {
    const m = M([["com.seq.k", "LIGHT"]]);
    const p = macDayProblems({
      "com.seq.nobody": g(plist("com.seq.nobody", at(11, 0)), "LIGHT"),
      "com.seq.k": guardPlist(plist("com.seq.k", at(11, 0)), "HEAVY", "/u/bin/mac-window"),
    }, m).join("\n");
    expect(p).toContain("com.seq.nobody: no macWindow on its Schedule row");
    expect(p).toContain("com.seq.k: runs behind mac-window HEAVY com.seq.k, its row says LIGHT");
    // the pause-ending tool her rules leave untouched needs no guard or row; its slot is still held to the day
    expect(macDayProblems({ "com.seq.resume-paused-jobs": plist("com.seq.resume-paused-jobs", at(0, 5)) }, m)).toEqual([]);
    expect(macDayProblems({ "com.seq.resume-paused-jobs": plist("com.seq.resume-paused-jobs", at(8, 5)) }, m).join("\n")).toContain("inside 07:00-09:59");
  });
  it("the rows' own claims: a MORNING row's slot + 2x its stated worst must end by 06:30", () => {
    expect(rowProblems(manifest)).toEqual([]);
    const bad = { rows: [{ id: "x", system: "mac", macWindow: "MORNING", slots: ["daily 04:00"], worstMin: { minutes: 80 } }, { id: "y", system: "mac", macWindow: "MORNING", slots: ["daily 05:00"] }] };
    expect(rowProblems(bad)).toEqual(["row x 04:00: starts + 2 x 80 min worst = 06:40, after 06:30", "row y: a MORNING row with no measured worst runtime (worstMin)"]);
  });
  it("Rule 0: no plists, or plists with no calendar slot, is exit 2, never a pass", () => {
    const run = (dir: string) => { try { execFileSync("node", ["scripts/ops/mac-day-check.mjs", "--dir", dir, "--held", dir, "--shift", "0"], { encoding: "utf8" }); return 0; } catch (e: any) { return e.status; } };
    const empty = mkdtempSync(path.join(tmpdir(), "macday-empty-"));
    expect(run(empty)).toBe(2);
    writeFileSync(path.join(empty, "com.seq.i.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.seq.i</string><key>StartInterval</key><integer>60</integer></dict></plist>`);
    expect(run(empty)).toBe(2);
  });
  it("reads the Central hour back from an Eastern Mac's plist", () => {
    expect(slotsOf(plist("x", at(11, 0)), 1)[0]?.mins).toBe(10 * 60);
  });
  it("covers West Peek OS's local-jobs claimer (it runs claude -p on this Mac), and only that West Peek OS daemon", () => {
    expect(FAMILIES.test("ventures.westpeek.os.local-jobs")).toBe(true);
    expect(FAMILIES.test("ventures.westpeek.os.seat-claimer")).toBe(false);
    const unguarded = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>ventures.westpeek.os.local-jobs</string><key>ProgramArguments</key><array><string>/bin/sh</string></array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict></dict></plist>`;
    expect(macDayProblems({ "ventures.westpeek.os.local-jobs": unguarded }, manifest as any)).toContain("ventures.westpeek.os.local-jobs: does not run behind mac-window");
  });
  it("every mac row the installers write has a class, and every MORNING row a worst runtime", () => {
    const cls = macWindows(manifest);
    expect(cls.size).toBeGreaterThan(50);
    for (const r of (manifest as any).rows) {
      if (r.system !== "mac" || !FAMILIES.test(r.trigger?.launchd?.[0] ?? "")) continue;
      expect(r.macWindow, r.id).toBeTruthy();
      if (r.macWindow === "MORNING") expect(r.worstMin?.minutes, r.id).toBeGreaterThan(0);
    }
  });
  it("the boss-os installers' plists, as installed, keep the Mac's day", () => {
    // Render every plist the installers write into a scratch HOME (fake launchctl, fake reload, no vault).
    const home = mkdtempSync(path.join(tmpdir(), "macday-"));
    const bin = path.join(home, "stub"); execFileSync("mkdir", ["-p", bin, path.join(home, "Library/LaunchAgents"), path.join(home, "bin")]);
    // launchctl: everything written counts as loaded, so the installers' own "is it listed?" checks pass.
    writeFileSync(path.join(bin, "launchctl"), `#!/bin/bash\ntrap "" PIPE\nif [ "$1" = list ]; then for f in "$HOME"/Library/LaunchAgents/*.plist; do echo "- 0 $(basename "$f" .plist)"; done; fi\nexit 0\n`);
    writeFileSync(path.join(bin, "npm"), "#!/bin/bash\nexit 0\n");
    // plutil exists only on a Mac: on a Linux runner the stub only checks the file
    // closes its plist and has no raw && (the full lint runs on the Mac, where plutil is real), and declines -convert so files are read as written.
    const real = (() => { try { return execFileSync("which", ["plutil"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
    writeFileSync(path.join(bin, "plutil"), real ? `#!/bin/bash\nexec ${real} "$@"\n` : `#!/bin/bash\n[ "$1" = -lint ] && { grep -q "</plist>" "$2" && ! grep -q "&&" "$2"; exit $?; }\nexit 1\n`);
    for (const f of ["launchctl", "npm", "plutil"]) execFileSync("chmod", ["+x", path.join(bin, f)]);
    writeFileSync(path.join(bin, "reload"), "#!/bin/bash\nexit 0\n"); execFileSync("chmod", ["+x", path.join(bin, "reload")]);
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_RUNTIME: process.cwd(), BOSS_OS_REPO: process.cwd(), BOSS_OS_DEVICE_ID: "test-mac", LAUNCHD_RELOAD: path.join(bin, "reload"), MAC_WINDOW_BIN: "/u/bin/mac-window", TZ: "America/Chicago" };
    for (const f of ["install-agent-launchd.sh", "install-morning-catchup.sh", "install-simone-commands.sh", "install-boss-mail-tail.sh"]) {
      try { execFileSync("bash", [path.join("scripts/ops", f)], { env, stdio: "ignore", timeout: 120_000 }); } catch { /* the end-of-run checks need a real launchd; the plists are written before them */ }
    }
    const dir = path.join(home, "Library/LaunchAgents");
    const jobs: Record<string, string> = {};
    for (const f of readdirSync(dir)) if (f.endsWith(".plist")) jobs[f.slice(0, -6)] = readFileSync(path.join(dir, f), "utf8");
    expect(Object.keys(jobs).length).toBeGreaterThan(40);
    expect(macDayProblems(jobs, manifest as any)).toEqual([]);
  }, 180_000);
});
