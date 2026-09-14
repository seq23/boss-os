#!/usr/bin/env node
/**
 * SHE SAYS WHAT SHE MEANS, AND A DOUBT IS A QUESTION — NEVER A GENERATION.
 *
 * ─── The two failures this is built from, both from one message ────────────
 *
 * On 11 September 2026 she sent, to `boss@sequoiataylor.com`:
 *
 *     Subject: #Monique
 *     Body:    #Monique - Please add searching for buyers of Databricks to the weekly list
 *
 * It routed to Monique correctly and then produced `apr_m26zq5praheyw251`: "It appears that you're
 * referring to a set of instructions or a to-do list related to managing a meeting or interaction
 * with a superior, possibly a 'Boss'…" — sitting `pending` in her approval queue under her own
 * instruction, with the task at `awaiting_approval`.
 *
 *   1. INTENT WAS INFERRED FROM ARITHMETIC. `looksLikeBook` filed a book when it counted two or more
 *      PRICED lines. One unpriced line was therefore not a book and fell through to the generic
 *      model path; the same sentence with two dollar figures in it would silently have REPLACED her
 *      entire inventory. A cliff edge either side of a number nobody chose.
 *
 *   2. NOT UNDERSTOOD MEANT GENERATE ANYWAY. Nothing errored. Silence and a wrong answer are both
 *      worse than a question, and only one of the three was unavailable.
 *
 * ─── What is asserted, and how ──────────────────────────────────────────────
 *
 * BEHAVIOUR, by calling the exported functions the Worker itself calls — `readBookDirective`,
 * `parseLiveBook`, `clarificationFor`, `isReplyMessage`. Not a copy of the rules: a validator that
 * reimplements the rule in order to check the rule is asserting its own opinion, which is this
 * repo's favourite defect committed inside the guard.
 *
 * And STRUCTURE, on `intake/inboundMail.ts`, for the two things a pure function cannot show: that
 * each verb reaches its OWN handler, and that an unreadable verb or an unanswered question stops the
 * message BEFORE `admitTask`. That ordering is the whole fix — a question asked beside a
 * hallucination is worse than either alone — and it is one line away from being undone.
 *
 * RULE 0: ZERO CASES EXAMINED IS A FAILURE. An empty fixture list reports a clean bill of health
 * over a loop that never ran.
 *
 *   node scripts/validate/a-verb-is-explicit-and-a-doubt-is-a-question.mjs
 *   node scripts/validate/a-verb-is-explicit-and-a-doubt-is-a-question.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readBookDirective, parseLiveBook, isSizeless } from "../../src/shared/boss/intake/liveBook.mjs";
import { clarificationFor, isReplyMessage } from "../../src/shared/boss/intake/clarify.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const HANDLER = "src/worker/boss/intake/inboundMail.ts";

/** HER MESSAGE. The one that actually failed, used verbatim as the fixture for both halves. */
const HERS = {
  subject: "#Monique",
  body: "#Monique - Please add searching for buyers of Databricks to the weekly list",
};

/** The Relationships seat, which is the desk that owns her book. */
const MONIQUE = { department: "Relationships", seatName: "Monique", tag: "#monique" };

// ─── 1. The verb grammar, by behaviour ───────────────────────────────────────

/** Every case is `[what it is, subject, body, the verb expected or null]`. */
const VERB_CASES = [
  ["her real message is an ordinary instruction, not an amendment", HERS.subject, HERS.body, null],
  ["`book` in the subject replaces", "#monique book", "Kalshi $20M", "book"],
  ["`add` in the body amends", "#monique", "#monique add\nDatabricks — size TBD", "add"],
  ["`remove` drops a lot", "", "#monique remove Kalshi", "remove"],
  ["case and punctuation do not matter", "#Monique: Book", "Kalshi $20M", "book"],
  ["a verb loose in a sentence is not a verb", "#monique", "please add this to the book", null],
  ["a verb before the tag is not a verb", "add #monique", "Kalshi $20M", null],
  ["an ordinary instruction stays ordinary", "#monique", "can you follow up with the $50M guy tomorrow", null],
  ["a full priced book with no verb still has no verb", "#monique this week", "Kalshi $20M\nErebor Bank $10M", null],
  ["a tag it does not end on is not the tag", "#moniques book", "Kalshi $20M", null],
];

function verbsAreExplicit() {
  const bad = [];
  for (const [label, subject, body, expected] of VERB_CASES) {
    const got = readBookDirective(subject, body, "#monique");
    const verb = got?.verb ?? null;
    if (verb !== expected) bad.push(`${label}: expected ${expected ?? "no verb"}, got ${verb ?? "no verb"}.`);
  }

  // The text a verb operates on must never include the tag line itself, or the tag becomes a lot.
  const add = readBookDirective("#monique", "#monique add\nDatabricks — size TBD", "#monique");
  if (add && /#monique/i.test(add.text)) {
    bad.push("the text an `add` operates on still contains the tag line, which would be parsed as inventory.");
  }
  return bad;
}

// ─── 2. A lot she has not sized survives ─────────────────────────────────────

function aSizelessLotSurvives() {
  const bad = [];
  const text = "Databricks — size TBD, looking for buyers this week";

  const amended = parseLiveBook(text, { allowSizeless: true });
  const lot = amended.positions.find((p) => p.asset === "Databricks");
  if (!lot) bad.push("`add` dropped a lot she has not sized yet — 'size TBD' is a real state of her book.");
  else {
    if (!isSizeless(lot)) bad.push("a sizeless lot came back carrying a size that nobody wrote.");
    if (!/tbd/i.test(String(lot.size_text ?? ""))) bad.push("a sizeless lot is not MARKED as sizeless, so a reader cannot tell it from an unfilled field.");
    if (lot.size_usd !== null) bad.push("a sizeless lot was given a size_usd, which is an invented number in her book.");
  }

  // AND THE PERMISSION IS NARROW. The same rule that admits a name must refuse prose.
  const prose = parseLiveBook("please call Bob about the thing\nthinking about the weekly list", { allowSizeless: true });
  if (prose.positions.length) {
    bad.push(`prose became ${prose.positions.length} lot(s) — "${prose.positions[0].asset}" is not inventory.`);
  }

  // The legacy path must NOT have been widened: a guess may not write an unsized name.
  const guessed = parseLiveBook(`Kalshi $20M\n${text}`);
  if (guessed.positions.some((p) => p.asset === "Databricks")) {
    bad.push("a message with no verb filed an unsized lot — the no-verb path is a guess and may not.");
  }
  return bad;
}

// ─── 3. A doubt is a question, and an ordinary instruction is not ────────────

/** `[what it is, input, should it ask]`. */
const CLARITY_CASES = [
  ["her real message asks rather than generates", { ...MONIQUE, ...HERS }, true],
  ["a tag and nothing else asks", { ...MONIQUE, subject: "#monique", body: "" }, true],
  ["an ordinary instruction is worked", { ...MONIQUE, subject: "#monique", body: "can you follow up with the $50M guy tomorrow" }, false],
  ["an instruction split across subject and body is worked", { ...MONIQUE, subject: "#monique have a look", body: "please" }, false],
  ["an explicit verb is never questioned", { ...MONIQUE, subject: "#monique add", body: "Databricks — size TBD", hasVerb: true }, false],
  ["a filed book is never questioned", { ...MONIQUE, subject: "#monique", body: "Kalshi $20M", bookFiled: true }, false],
  ["a forward with a tag is a complete thought", { ...MONIQUE, subject: "#monique", body: "fyi", forwarded: true }, false],
  ["A REPLY IS NEVER QUESTIONED", { ...MONIQUE, subject: "Re: #Monique", body: "no size", isReply: true }, false],
  ["another desk's ordinary instruction is worked", { department: "Operations", seatName: "Simone", tag: "#simone", subject: "#simone", body: "book me a flight to Chicago on Tuesday" }, false],
  ["another desk with nothing to act on still asks", { department: "Operations", seatName: "Simone", tag: "#simone", subject: "#simone", body: "?" }, true],
];

function aDoubtIsAQuestion() {
  const bad = [];
  for (const [label, input, shouldAsk] of CLARITY_CASES) {
    const asked = clarificationFor(input);
    if (Boolean(asked) !== shouldAsk) {
      bad.push(`${label}: expected ${shouldAsk ? "a question" : "no question"}, got ${asked ? `"${asked.reason}"` : "none"}.`);
    }
  }

  /*
   * "PLEASE CLARIFY" IS NOT A QUESTION. It is the absence of one, and she would be right to ignore
   * it — so the ask has to quote her line, name the thing, and say exactly what to send back.
   */
  const asked = clarificationFor({ ...MONIQUE, ...HERS });
  if (asked) {
    if (!asked.ask.includes(HERS.body)) bad.push("the question does not quote back the line it is asking about.");
    if (!asked.ask.includes("Databricks")) bad.push("the question does not name the thing she named.");
    if (!/size TBD/.test(asked.ask)) bad.push("the question does not tell her how to answer 'no size'.");
    if (!/#monique add/i.test(asked.ask)) bad.push("the question does not give her the exact reply that would work.");
    if (asked.ask.length < 200) bad.push("the question is too short to be specific — it is a 'please clarify'.");
  }

  // The loop-stopper, on its own terms: a reply is recognised however her client marks it.
  if (!isReplyMessage({ subject: "Re: #Monique" })) bad.push("a `Re:` subject is not recognised as a reply, so a question could ask again.");
  if (!isReplyMessage({ subject: "#Monique", inReplyTo: "<x@y>" })) bad.push("`In-Reply-To` is not recognised as a reply.");
  if (!isReplyMessage({ subject: "#Monique", references: "<x@y>" })) bad.push("`References` is not recognised as a reply.");
  if (isReplyMessage({ subject: "#Monique" })) bad.push("a fresh message is being treated as a reply, which would disable every question.");
  return bad;
}

// ─── 4. Nothing unclear reaches a model ──────────────────────────────────────

/**
 * THE ORDER IS THE FIX. `admitTask` is what hands a message to a language model; a book verb that
 * could not be read, and a question that had to be asked, must both stop the message BEFORE it.
 */
export function nothingUnclearReachesAModel(source) {
  if (source === null) return [`${HANDLER} could not be read, so the order of the checks is unverified.`];
  const bad = [];

  const guard = /if \(route\.outcome !== "AMBIGUOUS" && !bookFailure && !question && !filedByVerb\) \{/.exec(source);
  if (!guard) {
    bad.push("the `admitTask` branch is no longer guarded by ALL of `!bookFailure`, `!question` and `!filedByVerb` — an instruction that could not be read, or one that was already carried out, would be handed to a model, which is exactly what produced apr_m26zq5praheyw251 and apr_m296y5wq65e3s6va.");
  }

  const admitAt = source.indexOf("await admitTask(");
  const questionAt = source.indexOf("clarificationFor(");
  const bookAt = source.indexOf("applyBookDirective(");
  if (admitAt === -1) bad.push(`${HANDLER} no longer calls admitTask, so mail no longer becomes work.`);
  if (questionAt === -1) bad.push(`${HANDLER} no longer asks for clarity at all.`);
  if (bookAt === -1) bad.push(`${HANDLER} no longer runs the book verb she typed.`);
  if (admitAt !== -1 && questionAt !== -1 && questionAt > admitAt) {
    bad.push("the clarity check runs AFTER admitTask — a question asked beside a generated answer is worse than either alone.");
  }
  if (admitAt !== -1 && bookAt !== -1 && bookAt > admitAt) {
    bad.push("the book verb is applied after the task is admitted, so a failed verb could not stop it.");
  }

  // Each verb reaches its OWN handler. One switch, three destinations, no overlap.
  for (const [verb, fn] of [["book", "storeLiveBook"], ["add", "amendLiveBook"], ["remove", "removeFromLiveBook"]]) {
    // The CALL, not the import line: an `add` rewired to the `book` handler still imports both.
    if (!source.includes(`${fn}(env`)) {
      bad.push(`the \`${verb}\` verb has no distinct handler — \`${fn}\` is never called from the intake, so two verbs mean the same thing.`);
    }
  }
  if (!/directive\.verb === "book"/.test(source) || !/directive\.verb === "add"/.test(source)) {
    bad.push("the verbs no longer select their handler explicitly, so two of them could quietly mean the same thing.");
  }

  // A failure has to be a REPLY, and the row has to say so.
  if (!/"BOOK_NOT_READ"/.test(source)) bad.push("an unreadable book instruction is no longer recorded as its own outcome, so it hides inside ROUTED.");
  if (!/"NEEDS_CLARITY"/.test(source)) bad.push("a question is no longer recorded as its own outcome, so a week of unanswered questions is invisible.");
  // A close she asked for, and a close that had to be asked about, are stops of the same kind:
  // they lead the reply too. The regex admits exactly those two beside the original.
  if (!/const stopped = question \? question\.ask : (?:closeQuestion \?\? closedNote \?\? )?bookFailure;/.test(source)
    || !/const reply = stopped \?/.test(source)) {
    bad.push("a message that STOPPED no longer leads with the reason — the one sentence that matters is buried under the reassurance that it worked.");
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const handlerPath = join(ROOT, HANDLER);
const handlerSource = existsSync(handlerPath) ? readFileSync(handlerPath, "utf8") : null;

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  expect("the real grammar is explicit", verbsAreExplicit(), false);
  expect("the real parser keeps a sizeless lot", aSizelessLotSurvives(), false);
  expect("the real rules ask about her message and not about ordinary ones", aDoubtIsAQuestion(), false);
  expect("the real handler stops before the model", nothingUnclearReachesAModel(handlerSource), false);

  /*
   * THE NEGATIVE PROOF. Each of these is the defect this file exists to catch, reintroduced into a
   * copy of the real source. A guard that has never been shown going red is a guard nobody has
   * tested — it is a comment with an exit code.
   */
  expect("a handler where `#monique add` falls through to the model path", nothingUnclearReachesAModel(
    handlerSource?.replace(
      'if (route.outcome !== "AMBIGUOUS" && !bookFailure && !question && !filedByVerb) {',
      'if (route.outcome !== "AMBIGUOUS") {') ?? null,
  ), true);
  expect("a handler that asks for clarity only after generating", nothingUnclearReachesAModel(
    handlerSource?.replace(
      'if (route.outcome !== "AMBIGUOUS" && !bookFailure && !question && !filedByVerb) {',
      'if (route.outcome !== "AMBIGUOUS" && !bookFailure && !filedByVerb) {') ?? null,
  ), true);
  expect("a handler where `add` and `book` are the same operation", nothingUnclearReachesAModel(
    handlerSource?.replace("amendLiveBook(env, input)", "storeLiveBook(env, { ...input, explicit: true })") ?? null,
  ), true);
  expect("a handler that no longer sends the question", nothingUnclearReachesAModel(
    handlerSource?.replace("const reply = stopped ?", "const reply = null ?") ?? null,
  ), true);
  expect("a handler that could not be read at all", nothingUnclearReachesAModel(null), true);

  if (failed) { console.error(`VERB/CLARITY SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("VERB/CLARITY SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

/*
 * RULE 0. A loop over an empty fixture list cannot fail, and would report a clean bill of health
 * over a rule nobody is checking.
 */
if (VERB_CASES.length === 0 || CLARITY_CASES.length === 0) {
  console.error("VERB/CLARITY SCAN FAILED — there are no cases to examine, so nothing was proven.");
  process.exit(2);
}

const problems = [
  ...verbsAreExplicit(),
  ...aSizelessLotSurvives(),
  ...aDoubtIsAQuestion(),
  ...nothingUnclearReachesAModel(handlerSource),
];

if (problems.length) {
  console.error("VERB/CLARITY SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error("  This is how apr_m26zq5praheyw251 happened: a message that was neither a book nor");
  console.error("  understood was handed to a language model, which obliged.");
  process.exit(2);
}

console.log(
  `VERB/CLARITY OK — ${VERB_CASES.length} verb case(s), ${CLARITY_CASES.length} clarity case(s), `
  + "and the intake stops an unreadable instruction before any model sees it.",
);
