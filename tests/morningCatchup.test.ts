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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MORNING_SECTION_SPECS, catchUpPlan } from "../src/shared/boss/mail/morningSections.mjs";
import { sends } from "../scripts/ops/lib/email-map.mjs";
import { attemptedNames, catchUpOutcome, weekdayIn, expectedSections } from "../scripts/ops/morning-catchup.mjs";

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
