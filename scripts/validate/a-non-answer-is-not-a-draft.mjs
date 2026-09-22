#!/usr/bin/env node
/**
 * A COMPLETION THAT SAYS IT COULD NOT DO THE WORK NEVER SITS IN `awaiting_approval`, AND SHE IS TOLD.
 *
 * ─── What this guards ───────────────────────────────────────────────────────
 *
 * 22 September 2026, `tsk_m351xejbtekke2cb`. "#simone … dig through the code and figure out what
 * the entire loop is" for `how-we-know` ran as one ~13-second cloud completion with no repository,
 * no filesystem and no tools, answered "I do not have direct access to…", and was filed
 * `awaiting_approval` — the same card, the same list, the same buttons as a draft worth her time.
 *
 * ─── The four things that have to stay true ─────────────────────────────────
 *
 *   1. THE RULE DECIDES CORRECTLY, exercised as BEHAVIOUR by calling `cannotDoIn` over real
 *      replies — the production non-answer, and real drafts that mention a limitation in passing.
 *      Not a copy of the regexes; the functions the consumer calls.
 *   2. THE CONSUMER CALLS IT, and calls it BEFORE the approval branch. A check that runs after the
 *      approval row is written is "runs but inert" — the card is already in her inbox.
 *   3. THE FINDING REACHES HER. A row in `boss_task_notices`, a drain script that sends it, and —
 *      the part that is usually missing — something that actually INVOKES the drain. "Exists but
 *      nothing invokes it" is this repository's named defect class and it is exactly what a
 *      notifier nobody schedules would be.
 *   4. THE HANDOFF GOES THROUGH `admitTask`, the one door, using the grid's own `repoIn`. A second
 *      admission path for repo work would be "two components each keeping their own list".
 *
 *   node scripts/validate/a-non-answer-is-not-a-draft.mjs
 *   node scripts/validate/a-non-answer-is-not-a-draft.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cannotDoIn, cannotDoSummary, cannotDoHint, NON_ANSWER_MAX_CHARS, OPENING_CHARS } from "../../src/shared/boss/execution/cannotDo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSUMER = "src/worker/boss/queue/consumer.ts";
const ROUTE = "src/worker/boss/routes/taskNotices.ts";
const MOUNT = "src/worker/boss/index.ts";
const DRAIN = "scripts/ops/task-notices.mjs";
const LAUNCHD = "scripts/ops/install-agent-launchd.sh";
const MIGRATIONS = "migrations";

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

/**
 * ─── THE CASES ──────────────────────────────────────────────────────────────
 *
 * `text` is a completion; `nonAnswer` is whether the system must refuse to call it a draft.
 *
 * THE `false` CASES MATTER MORE THAN THE `true` ONES. A rule that fires on a real draft takes work
 * she asked for out of her approval inbox and mails her about it — so every one below is a reply
 * that mentions a limit and still did the job, which is the ordinary shape of honest ops work.
 */
export const CASES = [
  {
    label: "the production non-answer, 22 Sep 2026",
    nonAnswer: true,
    text: "I do not have direct access to the how-we-know repository or its codebase, so I cannot "
      + "dig through the code to trace the loop you are describing. To help with this, I would need "
      + "the relevant files or a description of the components involved.",
  },
  {
    label: "the same admission in the other common phrasing",
    nonAnswer: true,
    text: "I'm unable to access the repository or read any files, so I can't determine what the "
      + "full loop is. Please paste the relevant source and I will trace it.",
  },
  {
    label: "no tools at all",
    nonAnswer: true,
    text: "I don't have the ability to run commands or browse a filesystem. If you can share the "
      + "entry point I can reason about it from there.",
  },
  {
    label: "asking to be given access instead of doing the work",
    nonAnswer: true,
    text: "I would need access to the repository to answer this properly. Without it I can only "
      + "speak in general terms about how such a loop is usually structured.",
  },
  {
    label: "no visibility into the thing asked about",
    nonAnswer: true,
    text: "I do not have visibility into the how-we-know deployment, so I cannot say which step "
      + "is failing.",
  },
  // ── and the drafts that must go through untouched ──
  {
    label: "a real draft that names a gap partway in — the caveat, not the answer",
    nonAnswer: false,
    text: "Here is the agenda for Wednesday.\n\n1. The two LP replies from last week, both positive, "
      + "both asking about fee structure — recommend answering with the standard schedule and no "
      + "negotiation this round.\n2. The KDP title review, which is still with Amazon.\n3. Hiring: "
      + "two candidates worth a call.\n\nOn the third item I do not have access to the latest "
      + "screening notes, so the ranking is from the earlier pass and should be checked before the "
      + "meeting. Everything else is current as of this morning.",
  },
  {
    label: "a short real answer that happens to mention a missing number",
    nonAnswer: false,
    text: "Two things need you this week: the Wednesday packet and the cover batch. I don't have "
      + "the final print figure yet, so the packet shows the September number with a note.",
  },
  {
    label: "a finding about the world, not about itself",
    nonAnswer: false,
    text: "There is no access token configured for that account, which is why the sync has been "
      + "failing since Thursday. The fix is to set it in the vault; nothing else is wrong.",
  },
  {
    label: "a long reply that opens with a caveat and then does the work anyway",
    nonAnswer: false,
    text: "I do not have access to the live dashboard, so the figures below come from the snapshot.\n\n"
      + ("The loop runs in four steps, and each one is worth stating plainly because the failure "
        + "mode differs at each. ").repeat(20),
  },
  {
    label: "an empty reply is not a non-answer, it is a different failure",
    nonAnswer: false,
    text: "",
  },
];

/** 1. The rule decides correctly, by calling it. */
export function theRuleDecides(rule = cannotDoIn) {
  const bad = [];
  for (const c of CASES) {
    const got = Boolean(rule(c.text));
    if (got !== c.nonAnswer) {
      bad.push(`"${c.label}" — expected ${c.nonAnswer ? "a non-answer" : "an ordinary draft"}, got the opposite.`);
    }
  }
  // The gates are the whole defence against a false positive; a rule with either one missing is broken.
  const longOne = "I do not have access to anything. " + "x".repeat(NON_ANSWER_MAX_CHARS + 10);
  if (rule(longOne)) bad.push("a reply longer than the length gate was called a non-answer, so a real draft that names a limit would be pulled out of her inbox.");
  const lateOne = "y".repeat(OPENING_CHARS + 10) + " I do not have access to the numbers.";
  if (rule(lateOne)) bad.push("an admission buried past the opening was called a non-answer, so an ordinary caveat counts as a failed run.");
  // And the message she reads must actually say something.
  const finding = cannotDoIn(CASES[0].text);
  if (!finding) bad.push("the rule no longer recognises the production reply this whole change was built from.");
  else {
    if (!cannotDoSummary("Simone", finding).includes("Simone")) bad.push("the summary does not name the employee whose run it was.");
    if (!/could not actually do this/i.test(cannotDoSummary("Simone", finding))) bad.push("the summary does not say it could not do it, which is the one thing it exists to say.");
    if (cannotDoHint("Danielle") === cannotDoHint(null)) bad.push("the hint says the same thing whether or not the work was handed on, so it tells her nothing about what happens next.");
  }
  return bad;
}

/** 2. The consumer calls it, before the approval branch, and files it as something other than a draft. */
export function theConsumerActsOnIt(source) {
  const bad = [];
  if (!source) return [`${CONSUMER} could not be read, so nothing about the queue was checked.`];

  if (!/cannotDoIn\s*\(/.test(source)) {
    bad.push(`${CONSUMER} never calls cannotDoIn(), so a "I do not have access" reply is still filed as a draft.`);
    return bad;
  }
  const at = source.indexOf("cannotDoIn(");
  const approval = source.indexOf("INSERT INTO approvals");
  if (approval !== -1 && at > approval) {
    bad.push("the check runs AFTER the approval row is written, so the card she must not see is already in her inbox.");
  }
  if (!/const\s+nonAnswer[\s\S]{0,600}?return;/.test(source)) {
    bad.push("the consumer reads the finding but does not return, so the ordinary approval path runs anyway.");
  }
  if (!/status = 'failed'/.test(source) || !/'could_not_do'/.test(source)) {
    bad.push("a run that could not do the work is not filed as failed under its own event, so it is still indistinguishable from a draft.");
  }
  // Her words are never lost. The status changes what it is called; the text stays on the row.
  if (!/UPDATE tasks SET status = 'failed', output = \?/.test(source)) {
    bad.push("the model's text is not written to tasks.output on this path, so a false positive would destroy work.");
  }
  if (!/INSERT INTO boss_task_notices/.test(source)) {
    bad.push("nothing queues an email, so she learns about it only by opening a screen — which is the bug.");
  }
  if (!/admitTask\(/.test(source) || !/repoIn\(/.test(source)) {
    bad.push("the handoff does not go through admitTask() with the grid's own repoIn(), so it is either absent or a second admission path.");
  }
  if (!/handed_off_from/.test(source)) {
    bad.push("nothing marks a handed-off task, so a task could be handed on forever.");
  }
  return bad;
}

/** 3. The finding reaches her: a table, a door, a drain, and something that invokes the drain. */
export function theNoticeReachesHer({ migrations, route, mount, drain, launchd }) {
  const bad = [];
  if (!migrations.some((m) => /CREATE TABLE IF NOT EXISTS boss_task_notices/.test(m.source))) {
    bad.push("no migration creates boss_task_notices, so the queued email has nowhere to live.");
  }
  if (!route) bad.push(`${ROUTE} is missing, so her Mac has no way to read what is waiting.`);
  else {
    if (!/\/pending/.test(route)) bad.push("the notices route offers no pending list.");
    if (!/\/:id\/sent/.test(route) || !/\/:id\/failed/.test(route)) {
      bad.push("the notices route cannot record BOTH outcomes, so a refused send is indistinguishable from a sent one.");
    }
    if (!/attempts < \?/.test(route)) bad.push("nothing caps the attempts, so a permanently refused notice is retried forever.");
  }
  if (!mount || !/app\.route\("\/api\/task-notices"/.test(mount)) {
    bad.push(`${MOUNT} does not mount /api/task-notices, so the route exists and is unreachable.`);
  }
  if (!drain) bad.push(`${DRAIN} is missing, so nothing sends the queued message.`);
  else {
    if (!/from "\.\/notify\.mjs"/.test(drain)) {
      bad.push("the drain does not send through notify.mjs, so it holds a second copy of the employee roster.");
    }
    if (!/\/failed/.test(drain)) bad.push("the drain never reports a refusal, so a notice that did not go looks like one that did.");
  }
  /*
   * THE ONE THAT CATCHES "EXISTS BUT NOTHING INVOKES IT". A drain nobody schedules is a notifier
   * whose silence is indistinguishable from there being nothing to say — the exact property
   * notify.mjs's own Rule 0 block was written about.
   */
  if (!launchd || !/task-notices\.mjs/.test(launchd)) {
    bad.push(`${LAUNCHD} does not run task-notices.mjs, so the drain exists and is never invoked.`);
  }
  return bad;
}

/** Every migration file, newest last. */
function migrationFiles() {
  const dir = join(ROOT, MIGRATIONS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ name: f, source: readFileSync(join(dir, f), "utf8") }));
}

const consumerSource = read(CONSUMER);
const routeSource = read(ROUTE);
const mountSource = read(MOUNT);
const drainSource = read(DRAIN);
const launchdSource = read(LAUNCHD);
const migrations = migrationFiles();

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };
  const parts = { migrations, route: routeSource, mount: mountSource, drain: drainSource, launchd: launchdSource };

  expect("the real rule separates a non-answer from a draft", theRuleDecides(), false);
  expect("the consumer acts on it before the approval branch", theConsumerActsOnIt(consumerSource), false);
  expect("the notice has a table, a door, a drain and a schedule", theNoticeReachesHer(parts), false);

  // ─── THE NEGATIVE PROOF: break each one, watch it fail ───────────────────
  expect("a rule that never fires — the state on 22 September",
    theRuleDecides(() => null), true);
  expect("a rule that calls everything a non-answer",
    theRuleDecides(() => ({ matched: "x", why: "y", at: 0, chars: 1 })), true);
  expect("a rule with no length gate, which eats real drafts",
    theRuleDecides((t) => (/I do not have access to/i.test(String(t)) ? { matched: "x", why: "y", at: 0, chars: 1 } : null)), true);
  expect("a rule with no opening gate, which turns a caveat into a failed run",
    theRuleDecides((t) => {
      const s = String(t);
      return s.length <= NON_ANSWER_MAX_CHARS && /I do not have access to/i.test(s)
        ? { matched: "x", why: "y", at: 0, chars: s.length } : null;
    }), true);

  expect("a consumer that never checks", theConsumerActsOnIt(consumerSource?.replaceAll("cannotDoIn(", "unusedCheck(") ?? null), true);
  expect("a consumer that checks and carries on to the approval anyway",
    theConsumerActsOnIt(consumerSource?.replace(/const nonAnswer[\s\S]*?\n    }\n/, "const nonAnswer = cannotDoIn(result.text);\n") ?? null), true);
  expect("a consumer that files it as a draft after all",
    theConsumerActsOnIt(consumerSource?.replaceAll("status = 'failed', output = ?, error = ?", "status = 'awaiting_approval', output = ?, error = ?") ?? null), true);
  expect("a consumer that throws the model's words away",
    theConsumerActsOnIt(consumerSource?.replace("UPDATE tasks SET status = 'failed', output = ?", "UPDATE tasks SET status = 'failed', error_only = ?") ?? null), true);
  expect("a consumer that tells nobody",
    theConsumerActsOnIt(consumerSource?.replace("INSERT INTO boss_task_notices", "INSERT INTO nothing_at_all") ?? null), true);
  expect("a handoff that writes its own task row instead of using the one door",
    theConsumerActsOnIt(consumerSource?.replaceAll("admitTask(", "insertTaskDirectly(") ?? null), true);
  expect("a handoff with no loop guard",
    theConsumerActsOnIt(consumerSource?.replaceAll("handed_off_from", "note") ?? null), true);
  expect("a consumer that could not be read", theConsumerActsOnIt(null), true);

  expect("no table for the queued message",
    theNoticeReachesHer({ ...parts, migrations: migrations.filter((m) => !/boss_task_notices/.test(m.source)) }), true);
  expect("a route that cannot record a refused send",
    theNoticeReachesHer({ ...parts, route: routeSource?.replace("/:id/failed", "/:id/unused") ?? null }), true);
  expect("a route with no attempt cap",
    theNoticeReachesHer({ ...parts, route: routeSource?.replace("attempts < ?", "1 = ?") ?? null }), true);
  expect("a route nothing mounts",
    theNoticeReachesHer({ ...parts, mount: mountSource?.replace('app.route("/api/task-notices"', 'app.route("/api/unused"') ?? null }), true);
  expect("a drain holding its own roster",
    theNoticeReachesHer({ ...parts, drain: drainSource?.replace('from "./notify.mjs"', 'from "./somewhere-else.mjs"') ?? null }), true);
  expect("A DRAIN NOTHING EVER RUNS — exists but nothing invokes it",
    theNoticeReachesHer({ ...parts, launchd: launchdSource?.replaceAll("task-notices.mjs", "something-else.mjs") ?? null }), true);
  expect("no drain at all", theNoticeReachesHer({ ...parts, drain: null }), true);

  if (failed) { console.error(`NON-ANSWER SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("NON-ANSWER SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

/* RULE 0: no stage may exit 0 having done nothing. */
if (CASES.length === 0 || migrations.length === 0) {
  console.error("NON-ANSWER SCAN FAILED — nothing to examine:");
  console.error(`  ${CASES.length} case(s), ${migrations.length} migration(s).`);
  process.exit(2);
}

const problems = [
  ...theRuleDecides(),
  ...theConsumerActsOnIt(consumerSource),
  ...theNoticeReachesHer({ migrations, route: routeSource, mount: mountSource, drain: drainSource, launchd: launchdSource }),
];

if (problems.length) {
  console.error("NON-ANSWER SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error('  "I do not have direct access to…" is not a draft, and she should not have to open a screen to find out.');
  process.exit(2);
}

const nonAnswers = CASES.filter((c) => c.nonAnswer).length;
console.log(
  `NON-ANSWER OK — ${nonAnswers} self-declared non-answer(s) and ${CASES.length - nonAnswers} real draft(s) told apart by rule; `
  + `the queue files a non-answer as failed with the model's words kept, hands it to the desk that owns the repository `
  + `through admitTask, and queues an email that com.seq.boss-agent drains six times a day.`,
);
