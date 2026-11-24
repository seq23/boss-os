#!/usr/bin/env node
/**
 * `npm run validate:noelle` — NOELLE'S TOOLS ARE NAMED, AND NOTHING ELSE (24 Nov 2026).
 *
 * Her session may Read inside her run folder (her working directory: context, rulings files) and run
 * `./noelle-tools` (read and check verbs, no secrets, no writes); her plan is still re-checked by code
 * (checkPlan, again in the Worker) and every write happens after her session. The bank reviewer and the
 * remake have no tools at all. Fails, by name, when:
 *   - scripts/ops/noelle-permissions.json allows anything but exactly HER_ALLOW (Bash unscoped, Write,
 *     WebFetch, a Read outside her folder…), or the review file allows anything;
 *   - either does not deny every tool in its MUST_DENY list, switches the claude.ai connectors on,
 *     enables a plugin or a marketplace, or sets a mode other than dontAsk;
 *   - scripts/ops/noelle.sh stops passing `--permission-mode dontAsk --setting-sources= --settings
 *     $SETTINGS --strict-mcp-config` from her run folder, or the reviewer calls in noelle.mjs stop passing
 *     the review file the same way, or either ever skips permissions.
 * `--self-test` feeds broken copies through the same checks and fails unless each is caught.
 * Rule 0: a permissions file with no allow list at all is a failure, never a pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HER_ALLOW = Object.freeze(["Read(./**)", "Bash(./noelle-tools:*)"]);
/** Denied in both files. Her file may allow Read, Glob, Grep and Bash only through HER_ALLOW's scopes. */
const SHARED_DENY = [
  "Agent", "Task", "Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
  "WebFetch", "WebSearch", "Skill", "SendMessage", "Workflow", "RemoteTrigger", "CronCreate", "ScheduleWakeup",
  "EnterWorktree", "Monitor", "ToolSearch", "Artifact", "ArtifactData", "ReadMcpResourceTool", "ListMcpResourcesTool",
  "mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Drive", "mcp__claude_ai_Google_Calendar", "mcp__claude_ai_8Raise",
];
export const MUST_DENY = Object.freeze({
  her: Object.freeze([...SHARED_DENY.filter((d) => !["Bash", "Read", "Glob", "Grep"].includes(d)), "Read(~/Brains/**)"]),
  review: Object.freeze(SHARED_DENY),
});
const SH_FLAGS = /--permission-mode dontAsk --setting-sources= --settings \$\{?SETTINGS\}? --strict-mcp-config/;
const MJS_FLAGS = /--permission-mode dontAsk --setting-sources= --settings \$\{env\.NOELLE_REVIEW_SETTINGS\} --strict-mcp-config/;

export function permissionProblems(settings, which = "her") {
  const allow = settings?.permissions?.allow;
  const name = which === "her" ? "her permissions file" : "the review permissions file";
  if (!Array.isArray(allow)) return [`${name} has no allow list (Rule 0: nothing checked is not a pass)`];
  const out = [];
  const want = which === "her" ? HER_ALLOW : [];
  const extra = allow.filter((a) => !want.includes(a));
  const missing = want.filter((a) => !allow.includes(a));
  if (extra.length) out.push(`${name} allows ${extra.join(", ")} (only ${want.length ? want.join(", ") : "nothing"} is allowed)`);
  if (missing.length) out.push(`${name} no longer allows ${missing.join(", ")} (her tools are named; the run would stall)`);
  const deny = new Set(settings.permissions.deny ?? []);
  for (const d of MUST_DENY[which]) if (!deny.has(d)) out.push(`${name}: deny is missing ${d}`);
  // 24 Nov 2026 review F1: a Read deny over her own run folder (~/.boss-os/noelle/runs/<day>) beats Read(./**) and
  // leaves her blind. Deny wins over allow, so any deny whose path holds that folder fails here.
  if (which === "her") {
    const RUN_FOLDER = "~/.boss-os/noelle/runs/2026-01-01-0900/brief.md";
    const covers = (p) => {
      const glob = p.replace(/^\/\/Users\/[^/]+/, "~").replace(/^\/\/private\/?/, "//private/");
      const re = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
      return re.test(RUN_FOLDER) || (p.startsWith("//Users/") && /^\/\/Users\/(\*\*|\*)/.test(p));
    };
    for (const d of deny) {
      const m = /^Read\((.+)\)$/.exec(String(d));
      if (m && covers(m[1])) out.push(`${name}: deny ${d} covers her own run folder, so she could read nothing (deny beats allow)`);
    }
  }
  if (settings.env?.ENABLE_CLAUDEAI_MCP_SERVERS !== "false") out.push(`${name}: env ENABLE_CLAUDEAI_MCP_SERVERS is not "false" (her claude.ai connectors would load)`);
  if (settings.enabledPlugins && Object.values(settings.enabledPlugins).some(Boolean)) out.push(`${name}: a plugin is enabled (its tools would load)`);
  if (settings.extraKnownMarketplaces && Object.keys(settings.extraKnownMarketplaces).length) out.push(`${name}: a plugin marketplace is named`);
  if (settings.permissions.defaultMode !== "dontAsk") out.push(`${name}: defaultMode is ${settings.permissions.defaultMode ?? "unset"}, not dontAsk`);
  return out;
}

export function scriptProblems(sh, mjs) {
  const out = [];
  if (!SH_FLAGS.test(sh)) out.push("noelle.sh no longer runs her session with --permission-mode dontAsk --setting-sources= --settings $SETTINGS --strict-mcp-config");
  if (!/SETTINGS="\$REPO\/scripts\/ops\/noelle-permissions\.json"/.test(sh)) out.push("noelle.sh's SETTINGS is not scripts/ops/noelle-permissions.json");
  if (!/REVIEW_SETTINGS="\$REPO\/scripts\/ops\/noelle-review-permissions\.json"/.test(sh)) out.push("noelle.sh's REVIEW_SETTINGS is not scripts/ops/noelle-review-permissions.json");
  if (!/--cwd "\$WORK"/.test(sh)) out.push("noelle.sh no longer runs her session from her run folder (--cwd \"$WORK\"), so Read(./**) would reach further");
  if (!MJS_FLAGS.test(mjs)) out.push("noelle.mjs's reviewer calls no longer pass the no-tools review file with the locked flags");
  if (/--settings \$\{env\.NOELLE_SETTINGS\}/.test(mjs)) out.push("noelle.mjs runs a reviewer with HER tools file");
  for (const [name, text] of [["noelle.sh", sh], ["noelle.mjs", mjs]]) if (/dangerously-skip-permissions|bypassPermissions|--allowedTools|--tools /.test(text)) out.push(`${name} skips or widens permissions`);
  return out;
}

function selfTest(settings, review, sh, mjs) {
  const clone = (o = settings) => JSON.parse(JSON.stringify(o));
  const her = (f) => { const s = clone(); f(s); return permissionProblems(s, "her"); };
  const rev = (f) => { const s = clone(review); f(s); return permissionProblems(s, "review"); };
  const cases = [
    ["no allow list", her((s) => { delete s.permissions.allow; })],
    ["Bash unscoped", her((s) => { s.permissions.allow.push("Bash"); })],
    ["Read outside her folder", her((s) => { s.permissions.allow = ["Read(~/**)", "Bash(./noelle-tools:*)"]; })],
    ["Write allowed", her((s) => { s.permissions.allow.push("Write"); })],
    ["her tool dropped", her((s) => { s.permissions.allow = ["Read(./**)"]; })],
    ["WebFetch not denied", her((s) => { s.permissions.deny = s.permissions.deny.filter((d) => d !== "WebFetch"); })],
    ["Brains Read not denied", her((s) => { s.permissions.deny = s.permissions.deny.filter((d) => d !== "Read(~/Brains/**)"); })],
    ["a home-wide Read deny (it blocks her own run folder)", her((s) => { s.permissions.deny.push("Read(~/**)"); })],
    ["connectors on", her((s) => { s.env = {}; })],
    ["a plugin enabled", her((s) => { s.enabledPlugins = { "openseo@openseo": true }; })],
    ["bypass mode", her((s) => { s.permissions.defaultMode = "bypassPermissions"; })],
    ["the reviewer given a tool", rev((s) => { s.permissions.allow = ["Read(./**)"]; })],
    ["the reviewer may Read", rev((s) => { s.permissions.deny = s.permissions.deny.filter((d) => d !== "Read"); })],
    ["no strict MCP in noelle.sh", scriptProblems(sh.replace(/ --strict-mcp-config/g, ""), mjs)],
    ["her session run from home", scriptProblems(sh.replace('--cwd "$WORK"', '--cwd "$HOME"'), mjs)],
    ["reviewer on her tools file", scriptProblems(sh, mjs.replaceAll("env.NOELLE_REVIEW_SETTINGS", "env.NOELLE_SETTINGS"))],
    ["skip-permissions in noelle.mjs", scriptProblems(sh, `${mjs}\n--dangerously-skip-permissions`)],
    ["another settings file", scriptProblems(sh.replaceAll("noelle-permissions.json", "other.json"), mjs)],
  ];
  const missed = cases.filter(([, p]) => !p.length).map(([n]) => n);
  if (missed.length) { console.error(`validate:noelle --self-test: NOT caught: ${missed.join("; ")}`); process.exit(1); }
  console.log(`validate:noelle --self-test: all ${cases.length} broken copies caught`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const read = (f) => readFileSync(join(ROOT, f), "utf8");
  const settings = JSON.parse(read("scripts/ops/noelle-permissions.json"));
  const review = JSON.parse(read("scripts/ops/noelle-review-permissions.json"));
  const sh = read("scripts/ops/noelle.sh");
  const mjs = read("scripts/ops/noelle.mjs");
  const problems = [...permissionProblems(settings, "her"), ...permissionProblems(review, "review"), ...scriptProblems(sh, mjs)];
  if (problems.length) { for (const p of problems) console.error(`validate:noelle: ${p}`); process.exit(1); }
  if (process.argv.includes("--self-test")) selfTest(settings, review, sh, mjs);
  console.log(`validate:noelle: her session has exactly ${HER_ALLOW.join(" and ")} from her run folder; the reviewer has no tools; no connectors or plugins`);
}
