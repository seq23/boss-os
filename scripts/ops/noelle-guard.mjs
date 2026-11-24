#!/usr/bin/env node
/**
 * NOELLE'S GUARD (24 Nov 2026; replaces scripts/validate/noelle-no-tools.mjs, the old tool cage). A Claude
 * Code PreToolUse hook on every tool of HER run only (her home's .claude/settings.json, written by
 * scripts/ops/noelle.sh from scripts/ops/noelle-permissions.json, which locks her run to builder-level tools).
 * It holds, by name, only the hard stops her brief lists, each a NAMED STOP she reads in the refusal:
 *
 *   PAID_API             a paid model or API (Anthropic, OpenAI, OpenRouter, Gemini API, Together, Groq …)
 *   MONEY                a payment, checkout, subscription or ad-spend endpoint, or a money MCP tool
 *   SECRETS_PRINTED      printing the environment or a secret, a secret on a command line, the vault used directly
 *                        (her vault tools go through ~/Work/noelle/bin/noelle-tool only)
 *   DEPLOY_ONLY_LAND     wrangler deploy/publish, gh pr merge, a push to main/master, store or hosting deploys:
 *                        she deploys only with land / land-after
 *   OTHER_BUSINESS_REPO  a repo that is not one of her businesses' (another agent's worktree included)
 *   PROTECTED            an edit to Boss OS, her guard and settings, the rules file, ~/bin or the brains
 *   PRIVATE_BRAIN        a brain read any way but `noelle-tool brain <slug>` (that one holds H1's list)
 *   AGENT                any agent but ONE fresh `reviewer` per PR she opened this run (H2)
 *   PR_CAP               a 4th PR in one run (H6)
 *   CONTEXT_HANDOFF      after her context was compacted (~200K), anything but writing her handoff and notes
 *
 * Exit 2 with the reason on stderr refuses the call (Claude Code's contract). Input it cannot parse is
 * REFUSED (fail closed: this guard runs only on her autonomous run). `--self-test` proves every stop.
 * `--precompact` is her PreCompact hook: it marks the run compacted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HOME = homedir();
export const NOELLE_HOME = () => process.env.NOELLE_HOME ?? join(HOME, "Work", "noelle");

/** Her businesses' repos (Full and search-watch; brief 24 Nov 2026). Anything else is not hers. */
export const HER_REPOS = Object.freeze([
  "p-n-p", "approvalprep", "aplayer-mode", "sprylabs-hpc-site", "peace-be-still", "creator-studios",
  "dream-wedding-builder", "keepmyproof", "search-loop",
  "local-guides-generator", "WPP-llm", "hicks-consulting-canonical", "horse-legal-guide-velocity",
]);
export const MAX_PRS = 3;

const PAID = /\b(api\.anthropic\.com|api\.openai\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.together\.(xyz|ai)|api\.groq\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|api\.perplexity\.ai|api\.replicate\.com|api\.elevenlabs\.io)\b|@anthropic-ai\/sdk|\bpip3? install (anthropic|openai)\b|\bnpm (i|install) [^\n]*\b(openai|@anthropic-ai\/sdk)\b/i;
const MONEY = /\b(api\.stripe\.com|stripe (charges|checkout|payment_intents|subscriptions|invoices|prices)|api(-m)?\.paypal\.com|api\.lemonsqueezy\.com|api\.gumroad\.com\/v2\/(sales|offer)|graph\.facebook\.com\/[^\s]*\/(ads|adsets|campaigns|adcreatives)|ads-api\.(pinterest|tiktok)\.com|business-api\.tiktok\.com|googleads\.googleapis\.com|api\.buffer\.com\/[^\s]*(billing|subscription|plan))\b|\/v1\/checkout\b/i;
const MONEY_TOOL = /^mcp__(8raise__|.*(billing|checkout|payment|subscription|purchase|invoice|charge))/i;
const SECRET_SHOW = [
  /(^|[;&|(]\s*)(printenv|env|set|export -p|declare -x)\s*($|[;&|>)])/m,
  /\becho\b[^\n;|]*\$\{?[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD|PASS|PAT)\b/,
  /\bprintf\b[^\n;|]*\$\{?[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)\b/,
  /\bsecurity\s+find-(generic|internet)-password\b[^\n]*\s-w\b/,
  /\b(cat|less|more|head|tail|bat|grep)\b[^\n;|]*(^|[\s/])\.env(\.[\w.-]+)?(\s|$)/m,
  /\bgh\s+secret\s+set\b[^\n]*(--body|-b)\b/,
  /\bwrangler\s+secret\s+put\b/,
  /\bvault:(status|set|run|get|list)\b/,
  /\b(sk-ant-|sk-proj-|sk-|ghp_|gho_|github_pat_|xox[bap]-|AIza)[A-Za-z0-9_-]{12,}/,
];
const DEPLOY = /\bwrangler\s+(deploy|publish|versions\s+deploy|pages\s+deploy|pages\s+publish)\b|\bgh\s+pr\s+merge\b|\bgit\s+push\b[^\n;&|]*\b(main|master)\b|\beas\s+(submit|update)\b|\bvercel\b[^\n;&|]*--prod\b|\bfirebase\s+deploy\b|\bnetlify\s+deploy\b[^\n;&|]*--prod|\bnpm\s+run\s+(-s\s+)?deploy\b|\bfastlane\b/i;
const WRITE_VERB = /(>{1,2}\s*\S|\btee\b|\bcp\b|\bmv\b|\brm\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\bchmod\b|\bchown\b|\bln\b|\binstall\b|\btouch\b|\bmkdir\b|\bgit\s+(-C\s+\S+\s+)?(commit|push|checkout|reset|apply|am|worktree|add|rm|mv|restore|stash)\b|\bnpm\s+(i|install|run)\b|\bpython3?\b|\bnode\b)/;

const home = (s) => String(s ?? "").replace(/\$\{HOME\}|\$HOME|(^|[\s"'=:(])~(?=\/)/g, (m, p) => (p !== undefined && m.endsWith("~") ? `${p}${HOME}` : HOME));
const abs = (p, cwd) => resolve(cwd || NOELLE_HOME(), home(p));

/** Protected roots: never written by her (code: this guard). */
export function protectedRoots() {
  const h = NOELLE_HOME();
  return [join(HOME, ".claude"), join(HOME, "bin"), join(HOME, ".boss-os"), join(HOME, "Brains"), join(HOME, ".codex"), join(h, ".claude"), join(h, ".run"), join(h, "bin"), join(HOME, "GitHub", "boss-os")];
}
const under = (p, root) => p === root || p.startsWith(`${root}/`);

/** The repo a path under ~/GitHub names, or null (her worktrees `.wt-noelle-*` are hers). */
export function repoOfPath(p) {
  const m = String(p).match(new RegExp(`^${HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/GitHub/([^/]+)`));
  if (!m) return null;
  return m[1];
}
export function repoAllowed(name) {
  if (!name) return true;
  if (/^\.wt-noelle-[\w.-]+$/.test(name)) return true;
  return HER_REPOS.includes(name);
}

function state(h = NOELLE_HOME()) {
  try { return JSON.parse(readFileSync(join(h, ".run", "run.json"), "utf8")); } catch { return { prs: 0, reviewers: 0 }; }
}
function saveState(s, h = NOELLE_HOME()) {
  mkdirSync(join(h, ".run"), { recursive: true });
  writeFileSync(join(h, ".run", "run.json"), JSON.stringify(s));
}
const compacted = (h = NOELLE_HOME()) => existsSync(join(h, ".run", "compacted"));

/** Every ~/GitHub/<repo> and seq23/<repo> a command names. */
export function reposIn(cmd) {
  const c = home(cmd);
  const out = new Set();
  for (const m of c.matchAll(new RegExp(`${HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/GitHub/([^/\\s"';|&)]+)`, "g"))) out.add(m[1]);
  for (const m of c.matchAll(/\bseq23\/([A-Za-z0-9_.-]+)/g)) out.add(m[1].replace(/\.git$/, ""));
  return [...out];
}

/**
 * The verdict on one tool call: null (let through) or { stop, why }. `mutate` = false for a dry check.
 */
export function judge(input, { h = NOELLE_HOME(), mutate = true } = {}) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  const cwd = String(input?.cwd ?? h);
  if (!tool) return { stop: "GUARD_UNREAD", why: "the hook input named no tool" };
  const st = state(h);

  if (compacted(h)) {
    const okPath = (p) => { const a = abs(p, cwd); return a === join(h, "HANDOFF.md") || a.startsWith(join(h, "notes") + "/") || a.startsWith(join(h, "tasks") + "/"); };
    if (["Read", "Grep", "Glob"].includes(tool)) return null;
    if (["Write", "Edit"].includes(tool) && okPath(ti.file_path)) return null;
    return { stop: "CONTEXT_HANDOFF", why: "your context reached ~200K: write ~/Work/noelle/HANDOFF.md and today's note, then end with your OUTPUT line; the next run carries on" };
  }

  if (MONEY_TOOL.test(tool)) return { stop: "MONEY", why: `${tool} is a money tool; any spend is Sequoia's call` };
  if (tool === "Agent" || tool === "Task") {
    if (ti.subagent_type !== "reviewer") return { stop: "AGENT", why: `only a fresh "reviewer" agent, one per PR you opened this run (asked for "${ti.subagent_type ?? "general-purpose"}")` };
    if ((st.reviewers ?? 0) >= (st.prs ?? 0)) return { stop: "AGENT", why: `one reviewer per PR: ${st.prs ?? 0} PR(s) opened this run, ${st.reviewers ?? 0} reviewer(s) already launched` };
    if (mutate) saveState({ ...st, reviewers: (st.reviewers ?? 0) + 1 }, h);
    return null;
  }

  const paths = ["file_path", "path", "notebook_path"].map((k) => ti[k]).filter((x) => typeof x === "string").map((p) => abs(p, cwd));
  for (const p of paths) {
    if (under(p, join(HOME, "Brains"))) return { stop: "PRIVATE_BRAIN", why: "brains are read only with `noelle-tool brain <slug>` (yours: spry, porch-and-party, time-2-read, personal, team, risk)" };
    const repo = repoOfPath(p);
    const writes = ["Write", "Edit", "NotebookEdit", "MultiEdit"].includes(tool);
    if (writes && protectedRoots().some((r) => under(p, r))) return { stop: "PROTECTED", why: `${p} is Boss OS, your guard, the rules or the brains: never edited from your run` };
    if (repo && !repoAllowed(repo) && !(repo === "boss-os" && !writes)) return { stop: "OTHER_BUSINESS_REPO", why: `${repo} is not one of your businesses' repos` };
  }
  if (tool === "WebFetch" || tool === "WebSearch") {
    const u = String(ti.url ?? ti.query ?? "");
    if (PAID.test(u)) return { stop: "PAID_API", why: "a paid model or API; never used (her rule: never a paid API)" };
    if (MONEY.test(u)) return { stop: "MONEY", why: "a payment or ad-spend endpoint; any spend is Sequoia's call" };
    return null;
  }
  if (tool !== "Bash") return null;

  const cmd = String(ti.command ?? "");
  if (!cmd.trim()) return { stop: "GUARD_UNREAD", why: "an empty command" };
  const c = home(cmd);
  if (PAID.test(c)) return { stop: "PAID_API", why: "a paid model or API; never used (her rule: never a paid API)" };
  if (MONEY.test(c)) return { stop: "MONEY", why: "a payment or ad-spend endpoint; any spend is Sequoia's call" };
  if (SECRET_SHOW.some((re) => re.test(c))) return { stop: "SECRETS_PRINTED", why: "this prints or passes a secret; secrets stay in the Boss OS vault (your tools: noelle-tool brain|notice|ledger)" };
  if (DEPLOY.test(c)) return { stop: "DEPLOY_ONLY_LAND", why: "deploys and merges go only through `land-after <pr> --task noelle-<job>`" };
  if (/(^|[\s/"'])Brains\/|\/api\/boss\/brains\b/.test(c)) return { stop: "PRIVATE_BRAIN", why: "brains are read only with `noelle-tool brain <slug>`" };
  for (const r of reposIn(c)) if (!repoAllowed(r)) return { stop: "OTHER_BUSINESS_REPO", why: `${r} is not one of your businesses' repos` };
  if (WRITE_VERB.test(c) && protectedRoots().some((r) => c.includes(r))) return { stop: "PROTECTED", why: "Boss OS, your guard and settings, the rules file, ~/bin and the brains are never changed from your run" };
  if (/\bgh\s+pr\s+create\b/.test(c)) {
    if ((st.prs ?? 0) >= MAX_PRS) return { stop: "PR_CAP", why: `${MAX_PRS} PRs is the most in one run; write the rest into your handoff` };
    if (mutate) saveState({ ...st, prs: (st.prs ?? 0) + 1 }, h);
  }
  return null;
}

export const CASES = [
  // [tool_name, tool_input, expected stop or null]
  ["Bash", { command: "git status --short" }, null],
  ["Bash", { command: "curl -s https://api.anthropic.com/v1/messages -d @x.json" }, "PAID_API"],
  ["Bash", { command: "node -e \"fetch('https://api.openai.com/v1/chat/completions')\"" }, "PAID_API"],
  ["WebFetch", { url: "https://generativelanguage.googleapis.com/v1beta/models" }, "PAID_API"],
  ["Bash", { command: "curl https://api.stripe.com/v1/charges -u x:" }, "MONEY"],
  ["Bash", { command: "curl -X POST https://graph.facebook.com/v19.0/act_1/adsets" }, "MONEY"],
  ["mcp__8raise__get_billing_info", {}, "MONEY"],
  ["Bash", { command: "printenv" }, "SECRETS_PRINTED"],
  ["Bash", { command: "env | grep TOKEN" }, "SECRETS_PRINTED"],
  ["Bash", { command: "echo $BUFFER_PEACEBESTILL_ACCESS_TOKEN" }, "SECRETS_PRINTED"],
  ["Bash", { command: "security find-generic-password -s x -w" }, "SECRETS_PRINTED"],
  ["Bash", { command: "cat .env" }, "SECRETS_PRINTED"],
  ["Bash", { command: "cd ~/GitHub/boss-os && npm run -s vault:run -- node x.mjs" }, "SECRETS_PRINTED"],
  ["Bash", { command: "gh secret set X --body abc" }, "SECRETS_PRINTED"],
  ["Bash", { command: "npx wrangler deploy" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "gh pr merge 12 --squash" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "git push origin HEAD:main" }, "DEPLOY_ONLY_LAND"],
  ["Bash", { command: "land-after 12 --task noelle-pbs" }, null],
  ["Bash", { command: "git push -u origin noelle-pbs-drama" }, null],
  ["Bash", { command: "cd ~/GitHub/west-peek-os && git log" }, "OTHER_BUSINESS_REPO"],
  ["Bash", { command: "gh pr list --repo seq23/brokerage-desk" }, "OTHER_BUSINESS_REPO"],
  ["Bash", { command: "git -C ~/GitHub/.wt-boss-os-x status" }, "OTHER_BUSINESS_REPO"],
  ["Bash", { command: "git -C ~/GitHub/peace-be-still worktree add ~/GitHub/.wt-noelle-pbs -b noelle-pbs origin/main" }, null],
  ["Edit", { file_path: "~/GitHub/west-peek-os/README.md" }, "OTHER_BUSINESS_REPO"],
  ["Write", { file_path: "~/.claude/CLAUDE.md" }, "PROTECTED"],
  ["Edit", { file_path: "~/GitHub/boss-os/scripts/ops/noelle-guard.mjs" }, "PROTECTED"],
  ["Bash", { command: "echo '{}' > ~/Work/noelle/.claude/settings.json" }, "PROTECTED"],
  ["Read", { file_path: "~/GitHub/boss-os/docs/boss/OPERATIONS.md" }, null],
  ["Read", { file_path: "~/Brains/brokerage.md" }, "PRIVATE_BRAIN"],
  ["Bash", { command: "cat ~/Brains/west-peek-ventures.md" }, "PRIVATE_BRAIN"],
  ["Bash", { command: "noelle-tool brain porch-and-party" }, null],
  ["Agent", { subagent_type: "builder", prompt: "x" }, "AGENT"],
  ["Agent", { subagent_type: "reviewer", prompt: "x" }, "AGENT"],
  ["Write", { file_path: "~/Work/noelle/notes/2026-11-25.md" }, null],
];

function selfTest() {
  const h = join(process.env.TMPDIR ?? "/tmp", `noelle-guard-self-test-${process.pid}`);
  mkdirSync(join(h, ".run"), { recursive: true });
  writeFileSync(join(h, ".run", "run.json"), JSON.stringify({ prs: 0, reviewers: 0 }));
  let bad = 0;
  const check = (label, got, want) => { if ((got?.stop ?? null) !== want) { bad++; console.log(`FAIL ${label}: want ${want}, got ${got?.stop ?? "null"}`); } };
  for (const [tool, ti, want] of CASES) check(`${tool} ${JSON.stringify(ti).slice(0, 80)}`, judge({ tool_name: tool, tool_input: ti, cwd: h }, { h }), want);
  // PR cap and one reviewer per PR.
  for (let i = 1; i <= MAX_PRS; i++) check(`PR ${i}`, judge({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" }, cwd: h }, { h }), null);
  check("PR 4", judge({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" }, cwd: h }, { h }), "PR_CAP");
  for (let i = 1; i <= MAX_PRS; i++) check(`reviewer ${i}`, judge({ tool_name: "Agent", tool_input: { subagent_type: "reviewer" }, cwd: h }, { h }), null);
  check("reviewer 4", judge({ tool_name: "Agent", tool_input: { subagent_type: "reviewer" }, cwd: h }, { h }), "AGENT");
  // After the compaction marker: only the handoff and notes.
  writeFileSync(join(h, ".run", "compacted"), "1");
  check("after compaction: a command", judge({ tool_name: "Bash", tool_input: { command: "git status" }, cwd: h }, { h }), "CONTEXT_HANDOFF");
  check("after compaction: the handoff", judge({ tool_name: "Write", tool_input: { file_path: join(h, "HANDOFF.md") }, cwd: h }, { h }), null);
  check("no tool", judge({}, { h }), "GUARD_UNREAD");
  const n = CASES.length + 2 * MAX_PRS + 5;
  if (bad) { console.log(`NAMED STOP [GUARD_SELF_TEST] ${bad} of ${n} checks failed`); process.exit(1); }
  console.log(`OUTPUT: noelle-guard self-test ${n} checks passed`);
}

function main() {
  const arg = process.argv[2];
  if (arg === "--self-test") return selfTest();
  if (arg === "--precompact") {
    mkdirSync(join(NOELLE_HOME(), ".run"), { recursive: true });
    writeFileSync(join(NOELLE_HOME(), ".run", "compacted"), String(Date.now()));
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
