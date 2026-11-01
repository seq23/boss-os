/**
 * THE SCHEDULE IS THE OFFICIAL RECORD (owner approved the rebalanced week, 1 Nov 2026).
 *
 * src/shared/boss/schedule/manifest.json is what ☰ More → Schedule renders. This holds it to what
 * really fires, everywhere CI can see: the launchd jobs the installer writes (in Central, as written),
 * the duties every migration builds, and this repo's own crons. `npm run schedule:check` does the same
 * on her Mac against the live duties, the plists launchd holds, and every repo's default branch.
 * Each rule is also proven negatively: break the manifest, watch it fail.
 */
import { parseRepoCategories } from "../src/shared/boss/repos/categories.mjs";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canonical, chicagoOffset, cronEvents, cronProblems, displayWindow, dutyProblems, dutySlots, gatedCrons, activeCrons,
  installerJobs, launchdProblems, plistEvents, readSchedule, scheduleCategoryProblems, shapeProblems, weekProblems, wranglerCrons, workflowCrons,
} from "../scripts/ops/lib/schedule.mjs";
import { composeSpryWeekly, hostAllowed, loopSection, SPRY_WEEKLY } from "../src/shared/boss/spryWeekly/compose.mjs";
import { createTestDb, disposeTestDb, type TestDb } from "./helpers/db";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const m = readSchedule(ROOT);
const SH = readFileSync(path.join(ROOT, "scripts/ops/install-agent-launchd.sh"), "utf8");
const clone = () => JSON.parse(JSON.stringify(m));

/** Installer jobs whose times are computed in shell (a loop), so the parser cannot read them; the Mac check reads the installed plist. */
const INSTALLER_COMPUTED = ["com.seq.boss-repo-change"];

describe("the Schedule manifest", () => {
  it("every row is complete, and carries no owner address", () => {
    expect(m.rows.length).toBeGreaterThan(150);
    expect(shapeProblems(m)).toEqual([]);
    expect(JSON.stringify(m).toLowerCase()).not.toMatch(/@gmail\.com|sequoia@/);
  });

  it("every repo a row names must sit in one of her repo categories; unreadable categories stop by name", () => {
    const cats = parseRepoCategories("## Repo categories\n**Mine**\n- A: alpha-repo, beta-repo (note)\n**Friends & clients**\n- F: friend-repo\n**The system**\n- seq-bin, boss-os\n## Next\n");
    const rows = { rows: [{ trigger: { repo: "alpha-repo" } }, { trigger: { repo: "friend-repo" } }, { trigger: { repo: "boss-os" } }] };
    expect(scheduleCategoryProblems(rows, [], cats)).toEqual([]);
    expect(scheduleCategoryProblems({ rows: [...rows.rows, { trigger: { repo: "stray-repo" } }] }, [], cats).join(" ")).toMatch(/stray-repo/);
    expect(scheduleCategoryProblems(rows, ["any-scanned-repo"], cats)).toEqual([]); // scans are not judged, rows are
    expect(scheduleCategoryProblems(rows, [], parseRepoCategories("# no section"))[0]).toMatch(/NAMED STOP \[NO_REPO_CATEGORIES\]/);
  });

  it("every launchd job the installer writes has a row, at the Central time the installer writes", () => {
    const jobs = installerJobs(SH);
    expect(Object.keys(jobs).length).toBeGreaterThan(30);
    // Every Label stanza and every install_l_job line is read: a job the parser cannot see is one the guard cannot govern.
    const stanzas = (SH.match(/<key>Label<\/key><string>\$[A-Z0-9_]+<\/string>/g) ?? []).length + (SH.match(/^install_l_job \S+ "/gm) ?? []).length;
    expect(Object.keys(jobs).length).toBe(stanzas);
    expect(Object.keys(jobs).filter((l) => (jobs[l] ?? []).length === 0)).toEqual(INSTALLER_COMPUTED);
    for (const l of INSTALLER_COMPUTED) { delete jobs[l]; expect(m.rows.some((r: any) => (r.trigger.launchd ?? []).includes(l)), l).toBe(true); }
    expect(launchdProblems(m, jobs)).toEqual([]);
  });

  it("every installer that writes a calendar plist moves its Central hours to the Mac's zone", () => {
    const dir = path.join(ROOT, "scripts/ops");
    const installers = readdirSync(dir).filter((f) => /^install-.*\.sh$/.test(f));
    expect(installers.length).toBeGreaterThan(2);
    const bypass = installers.filter((f) => {
      const t = readFileSync(path.join(dir, f), "utf8");
      return /StartCalendarInterval/.test(t) && !/plist-central\.mjs|lint_plist /.test(t);
    });
    // 1 Nov 2026: install-simone-commands.sh skipped the mover, so Simone ran 05:00-22:50 Central.
    expect(bypass).toEqual([]);
  });

  it("NEGATIVE: a moved plist, a missing row and a wrong row each fail", () => {
    const jobs = installerJobs(SH);
    delete jobs["com.seq.boss-repo-change"];
    expect(launchdProblems(m, { ...jobs, "com.seq.boss-people": ["tue 07:15"] }).join()).toMatch(/people-worth-a-call: launchd com.seq.boss-people really fires tue 07:15/);
    expect(launchdProblems(m, { ...jobs, "com.seq.boss-new-thing": ["daily 06:00"] }).join()).toMatch(/no Schedule row names it/);
    const broken = clone();
    broken.rows.find((r: any) => r.id === "spry-weekly").slots = ["wed 08:30"];
    expect(launchdProblems(broken, jobs).join()).toMatch(/spry-weekly/);
  });

  describe("the duties every migration builds", () => {
    let t: TestDb;
    beforeAll(async () => { t = await createTestDb(); });
    afterAll(async () => { await disposeTestDb(t); });
    it("each has a row, at the duty's own day and time", async () => {
      const duties = (await t.db.prepare("SELECT id, name, local_hour, local_minute, cadence, weekday, weekdays, removed_at FROM standing_duties").all()).results as any[];
      expect(duties.length).toBeGreaterThan(30);
      // A duty born at runtime through the approval path has no migration; the Mac check reads it live.
      const born = new Set(m.rows.filter((r: any) => r.trigger.duty_born_live).map((r: any) => r.trigger.duty));
      const local = { ...m, rows: m.rows.filter((r: any) => !born.has(r.trigger.duty)) };
      expect(dutyProblems(local, duties)).toEqual([]);
      // NEGATIVE: the week moved back to Monday is caught by name.
      const back = duties.map((d) => (d.id === "duty_preseed_watch" ? { ...d, weekday: 1 } : d));
      expect(dutyProblems(local, back).join()).toMatch(/duty_preseed_watch runs mon 07:30, the Schedule says tue 07:30/);
      expect(dutyProblems({ ...local, rows: local.rows.filter((r: any) => r.trigger.duty !== "duty_credentials") }, duties).join()).toMatch(/duty_credentials .* no Schedule row/);
    });
  });

  it("this repo's own crons have rows at the times they fire", () => {
    const files: Array<{ file: string; crons: string[]; gated: any }> = [];
    const wfDir = path.join(ROOT, ".github/workflows");
    for (const f of existsSync(wfDir) ? readdirSync(wfDir) : []) {
      const text = readFileSync(path.join(wfDir, f), "utf8");
      if (/^\s*schedule:/m.test(text)) files.push({ file: `.github/workflows/${f}`, crons: workflowCrons(text), gated: gatedCrons(text) });
    }
    const wr = wranglerCrons(readFileSync(path.join(ROOT, "wrangler.toml"), "utf8"));
    if (wr.length) files.push({ file: "wrangler.toml", crons: [...new Set<string>(wr)], gated: { "-5": [], "-6": [] } });
    expect(files.length).toBeGreaterThan(0);
    expect(cronProblems(m, "boss-os", files, chicagoOffset())).toEqual([]);
    // NEGATIVE: a cron the manifest does not carry.
    expect(cronProblems(m, "boss-os", [...files, { file: ".github/workflows/x.yml", crons: ["0 3 * * 1"], gated: {} }]).join()).toMatch(/no Schedule row names it/);
    // NEGATIVE: a cloud job's file ticks (trigger.ticks) are held to its real crons, not the duty's slot.
    const moved = { ...m, rows: m.rows.map((r: any) => (r.trigger?.ticks?.[".github/workflows/job-errand-reminders.yml"]
      ? { ...r, trigger: { ...r.trigger, ticks: { ".github/workflows/job-errand-reminders.yml": ["hourly :00"] } } } : r)) };
    expect(cronProblems(moved, "boss-os", files, chicagoOffset()).join()).toMatch(/errand-reminders: says hourly :00, but its crons fire every 10m/);
  });

  it("every line of the approved week names jobs that really run that day, at that time", () => {
    const { problems, pending } = weekProblems(m);
    expect(problems).toEqual([]);
    expect(m.week.map((d: any) => d.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    // Lines whose jobs live in another repo still being moved are named, and they are the minority.
    // Lines whose jobs live in another repo still being moved (1 Nov 2026) are named by schedule:check
    // as WAITING; they stay the minority, and every one says which jobs it is waiting on or why not.
    expect(pending.length).toBeLessThan(m.week.reduce((a: number, d: any) => a + d.items.length, 0) / 2);
    // NEGATIVE: a line that says Tuesday for a Wednesday job fails.
    const wrong = clone();
    wrong.week.find((d: any) => d.day === "tue").items.push({ time: "8:15", tag: "sl", text: "x", emails: true, refs: ["spry-weekly"] });
    expect(weekProblems(wrong).problems.join()).toMatch(/spry-weekly does not run then/);
  });
});

describe("the slot language", () => {
  it("plists, duties and crons speak it the same way", () => {
    expect(canonical(plistEvents("<key>StartCalendarInterval</key><array><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict><dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict></array>", 1))).toEqual(["mon,fri 08:00"]);
    // An Eastern Mac's 00:30 on a Sunday is Saturday 23:30 Central.
    expect(canonical(plistEvents("<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>0</integer><key>Minute</key><integer>30</integer></dict>", 1))).toEqual(["sat 23:30"]);
    expect(dutySlots({ local_hour: 5, local_minute: 30, cadence: "daily", weekdays: "[1,3,5]" })).toEqual(["mon,wed,fri 05:30"]);
    expect(dutySlots({ local_hour: 9, local_minute: 30, cadence: "monthly" })).toEqual(["day1 09:30"]);
    expect(canonical(cronEvents("13 13 * * 3", -6))).toEqual(["wed 07:13"]);
    expect(canonical(cronEvents("0 3 * * 1", -6))).toEqual(["sun 21:00"]);
    expect(canonical(cronEvents("*/15 * * * *", -6))).toEqual(["every 15m"]);
    // A cron GitHub reads in Chicago time is Central already, summer and winter.
    expect(workflowCrons('    - cron: "29 9 * * 5"  # all year\n      timezone: America/Chicago\n    - cron: "0 3 * * *"')).toEqual(["CRON_TZ=America/Chicago 29 9 * * 5", "0 3 * * *"]);
    expect(canonical(cronEvents("CRON_TZ=America/Chicago 29 9 * * 5", -5))).toEqual(["fri 09:29"]);
    const yaml = 'if [ "$SCHEDULE" = "13 12 * * 3" ] && [ "$offset" != "-0500" ]; then run=false; fi\nif [ "$SCHEDULE" = "13 13 * * 3" ] && [ "$offset" != "-0600" ]; then run=false; fi';
    expect(activeCrons({ crons: ["13 12 * * 3", "13 13 * * 3"], gated: gatedCrons(yaml) }, -6)).toEqual(["13 13 * * 3"]);
    expect(activeCrons({ crons: ["13 12 * * 3", "13 13 * * 3"], gated: gatedCrons(yaml) }, -5)).toEqual(["13 12 * * 3"]);
    expect(displayWindow("Before 6am")).toEqual({ from: 0, to: 359 });
    expect(displayWindow("6:45pm")).toEqual({ from: 1125, to: 1125 });
    expect(displayWindow("7:00–8:00")).toEqual({ from: 420, to: 480 });
  });
});

describe("the Schedule page", () => {
  it("renders the manifest itself and sits in ☰ More next to the Email Map", () => {
    const page = readFileSync(path.join(ROOT, "src/client/boss/pages/Schedule.tsx"), "utf8");
    expect(page).toContain('from "@shared/boss/schedule/manifest.json"');
    const shell = readFileSync(path.join(ROOT, "src/client/boss/components/Shell.tsx"), "utf8");
    expect(shell).toMatch(/MORE_TABS[^\n]*"emails", "schedule"/);
    expect(readFileSync(path.join(ROOT, "src/client/boss/App.tsx"), "utf8")).toMatch(/tab === "schedule" \? \(\s*<Schedule \/>/);
  });

  it("the approved plan is committed and points at the page", () => {
    const doc = readFileSync(path.join(ROOT, m.approved.doc), "utf8");
    expect(doc).toContain("☰ More → Schedule");
    expect(doc).toContain(m.approved.artifact);
    for (const d of m.week) for (const it of d.items) expect(doc, `${d.label} ${it.time}`).toContain(it.text);
  });
});

describe("the Spry Labs weekly", () => {
  const now = Date.parse("2026-11-04T14:15:00Z");
  const fresh = (sites: any[], extra = {}) => ({ summary: { schema: SPRY_WEEKLY.schema, generated_at: "2026-11-04T13:20:00Z", sites, notes: [], ...extra } });

  it("every source is a weekly report the Schedule carries, and none sends its own email", () => {
    for (const s of SPRY_WEEKLY.sources) {
      const row = m.rows.find((r: any) => r.trigger.repo === s.repo && r.trigger.file === s.workflow);
      expect(row, `${s.repo} ${s.workflow}`).toBeTruthy();
    }
    expect(m.rows.find((r: any) => r.id === "spry-weekly").slots).toEqual(["wed 08:15"]);
  });

  it("every Wednesday source is ready on the slot it promises, before 08:15, on the week's 7:00–8:00 line", () => {
    const wed = m.week.find((d: any) => d.day === "wed").items.find((i: any) => i.time === "7:00–8:00" && i.refs.includes("aplayer-mode-weekly-outcome-report"));
    const timed = SPRY_WEEKLY.sources.filter((s: any) => /^\d\d:\d\d$/.test(s.ready_by_ct));
    expect(timed.map((s: any) => s.repo)).toEqual(expect.arrayContaining(["approvalprep", "dream-wedding-builder"]));
    for (const s of timed) {
      const row = m.rows.find((r: any) => r.trigger.repo === s.repo && r.trigger.file === s.workflow);
      expect(row.slots, s.key).toContain(`wed ${s.ready_by_ct}`);
      expect(s.ready_by_ct < "08:15", s.key).toBe(true);
      expect(wed.refs, s.key).toContain(row.id);
    }
    expect(new Set(timed.map((s: any) => s.ready_by_ct)).size).toBe(timed.length);
  });

  it("a business's four own lines (sales, search, Pinterest, pages) all reach the email", () => {
    const notes = ["Sales: 1 paid order this week.", "Search: not read: no record.", "Pinterest (week to Oct 31): 2 visits from pins.", "Pages this week: 3 pages refreshed."];
    const mail = composeSpryWeekly({ approvalprep: fresh([{ host: "approvalprep.com", state: "fine", why: [] }], { notes }) }, { now });
    const section = mail.sections.find((s: any) => s.title === "ApprovalPrep");
    for (const n of notes) expect(section!.items).toContain(n);
    expect(mail.sections.find((s: any) => s.title === "Dream Wedding")!.items[0]).toMatch(/^No report this week/);
  });

  it("rule 0: a report that did not arrive is a plain line, never silence", () => {
    const mail = composeSpryWeekly({ "aplayer-mode": fresh([{ host: "aplayermode.com", state: "fine", why: [] }]) }, { now });
    // Every business section, then the one "Search loop" section (1 Nov 2026).
    expect(mail.sections).toHaveLength(SPRY_WEEKLY.sources.length + 1);
    expect(mail.missing).toBe(SPRY_WEEKLY.sources.length - 1);
    for (const s of mail.sections.slice(1, SPRY_WEEKLY.sources.length)) expect(s.items[0]).toMatch(/^No report this week/);
    // An unread loop is said for every site, never a zero and never left out.
    const loop = mail.sections[SPRY_WEEKLY.sources.length]!;
    expect(loop.title).toBe("Search loop");
    expect(loop.items).toHaveLength(SPRY_WEEKLY.search_loop.sites.length);
    for (const i of loop.items) expect(i).toMatch(/: could not be read this week\.$/);
    expect(JSON.stringify(loop.items)).not.toMatch(/\b0\b/);
    expect(mail.happened).toMatch(/did not arrive/);
  });

  it("a stale report is named as stale, and client or parked sites are never named", () => {
    const old = { summary: { ...fresh([]).summary, generated_at: "2026-10-28T13:00:00Z" } };
    const site = composeSpryWeekly({ "aplayer-mode": old, "citation-velocity": fresh([
      { host: "horselegalguide.com", state: "needs-a-look", why: ["x"] },
      { host: "heygetonmylevel.com", state: "needs-a-look", why: ["y"] },
      { host: "theindustryguides.com", state: "needs-a-look", why: ["impressions down"] },
    ]) }, { now });
    expect(site.sections[0]!.items[0]).toMatch(/not this week/);
    // The business sections never name a client or a parked business. heygetonmylevel's business is
    // still parked; its SEARCH work is in since 1 Nov 2026, so it has exactly one Search loop line.
    const text = JSON.stringify(site.sections.filter((s: any) => s.title !== "Search loop"));
    expect(text).not.toMatch(/horselegalguide|heygetonmylevel/);
    const loopText = site.sections.find((s: any) => s.title === "Search loop")!.items;
    expect(loopText.filter((i: string) => /heygetonmylevel/.test(i))).toHaveLength(1);
    expect(JSON.stringify(loopText)).not.toMatch(/horse|hicks|dianne|detoxdenver|cynthia|porch/i);
    expect(text).toContain("theindustryguides.com: impressions down.");
    expect(hostAllowed("www.hicksconsulting.org")).toBe(false);
  });

  describe("the search loop line (owner, 1 Nov 2026)", () => {
    const week = (site: string, over: any = {}) => ({ schema: "search-loop-week-v1", site, generated_at: "2026-11-03T12:00:00Z", state: "running", published: 21, indexed: 38, pace: 10, ai_visitors: 4, ai_bot_hits: 90, conversions: 2, wins: 2, undone: 1, merged: 0, notes: [], run_url: "https://github.com/x", ...over });
    const all = (v: any) => Object.fromEntries(SPRY_WEEKLY.search_loop.sites.flatMap((x: any) => x.repos).map((r: string) => [r, v]));

    it("her sites only: never a client site, never Porch & Party (not Spry Labs), every Spry Labs seller", () => {
      const repos = SPRY_WEEKLY.search_loop.sites.flatMap((x: any) => x.repos);
      expect(repos.sort()).toEqual(["approvalprep", "dailystory", "dream-wedding-builder", "heygetonmylevel", "local-guides-citation-velocity", "local-guides-generator", "sprylabs-hpc-site"]);
      for (const bad of ["horse-legal-guide-velocity", "hicks-consulting-canonical", "dianne-place-recovery-services", "cynthia-brown-dds-site", "p-n-p"]) expect(repos).not.toContain(bad);
    });

    it("one plain line per site from its report", () => {
      const loop = all({ weeks: [], adopted: false });
      loop["approvalprep"] = { weeks: [week("approvalprep.com")], adopted: true };
      const { section, late } = loopSection(loop, { now });
      expect(section.items).toContain("ApprovalPrep: Published 21 pages · 38 indexed · 4 AI visitors · 2 sales · 2 wins, 1 undone.");
      expect(late).toEqual([]);
    });

    it("several sites in one business add up, and a re-run never counts twice", () => {
      const loop = all({ weeks: [], adopted: false });
      loop["local-guides-generator"] = { weeks: [week("uscisexam.com"), week("uscisexam.com", { generated_at: "2026-11-02T12:00:00Z", published: 99 }), week("dentistryguides.com", { published: 1, merged: 3 })], adopted: true };
      const { section } = loopSection(loop, { now });
      expect(section.items).toContain("Industry Guides: Published 22 pages · 76 indexed · 8 AI visitors · 4 form fills · 4 wins, 2 undone, 3 merged (2 sites).");
    });

    it("rule 0: not adopted says not started yet; adopted with nothing fresh says it did not arrive; a missing number is not read, never 0", () => {
      const loop = all({ weeks: [], adopted: false });
      loop["dailystory"] = { weeks: [week("time-2-read.com", { generated_at: "2026-10-20T12:00:00Z" })], adopted: true };
      loop["approvalprep"] = { weeks: [week("approvalprep.com", { ai_visitors: null, conversions: undefined })], adopted: true };
      const { section, late } = loopSection(loop, { now });
      expect(section.items).toContain("Dream Wedding: not started yet.");
      expect(section.items).toContain("Time-2-Read: this week's report did not arrive. The team checks why.");
      expect(late).toEqual(["time-2-read"]);
      const ap = section.items.find((i: string) => i.startsWith("ApprovalPrep"))!;
      expect(ap).toMatch(/AI visitors not read/);
      expect(ap).toMatch(/sales not read/);
      expect(ap).not.toMatch(/\b0 (AI|sales)/);
    });
  });

  it("a quiet week says so in one line", () => {
    const all = Object.fromEntries(SPRY_WEEKLY.sources.map((s: any) => [s.key, fresh([{ host: "aplayermode.com", state: "fine", why: [] }])]));
    expect(composeSpryWeekly(all, { now }).happened).toBe("Every Spry Labs business reported this week, and all is quiet.");
  });
});
