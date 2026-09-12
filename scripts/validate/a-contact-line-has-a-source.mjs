#!/usr/bin/env node
/**
 * NO WAY TO REACH SOMEBODY IS PRINTED WITHOUT A FILE AND A ROW BEHIND IT.
 *
 * ─── What the hunt was actually producing, counted ─────────────────────────
 *
 * 12 September 2026, against her real files:
 *
 *   - 23 OpenAI sell-side rows in her ledger. ZERO carry a principal email. One names a principal
 *     and the name is "U.S. fund".
 *   - 2,142 ledger rows in total; 304 carry any principal email.
 *   - The EDGAR half printed a filer name, a dollar mark, a capacity verdict and a filing URL, and
 *     no address of any kind.
 *
 * A list of institutions with no way to speak to any of them. Meanwhile
 * `~/.boss-os/sourcing/CONTACTS.json` held 553 correspondents, every one with an address, unused.
 *
 * ─── HER STANDING RULE, WHICH IS WHAT THIS FILE ENFORCES ───────────────────
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * Adding addresses is easy and adding WRONG addresses is easier still — a constructed
 * `firstname@fund.com`, a domain inferred from a fund's name, a "likely" contact. Every one of those
 * reads exactly like a real one on the page, and she would find out by sending it.
 *
 * So the rule is absolute and it is checked by BEHAVIOUR: every line `reachFor` returns must carry
 * `source.file` and `source.row`, and that row must actually exist in that file. A line that cannot
 * name where it came from is not rendered at all, and the honest sentence goes in its place:
 *
 *     no address for this holder — the filing is the only handle
 *
 * ─── THE FAILURE THIS ALREADY CAUGHT, KEPT AS A CASE ───────────────────────
 *
 * The first draft matched a filer to a domain with `domain.includes(token)`, and connected "Forge
 * Global Holdings" to a real person at `launchusaforge.co` — an unrelated company that happens to
 * contain the letters "forge". A real address, attributed to a party she has never dealt with. That
 * is the exact shape of the trash, produced by a guard one character too loose, and it is now a
 * permanent case below.
 *
 * RULE 0: examining zero lines is a FAILURE. A corpus that produces no contact lines at all would
 * pass every rule here while proving nothing.
 *
 *   node scripts/validate/a-contact-line-has-a-source.mjs
 *   node scripts/validate/a-contact-line-has-a-source.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reachFor, loadContacts, domainBelongsTo, filerTokens, FILER_CAP, CONTACTS_PATH } from "../../scripts/ops/lib/reach.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HUNT = "scripts/ops/buyer-hunt.mjs";

/**
 * A FIXTURE, not her real files.
 *
 * This has to be able to run anywhere, and a validator that only works on one laptop is a validator
 * that stops running. Her real files ARE checked as well, further down, when they happen to exist.
 */
const CONTACTS = {
  file: "fixture/CONTACTS.json",
  contacts: [
    { email: "andrea@cuatromarkets.com", name: "Andrea Lamari", sent: 51, received: 93, days_since_last: 16 },
    { email: "dgraf@cuatromarkets.com", name: "Dylan Graf", sent: 4, received: 9, days_since_last: 40 },
    // THE FORGE CASE. A real correspondent at a company that merely CONTAINS the letters "forge".
    { email: "teresa.compton@launchusaforge.co", name: "Teresa Compton", sent: 2, received: 3, days_since_last: 90 },
    // Her own firm, which is never an introduction.
    { email: "msutic@rainmakersecurities.com", name: "Marco Sutic", sent: 20, received: 40, days_since_last: 1 },
  ],
};

const ROWS = {
  withBroker: { principal: "unnamed seller", principal_email: null, intermediated_by: "andrea@cuatromarkets.com", source_message: "19f623c931af9348" },
  withPrincipal: { principal: "Patti Pan", principal_email: "pantian@solaris-venture.com", intermediated_by: null, source_message: "1a0011112222" },
  bare: { principal: "U.S. fund", principal_email: null, intermediated_by: null, source_message: "19ecd92ba5a2f1d9" },
};

/** `[what it is, input, how many lines, a predicate on the text, or null]`. */
const CASES = [
  ["a ledger row with a broker gives the broker, LABELLED",
    { rows: [ROWS.withBroker], contacts: CONTACTS }, 1, (t) => /THE BROKER/.test(t) && /andrea@cuatromarkets\.com/.test(t)],
  ["a ledger row with a principal gives the principal",
    { rows: [ROWS.withPrincipal], contacts: CONTACTS }, 1, (t) => /pantian@solaris-venture\.com/.test(t) && /the principal/.test(t)],
  ["a ledger row with neither gives NOTHING, and says what the handle is",
    { rows: [ROWS.bare], contacts: CONTACTS, handle: "the message in your archive" }, 0, null],
  ["a filer she actually corresponds with resolves",
    { filer: "Cuatro Markets LLC", contacts: CONTACTS }, 2, (t) => /cuatromarkets\.com/.test(t)],
  ["THE FORGE CASE: a substring in an unrelated domain is not a match",
    { filer: "Forge Global Holdings", contacts: CONTACTS }, 0, null],
  ["a filer she has never dealt with resolves to nothing",
    { filer: "T. Rowe Price Blue Chip Growth Fund, Inc.", contacts: CONTACTS }, 0, null],
  ["her own broker-dealer is not an introduction",
    { filer: "Rainmaker Securities LLC", contacts: CONTACTS }, 0, null],
  ["no contacts file at all is a fact, not an invention",
    { filer: "Cuatro Markets LLC", contacts: null }, 0, null],
  ["no input at all produces no lines",
    {}, 0, null],
];

/**
 * Rule: every line has a file and a row, and the row is really in that file.
 *
 * The SECOND half is what makes this more than a shape check. A line could carry
 * `{ file: "CONTACTS.json", row: "someone@invented.com" }` and satisfy a naive guard perfectly.
 */
export function everyLineHasASource(reach = reachFor) {
  const bad = [];
  let examined = 0;
  const known = new Set(CONTACTS.contacts.map((c) => c.email));
  const ledgerRows = new Set(Object.values(ROWS).map((r) => r.source_message));

  for (const [label, input, expectedCount, predicate] of CASES) {
    const out = reach(input);
    const lines = out?.lines ?? [];
    examined += lines.length;

    if (lines.length !== expectedCount) {
      bad.push(`${label}: produced ${lines.length} line(s), expected ${expectedCount}${lines.length ? ` — ${lines.map((l) => l.text.slice(0, 70)).join(" | ")}` : ""}.`);
    }
    if (lines.length === 0) {
      if (!out?.none || !/no address for this holder/.test(out.none)) {
        bad.push(`${label}: produced nothing AND said nothing. Silence and "found nobody" are different facts.`);
      }
      continue;
    }
    for (const l of lines) {
      if (!l.source?.file || !l.source?.row) {
        bad.push(`${label}: "${l.text.slice(0, 60)}" has no file and row behind it. That is an address she cannot check, which is how a wrong one gets sent.`);
        continue;
      }
      const inFile = l.source.file.includes("CONTACTS") ? known.has(l.source.row) : ledgerRows.has(l.source.row);
      if (!inFile) {
        bad.push(`${label}: cites ${l.source.file} row "${l.source.row}", which is not in that file. A citation nobody can follow is not a citation.`);
      }
      // THE ADDRESS ITSELF must be one that exists somewhere, never assembled.
      const address = /<([^>]+@[^>]+)>|(\S+@\S+)/.exec(l.text);
      const email = (address?.[1] ?? address?.[2] ?? "").replace(/[,;)]+$/, "");
      if (email && !known.has(email) && !Object.values(ROWS).some((r) => r.principal_email === email || r.intermediated_by === email)) {
        bad.push(`${label}: printed "${email}", which appears in neither the contacts file nor the ledger rows. That address was SYNTHESISED.`);
      }
    }
    if (predicate && !lines.some((l) => predicate(l.text))) {
      bad.push(`${label}: no line said what it was supposed to say — e.g. a broker line that does not name itself as the broker.`);
    }
  }

  /* RULE 0. Zero lines across the whole corpus passes every rule above and proves nothing. */
  if (examined === 0) {
    bad.push("not one contact line was produced across the whole corpus, so nothing about sourcing was actually examined.");
  }
  return bad;
}

/** Rule: the domain matcher lines up with the registrable label, not with a substring. */
export function theMatcherIsNotASubstring(match = domainBelongsTo) {
  const bad = [];
  const cases = [
    ["rainmakersecurities.com", "rainmaker", true],
    // The run "t rowe price" joins to exactly this label — which is why tokens are word RUNS.
    ["troweprice.com", "troweprice", true],
    ["troweprice.com", "roweprice", false],
    ["cuatromarkets.com", "cuatromarkets", true],
    // THE FORGE CASE, at the level it actually failed.
    ["launchusaforge.co", "forge", false],
    ["somethingcapital.com", "ital", false],
    ["mail.google.com", "google", true],
    ["notrelated.com", "related", false],
  ];
  for (const [domain, token, want] of cases) {
    if (match(domain, token) !== want) {
      bad.push(`${domain} vs "${token}": expected ${want ? "a match" : "NO match"}, got the opposite.`);
    }
  }
  if (filerTokens("Blue Chip Growth Fund Trust Capital").length > 0) {
    bad.push("a filer whose name is nothing but common nouns still produced match tokens, which would introduce her to strangers who share a word.");
  }
  if (!filerTokens("T. Rowe Price Blue Chip Growth Fund, Inc.").includes("troweprice")) {
    bad.push("the word RUNS are not being joined, so a firm whose domain is its first three words cannot be recognised at all.");
  }
  if (FILER_CAP > 5) bad.push(`${FILER_CAP} correspondents per holder is a dump rather than an introduction.`);
  return bad;
}

/** Rule: the renderer refuses a line that cannot show its source. */
export function theRendererRefusesASourcelessLine(source) {
  if (source === null) return [`${HUNT} could not be read, so the rendering rule is unverified.`];
  const bad = [];
  if (!/reachFor\(/.test(source)) {
    bad.push(`${HUNT} never calls reachFor, so the output has no way to reach anybody in it — which is the state this fixes.`);
  }
  if (!/l\.source\?\.file && l\.source\?\.row/.test(source)) {
    bad.push(
      `${HUNT} renders contact lines without filtering on \`source.file && source.row\`. A line with `
      + "no provenance would print, and an invented address is indistinguishable from a real one.",
    );
  }
  if (!/reach\.none/.test(source)) {
    bad.push(`${HUNT} has no branch for "nobody resolved", so an empty block renders as silence rather than as an answer.`);
  }
  return bad;
}

/**
 * AND HER REAL FILE, WHEN IT IS THERE.
 *
 * Skipped where it is not, because this must run on any machine — but never silently: a skip says so.
 */
export function herRealContactsAreOnlyEverQuoted() {
  const real = loadContacts();
  if (!real) return { skipped: `${CONTACTS_PATH} is not on this machine, so only the fixture was examined.`, bad: [] };
  const bad = [];
  const known = new Set(real.contacts.map((c) => c.email.toLowerCase()));
  if (known.size === 0) {
    return { skipped: null, bad: ["her contacts file is readable and holds no addresses at all."] };
  }
  for (const filer of ["Cuatro Capital", "Rainmaker Securities LLC", "Forge Global Holdings", "T. Rowe Price Blue Chip Growth Fund, Inc."]) {
    for (const l of reachFor({ filer, contacts: real }).lines) {
      const email = (/<([^>]+@[^>]+)>/.exec(l.text)?.[1] ?? "").toLowerCase();
      if (!email || !known.has(email)) {
        bad.push(`"${filer}" produced "${l.text.slice(0, 70)}", whose address is not a row in her own contacts file.`);
      }
    }
  }
  return { skipped: null, bad, examined: known.size };
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const huntPath = join(ROOT, HUNT);
const huntSource = existsSync(huntPath) ? readFileSync(huntPath, "utf8") : null;

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "clean" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  expect("every line the real function produces has a file and a row", everyLineHasASource(), false);
  expect("the real matcher is not a substring match", theMatcherIsNotASubstring(), false);
  expect("the real renderer refuses a sourceless line", theRendererRefusesASourcelessLine(huntSource), false);
  expect("her real contacts are only ever quoted", herRealContactsAreOnlyEverQuoted().bad, false);

  /*
   * ─── THE NEGATIVE PROOF ───────────────────────────────────────────────────
   * Every one of these is a way to put a plausible, wrong address in front of her.
   */
  expect("a function that constructs an address from the filer's name", everyLineHasASource((i) => ({
    lines: i.filer ? [{ kind: "filer", text: `ir@${String(i.filer).toLowerCase().replace(/\W/g, "")}.com`, source: { file: "fixture/CONTACTS.json", row: "ir@invented.com" } }] : [],
    none: "no address for this holder — the filing is the only handle",
  })), true);
  expect("a function that returns lines with no provenance", everyLineHasASource((i) => ({
    lines: (i.rows ?? []).filter((r) => r.intermediated_by).map((r) => ({ kind: "broker", text: r.intermediated_by, source: null })),
    none: "no address for this holder — the filing is the only handle",
  })), true);
  expect("a function that stops labelling the broker as the broker", everyLineHasASource((i) => ({
    ...reachFor(i),
    lines: reachFor(i).lines.map((l) => ({ ...l, text: l.text.replace(/ — THE BROKER on this row, not the principal/, " — the principal") })),
  })), true);
  expect("a function that says nothing when it finds nothing", everyLineHasASource((i) => ({ ...reachFor(i), none: "" })), true);
  expect("a function that never produces a line at all", everyLineHasASource(() => ({ lines: [], none: "no address for this holder — the filing is the only handle" })), true);
  expect("THE SUBSTRING MATCHER that connected Forge Global to launchusaforge.co",
    theMatcherIsNotASubstring((d, t) => String(d).includes(String(t))), true);
  expect("a renderer that prints a line without checking its source", theRendererRefusesASourcelessLine(
    huntSource?.replace("const printable = reach.lines.filter((l) => l.source?.file && l.source?.row);", "const printable = reach.lines;") ?? null,
  ), true);
  expect("a renderer with no empty-handed branch", theRendererRefusesASourcelessLine(
    huntSource?.replace(/reach\.none/g, '""') ?? null,
  ), true);
  expect("a hunt that never asks how to reach anybody", theRendererRefusesASourcelessLine(
    huntSource?.replace(/reachFor\(/g, "noop(") ?? null,
  ), true);
  expect("a hunt that could not be read", theRendererRefusesASourcelessLine(null), true);

  if (failed) { console.error(`CONTACT SOURCE SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("CONTACT SOURCE SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

/* RULE 0, before anything runs. */
if (CASES.length === 0) {
  console.error("CONTACT SOURCE SCAN FAILED — there are no cases, so nothing was proven.");
  process.exit(2);
}

const real = herRealContactsAreOnlyEverQuoted();
const problems = [
  ...everyLineHasASource(),
  ...theMatcherIsNotASubstring(),
  ...theRendererRefusesASourcelessLine(huntSource),
  ...real.bad,
];

if (problems.length) {
  console.error("CONTACT SOURCE SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error('  "if she comes up empty handed its fine. better than giving me trash."');
  process.exit(2);
}

console.log(
  `CONTACT SOURCE OK — ${CASES.length} case(s); every printed way to reach somebody carries the file `
  + "and the row it came out of, the broker is never presented as the principal, and a holder nobody "
  + "in her network touches renders as the honest sentence.",
);
if (real.skipped) console.log(`  note: ${real.skipped}`);
else console.log(`  her real contacts file was checked too: ${real.examined} address(es), none of them invented.`);
