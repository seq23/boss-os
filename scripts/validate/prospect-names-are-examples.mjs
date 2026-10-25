#!/usr/bin/env node
/**
 * THE PROSPECT EMAIL'S STANDING RULES HOLD FOR EVERY TEMPLATE (owner, 25 Oct 2026).
 *
 * "I don't like that you make it seem like those are the only 3 companies I'm working on." Every
 * template Monique drafts from (`PROSPECT_VARIANTS`), first email and follow-up, in every names
 * phrasing, must read the featured names as examples ("including …, among others") and never give
 * a cold email a fake "Re:" subject — along with every other tone rule (`prospectProblems`).
 * `--self-test` proves the check catches the wording it replaced.
 */
import { PROSPECT_VARIANTS, PROSPECT_TEMPLATE_RULES, renderProspect, prospectProblems, featuredNamesProblems } from "../../src/shared/boss/lp/plan.mjs";

const NAMES = [{ name: "Company A" }, { name: "Company B" }, { name: "Company C" }];

export function check() {
  const bad = [];
  if (PROSPECT_VARIANTS.length < 2) bad.push("fewer than two templates: \"try again\" would have nothing different to offer");
  for (const [i, t] of PROSPECT_VARIANTS.entries()) for (const touch of [1, 2]) for (const variant of [0, 1, 2]) {
    const r = renderProspect(t, { first: "Alex", names: NAMES, touch, variant });
    for (const p of prospectProblems(touch === 1 ? r : { subject: "", body: r.body }, NAMES)) bad.push(`template ${i + 1}, email ${touch}, phrasing ${variant + 1}: ${p}`);
  }
  for (const key of ["names_are_examples", "no_fake_reply_subject"]) if (!PROSPECT_TEMPLATE_RULES.some((r) => r.key === key)) bad.push(`her rule ${key} is not on record`);
  return bad;
}

function selfTest() {
  let failed = 0;
  const expect = (name, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) failed++; };
  expect("the shipped templates pass", check().length === 0);
  expect("a closed list of names is caught", featuredNamesProblems({ subject: "Hello", body: "Names coming across my desk at the moment are: Company A, Company B, Company C." }, NAMES).length > 0);
  expect("a cold \"Re:\" subject is caught", featuredNamesProblems({ subject: "Re: Up to $1B secondary inquiry", body: "Hi" }, NAMES).length > 0);
  expect("a subject listing every name is caught", featuredNamesProblems({ subject: "Secondaries: Company A, Company B, Company C", body: "Hi" }, NAMES).length > 0);
  expect("names as examples pass", featuredNamesProblems({ subject: "Secondaries: Company A and others", body: "Some of the names include Company A, Company B and Company C, among others." }, NAMES).length === 0);
  if (failed) { console.error(`PROSPECT NAMES SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("PROSPECT NAMES SELF-TEST PASSED");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
    const bad = check();
    if (bad.length) { console.error("PROSPECT NAMES CHECK FAILED:"); for (const b of bad) console.error(`  ✗ ${b}`); process.exit(1); }
    console.log(`PROSPECT NAMES CHECK PASSED: ${PROSPECT_VARIANTS.length} templates × 2 emails × 3 phrasings read the names as examples, with no fake "Re:".`);
  }
}
