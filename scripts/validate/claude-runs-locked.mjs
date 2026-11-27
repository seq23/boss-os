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
 *     denies the spending ones, and no repo code calls OpenSEO over HTTP; and ai-visibility.sh reads the
 *     session through its event stream (stream-json to $WORK/session.jsonl, then the transcript step,
 *     before the sentinel check), never its last message alone (24 Nov 2026, two runs read 0 sites).
 * `--ai-visibility` runs only the A2 checks (ai-visibility.sh runs that before its session).
 * `--self-test` puts the skip flag back into every locked script, removes a needed tool from every
 * job's file, and feeds the other breaks through the same checks; it fails unless each is caught.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HER_REPOS } from "../ops/noelle-guard.mjs";

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
  out.push(...hookProblems(settings.hooks));
  return out;
}

/**
 * THE ONE HOOK (27 Nov 2026): code of ours reads every OpenSEO result (scripts/ops/ai-visibility-hook.mjs)
 * and hands the session a digest. Exactly one PostToolUse entry, matching the OpenSEO plugin's tools only,
 * running exactly that file through $AI_VISIBILITY_HOOK (set by ai-visibility.sh). No other hook event:
 * a hook is a command run on her Mac, so a second one is a second door.
 */
export const HOOK_COMMAND = 'node "$AI_VISIBILITY_HOOK"';
export const HOOK_MATCHER = "mcp__plugin_openseo_openseo__.*";
export function hookProblems(hooks) {
  if (!hooks || typeof hooks !== "object") return ["the permissions file has no hooks (the OpenSEO results would reach the session whole and code would build no week)"];
  const out = [];
  for (const ev of Object.keys(hooks)) if (ev !== "PostToolUse") out.push(`a ${ev} hook is set (only the PostToolUse digest hook may run)`);
  const post = hooks.PostToolUse;
  if (!Array.isArray(post) || post.length !== 1) return [...out, "PostToolUse must hold exactly one entry"];
  if (post[0]?.matcher !== HOOK_MATCHER) out.push(`the hook's matcher is ${JSON.stringify(post[0]?.matcher)}, not the OpenSEO tools only`);
  const cmds = post[0]?.hooks;
  if (!Array.isArray(cmds) || cmds.length !== 1 || cmds[0]?.type !== "command" || cmds[0]?.command !== HOOK_COMMAND) out.push(`the hook must run exactly ${HOOK_COMMAND}`);
  return out;
}

export function scriptProblems(sh) {
  const out = [];
  if (!/^HOOK="\$REPO\/scripts\/ops\/ai-visibility-hook\.mjs"$/m.test(sh)) out.push("ai-visibility.sh's HOOK is not scripts/ops/ai-visibility-hook.mjs");
  if (!/AI_VISIBILITY_HOOK="\$HOOK" AI_VISIBILITY_STASH="\$WORK\/openseo\.jsonl"/.test(sh)) out.push("ai-visibility.sh no longer hands the session its hook and the stash in $WORK");
  if (!/ai-visibility-report\.mjs post "\$RUN_LOG" "\$WORK\/state\.json" "\$WORK\/openseo\.jsonl"/.test(sh)) out.push("ai-visibility.sh's post step no longer reads the stash");
  if (!/--permission-mode dontAsk --setting-sources= --settings \$SETTINGS/.test(sh)) out.push("ai-visibility.sh no longer runs the session with --permission-mode dontAsk --setting-sources= --settings $SETTINGS");
  if (!/SETTINGS="\$REPO\/scripts\/ops\/ai-visibility-permissions\.json"/.test(sh)) out.push("ai-visibility.sh's SETTINGS is not scripts/ops/ai-visibility-permissions.json");
  if (/dangerously-skip-permissions|bypassPermissions/.test(sh)) out.push("ai-visibility.sh skips permissions");
  // THE SESSION'S BLOCKS ARE READ FROM ITS EVENT STREAM (24 Nov 2026: text mode keeps only the last
  // message, and two runs in a row read 0 sites). The stream, sent to the work dir, then transcribed.
  if (!/AI_RUN_CLAUDE_ARGS="[^"]*--output-format stream-json --verbose[^"]*"/.test(sh)) out.push("ai-visibility.sh's session no longer asks for its event stream (--output-format stream-json --verbose): its last message alone loses the site blocks");
  if (!/"\$AI_RUN"[^\n]*--out "\$WORK\/session\.jsonl"/.test(sh)) out.push("ai-visibility.sh no longer sends the session's stream to $WORK/session.jsonl");
  if (!/ai-visibility-report\.mjs transcript "\$WORK\/session\.jsonl"\) >> "\$RUN_LOG"/.test(sh)) out.push("ai-visibility.sh no longer writes the session's own words into its log (the transcript step)");
  else if (sh.indexOf("ai-visibility-report.mjs transcript") > sh.indexOf('if ! has_sentinel "$RUN_LOG"')) out.push("ai-visibility.sh checks the sentinel before the transcript step has written it");
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

// ─── Noelle's hosts: her own sites, by exact name (the #574 review's S1, 27 Nov 2026) ──────────────────────
// WebFetch runs outside her sandbox and a GET carries data in its URL, so the host list IS the control: no bare
// WebFetch, no public wildcard (anyone can register a *.pages.dev or *.workers.dev host). The list is derived here from
// the sites map (src/shared/boss/maps/sites.json) for the repos she grows (noelle-guard.mjs HER_REPOS), so
// scripts/ops/noelle-permissions.json must name exactly these hosts: a site she gains fails the build until it is added,
// and a host nobody owns of hers can never be added. Research beyond them is WebSearch (a search query, no host of hers).
const NOELLE_INFRA = Object.freeze([
  "github.com", "api.github.com", "codeload.github.com", "*.githubusercontent.com", // public clones and CI reads
  "registry.npmjs.org", // npm installs
  "boss.sequoiataylor.com", // Boss OS's own Worker, by exact name (never *.sequoiataylor.com)
]);
/** The Industry Guides hub: hers to read (search watch), not in HER_REPOS, so she cannot change it. */
const NOELLE_READ_ONLY_REPOS = Object.freeze(["local-guides-citation-velocity"]);
/**
 * Pages projects whose <project>.pages.dev name is not proven hers: wpp-llm.pages.dev did not resolve on 27 Nov 2026
 * (each other project's name served her own site or redirected to it), so a stranger might hold or claim it.
 */
const NOELLE_UNPROVEN_PAGES = Object.freeze(["wpp-llm"]);
/** Her Cloudflare account's workers.dev subdomain: only that account can deploy under it, but each Worker is named. */
const NOELLE_WORKERS_SUB = "seq-taylor.workers.dev";
/** Hosts anyone can register a name under: a wildcard over one of these lets a stranger receive her data. */
export const SHARED_HOSTS = Object.freeze(["pages.dev", "workers.dev", "wordpress.com", "blogspot.com", "github.io", "netlify.app",
  "vercel.app", "web.app", "firebaseapp.com", "herokuapp.com", "trycloudflare.com", "ngrok.io", "ngrok-free.app", "onrender.com", "fly.dev"]);
/** Shared temp folders: other sessions' scratch (west-peek-os included), ai-run's raw outputs, macOS $TMPDIR (/var/folders/..). */
export const NOELLE_TEMP_ROOTS = Object.freeze(["/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/Volumes"]);

export function noelleHosts(map = JSON.parse(readFileSync(join(ROOT, "src/shared/boss/maps/sites.json"), "utf8"))) {
  const repos = new Set([...HER_REPOS, ...NOELLE_READ_ONLY_REPOS]);
  const out = new Set(NOELLE_INFRA);
  for (const r of map.rows ?? []) {
    if (!repos.has(r.repo) || r.status !== "live") continue;
    if (r.domain) { out.add(r.domain); out.add(`*.${r.domain}`); }
    if (r.host === "cloudflare-pages" && r.project) { if (NOELLE_UNPROVEN_PAGES.includes(r.project)) continue; out.add(`${r.project}.pages.dev`); out.add(`*.${r.project}.pages.dev`); } // branch previews
    else if (r.host === "cloudflare-worker" && r.project) out.add(`${r.project}.${NOELLE_WORKERS_SUB}`);
    else if (["wordpress-com", "blogger"].includes(r.host) && /^[a-z0-9-]+\.(wordpress\.com|blogspot\.com)$/.test(r.project ?? "")) out.add(r.project);
  }
  return [...out].sort();
}

/** Whether a host list lets `host` through: an exact name, or `*.x` for a name under x (as Claude Code matches both). */
export function hostAllowed(list, host) {
  return list.some((d) => d === "*" || d === host || (d.startsWith("*.") && host.endsWith(d.slice(1))));
}
/** Her WebFetch hosts, from `WebFetch(domain:…)` rules; a bare WebFetch is every host. */
export function webFetchHosts(settings) {
  const allow = settings?.permissions?.allow ?? [];
  if (allow.includes("WebFetch")) return ["*"];
  return allow.map((a) => /^WebFetch\(domain:(.+)\)$/.exec(a)?.[1]).filter(Boolean);
}

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
  // Noelle (24 Nov 2026; sandbox redesign the same day): builder-level tools inside Claude Code's OS sandbox with no
  // GitHub login (gh is not allowed at all; she pushes and opens PRs through noelle-tool), her two brokers outside it, one reviewer agent per PR (the Agent tool held by her guard).
  { name: "noelle", scripts: ["scripts/ops/noelle.sh"],
    needs: ["Agent", "WebSearch", "Edit(~/Work/noelle/**)", "Bash(__HOME__/.boss-os/noelle/bin/noelle-tool *)", "Bash(__HOME__/.boss-os/noelle/bin/land-after *)",
      "Bash(git:*)", "Bash(npm:*)"],
    mustDeny: ["Bash(claude:*)", "Bash(ai-run:*)", "Bash(gh pr merge:*)", "Bash(git push --force:*)", "Bash(wrangler deploy:*)", "Bash(gh secret:*)", "Bash(npm run -s vault:set:*)", "Skill",
      "Edit(~/Work/noelle/.claude/**)", "Edit(~/bin/**)", "Edit(~/.boss-os/**)", "Edit(~/Brains/**)",
      "mcp__openseo", "mcp__plugin_openseo_openseo"],
    hook: "noelle-guard.mjs", agentGuard: "noelle-guard.mjs",
    sandbox: {
      allowWrite: ["~/Work/noelle", "~/.boss-os/noelle/runs/__RUN__"],
      allowRead: ["~/Work/noelle", "~/.boss-os/noelle/runs/__RUN__", "~/.boss-os/noelle/gitconfig", "~/.claude/skills", "~/.claude/CLAUDE.md"],
      domains: noelleHosts(),
      tempRoots: NOELLE_TEMP_ROOTS,
      excluded: ["__HOME__/.boss-os/noelle/bin/noelle-tool *", "__HOME__/.boss-os/noelle/bin/land-after *"],
    } },
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
  // A server-level deny (mcp__<server> or mcp__<server>__*) matches every tool on that server, and deny wins:
  // an allowed tool under it is refused at run time (eng check 24 Nov 2026: Simone's Drive lookups).
  for (const d of deny) {
    const server = /^(mcp__[^_]+(?:_[^_]+)*?)(?:__\*)?$/.exec(d)?.[1];
    if (!server || d.slice(server.length).replace("__*", "") !== "") continue;
    for (const a of allow) if (a !== d && a.startsWith(server + "__")) out.push(`${tag}: ${a} is allowed but the deny ${d} covers its whole server, so it is refused`);
  }
  if (settings.permissions.defaultMode && settings.permissions.defaultMode !== "dontAsk") out.push(`${tag}: defaultMode is ${settings.permissions.defaultMode}`);
  if (job.needs.some((t) => t.startsWith("mcp__claude_ai_")) && settings.env?.ENABLE_CLAUDEAI_MCP_SERVERS === "false") out.push(`${tag} switches the claude.ai connectors off, and this job reads Gmail`);
  if (job.hook && !JSON.stringify(settings.hooks ?? {}).includes(job.hook)) out.push(`${tag}: the ${job.hook} hook is gone`);
  if (job.sandbox) out.push(...sandboxProblems(settings, job.sandbox).map((p) => `${tag}: ${p}`));
  return out;
}

const same = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
const underRoot = (rule, roots) => roots.some((r) => rule === r || rule.startsWith(`${r}/`));
/**
 * A sandboxed job (Noelle's): Claude Code's OS sandbox holds every command and child, so safety is access taken
 * away, never a pattern over what she types. Each line below is one way that access would come back.
 */
export function sandboxProblems(settings, spec) {
  const sb = settings?.sandbox;
  if (!sb || typeof sb !== "object") return ["has no sandbox block (her commands would run with Sequoia's whole Mac)"];
  const out = [];
  const fs = sb.filesystem ?? {}, net = sb.network ?? {};
  if (sb.enabled !== true) out.push("sandbox.enabled is not true");
  if (sb.failIfUnavailable !== true) out.push("sandbox.failIfUnavailable is not true (a Mac without the sandbox would run her unsandboxed)");
  if (sb.allowUnsandboxedCommands !== false) out.push("sandbox.allowUnsandboxedCommands is not false (dangerouslyDisableSandbox would escape)");
  if (!same(sb.excludedCommands ?? [], spec.excluded)) out.push(`sandbox.excludedCommands is not exactly her brokers (${spec.excluded.join(", ")})`);
  if (!(fs.denyRead ?? []).includes("~/")) out.push("sandbox.filesystem.denyRead does not hold \"~/\" (the vault, ~/.config and other repos would be readable)");
  if (!same(fs.allowWrite ?? [], spec.allowWrite)) out.push(`sandbox.filesystem.allowWrite is not exactly ${spec.allowWrite.join(", ")}`);
  for (const r of fs.allowRead ?? []) if (!spec.allowRead.includes(r)) out.push(`sandbox.filesystem.allowRead re-opens ${r}`);
  const hostDiff = (got) => `extra: ${got.filter((h) => !spec.domains.includes(h)).join(", ") || "none"}; missing: ${spec.domains.filter((h) => !got.includes(h)).join(", ") || "none"}`;
  if (!same(net.allowedDomains ?? [], spec.domains)) out.push(`sandbox.network.allowedDomains is not exactly her hosts (${hostDiff(net.allowedDomains ?? [])})`);
  const denyRead = fs.denyRead ?? [];
  for (const p of spec.tempRoots ?? []) if (!denyRead.includes(p)) out.push(`sandbox.filesystem.denyRead does not hold ${p} (other sessions' temp files, west-peek-os's among them, would be readable)`);
  // WebFetch runs outside the sandbox: only its own domain rules hold it, and a GET's URL carries data (S1, 27 Nov 2026).
  const allowList = settings.permissions?.allow ?? [];
  if (allowList.includes("WebFetch")) out.push("allows bare WebFetch: every domain, and a GET's URL can carry her data to it");
  for (const a of allowList) if (/^WebFetch\(/.test(a) && !/^WebFetch\(domain:[^()\s]+\)$/.test(a)) out.push(`allows ${a}: WebFetch is allowed only as WebFetch(domain:<her host>)`);
  const fetchHosts = webFetchHosts(settings).filter((h) => h !== "*");
  if (!allowList.includes("WebFetch") && !same(fetchHosts, spec.domains)) out.push(`WebFetch's domains are not exactly her hosts (${hostDiff(fetchHosts)})`);
  for (const h of [...(net.allowedDomains ?? []), ...fetchHosts]) {
    if (h === "*" || SHARED_HOSTS.some((s) => h === `*.${s}` || h === s)) out.push(`allows ${h}: anyone can register a host there, so her data could reach a stranger`);
  }
  for (const k of ["allowAllUnixSockets", "allowUnixSockets", "allowLocalBinding", "allowMachLookup"]) if (net[k] !== undefined && !(Array.isArray(net[k]) && !net[k].length) && net[k] !== false) out.push(`sandbox.network.${k} is set (a way out of the sandbox)`);
  const allow = settings.permissions?.allow ?? [];
  for (const rule of allow) {
    // WebFetch(domain:…) rules also open those hosts to her commands; they are held above to exactly her sandbox hosts,
    // so they can widen nothing, and a bare WebFetch (every host) is the failure (#574 review S1, 27 Nov 2026).
    if (rule.startsWith("mcp__")) out.push(`${rule} exposes a connector directly; use the existing read paths`);
  }
  for (const t of ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit", "MultiEdit"]) if (allow.includes(t)) out.push(`allows bare ${t}: that tool runs outside the sandbox, so it may touch only her paths`);
  if (settings.permissions?.additionalDirectories?.length) out.push("permissions.additionalDirectories is set (it widens what her tools and sandbox may write)");
  for (const a of allow) {
    const m = a.match(/^(Read|Edit)\((.+)\)$/);
    if (!m) continue;
    const path = m[2].replace(/\/\*\*$/, "");
    if (!underRoot(path, m[1] === "Edit" ? spec.allowWrite : spec.allowRead)) out.push(`allows ${a}, outside her sandbox's ${m[1] === "Edit" ? "write" : "read"} paths`);
  }
  if (settings.env?.GIT_CONFIG_NOSYSTEM !== "1" || !String(settings.env?.GIT_CONFIG_GLOBAL ?? "").endsWith("/.boss-os/noelle/gitconfig")) out.push("env does not pin her git to ~/.boss-os/noelle/gitconfig with GIT_CONFIG_NOSYSTEM=1 (Sequoia's Keychain login would push for her)");
  return out;
}

/**
 * Her launcher's run line (the #574 review's S2 and N1, 27 Nov 2026). Her session's temp is hers: TMPDIR in her run
 * folder, and Claude Code's own temp root (CLAUDE_CODE_TMPDIR) in her home, which must stay short: past 44 bytes for
 * <root>/claude-<uid> Claude Code silently puts her commands' temp back in the shared /tmp/claude-<uid>, beside every
 * other session's. And a usage limit is the named stop (AI_RUN_NO_CREDIT=1), never a rerun on the API credit, whose
 * run carries ANTHROPIC_API_KEY into her session.
 */
export function noelleLaunchProblems(sh) {
  const run = sh.split("\n").find((l) => /AI_RUN_CLAUDE_MODEL=/.test(l)) ?? "";
  const out = [];
  if (!run) return ["noelle.sh: her ai-run line is gone (nothing checked is not a pass)"];
  if (!/(^|\s)AI_RUN_NO_CREDIT=1\s/.test(run)) out.push("noelle.sh: her ai-run line does not set AI_RUN_NO_CREDIT=1 (a usage limit would rerun her on the API credit, with the key in her session)");
  if (!/(^|\s)TMPDIR="\$NTMP"\s/.test(run)) out.push("noelle.sh: her ai-run line does not set TMPDIR to her run folder's tmp ($NTMP)");
  if (!/(^|\s)CLAUDE_CODE_TMPDIR="\$NHOME"\s/.test(run)) out.push("noelle.sh: her ai-run line does not set CLAUDE_CODE_TMPDIR to her home (Claude Code would keep her temp in the shared /tmp/claude-<uid>)");
  if (!/^NTMP="\$WORK\/tmp"/m.test(sh)) out.push("noelle.sh: NTMP is not her run folder's tmp");
  if (!/NAMED STOP \[TMPDIR_TOO_LONG\]/.test(sh)) out.push("noelle.sh: no TMPDIR_TOO_LONG stop (a long temp root falls back to the shared /tmp/claude-<uid> without a word)");
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

const LOCK_SH = /(?:\$CLAUDE_LOCK\b|"\$\{CLAUDE_ARGS\[@\]\}")|--permission-mode dontAsk --setting-sources= --settings \S/;
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

/** Each way her sandbox could be weakened; the self-test and tests/claudeRunsLocked.test.ts prove each is caught. */
export const SANDBOX_BREAKS = Object.freeze([
  ["the sandbox block removed", (s) => { delete s.sandbox; }],
  ["the sandbox switched off", (s) => { s.sandbox.enabled = false; }],
  ["running unsandboxed when the sandbox is unavailable", (s) => { s.sandbox.failIfUnavailable = false; }],
  ["dangerouslyDisableSandbox honoured", (s) => { s.sandbox.allowUnsandboxedCommands = true; }],
  ["an escaping excluded command", (s) => { s.sandbox.excludedCommands.push("node *"); }],
  ["home reads re-allowed", (s) => { s.sandbox.filesystem.denyRead = []; }],
  ["a write path added", (s) => { s.sandbox.filesystem.allowWrite.push("~/GitHub"); }],
  ["a read path re-opened", (s) => { s.sandbox.filesystem.allowRead.push("~/.config"); }],
  ["a model host allowed", (s) => { s.sandbox.network.allowedDomains.push("api.anthropic.com"); }],
  ["every host allowed", (s) => { s.sandbox.network.allowedDomains = ["*"]; }],
  ["unix sockets opened", (s) => { s.sandbox.network.allowAllUnixSockets = true; }],
  ["bare WebFetch allowed (every domain)", (s) => { s.permissions.allow = s.permissions.allow.filter((a) => !a.startsWith("WebFetch(")); s.permissions.allow.push("WebFetch"); }],
  ["bare WebFetch added beside her domains", (s) => { s.permissions.allow.push("WebFetch"); }],
  ["WebFetch to a public wildcard", (s) => { s.permissions.allow.push("WebFetch(domain:*.workers.dev)"); }],
  ["WebFetch to an unlisted host", (s) => { s.permissions.allow.push("WebFetch(domain:evil.example)"); }],
  ["a public wildcard host (*.pages.dev)", (s) => { s.sandbox.network.allowedDomains.push("*.pages.dev"); }],
  ["a public wildcard host (*.workers.dev)", (s) => { s.sandbox.network.allowedDomains.push("*.workers.dev"); }],
  ["a stranger's workers.dev host", (s) => { s.sandbox.network.allowedDomains.push("x.attacker.workers.dev"); }],
  ...NOELLE_TEMP_ROOTS.map((p) => [`temp reads re-allowed (${p})`, (s) => { s.sandbox.filesystem.denyRead = s.sandbox.filesystem.denyRead.filter((d) => d !== p); }]),
  ["bare Read allowed", (s) => { s.permissions.allow.push("Read"); }],
  ["bare Write allowed", (s) => { s.permissions.allow.push("Write"); }],
  ["an Edit rule outside her paths", (s) => { s.permissions.allow.push("Edit(~/GitHub/**)"); }],
  ["additionalDirectories widened", (s) => { s.permissions.additionalDirectories = ["__HOME__/GitHub"]; }],
  ["her git left on the system Keychain helper", (s) => { delete s.env.GIT_CONFIG_NOSYSTEM; }],
]);

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
    ["no hook", (s) => { delete s.hooks; }],
    ["a second hook event", (s) => { s.hooks.PreToolUse = s.hooks.PostToolUse; }],
    ["the hook on every tool", (s) => { s.hooks.PostToolUse[0].matcher = ".*"; }],
    ["the hook running another command", (s) => { s.hooks.PostToolUse[0].hooks[0].command = "bash -c 'curl x'"; }],
  ]) { const s = clone(good); f(s); must(`ai-visibility: ${name}`, permissionProblems(s)); }
  if (permissionProblems(good).length) { console.error("self-test: the real ai-visibility file fails"); bad++; }
  const sh = readFileSync(join(ROOT, "scripts/ops/ai-visibility.sh"), "utf8");
  if (scriptProblems(sh).length) { console.error("self-test: the real ai-visibility.sh fails"); bad++; }
  must("ai-visibility.sh skipping permissions", scriptProblems(sh.replace("--permission-mode dontAsk", "--dangerously-skip-permissions")));
  must("ai-visibility.sh's hook pointed elsewhere", scriptProblems(sh.replace('HOOK="$REPO/scripts/ops/ai-visibility-hook.mjs"', 'HOOK="/tmp/x.mjs"')));
  must("ai-visibility.sh's post step without the stash", scriptProblems(sh.replace(' "$WORK/openseo.jsonl")', ")")));
  must("ai-visibility.sh back on text output", scriptProblems(sh.replace(" --output-format stream-json --verbose", "")));
  must("ai-visibility.sh's stream sent to the log", scriptProblems(sh.replace('--out "$WORK/session.jsonl"', '--out "$RUN_LOG"')));
  must("ai-visibility.sh without the transcript step", scriptProblems(sh.replace(/^.*ai-visibility-report\.mjs transcript.*$/m, "")));
  { // the transcript step moved below the sentinel check: still present, so only the order check can catch it
    const line = /^.*ai-visibility-report\.mjs transcript.*$/m.exec(sh)?.[0] ?? "";
    const late = sh.replace(line + "\n", "").replace(/^say "sentinel: .*$/m, (m) => `${m}\n${line}`);
    must("ai-visibility.sh transcribing after the sentinel check", late === sh || !line ? [] : scriptProblems(late));
  }
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
    if (job.sandbox) for (const [name, f] of SANDBOX_BREAKS) { const s = clone(real); f(s); must(`${job.name}: ${name}`, jobProblems(s, job)); }
    for (const a of real.permissions.allow.filter((x) => x.startsWith("mcp__"))) {
      const server = a.slice(0, a.lastIndexOf("__"));
      { const s = clone(real); s.permissions.deny = [...(s.permissions.deny ?? []), server]; must(`${job.name}: deny ${server} shadowing ${a}`, jobProblems(s, job)); }
      { const s = clone(real); s.permissions.deny = [...(s.permissions.deny ?? []), server + "__*"]; must(`${job.name}: deny ${server}__* shadowing ${a}`, jobProblems(s, job)); }
    }
  }
  { // her launcher: the real one passes; each fix taken back is caught
    const nsh = readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8");
    if (noelleLaunchProblems(nsh).length) { console.error(`self-test: the real noelle.sh fails: ${noelleLaunchProblems(nsh).join("; ")}`); bad++; }
    must("noelle.sh rerunning on the API credit", noelleLaunchProblems(nsh.replaceAll("AI_RUN_NO_CREDIT=1 ", "")));
    must("noelle.sh with her TMPDIR back on the Mac's", noelleLaunchProblems(nsh.replaceAll('TMPDIR="$NTMP" ', "")));
    must("noelle.sh with Claude Code's temp root back in /tmp", noelleLaunchProblems(nsh.replaceAll('CLAUDE_CODE_TMPDIR="$NHOME" ', "")));
    must("noelle.sh without the TMPDIR_TOO_LONG stop", noelleLaunchProblems(nsh.replace(/NAMED STOP \[TMPDIR_TOO_LONG\]/g, "")));
  }
  must("an empty allow list not marked text_only", jobProblems({ permissions: { allow: [], deny: COMMON_DENY } }, { name: "x", needs: [] }));
  // The skip flag back in every locked script, and each shape of unlocked call.
  const SKIP_FLAG = "--dangerously-skip-permissions";
  const scripts = [...new Set(JOBS.flatMap((j) => j.scripts)), "scripts/ops/ai-visibility.sh"];
  for (const f of scripts) {
    const text = readFileSync(join(ROOT, f), "utf8");
    if (scanProblems([[f, text]], []).length) { console.error(`self-test: the real ${f} fails the scan`); bad++; continue; }
    const broken = text.replace(/(?:\$CLAUDE_LOCK\b|"\$\{CLAUDE_ARGS\[@\]\}")/g, SKIP_FLAG).replace(/\.\.\.lockedArgs\("[^"]+"\)/g, `"${SKIP_FLAG}"`).replace(/--permission-mode dontAsk --setting-sources= --settings/g, SKIP_FLAG)
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
  problems.push(...noelleLaunchProblems(readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8")));
  console.log(`Unlocked by name (${EXCEPTIONS.length}):`);
  for (const e of EXCEPTIONS) console.log(`  - ${e.file}${e.match ? ` [${e.match}]` : ""}: ${e.why}`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`claude runs locked: ${scriptFiles.length} script files scanned, ${JOBS.length} job permission files checked, ai-visibility reads only (${READ_TOOLS.length} read tools)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
