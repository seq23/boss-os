/**
 * THE SCORECARD (owner ruling, 1 Nov 2026: "nothing runs unmeasured").
 *
 * Behaviour, each proven negatively: a job with no scorecard row fails the build; the five states move
 * the way the ruling says (version B once, then pause); a broken or stuck number is "No number", never
 * fine; a pause goes through each job's own switch and never deletes; the Monday run cannot pass on
 * nothing; the email lists only what needs a look.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  READER_IDS, STATES, addDays, coverageProblems, emailSection, findStrays, judge, pauseTargets, shapeProblems,
} from "../src/shared/boss/scorecard/scorecard.mjs";
import { READERS, d1Sql, spryLabsDomains } from "../scripts/ops/lib/scorecard-readers.mjs";
import { pauseOne, runStop } from "../scripts/ops/scorecard-monday.mjs";
import { runProblems } from "../src/worker/boss/routes/scorecard";
import { buildDay } from "../scripts/ops/your-day.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));
const SC = read("src/shared/boss/scorecard/manifest.json");
const SCHEDULE = read("src/shared/boss/schedule/manifest.json");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("the build check: nothing runs unmeasured", () => {
  it("the real scorecard is clean and covers every scheduled job", () => {
    expect(SC.rows.length).toBeGreaterThanOrEqual(16);
    expect(shapeProblems(SC)).toEqual([]);
    expect(coverageProblems(SC, SCHEDULE)).toEqual([]);
  });

  it("a new scheduled job with no row and no exemption fails, by name", () => {
    const s = clone(SCHEDULE);
    s.rows.push({ id: "new-pin-feed", name: "New pin feed", trigger: { launchd: ["com.seq.new-pin-feed"] } });
    expect(coverageProblems(SC, s).join("\n")).toMatch(/new-pin-feed: runs with no scorecard row/);
    const sc = clone(SC);
    sc.rows[0].jobs.push("new-pin-feed");
    expect(coverageProblems(sc, s)).toEqual([]);
  });

  it("an exemption needs a known kind and a written reason, and goes stale with its job", () => {
    const s = clone(SCHEDULE); s.rows.push({ id: "plumbing", name: "x", trigger: {} });
    const sc = clone(SC);
    sc.exempt.plumbing = { kind: "system", why: "" };
    expect(coverageProblems(sc, s).join("\n")).toMatch(/exempt plumbing: no reason/);
    sc.exempt.plumbing = { kind: "because", why: "Keeps the system running and has no customer result." };
    expect(coverageProblems(sc, s).join("\n")).toMatch(/exempt plumbing: kind/);
    sc.exempt.gone = { kind: "system", why: "Keeps the system running and has no customer result." };
    expect(coverageProblems(sc, s).join("\n")).toMatch(/exempt gone: not in the Schedule/);
  });

  it("a job counted twice, or a row naming a job that is gone, fails", () => {
    const sc = clone(SC);
    sc.rows[1].jobs.push(sc.rows[0].jobs[0]);
    expect(coverageProblems(sc, SCHEDULE).join("\n")).toMatch(/is in two rows/);
    const sc2 = clone(SC); sc2.rows[0].jobs.push("no-such-job");
    expect(coverageProblems(sc2, SCHEDULE).join("\n")).toMatch(/no-such-job, which is not in the Schedule/);
  });

  it("an empty list is a named stop, never a pass", () => {
    expect(shapeProblems({ rows: [] })[0]).toMatch(/NAMED STOP \[SCORECARD_EMPTY\]/);
    expect(coverageProblems(SC, { rows: [] })[0]).toMatch(/NAMED STOP \[SCHEDULE_EMPTY\]/);
  });

  it("a row without version B, with an unknown reader, or with SQL that is not one counting SELECT fails", () => {
    const bad = (f: (r: any) => void) => { const sc = clone(SC); f(sc.rows[0]); return shapeProblems(sc).join("\n"); };
    expect(bad((r) => { r.versionB = { text: "" }; })).toMatch(/version B is not written/);
    expect(bad((r) => { r.first.reader = "a-person-checks"; })).toMatch(/is not a reader/);
    expect(bad((r) => { r.first.params.sql = "DELETE FROM prospects"; })).toMatch(/read-only SELECT/);
    expect(bad((r) => { r.first.params.sql = "SELECT email FROM prospects"; })).toMatch(/one number named n/);
    expect(bad((r) => { delete r.real.floor; })).toMatch(/real has no floor/);
  });

  it("every reader a row may name is implemented, and nothing else", () => {
    expect(Object.keys(READERS).sort()).toEqual([...READER_IDS].sort());
  });
});

// A row whose clock started on 1 Nov: first floor (>= 10) on day 30, real floor (>= 2) on day 60.
const ROW = {
  id: "t", initiative: "Test feed", business: "spry", owner: "x", result: "Visits, then sales", jobs: [], start: "2026-11-01",
  first: { label: "visits a week", reader: "d1", by: 30, floor: { op: ">=", value: 10 } },
  real: { label: "sales a month", reader: "d1", by: 60, floor: { op: ">=", value: 2 } },
  versionB: { text: "A new pin format." },
};
const R = (first: number | null, real: number | null, err?: string) => ({ first: err ? { raw: null, error: err } : { raw: first }, real: { raw: real } });

describe("the five states", () => {
  it("Too early before the first check date, judged from the row's own start", () => {
    const j = judge({ row: ROW, record: null, reading: R(0, 0), today: "2026-11-16" });
    expect(j.state).toBe("Too early");
    expect(j.next).toBe("2026-12-01");
    expect(j.actions).toEqual([]);
  });

  it("On track at the first check when the number meets the floor", () => {
    expect(judge({ row: ROW, record: null, reading: R(12, 0), today: "2026-12-01" }).state).toBe("On track");
  });

  it("a first miss tries version B once and restarts the clock; a second miss pauses; nothing in between acts", () => {
    const miss = judge({ row: ROW, record: null, reading: R(4, 0), today: "2026-12-01" });
    expect(miss.state).toBe("Trying version B");
    expect(miss.actions.map((a) => a.kind)).toEqual(["versionB"]);
    expect(miss.next).toBe(addDays("2026-12-01", 30));
    const during = judge({ row: ROW, record: miss.record, reading: R(5, 0), today: "2026-12-15" });
    expect(during.state).toBe("Trying version B");
    expect(during.actions).toEqual([]);
    const again = judge({ row: ROW, record: during.record, reading: R(6, 0), today: "2026-12-31" });
    expect(again.state).toBe("Paused");
    expect(again.actions.map((a) => a.kind)).toEqual(["pause"]);
    const later = judge({ row: ROW, record: again.record, reading: R(50, 50), today: "2027-01-07" });
    expect(later.state).toBe("Paused"); // stays paused until she restarts it; never a third try
    expect(later.actions).toEqual([]);
  });

  it("version B that works puts the row back on track", () => {
    const miss = judge({ row: ROW, record: null, reading: R(4, 0), today: "2026-12-01" });
    const ok = judge({ row: ROW, record: miss.record, reading: R(15, 0), today: "2026-12-31" });
    expect(ok.state).toBe("On track");
    expect(ok.record.bOn).toBeNull();
  });

  it("from day 60 the real floor is the one judged", () => {
    expect(judge({ row: ROW, record: null, reading: R(99, 0), today: "2026-12-31" }).state).toBe("Trying version B");
    expect(judge({ row: ROW, record: null, reading: R(0, 3), today: "2026-12-31" }).state).toBe("On track");
  });

  it("an unreadable source is No number, never fine, and does not move the clock", () => {
    const j = judge({ row: ROW, record: null, reading: R(null, 0, "NAMED STOP [KEY_MISSING] GUMROAD_ACCESS_TOKEN is not in the vault"), today: "2026-12-01" });
    expect(j.state).toBe("No number");
    expect(j.actions).toEqual([]);
    expect(j.record.bOn).toBeNull();
    expect(j.note).not.toMatch(/NAMED STOP/);
  });

  it("a number that has not moved for three weeks is No number; a window count at zero is judged instead", () => {
    let rec: any = null;
    for (const day of ["2026-11-02", "2026-11-09", "2026-11-16"]) rec = judge({ row: ROW, record: rec, reading: R(7, 1), today: day }).record;
    expect(judge({ row: ROW, record: rec, reading: R(7, 1), today: "2026-11-23" }).state).toBe("No number");
    expect(judge({ row: ROW, record: rec, reading: R(8, 2), today: "2026-11-23" }).state).toBe("Too early");
    let zero: any = null;
    for (const day of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) zero = judge({ row: ROW, record: zero, reading: R(0, 0), today: day }).record;
    expect(judge({ row: ROW, record: zero, reading: R(0, 0), today: "2026-12-01" }).state).toBe("Trying version B");
  });

  it("a row with a start condition is Too early until it starts, then its clock runs from that day", () => {
    const row = { ...ROW, start: null, startWhen: { label: "posting starts", reader: "d1" } };
    expect(judge({ row, record: null, reading: { ...R(0, 0), started: { raw: null } }, today: "2026-11-02" }).note).toMatch(/until posting starts/);
    const j = judge({ row, record: null, reading: { ...R(0, 0), started: { raw: "2026-11-20T10:00:00Z" } }, today: "2026-11-23" });
    expect(j.record.start).toBe("2026-11-20");
    expect(j.next).toBe("2026-12-20");
  });

  it("a delta metric needs history before it can be judged, then judges the change", () => {
    const row = { ...ROW, first: { ...ROW.first, delta: 28 } };
    expect(judge({ row, record: null, reading: R(1000, 3), today: "2026-12-01" }).state).toBe("No number");
    const rec = { history: [{ week: "2026-11-02", firstRaw: 990, realRaw: 0, first: null, real: 0 }] };
    expect(judge({ row, record: rec, reading: R(1000, 3), today: "2026-12-01" }).values.first.value).toBe(10);
  });

  it("every state the judge returns is one of the five", () => {
    for (const today of ["2026-11-02", "2026-12-01", "2026-12-31"]) for (const rd of [R(0, 0), R(50, 50), R(null, 0, "x")]) expect(STATES).toContain(judge({ row: ROW, record: null, reading: rd, today }).state);
  });
});

describe("pause never deletes", () => {
  it("each job pauses through its own switch: a duty's pause, outreach's pause, a workflow disabled, else by hand", () => {
    const kinds = new Set(SC.rows.flatMap((r: any) => pauseTargets(r, SCHEDULE).map((t) => t.kind)));
    for (const k of kinds) expect(["duty", "outreach", "workflow", "record"]).toContain(k);
    const t2r = pauseTargets(SC.rows.find((r: any) => r.id === "t2r-institutional"), SCHEDULE);
    expect(t2r.map((t) => t.kind).sort()).toEqual(["duty", "outreach", "outreach"]);
  });

  it("the pause calls only pause or disable, never a delete or a removal", async () => {
    const calls: string[] = [];
    const api = { post: async (p: string, b: any) => { calls.push(`POST ${p} ${JSON.stringify(b)}`); }, put: async (p: string, b: any) => { calls.push(`PUT ${p} ${JSON.stringify(b)}`); } };
    const run = (args: string[]) => { calls.push(`gh ${args.join(" ")}`); return ""; };
    await pauseOne(api, { kind: "duty", duty: "duty_x" }, "why", run);
    await pauseOne(api, { kind: "outreach", key: "time2read" }, "why it paused", run);
    await pauseOne(api, { kind: "workflow", repo: "r", file: "w.yml" }, "why", run);
    expect(await pauseOne(api, { kind: "record", name: "A job" }, "why", run)).toMatch(/by hand/);
    expect(calls).toEqual([
      'POST /duties/duty_x/pause {"paused":true}',
      'PUT /outreach/business/time2read {"pause":true,"pause_reason":"why it paused","by":"toni"}',
      "gh workflow disable w.yml -R seq23/r",
    ]);
    expect(calls.join(" ")).not.toMatch(/delete|remove/i);
  });
});

describe("the Monday run", () => {
  it("cannot pass having read nothing", () => {
    expect(runStop([])).toMatch(/NAMED STOP \[SCORECARD_NOTHING_READ\]/);
    const dead = { state: "No number", values: { first: { error: "x" }, real: { error: "y" } } };
    expect(runStop([dead, dead])).toMatch(/NAMED STOP \[SCORECARD_ALL_UNREADABLE\]/);
    expect(runStop([dead, { state: "Too early", values: { first: {}, real: {} } }])).toBeNull();
  });

  it("fills a query's window and keeps it read-only", () => {
    const sql = d1Sql({ sql: "SELECT COUNT(*) AS n FROM t WHERE a >= :since_ms AND b >= datetime(:since_iso)", days: 7 }, Date.parse("2026-11-08T00:00:00Z"));
    expect(sql).toContain(String(Date.parse("2026-11-01T00:00:00Z")));
    expect(sql).toContain("'2026-11-01 00:00:00'");
    expect(() => d1Sql({ sql: "SELECT COUNT(*) AS n FROM t WHERE a >= :since_ms" }, 0)).toThrow(/NAMED STOP \[ROW_SHAPE\]/);
  });

  it("reads the Spry Labs sites from the one site list, never Time-2-Read or a client", () => {
    const d = spryLabsDomains(read("src/shared/boss/searchReadiness/sites.json"));
    expect(d.length).toBeGreaterThan(5);
    expect(d).not.toContain("time-2-read.com");
    expect(d).not.toContain("horselegalguide.com");
  });

  it("the Worker refuses a run that names an unknown row, carries an address, or records nothing", () => {
    expect(runProblems({ week: "2026-11-02", results: [] }).join(" ")).toMatch(/no results/);
    expect(runProblems({ week: "2026-11-02", results: [{ id: "nope", state: "On track", record: {} }] }).join(" ")).toMatch(/unknown row/);
    expect(runProblems({ week: "2026-11-02", results: [{ id: SC.rows[0].id, state: "On track", note: "a@b.com", record: {} }] }).join(" ")).toMatch(/address/);
    expect(runProblems({ week: "2026-11-02", results: [{ id: SC.rows[0].id, state: "On track", record: { history: [] } }] })).toEqual([]);
  });
});

describe("the Monday email section", () => {
  const links = (row: any) => ({ open: `https://boss.example/?tab=scorecard&row=${row.id}`, restart: row.id === "t" ? "https://boss.example/tap/sc123" : null });
  it("a quiet week is one line", () => {
    const res = [judge({ row: ROW, record: null, reading: R(1, 1), today: "2026-11-02" })];
    const s = emailSection(res, [ROW], { today: "2026-11-02", links });
    expect(s.title).toBe("📊 Scorecard: 0 on track");
    expect(s.lines).toHaveLength(1);
  });

  it("lists switches, pauses and rows with no number — each with its one-tap link — and nothing on track", () => {
    const miss = judge({ row: ROW, record: null, reading: R(4, 0), today: "2026-12-01" });
    const paused = judge({ row: ROW, record: { ...miss.record, bOn: "2026-10-31", missed: "first" }, reading: R(4, 0), today: "2026-12-01" });
    const none = judge({ row: { ...ROW, id: "u", initiative: "Other" }, record: null, reading: R(null, 0, "NAMED STOP [KEY_MISSING] X_KEY missing"), today: "2026-12-01" });
    const fine = judge({ row: { ...ROW, id: "v", initiative: "Fine one" }, record: null, reading: R(20, 0), today: "2026-12-01" });
    const s = emailSection([paused, none, fine], [ROW, { ...ROW, id: "u", initiative: "Other" }, { ...ROW, id: "v", initiative: "Fine one" }], { today: "2026-12-01", links });
    expect(s.title).toBe("📊 Scorecard: 1 on track, 2 need a look");
    const text = JSON.stringify(s.lines);
    expect(text).toContain("Restart it");
    expect(text).toContain("Sent to repairs");
    expect(text).not.toContain("Fine one");
    expect(s.lines.map((l: any) => (typeof l === "string" ? l : l.text)).join(" ")).not.toMatch(/NAMED STOP|X_KEY|\[/);
    const switched = emailSection([miss], [ROW], { today: "2026-12-01", links });
    expect(JSON.stringify(switched.lines)).toMatch(/Trying version B · Test feed: 4 visits a week \(floor 10\)/);
  });

  it("reaches Simone's morning email as its own section, not dropped by the plain-words gate", () => {
    const miss = judge({ row: ROW, record: null, reading: R(4, 0), today: "2026-12-01" });
    const s = emailSection([miss], [ROW], { today: "2026-12-01", links });
    const now = Date.parse("2026-12-01T12:30:00Z");
    const day = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: { scorecard: { section: "scorecard", at: new Date(now).toISOString(), title: s.title, lines: s.lines } } }, now);
    expect(day.text).toContain("📊 Scorecard: 0 on track, 1 needs a look");
    expect(day.text).toContain("Trying version B · Test feed");
  });
});

describe("Kendra's stray sweep", () => {
  it("finds a Mac job or a repo run with no Schedule row, and nothing that is covered", () => {
    const covered = SCHEDULE.rows.find((r: any) => r.trigger?.launchd)!;
    const wf = SCHEDULE.rows.find((r: any) => r.trigger?.repo && r.trigger?.file)!;
    const strays = findStrays({ schedule: SCHEDULE, scorecard: SC, labels: [covered.trigger.launchd[0], "com.seq.stray-job"], repoFiles: [{ repo: wf.trigger.repo, files: [{ file: wf.trigger.file }, { file: ".github/workflows/new-loop.yml" }] }] });
    expect(strays.map((s) => s.key)).toEqual(["launchd:com.seq.stray-job", `cron:${wf.trigger.repo}:.github/workflows/new-loop.yml`]);
    const sc = clone(SC); delete sc.exempt[Object.keys(sc.exempt)[0]!];
    expect(findStrays({ schedule: SCHEDULE, scorecard: sc }).length).toBe(1);
  });
});
