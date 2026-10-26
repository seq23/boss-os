import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dutiesDueToday, mergeOperations, nextRunFrom, parseOutboundMap, pauseControl, synopsis, failedRunItems,
  type MapRow, type OperationsLedgers, type OwnersFile,
} from "../src/shared/boss/operations";

/**
 * Team → Duties is the single operations view (owner, 12 Oct 2026). These pin the merge: map rows +
 * duty rows → one table with an owner per row, unassigned detection, the synopsis numbers, and a
 * hard failure on a map with no rows.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP = parseOutboundMap(readFileSync(path.join(ROOT, "docs/OUTBOUND_EMAIL_MAP.md"), "utf8"));
const OWNERS = JSON.parse(readFileSync(path.join(ROOT, "docs/outbound_email_owners.json"), "utf8")) as OwnersFile;
const ROSTER = ["Simone", "Camille", "Danielle", "Zora", "Monique", "Kendra", "Toni", "Imani"];
// Monday 12 Oct 2026, 15:00 UTC = 10:00 in Chicago.
const NOW = Date.UTC(2026, 9, 12, 15, 0);

const row = (over: Partial<MapRow>): MapRow => ({
  id: "x", business: "B", email: "E", from: "f@x", to: "t", transport: "Resend", trigger: "",
  runsWhere: "Mac launchd", footer: "None", code: "", pause: "", status: "CONFIRMED", note: "", ...over,
});

const LEDGERS: OperationsLedgers = {
  outreach: { sent: 12, failed: 1, test: 2, kill_switch: "off", sending: "live", paused_domains: 0, last: { status: "sent", at: NOW - 60_000 } },
  task_notices: { sent: 3, failed: 1, last: { status: "sent", at: NOW - 120_000 } },
  runs: { duty_failed_today: 2, cron_failed_today: 0 },
  named_stops: 4,
  local_jobs: [{ local_job: "repo-change.mjs", outcome: "failed", finished_at: NOW - 3_600_000, reason: "exit 1" }],
};

describe("the operations merge", () => {
  it("every map row becomes a row with an owner seat, and none is unassigned against the real roster", () => {
    const m = mergeOperations({ mapRows: MAP, owners: OWNERS, rosterNames: ROSTER, ledgers: LEDGERS, now: NOW });
    expect(m.rows.length).toBe(MAP.length);
    expect(m.rows.length).toBeGreaterThan(0);
    expect(m.unassigned.map((r) => r.id)).toEqual([]);
    expect(m.bySeat.get("Monique")?.map((r) => r.id)).toContain("monique-outreach");
    expect(m.bySeat.get("The client")?.map((r) => r.id).sort()).toEqual(["client-dashboards-mail", "client-publication-mail"]);
    expect([...m.bySeat.keys()].filter((k) => !ROSTER.includes(k))).toEqual(["The client"]);
    expect(m.bySeat.get("Danielle")?.find((r) => r.id === "repo-change")?.lastOutcome).toMatch(/^failed .* — exit 1$/);
    expect(m.bySeat.get("Monique")?.find((r) => r.id === "monique-outreach")?.lastOutcome).toMatch(/^sent .* · sending live$/);
  });

  it("a path with no owner entry, or a seat no longer on the roster, is unassigned and returned on its own", () => {
    const owners: OwnersFile = { outside: ["The client"], owners: { a: { seat: "Monique", why: "" }, b: { seat: "Retired Rita", why: "" } } };
    const m = mergeOperations({ mapRows: [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })], owners, rosterNames: ROSTER, ledgers: null, now: NOW });
    expect(m.unassigned.map((r) => r.id)).toEqual(["b", "c"]);
    expect(m.rows.find((r) => r.id === "a")?.ownerKind).toBe("seat");
    expect([...m.bySeat.keys()]).toEqual(["Monique"]);
  });

  it("hard-fails on a map with zero rows", () => {
    expect(() => mergeOperations({ mapRows: [], owners: OWNERS, rosterNames: ROSTER, ledgers: null, now: NOW })).toThrow(/no inventory rows/);
    expect(parseOutboundMap("# nothing here\n")).toEqual([]);
  });

  it("the synopsis counts what runs, what went out and what needs her", () => {
    const m = mergeOperations({ mapRows: [row({ id: "a", trigger: "launchd daily 07:45" }), row({ id: "b", runsWhere: "Cloudflare (inert)", pause: "Already off" }), row({ id: "c" })], owners: { outside: [], owners: { a: { seat: "Monique", why: "" }, b: { seat: "Kendra", why: "" } } }, rosterNames: ROSTER, ledgers: LEDGERS, now: NOW });
    const duties = [{ suspended: 0, next_due_at: NOW + 3_600_000 }, { suspended: 1, next_due_at: NOW }, { suspended: 0, next_due_at: NOW + 3 * 86_400_000 }];
    const s = synopsis({ rows: m.rows, unassigned: m.unassigned, dutiesToday: dutiesDueToday(duties, NOW), ledgers: LEDGERS });
    expect(s.counts).toEqual({ dutiesToday: 1, pathsScheduled: 1, pathsOff: 1, outreachSent: 12, outreachFailed: 1, noticesSent: 3, unassigned: 1, failedRuns: 4, namedStops: 4 });
    expect(s.running).toBe("Running today: 1 duties · 1 scheduled email paths · 1 off");
    expect(s.sent).toBe("Sent today: outreach 12 (1 failed) · task notices 3");
    expect(s.needs).toBe("Needs you: 1 unassigned · 4 failed runs · 4 named stops");
  });

  it("the failed-runs count opens one line per failure, what and why, never more lines than it counts (26 Oct 2026)", () => {
    const one: OperationsLedgers = {
      ...LEDGERS, outreach: { ...LEDGERS.outreach, failed: 0 }, task_notices: { ...LEDGERS.task_notices, failed: 0 },
      runs: { duty_failed_today: 1, cron_failed_today: 0 },
      failed_today: [{ kind: "duty", name: "Monique's Sunday mailbox sweep", reason: "NAMED STOP [SWEEP_DID_NOT_COMPLETE] no sentinel", at: NOW - 60_000, duty_id: "duty_mailbox_sweep", employee_id: "emp_relationship" }],
    };
    const s = synopsis({ rows: [], unassigned: [], dutiesToday: 0, ledgers: one });
    expect(s.needs).toBe("Needs you: 0 unassigned · 1 failed run · 4 named stops");
    expect(s.failed).toEqual([{ what: "\"Monique's Sunday mailbox sweep\"", why: "NAMED STOP [SWEEP_DID_NOT_COMPLETE] no sentinel", at: NOW - 60_000, employeeId: "emp_relationship" }]);
    // The fixture's 2 duty failures, 1 outreach and 1 notice with no detail rows still each get a line.
    const all = failedRunItems(LEDGERS);
    expect(all.map((f) => f.what)).toEqual(["2 more scheduled runs", "1 outreach email", "1 task notice"]);
  });
});

describe("next run and pause, read from the map's own words", () => {
  it("reads cron, weekday, monthly, UTC, interval and on-event triggers", () => {
    expect(nextRunFrom(row({ trigger: "boss-os Worker cron 0 * * * * (hourly)" }), NOW).at).toBe(Date.UTC(2026, 9, 12, 16, 0));
    expect(nextRunFrom(row({ trigger: "launchd com.seq.boss-capital-buyers Tue 07:00" }), NOW).at).toBe(Date.UTC(2026, 9, 13, 12, 0));
    expect(nextRunFrom(row({ trigger: "GitHub Actions loop-sun-digest.yml Sun 16:00 UTC" }), NOW).at).toBe(Date.UTC(2026, 9, 18, 16, 0));
    expect(nextRunFrom(row({ trigger: "launchd 1st of month 07:30" }), NOW).at).toBe(Date.UTC(2026, 10, 1, 13, 30)); // 1 Nov 2026: DST has ended, Chicago is UTC-6
    expect(nextRunFrom(row({ trigger: "Mon 13:00 and 14:00 UTC (08:00 Chicago)" }), NOW).at).toBe(Date.UTC(2026, 9, 19, 13, 0));
    expect(nextRunFrom(row({ trigger: "launchd every 5 min" }), NOW)).toEqual({ at: null, label: "every 5 min" });
    expect(nextRunFrom(row({ trigger: "Pages Function on form submit", runsWhere: "Cloudflare on event" }), NOW)).toEqual({ at: null, label: "on event" });
  });

  it("a pause control only where a real switch exists", () => {
    expect(pauseControl(row({ id: "monique-outreach" })).kind).toBe("action");
    expect(pauseControl(row({ pause: "launchctl bootout gui/501/com.seq.boss-people" }))).toEqual({ kind: "command", label: "switch", command: "launchctl bootout gui/501/com.seq.boss-people" });
    expect(pauseControl(row({ runsWhere: "Cloudflare (inert)", pause: "Already off" })).kind).toBe("off");
    expect(pauseControl(row({ pause: "Remove RESEND_API_KEY from the Worker" }))).toEqual({ kind: "none", label: "no switch" });
  });
});
