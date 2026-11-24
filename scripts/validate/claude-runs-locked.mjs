#!/usr/bin/env node
/**
 * `npm run validate:claude-runs` — EVERY CLAUDE RUN A SCRIPT STARTS IS LOCKED TO ITS OWN LIST
 * (24 Nov 2026, her "why cant u just do this now if it needs to be done"; "Never weaken safety
 * checks"). Her own settings default to bypassPermissions, so a `claude -p` that loads them — or one
 * passing --dangerously-skip-permissions, or ai-run's brain role with no AI_RUN_CLAUDE_ARGS — runs
 * with every tool and no prompt. A locked run passes `--permission-mode dontAsk --setting-sources=
 * --settings <its own scripts/ops/*-permissions.json>` (lib/claude-lock.sh, lib/claude-lock.mjs).
 *
 * Fails, by name, when:
 *   - ANY code line in scripts/ skips permissions, runs `claude -p` without the lock, or runs ai-run
 *     without locked AI_RUN_CLAUDE_ARGS, unless EXCEPTIONS names that exact call with a reason (the
 *     list is printed every run, and an exception that matches nothing fails as stale);
 *   - a job's permissions file (JOBS) has no allow list (Rule 0), lacks a tool its prompt uses,
 *     allows a bare Bash or a wildcard, misses a must-deny, sets a defaultMode other than dontAsk,
 *     switches the claude.ai connectors off for a job that reads Gmail, or is named by no script;
 *   - THE AI ANSWERS SESSION CAN ONLY READ (A2, unchanged from the old validate:ai-visibility):
 *     ai-visibility-permissions.json allows exactly the nine read-only OpenSEO tools in READ_TOOLS,
 *     denies the spending ones, and no repo code calls OpenSEO over HTTP.
 * `--ai-visibility` runs only the A2 checks (ai-visibility.sh runs that before its session).
 * `--self-test` puts the skip flag back into every locked script, removes a needed tool from every
 * job's file, and feeds the other breaks through the same checks; it fails unless each is caught.
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
    else if (/\.(m?[jt]sx?|sh|py)$/.test(f) && !p.endsWith("claude-runs-locked.mjs")) out.push([p.slice(ROOT.length + 1), readFileSync(p, "utf8")]);
  }
  return out;
}

// ─── Every claude run locked ─────────────────────────────────────────────────────────────────────

const G = "mcp__claude_ai_Gmail__";
const D = "mcp__claude_ai_Google_Drive__";
/** Each job's own file and what its prompt uses (read from the prompt; removing one must fail). */
export const JOBS = Object.freeze([
  { name: "kdp-watch", scripts: ["scripts/ops/kdp-watch.sh"], prompt: "scripts/ops/kdp-watch-prompt.md",
    needs: [G + "search_threads", G + "get_thread", G + "send_message", "Read(~/.boss-os/kdp/**)", "Edit(~/.boss-os/kdp/determination.json)", "Bash(npm run browser:read:*)"] },
  { name: "mailbox-sweep", scripts: ["scripts/ops/mailbox-sweep.sh"], prompt: "scripts/ops/mailbox-sweep-prompt.md",
    needs: [G + "search_threads", G + "get_thread", "Read(~/.boss-os/contacts/**)", "Edit(~/.boss-os/mailbox/findings.json)", "Bash(npm run browser:read:*)"] },
  { name: "credential-check", scripts: ["scripts/ops/credential-check.mjs"], needs: [G + "search_threads"] },
  { name: "kdp-signin", scripts: ["scripts/ops/kdp-signin.mjs"], needs: [G + "search_threads", G + "get_thread"] },
  { name: "connector-reads", scripts: ["scripts/ops/lib/duty-kit.mjs"],
    needs: [G + "search_threads", G + "get_thread", D + "search_files", D + "get_file_metadata", D + "get_file_permissions"] },
  { name: "text-only", scripts: ["scripts/ops/interest-extract.mjs"], needs: [], textOnly: true },
  { name: "builder", scripts: ["scripts/ops/repo-change.mjs", "scripts/ops/boss-mail-tail-run.sh"],
    needs: ["Edit", "Bash(git -C:*)", "Bash(git worktree add:*)", "Bash(git commit:*)", "Bash(gh pr create:*)", "Bash(gh pr checks:*)", "Bash(npm run:*)", "Bash(land:*)"],
    mustDeny: ["Bash(claude:*)", "Bash(ai-run:*)", "Bash(gh pr merge:*)", "Bash(git push --force:*)", "Bash(wrangler deploy:*)", "Bash(gh secret:*)", "mcp__claude_ai_8Raise", "mcp__8raise"],
    hook: "command-guard.mjs" },
  // Noelle (24 Nov 2026): builder-level tools plus one reviewer agent per PR, the Agent tool held by her guard.
  { name: "noelle", scripts: ["scripts/ops/noelle.sh"],
    needs: ["Agent", "Edit", "WebFetch", "Bash(noelle-tool:*)", "Bash(land-after:*)", "Bash(git worktree add:*)", "Bash(gh pr create:*)", "Bash(npm run:*)"],
    mustDeny: ["Bash(claude:*)", "Bash(ai-run:*)", "Bash(gh pr merge:*)", "Bash(git push --force:*)", "Bash(wrangler deploy:*)", "Bash(gh secret:*)", "Bash(npm run -s vault:set:*)", "Skill",
      "Edit(~/Work/noelle/.claude/**)", "Write(~/Work/noelle/.claude/**)", "Write(~/.claude/**)", "Edit(~/bin/**)"],
    hook: "noelle-guard.mjs", agentGuard: "noelle-guard.mjs" },
]);
const COMMON_DENY = ["Agent", "Task", "Edit(~/.claude/**)", "mcp__claude_ai_8Raise", "mcp__8raise"];

export function jobProblems(settings, job) {
  const tag = `${job.name}-permissions.json`;
  const out = [];
  const allow = settings?.permissions?.allow;
  if (!Array.isArray(allow)) return [`${tag} has no allow list (Rule 0: nothing checked is not a pass)`];
  if (!allow.length && !(job.textOnly && settings.text_only === true)) return [`${tag} has an empty allow list and is not marked text_only (Rule 0)`];
  if (allow.length && job.textOnly) out.push(`${tag} is text_only but allows ${allow.join(", ")}`);
  const deny = new Set(settings.permissions.deny ?? []);
  if (new Set(allow).size !== allow.length) out.push(`${tag}: an allow entry is repeated`);
  for (const a of allow) if (a === "Bash" || a === "*" || /^mcp__[^_]+(__)?\*?$/.test(a) || /^Bash\(\*/.test(a)) out.push(`${tag} allows ${a}: everything, not a list`);
  for (const t of job.needs) if (!allow.includes(t)) out.push(`${tag} is missing ${t}, which its prompt uses (the run would be refused)`);
  // Agent (and Task, its old name: denying Task removes the Agent tool) is denied everywhere, except a job
  // whose own guard runs on every Agent call (`agentGuard`): a PreToolUse hook on "*" or "Agent" that runs it. Allowing Agent without that hook fails by name.
  const guarded = job.agentGuard && (settings.hooks?.PreToolUse ?? []).some((h) => ["*", "Agent"].includes(h.matcher) && JSON.stringify(h.hooks ?? []).includes(job.agentGuard));
  if (job.agentGuard && !guarded) out.push(`${tag} allows Agent without ${job.agentGuard} on every Agent call`);
  // 24 Nov 2026, a real locked run: "Task" in deny took the Agent tool away entirely, so the reviewer was never offered.
  if (job.needs.includes("Agent") && (deny.has("Task") || deny.has("Agent"))) out.push(`${tag} needs Agent, but its deny holds ${deny.has("Task") ? "Task" : "Agent"}, which removes the Agent tool`);
  for (const d of [...COMMON_DENY.filter((c) => !(["Agent", "Task"].includes(c) && guarded)), ...(job.mustDeny ?? [])]) if (!deny.has(d)) out.push(`${tag}: deny is missing ${d}`);
  for (const d of deny) if (allow.includes(d)) out.push(`${tag}: ${d} is both allowed and denied`);
  if (settings.permissions.defaultMode && settings.permissions.defaultMode !== "dontAsk") out.push(`${tag}: defaultMode is ${settings.permissions.defaultMode}`);
  if (job.needs.some((t) => t.startsWith("mcp__claude_ai_")) && settings.env?.ENABLE_CLAUDEAI_MCP_SERVERS === "false") out.push(`${tag} switches the claude.ai connectors off, and this job reads Gmail`);
  if (job.hook && !JSON.stringify(settings.hooks ?? {}).includes(job.hook)) out.push(`${tag}: the ${job.hook} hook is gone`);
  return out;
}

/** Calls that may stay unlocked, each with its reason. `match` is text on the call's own line. */
export const EXCEPTIONS = Object.freeze([
  { file: "scripts/validate/the-repo-lane-lands-only-on-green.mjs", match: 'runner: "import { PHASE_MODELS', what: "runs claude -p without lockedArgs()", why: "a self-test fixture string standing in for repo-change.mjs; it is never spawned" },
  { file: "scripts/ops/kdp-surface.sh", match: '"$AI_RUN" --role "$AI_ROLE" --out "$RUN_LOG"', why: "ai-run brain with no AI_RUN_CLAUDE_ARGS (ai-run's default skips permissions); found beyond the 24 Nov brief, not locked in this PR (see its Not built)" },
  { file: "scripts/ops/ahrefs-audit-fix.sh", match: '--out "$AHREFS_DIGEST"', why: "the Gmail digest step: ai-run brain with no AI_RUN_CLAUDE_ARGS; found beyond the 24 Nov brief, not locked in this PR (the repair pass below it is locked)" },
  { file: "scripts/ops/kdp-kmp-draft.mjs", match: null, why: "ai-run brain review with no AI_RUN_CLAUDE_ARGS; found beyond the 24 Nov brief, not locked in this PR" },
  { file: "scripts/ops/ship-review.mjs", match: null, why: "seatTier's ai-run brain with no AI_RUN_CLAUDE_ARGS; found beyond the 24 Nov brief, not locked in this PR" },
  { file: "scripts/ops/lib/ai-run.mjs", match: null, why: "runAs hands work to ai-run's worker role (Codex); a Claude fallback there takes ai-run's default; not locked in this PR" },
]);

const LOCK_SH = /\$CLAUDE_LOCK\b|--permission-mode dontAsk --setting-sources= --settings \S/;
const SKIP = /dangerously-skip-permissions|bypassPermissions/;
const isComment = (t, sh) => (sh ? /^\s*#/.test(t) : /^\s*(\/\/|\*|\/\*)/.test(t));

/** Logical code lines: comments dropped, shell continuations joined. [{ n, text }] */
function codeLines(text, sh) {
  const lines = String(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i], sh)) continue;
    let t = lines[i]; const n = i + 1;
    while (sh && /\\$/.test(t) && i + 1 < lines.length) t = t.slice(0, -1) + " " + lines[++i];
    out.push({ n, text: t, before: lines.slice(Math.max(0, i - 2), i).join("\n") });
  }
  return out;
}

/** Each unlocked claude call in one file: [{ n, what, line }] */
export function unlockedCalls(file, text) {
  const sh = file.endsWith(".sh");
  const out = [];
  const add = (n, what, line) => out.push({ n, what, line: line.trim().slice(0, 160) });
  for (const { n, text: t, before } of codeLines(text, sh)) {
    if (SKIP.test(t)) add(n, "skips permissions", t);
    if (sh) {
      if (/(?:"\$\{?CLAUDE\}?"|\$CLAUDE\b|(?:^|[\s;(&|])claude)\s+-p\b/.test(t) && !LOCK_SH.test(t)) add(n, "runs claude -p without the lock", t);
      if (/"\$\{?(?:NOELLE_)?AI_RUN\}?"\s+--role/.test(t) && !/AI_RUN_CLAUDE_ARGS=\S*/.test(t.replace(/AI_RUN_CLAUDE_ARGS="[^"]*"/, (m) => (LOCK_SH.test(m) ? m : "")))) add(n, "runs ai-run without locked AI_RUN_CLAUDE_ARGS", t);
    } else {
      if (/["']-p["']\s*,/.test(t) && /\b(CLAUDE|claude|bin)\b/.test(`${before}\n${t}`) && !/unzip/.test(t) && !/lockedArgs\(/.test(t)) add(n, "runs claude -p without lockedArgs()", t);
    }
  }
  if (!sh && /bin\/ai-run|"bin", "ai-run"|aiRunBin\(env\)/.test(text) && !/AI_RUN_CLAUDE_ARGS[^\n]*(dontAsk|lockedArgs)/.test(text)) add(0, "runs ai-run without locked AI_RUN_CLAUDE_ARGS", "(the file spawns ai-run)");
  return out;
}

export function scanProblems(files, exceptions = EXCEPTIONS) {
  const out = [];
  const used = new Set();
  for (const [file, text] of files) {
    for (const c of unlockedCalls(file, text)) {
      const ex = exceptions.findIndex((e) => e.file === file && (!e.what || e.what === c.what) && (e.match === null || c.line.includes(e.match)));
      if (ex >= 0) { used.add(ex); continue; }
      out.push(`${file}:${c.n} ${c.what}: ${c.line}`);
    }
  }
  exceptions.forEach((e, i) => { if (!used.has(i) && files.some(([f]) => f === e.file || !files.length)) out.push(`stale exception: ${e.file} (${e.match ?? "whole file"}) matches no call; remove it`); });
  return out;
}

function settingsOf(name) {
  try { return JSON.parse(readFileSync(join(ROOT, "scripts/ops", `${name}-permissions.json`), "utf8")); } catch { return null; }
}
function namedBy(job, files) {
  const text = Object.fromEntries(files);
  return job.scripts.filter((s) => !(text[s] ?? "").includes(`${job.name}-permissions.json`) && !(text[s] ?? "").includes(`lockedArgs("${job.name}")`))
    .map((s) => `${s} does not run under ${job.name}-permissions.json`);
}

function selfTest() {
  let bad = 0, caught = 0;
  const must = (name, problems) => { if (problems.length) caught++; else { console.error(`self-test: not caught: ${name}`); bad++; } };
  // A2: the AI answers session.
  const good = JSON.parse(readFileSync(join(ROOT, "scripts/ops/ai-visibility-permissions.json"), "utf8"));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  for (const [name, f] of [
    ["an extra spend tool allowed", (s) => s.permissions.allow.push(P + "run_ai_visibility_check")],
    ["a wildcard allowed", (s) => s.permissions.allow.push(P + "*")],
    ["Bash allowed", (s) => s.permissions.allow.push("Bash")],
    ["a read tool missing", (s) => s.permissions.allow.pop()],
    ["the check not denied", (s) => { s.permissions.deny = s.permissions.deny.filter((d) => d !== P + "run_ai_visibility_check"); }],
    ["connectors on", (s) => { s.env.ENABLE_CLAUDEAI_MCP_SERVERS = "true"; }],
    ["no allow list", (s) => { delete s.permissions.allow; }],
    ["plugin off", (s) => { s.enabledPlugins["openseo@openseo"] = false; }],
  ]) { const s = clone(good); f(s); must(`ai-visibility: ${name}`, permissionProblems(s)); }
  if (permissionProblems(good).length) { console.error("self-test: the real ai-visibility file fails"); bad++; }
  const sh = readFileSync(join(ROOT, "scripts/ops/ai-visibility.sh"), "utf8");
  if (scriptProblems(sh).length) { console.error("self-test: the real ai-visibility.sh fails"); bad++; }
  must("ai-visibility.sh skipping permissions", scriptProblems(sh.replace("--permission-mode dontAsk", "--dangerously-skip-permissions")));
  must("an OpenSEO fetch", httpProblems([["x.ts", 'fetch("https://app.openseo.so/api/x")']]));
  // Every job's file: the real one passes; each needed tool removed, Rule 0 and the bypass mode fail.
  for (const job of JOBS) {
    const real = settingsOf(job.name);
    if (!real || jobProblems(real, job).length) { console.error(`self-test: the real ${job.name}-permissions.json fails`); bad++; continue; }
    for (const t of job.needs) { const s = clone(real); s.permissions.allow = s.permissions.allow.filter((a) => a !== t); must(`${job.name} missing ${t}`, jobProblems(s, job)); }
    { const s = clone(real); delete s.permissions.allow; must(`${job.name} with no allow list`, jobProblems(s, job)); }
    { const s = clone(real); s.permissions.defaultMode = "bypassPermissions"; must(`${job.name} in bypass mode`, jobProblems(s, job)); }
    { const s = clone(real); s.permissions.allow = [...s.permissions.allow, "Bash"]; must(`${job.name} allowing bare Bash`, jobProblems(s, job)); }
    if (job.agentGuard) {
      const s = clone(real); s.hooks.PreToolUse = s.hooks.PreToolUse.filter((h) => !JSON.stringify(h).includes(job.agentGuard));
      must(`${job.name} allowing Agent without ${job.agentGuard}`, jobProblems(s, job));
      const t = clone(real); t.permissions.deny = [...t.permissions.deny, "Task"];
      must(`${job.name} denying Task, which removes the Agent tool`, jobProblems(t, job));
    }
  }
  must("an empty allow list not marked text_only", jobProblems({ permissions: { allow: [], deny: COMMON_DENY } }, { name: "x", needs: [] }));
  // The skip flag back in every locked script, and each shape of unlocked call.
  const SKIP_FLAG = "--dangerously-skip-permissions";
  const scripts = [...new Set(JOBS.flatMap((j) => j.scripts)), "scripts/ops/ai-visibility.sh"];
  for (const f of scripts) {
    const text = readFileSync(join(ROOT, f), "utf8");
    if (scanProblems([[f, text]], []).length) { console.error(`self-test: the real ${f} fails the scan`); bad++; continue; }
    const broken = text.replace(/\$CLAUDE_LOCK\b/g, SKIP_FLAG).replace(/\.\.\.lockedArgs\("[^"]+"\)/g, `"${SKIP_FLAG}"`).replace(/--permission-mode dontAsk --setting-sources= --settings/g, SKIP_FLAG)
      .replace(/"--permission-mode", "dontAsk"/g, `"${SKIP_FLAG}"`);
    must(`the skip flag back in ${f}`, broken === text ? [] : scanProblems([[f, broken]], []));
  }
  must("a bare claude -p in a script", scanProblems([["x.sh", '"$CLAUDE" -p "$(cat p)" --model opus >> log']], []));
  must("a node spawn of claude", scanProblems([["x.mjs", 'spawn("claude", ["-p", prompt, "--model", m])']], []));
  must("ai-run with no args", scanProblems([["x.sh", 'AI_RUN_CLAUDE_MODEL="$M" "$AI_RUN" --role "$R" --out "$L" < p']], []));
  must("ai-run with unlocked args", scanProblems([["x.sh", 'AI_RUN_CLAUDE_ARGS="--max-turns 9" "$AI_RUN" --role "$R" < p']], []));
  must("a stale exception", scanProblems([["x.sh", "echo ok"]], [{ file: "x.sh", match: "nothing", why: "t" }]));
  must("a job's file named by no script", namedBy({ name: "kdp-watch", scripts: ["x.sh"] }, [["x.sh", "claude"]]));
  if (bad) process.exit(1);
  console.log(`claude-runs-locked self-test: ${caught} breaks caught`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const settings = JSON.parse(readFileSync(join(ROOT, "scripts/ops/ai-visibility-permissions.json"), "utf8"));
  const sh = readFileSync(join(ROOT, "scripts/ops/ai-visibility.sh"), "utf8");
  const scriptFiles = codeFiles(join(ROOT, "scripts"));
  const files = [...codeFiles(join(ROOT, "src")), ...scriptFiles];
  if (!scriptFiles.length) { console.error("NAMED STOP [NOTHING_CHECKED] no code files read"); process.exit(1); }
  const problems = [...permissionProblems(settings), ...scriptProblems(sh), ...httpProblems(files)];
  if (process.argv.includes("--ai-visibility")) { // ai-visibility.sh's own pre-run check: its session only
    if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
    return console.log(`ai-visibility reads only (${READ_TOOLS.length} read tools)`);
  }
  problems.push(...scanProblems(scriptFiles));
  for (const job of JOBS) {
    const s = settingsOf(job.name);
    problems.push(...(s ? jobProblems(s, job) : [`scripts/ops/${job.name}-permissions.json is missing or not JSON`]), ...namedBy(job, scriptFiles));
  }
  console.log(`Unlocked by name (${EXCEPTIONS.length}):`);
  for (const e of EXCEPTIONS) console.log(`  - ${e.file}${e.match ? ` [${e.match}]` : ""}: ${e.why}`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`claude runs locked: ${scriptFiles.length} script files scanned, ${JOBS.length} job permission files checked, ai-visibility reads only (${READ_TOOLS.length} read tools)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
