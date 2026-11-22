/**
 * THE GROWTH PLAYBOOK: one source (src/shared/boss/growth/playbook.mjs), one generated copy (the
 * growth-director skill), and the Sunday cohesion check regenerates a copy that drifted.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYBOOK, playbookBody } from "../src/shared/boss/growth/playbook.mjs";
import { compare, writeSkill } from "../scripts/ops/growth-playbook.mjs";

describe("the growth playbook", () => {
  it("is a skill file (front matter with its name) and the Director reads it without the front matter", () => {
    expect(PLAYBOOK).toMatch(/^---\nname: growth-director\ndescription: .+\n---\n/);
    expect(playbookBody()).not.toMatch(/^---/);
    expect(playbookBody().length).toBeGreaterThan(1000);
  });
  it("the copy is missing, then the same, then a hand edit is caught", () => {
    const f = join(mkdtempSync(join(tmpdir(), "pb-")), "growth-director", "SKILL.md");
    expect(compare(f)).toBe("missing");
    writeSkill(f);
    expect(compare(f)).toBe("same");
    expect(readFileSync(f, "utf8")).toBe(PLAYBOOK);
    writeFileSync(f, PLAYBOOK + "\nan edit made only in the copy\n");
    expect(compare(f)).toBe("differs");
  });
  it("the cohesion check regenerates a drifted copy (and only reports on a dry run)", async () => {
    const { runChecks } = await import("../scripts/brains/cohesion-check.mjs");
    const home = mkdtempSync(join(tmpdir(), "home-"));
    const f = join(home, ".claude", "skills", "growth-director", "SKILL.md");
    mkdirSync(join(home, ".claude", "skills", "growth-director"), { recursive: true });
    writeFileSync(f, "old words");
    const stub = { validators: () => null, social: async () => null, maps: () => ({ maps_flag: null, unchecked: [] }), restart: () => {}, wait: async () => {} };
    const dry = await runChecks({ home, dryRun: true, ...stub } as any);
    expect(dry.playbook).toBe("differs");
    expect(readFileSync(f, "utf8")).toBe("old words");
    const real = await runChecks({ home, dryRun: false, ...stub } as any);
    expect(real.playbook).toBe("differs, regenerated");
    expect(readFileSync(f, "utf8")).toBe(PLAYBOOK);
  });
});
