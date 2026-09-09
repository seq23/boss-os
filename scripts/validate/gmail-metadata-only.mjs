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
    /*
     * ── lp-outcomes.mjs · WHAT ACTUALLY HAPPENED TO EVERY EMAIL TWIN SENT ────
     *
     * ADDED AS A NAMED EXCEPTION RATHER THAN BY LOOSENING THE RULE, which is the whole point of this
     * list existing: the general prohibition is untouched and this one file's narrowness is checked
     * on every build.
     *
     * WHY IT NEEDS RAW. It answers "did this address bounce, reply, or ask to be removed" for 571
     * sent addresses. A delivery-status notification is formatted differently by every provider, and
     * a parser for them is a parser you maintain forever — so it does not parse them. It takes the
     * addresses the Sent Log ALREADY HOLDS and asks whether a message contains any of them. That
     * membership test needs the message, and no arrangement of From/To/Date answers it: a bounce for
     * an address arrives from a postmaster, not from the person.
     *
     * WHY THE ANSWER MATTERS ENOUGH TO GRANT IT. The Sent Log's Status column has said "sent" on all
     * 571 rows since July — a tracker where every row carries the same value is not tracking
     * anything. Her own Open Items tab flagged it: "Zero hard bounces across 217 pattern-guessed
     * addresses is not plausible." There are 72.
     *
     * WHAT KEEPS IT NARROW, and each of these is asserted below rather than promised.
     */
    "lp-outcomes.mjs",
    {
      why:
        "Reconciles what happened to 571 sent addresses — bounced, replied, asked to be removed — " +
        "against the Sent Log that has recorded 'sent' for every one of them since July. The answer " +
        "lives in bounce reports and reply bodies, which no arrangement of From/To/Date produces, and " +
        "the addresses it matches against come from the spreadsheet rather than from the mail.",
      invariants: [
        // DRY RUN BY DEFAULT. The first thing this does to her spreadsheet should be printable, and
        // a body-reading job that writes on its first run is one nobody reviewed before it ran.
        [(src) => /--commit/.test(src) && /const COMMIT = process\.argv\.includes\("--commit"\)/.test(src),
         "it must require --commit to write anything; without it, it prints what would change and stops"],
        // THE MAILBOX IS NAMED IN THE JWT, so it cannot silently become a different one. The previous
        // attempt routed through the claude.ai connector, which is bound to her PERSONAL account —
        // it searched the wrong mailbox and filed a confident, quiet, wrong answer.
        [(src) => /sub:\s*MAILBOX|sub: *mailbox|"sub":\s*MAILBOX|sub: MAILBOX/.test(src) || /const MAILBOX = /.test(src),
         "the mailbox it impersonates must be a named constant, not inferred from whatever session it finds"],
        // NOTHING DERIVED FROM A BODY IS WRITTEN TO DISK. The one file it appends to is a suppression
        // list, and every line of it is an address that was already on the Sent Log — so the file
        // contains nothing the spreadsheet did not already hold.
        [(src) => !/writeFileSync\([^)]*(body|raw|msg|message)/i.test(src),
         "it must never write a message body or a raw message to disk — the only file it appends is a list of addresses the Sent Log already holds"],
        // Bounded. A mailbox with a multi-megabyte deck in it must not be read whole into memory,
        // and a bounce report ends long before this.
        [(src) => /slice\(0, ?200_000\)|slice\(0, ?200000\)/.test(src),
         "it must bound how much of a message it reads"],
        // Nothing content-derived may reach a model. Matched on PROVIDER HOSTS rather than brand
        // names, for the reason the holdings entry records: a validator that fires on a doc comment
        // is one that gets switched off.
        [(src) => !/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai/i.test(src),
         "it must send nothing to any model — the matching is a fixed set of addresses from the spreadsheet"],
      ],
    },
  ],
  /*
   * ── lp-positive.mjs · THE LPs WHO SAID YES ──────────────────────────────
   *
   * ADDED AS A NAMED EXCEPTION RATHER THAN BY LOOSENING THE RULE, same as its neighbours. The
   * general prohibition is untouched; this one file's narrowness is asserted on every build.
   *
   * WHY IT NEEDS RAW. She asked for it in these words: "find the ones that either want to have a
   * call with us or keep in touch. all the positive replies." Whether someone wants a call is a
   * statement inside the message. From/To/Date cannot produce it, and neither can a subject line —
   * "Re: Regina — your Swimming with Allocators episode" is identical whether the reply says
   * "happy to connect" or "please remove me".
   *
   * AND IT NEEDS THE DECODED BODY SPECIFICALLY, which is the part the first attempt got wrong. A
   * regex over the RAW message finds nothing when the body is base64 — which, in this mailbox, is
   * a large share of them, because Outlook and several corporate gateways encode by default. That
   * is how a mailbox containing "Happy to connect in the coming weeks" reported zero positive
   * replies: not a crash, a confident wrong answer.
   *
   * THIS ONE PERSISTS A QUOTE, AND THAT IS THE DIFFERENCE FROM ITS NEIGHBOURS. lp-outcomes.mjs
   * writes only addresses the Sent Log already holds. This writes one short sentence per POSITIVE
   * reply, because a list of names without what they said sends her back to the mailbox — which is
   * the work being removed. It is bounded to 220 characters, taken only from replies classified
   * positive, and never from a decline, an autoresponder or an unrelated message. Everything else
   * read is discarded when the process exits.
   *
   * WHAT REACHES THE WORKER: counts. The endpoint refuses any payload containing an `@`, and that
   * guard is not bent — it is simply not in this path. Addresses and quotes live in a file on her
   * Mac and in an email to her own inbox.
   */
  [
    "lp-positive.mjs",
    {
      why:
        "Finds the LPs who want a call or want to keep in touch, out of every reply to the outreach. " +
        "Intent is a statement inside the message; no arrangement of From/To/Date produces it, and a " +
        "subject line reads identically for a yes and a no. Persists one short quote per positive " +
        "reply because a name without what they said sends her back to the mailbox.",
      invariants: [
        // THE MAILBOX IS NAMED IN THE JWT so it cannot silently become a different one. The earlier
        // attempt routed through the claude.ai connector — bound to her PERSONAL account — and
        // reported 3 inbound where the real mailbox held 123.
        [(src) => /const MAILBOX = /.test(src) && /sub:\s*MAILBOX|sub, *$|accessToken\(.*MAILBOX/s.test(src),
         "the mailbox it impersonates must be a named constant, not inferred from whatever session it finds"],
        // Bounded, same as lp-outcomes.mjs.
        [(src) => /slice\(0, ?200_000\)|slice\(0, ?200000\)/.test(src),
         "it must bound how much of a message it reads"],
        // THE QUOTE IS SHORT AND ONLY FROM A POSITIVE REPLY. This is the invariant that keeps a
        // body-persisting job from becoming a mail archive.
        [(src) => /slice\(0, ?220\)/.test(src),
         "the quote it persists must be bounded to a short sentence"],
        [(src) => /bucket !== "call" && bucket !== "warm"|bucket === "call" \|\| bucket === "warm"/.test(src),
         "it must persist a quote only for replies classified positive, never for declines, autoresponders or unrelated mail"],
        // Nothing content-derived may reach a model. Matched on PROVIDER HOSTS rather than brand
        // names, for the reason the holdings entry records.
        [(src) => !/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai/i.test(src),
         "it must send nothing to any model — the classification is local pattern matching"],
        // RECALL IS CHECKED AGAINST HER OWN RECORDS, not against itself. A scan that quietly loses a
        // warm LP is worse than no scan, and every other check this file could run is marking its
        // own homework.
        [(src) => /KNOWN_REPLIES/.test(src) && /RECALL_FAILED/.test(src),
         "it must carry the owner-supplied list of known replies and fail loudly when it cannot find one"],
      ],
    },
  ],
  /*
   * ── interest-ledger.mjs · THE INTEREST LEDGER ────────────────────────────
   *
   * ADDED AS A NAMED EXCEPTION RATHER THAN BY LOOSENING THE RULE, same as its neighbours. The
   * general prohibition is untouched and this one file's narrowness is asserted on every build.
   *
   * WHY IT NEEDS THE BODY. She brokers late-stage private secondaries, and both sides of a market
   * already sit in `staylor@spry.vc`: somebody wanted SpaceX in March, somebody is selling it this
   * week, and nothing has ever connected the two. A trade is an ASSET, a SIDE and a SIZE, and all
   * three live in prose. From/To/Date cannot tell you that a message says "I have 40k shares of X
   * available", and a subject line reads identically for a buyer and a seller.
   *
   * WHY THE SPLIT WITH interest-extract.mjs IS WHAT MAKES THIS GRANTABLE. This file reads the
   * mailbox and SENDS NOTHING TO ANY MODEL — it filters, counts what it discarded by reason, and
   * writes candidates to her Mac. A second process reads those files and never touches Gmail. So
   * this file keeps the same "nothing content-derived reaches a model" invariant every other
   * exception here carries, and the model half holds no Gmail credential at all. Neither can
   * become the other, and `validate:filter-accounts` asserts that separation from the other side.
   *
   * WHAT KEEPS IT NARROW, each asserted below rather than promised.
   */
  [
    "interest-ledger.mjs",
    {
      why:
        "Turns her brokerage mailbox into a structured ledger of who wants to buy or sell what, at " +
        "what size — the thing matching is impossible without. An asset, a side and a size all live " +
        "in prose; no arrangement of From/To/Date produces any of the three.",
      invariants: [
        // THE MAILBOX IS NAMED IN THE JWT so it cannot silently become a different one. The earlier
        // brokerage attempt routed through the claude.ai connector, bound to her PERSONAL account.
        [(src) => /const MAILBOX = /.test(src) && /sub: MAILBOX/.test(src),
         "the mailbox it impersonates must be a named constant put in the JWT's sub claim, not inferred from whatever session it finds"],
        // Read-only, and no scope that could ever send. She can read spry.vc and never write from it.
        [(src) => /gmail\.readonly/.test(src) && !/gmail\.send|gmail\.compose|gmail\.modify|mail\.google\.com/.test(src),
         "it must hold gmail.readonly and no scope that can write — she reads spry.vc and never sends from it"],
        // Bounded, same as its neighbours. A pitch deck must not be read whole into memory.
        [(src) => /BODY_BOUND = 200_000|slice\(0, ?200_000\)/.test(src),
         "it must bound how much of a message it reads"],
        // WHAT IT WRITES IS BOUNDED TOO. This one persists an excerpt, which its neighbours do not,
        // because the model pass downstream has to see enough of the message to find a size. Six
        // thousand characters is a message, not a mailbox, and the bound is the difference.
        [(src) => /EXCERPT_BOUND = 6_000/.test(src),
         "the excerpt it writes for the model pass must be bounded — an unbounded one is a mail archive on her disk"],
        /*
         * NOTHING CONTENT-DERIVED REACHES A MODEL FROM HERE. Matched on PROVIDER HOSTS and on the
         * CLI spawn, not on brand names, for the reason the holdings entry records: a validator that
         * fires on a doc comment is one that gets switched off.
         */
        [(src) => !/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai/i.test(src)
          && !/spawn\(\s*["']claude/.test(src),
         "it must send nothing to any model — it reads and filters, and a separate process with no Gmail credential does the extraction"],
        // NOTHING REACHES THE CLOUD. Named counterparties, assets and sizes at a FINRA-registered
        // broker-dealer are the most sensitive data in this system; the Boss OS API is not in this path.
        [(src) => !/boss\.sequoiataylor\.com|\/api\/boss\//.test(src),
         "it must post nothing to Boss OS — counterparties, assets and sizes stay on her Mac, not code-named and not counted"],
        // IT MUST SAY WHAT IT DISCARDED. A filter over 104,241 messages whose discard is one number
        // is a filter nobody can audit, and an unauditable filter loses deals silently.
        [(src) => /WHAT THE FILTER DISCARDED/.test(src) && /NAMED STOP \[FILTER_DISCARDED_EVERYTHING\]/.test(src),
         "it must report its discards by named reason and hard-stop on a total discard"],
      ],
    },
  ],
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

// ─── 3. Monique's mailbox sweep, held narrow the same way ────────────────────
//
// 0204. The "missed connections" feature — an old buyer asked about a company, later mail shows
// somebody has access to it, nothing connected the two. It genuinely needs subjects and bodies:
// no arrangement of From/To/Date can tell you what two people were talking about.
//
// IT IS NOT A `CONTENT_EXCEPTIONS` ENTRY, AND THAT IS THE POINT OF HOW IT WAS BUILT. The obvious
// implementation was a `format=full` extractor in scripts/ops, which would have meant adding a
// second entry to the list above and widening the class of thing this repository is allowed to do.
// Instead it runs the KDP way: `claude -p` on her Mac, through the Gmail connector she is already
// signed into. THIS REPOSITORY ACQUIRES NO SECOND BODY-READING API CALLER, the rule for everyone
// else is unchanged, and the guard below is what keeps that true.
//
// A narrow exception that is not held narrow is just a hole, so each of these is checked rather
// than trusted.

const MBX_PROMPT = "scripts/ops/mailbox-sweep-prompt.md";
const MBX_REPORT = "scripts/ops/mailbox-report.mjs";
const MBX_SWEEP = "scripts/ops/mailbox-sweep.sh";

if (existsSync(join(ROOT, MBX_PROMPT))) {
  const prompt = read(MBX_PROMPT);

  // Bodies are read on her Mac and must not be posted back. This is the same instruction the KDP
  // prompt carries and it is checked by the same literal string on purpose: one vocabulary.
  if (!/NEVER QUOTE THE MAIL/.test(prompt)) {
    bad(`${MBX_PROMPT}: the instruction never to quote the mail has been removed. Findings describe; they never reproduce.`);
  }
  // Identity is code names or nothing. A prompt that stopped saying so would produce a leak the
  // reporter would then refuse — loudly, but only after the run had spent its money.
  if (!/MAP\.json/.test(prompt) || !/code name/i.test(prompt)) {
    bad(`${MBX_PROMPT}: no longer requires every person to be named by their code name from MAP.json.`);
  }
  if (!/not in the map, that person is not eligible/i.test(prompt)) {
    bad(`${MBX_PROMPT}: the rule that an unmapped address is skipped rather than named has been removed.`);
  }
  if (!/refuses/i.test(prompt) || !/`@`/.test(prompt)) {
    bad(`${MBX_PROMPT}: no longer states that Boss OS refuses a finding containing an address.`);
  }
  // ONE FILE, IN ONE PLACE. A sweep free to write anywhere is a body-derived corpus on her disk.
  if (!/Write \*\*exactly one file\*\*/.test(prompt) || !/~\/\.boss-os\/mailbox\/findings\.json/.test(prompt)) {
    bad(`${MBX_PROMPT}: the single-output-file rule is gone. A sweep that may write anywhere builds a corpus out of her mail.`);
  }
  // Read-only. The connector can send mail; this job must never be the thing that does.
  if (!/read-only/i.test(prompt)) {
    bad(`${MBX_PROMPT}: no longer states that the Gmail scope here is read-only.`);
  }
} else {
  bad(`${MBX_PROMPT} is missing — the exception's narrowness cannot be checked, so it cannot be permitted.`);
}

if (existsSync(join(ROOT, MBX_REPORT))) {
  const report = read(MBX_REPORT);
  // THE REPORTER MUST STAY BLIND, exactly as the KDP one does. The day it acquires a Gmail call of
  // its own, mail contents are one refactor away from the cloud.
  if (/gmail\.googleapis\.com|gmail\.readonly/.test(report)) {
    bad(`${MBX_REPORT}: the reporter now calls Gmail directly. It must only post the findings file the local run wrote.`);
  }
  if (!/includes\("@"\)/.test(report)) {
    bad(`${MBX_REPORT}: the local refusal of an address in a finding has been removed.`);
  }
  // The whole batch, not the offending row. A partial send reports success on a leaking run.
  if (!/THE WHOLE BATCH/.test(report)) {
    bad(`${MBX_REPORT}: no longer refuses the WHOLE batch on one address. A partial send ships part of a leak and reports success.`);
  }
} else {
  bad(`${MBX_REPORT} is missing — nothing carries the findings, so the sweep reports into a log file.`);
}

if (existsSync(join(ROOT, MBX_SWEEP))) {
  const sweep = read(MBX_SWEEP);
  if (/gmail\.googleapis\.com/.test(sweep)) {
    bad(`${MBX_SWEEP}: the sweep now calls the Gmail API from this repository. It must read through the local connector only.`);
  }
  // Without the map there is no sweep. A degraded run would have to invent names or use addresses.
  if (!/NO_CONTACT_MAP/.test(sweep)) {
    bad(`${MBX_SWEEP}: the hard stop for a missing contact map is gone. Without it a run must either invent code names or use real addresses.`);
  }
  // A named model, matching the duty row. `claude -p` with no --model is what cost $3.88 once.
  if (!/--model/.test(sweep)) {
    bad(`${MBX_SWEEP}: no longer names a model, so it inherits the most expensive one available.`);
  }
} else {
  bad(`${MBX_SWEEP} is missing — the duty names it as its executor and nothing would run.`);
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
  "and the two local jobs that read mail contents — Simone's KDP case watch and Monique's mailbox " +
  "sweep — do so only inside the local run, never through this repository.",
);
