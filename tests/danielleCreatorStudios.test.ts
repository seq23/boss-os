/**
 * DANIELLE WORKS IN seq23/creator-studios ON A BARE NAME (owner, 22 Oct 2026).
 *
 * "give Danielle a real executor for repo work in seq23/creator-studios". Her lane already took the
 * repo by its GitHub address (R24); this pins that the bare name in an email is enough, that it is
 * recorded BESIDE the grid (never on it), that the executor record names her lane for it, and that
 * the migration seeds the same row the door would have written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRepoChange, REGISTERED_REPOS, registeredByNameIn, gridRepoNames } from "../src/shared/boss/repoChange/lane.mjs";
import { SEAT_EXECUTORS, checkAssignment } from "../src/shared/boss/duties/executors.mjs";

describe("creator-studios is Danielle's, beside the grid", () => {
  it("is registered (hard fail on an empty register)", () => {
    expect(REGISTERED_REPOS.length).toBeGreaterThan(0);
    expect(REGISTERED_REPOS.map((r) => r.github_repo)).toContain("seq23/creator-studios");
  });

  it("is not added to the grid", () => {
    expect(gridRepoNames()).not.toContain("creator-studios");
  });

  it("a bare name in her email opens a repo change with the GitHub address", () => {
    const c = parseRepoChange("#danielle creator-studios: change the sign-up page headline to 'Your studio, ready'");
    expect(c && !("excluded" in c) ? { repo: c.repo, github_repo: c.github_repo, registered: c.registered } : c)
      .toEqual({ repo: "creator-studios", github_repo: "seq23/creator-studios", registered: true });
  });

  it("does not read a neighbour by prefix or a word inside another name", () => {
    expect(registeredByNameIn("creator-studios-v2 notes")).toBeNull();
    expect(registeredByNameIn("my-creator-studios fork")).toBeNull();
    expect(registeredByNameIn("work on creator-network")).toBeNull();
  });

  it("the address form still works, and the exclusions still win", () => {
    const c = parseRepoChange("please fix github.com/seq23/creator-studios footer");
    expect(c && !("excluded" in c) ? c.github_repo : null).toBe("seq23/creator-studios");
    expect(parseRepoChange("west-peek-os creator-studios both")).not.toBeNull();
  });

  it("the executor record names her lane, with a command", () => {
    expect(SEAT_EXECUTORS.emp_repo?.repo_change).toMatch(/npm run repo-change/);
    expect(checkAssignment({ helper: "emp_repo", what: "creator-studios: change the sign-up copy", requires: "repo_change" }).ok).toBe(true);
  });

  it("migration 0288 seeds the same registry row the door writes", () => {
    const sql = readFileSync(join(__dirname, "..", "migrations", "0288_boss_creator_studios_research_pages_and_new_duties.sql"), "utf8");
    expect(sql).toMatch(/INSERT OR IGNORE INTO boss_repo_registry \(name, github_repo, mail_id, registered_at\)\s+VALUES \('creator-studios', 'seq23\/creator-studios'/);
  });
});
