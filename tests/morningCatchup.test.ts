/**
 * THE MORNING CATCH-UP (repair rc_m6gtk44dhfjq6rvj, 3 Nov 2026): a Mac reboot killed com.seq.boss-capital
 * inside ledger-hunt on 3 Nov, so capital:grid never ran and "deals"/"monique_found" missed Simone's
 * 06:40 email — nothing re-ran it. scripts/ops/morning-catchup.mjs now runs at 06:32, re-running
 * whatever the registry still expects that is SAFE to re-run (sends nothing), or naming a stop.
 *
 * Proven here: every expected section carries exactly one of `catchUp` / `catchUpWhy`; a `catchUp`
 * command's own script never sends (the same SENDING_PATTERNS the Email Map uses); the plan dedupes
 * shared producers in registry order; and both named stops fire.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MORNING_SECTION_SPECS, catchUpPlan } from "../src/shared/boss/mail/morningSections.mjs";
import { sends } from "../scripts/ops/lib/email-map.mjs";
import { attemptedNames, catchUpBudget, catchUpOutcome, catchUpWindow, weekdayIn, expectedSections, windowWords } from "../scripts/ops/morning-catchup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const EXPECTED = MORNING_SECTION_SPECS.filter((s) => s.expect);

/** The .mjs file an `npm run` command (as stored in `catchUp`) really runs — the last "node <file>" in its script, after any vault wrapper. */
function scriptFileFor(command: string) {
  const name = (command.split(" --")[0] ?? command).trim();
  const raw = PKG.scripts[name];
  expect(raw, `package.json has no script "${name}"`).toBeTruthy();
  const hits = [...raw.matchAll(/node\s+(scripts\/\S+\.mjs)/g)].map((m) => m[1]);
  expect(hits.length, `"${name}" names no .mjs file`).toBeGreaterThan(0);
  return hits[hits.length - 1];
}

describe("the morning catch-up registry", () => {
  it("every expected section carries exactly one of catchUp or catchUpWhy", () => {
    expect(EXPECTED.length).toBeGreaterThan(5);
    for (const s of EXPECTED) {
      const has = [s.catchUp, s.catchUpWhy].filter((x) => typeof x === "string" && x.trim());
      expect(has.length, `${s.name}: expected exactly one of catchUp/catchUpWhy, got ${JSON.stringify({ catchUp: s.catchUp, catchUpWhy: s.catchUpWhy })}`).toBe(1);
    }
  });

  it("a catchUp command's own script never sends — never re-run a sender blind", () => {
    const withCatchUp = EXPECTED.filter((s) => s.catchUp);
    expect(withCatchUp.length).toBeGreaterThan(0);
    for (const s of withCatchUp) {
      const file = scriptFileFor(s.catchUp!);
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(sends(source), `${s.name}: ${file} (via "${s.catchUp}") can send — must not carry a catchUp`).toBe(false);
    }
  });

  it("every catchUpWhy is a real sentence, not a placeholder", () => {
    for (const s of EXPECTED.filter((x) => x.catchUpWhy)) expect(s.catchUpWhy!.length).toBeGreaterThan(10);
  });
});

describe("catchUpPlan", () => {
  it("dedupes a shared producer (deals and monique_found both run capital:grid) in registry order", () => {
    const plan = catchUpPlan([{ name: "monique_found", label: "Monique's matches" }, { name: "deals", label: "New deals" }]);
    expect(plan.commands).toEqual(["capital:grid -- --keep-seen"]); // registry order: deals before monique_found, but one command
    expect(plan.cannotCatchUp).toEqual([]);
  });

  it("runs distinct producers in registry order even when missing sections arrive reversed", () => {
    expect(catchUpPlan([{ name: "scorecard", label: "Scorecard" }, { name: "archive", label: "Archive" }, { name: "deals", label: "Deals" }]).commands)
      .toEqual(["capital:grid -- --keep-seen", "archive:audit", "scorecard:monday"]);
  });

  it("names every section with no catchUp, and why", () => {
    const plan = catchUpPlan([{ name: "lp", label: "LP updates" }, { name: "deals", label: "New deals" }]);
    expect(plan.commands).toEqual(["capital:grid -- --keep-seen"]);
    expect(plan.cannotCatchUp).toEqual([{ name: "lp", label: "LP updates", why: expect.stringContaining("LP") }]);
  });

  it("an unknown section name still gets a plain reason, never a crash", () => {
    const plan = catchUpPlan([{ name: "not_a_real_section", label: "Mystery" }]);
    expect(plan.commands).toEqual([]);
    expect(plan.cannotCatchUp).toEqual([{ name: "not_a_real_section", label: "Mystery", why: "no catch-up is defined for this section" }]);
  });

  it("empty missing is an empty plan", () => {
    expect(catchUpPlan([])).toEqual({ commands: [], cannotCatchUp: [] });
    expect(catchUpPlan(undefined)).toEqual({ commands: [], cannotCatchUp: [] });
  });
});

describe("weekdayIn", () => {
  it("names a stop when no expected section was checked", () => {
    expect(() => expectedSections("Tuesday", [])).toThrow("MORNING_CATCHUP_NOTHING_CHECKED");
    expect(expectedSections("Tuesday")).toBeGreaterThan(0);
  });
  it("reads the weekday MORNING_SECTION_SPECS' expect arrays use, in her zone", () => {
    expect(weekdayIn("America/Chicago", Date.parse("2026-11-03T12:00:00Z"))).toBe("Tuesday"); // 06:00 Central
    expect(weekdayIn("America/Chicago", Date.parse("2026-11-02T04:00:00Z"))).toBe("Sunday"); // late Sat UTC, still Sat/Sun split at Central midnight
  });
});

describe("catchUpOutcome — the named stop", () => {
  const plan = catchUpPlan([{ name: "deals", label: "New deals" }, { name: "lp", label: "LP updates" }]);

  it("every attempted section reported in after the run: no stop", () => {
    const outcome = catchUpOutcome({ missingBefore: [{ name: "deals", label: "New deals" }, { name: "lp", label: "LP updates" }], missingAfter: [{ name: "lp", label: "LP updates" }], plan });
    expect(outcome.stop).toBeNull();
    expect(outcome.reRun).toBe(1); // only "deals" had a catchUp
    expect(outcome.stillMissing).toBe(1); // "lp" never had one; its own repair path still opens
  });

  it("NAMED STOP [MORNING_CATCHUP_STILL_MISSING]: a section with a catchUp ran again and is still missing", () => {
    const outcome = catchUpOutcome({ missingBefore: [{ name: "deals", label: "New deals" }, { name: "lp", label: "LP updates" }], missingAfter: [{ name: "deals", label: "New deals" }, { name: "lp", label: "LP updates" }], plan });
    expect(outcome.stop).toBe("MORNING_CATCHUP_STILL_MISSING");
    expect(outcome.names).toEqual(["deals"]); // never "lp" — it was never attempted
  });

  it("attemptedNames names only sections the plan actually ran", () => {
    expect(attemptedNames([{ name: "deals", label: "New deals" }, { name: "lp", label: "LP updates" }], plan)).toEqual(["deals"]);
  });
});

/**
 * 9 Nov 2026 (repair rc_m708yvvt99yvy416): the Mac was off through 05:30-06:40 (booted 07:36 Central);
 * launchd never replays a slot missed across a shutdown, so the 06:32 catch-up never ran and "deals"
 * missed the email. The catch-up now also runs when the Mac comes up.
 */
describe("the catch-up runs when the Mac comes up", () => {
  const OPS = path.join(ROOT, "scripts/ops");
  const writers = readdirSync(OPS).filter((f) => /^install-.*\.sh$/.test(f)).map((f) => ({ f, t: readFileSync(path.join(OPS, f), "utf8") }))
    .filter(({ t }) => /com\.seq\.boss-morning-catchup/.test(t) && /<plist/.test(t) && /morning:catchup/.test(t));
  /** The plist heredoc that runs morning:catchup, from `<plist` to `</plist>`. */
  const stanza = (t: string) => /<plist[^>]*>(?:(?!<\/plist>)[\s\S])*?morning:catchup[\s\S]*?<\/plist>/.exec(t)?.[0] ?? "";
  const runsAtLoad = (t: string) => /<key>RunAtLoad<\/key>\s*<true\/>/.test(stanza(t));

  it("every installer that writes com.seq.boss-morning-catchup sets RunAtLoad true", () => {
    expect(writers.length).toBeGreaterThan(0); // Rule 0: a guard that found no installer proves nothing
    for (const { f, t } of writers) expect(runsAtLoad(t), f).toBe(true);
  });

  it("NEGATIVE: the stanza with RunAtLoad false, or none, fails", () => {
    const t = writers[0]?.t ?? "";
    expect(runsAtLoad(t)).toBe(true);
    expect(runsAtLoad(t.replace(/<key>RunAtLoad<\/key>\s*<true\/>/, "<key>RunAtLoad</key><false/>"))).toBe(false);
    expect(runsAtLoad(t.replace(/\s*<key>RunAtLoad<\/key>\s*<true\/>/, ""))).toBe(false);
  });

  it("the main installer calls the catch-up's own installer", () => {
    const main = readFileSync(path.join(OPS, "install-agent-launchd.sh"), "utf8");
    expect(main).toMatch(/^BOSS_OS_REPO="\$REPO" bash "\$REPO\/scripts\/ops\/install-morning-catchup\.sh"$/m);
  });

  it("says whether it ran before or after the 06:40 Central email, in either of her zones", () => {
    // Central (CST, UTC-6 in November)
    expect(catchUpWindow(Date.parse("2026-11-09T12:32:00Z"), "America/Chicago")).toBe("before_email"); // 06:32 CT
    expect(catchUpWindow(Date.parse("2026-11-09T12:39:00Z"), "America/Chicago")).toBe("before_email"); // 06:39 CT
    expect(catchUpWindow(Date.parse("2026-11-09T12:40:00Z"), "America/Chicago")).toBe("after_email"); // 06:40 CT
    expect(catchUpWindow(Date.parse("2026-11-09T13:36:00Z"), "America/Chicago")).toBe("after_email"); // 07:36 CT, 9 Nov boot
    expect(catchUpWindow(Date.parse("2026-11-09T10:00:00Z"), "America/Chicago")).toBe("before_email"); // 04:00 CT boot
    expect(catchUpWindow(Date.parse("2026-11-09T05:00:00Z"), "America/Chicago")).toBe("after_email"); // 23:00 CT on 8 Nov: that day's email went
  });

  it("reads Central whatever zone the Mac is in, and words the after-email run honestly", () => {
    // 07:36 Eastern is 06:36 Central: still before the email.
    expect(catchUpWindow(Date.parse("2026-11-09T12:36:00Z"))).toBe("before_email");
    // 07:45 Eastern is 06:45 Central: after.
    expect(catchUpWindow(Date.parse("2026-11-09T12:45:00Z"))).toBe("after_email");
    expect(windowWords("after_email")).toMatch(/tomorrow/);
    expect(windowWords("before_email")).not.toMatch(/tomorrow/);
  });
});

/**
 * 9 Nov 2026 (repair rc_m708yx6am3k3arpe): the Mac was off at 06:00, so the Monday sites:audit never ran
 * and "grid_repos" stayed missing. The boot catch-up (07:36) still refused it: "runs longer than the
 * window before the email" — a deadline already past. A long producer now runs after the email only.
 */
describe("a long producer is caught up after the email, never before it", () => {
  const GRID = [{ name: "grid_repos", label: "the grid repos' search check" }];
  const bootAt = Date.parse("2026-11-09T13:36:00Z"); // Monday 07:36 Central, the real boot

  it("grid_repos carries the same command its Monday launchd job runs, marked long", () => {
    const spec = MORNING_SECTION_SPECS.find((s) => s.name === "grid_repos")!;
    expect(spec.catchUp).toBe("sites:audit -- --morning");
    expect(spec.catchUpLongWhy!.length).toBeGreaterThan(10);
    const installer = readFileSync(path.join(ROOT, "scripts/ops/install-agent-launchd.sh"), "utf8");
    expect(installer).toContain(`npm run --silent ${spec.catchUp}</string>`);
  });

  it("only a section with a catchUp may be marked long", () => {
    for (const s of MORNING_SECTION_SPECS.filter((x) => x.catchUpLongWhy)) expect(s.catchUp, s.name).toBeTruthy();
  });

  it("before the email: named with its reason, no command (the email is never raced)", () => {
    const plan = catchUpPlan(GRID);
    expect(plan.commands).toEqual([]);
    expect(plan.cannotCatchUp).toEqual([{ ...GRID[0], why: expect.stringContaining("runs long") }]);
    expect(catchUpPlan(GRID, { long: false })).toEqual(plan);
  });

  it("after the email: it runs, alongside the short ones, in registry order", () => {
    expect(catchUpPlan(GRID, { long: true })).toEqual({ commands: ["sites:audit -- --morning"], cannotCatchUp: [] });
    expect(catchUpPlan([...GRID, { name: "deals", label: "New deals" }], { long: true }).commands)
      .toEqual(["capital:grid -- --keep-seen", "sites:audit -- --morning"]);
  });

  it("the window decides: 06:32 → short budget, not long; the 07:36 boot → long, with room for the audit", () => {
    const early = catchUpBudget(catchUpWindow(Date.parse("2026-11-09T12:32:00Z")));
    expect(early).toEqual({ long: false, budgetMs: 8 * 60_000 });
    const boot = catchUpBudget(catchUpWindow(bootAt));
    expect(boot.long).toBe(true);
    expect(boot.budgetMs).toBeGreaterThan(7 * 60_000 * 2); // the 2 Nov audit took 7 minutes
    expect(boot.budgetMs).toBeLessThanOrEqual(60 * 60_000); // a boot run never hangs
    expect(catchUpPlan(GRID, { long: boot.long }).commands).toEqual(["sites:audit -- --morning"]);
  });

  it("an unknown window takes the cautious budget", () => {
    expect(catchUpBudget("whatever")).toEqual({ long: false, budgetMs: 8 * 60_000 });
  });

  it("a long run still names its stop when the section did not come back", () => {
    const plan = catchUpPlan(GRID, { long: true });
    expect(catchUpOutcome({ missingBefore: GRID, missingAfter: GRID, plan })).toMatchObject({ stop: "MORNING_CATCHUP_STILL_MISSING", names: ["grid_repos"] });
  });
});
