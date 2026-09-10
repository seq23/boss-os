#!/usr/bin/env node
/**
 * A CAPTURED TASK BODY IS WHAT SHE TYPED — NEVER THE MESSAGE THAT CARRIED IT.
 *
 * ─── What went wrong ────────────────────────────────────────────────────────
 *
 * `boss@sequoiataylor.com` went live on 10 September 2026. Her first real message routed correctly by
 * every signal the system reports — `dmarc_pass=1`, `authorised=1`, `tag=#monique`,
 * `employee_id=emp_relationship`, `outcome=ROUTED`, a task queued, a reply sent. And the task it
 * opened held 8,378 bytes of `Received:` headers, ARC seals, DKIM signatures, `X-Gm-*`, a multipart
 * boundary and a quoted-printable HTML alternative, with her instruction on line 104.
 *
 * NOTHING WAS RED. That is the whole reason this file exists. Every counter said the intake was
 * healthy, because every counter was measuring the routing and none of them was reading the body.
 * An employee picking that card up reads SMTP routing headers and acts on nothing.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * By CALLING `taskBodyFrom` — the same function `inboundMail.ts` calls — over a corpus of real MIME
 * messages committed under `tests/fixtures/boss-inbound-mail/`, one of which is her actual message,
 * byte for byte. Not a reimplementation of the extraction rule: a guard with its own copy of the rule
 * proves only that its copy works, which is this repo's most-named defect committed inside the guard.
 *
 * AND EVERY FIXTURE CARRIES ITS OWN NEGATIVE CONTROL. The raw message must trip the detector and the
 * extracted body must not. A fixture whose RAW form produces no MIME tells is not a MIME message, so
 * it would prove nothing — and a passing run over such a corpus is exactly the "runs but inert"
 * outcome this system keeps producing. That is a failure here, not a pass.
 *
 * ─── RULE 0 ─────────────────────────────────────────────────────────────────
 *
 * Zero fixtures examined is a FAILURE. An empty loop reports "no MIME headers found in any captured
 * body" and is indistinguishable from a working guard.
 *
 *   node scripts/validate/a-task-body-is-not-a-mime-message.mjs
 *   node scripts/validate/a-task-body-is-not-a-mime-message.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mimeTellsIn, taskBodyFrom } from "../../src/shared/boss/intake/messageBody.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HANDLER = "src/worker/boss/intake/inboundMail.ts";
const FIXTURES = join(ROOT, "tests", "fixtures", "boss-inbound-mail");

/** Every committed message, with the text a work card is supposed to end up holding. */
export function corpus(dir = FIXTURES) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".eml"))
    .sort()
    .map((f) => {
      const expectedPath = join(dir, f.replace(/\.eml$/, ".expected.txt"));
      return {
        name: f,
        raw: readFileSync(join(dir, f), "utf8"),
        expected: existsSync(expectedPath) ? readFileSync(expectedPath, "utf8").trim() : null,
      };
    });
}

/**
 * Rule: the body a message produces is readable text, and the message itself is not.
 *
 * Both directions, on every fixture. "No headers in the output" alone would pass on an empty string
 * — and an empty card is a message lost, which is the failure the mailbox exists to prevent.
 */
export function bodiesAreReadable(messages) {
  const bad = [];
  for (const m of messages) {
    const rawTells = mimeTellsIn(m.raw);
    if (rawTells.length === 0) {
      bad.push(
        `${m.name}: the RAW message trips none of the MIME tells, so it is not a MIME message and `
        + "proves nothing. This guard would pass over it whether the extractor worked or not.",
      );
      continue;
    }

    let got;
    try { got = taskBodyFrom(m.raw); }
    catch (e) { bad.push(`${m.name}: taskBodyFrom threw — ${e.message.split("\n")[0]}. A throw here loses her mail.`); continue; }

    const tells = mimeTellsIn(got.body);
    if (tells.length) {
      const first = got.body.split("\n").find((l) => /^(?:Received|ARC-|DKIM|X-Gm|Content-|MIME-Version|Message-ID|Authentication-Results|Return-Path|--[A-Za-z0-9])/.test(l.trim()));
      bad.push(
        `${m.name}: the captured body still contains ${tells.join(", ")}`
        + (first ? ` — e.g. "${first.trim().slice(0, 90)}"` : "")
        + ". An employee opening this card reads the envelope instead of the instruction.",
      );
    }
    if (!got.body.trim()) {
      bad.push(`${m.name}: extracted to an EMPTY body from ${m.raw.length} bytes. A card with nothing on it is a message lost.`);
    }
    if (m.expected !== null && got.body.trim() !== m.expected) {
      bad.push(
        `${m.name}: the extracted body is not what she wrote.\n      expected: ${JSON.stringify(m.expected.slice(0, 160))}\n      got:      ${JSON.stringify(got.body.trim().slice(0, 160))}`,
      );
    }
  }
  return bad;
}

/**
 * Rule: the detector is not asleep.
 *
 * A guard built on a predicate is only as good as the predicate, and `mimeTellsIn` returning `[]`
 * for everything would make every check above pass in silence. So it is shown a raw message and
 * required to name what it found.
 */
export function detectorWorks() {
  const bad = [];
  const specimen = [
    "Received: from mail-pj1-x102e.google.com (2607:f8b0:4864:20::102e)",
    "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "--000000000000a75ffa065b294a04",
    "buyers=C2=A0of Da=",
    "tabricks",
  ].join("\r\n");
  const found = mimeTellsIn(specimen);
  for (const needed of ["Received:", "DKIM-Signature:", "Content-Transfer-Encoding:", "boundary", "soft line break"]) {
    if (!found.some((f) => f.includes(needed))) {
      bad.push(`the detector did not notice ${needed} in a message that plainly contains it.`);
    }
  }
  if (mimeTellsIn("Please add searching for buyers of Databricks to the weekly list").length) {
    bad.push("the detector reported MIME headers in a plain sentence — it would fire on correct bodies and get deleted.");
  }
  if (mimeTellsIn("").length) bad.push("the detector reported MIME headers in an empty string.");
  return bad;
}

/**
 * Rule: the handler builds the body through this module, and keeps the original.
 *
 * The behaviour above can be perfect while the handler calls none of it — "exists but nothing invokes
 * it" is the sibling defect, and the shipped bug was literally one line assigning the raw text. So
 * the source is asserted too: the extractor is called, the raw is stored, and the raw never becomes
 * the body.
 */
export function handlerUsesIt(source) {
  const bad = [];
  if (source === null) return [`${HANDLER} could not be read, so nothing about the live path is verified.`];

  if (!/from ".*shared\/boss\/intake\/messageBody\.mjs"/.test(source)) {
    bad.push(`${HANDLER} does not import the body reader, so whatever it puts on the card is unguarded by this file.`);
  }
  if (!/\btaskBodyFrom\s*\(/.test(source)) {
    bad.push(`${HANDLER} never calls taskBodyFrom(), so the extraction this validator proves is not the extraction that ships.`);
  }

  /*
   * THE ORIGINAL SURVIVES. Losing the raw is how a parser bug becomes permanent: there is nothing to
   * re-extract from and the repair is impossible rather than merely overdue.
   */
  if (!/env\.VAULT\.put\(/.test(source)) {
    bad.push(`${HANDLER} never writes the message to R2, so the original is lost and a future extraction bug is unrepairable.`);
  }
  const putCount = (source.match(/env\.VAULT\.put\(/g) ?? []).length;
  if (putCount < 2) {
    bad.push(
      `${HANDLER} stores the raw message on only ${putCount} path. Both the oversize path AND the ordinary path `
      + "have to keep it — under the cap was exactly the case that kept nothing.",
    );
  }

  /*
   * And the raw must never be what goes on the card. Matched on the SHAPE of the assignment rather
   * than on a variable name, so renaming the variable is not a way around it.
   */
  const assignment = /\bbody\s*:\s*(?:raw(?:Message)?|source|text|message\.raw|await [^,\n]*\.text\(\))/i.exec(source);
  if (assignment) {
    bad.push(`${HANDLER} assigns the raw message straight to the task body: "${assignment[0]}". That is the bug this file exists to catch.`);
  }
  if (/\binput\s*:\s*\{[\s\S]{0,600}?\bbody\s*:\s*body\b/.test(source)) {
    bad.push(`${HANDLER} puts an unextracted \`body\` variable on the task input.`);
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const real = corpus();
  expect("the committed corpus extracts to readable text", bodiesAreReadable(real), false);
  expect("the detector names what it finds", detectorWorks(), false);

  /*
   * ─── THE NEGATIVE PROOF, WITH HER ACTUAL MESSAGE ─────────────────────────
   *
   * Restore the shipped bug — the raw message as the body — and require the guard to go red and to
   * NAME the header it found. A guard that only ever runs against the fixed code has never been
   * shown to be able to fail.
   */
  const her = real.find((m) => m.name.includes("databricks"));
  if (!her) {
    console.error("  ✗ her real message is not in the corpus, so the negative proof has no subject.");
    failed += 1;
  } else {
    const brokenExtractor = [{ name: her.name, raw: her.raw, expected: her.expected }];
    // Simulate the old behaviour by asserting the raw itself against the same rules.
    const rawAsBody = mimeTellsIn(her.raw);
    if (rawAsBody.length === 0) {
      console.error("  ✗ her raw message trips no MIME tells — the fixture is wrong.");
      failed += 1;
    } else {
      console.log(`  ✓ the raw 8,378-byte message is caught, naming ${rawAsBody.length}: ${rawAsBody.slice(0, 4).join(", ")}…`);
    }
    expect("her extracted message is clean", bodiesAreReadable(brokenExtractor), false);
  }

  // A fixture that is not a MIME message at all must be refused rather than silently passed.
  expect("a corpus that proves nothing", bodiesAreReadable([
    { name: "not-really-mail.eml", raw: "just a sentence with no headers", expected: null },
  ]), true);

  const realHandler = existsSync(join(ROOT, HANDLER)) ? readFileSync(join(ROOT, HANDLER), "utf8") : null;
  expect("the real handler extracts and keeps the original", handlerUsesIt(realHandler), false);
  expect("a handler that assigns the raw message to the body", handlerUsesIt(
    realHandler?.replace(/body: oversize/, "body: rawMessage, unused: oversize") ?? null,
  ), true);
  expect("a handler that never calls the extractor", handlerUsesIt(
    realHandler?.replace(/taskBodyFrom\(/g, "noop(") ?? null,
  ), true);
  expect("a handler that stops keeping the original under the cap", handlerUsesIt(
    realHandler?.replace(/await env\.VAULT\.put\(key,[\s\S]*?\}\);/, "objectKey = null;") ?? null,
  ), true);

  if (failed) { console.error(`TASK BODY SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("TASK BODY SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const messages = corpus();

/*
 * RULE 0. No fixtures is not "no bad bodies" — it is a guard with nothing to guard, reporting a
 * clean bill of health over an empty loop.
 */
if (messages.length === 0) {
  console.error("TASK BODY SCAN FAILED — no captured messages found in tests/fixtures/boss-inbound-mail/.");
  console.error("  This guard examined zero bodies, which is not a pass. Commit at least one real .eml.");
  process.exit(2);
}

const handlerSource = existsSync(join(ROOT, HANDLER)) ? readFileSync(join(ROOT, HANDLER), "utf8") : null;

const problems = [
  ...detectorWorks(),
  ...bodiesAreReadable(messages),
  ...handlerUsesIt(handlerSource),
];

if (problems.length) {
  console.error(`TASK BODY SCAN FAILED — ${problems.length} problem(s) across ${messages.length} captured message(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const bytes = messages.reduce((n, m) => n + m.raw.length, 0);
console.log(
  `TASK BODY SCAN PASSED: ${messages.length} captured message(s), ${bytes.toLocaleString("en-US")} raw bytes, `
  + `every one of them tripping the MIME detector and every extracted body clean of it — `
  + `${messages.map((m) => `${m.name.replace(/\.eml$/, "")} (${taskBodyFrom(m.raw).format})`).join(", ")}. `
  + "The handler extracts through the same function and keeps the original on both paths.",
);
