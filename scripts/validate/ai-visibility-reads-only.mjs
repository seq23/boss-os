#!/usr/bin/env node
/**
 * `npm run validate:ai-visibility` — THE AI ANSWERS SESSION CAN ONLY READ (A2, her rule: agents never
 * spend beyond what she approved; no paid API in code).
 *
 * Fails, by name, when:
 *   - scripts/ops/ai-visibility-permissions.json allows anything but exactly the nine read-only OpenSEO
 *     tools in READ_TOOLS (an extra tool, a wildcard, a missing one, a repeat);
 *   - it does not deny the OpenSEO tools that spend or write (run_ai_visibility_check first), the
 *     shell, file and web tools, or does not switch the claude.ai connectors off;
 *   - scripts/ops/ai-visibility.sh stops passing `--permission-mode dontAsk --setting-sources=
 *     --settings <that file>`, or ever skips permissions;
 *   - any repo code (src/, scripts/) calls OpenSEO over HTTP: it is read only through the plugin.
 * `--self-test` feeds broken copies through the same checks and fails unless each is caught.
 * Rule 0: a permissions file with no allow list at all is a failure, never a pass.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = "mcp__plugin_openseo_openseo__";
export const READ_TOOLS = Object.freeze([
  "list_projects", "get_ai_visibility_tracker", "get_ai_visibility_run", "get_ai_visibility_results",
  "get_ai_visibility_sources", "get_ai_visibility_trend", "get_ai_visibility_answer", "estimate_ai_visibility_cost", "whoami",
].map((t) => P + t));
export const MUST_DENY = Object.freeze([
  ...["run_ai_visibility_check", "save_ai_visibility_tracker", "set_ai_visibility_schedule", "research_ai_visibility_prompts",
    "generate_ai_visibility_prompts", "explore_prompt", "complete_ai_research_setup", "update_project_context", "create_project",
    "run_site_audit", "run_rank_tracker", "research_keywords"].map((t) => P + t),
  "Bash", "Write", "Edit", "Read", "WebFetch", "WebSearch", "Agent", "Task", "Skill", "NotebookEdit",
]);

export function permissionProblems(settings) {
  const out = [];
  const allow = settings?.permissions?.allow;
  if (!Array.isArray(allow) || !allow.length) return ["the permissions file has no allow list (Rule 0: nothing checked is not a pass)"];
  const deny = new Set(settings.permissions.deny ?? []);
  if (new Set(allow).size !== allow.length) out.push("an allow entry is repeated");
  for (const a of allow) if (!READ_TOOLS.includes(a)) out.push(`allow has ${a}, which is not one of the nine read tools`);
  for (const t of READ_TOOLS) if (!allow.includes(t)) out.push(`allow is missing ${t}`);
  for (const d of MUST_DENY) if (!deny.has(d)) out.push(`deny is missing ${d}`);
  for (const d of deny) if (allow.includes(d)) out.push(`${d} is both allowed and denied`);
  if (settings.env?.ENABLE_CLAUDEAI_MCP_SERVERS !== "false") out.push("env ENABLE_CLAUDEAI_MCP_SERVERS is not \"false\" (her claude.ai connectors would load)");
  if (settings.enabledPlugins?.["openseo@openseo"] !== true) out.push("the openseo plugin is not enabled in the file (the session would read nothing)");
  if (settings.permissions.defaultMode && settings.permissions.defaultMode !== "dontAsk") out.push(`defaultMode is ${settings.permissions.defaultMode}`);
  return out;
}

export function scriptProblems(sh) {
  const out = [];
  if (!/--permission-mode dontAsk --setting-sources= --settings \$SETTINGS/.test(sh)) out.push("ai-visibility.sh no longer runs the session with --permission-mode dontAsk --setting-sources= --settings $SETTINGS");
  if (!/SETTINGS="\$REPO\/scripts\/ops\/ai-visibility-permissions\.json"/.test(sh)) out.push("ai-visibility.sh's SETTINGS is not scripts/ops/ai-visibility-permissions.json");
  if (/dangerously-skip-permissions|bypassPermissions/.test(sh)) out.push("ai-visibility.sh skips permissions");
  return out;
}

/** An OpenSEO URL in code (docs and this file excepted). */
export const OPENSEO_HTTP_RE = /https?:\/\/[^\s"'`]*open-?seo\.[a-z]/i;
export function httpProblems(files) {
  return files.filter(([, text]) => OPENSEO_HTTP_RE.test(text)).map(([f]) => `${f} calls OpenSEO over HTTP; read it only through the plugin`);
}

function codeFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|fixtures/.test(f)) codeFiles(p, out); }
    else if (/\.(m?[jt]sx?|sh|py)$/.test(f) && !p.endsWith("ai-visibility-reads-only.mjs")) out.push([p.slice(ROOT.length + 1), readFileSync(p, "utf8")]);
  }
  return out;
}

function selfTest() {
  const good = JSON.parse(readFileSync(join(ROOT, "scripts/ops/ai-visibility-permissions.json"), "utf8"));
  const clone = () => JSON.parse(JSON.stringify(good));
  const cases = [
    ["an extra spend tool allowed", (s) => s.permissions.allow.push(P + "run_ai_visibility_check")],
    ["a wildcard allowed", (s) => s.permissions.allow.push(P + "*")],
    ["Bash allowed", (s) => s.permissions.allow.push("Bash")],
    ["a read tool missing", (s) => s.permissions.allow.pop()],
    ["the check not denied", (s) => { s.permissions.deny = s.permissions.deny.filter((d) => d !== P + "run_ai_visibility_check"); }],
    ["connectors on", (s) => { s.env.ENABLE_CLAUDEAI_MCP_SERVERS = "true"; }],
    ["no allow list", (s) => { delete s.permissions.allow; }],
    ["plugin off", (s) => { s.enabledPlugins["openseo@openseo"] = false; }],
  ];
  let bad = 0;
  if (permissionProblems(good).length) { console.error("self-test: the real file fails"); bad++; }
  for (const [name, f] of cases) { const s = clone(); f(s); if (!permissionProblems(s).length) { console.error(`self-test: not caught: ${name}`); bad++; } }
  const sh = readFileSync(join(ROOT, "scripts/ops/ai-visibility.sh"), "utf8");
  if (scriptProblems(sh).length) { console.error("self-test: the real script fails"); bad++; }
  if (!scriptProblems(sh.replace("--permission-mode dontAsk", "--dangerously-skip-permissions")).length) { console.error("self-test: a skipped-permissions script not caught"); bad++; }
  if (!httpProblems([["x.ts", 'fetch("https://app.openseo.so/api/x")']]).length) { console.error("self-test: an OpenSEO fetch not caught"); bad++; }
  if (bad) process.exit(1);
  console.log(`ai-visibility reads-only self-test: ${cases.length + 3} breaks caught`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const settings = JSON.parse(readFileSync(join(ROOT, "scripts/ops/ai-visibility-permissions.json"), "utf8"));
  const sh = readFileSync(join(ROOT, "scripts/ops/ai-visibility.sh"), "utf8");
  const files = [...codeFiles(join(ROOT, "src")), ...codeFiles(join(ROOT, "scripts"))];
  if (!files.length) { console.error("NAMED STOP [NOTHING_CHECKED] no code files read"); process.exit(1); }
  const problems = [...permissionProblems(settings), ...scriptProblems(sh), ...httpProblems(files)];
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`ai-visibility reads only: ${READ_TOOLS.length} read tools allowed, ${MUST_DENY.length} denies present, ${files.length} code files free of OpenSEO HTTP`);
}

main();
