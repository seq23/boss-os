#!/usr/bin/env node
/**
 * DIFFERENT CAUSES MAY NOT SHARE A MESSAGE.
 *
 * ─── The sentence this exists because of ───────────────────────────────────
 *
 * `kdp-surface-prompt.md` told Simone: "if the browser is unreachable her laptop is shut, and that
 * is reported rather than treated as a finding."
 *
 * One sentence, mapping EVERY possible browser failure onto one harmless explanation. On
 * 9 September 2026 a detached probe proved the real cause: a `claude -p` run has no Chrome tools at
 * all — `TOOLS=no`, they do not exist in the process — so the watcher could never have uploaded a
 * cover on any Friday with any tab open. It had been reporting that permanent, structural absence as
 * a closed laptop, which is the most effective way imaginable to guarantee nobody ever looks.
 *
 * That is the defect this file guards, and it is a general one: a diagnosis that cannot distinguish
 * "this can never work" from "it did not work today" turns a bug into weather.
 *
 * ─── The two rules ─────────────────────────────────────────────────────────
 *
 * 1. NO PROMPT MAY EXPLAIN A BROWSER FAILURE WITH A SHUT LAPTOP as its sole account. The phrase is
 *    allowed only where the file also names the structural case, so the reader is choosing between
 *    causes rather than being handed one.
 * 2. THE BROWSER HARNESS MUST KEEP ITS OUTCOMES DISTINCT. Four named outcomes, four different
 *    messages, four different exit codes. Collapsing any two of them rebuilds the defect inside the
 *    thing that replaced it.
 *
 * RULE 0: it exits non-zero if it finds no prompts and no harness — a scan that examined nothing is
 * broken, not clean.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

/**
 * BOTH HARNESSES, because there are two and they answer for different things.
 *
 * `browser.mjs` is the shared launcher every employee now uses; `kdp-browser.mjs` is the thin KDP
 * caller that keeps its own `KDP-BROWSER:` line because `kdp-watch.sh` parses it. Checking only one
 * of them would let the other collapse its outcomes silently — which is this validator's own defect
 * class, applied to itself.
 */
const HARNESSES = [
  {
    path: "scripts/ops/browser.mjs",
    /* Five facts, five sentences, five exit codes. WOKE_LATE is deliberately not in this list: it is
     * printed BESIDE an outcome rather than instead of one, so it has no `say()` call to compare. */
    outcomes: ["BROWSER_OK", "SESSION_EXPIRED", "BROWSER_UNAVAILABLE", "SITE_UNREACHABLE"],
  },
  {
    path: "scripts/ops/kdp-browser.mjs",
    outcomes: ["BROWSER_OK", "KDP_SESSION_EXPIRED", "BROWSER_UNAVAILABLE", "KDP_UNREACHABLE"],
  },
];
const HARNESS = HARNESSES[0].path;
const OUTCOMES = HARNESSES[0].outcomes;

/** The benign explanation that must never stand alone. */
const LAZY = /laptop (may be |is )?shut|laptop is closed/i;
/** Evidence that the file also names the case a shut laptop cannot explain. */
const NAMES_STRUCTURAL = /TOOLS=no|no browser MCP|has no Chrome tools|no browser connection|structural/i;

function scanPrompts(files, read) {
  const bad = [];
  let examined = 0;
  for (const f of files) {
    const src = read(f);
    if (!LAZY.test(src)) { examined += 1; continue; }
    examined += 1;
    if (!NAMES_STRUCTURAL.test(src)) {
      bad.push(`${f} explains a browser failure with a shut laptop and never names the case where the browser does not exist at all.`);
    }
  }
  return { bad, examined };
}

function scanHarness(src, outcomes = OUTCOMES) {
  const bad = [];
  if (!src) return { bad: ["the browser harness is missing entirely"], messages: 0 };
  const OUTCOMES = outcomes;
  const messages = new Set();
  /*
   * SPLIT ON THE REPORTING CALL RATHER THAN MATCHING AROUND IT. The messages are multi-line and
   * concatenated, and a regex clever enough to bracket them is a regex that silently matches nothing
   * the first time somebody reformats the file — which is the failure this validator exists to
   * prevent, applied to itself.
   */
  const calls = src.split("say(").slice(1);
  for (const outcome of OUTCOMES) {
    const uses = calls.filter((c) => c.trimStart().startsWith(`"${outcome}"`));
    if (uses.length === 0) { bad.push(`${outcome} is never reported by the harness.`); continue; }
    for (const u of uses) {
      // Everything after the outcome name is this cause's own sentence.
      messages.add(u.trimStart().slice(outcome.length + 2).replace(/\s+/g, " ").trim().slice(0, 160));
    }
  }
  // Four outcomes reported with fewer than four distinct texts means two causes share a message.
  if (messages.size < OUTCOMES.length) {
    bad.push(`only ${messages.size} distinct messages across ${OUTCOMES.length} outcomes — two causes are sharing one sentence.`);
  }
  return { bad, messages: messages.size };
}

if (SELF_TEST) {
  const prompts = {
    "bad.md": "if the browser is unreachable her laptop is shut, and that is reported.",
    "good.md": "TOOLS=no means this run has no Chrome tools at all. Separately, her laptop may be shut.",
    "quiet.md": "nothing about browsers here",
  };
  const p = scanPrompts(Object.keys(prompts), (f) => prompts[f]);
  const fail = [];
  if (!p.bad.some((x) => x.startsWith("bad.md"))) fail.push("the lone shut-laptop explanation was not caught");
  if (p.bad.some((x) => x.startsWith("good.md"))) fail.push("a file naming both causes was flagged");
  if (p.examined !== 3) fail.push("the prompt scan did not examine every file");

  const collapsed = OUTCOMES.map((o) => `say("${o}", SAME, 1)`).join("\n");
  if (scanHarness(collapsed).bad.length === 0) fail.push("a harness collapsing four outcomes into one message passed");
  if (scanHarness("").bad.length === 0) fail.push("a missing harness passed");

  if (fail.length) {
    console.error("ONE-CAUSE-ONE-MESSAGE SELF-TEST FAILED:");
    for (const x of fail) console.error("  ✗", x);
    process.exit(1);
  }
  console.log("one-cause self-test: 5 fixtures, the scan catches a lone benign explanation and a collapsed outcome set.");
  process.exit(0);
}

const promptFiles = readdirSync(join(ROOT, "scripts/ops"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `scripts/ops/${f}`);
const prompts = scanPrompts(promptFiles, (f) => readFileSync(join(ROOT, f), "utf8"));
const harness = { bad: [], messages: 0 };
for (const h of HARNESSES) {
  const src = existsSync(join(ROOT, h.path)) ? readFileSync(join(ROOT, h.path), "utf8") : "";
  const r = scanHarness(src, h.outcomes);
  harness.bad.push(...r.bad.map((x) => `${h.path}: ${x}`));
  harness.messages += r.messages;
}

if (prompts.examined === 0) {
  console.error("ONE-CAUSE SCAN EXAMINED NOTHING: no prompt files under scripts/ops.");
  console.error("They have moved. That is a broken scan, not a clean repo.");
  process.exit(2);
}

const bad = [...prompts.bad, ...harness.bad];
if (bad.length) {
  console.error("A CAUSE WITHOUT ITS OWN MESSAGE:");
  for (const x of bad) console.error("  ✗", x);
  console.error("\n  'It can never work' and 'it did not work today' are different findings. Only one is benign.");
  process.exit(1);
}

console.log(
  `one cause, one message: ${prompts.examined} prompt(s) examined, ${HARNESSES.length} harnesses, ` +
  `${HARNESSES.reduce((n, h) => n + h.outcomes.length, 0)} browser outcomes with ` +
  `${harness.messages} distinct messages.`,
);
