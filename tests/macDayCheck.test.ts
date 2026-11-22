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
import { macDayProblems, slotsOf } from "../scripts/ops/mac-day-check.mjs";
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
  it("reads the Central hour back from an Eastern Mac's plist", () => {
    expect(slotsOf(plist("x", at(11, 0)), 1)[0]?.mins).toBe(10 * 60);
  });
  it("every mac row the installers write has a class, and every MORNING row a worst runtime", () => {
    const cls = macWindows(manifest);
    expect(cls.size).toBeGreaterThan(50);
    for (const r of (manifest as any).rows) {
      if (r.system !== "mac" || /^ventures\./.test(r.trigger?.launchd?.[0] ?? "")) continue;
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
    for (const f of ["launchctl", "npm"]) execFileSync("chmod", ["+x", path.join(bin, f)]);
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
