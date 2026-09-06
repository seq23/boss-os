#!/usr/bin/env node
/**
 * A LIST MUST SAY SOMETHING WHILE IT IS STILL BEING FETCHED.
 *
 * WHY THIS EXISTS. On 3 Sep 2026, CI run 33804904248 failed with 18 red journeys. Fifteen were
 * collateral from a `wrangler dev` crash, but TWO were real and they were the interesting ones:
 * `d0-empty-firm` and `d1-design-states` reported four and thirteen `card-list`s as
 * "empty with no row explaining what would fill them". The very next run, on IDENTICAL product
 * code, passed. Nothing had changed but the load on the runner.
 *
 * That non-determinism was the whole clue. The lists were not empty — they were still LOADING,
 * and while loading they rendered a `<ul class="card-list">` with no children and nothing beside
 * it. The design system's rule (§7) is that an empty slot is a STATED FACT, and
 * `e2e/support/surfaces.ts` says loading and empty share one slot, "told apart by tone — never a
 * blank". These lists broke that: for the width of a fetch they were the exact ambiguous blank a
 * reader cannot tell from "broken" or "you may not see this".
 *
 * The shape of the bug, every time, is an empty-state row GATED ON THE FETCH HAVING FINISHED:
 *
 *     {!projects.loading && rows.length === 0 && <li className="state-empty">Nothing yet…</li>}
 *     {p && p.holdings.length === 0 && <li className="state-empty">The fund holds nothing…</li>}
 *
 * Both are correct once the data lands and both render NOTHING before it does. The author was
 * avoiding a flash of "nothing yet" during load, which is a real concern — but the answer is a
 * loading row, not a blank.
 *
 * WHY A STATIC SCAN AND NOT ONLY THE SWEEP. `e2e/support/surfaces.ts` walks the real DOM and is
 * the better test of truth, but it can only see the defect when a fetch is slow enough to be
 * caught mid-flight — which is why this went undetected for weeks and then failed at random. This
 * scan reads the source and is deterministic: it does not need the race to happen.
 *
 * THE RULE. Every `ul.card-list` / `ol.card-list` in the client must have at least one
 * `state-empty` / `state-message` row that CAN RENDER WHILE THE FETCH IS IN FLIGHT — either
 * unconditional, or explicitly guarded on the loading flag.
 *
 * Run `--self-test` to prove it still catches what it exists to catch.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/client";

/**
 * Lists whose contents are NOT fetched — they render from values already in hand (a constant, a
 * prop, local component state). A list that never waits cannot be blank while waiting.
 *
 * Kept as an explicit, justified allowlist rather than inferred, because inference here fails
 * open: a source expression this scan does not recognise would silently stop being checked.
 */
const NOT_FETCHED = new Set([
  // `<testid>  # why it cannot be mid-fetch`
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Every `card-list` element in a source file, with its body text and where it starts.
 *
 * Matched by scanning for the opening tag and then walking forward counting nested `<ul`/`<ol`
 * opens against closes, so a list containing another list is read as one element rather than
 * truncated at the inner close.
 */
export function cardLists(src, file = "?") {
  const out = [];
  const open = /<(ul|ol)\b([^>]*)>/g;
  let m;
  while ((m = open.exec(src)) !== null) {
    const [, tag, attrs] = m;
    if (!/className=(?:"[^"]*\bcard-list\b|\{[^}]*\bcard-list\b)/.test(attrs)) continue;
    // Walk to the matching close, counting nesting of the SAME tag name.
    const nest = new RegExp(`<${tag}\\b|</${tag}>`, "g");
    nest.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let n;
    while ((n = nest.exec(src)) !== null) {
      depth += n[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = n.index;
        break;
      }
    }
    const testid = /data-testid="([^"]+)"/.exec(attrs)?.[1] ?? null;
    out.push({
      file,
      tag,
      testid,
      line: src.slice(0, m.index).split("\n").length,
      body: end === -1 ? src.slice(m.index) : src.slice(open.lastIndex, end),
      after: end === -1 ? "" : src.slice(end, end + 600),
    });
  }
  return out;
}

/**
 * The guard standing in front of a state row: the `{`-expression text from the enclosing brace up
 * to the `<li`/`<p` that carries the class. An unguarded row returns "".
 */
function guardBefore(body, at) {
  const open = body.lastIndexOf("{", at);
  if (open === -1) return "";
  const guard = body.slice(open + 1, at);
  // More than one JSX element between the brace and here means we did not find ITS guard.
  return guard.length > 400 ? "" : guard;
}

/**
 * Can this row appear while the fetch is still in flight?
 *
 * Worked out by EVALUATING the guard in the state the page is in mid-fetch, rather than by
 * pattern-matching it. Mid-fetch, two things are true and everything follows from them: the
 * fetched value is `undefined`, and the `?? []` fallback every list already writes makes the row
 * array EMPTY. So:
 *
 *   `rows.length === 0`      -> TRUE  mid-fetch. The empty row shows early. That is the design
 *                                     system working as documented: loading and empty share one
 *                                     slot, "told apart by tone — never a blank".
 *   `!x.loading`             -> FALSE mid-fetch. This is the defect: the author suppressed the
 *                                     one thing that would have been on screen.
 *   `p &&` / `x.data &&`     -> FALSE mid-fetch, for the same reason in a different costume.
 *   `!p &&` / `!x.data &&`   -> TRUE  mid-fetch.
 *   `rows.length > 0`        -> FALSE mid-fetch.
 *   anything else (`open`, `isMp`, a disclosure flag) -> not about the fetch; assumed TRUE, so an
 *                                     unrecognised condition never invents a defect.
 *
 * A row renders mid-fetch only if EVERY top-level `&&` conjunct does.
 */
export function rendersWhileLoading(guard) {
  const g = guard.trim();
  if (g === "") return true;
  const conjuncts = splitConjuncts(g);
  return conjuncts.every(conjunctHoldsMidFetch);
}

/** Split on `&&` that is not inside brackets, so `(a ?? []).length` stays in one piece. */
export function splitConjuncts(g) {
  const out = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && c === "&" && g[i + 1] === "&") {
      out.push(g.slice(last, i));
      last = i + 2;
      i += 1;
    }
  }
  out.push(g.slice(last));
  return out.map((c) => c.trim()).filter((c) => c.length > 0);
}

function conjunctHoldsMidFetch(c) {
  if (/!\s*[\w.]*\.loading\b/.test(c)) return false;
  if (/[\w.]*\.loading\b/.test(c)) return true;
  if (/\.length\s*(===|==)\s*0\b/.test(c)) return true;
  if (/\.length\s*(>|>=|!==|!=)\s*\d/.test(c)) return false;
  // A bare presence check on a value that has not arrived.
  if (/^!\s*[\w[\]?.]+$/.test(c)) return true;
  if (/^[\w[\]?.]+$/.test(c)) return false;
  return true;
}

/**
 * The spans of a `.map(...)` callback inside a list body — everything a ROW draws for itself.
 *
 * A `state-empty` in there ("no health check recorded") explains one row's missing field. It is
 * not the list's explanation, and counting it as one is how `provider-catalog` looked covered
 * while having no empty state at all.
 */
function mapSpans(body) {
  const spans = [];
  const re = /\.map\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let depth = 0;
    for (let i = m.index + 4; i < body.length; i += 1) {
      if (body[i] === "(") depth += 1;
      else if (body[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          spans.push([m.index, i]);
          break;
        }
      }
    }
  }
  return spans;
}

/** Every state row that speaks for THE LIST (or stands immediately beside it), and whether it waits. */
export function stateRows(list) {
  const rows = [];
  for (const scope of [list.body, list.after]) {
    const spans = scope === list.body ? mapSpans(scope) : [];
    const re = /className="[^"]*\bstate-(?:empty|message)\b[^"]*"/g;
    let m;
    while ((m = re.exec(scope)) !== null) {
      const tagStart = scope.lastIndexOf("<", m.index);
      if (spans.some(([a, b]) => tagStart > a && tagStart < b)) continue;
      rows.push({ guard: guardBefore(scope, tagStart), scope: scope === list.body ? "inside" : "beside" });
    }
  }
  return rows;
}

/**
 * Does this list draw its rows from a value that MIGHT NOT HAVE ARRIVED YET?
 *
 * The signal is the author's own optionality: `catalog.data?.providers ?? []`, `p?.holdings ?? []`,
 * `x.data?.rows`. Writing `?.` or `?? []` is the author saying, in the type system, "this can be
 * absent" — and absent is exactly the moment the list must still say something. A list mapping a
 * plain array it already holds (`rows.map`, `props.items.map`) cannot be caught mid-fetch and is
 * not this scan's business.
 *
 * Deliberately read from the SOURCE rather than from an allowlist of testids: an allowlist of
 * seventy entries is decoration, and every entry on it is a place this scan has stopped looking.
 */
export function awaitsAFetch(body) {
  return /\{\s*\(?[\w.]*(?:\?\.|\.data\b)[\w.?]*(?:\s*\?\?\s*\[\])?\)?\s*\.map\b/.test(body) || /\?\?\s*\[\]\s*\)?\s*\.map\b/.test(body);
}

/** Lists that would be a bare blank for the width of a fetch. */
export function violations(lists) {
  const bad = [];
  for (const list of lists) {
    if (list.testid && NOT_FETCHED.has(list.testid)) continue;
    const rows = stateRows(list);
    const name = `${list.file}:${list.line} → ${list.testid ?? `an unnamed ${list.tag}`}`;
    if (rows.length === 0) {
      // Only a list that waits on a fetch can be blank WHILE IT WAITS.
      if (awaitsAFetch(list.body)) {
        bad.push(`${name}: fetched rows and no state-empty/state-message row anywhere — blank until they land, and blank forever if there are none`);
      }
      continue;
    }
    if (!rows.some((r) => rendersWhileLoading(r.guard))) {
      bad.push(`${name}: every explanation waits for the fetch (${rows.map((r) => `\`${r.guard.trim().slice(0, 60)}\``).join(", ")}) — blank until it lands`);
    }
  }
  return bad;
}

const SELF_TEST_FIXTURES = [
  {
    name: "an empty row suppressed until loading finishes is caught",
    src: `<ul className="card-list" data-testid="x">{rows.map(r => <li/>)}{!q.loading && rows.length === 0 && <li className="state-empty">Nothing yet.</li>}</ul>`,
    expect: 1,
  },
  {
    name: "an empty row gated on the fetched value being present is caught",
    src: `<ul className="card-list" data-testid="y">{(p?.holdings ?? []).map(h => <li/>)}{p && p.holdings.length === 0 && <li className="state-empty">Nothing.</li>}</ul>`,
    expect: 1,
  },
  { name: "fetched rows with no state row at all is caught", src: `<ul className="card-list" data-testid="z">{(a.data?.b ?? []).map(x => <li/>)}</ul>`, expect: 1 },
  { name: "a list mapping an array already in hand is not this scan's business", src: `<ul className="card-list" data-testid="z2">{rows.map(x => <li/>)}</ul>`, expect: 0 },
  {
    name: "a list that also carries a loading row passes",
    src: `<ul className="card-list" data-testid="ok">{rows.map(r => <li/>)}{q.loading && <li className="state-empty">Reading the record…</li>}{!q.loading && rows.length === 0 && <li className="state-empty">Nothing yet.</li>}</ul>`,
    expect: 0,
  },
  { name: "an unconditional state row passes", src: `<ul className="card-list" data-testid="ok2"><li className="state-empty">Nothing ever goes here.</li></ul>`, expect: 0 },
  {
    name: "an explanation standing BESIDE the list counts, as the sweep says it does",
    src: `<div><ul className="card-list" data-testid="ok3">{rows.map(r => <li/>)}</ul><p className="state-message">Runs appear here as they happen.</p></div>`,
    expect: 0,
  },
  {
    name: "a state row belonging to one ROW is not the list's explanation",
    src: `<ul className="card-list" data-testid="w">{(c.data?.p ?? []).map(p => <li>{p.h ? <span/> : <p className="state-empty">no health check recorded</p>}</li>)}</ul>`,
    expect: 1,
  },
  {
    name: "a row guarded on the fetched value having content does not survive the wait",
    src: `<ul className="card-list" data-testid="v">{(q.data?.r ?? []).map(x => <li/>)}</ul>{(q.data?.r ?? []).length > 0 && (<p className="state-empty">Open one above.</p>)}`,
    expect: 1,
  },
  {
    name: "a row guarded on the value NOT being there yet does survive the wait",
    src: `<ul className="card-list" data-testid="u">{(q.data?.r ?? []).map(x => <li/>)}{!q.data && <li className="state-empty">Reading the record…</li>}</ul>`,
    expect: 0,
  },
  {
    name: "an empty row that simply reads `length === 0` shows early and is NOT a defect",
    src: `<ul className="card-list" data-testid="t">{(q.data?.r ?? []).map(x => <li/>)}{(q.data?.r ?? []).length === 0 && <li className="state-empty">Nothing yet.</li>}</ul>`,
    expect: 0,
  },
  { name: "a list that is not a card-list is not this scan's business", src: `<ul className="plain"><li>x</li></ul>`, expect: 0 },
];

function selfTest() {
  let failed = 0;
  for (const f of SELF_TEST_FIXTURES) {
    const got = violations(cardLists(f.src, "self-test.tsx")).length;
    const ok = got === f.expect;
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"}  ${f.name} (expected ${f.expect}, got ${got})`);
  }
  if (failed > 0) {
    console.error(`\nself-test: ${failed} of ${SELF_TEST_FIXTURES.length} fixtures wrong — this validator cannot be trusted.`);
    process.exit(1);
  }
  console.log(`\nself-test: ${SELF_TEST_FIXTURES.length}/${SELF_TEST_FIXTURES.length} — it still catches what it exists to catch.`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const files = walk(ROOT);
  const lists = files.flatMap((f) => cardLists(readFileSync(f, "utf8"), f));

  /*
   * RULE 0. A scan that examined nothing must not report success. If the client is refactored so
   * `card-list` is no longer how a list is written, this has to go red and be rewritten — not
   * quietly pass on an empty loop forever.
   */
  if (lists.length < 100) {
    console.error(`lists-speak-while-loading: only ${lists.length} card-lists found under ${ROOT}/ — expected at least 100.`);
    console.error("Either the scan no longer matches how lists are written, or the client shrank enormously. Both need a human.");
    process.exit(1);
  }

  const bad = violations(lists);
  if (bad.length > 0) {
    console.error(`These lists are a bare blank while their data is in flight (${bad.length} of ${lists.length}):\n`);
    for (const b of bad) console.error(`  ${b}`);
    console.error("\nA reader cannot tell a blank from broken. Give the list a row that renders WHILE loading:");
    console.error('  {q.loading && <li className="state-empty">Reading the record…</li>}');
    process.exit(1);
  }
  console.log(`lists-speak-while-loading: ${lists.length} card-lists across ${files.length} files — every one says something while it loads.`);
}

main();
