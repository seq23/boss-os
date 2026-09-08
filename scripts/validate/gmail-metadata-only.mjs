#!/usr/bin/env node
/**
 * NOTHING IN THIS REPOSITORY MAY ASK GMAIL FOR MORE THAN HEADERS.
 *
 * ─── What this used to be, and why that was not enough ──────────────────────
 *
 * It guarded ONE named file, `scripts/ops/gmail-metadata.mjs`, and asserted that it requests
 * `format=metadata` with an explicit four-header allowlist. That claim is load-bearing: OPERATIONS
 * states it in her language, and the privacy promise is what the request ASKS FOR rather than
 * something applied to the answer afterwards.
 *
 * The hole was the shape of the check. A second extractor — a new script, a copy of the first with
 * one line changed — would have been governed by nothing at all. A guard that names one file only
 * guards one file, and this system's whole history is second copies drifting from first ones.
 *
 * So it now scans EVERY script in `scripts/ops/` that touches the Gmail API and applies the rules to
 * all of them. That is strictly stronger than what it replaced.
 *
 * ─── What widening the scan immediately found ───────────────────────────────
 *
 * `scripts/ops/holdings-lookup.mjs` requests `format=full` and reads message BODIES. It has done so
 * since it was written, deliberately and with the reason in its own header — "this reads message
 * bodies; it must, since the answer lives in prose" — and nothing anywhere asserted a single thing
 * about it. Meanwhile OPERATIONS said, in her language, that the mailbox request asks for four
 * headers and nothing else. Both sentences were true about the file each was thinking of, and
 * together they were a claim about the repository that was not.
 *
 * That is not fixed by deleting the tool. It is a good tool, she uses it, and it answers a question
 * that cannot be answered from headers. It is fixed by making it a NAMED EXCEPTION whose narrowness
 * is checked: on demand only, one company at a time, printed and never written down.
 *
 * ─── The exceptions, named, with their reasons in the code ──────────────────
 *
 * Simone's publication chase genuinely needs SUBJECTS AND BODIES. You cannot determine from
 * From/To/Date whether a support agent resolved a case, and "keep the replies coming until this
 * resolves" is a determination about content or it is nothing.
 *
 * It is not an exception to the rule below, because it does not call the Gmail API at all.
 * `scripts/ops/kdp-watch.sh` runs `claude -p` on her Mac against the Gmail connector she is already
 * signed into; the reading happens inside that process and the mail never touches this repository,
 * this database, or any script here. What crosses is a determination — a sentinel, a sentence in
 * the run's own words, and four counts — and the endpoint refuses one containing an `@`.
 *
 * That distinction is exactly why the exception is safe and why it is checked rather than trusted:
 * the rules below assert that the KDP reporter never acquires a Gmail API call of its own, that the
 * prompt still forbids quoting, and that its mail search stays scoped to this case rather than
 * becoming a general mailbox read. A narrow exception that is not held narrow is just a hole.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let fail = 0;
const bad = (why) => { console.error("  ✗", why); fail = 1; };

// ─── 1. Every Gmail API caller in scripts/ops, not one named file ─────────────

const opsDir = join(ROOT, "scripts/ops");
const opsFiles = readdirSync(opsDir).filter((f) => /\.(mjs|js|sh)$/.test(f));
const callers = opsFiles.filter((f) => /gmail\.googleapis\.com/.test(read(`scripts/ops/${f}`)));

/*
 * RULE 0. Finding no Gmail caller means the extractor was renamed, moved, or the API host changed —
 * not that the repository suddenly reads no mail. A scan that examined nothing must not pass.
 */
if (callers.length === 0) {
  console.error("GMAIL SCAN EXAMINED NOTHING: no script in scripts/ops calls gmail.googleapis.com.");
  console.error("The extractor has moved or been renamed. That is a broken scan, not a clean repo.");
  process.exit(2);
}

const MUST = [
  [/u\.searchParams\.set\("format", "metadata"\)/, "requests format=metadata"],
  [/for \(const h of \["From", "To", "Date", "List-Unsubscribe"\]\)/,
   "allowlists exactly From, To, Date and List-Unsubscribe — the last is a bulk-sender marker, not content"],
  [/gmail\.readonly/, "asks for a read-only scope"],
];
const MUST_NOT = [
  [/metadataHeaders", "Subject/i, "must not request Subject"],
  [/format=full|"format", "full"|format=raw|"format", "raw"/i, "must not request full or raw messages"],
  [/\.snippet/, "must not read snippets"],
  [/gmail\.modify|gmail\.send|mail\.google\.com|gmail\.compose/, "must not ask for a write scope"],
];

/**
 * The scripts permitted to read more than headers, each with the reason and the invariants that
 * keep the permission narrow.
 *
 * A NAME HERE IS A DESIGN DECISION, NOT A WAY PAST A FAILING BUILD. It says: this tool needs
 * content, the need is real, and here is what must stay true for that to be acceptable. If the
 * invariants stop holding, the exception has widened into a general mailbox read and the build
 * fails on the specific thing that changed.
 */
const CONTENT_EXCEPTIONS = new Map([
  [
    "holdings-lookup.mjs",
    {
      why:
        "Answers 'do I have access to <this one named company>' from her own mail. The answer lives " +
        "in prose — someone writing 'we have 40k shares of X available' — and no arrangement of " +
        "From/To/Date can produce it. She types the company; the company IS the search.",
      invariants: [
        // ON DEMAND ONLY. The moment a launchd job runs this, a body-reading tool becomes a
        // scheduled body-reading tool, which is a materially different thing to consent to.
        [(src, ctx) => !ctx.installer.includes("holdings-lookup"),
         "it must not be run by any launch agent — it is a question she asks, not a job that runs"],
        // NOTHING SURVIVES THE PROCESS. No index, no cache, no corpus: the result is printed and
        // the process exits. A file would be a body-derived artefact sitting on disk for ever.
        [(src) => !/writeFile|appendFile|createWriteStream|mkdir\(/.test(src),
         "it must write nothing to disk — the result is printed and the process exits"],
        // ONE COMPANY, NOT A SWEEP. The Gmail query must carry the name she typed.
        [(src) => /\$\{QUERY\}|"\$\{QUERY\}"/.test(src) || /\"\$\{QUERY\}\"/.test(src),
         "its Gmail query must be scoped to the single company she named"],
        /*
         * Nothing content-derived may reach a model. Matched on PROVIDER HOSTS, not on brand names:
         * the first version tested for the word "anthropic" and failed on this file's own usage
         * example, `npm run holdings -- "Anthropic"`. A validator that fires on a doc comment is one
         * that gets switched off.
         */
        [(src) => !/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai/i.test(src),
         "it must send nothing to any model — the matching is her string and a fixed vocabulary"],
      ],
    },
  ],
]);

const installer = existsSync(join(ROOT, "scripts/ops/install-agent-launchd.sh"))
  ? read("scripts/ops/install-agent-launchd.sh")
  : "";

for (const f of callers) {
  const src = read(`scripts/ops/${f}`);
  const exception = CONTENT_EXCEPTIONS.get(f);
  if (exception) {
    // Read-only is not negotiable even for an exception: content may be read, never written or sent.
    if (!/gmail\.readonly/.test(src)) bad(`${f}: MISSING — asks for a read-only scope`);
    for (const [re, why] of MUST_NOT.filter(([r]) => /modify|send|mail\.google/.test(String(r)))) {
      if (re.test(src)) bad(`${f}: FORBIDDEN — ${why}`);
    }
    for (const [holds, why] of exception.invariants) {
      if (!holds(src, { installer })) {
        bad(`${f}: the content exception no longer holds — ${why}.\n      Why it was granted: ${exception.why}`);
      }
    }
    continue;
  }
  for (const [re, why] of MUST) if (!re.test(src)) bad(`${f}: MISSING — ${why}`);
  for (const [re, why] of MUST_NOT) if (re.test(src)) bad(`${f}: FORBIDDEN — ${why}`);
}

// ─── 2. The KDP exception, held narrow ───────────────────────────────────────
//
// Named here so the exception is a reviewable object rather than an absence. If any of these stops
// being true, the exception has quietly widened into a general mailbox read and the build says so.

const KDP_PROMPT = "scripts/ops/kdp-watch-prompt.md";
const KDP_REPORT = "scripts/ops/kdp-report.mjs";

if (existsSync(join(ROOT, KDP_PROMPT))) {
  const prompt = read(KDP_PROMPT);

  // The search must stay scoped to this case and these senders. A prompt that told the run to read
  // "recent mail" would be a general mailbox read wearing a case number.
  if (!/Case #51496198/.test(prompt) || !/kdp-support@amazon\.com|"Kindle Direct"/.test(prompt)) {
    bad(`${KDP_PROMPT}: the mail search is no longer scoped to the KDP case and its senders.`);
  }
  if (/\bin:anywhere\b|newer_than:\d+y|\ball mail\b/i.test(prompt)) {
    bad(`${KDP_PROMPT}: the search has widened beyond the case — that is a general mailbox read.`);
  }
  // Bodies are read on her Mac and must not be posted back.
  if (!/NEVER QUOTE THE MAIL/.test(prompt)) {
    bad(`${KDP_PROMPT}: the instruction never to quote the mail has been removed. Determinations describe; they never reproduce.`);
  }
  if (!/refuses.*'@'|containing an `@`/.test(prompt)) {
    bad(`${KDP_PROMPT}: no longer states that Boss OS refuses a determination containing an address.`);
  }
} else {
  bad(`${KDP_PROMPT} is missing — the exception's narrowness cannot be checked, so it cannot be permitted.`);
}

if (existsSync(join(ROOT, KDP_REPORT))) {
  const report = read(KDP_REPORT);
  // THE REPORTER MUST STAY BLIND. It posts a file the local run wrote; the day it acquires a Gmail
  // call of its own, mail contents are one refactor away from the cloud.
  if (/gmail\.googleapis\.com|gmail\.readonly/.test(report)) {
    bad(`${KDP_REPORT}: the reporter now calls Gmail directly. It must only post the determination file.`);
  }
  if (!/includes\("@"\)/.test(report)) {
    bad(`${KDP_REPORT}: the local refusal of an address in the determination has been removed.`);
  }
} else {
  bad(`${KDP_REPORT} is missing — nothing carries the determination, so the watcher reports into a log file again.`);
}

if (fail) {
  console.error("\nGMAIL SCAN FAILED");
  console.error("The privacy claim is what the request ASKS FOR, not something applied to the answer");
  console.error("afterwards. Either narrow the request, or come and change this file deliberately.");
  process.exit(1);
}

const metadataOnly = callers.filter((f) => !CONTENT_EXCEPTIONS.has(f));
console.log(
  `GMAIL SCAN PASSED: ${callers.length} Gmail caller(s) in scripts/ops. ` +
  `${metadataOnly.length} request headers only (${metadataOnly.join(", ")}); ` +
  `${callers.length - metadataOnly.length} named content exception(s) still narrow; ` +
  "and the KDP case reads mail only inside the local run, never through this repository.",
);
