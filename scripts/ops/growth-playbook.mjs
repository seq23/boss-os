#!/usr/bin/env node
/**
 * The growth playbook's one copy outside this repo: ~/.claude/skills/growth-director/SKILL.md,
 * generated from src/shared/boss/growth/playbook.mjs (the one source).
 *
 *   npm run growth:playbook              write the skill file
 *   npm run growth:playbook -- --check   exit 1 when the skill file differs (the Sunday cohesion check runs this)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYBOOK } from "../../src/shared/boss/growth/playbook.mjs";

export const SKILL_FILE = join(homedir(), ".claude", "skills", "growth-director", "SKILL.md");

/** "same" | "differs" | "missing" */
export function compare(file = SKILL_FILE, text = PLAYBOOK) {
  if (!existsSync(file)) return "missing";
  return readFileSync(file, "utf8") === text ? "same" : "differs";
}

/** Write the skill file from the one source. */
export function writeSkill(file = SKILL_FILE, text = PLAYBOOK) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const r = compare();
    console.log(`growth playbook skill: ${r}`);
    process.exit(r === "same" ? 0 : 1);
  }
  writeSkill();
  console.log(`wrote ${SKILL_FILE}`);
  console.log("OUTPUT 1 growth playbook skill");
}
