#!/usr/bin/env node
/**
 * NOELLE'S GUARD (24 Nov 2026; shrunk the same day by the sandbox redesign). A Claude Code PreToolUse hook on
 * every tool of HER run only (~/.boss-os/noelle/settings.json, written by scripts/ops/lib/noelle-sandbox.sh from
 * scripts/ops/noelle-permissions.json). Paid APIs, money, secrets, other repos and protected files are NOT judged
 * here: her run's OS sandbox takes that access away (no such host, no such file, no such write), and her GitHub
 * token reaches only her repos. This guard holds only what can be judged by name, each a NAMED STOP she reads:
 *
 *   AGENT             any agent but ONE fresh `reviewer` per PR she opened this run
 *   PR_CAP            a 4th `gh pr create` in one run
 *   CONTEXT_HANDOFF   after her context was compacted (~200K), anything but reading and writing her handoff/notes
 *   DEPLOY_ONLY_LAND  `gh pr merge` or a `git push` naming main/master: merges go only through her land-after broker
 *
 * Its state lives in ~/.boss-os/noelle/guard (NOELLE_GUARD_DIR), which her sandbox cannot write. Exit 2 with the
 * reason on stderr refuses the call. Input it cannot parse is REFUSED (fail closed). `--self-test` proves every
 * stop. `--precompact` is her PreCompact hook: it marks the run compacted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOME = homedir();
export const NOELLE_HOME = () => process.env.NOELLE_HOME ?? join(HOME, "Work", "noelle");
export const GUARD_DIR = () => process.env.NOELLE_GUARD_DIR ?? join(HOME, ".boss-os", "noelle", "guard");

/** Her businesses' repos (Full and search-watch; brief 24 Nov 2026): her token's repos and land-after's list. */
export const HER_REPOS = Object.freeze([
  "p-n-p", "approvalprep", "aplayer-mode", "sprylabs-hpc-site", "peace-be-still", "creator-studios",
  "dream-wedding-builder", "keepmyproof", "search-loop",
  "local-guides-generator", "WPP-llm", "hicks-consulting-canonical", "horse-legal-guide-velocity",
]);
export const MAX_PRS = 3;

const MERGE = /\bgh\s+pr\s+merge\b|\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(?<![\w-])(main|master)(?![\w-])/;

function state(g) {
  try { return JSON.parse(readFileSync(join(g, "run.json"), "utf8")); } catch { return { prs: 0, reviewers: 0 }; }
}
function saveState(s, g) {
  mkdirSync(g, { recursive: true });
  writeFileSync(join(g, "run.json"), JSON.stringify(s));
}

/** The verdict on one tool call: null (let through) or { stop, why }. `mutate` = false for a dry check. */
export function judge(input, { h = NOELLE_HOME(), g = GUARD_DIR(), mutate = true } = {}) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  const cwd = String(input?.cwd ?? h);
  if (!tool) return { stop: "GUARD_UNREAD", why: "the hook input named no tool" };
  const st = state(g);

  if (existsSync(join(g, "compacted"))) {
    const a = typeof ti.file_path === "string" ? resolve(cwd, ti.file_path.replace(/^~(?=\/)/, HOME)) : "";
    const ok = a === join(h, "HANDOFF.md") || a.startsWith(join(h, "notes") + "/") || a.startsWith(join(h, "tasks") + "/");
    if (["Read", "Grep", "Glob"].includes(tool)) return null;
    if (["Write", "Edit"].includes(tool) && ok) return null;
    return { stop: "CONTEXT_HANDOFF", why: "your context reached ~200K: write ~/Work/noelle/HANDOFF.md and today's note, then end with your OUTPUT line; the next run carries on" };
  }

  if (tool === "Agent" || tool === "Task") {
    if (ti.subagent_type !== "reviewer") return { stop: "AGENT", why: `only a fresh "reviewer" agent, one per PR you opened this run (asked for "${ti.subagent_type ?? "general-purpose"}")` };
    if ((st.reviewers ?? 0) >= (st.prs ?? 0)) return { stop: "AGENT", why: `one reviewer per PR: ${st.prs ?? 0} PR(s) opened this run, ${st.reviewers ?? 0} reviewer(s) already launched` };
    if (mutate) saveState({ ...st, reviewers: (st.reviewers ?? 0) + 1 }, g);
    return null;
  }
  if (tool !== "Bash") return null;

  const cmd = String(ti.command ?? "");
  if (!cmd.trim()) return { stop: "GUARD_UNREAD", why: "an empty command" };
  if (MERGE.test(cmd)) return { stop: "DEPLOY_ONLY_LAND", why: "merges and deploys go only through ~/.boss-os/noelle/bin/land-after <pr> --task noelle-<job> --repo seq23/<repo>" };
  if (/\bgh\s+pr\s+create\b/.test(cmd)) {
    if ((st.prs ?? 0) >= MAX_PRS) return { stop: "PR_CAP", why: `${MAX_PRS} PRs is the most in one run; write the rest into your handoff` };
    if (mutate) saveState({ ...st, prs: (st.prs ?? 0) + 1 }, g);
  }
  return null;
}

export const CASES = [
  // [tool_name, tool_input, expected stop or null]
  ["Bash", { command: "git status --short" }, null],
  ["Bash", { command: "gh pr merge 12 --squash" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "git push origin HEAD:main" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "git -C ~/Work/noelle/wt/pbs push origin HEAD:refs/heads/master" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "git push -u origin noelle-pbs-drama" }, null],
  ["Bash", { command: "git push -u origin noelle-main-menu" }, null],
  ["Bash", { command: "~/.boss-os/noelle/bin/land-after 12 --task noelle-pbs --repo seq23/peace-be-still" }, null],
  ["Agent", { subagent_type: "builder", prompt: "x" }, "AGENT"],
  ["Agent", { subagent_type: "reviewer", prompt: "x" }, "AGENT"],
  ["Write", { file_path: "~/Work/noelle/notes/2026-11-25.md" }, null],
];

function selfTest() {
  const base = join(process.env.TMPDIR ?? "/tmp", `noelle-guard-self-test-${process.pid}`);
  const h = join(base, "home"), g = join(base, "guard");
  mkdirSync(h, { recursive: true });
  saveState({ prs: 0, reviewers: 0 }, g);
  let bad = 0;
  const check = (label, got, want) => { if ((got?.stop ?? null) !== want) { bad++; console.log(`FAIL ${label}: want ${want}, got ${got?.stop ?? "null"}`); } };
  const j = (tool, ti) => judge({ tool_name: tool, tool_input: ti, cwd: h }, { h, g });
  for (const [tool, ti, want] of CASES) check(`${tool} ${JSON.stringify(ti).slice(0, 80)}`, j(tool, ti), want);
  for (let i = 1; i <= MAX_PRS; i++) check(`PR ${i}`, j("Bash", { command: "gh pr create --fill" }), null);
  check("PR 4", j("Bash", { command: "gh pr create --fill" }), "PR_CAP");
  for (let i = 1; i <= MAX_PRS; i++) check(`reviewer ${i}`, j("Agent", { subagent_type: "reviewer" }), null);
  check("reviewer 4", j("Agent", { subagent_type: "reviewer" }), "AGENT");
  writeFileSync(join(g, "compacted"), "1");
  check("after compaction: a command", j("Bash", { command: "git status" }), "CONTEXT_HANDOFF");
  check("after compaction: the handoff", j("Write", { file_path: join(h, "HANDOFF.md") }), null);
  check("no tool", judge({}, { h, g }), "GUARD_UNREAD");
  const n = CASES.length + 2 * MAX_PRS + 5;
  if (bad) { console.log(`NAMED STOP [GUARD_SELF_TEST] ${bad} of ${n} checks failed`); process.exit(1); }
  console.log(`OUTPUT: noelle-guard self-test ${n} checks passed`);
}

function main() {
  const arg = process.argv[2];
  if (arg === "--self-test") return selfTest();
  if (arg === "--precompact") {
    mkdirSync(GUARD_DIR(), { recursive: true });
    writeFileSync(join(GUARD_DIR(), "compacted"), String(Date.now()));
    return;
  }
  let input;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch {
    process.stderr.write("NAMED STOP [GUARD_UNREAD] the hook input was not JSON; refused (fail closed)\n");
    process.exit(2);
  }
  const v = judge(input);
  if (v) { process.stderr.write(`NAMED STOP [${v.stop}] ${v.why}\n`); process.exit(2); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
