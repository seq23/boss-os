/**
 * ZORA'S AND TONI'S NEW STANDING DUTIES (owner, 22 Oct 2026).
 *
 * Each duty has an executor (a local job the installer wraps in duty-run.sh), Toni's stay out of her
 * trading lane, and the pure judgements behind "quiet unless something moves" and "a source it cannot
 * read is named, never faked" hold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLED_LOCAL_JOBS } from "../src/shared/boss/duties/lane.mjs";
import { movedReadings, readNothingStop, stateMap } from "../scripts/ops/lib/duty-kit.mjs";
import { hasDkim, openrouterReading, rdapExpiry, renewalReading, senderPauseReason } from "../scripts/ops/risk-watch.mjs";
import { lockReading } from "../scripts/ops/outside-locks.mjs";
import { citedBossFiles, dateIn, handoffTodayDate, kindOf, NOT_OURS_RE } from "../scripts/ops/archive-audit.mjs";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const MIG = read("migrations/0288_boss_creator_studios_research_pages_and_new_duties.sql");
const INSTALLER = read("scripts/ops/install-agent-launchd.sh");

const DUTIES = [
  { id: "duty_archive_audit", seat: "emp_knowledge", job: "archive-audit.mjs", npm: "archive:audit" },
  { id: "duty_risk_watch", seat: "emp_risk", job: "risk-watch.mjs", npm: "risk:watch" },
  { id: "duty_outside_locks", seat: "emp_risk", job: "outside-locks.mjs", npm: "risk:locks" },
];

describe("every new duty has an executor (rule 0)", () => {
  for (const d of DUTIES) {
    it(`${d.id}: row, script, installer, npm`, () => {
      const at = MIG.indexOf(`('${d.id}'`);
      expect(at).toBeGreaterThan(-1);
      const row = MIG.slice(at, MIG.indexOf("\n   0)", at));
      expect(row).toContain(`'${d.seat}', 'ops'`);
      expect(row).toContain("'local_job'");
      expect(row).toContain(`'local_job', '${d.job}'`);
      expect(INSTALLED_LOCAL_JOBS).toContain(d.job);
      expect(INSTALLER).toContain(`duty-run.sh ${d.job} -- npm run --silent ${d.npm}`);
      expect(JSON.parse(read("package.json")).scripts[d.npm]).toContain(`scripts/ops/${d.job}`);
    });
  }
  it("Toni's trading lane is untouched: both her duties are ops-lane local jobs", () => {
    const toni = DUTIES.filter((d) => d.seat === "emp_risk");
    expect(toni.length).toBe(2);
    expect(MIG).not.toMatch(/'emp_risk', 'trading'/);
    expect(MIG).not.toMatch(/trading_authority\s+SET|UPDATE employees/);
  });
});

describe("quiet unless something moves", () => {
  it("a first-day ok is not news; a new alert, a stop and a cleared alert are", () => {
    const r = [{ key: "a", state: "ok", line: "" }, { key: "b", state: "alert", line: "" }, { key: "c", state: "stop", line: "" }];
    expect(movedReadings(r, {}).map((m) => m.key)).toEqual(["b", "c"]);
    expect(movedReadings(r, stateMap(r))).toEqual([]);
    expect(movedReadings([{ key: "b", state: "ok", line: "" }], { b: "alert" }).map((m) => m.state)).toEqual(["ok"]);
    expect(movedReadings([], { gone: "alert", note: "notice" }).map((m) => m.key)).toEqual(["gone"]);
  });
  it("every source unreadable is a named stop, not a quiet day", () => {
    expect(readNothingStop([{ key: "x", state: "stop", line: "" }], "X")).toMatch(/^NAMED STOP \[X\]/);
    expect(readNothingStop([], "X")).toMatch(/NAMED STOP/);
    expect(readNothingStop([{ key: "x", state: "ok", line: "" }], "X")).toBeNull();
  });
});

describe("Toni's judgements", () => {
  it("OpenRouter: below $0 and any new spend alert", () => {
    expect(openrouterReading({ total_credits: 10, total_usage: 10.5 }, 10.5).state).toBe("alert");
    expect(openrouterReading({ total_credits: 10, total_usage: 2.01 }, 2).state).toBe("alert");
    expect(openrouterReading({ total_credits: 10, total_usage: 2 }, 2).state).toBe("ok");
    expect(openrouterReading({}, 0).state).toBe("stop");
  });
  it("renewals inside 30 days alert, with the date", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    const exp = rdapExpiry({ events: [{ eventAction: "expiration", eventDate: "2026-11-10T00:00:00Z" }] });
    expect(renewalReading("x.com", exp, now)).toMatchObject({ state: "alert" });
    expect(renewalReading("x.com", Date.parse("2027-06-01T00:00:00Z"), now).state).toBe("ok");
    expect(renewalReading("x.com", null, now).state).toBe("stop");
  });
  it("a sender over complaint, bounce or unsubscribe thresholds is paused", () => {
    expect(senderPauseReason({ health_14d: { sent: 50, bounced: 0, complaints: 1 } })).toMatch(/complaint/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 4, complaints: 0 } })).toMatch(/bounce rate 4\.0%/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 0, complaints: 0 }, replies: { unsubscribe: 3 } })).toMatch(/unsubscribe rate 3\.0%/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 3, complaints: 0 }, replies: { unsubscribe: 2 } })).toBeNull();
  });
  it("DKIM: an empty p= is not a key", () => {
    expect(hasDkim(['"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"'])).toBe(true);
    expect(hasDkim(['"v=DKIM1; k=rsa; p="'])).toBe(false);
    expect(hasDkim([])).toBe(false);
  });
  it("a lock is a lock-sender with lock words; anything else is not", () => {
    expect(lockReading({ from: "LinkedIn <security@linkedin.com>", subject: "Your account has been restricted", date: "2026-10-20" }, "spry.vc")?.state).toBe("alert");
    expect(lockReading({ from_domain: "kdp.amazon.com", subject: "Your book is under review", date: "2026-10-20" }, "personal Gmail")).not.toBeNull();
    expect(lockReading({ from: "x@linkedin.com", subject: "You appeared in 9 searches" }, "spry.vc")).toBeNull();
    expect(lockReading({ from: "x@randomshop.com", subject: "Account suspended" }, "spry.vc")).toBeNull();
  });
});

describe("Zora's judgements", () => {
  it("reads the dates the documents use", () => {
    expect(dateIn("Last verified 12 Oct 2026.")).toBe(Date.UTC(2026, 9, 12));
    expect(dateIn("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
    expect(dateIn("October 3, 2026")).toBe(Date.UTC(2026, 9, 3));
    expect(dateIn("no date")).toBeNull();
    expect(handoffTodayDate("# PINNED\n...\n## Today — 21 Oct 2026\n- x")).toBe(Date.UTC(2026, 9, 21));
  });
  it("finds the boss-os files the email map cites (hard fail on zero)", () => {
    const files = citedBossFiles(read("docs/OUTBOUND_EMAIL_MAP.md"));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("scripts/ops/notify.mjs");
  });
  it("files Boss OS pieces and leaves the fund's to the fund", () => {
    expect(kindOf("Guide Homepage Preview")).toBe("mockup");
    expect(kindOf("The Learning Club Playbook")).toBe("playbook");
    expect(NOT_OURS_RE.test("West Peek OS — Deals section")).toBe(true);
    expect(NOT_OURS_RE.test("Porch & Party Rentals Mock")).toBe(false);
  });
});
