#!/usr/bin/env node
/**
 * AN UNREAD MESSAGE IS NOT AN EMPTY ONE — AND THE CAP IS MEASURED ON THE WRONG THING.
 *
 * ─── What went wrong, 12 September 2026, 08:59 ──────────────────────────────
 *
 * She sent `#simone` from her iPhone:
 *
 *     "Please make sure the spirit page of my boss OS system displays astrology in the way it is
 *      in the below report and make sure the daily executive briefing is set up like the below
 *      report…"
 *
 * It routed. It was authorised. It was stored, intact, at
 * `boss-inbound-mail/2026-09-12/iml_m2aymnxamhsws8k7.eml`. And it produced NO WORK AT ALL, because
 * of two rules that are each individually defensible and which together delete her mail:
 *
 *   1. THE CAP WAS MEASURED ON THE ENVELOPE, NOT ON THE READABLE TEXT. `MAX_BODY_BYTES` was
 *      512 KB and compared against `rawSize`. Her message was 538,189 bytes — 2.6% over — because
 *      iPhone Mail attached a 472 KB `text/html` alternative beside her text. The instruction
 *      itself is 32,228 readable bytes, well under the 60,000-byte `MAX_READABLE_BYTES` that is the
 *      actual CPU guard. The size that mattered was never the size being checked.
 *
 *   2. UNPARSED WAS THEN READ AS UNWRITTEN. The oversize path does not decode, so `body` was `""`.
 *      `clarificationFor` saw fewer than three words, returned `nothing_to_act_on`, and the
 *      `!question` guard gated out the entire `admitTask` block — including the oversize branch a
 *      few lines further down whose whole job is to open a card saying "this was too big to read,
 *      it is kept at <key>". The belt cancelled the braces.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * With HER ACTUAL MESSAGE, committed byte for byte at
 * `tests/fixtures/boss-inbound-mail/2026-09-12-iphone-mail-oversize-html-alternative.eml`, run
 * through the same `taskBodyFrom` the Worker calls and the same `clarificationFor` the Worker calls.
 * Not a reimplementation of either — a guard holding its own copy of the rule proves only that its
 * copy works.
 *
 * And structurally on the handler, for the one thing a pure function cannot show: that the intake
 * actually TELLS the clarification rules the text was never read. `unread` defaulting to `false` is
 * a silent no-op if nobody passes it, which is this repo's "exists but nothing invokes it" defect.
 *
 * RULE 0: the fixture is required. No fixture is not "no oversize bug" — it is an empty loop
 * reporting a clean bill of health.
 *
 *   node scripts/validate/an-unread-message-is-not-an-empty-one.mjs
 *   node scripts/validate/an-unread-message-is-not-an-empty-one.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { taskBodyFrom, MAX_READABLE_BYTES } from "../../src/shared/boss/intake/messageBody.mjs";
import { clarificationFor } from "../../src/shared/boss/intake/clarify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HANDLER = "src/worker/boss/intake/inboundMail.ts";
const FIXTURE = join(
  ROOT, "tests", "fixtures", "boss-inbound-mail",
  "2026-09-12-iphone-mail-oversize-html-alternative.eml",
);

/** The first words of the instruction she actually typed, under the tag line. */
const HER_FIRST_WORDS = "Please make sure the spirit page";

/** What she sent, and what it weighed. Measured, never asserted from memory. */
export function herMessage(path = FIXTURE) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return { raw, rawBytes: Buffer.byteLength(raw, "utf8") };
}

/** `MAX_BODY_BYTES`, read out of the handler itself — there is no second copy of this number. */
export function envelopeCapIn(source) {
  if (source === null) return null;
  const m = /export const MAX_BODY_BYTES = ([0-9*\s_]+);/.exec(source);
  if (!m) return null;
  const expr = m[1].replace(/_/g, "").trim();
  if (!/^[0-9*\s]+$/.test(expr)) return null;
  return expr.split("*").reduce((a, b) => a * Number(b.trim()), 1);
}

/**
 * Rule: the cap she tripped no longer trips, and the cap that actually bounds the CPU is unchanged.
 *
 * Both halves, because raising one number is only correct if the other one is still doing the job it
 * was raised in favour of. A cap raised on its own is a CPU budget removed.
 */
export function theCapIsMeasuredOnTheReadableText(cap, her) {
  const bad = [];
  if (her === null) return ["her 12 September message is not committed, so the cap is unmeasured."];
  if (cap === null) return [`MAX_BODY_BYTES could not be read out of ${HANDLER}, so nothing about the cap is verified.`];

  if (her.rawBytes <= 512 * 1024) {
    bad.push(
      `the committed fixture is ${her.rawBytes} bytes, which the OLD 512 KB cap would have accepted. `
      + "It is therefore not the message that failed and proves nothing about this bug.",
    );
  }
  if (her.rawBytes > cap) {
    bad.push(
      `her real message is ${her.rawBytes} bytes and the envelope cap is ${cap} — it would STILL be `
      + "skipped unparsed, which is the 12 September failure exactly.",
    );
  }

  let read;
  try { read = taskBodyFrom(her.raw); }
  catch (e) { return [...bad, `taskBodyFrom threw on her real message — ${String(e.message).split("\n")[0]}.`]; }

  const readableBytes = Buffer.byteLength(read.readable, "utf8");
  if (readableBytes > MAX_READABLE_BYTES) {
    bad.push(
      `her message decodes to ${readableBytes} readable bytes against a ${MAX_READABLE_BYTES}-byte `
      + "decode cap, so the envelope cap is not what was keeping her out and this fix is aimed wrong.",
    );
  }
  if (MAX_READABLE_BYTES > cap) {
    bad.push(
      `the decode cap (${MAX_READABLE_BYTES}) is larger than the envelope cap (${cap}), so the `
      + "envelope cap is the binding one again and the same class of bug is back.",
    );
  }
  if (cap > 8 * 1024 * 1024) {
    bad.push(
      `the envelope cap is ${cap} bytes. The oversize path exists because a 7 MB deck must stream to `
      + "R2 without ever being decoded; a cap above that decodes it and exhausts the invocation.",
    );
  }

  /*
   * AND THE WORDS THEMSELVES. A cap that lets the parse run, over a parser that returns the wrong
   * text, is the same lost message with a different explanation.
   */
  const body = read.body.replace(/^\s*(?:#[a-z0-9_-]+\s*)+/i, "").trimStart();
  if (!body.startsWith(HER_FIRST_WORDS)) {
    bad.push(
      `the parsed body does not begin with what she typed. expected ${JSON.stringify(HER_FIRST_WORDS)}, `
      + `got ${JSON.stringify(body.slice(0, 60))}.`,
    );
  }
  if (!/spirit page/i.test(read.body) || !/daily executive briefing/i.test(read.body)) {
    bad.push("the parsed body has lost one of the two things she asked for — the spirit page or the daily briefing.");
  }
  return bad;
}

// ─── An unread message always has something to act on ────────────────────────

/** `[what it is, input, may it come back as nothing_to_act_on]`. */
const UNREAD_CASES = [
  ["her oversize message, tag in the subject and no decoded body",
    { department: "Operations", seatName: "Simone", tag: "#simone", subject: "#simone", body: "", unread: true }, false],
  ["an unread message with no subject either",
    { department: "Operations", seatName: "Simone", tag: "#simone", subject: "", body: "", unread: true }, false],
  ["an unread message at the desk that owns the book",
    { department: "Relationships", seatName: "Monique", tag: "#monique", subject: "#monique", body: "", unread: true }, false],
  ["an unread reply",
    { department: "Operations", seatName: "Simone", tag: "#simone", subject: "Re: #simone", body: "", unread: true, isReply: true }, false],
  // THE CONTROL. The rule must still fire when the text WAS read and was genuinely empty, or the
  // fix above is not a distinction, it is a deletion.
  ["a read message with a tag and nothing in it",
    { department: "Operations", seatName: "Simone", tag: "#simone", subject: "#simone", body: "?" }, true],
];

export function unreadIsNeverNothingToActOn() {
  const bad = [];
  for (const [label, input, mayRefuse] of UNREAD_CASES) {
    const asked = clarificationFor(input);
    const refused = asked?.reason === "nothing_to_act_on";
    if (refused && !mayRefuse) {
      bad.push(
        `${label}: came back "nothing_to_act_on". An unread message has the R2 key as its handle and `
        + "is work by definition; this answer gates out the card that says so.",
      );
    }
    if (!refused && mayRefuse) {
      bad.push(
        `${label}: the "nothing to act on" rule no longer fires at all. `
        + "The unread flag has swallowed the rule rather than narrowing it.",
      );
    }
  }
  return bad;
}

// ─── The handler actually says so ────────────────────────────────────────────

/**
 * Rule: the intake tells the clarification rules the text was never read, and the oversize branch
 * that opens the card is inside the block that runs.
 */
export function theHandlerPassesItOn(source) {
  if (source === null) return [`${HANDLER} could not be read, so the live path is unverified.`];
  const bad = [];

  const call = /clarificationFor\(\{[\s\S]*?\}\)/.exec(source);
  if (!call) {
    bad.push(`${HANDLER} no longer calls clarificationFor with an object, so the flag cannot be passed.`);
  } else if (!/\bunread\s*:/.test(call[0])) {
    bad.push(
      `${HANDLER} never passes \`unread\` to clarificationFor. The flag defaults to false, so the `
      + "guard is inert and an oversize message is still read as an empty one.",
    );
  } else if (!/\bunread\s*:\s*oversize\b/.test(call[0])) {
    bad.push(
      `${HANDLER} passes \`unread\` from something other than \`oversize\`. Those are the same fact `
      + "and a second source for it is how the two got out of step in the first place.",
    );
  }

  /*
   * AND THE CARD STILL OPENS. The oversize branch lives inside the `admitTask` input; if it ever
   * moves out of that block, or the block loses the branch, the fix above buys nothing.
   */
  const admitAt = source.indexOf("await admitTask(");
  const oversizeBody = /body: oversize\b/.test(source);
  if (admitAt === -1) bad.push(`${HANDLER} no longer calls admitTask, so no message becomes work.`);
  if (!oversizeBody) {
    bad.push(
      `${HANDLER} no longer has an oversize branch on the task body, so a message too big to read `
      + "opens a card with nothing on it or no card at all.",
    );
  }
  if (admitAt !== -1 && oversizeBody && source.indexOf("body: oversize") < admitAt) {
    bad.push("the oversize body branch is no longer inside the admitTask call it is supposed to fill in.");
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

  const her = herMessage();
  const cap = envelopeCapIn(handlerSource);

  expect("the shipped cap admits her real message and keeps the decode cap", theCapIsMeasuredOnTheReadableText(cap, her), false);
  expect("an unread message is never nothing to act on", unreadIsNeverNothingToActOn(), false);
  expect("the real handler passes the flag on", theHandlerPassesItOn(handlerSource), false);

  /*
   * ─── THE NEGATIVE PROOF ───────────────────────────────────────────────────
   * Each defect restored, and required to come back red. A guard never shown failing is a comment
   * with an exit code.
   */
  expect("the 512 KB cap that skipped her message", theCapIsMeasuredOnTheReadableText(512 * 1024, her), true);
  expect("a cap raised so far the 7 MB deck would be decoded", theCapIsMeasuredOnTheReadableText(64 * 1024 * 1024, her), true);
  expect("no fixture at all", theCapIsMeasuredOnTheReadableText(cap, null), true);
  expect("a cap that cannot be read out of the handler", theCapIsMeasuredOnTheReadableText(null, her), true);
  expect("a handler that stops telling the rules the text was unread", theHandlerPassesItOn(
    handlerSource?.replace(/,\s*unread: oversize/, "") ?? null,
  ), true);
  expect("a handler that passes the flag from somewhere else", theHandlerPassesItOn(
    handlerSource?.replace("unread: oversize", "unread: false") ?? null,
  ), true);
  expect("a handler that lost the oversize card", theHandlerPassesItOn(
    handlerSource?.replace("body: oversize", "body: false && oversize") ?? null,
  ), true);
  expect("a handler that could not be read", theHandlerPassesItOn(null), true);

  if (failed) { console.error(`UNREAD/EMPTY SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("UNREAD/EMPTY SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const her = herMessage();

/* RULE 0. The fixture IS the examination. Without it this file loops over nothing. */
if (her === null) {
  console.error("UNREAD/EMPTY SCAN FAILED — her 12 September message is not committed at");
  console.error(`  ${FIXTURE.replace(ROOT + "/", "")}`);
  console.error("  Zero messages examined is not a pass. It is the original R2 key, unread, again.");
  process.exit(2);
}
if (UNREAD_CASES.length === 0) {
  console.error("UNREAD/EMPTY SCAN FAILED — there are no clarification cases, so nothing was proven.");
  process.exit(2);
}

const problems = [
  ...theCapIsMeasuredOnTheReadableText(envelopeCapIn(handlerSource), her),
  ...unreadIsNeverNothingToActOn(),
  ...theHandlerPassesItOn(handlerSource),
];

if (problems.length) {
  console.error("UNREAD/EMPTY SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error("  This is how iml_m2aymnxamhsws8k7 happened: 538,189 bytes stored perfectly in R2,");
  console.error("  32,228 readable bytes inside it, and not one task opened.");
  process.exit(2);
}

console.log(
  `UNREAD/EMPTY OK — her ${her.rawBytes}-byte message parses under a `
  + `${envelopeCapIn(handlerSource)}-byte envelope cap, its ${Buffer.byteLength(taskBodyFrom(her.raw).readable, "utf8")} `
  + `readable bytes stay under the ${MAX_READABLE_BYTES}-byte decode cap, and `
  + `${UNREAD_CASES.length} clarification case(s) agree that unread is not empty.`,
);
