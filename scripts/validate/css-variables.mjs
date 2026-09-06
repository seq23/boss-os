#!/usr/bin/env node
/**
 * Every `var(--token)` must resolve to a token its own app actually defines.
 *
 * WHY THIS EXISTS. Recolouring Boss OS renamed five tokens in its stylesheet — `--deck` to
 * `--ground`, `--paper` to `--ink`, `--brass` to `--gold` and two more. The stylesheet was
 * consistent afterwards and every existing scan passed. But 27 `var(--brass)` and `var(--paper)`
 * references lived in INLINE STYLES inside .tsx files, and those were not renamed.
 *
 * An unresolved custom property does not error and does not warn. It falls back to nothing: the
 * declaration is dropped, so the element inherits. A field loses its background and its text
 * colour and becomes an invisible input on a cream page — rendering, technically working, and
 * unusable. That is the same symptom class as a misspelt className, and it deserves the same
 * treatment: a build failure instead of a mystery.
 *
 * SCOPE. Both stylesheets, and every .tsx that can carry an inline style, each checked against the
 * tokens of the app that owns it. Platform-defined functions that look like custom properties are
 * not custom properties, and are not checked.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/client";

/** Longest prefix wins, so a third surface is one line rather than a wider allowlist. */
const APPS = [
  { name: "boss", prefix: "src/client/boss/", css: "src/client/boss/styles.css" },
  { name: "chassis", prefix: "src/client/", css: "src/client/styles.css" },
];

function appFor(file) {
  return APPS.find((a) => file.startsWith(a.prefix)) ?? null;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts") || p.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Tokens a stylesheet declares: `--name:` at the start of a declaration. */
export function definedTokens(css) {
  const out = new Set();
  for (const m of css.matchAll(/(^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) out.add(m[2]);
  return out;
}

/** Tokens a source file consumes through `var(--name)`. */
export function usedTokens(source) {
  const out = new Set();
  for (const m of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) out.add(m[1]);
  return out;
}

/**
 * A `var()` may name a fallback: `var(--maybe, 12px)`. The fallback makes the reference safe, so
 * only a bare reference is a defect.
 */
export function usedWithoutFallback(source) {
  const out = new Set();
  for (const m of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) if (m[2] === ")") out.add(m[1]);
  return out;
}

export function scanApp(cssText, files, read = (f) => readFileSync(f, "utf8")) {
  const defined = definedTokens(cssText);
  const problems = [];
  for (const f of files) {
    for (const token of usedWithoutFallback(read(f))) {
      if (!defined.has(token)) problems.push(`${f}: var(${token}) resolves to nothing`);
    }
  }
  return problems;
}

function selfTest() {
  const cases = [
    ["defined token passes", ".a { color: var(--ink); }", "--ink: #000;", 0],
    ["undefined token fails", ".a { color: var(--gone); }", "--ink: #000;", 1],
    ["fallback makes it safe", ".a { color: var(--gone, red); }", "--ink: #000;", 0],
    ["inline style in tsx is scanned", 'style={{ color: "var(--gone)" }}', "--ink: #000;", 1],
    ["whitespace inside var() is handled", ".a { color: var( --gone ); }", "--ink: #000;", 1],
    ["token defined mid-block is found", ".a { color: var(--x); }", ".r { --x: 1px; }", 0],
  ];
  let failed = 0;
  for (const [name, source, css, expected] of cases) {
    const got = scanApp(css, ["f"], () => source).length;
    if (got !== expected) {
      console.error(`SELF-TEST FAILED — ${name}: expected ${expected} problem(s), got ${got}`);
      failed++;
    }
  }
  if (failed) process.exit(1);
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

const files = walk(ROOT);
if (files.length === 0) {
  console.error(`CSS VARIABLE SCAN FAILED — examined 0 files under ${ROOT}.`);
  console.error("A scan that checks nothing is not a passing scan.");
  process.exit(1);
}

const problems = [];
for (const app of APPS) {
  const owned = files.filter((f) => appFor(f) === app);
  if (owned.length === 0) {
    problems.push(`${app.prefix}: 0 files resolved to ${app.css} — a surface that checks nothing is not a pass`);
    continue;
  }
  problems.push(...scanApp(readFileSync(app.css, "utf8"), owned));
}

if (problems.length > 0) {
  console.error("CSS VARIABLE SCAN FAILED — these resolve to nothing and are silently dropped:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nAn unresolved custom property does not error and does not warn: the declaration is");
  console.error("dropped and the element inherits. Rename the reference, define the token, or give");
  console.error("the var() a fallback.");
  process.exit(1);
}
console.log(`CSS VARIABLE SCAN PASSED: every var(--token) in ${ROOT} resolves in the stylesheet its app owns.`);
selfTest();
