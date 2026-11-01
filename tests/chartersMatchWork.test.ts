/**
 * CHARTERS MATCH THE WORK (owner, 31 Oct 2026: Danielle's and Monique's job descriptions contradicted
 * what they actually do). The charter is a queue run's system prompt and the Team screen's job
 * description, so a charter that forbids the seat's own duties is a defect, not a wording nit.
 *
 * Reads the migrations themselves: the newest charter each seat is given must name its real work and
 * must not forbid it. A later migration that rewrites a charter is held to the same facts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TRIAGE_SEATS, seatForAsk } from "../src/shared/boss/intake/triage.mjs";

const DIR = join(__dirname, "..", "migrations");
const CHARTER = /UPDATE employees SET charter =\s*'((?:[^']|'')*)'\s*WHERE id = '(\w+)';/g;

/** The newest charter per seat, in migration order. */
export function latestCharters(files: { name: string; sql: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const m of f.sql.matchAll(CHARTER)) out[m[2]!] = m[1]!.replace(/''/g, "'");
  }
  return out;
}

const files = readdirSync(DIR).filter((n) => n.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") }));
const charters = latestCharters(files);

/** What each seat really does (live duties and Mac jobs, 31 Oct 2026), and what it must never be told it may not do. */
const FACTS: Record<string, { says: RegExp[]; never: RegExp[] }> = {
  emp_repo: { says: [/land/i, /Ahrefs/, /Search Readiness/], never: [/do not commit/i, /not .*merge/i, /not .*deploy/i] },
  emp_relationship: { says: [/capital/i, /\bLP\b/, /institutional sales/i, /Time-2-Read groups/, /outreach/i], never: [/never send anything outward/i] },
  emp_research: { says: [/Executive Intelligence Report/, /Marketplace listings/, /offices/] , never: [] },
  emp_chief: { says: [/front door/i, /morning email/i, /errands/i], never: [] },
  emp_knowledge: { says: [/Scooter's LP tracker/, /unowned/, /archive/i], never: [/^Turn conversation into candidate memory/] },
  emp_risk: { says: [/trading lane/, /logins/, /locks/], never: [] },
  emp_continuity: { says: [/property is up/, /disk/, /tools/], never: [] },
};

describe("every charter matches the seat's real work", () => {
  it("finds a charter for every seat with work (Rule 0: zero charters is a failure)", () => {
    expect(Object.keys(charters).length).toBeGreaterThanOrEqual(Object.keys(FACTS).length);
  });

  for (const [id, f] of Object.entries(FACTS)) {
    it(`${id} names its work and forbids none of it`, () => {
      const c = charters[id];
      expect(c, `${id} has no charter in any migration`).toBeTruthy();
      for (const re of f.says) expect(c).toMatch(re);
      for (const re of f.never) expect(c).not.toMatch(re);
    });
  }

  it("negative proof: the 0155 seed charters fail these facts", () => {
    const seedOnly = latestCharters(files.filter((x) => x.name < "0325"));
    // The seed set charters by INSERT, so the pre-0325 UPDATE set lacks the seats entirely: the
    // facts cannot be met without 0325.
    const met = Object.entries(FACTS).every(([id, f]) => seedOnly[id] && f.says.every((re) => re.test(seedOnly[id]!)));
    expect(met).toBe(false);
    const stale = "Prepare repository work as artifacts and scoped changes. You do not commit, merge, or deploy.";
    expect(FACTS.emp_repo!.never.some((re) => re.test(stale))).toBe(true);
    expect(FACTS.emp_relationship!.never.some((re) => re.test("Track who matters. Never send anything outward."))).toBe(true);
  });
});

describe("Simone's triage sends the real work to the right seat", () => {
  const roster = TRIAGE_SEATS.map((s, i) => ({ id: s.id, name: `Seat${i}`, role: i === 3 ? "Chief of Staff" : "Seat" }));
  const seatFor = (text: string) => (seatForAsk(text, roster) as any).seat.id;
  it("Time-2-Read groups and LP work go to Monique; Marketplace listings to Camille; Ahrefs flags to Danielle", () => {
    expect(seatFor("Find more homeschool co-ops for Time-2-Read")).toBe("emp_relationship");
    expect(seatFor("Which LPs have not replied this month")).toBe("emp_relationship");
    expect(seatFor("Renew the Porch & Party Marketplace listings")).toBe("emp_research");
    expect(seatFor("Fix the Ahrefs flags on the guides")).toBe("emp_repo");
  });
});
