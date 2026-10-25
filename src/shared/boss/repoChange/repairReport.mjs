/**
 * ─── THE ONE SHORT REPORT A REPAIR SENDS (owner, 25 Oct 2026) ──────────────
 *
 * A repair Boss OS opened itself is built and landed without asking her (lane.mjs
 * `planWaitsForOwner`). Afterwards Danielle sends at most one short email, and Sequoia read the
 * first ones and had no idea what had been repaired. So the report is written for a non-technical
 * owner, in three labelled parts and nothing else:
 *
 *   What broke:   one sentence on what she would have noticed.
 *   What we did:  one sentence.
 *   Status:       live, or still working, with the date.
 *
 * No code words reach her: no file names, flags, validators, "fence", "cleaner", "envelope",
 * backticks or markdown, and no sentence over 25 words. The plan phase writes the two sentences
 * (`in_plain.what_broke` / `in_plain.what_we_did`); a sentence that fails `ownerTextProblems` is
 * replaced by the stock sentence for the repair's kind, so the report is plain by construction and
 * never held. tests/boss/repairsNeverWait.test.ts runs every kind through the check.
 */

/** The longest sentence she is sent. */
export const MAX_WORDS_PER_LINE = 25;

/**
 * Words that mean something only inside Boss OS or a code base. A whole word, any case. The list
 * is the owner's own complaint (validator, fence, cleaner, envelope, flag) plus the vocabulary of
 * the repo lane itself.
 */
export const CODE_WORDS = Object.freeze([
  "validator", "validators", "validate", "fence", "cleaner", "envelope", "flag", "flags", "backtick", "backticks",
  "markdown", "repo", "repos", "repository", "branch", "commit", "commits", "merge", "merged", "rebase", "worktree",
  "pr", "prs", "pull request", "ci", "pipeline", "deploy", "deployed", "wrangler", "worker", "workers", "d1",
  "migration", "migrations", "schema", "json", "yaml", "api", "endpoint", "regex", "script", "scripts", "cli",
  "prompt", "prompts", "backend", "backends", "codex", "claude", "llm", "model", "token", "tokens", "lint",
  "typecheck", "unit test", "test", "tests", "self-test", "cron", "launchd", "plist", "vault", "env", "config",
  "payload", "gate", "guard", "stack trace", "null", "undefined", "exit code", "stderr", "stdout", "sha",
  "layout", "template", "function", "module", "lane", "seat", "executor", "runner", "tick",
]);

const CODE_WORD_RE = new RegExp(`(?<![\\w-])(?:${CODE_WORDS.map((w) => w.replace(/[-]/g, "\\-").replace(/\s+/g, "\\s+")).join("|")})(?![\\w-])`, "i");
/** report.mjs, plain.ts, ~/.boss-os/x, scripts/ops/y — anything with a file extension or a path. */
const FILE_RE = /(?:^|[\s("'])(?:[~.]?\/[\w.-]+(?:\/[\w.-]+)*|[\w-]+\/[\w./-]+|[\w-]+\.(?:m?js|ts|tsx|json|md|sql|sh|py|toml|ya?ml|plist|html|css|log|txt))(?=$|[\s)"',.;:!?])/i;
const FLAG_RE = /(?:^|\s)--?[a-z][\w-]*/i;
const MARKDOWN_RE = /`|\*\*|__|^\s*#{1,6}\s|^\s*[-*+]\s|\[[^\]]*\]\([^)]*\)|^\s*>\s|^\s*\d+\.\s/m;
const SNAKE_OR_CAMEL_RE = /\b[a-z]+_[a-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/;
const ID_RE = /\b(?:rc|tsk|dd|cw|kml|iml|emp|apr|yd)_[a-z0-9]{3,}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/i;

/** What is wrong with text meant for her, line by line. Empty means it may go. */
export function ownerTextProblems(text) {
  const problems = [];
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) problems.push("empty");
  for (const line of lines) {
    const words = line.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (words > MAX_WORDS_PER_LINE) problems.push(`over ${MAX_WORDS_PER_LINE} words (${words}): "${line.slice(0, 60)}…"`);
    const code = CODE_WORD_RE.exec(line);
    if (code) problems.push(`code word "${code[0]}"`);
    const file = FILE_RE.exec(line);
    if (file) problems.push(`file name "${file[0].trim()}"`);
    const flag = FLAG_RE.exec(line.replace(/\s[—–-]\s/g, " "));
    if (flag) problems.push(`flag "${flag[0].trim()}"`);
    if (MARKDOWN_RE.test(line)) problems.push(`markdown in "${line.slice(0, 40)}"`);
    const ident = SNAKE_OR_CAMEL_RE.exec(line);
    if (ident) problems.push(`code name "${ident[0]}"`);
    const id = ID_RE.exec(line);
    if (id) problems.push(`internal id "${id[0]}"`);
  }
  return [...new Set(problems)];
}

/** One sentence she can read, or null when the model's sentence fails the check. */
export function plainSentence(s) {
  const one = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!one) return null;
  const ended = /[.!?]$/.test(one) ? one : `${one}.`;
  return ownerTextProblems(ended).length ? null : ended;
}

/** The stock sentences, by repair kind: what she would have noticed, and what was done. */
export const STOCK = Object.freeze({
  held_mail: { broke: "An email we meant to send you was stopped before it reached you.", did: "We found why it was stopped and fixed it, so emails like it now reach you." },
  failed_task: { broke: "A job one of your team was doing stopped before it finished.", did: "We found what stopped it, fixed it, and set the job to run again." },
  refused_run: { broke: "A job was turned down by the helper that was meant to do it.", did: "We changed how the job is asked for, so it is accepted now." },
  red_check: { broke: "One of our automatic checks found a problem after an update.", did: "We fixed the problem the check found and the check passes again." },
  self_repair: { broke: "Part of Boss OS stopped doing its job properly.", did: "We found the cause and fixed it." },
  rework: { broke: "A step that runs after an update did not finish.", did: "We fixed the step and ran it again." },
});
const STOCK_DEFAULT = { broke: "Something in Boss OS stopped working properly.", did: "We found the cause and fixed it." };

/** "Sunday 25 October", in New York time, the way she reads a date. */
export function dayWords(ms) {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", day: "numeric", month: "long" })
    .replace(/^(\w+), (\w+) (\d+)$/, "$1 $3 $2");
}

/**
 * The report itself: { subject, whatBroke, whatWeDid, status, text }. `live` true once it landed
 * and was proven; false while it is still being worked on.
 */
export function repairReport({ kind, whatBroke = null, whatWeDid = null, live, at = Date.now(), who = "Danielle" }) {
  const stock = STOCK[kind] ?? STOCK_DEFAULT;
  const broke = plainSentence(whatBroke) ?? stock.broke;
  const did = plainSentence(whatWeDid) ?? stock.did;
  const status = live ? `Live since ${dayWords(at)}. Nothing needed from you.` : `Still working on it, as of ${dayWords(at)}. Nothing needed from you.`;
  const subject = live ? "Fixed: something that had stopped working" : "Fixing: something that had stopped working";
  const text = [`What broke: ${broke}`, `What we did: ${did}`, `Status: ${status}`, "", `— ${who}`].join("\n");
  return { subject, whatBroke: broke, whatWeDid: did, status, text };
}
