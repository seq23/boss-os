#!/usr/bin/env node
/**
 * `npm run validate:noelle` — NOELLE'S SESSION HAS NO TOOLS (A6: an allow-list only, and it is empty).
 *
 * Her only output is a JSON plan that code re-checks (src/shared/boss/growth/noelle.mjs checkPlan, again
 * in the Worker). So her Claude session must not be able to run a shell, read or write a file, fetch a
 * page, load a connector or a plugin, or start an agent. Fails, by name, when:
 *   - scripts/ops/noelle-permissions.json allows anything (the allow list must exist and be empty);
 *   - it does not deny every built-in tool in MUST_DENY, or switches the claude.ai connectors on, or
 *     enables a plugin or a marketplace, or sets a mode other than dontAsk;
 *   - scripts/ops/noelle.sh or the remake call in scripts/ops/noelle.mjs stops passing
 *     `--permission-mode dontAsk --setting-sources= --settings <that file> --strict-mcp-config`,
 *     or ever skips permissions.
 * `--self-test` feeds broken copies through the same checks and fails unless each is caught.
 * Rule 0: a permissions file with no allow list at all is a failure, never a pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MUST_DENY = Object.freeze([
  "Agent", "Task", "Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
  "WebFetch", "WebSearch", "Skill", "SendMessage", "Workflow", "RemoteTrigger", "CronCreate", "ScheduleWakeup",
  "EnterWorktree", "Monitor", "ToolSearch", "Artifact", "ArtifactData", "ReadMcpResourceTool", "ListMcpResourcesTool",
  "mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Drive", "mcp__claude_ai_Google_Calendar", "mcp__claude_ai_8Raise",
]);
const FLAGS = /--permission-mode dontAsk --setting-sources= --settings \$\{?(?:SETTINGS|env\.NOELLE_SETTINGS)\}? --strict-mcp-config/;

export function permissionProblems(settings) {
  const allow = settings?.permissions?.allow;
  if (!Array.isArray(allow)) return ["the permissions file has no allow list (Rule 0: nothing checked is not a pass)"];
  const out = [];
  if (allow.length) out.push(`allow must be empty; it has ${allow.join(", ")}`);
  const deny = new Set(settings.permissions.deny ?? []);
  for (const d of MUST_DENY) if (!deny.has(d)) out.push(`deny is missing ${d}`);
  if (settings.env?.ENABLE_CLAUDEAI_MCP_SERVERS !== "false") out.push('env ENABLE_CLAUDEAI_MCP_SERVERS is not "false" (her claude.ai connectors would load)');
  if (settings.enabledPlugins && Object.values(settings.enabledPlugins).some(Boolean)) out.push("a plugin is enabled (its tools would load)");
  if (settings.extraKnownMarketplaces && Object.keys(settings.extraKnownMarketplaces).length) out.push("a plugin marketplace is named");
  if (settings.permissions.defaultMode !== "dontAsk") out.push(`defaultMode is ${settings.permissions.defaultMode ?? "unset"}, not dontAsk`);
  return out;
}

export function scriptProblems(sh, mjs) {
  const out = [];
  if (!FLAGS.test(sh)) out.push("noelle.sh no longer runs her session with --permission-mode dontAsk --setting-sources= --settings $SETTINGS --strict-mcp-config");
  if (!/SETTINGS="\$REPO\/scripts\/ops\/noelle-permissions\.json"/.test(sh)) out.push("noelle.sh's SETTINGS is not scripts/ops/noelle-permissions.json");
  if (!FLAGS.test(mjs)) out.push("noelle.mjs's remake call no longer passes the same locked flags");
  for (const [name, text] of [["noelle.sh", sh], ["noelle.mjs", mjs]]) if (/dangerously-skip-permissions|bypassPermissions|--allowedTools|--tools /.test(text)) out.push(`${name} skips or widens permissions`);
  return out;
}

function selfTest(settings, sh, mjs) {
  const clone = () => JSON.parse(JSON.stringify(settings));
  const cases = [
    ["no allow list", (() => { const s = clone(); delete s.permissions.allow; return permissionProblems(s); })()],
    ["a tool allowed", (() => { const s = clone(); s.permissions.allow = ["Bash"]; return permissionProblems(s); })()],
    ["WebFetch not denied", (() => { const s = clone(); s.permissions.deny = s.permissions.deny.filter((d) => d !== "WebFetch"); return permissionProblems(s); })()],
    ["connectors on", (() => { const s = clone(); s.env = {}; return permissionProblems(s); })()],
    ["a plugin enabled", (() => { const s = clone(); s.enabledPlugins = { "openseo@openseo": true }; return permissionProblems(s); })()],
    ["bypass mode", (() => { const s = clone(); s.permissions.defaultMode = "bypassPermissions"; return permissionProblems(s); })()],
    ["no strict MCP in noelle.sh", scriptProblems(sh.replace(/ --strict-mcp-config/g, ""), mjs)],
    ["skip-permissions in noelle.mjs", scriptProblems(sh, `${mjs}\n--dangerously-skip-permissions`)],
    ["another settings file", scriptProblems(sh.replaceAll("noelle-permissions.json", "other.json"), mjs)],
  ];
  const missed = cases.filter(([, p]) => !p.length).map(([n]) => n);
  if (missed.length) { console.error(`validate:noelle --self-test: NOT caught: ${missed.join("; ")}`); process.exit(1); }
  console.log(`validate:noelle --self-test: all ${cases.length} broken copies caught`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const settings = JSON.parse(readFileSync(join(ROOT, "scripts/ops/noelle-permissions.json"), "utf8"));
  const sh = readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8");
  const mjs = readFileSync(join(ROOT, "scripts/ops/noelle.mjs"), "utf8");
  const problems = [...permissionProblems(settings), ...scriptProblems(sh, mjs)];
  if (problems.length) { for (const p of problems) console.error(`validate:noelle: ${p}`); process.exit(1); }
  if (process.argv.includes("--self-test")) selfTest(settings, sh, mjs);
  console.log("validate:noelle: her session has no tools (allow list empty, every built-in denied, no connectors or plugins)");
}
