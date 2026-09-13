#!/usr/bin/env node
/**
 * A HUNT SHE ASKED FOR BY EMAIL MUST REACH THE THING THAT CAN PERFORM IT.
 *
 * ─── The chain, and where it broke ─────────────────────────────────────────
 *
 * She writes "find me a seller of $1B+ of OpenAI shares". Four things must happen, and each
 * one of them existed while the chain as a whole did not:
 *
 *   1. the handoff parses the hunt onto the task          shared/boss/intake/handoff.mjs
 *   2. the task is NOT drained to a model                 src/worker/bossMount.ts
 *   3. something runs the hunt on her Mac                 scripts/ops/buyer-hunt.mjs --from-boss
 *   4. a launchd job runs that promptly                   com.seq.boss-hunt-ondemand
 *
 * Step 1 worked on 12 September: the task carried
 * {"asset":"OpenAI","size_usd":1000000000,"side":"sell"}, parsed from her own sentence. Step 2
 * did not exist, so the model drained the task seconds after it was admitted and answered a
 * placement instruction with "I will initiate a search for potential sellers" — a paragraph
 * promising the work, while the task moved to `awaiting_approval` and the runner, which polls
 * for `queued`, never saw it. Step 4 did not exist either: the only hunt job was weekly.
 *
 * Each part was real. Nobody owned the line between them. That is the defect class this
 * repository names most often, and this validator is the link.
 *
 * RULE 0: it hard-fails if it can find no hunt-carrying shape to check at all, rather than
 * passing over an empty set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const errors = [];
let checks = 0;

/* ── 1. The handoff still parses a hunt out of her sentence ───────────────── */
const HERS = 'please help me find a seller of $1B+ of OpenAI shares. Route this to whomever should handle this.';
let hunt = null;
try {
  const mod = await import(path.join(ROOT, 'src/shared/boss/intake/handoff.mjs'));
  const fn = mod.huntRequestIn;
  if (typeof fn === 'function') { hunt = fn(HERS); checks += 1; }
  else errors.push('no_hunt_parser: handoff.mjs exports nothing that parses a hunt out of her sentence.');
} catch (e) {
  errors.push(`handoff_unreadable: ${e.message}`);
}
if (hunt && !(String(hunt.asset || '').toLowerCase().includes('openai') && Number(hunt.size_usd) > 0 && hunt.side === 'sell')) {
  errors.push(`hunt_misparsed: her sentence produced ${JSON.stringify(hunt)}; expected OpenAI / a size / sell.`);
}

/* ── 2. The Worker's drain refuses hunt-carrying tasks ────────────────────── */
const mount = read('src/worker/bossMount.ts');
checks += 1;
if (!/json_extract\(\s*t\.input\s*,\s*'\$\.hunt'\s*\)/.test(mount)) {
  errors.push(
    "drain_eats_hunts: src/worker/bossMount.ts does not exclude tasks carrying input.hunt from the "
    + "queue drain. The model will claim the hunt before the local runner can, answer it with a "
    + "paragraph, and move the task out of `queued` where the runner looks.");
}

/* ── 3. The runner exists and reads the queue ─────────────────────────────── */
const hunter = 'scripts/ops/buyer-hunt.mjs';
checks += 1;
if (!fs.existsSync(path.join(ROOT, hunter))) {
  errors.push(`hunter_missing: ${hunter} does not exist, so no hunt can be performed anywhere.`);
} else {
  const src = read(hunter);
  if (!/--from-boss|from-boss/.test(src)) errors.push(`${hunter} has no --from-boss mode, so a task can never reach it.`);
  if (!/status=queued/.test(src)) errors.push(`${hunter} does not read the QUEUED tasks; a hunt admitted by mail would never be claimed.`);
}

/* ── 3b. A DRY RUN MUST NOT CONSUME HER REQUEST ───────────────────────────── */
checks += 1;
if (fs.existsSync(path.join(ROOT, hunter))) {
  const src = read(hunter);
  /*
   * Recording a hunt-result CLOSES the task. Without --send nothing was emailed, so closing it
   * loses her request: the hunt printed to a terminal nobody is watching, and the poller then
   * reports NO_HUNT_QUEUED for something she never received. The completion must be gated on the
   * delivery, not on the hunt having run.
   */
  const gated = /if\s*\(!\s*SEND\s*\)[\s\S]{0,400}?continue\s*;/.test(src);
  const posts = /hunt-result/.test(src);
  if (posts && !gated) {
    errors.push(
      `dry_run_eats_the_request: ${hunter} posts a hunt-result without a \`if (!SEND) … continue\` `
      + 'guard ahead of it. A run without --send would close her task having emailed nothing, and the '
      + 'poller would then find nothing queued for a request she never received.');
  }
}

/* ── 4. A launchd job runs it promptly, not weekly ────────────────────────── */
const ONDEMAND = 'com.seq.boss-hunt-ondemand';
const plist = path.join(process.env.HOME ?? '', 'Library/LaunchAgents', `${ONDEMAND}.plist`);

/*
 * ── THIS LINK ONLY EXISTS ON HER MAC, AND SAYS SO RATHER THAN FAILING EVERYWHERE ──
 *
 * launchd is a macOS service and the job is installed in HER home directory. On a Linux CI runner
 * there is no `~/Library/LaunchAgents` to look in, so "the plist is not installed" is not a finding
 * about the hunt chain — it is a finding about the machine, and reporting it as a break made this
 * scan fail on every build the moment it was added to the CI gate.
 *
 * THIS IS A NAMED STOP, NOT A SKIP THAT PASSES. The condition is observable and cannot be set by
 * anyone — macOS, with a LaunchAgents directory — so on her Mac, where it matters, the check runs
 * exactly as before and still hard-fails. Everywhere else the scan says out loud that this one link
 * was not examined and counts it as unchecked, so the pass line cannot imply it was.
 *
 * `capital-staleness.mjs` and `the-filter-says-what-it-dropped.mjs` already read machine-local files
 * and already tolerate their absence; this was the one that did not.
 */
const launchAgents = path.join(process.env.HOME ?? '', 'Library/LaunchAgents');
const thisIsHerMac = process.platform === 'darwin' && fs.existsSync(launchAgents);
let ondemandNote = `${ONDEMAND} runs it`;

if (!thisIsHerMac) {
  ondemandNote =
    `${ONDEMAND} NOT EXAMINED — launchd jobs live on her Mac and this is ${process.platform}`;
} else {
checks += 1;
if (!fs.existsSync(plist)) {
  errors.push(
    `no_ondemand_job: ${ONDEMAND}.plist is not installed, so a hunt she asks for by email waits for the `
    + 'weekly Tuesday duty. "On demand" then means "within six days".');
} else {
  const p = fs.readFileSync(plist, 'utf8');
  const iv = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(p);
  if (!iv) errors.push(`${ONDEMAND} has no StartInterval, so it is not a poller and cannot be on demand.`);
  else if (Number(iv[1]) > 900) errors.push(`${ONDEMAND} polls every ${Math.round(Number(iv[1]) / 60)} minutes; on demand means 15 or less.`);
  if (!/buyer-hunt\.mjs/.test(p)) errors.push(`${ONDEMAND} does not run buyer-hunt.mjs.`);
  // Loaded, not merely written to disk — a plist nobody loaded is a file, not a job.
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid()}/${ONDEMAND}`], { stdio: 'pipe' });
  } catch {
    errors.push(`${ONDEMAND} is on disk but not loaded into launchd, so it never runs.`);
  }
}
}

// RULE 0.
if (checks === 0) {
  errors.push('zero_checks: nothing in the hunt chain was reachable to check, so this proved nothing.');
}

if (errors.length) {
  console.error(`[hunt-reaches-hunter] FAIL: ${errors.length} break(s) in the chain`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(
  `[hunt-reaches-hunter] PASS: ${checks} link(s) — her sentence parses to `
  + `${JSON.stringify(hunt)}, the drain leaves it queued, ${hunter} claims it, and ${ondemandNote}.`);
