#!/usr/bin/env node
/**
 * A REASON LINE SAYS WHAT THE RECORD KNOWS, AND THE RECORD KNOWS WHETHER SHE DID IT.
 *
 * ─── What she was shown, live ──────────────────────────────────────────────
 *
 *   neck          "tiny chin nod"    because: "Not done before."
 *   pelvis_lumbar "knee sway"        because: "Not done before."
 *   hips          "knee opener"      because: "Not done before."
 *   pilates       "heel slide"       because: "Not done before."
 *   upper_body    "shoulder press"   because: "Not done before."
 *
 * Five lanes, one sentence, five times. The instinct is to write five different sentences, and that
 * would paper over the finding.
 *
 * ─── The finding ───────────────────────────────────────────────────────────
 *
 * `movement_log` records which movement was CHOSEN on which day — its own `data_policy` row, from
 * 0178, says exactly that. There has never been a column, an endpoint or a control anywhere in this
 * system that records her DOING one. So `chosen.last === 0` means "never offered", and the code
 * printed "Not done before.", telling her something about her own body it had no way to know.
 *
 * It would also have stayed true for weeks by construction: LRU offers an unchosen movement first
 * and the lanes hold five to ten each, so every morning's five read "never done" until a lane ran
 * out. A TRUE REPORT OF A MISSING COMPLETION PATH, repeated until it looked like a rendering bug.
 *
 * ─── A second defect, found while fixing the first ─────────────────────────
 *
 * `logSomatic` ran on every read and DELETED the day's rows before rewriting them with a fresh
 * `chosen_at` — so the movement it had just logged became the most recently used one, the next read
 * ranked it last and picked something else, and the day was rewritten again. Measured against
 * production inside ten minutes, Today and Spirit disagreed about today's sequence and both changed
 * under her while she read them.
 *
 * ─── What is checked, by running the shipped code ──────────────────────────
 *
 *   1. THE THREE STATES THE RECORD CAN TELL APART GIVE THREE DIFFERENT SENTENCES — done, offered
 *      and nothing recorded, never offered.
 *   2. NO SENTENCE CLAIMS SHE DID OR DID NOT DO SOMETHING THE RECORD CANNOT SUPPORT. A lane that
 *      was never offered may not be described in terms of doing at all, and an UNMARKED day is
 *      UNKNOWN rather than skipped — "you have not done this" is guilt about an absence of data.
 *   3. THE COMPLETION PATH EXISTS END TO END: a `done_at` column, a worker write, an endpoint, an
 *      api method and a control on the screen. Any one missing and the reason lines go back to
 *      being guesses.
 *   4. THE DAY'S ROTATION IS DECIDED ONCE. `logSomatic` does not delete, and the contract reads the
 *      day back rather than re-selecting.
 *   5. NO GUILT. No streak, no count, no progress bar around the control.
 *
 * RULE 0: zero reason states exercised is a HARD FAILURE.
 *
 *   node scripts/validate/a-reason-is-not-a-guess.mjs
 *   node scripts/validate/a-reason-is-not-a-guess.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const BODY = "src/worker/boss/today/body.ts";
const ROUTE = "src/worker/boss/routes/today.ts";
const API = "src/client/boss/api.ts";
const VIEW = "src/client/boss/pages/BodyContract.tsx";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-14T12:00:00Z");

/** The three states, and what each is allowed to assert. */
export const STATES = [
  { name: "done four days ago", lastDone: NOW - 4 * DAY, lastChosen: NOW - 4 * DAY, mayMentionDoing: true },
  { name: "offered before and nothing recorded", lastDone: 0, lastChosen: NOW - 3 * DAY, mayMentionDoing: false },
  { name: "never offered", lastDone: 0, lastChosen: 0, mayMentionDoing: false },
];

/** Words that assert something about her body rather than about the record. */
const DOING_CLAIMS = [/\bdone\b/i, /\bdid\b/i, /\bcompleted\b/i, /\bskipped\b/i, /\bmissed\b/i];

/** Words that turn an absence of data into a failure. */
const GUILT = [/\bstreak\b/i, /\bdays? in a row\b/i, /\bkeep it up\b/i, /\byou have not\b/i, /\bbehind\b/i, /\bgoal\b/i];

export function migrationWith(migrationsDir, needle) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.reverse()) {
    const src = readFileSync(join(migrationsDir, f), "utf8");
    if (src.includes(needle)) return src;
  }
  return null;
}

export function check({ sentences, body, route, api, view, migration }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");
  const bodyCode = code(body);
  const viewCode = code(view);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(sentences) || sentences.length === 0) {
    problems.push(`No reason states were exercised, so every rule below examined nothing.`);
    return problems;
  }

  // ── 1. Three states, three sentences ─────────────────────────────────────
  const said = sentences.map((s) => s.text);
  if (new Set(said).size !== said.length) {
    problems.push(
      `Two states of the record produce the SAME sentence: ${JSON.stringify(said)}. She read one ` +
      `sentence five times because the record could only tell one story; the fix is that it can now ` +
      `tell three, not that the wording got longer.`,
    );
  }

  // ── 2. No sentence claims what the record cannot support ─────────────────
  for (const s of sentences) {
    if (!s.mayMentionDoing && DOING_CLAIMS.some((re) => re.test(s.text))) {
      problems.push(
        `"${s.text}" is the sentence for a movement ${s.name}, and it talks about DOING. Nothing in ` +
        `this system recorded her doing anything before \`done_at\` existed, and a lane that was ` +
        `never offered cannot be described in those terms at all — that is the exact claim ` +
        `"Not done before." was making five times a morning.`,
      );
    }
    for (const re of GUILT) {
      if (re.test(s.text)) {
        problems.push(
          `"${s.text}" turns an absence of data into a failure (${re.source}). An unmarked day is ` +
          `UNKNOWN, not skipped, and the standing rule against guilt binds here as it does on the ` +
          `contribution practice.`,
        );
      }
    }
  }

  // ── 3. The completion path exists end to end ─────────────────────────────
  if (!migration) {
    problems.push(
      `No migration adds \`done_at\` to \`movement_log\`. Without a place to record doing, every reason ` +
      `line is a guess dressed as a fact.`,
    );
  }
  if (!/export async function markSomaticDone/.test(bodyCode)) {
    problems.push(`${BODY} has no \`markSomaticDone\`, so nothing can write a completion.`);
  }
  if (!/today\.post\("\/movement\/done"/.test(code(route))) {
    problems.push(`${ROUTE} has no endpoint for marking the rotation done, so the write cannot be reached.`);
  }
  if (!/markRotationDone/.test(code(api))) {
    problems.push(`${API} offers no way to mark the rotation done.`);
  }
  if (!/markRotationDone|api\.markRotationDone/.test(viewCode)) {
    problems.push(
      `${VIEW} renders no control for it. A completion path with no control is the "built and ` +
      `nothing invokes it" defect, and the reason lines stay guesses.`,
    );
  }
  if (!/done_at/.test(bodyCode)) {
    problems.push(`${BODY} never reads \`done_at\`, so a completion could be written and change nothing.`);
  }

  // ── 4. The day's rotation is decided once ────────────────────────────────
  if (/DELETE FROM movement_log WHERE day_id/.test(bodyCode)) {
    problems.push(
      `${BODY} still DELETEs the day's rows before rewriting them. That is what made the rotation ` +
      `churn on every read — the movement just logged became the most recently used one, so the next ` +
      `read picked something else — and it would now also throw away a \`done_at\` she had set.`,
    );
  }
  if (!/export async function todaysSomatic/.test(bodyCode) || !/todaysSomatic\(env, dayId\)/.test(bodyCode)) {
    problems.push(
      `${BODY} does not read the day's rotation back. Re-selecting on every render is what made Today ` +
      `and Spirit disagree about the same morning.`,
    );
  }

  // ── 5. No guilt around the control ───────────────────────────────────────
  const control = /Mark the rotation done[\s\S]{0,400}/.exec(viewCode)?.[0] ?? "";
  for (const re of GUILT) {
    if (re.test(control)) problems.push(`${VIEW}'s completion control carries ${re.source}. This is a practice, not a scoreboard.`);
  }
  if (!/undo/i.test(viewCode)) {
    problems.push(
      `${VIEW}'s completion control cannot be undone. A mis-tap that cannot be taken back teaches her ` +
      `not to touch the only record of her own practice in this system.`,
    );
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, BODY)}`);
  return STATES.map((s) => ({ ...s, text: mod.becauseFor(s.lastDone, s.lastChosen) }));
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const sentences = await evaluate();
  const good = {
    sentences,
    body: readFileSync(join(ROOT, BODY), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    api: readFileSync(join(ROOT, API), "utf8"),
    view: readFileSync(join(ROOT, VIEW), "utf8"),
    migration: migrationWith(join(ROOT, "migrations"), "ALTER TABLE movement_log ADD COLUMN done_at"),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: one sentence for every state",
      input: { ...good, sentences: good.sentences.map((s) => ({ ...s, text: "Not done before." })) },
      expect: 1,
    },
    {
      name: "a never-offered movement described as not done",
      input: { ...good, sentences: good.sentences.map((s) => (s.lastChosen === 0 ? { ...s, text: "Not done before." } : s)) },
      expect: 1,
    },
    {
      name: "an unmarked day turned into a failure",
      input: { ...good, sentences: good.sentences.map((s, i) => (i === 1 ? { ...s, text: "You have not done this yet." } : s)) },
      expect: 1,
    },
    {
      name: "the done_at column never added",
      input: { ...good, migration: null },
      expect: 1,
    },
    {
      name: "no endpoint to reach the write",
      input: { ...good, route: good.route.replace('today.post("/movement/done"', 'today.post("/movement/unused"') },
      expect: 1,
    },
    {
      name: "no control on the screen",
      input: { ...good, view: good.view.replaceAll("markRotationDone", "nothing") },
      expect: 1,
    },
    {
      name: "THE CHURN: the delete-and-rewrite restored",
      input: { ...good, body: `${good.body}\nawait env.DB.prepare("DELETE FROM movement_log WHERE day_id = ?").bind(dayId).run();\n` },
      expect: 1,
    },
    {
      name: "the contract re-selecting on every render again",
      input: { ...good, body: good.body.replaceAll("todaysSomatic", "selectSomatic") },
      expect: 1,
    },
    {
      name: "a streak added around the control",
      input: { ...good, view: good.view.replace("Mark the rotation done", "Mark the rotation done — 4 day streak") },
      expect: 1,
    },
    {
      name: "the control made one-way",
      input: { ...good, view: good.view.replaceAll("undo", "final") },
      expect: 1,
    },
    { name: "RULE 0 — no states exercised", input: { ...good, sentences: [] }, expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\na-reason-is-not-a-guess self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-reason-is-not-a-guess self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [BODY, ROUTE, API, VIEW].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`a-reason-is-not-a-guess FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const sentences = await evaluate();
  const problems = check({
    sentences,
    body: readFileSync(join(ROOT, BODY), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    api: readFileSync(join(ROOT, API), "utf8"),
    view: readFileSync(join(ROOT, VIEW), "utf8"),
    migration: migrationWith(join(ROOT, "migrations"), "ALTER TABLE movement_log ADD COLUMN done_at"),
  });

  if (problems.length) {
    console.error("a-reason-is-not-a-guess FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-reason-is-not-a-guess: ${sentences.length} states of the record give ${new Set(sentences.map((s) => s.text)).size} ` +
    `different sentences, none claiming she did or skipped anything the record cannot support; the ` +
    `completion path runs column → write → endpoint → api → control, and the day's rotation is ` +
    `decided once. OK.`,
  );
}
