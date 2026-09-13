#!/usr/bin/env node
/**
 * A CONTRIBUTION CANNOT BE RECORDED WITHOUT SAYING WHAT IT WAS, AND THE PANEL NAMES THE PRACTICE.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * The Spirit page carried one button reading "Record a contribution". Its whole implementation:
 *
 *     onClick={() => api.recordContribution({ kind: "help" }).then(load)}
 *
 * The owner pressed it not knowing what it was — "i dont know what 'record a contribution' is i just
 * pushed the button" — and it wrote FOUR rows in 23 seconds: 13:30:39, 13:30:42, 13:31:01, 13:31:02,
 * every one `kind = 'help'`, every one `note = NULL`. Her September then read "4 this month" against
 * an ideal of four. A full month of canon §44 practice, logged by accident, in under half a minute.
 *
 * Three faults in one line, and all three belong to the screen:
 *
 *   1. It did not say what it was. §44 is a practice — acts of giving or helping, one a month the
 *      floor, four a good month, explicitly no guilt and no daily requirement. The panel showed
 *      three bare numbers and a button.
 *   2. It recorded no note, so the log was worthless. `contributions.note` has existed since 0160
 *      and was never written. A practice log that cannot be read back in December is a counter.
 *   3. It wrote immediately and could not be undone from the page. The four rows had to be deleted
 *      from production by hand.
 *
 * ─── What is actually checked ───────────────────────────────────────────────
 *
 *   1. The WORKER refuses a contribution with no note. Server-side, because a client-side check is
 *      a suggestion — the endpoint is what four taps actually reached.
 *   2. No call site posts a contribution without a note. This is the specific line that caused it,
 *      and it is checked as a shape so the next hardcoded one-tap write is caught too.
 *   3. A delete path exists, goes through a real endpoint, and writes an `audit_log` row. Removing
 *      a record of her own practice is hers to do and must leave a trace.
 *   4. The panel's copy NAMES THE PRACTICE: what a contribution is, the floor, the good month, and
 *      that there is no guilt and no daily requirement — §44's tone is part of its specification.
 *   5. NO STREAK, NO PROGRESS BAR, NO NUDGE. A progress bar toward "a good month" is guilt with a
 *      nicer name, and the spec forbids it. This is the check that stops a well-meaning future
 *      contributor from adding encouragement to a practice whose defining rule is that it does not
 *      encourage.
 *   6. The panel renders the ENTRIES, not only the count.
 *
 * RULE 0: finding zero `recordContribution` call sites, or no POST handler, is a HARD FAILURE — the
 * scan would otherwise pass by examining nothing.
 *
 *   node scripts/validate/a-contribution-says-what-it-was.mjs
 *   node scripts/validate/a-contribution-says-what-it-was.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PAGE = "src/client/boss/pages/Spirit.tsx";
const ROUTES = "src/worker/boss/routes/spirit.ts";

/**
 * Words that turn a reflection into a scoreboard. §44's tone is the specification, so these are
 * forbidden in this panel's copy rather than merely discouraged.
 */
const GUILT_WORDS = [
  /\bstreak\b/i,
  /\bdays? in a row\b/i,
  /\bkeep it up\b/i,
  /\bdon'?t break\b/i,
  /\byou'?re behind\b/i,
  /\bon track\b/i,
  /\bgoal\b/i,
];

/** Every `api.recordContribution({ … })` call and the object literal it posts. */
export function recordCallSites(source) {
  const out = [];
  for (const m of source.matchAll(/recordContribution\(\s*\{/g)) {
    const start = source.indexOf("{", m.index + m[0].length - 1);
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(start, end + 1));
  }
  return out;
}

/** The body of the panel component, which is where the copy rules apply. */
export function panelBody(source) {
  const start = source.indexOf("function ContributionPanel");
  if (start === -1) return null;
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

export function check({ page, routes }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const pageCode = code(page);
  const routesCode = code(routes);

  // ── 1. The Worker refuses a note-less contribution ────────────────────────
  const post = /spirit\.post\(\s*["']\/contributions["'][\s\S]*?\n\}\);/.exec(routesCode);
  if (!post) {
    problems.push(
      `${ROUTES} has no POST /contributions handler this scan can read. A scan that cannot find the ` +
      `endpoint four taps actually reached has proved nothing.`,
    );
    return problems; // RULE 0.
  }
  const handler = post[0];
  /*
   * THE CONDITION MUST BE ABOUT THE NOTE, and this scan learned that the hard way on its own
   * negative proof. The first draft asked whether `note` appeared within 200 characters of a
   * `throw badRequest` — and when the note guard was deleted outright, the handler still passed,
   * because `const note = optionalText(b?.note)` sits a few lines above the UNRELATED guard
   * `if (!Number.isFinite(ts)) throw badRequest("ts is an epoch millisecond timestamp")`. Proximity
   * is not causation. So: an `if` whose TEST names the note and whose body throws.
   */
  /*
   * Bounded by BRACES rather than by parentheses: the real guard reads
   * `if (!note || note.trim().length < CONTRIBUTION_NOTE_MIN) {`, and a `[^)]*` test cannot cross
   * the parentheses inside `note.trim()`. That draft rejected the correct code — a validator that
   * fails the fix it is asking for teaches people to write worse code to satisfy it.
   */
  const guards = /if\s*\([^{}]*?\bnote\b[^{}]*?\)\s*\{[\s\S]{0,400}?throw badRequest/.test(handler);
  if (!guards) {
    problems.push(
      `${ROUTES}'s POST /contributions does not refuse a contribution with no note. The check has to ` +
      `be here and not only on the screen: a client-side check is a suggestion, and the endpoint is ` +
      `what four accidental taps actually reached. Without a note the log is a number nobody can ` +
      `read back, and a write that needs no input is a write a tap can repeat.`,
    );
  }
  if (!/note,\s*b\?\.anonymous|,\s*note,/.test(handler)) {
    problems.push(
      `${ROUTES}'s POST /contributions does not bind the validated note into the INSERT. The column ` +
      `has existed since migration 0160 and went unwritten for the life of the feature.`,
    );
  }

  // ── 2. No call site posts without a note ──────────────────────────────────
  const calls = recordCallSites(pageCode);
  if (calls.length === 0) {
    problems.push(
      `${PAGE} has ZERO recordContribution call sites. Either the control is gone or this scan can no ` +
      `longer see it; both mean it examined nothing.`,
    );
  }
  for (const call of calls) {
    if (!/\bnote\b/.test(call)) {
      problems.push(
        `${PAGE} posts a contribution with no note: ${call.replace(/\s+/g, " ").slice(0, 100)}. This is ` +
        `the exact line that recorded four accidental rows in 23 seconds, every one \`kind = 'help'\` ` +
        `and \`note = NULL\`.`,
      );
    }
  }

  // ── 3. A delete path, through an endpoint, with an audit row ──────────────
  const del = /spirit\.delete\(\s*["']\/contributions\/:id["'][\s\S]*?\n\}\);/.exec(routesCode);
  if (!del) {
    problems.push(
      `${ROUTES} has no DELETE /contributions/:id. The four accidental rows had to be removed from ` +
      `production with a terminal, because the page that wrote them could not unwrite them.`,
    );
  } else if (!/audit\(/.test(del[0])) {
    problems.push(
      `${ROUTES}'s DELETE /contributions/:id writes no audit_log row. Removing a record of her own ` +
      `practice is hers to do and must leave a trace — that is what separates a correction from a ` +
      `quiet edit, and the audit entry is the only record that survives the row.`,
    );
  }
  if (!/api\.removeContribution\(/.test(pageCode)) {
    problems.push(`${PAGE} offers no way to remove a contribution, so a mistaken entry still needs an engineer.`);
  }

  // ── 4, 5, 6. The panel's copy ─────────────────────────────────────────────
  const panel = panelBody(page);
  if (!panel) {
    problems.push(
      `${PAGE} has no ContributionPanel component. The copy rules below have nothing to apply to, ` +
      `which means this scan examined nothing.`,
    );
    return problems; // RULE 0.
  }

  for (const [what, pattern] of [
    ["what a contribution IS", /act of giving or helping/i],
    ["that one a month is the requirement", /one a month/i],
    // Whitespace-tolerant throughout: JSX prose wraps, and a sentence that means the right thing
    // must not fail this scan because a line break landed in the middle of it.
    ["that four is a good month", /four\s+is\s+a\s+good\s+month/i],
    ["that there is no daily version", /no\s+daily\s+version/i],
    ["that there is no streak", /no\s+streak/i],
  ]) {
    if (!pattern.test(panel)) {
      problems.push(
        `${PAGE}'s contribution panel does not say ${what}. Canon §44's tone is part of its ` +
        `specification, and a panel that offers the action without naming the practice is what made ` +
        `"i just pushed the button" the reasonable thing to have done.`,
      );
    }
  }

  /*
   * NEGATIONS ARE NOT VIOLATIONS, and the first draft of this scan proved why it has to be said.
   *
   * The panel's copy promises "no streak" and "not a goal" — the very sentences §44 requires — and
   * a bare word match read them as the panel HAVING a streak. A validator that fails the fix it is
   * asking for teaches people to delete the promise, and the promise is the whole point. So a match
   * preceded by no/not/never/without in the same clause is the copy keeping its word.
   */
  const negated = (text, index) => /\b(no|not|never|without)\b[^.;]{0,20}$/i.test(text.slice(Math.max(0, index - 24), index));

  for (const word of GUILT_WORDS) {
    const hit = new RegExp(word.source, word.flags.includes("g") ? word.flags : `${word.flags}g`);
    let unnegated = false;
    for (const m of panel.matchAll(hit)) {
      if (!negated(panel, m.index)) unnegated = true;
    }
    if (unnegated) {
      problems.push(
        `${PAGE}'s contribution panel uses ${word.source}. §44 is explicit: no guilt, no daily ` +
        `requirement. A streak turns a practice of giving into something you can fail at, and a ` +
        `progress bar toward "a good month" is guilt with a nicer name. The number is a reflection, ` +
        `not a goal.`,
      );
    }
  }

  if (!/progress|meter/i.test(panel)) {
    // Absence is what we want; nothing to report. (Stated so the next reader does not "fix" it.)
  } else {
    problems.push(
      `${PAGE}'s contribution panel renders a progress indicator. The spec forbids a target to fall ` +
      `short of; the count stands on its own.`,
    );
  }

  if (!/contribution\.entries|entries\.map\(/.test(panel)) {
    problems.push(
      `${PAGE}'s contribution panel shows only the count. \`contribution.entries\` comes back from the ` +
      `API already and went unrendered, so the record she was building was invisible on the one ` +
      `screen building it.`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodRoutes = `
spirit.post("/contributions", async (c) => {
  const note = optionalText(b?.note);
  if (!note || note.trim().length < 4) {
    throw badRequest("A contribution needs a note saying what it was", "A few words is plenty.");
  }
  await c.env.DB.prepare("INSERT INTO contributions (...) VALUES (?,?,?)").bind(id, ts, note, b?.anonymous ? 1 : 0).run();
  await audit(c.env.DB, { action: "recorded" });
  return ok(c, {}, 201);
});
spirit.delete("/contributions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM contributions WHERE id = ?").bind(id).run();
  await audit(c.env.DB, { action: "removed" });
  return ok(c, { removed: true });
});
`;
  const goodPage = `
function ContributionPanel({ contribution, onDone, onError }) {
  const entries = contribution.entries ?? [];
  async function submit() {
    await api.recordContribution({ kind, note: note.trim(), recipient: recipient.trim() || undefined });
  }
  async function remove(id) { await api.removeContribution(id); }
  return (
    <div className="panel">
      <p className="row-sub">
        A contribution is an act of giving or helping. One a month is the whole requirement and
        four is a good month. There is no daily version of this, no streak, and nothing is owed.
      </p>
      {entries.map((entry) => (<div key={entry.id}>{entry.note}</div>))}
      <button onClick={() => void submit()}>Record something you gave or helped with</button>
    </div>
  );
}
function Next() {}
`;

  const cases = [
    { name: "the shipped shape passes", page: goodPage, routes: goodRoutes, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: the hardcoded one-tap {kind:'help'} call",
      page: goodPage.replace(
        "await api.recordContribution({ kind, note: note.trim(), recipient: recipient.trim() || undefined });",
        'await api.recordContribution({ kind: "help" });',
      ),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "the Worker's note guard removed, so the screen is the only check",
      page: goodPage,
      routes: goodRoutes.replace(/  if \(!note[\s\S]*?\n  \}\n/, ""),
      expect: 1,
    },
    {
      name: "the note validated but never bound into the INSERT",
      page: goodPage,
      routes: goodRoutes.replace(".bind(id, ts, note, b?.anonymous ? 1 : 0)", ".bind(id, ts, null, 0)"),
      expect: 1,
    },
    {
      name: "no delete endpoint at all",
      page: goodPage,
      routes: goodRoutes.replace(/spirit\.delete[\s\S]*?\n\}\);/, ""),
      expect: 1,
    },
    {
      name: "a delete that writes no audit row",
      page: goodPage,
      routes: goodRoutes.replace('await audit(c.env.DB, { action: "removed" });', ""),
      expect: 1,
    },
    {
      name: "the page offering no way to remove one",
      page: goodPage.replace("await api.removeContribution(id);", ""),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "copy that never says what a contribution IS",
      page: goodPage.replace("an act of giving or helping", "a thing"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "copy that drops the no-streak promise",
      page: goodPage.replace(", no streak,", ","),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "GUILT: a streak added to the panel",
      page: goodPage.replace("<button onClick", '<div>Your streak: 3 days in a row</div>\n      <button onClick'),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "GUILT: a goal added to the panel",
      page: goodPage.replace("<button onClick", "<div>2 more to reach your goal</div>\n      <button onClick"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "GUILT: a progress bar toward a good month",
      page: goodPage.replace("<button onClick", '<div className="progress" />\n      <button onClick'),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "the panel showing only the count, never the entries",
      page: goodPage.replace("{entries.map((entry) => (<div key={entry.id}>{entry.note}</div>))}", "").replace("const entries = contribution.entries ?? [];", "const entries = [];"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "RULE 0 — no POST handler at all",
      page: goodPage,
      routes: goodRoutes.replace(/spirit\.post[\s\S]*?\n\}\);/, ""),
      expect: 1,
    },
    {
      name: "RULE 0 — no ContributionPanel component",
      page: goodPage.replace("function ContributionPanel", "function Something"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "RULE 0 — no recordContribution call site at all",
      page: goodPage.replace(/await api\.recordContribution\([\s\S]*?\);/, ""),
      routes: goodRoutes,
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check({ page: c.page, routes: c.routes }).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\na-contribution-says-what-it-was self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-contribution-says-what-it-was self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [PAGE, ROUTES].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`a-contribution-says-what-it-was FAILED — ${missing.join(" and ")} missing. A scan whose subject does not exist must fail.`);
    process.exit(1);
  }

  const page = readFileSync(join(ROOT, PAGE), "utf8");
  const problems = check({ page, routes: readFileSync(join(ROOT, ROUTES), "utf8") });

  if (problems.length) {
    console.error("a-contribution-says-what-it-was FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-contribution-says-what-it-was: ${recordCallSites(page).length} record call site(s), each carrying ` +
    `a note; the endpoint refuses one without; removal goes through an audited endpoint; the panel ` +
    `names the practice and keeps §44's tone. OK.`,
  );
}
