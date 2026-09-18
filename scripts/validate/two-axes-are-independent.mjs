#!/usr/bin/env node
/**
 * TWO AXES, AND NEITHER IS READ OFF THE OTHER.
 *
 * ─── What this guards against ───────────────────────────────────────────────
 *
 * A work card answers two questions that look alike and are not:
 *
 *     WHO MAY RECEIVE THE OUTPUT      internal / external
 *     WHICH MODELS MAY SEE THE INPUT  public model approved / private model only
 *
 * In `west-peek-os` they were one value, and "internal" — which only ever meant the recipient is a
 * partner — was read as "too sensitive to train on". Hiring searches, event kits, room packets and
 * workshop material were barred from every free lane and every run landed on the most expensive
 * model on the account. The owner: "ITS NOT DEAL TERMS OR LP INFORMATION SO IT DOESNT MATTER IF
 * ITS USING THIS DATA TO TRAIN. WHO CARES ABOUT HIRING SEARCH AND EVENT KITS AND ROOM KITS. THEY
 * ARE NOT PRIVATE INFO."
 *
 * The collapse is easy to reintroduce and it is invisible when it happens: a card labelled
 * `internal` quietly routing to fewer models looks exactly like a card that was correctly judged
 * private. Nothing goes red. The bill, or in this repo the lost fallback tier, is the only signal.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * NOT BY GREPPING FOR A WORD, AND NOT BY READING A COMMENT. The real `classifyModelAccess` and
 * `classifyAudience` are compiled out of the repo and DRIVEN OVER A MATRIX. Independence is a
 * property of behaviour, so it is tested as one:
 *
 *   1. AXIS INDEPENDENCE, BY EXHAUSTION. Every audience fixture is crossed with every model-access
 *      fixture. `classifyModelAccess` must return the same answer for a given access fixture
 *      whichever audience text surrounds it, and `classifyAudience` must return the same answer
 *      whichever access fixture surrounds it. If either moves, one axis is being read off the other.
 *   2. ALL FOUR CORNERS ARE REACHABLE. internal+public, internal+private, external+public,
 *      external+private. An axis pair that can only produce two of its four combinations is one
 *      axis wearing two names, which is the defect with a rename on top.
 *   3. THE ROUTER CANNOT SEE THE AUDIENCE. `PolicyContext` in `router/policy.ts` must carry no
 *      audience field, and `router/modelAccess.ts` must not mention internal or external at all —
 *      checked as source text, because the cheapest way to reintroduce this is to add one field.
 *   4. ORDINARY WORK ROUTES FREE. The owner's own list — hiring searches, event kits, room packets,
 *      workshop material, market research, tool scouting, backlink prospecting, site audits, Kindle
 *      work, community material, Productions — must every one come back `public_model_approved`
 *      from BOTH the intake classifier and the router's content scan.
 *   5. LP AND DEAL MATERIAL STILL CANNOT. The fund's private side must come back
 *      `private_model_only` from the router's content scan, including the material that names no
 *      party this database knows.
 *
 * RULE 0: zero fixtures in any of the four groups is a FAILURE. "Every axis is independent" is
 * trivially true of a matrix with no rows, and a green tick over an empty loop is the defect class
 * this repository names most often.
 *
 *   node scripts/validate/two-axes-are-independent.mjs
 *   node scripts/validate/two-axes-are-independent.mjs --self-test
 */

import { readFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLASSIFY = "src/worker/boss/intake/classify.ts";
const MODEL_ACCESS = "src/worker/boss/router/modelAccess.ts";
const POLICY = "src/worker/boss/router/policy.ts";

/** Compile a module out of the repo and import it, so this examines what ships. */
async function load(relPath, names) {
  const out = join(mkdtempSync(join(tmpdir(), "two-axes-")), "m.mjs");
  await build({
    entryPoints: [join(ROOT, relPath)],
    bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent",
  });
  const mod = await import(`file://${out}`);
  for (const n of names) {
    if (typeof mod[n] !== "function" && !Array.isArray(mod[n])) {
      throw new Error(`${relPath} exports no ${n}, so this guard cannot check anything.`);
    }
  }
  return mod;
}

// ─── The fixtures ────────────────────────────────────────────────────────────

/**
 * TEXT THAT MOVES THE AUDIENCE AXIS AND MUST MOVE NOTHING ELSE.
 *
 * Each pair is the same job for two different readers. If the model-access answer differs between
 * the two halves of any pair, the recipient is deciding where the work may run.
 */
export const AUDIENCE_FIXTURES = [
  { audience: "internal", text: "Write this up for Sequoia." },
  { audience: "internal", text: "A note for Scooter before Monday." },
  { audience: "external", text: "Send the invite to every guest and founder on the list." },
  { audience: "external", text: "Publish the note and share with the community members." },
];

/**
 * TEXT THAT MOVES THE MODEL-ACCESS AXIS AND MUST MOVE NOTHING ELSE.
 *
 * The private half is deliberately made of material about parties this database does not hold, so
 * the lexicon cannot be what catches it — the patterns have to.
 */
export const ACCESS_FIXTURES = [
  { access: "public_model_approved", text: "Draft the run of show for the October founder dinner." },
  { access: "public_model_approved", text: "Compare three transcription tools on price and accuracy." },
  { access: "private_model_only", text: "The capital call goes out Friday and the drawdown notice follows." },
  { access: "private_model_only", text: "Their side letter asks for MFN against the limited partnership agreement." },
];

/**
 * THE OWNER'S OWN LIST OF WORK THAT IS NOT PRIVATE, verbatim from her ruling plus the categories
 * this repo actually runs. Every one of these must reach a free reasoning lane.
 */
export const ORDINARY_WORK = [
  "Draft a hiring search for a part-time ops associate. Compensation band $70k-$90k, remote.",
  "Build the event kit for the October founder dinner: run of show, room layout, name cards, and the allocation of seats.",
  "Assemble the room packet for the workshop: agenda, pre-read, and who owns each session.",
  "Write the workshop exercise on customer discovery.",
  "Research the UK seed-stage market and compare three published surveys of founder sentiment.",
  "Scout transcription tools. Compare Otter, Fireflies and Granola on price and accuracy.",
  "Find fifteen backlink prospects for industryguides and rank them by domain rating.",
  "Audit the site for broken internal links, missing canonicals and heading-rank faults.",
  "Set the Kindle price for the Gift Letter book and draft the A+ content block.",
  "Draft the monthly community note and name next month's rota.",
  "Draft the shot list for the Spry Studios pilot and specify casting for each speaking role.",
  "Summarise this morning's public market headlines and say which matter to an allocator.",
];

/** The fund's private side. Every one must stay off a route whose terms permit training. */
export const PRIVATE_WORK = [
  "Draft the memo to our LP on the capital call. The drawdown notice goes out Friday.",
  "The term sheet has a 2% carried interest and an 8% preferred return with a full clawback.",
  "Their side letter asks for MFN and a seat. Compare it against the limited partnership agreement.",
  "Pre-money is $12m, post-money $15m, fully diluted. Send the cap table.",
  "Open the data room and file the diligence request list.",
  "Her commitment is $5m, payable in two tranches.",
];

const LEXICON = { names: [], established: true, note: "" };
const msg = (text) => [{ role: "user", content: text }];

// ─── The checks ──────────────────────────────────────────────────────────────

/** 1 · Neither axis moves when only the other axis's signals change. */
export function axesAreIndependent(classifyModelAccess, classifyAudience) {
  const bad = [];
  for (const a of ACCESS_FIXTURES) {
    const seen = new Map();
    for (const aud of AUDIENCE_FIXTURES) {
      const got = classifyModelAccess({ text: `${aud.text} ${a.text}`, intakeKind: "drafting" }).access;
      seen.set(aud.text, got);
    }
    const distinct = new Set(seen.values());
    if (distinct.size !== 1) {
      bad.push(
        `model access for "${a.text.slice(0, 48)}…" changed with the audience wording ` +
        `(${[...seen].map(([k, v]) => `${k.slice(0, 22)}…→${v}`).join(", ")}). ` +
        `Who reads the output must not decide which models may see the input.`,
      );
    } else if ([...distinct][0] !== a.access) {
      bad.push(`model access for "${a.text.slice(0, 48)}…" is ${[...distinct][0]}, expected ${a.access}.`);
    }
  }
  for (const aud of AUDIENCE_FIXTURES) {
    const seen = new Map();
    for (const a of ACCESS_FIXTURES) {
      seen.set(a.text, classifyAudience({ text: `${aud.text} ${a.text}` }).audience);
    }
    const distinct = new Set(seen.values());
    if (distinct.size !== 1) {
      bad.push(
        `audience for "${aud.text.slice(0, 48)}…" changed with the deal wording ` +
        `(${[...seen].map(([k, v]) => `${k.slice(0, 22)}…→${v}`).join(", ")}). ` +
        `How private the material is must not decide who may receive it.`,
      );
    } else if ([...distinct][0] !== aud.audience) {
      bad.push(`audience for "${aud.text.slice(0, 48)}…" is ${[...distinct][0]}, expected ${aud.audience}.`);
    }
  }
  return bad;
}

/** 2 · All four corners are reachable, including both off-diagonals. */
export function allFourCornersAreReachable(classifyModelAccess, classifyAudience) {
  const corners = new Set();
  for (const aud of AUDIENCE_FIXTURES) {
    for (const a of ACCESS_FIXTURES) {
      const text = `${aud.text} ${a.text}`;
      const access = classifyModelAccess({ text, intakeKind: "drafting" }).access;
      const audience = classifyAudience({ text }).audience;
      corners.add(`${audience}+${access}`);
    }
  }
  const want = [
    "internal+public_model_approved", "internal+private_model_only",
    "external+public_model_approved", "external+private_model_only",
  ];
  const missing = want.filter((w) => !corners.has(w));
  return missing.length
    ? [`unreachable corner(s): ${missing.join(", ")}. Two axes that cannot produce all four ` +
       `combinations are one axis with two names.`]
    : [];
}

/** 3 · The routing side cannot see the audience, as source text. */
export function theRouterCannotSeeTheAudience() {
  const bad = [];
  const policy = readFileSync(join(ROOT, POLICY), "utf8");
  const ctx = policy.slice(policy.indexOf("export interface PolicyContext"), policy.indexOf("export type RouteStage"));
  if (/^\s*audience\??:/m.test(ctx)) {
    bad.push(`${POLICY}: PolicyContext carries an \`audience\` field. The router must not be able to read it.`);
  }
  const access = readFileSync(join(ROOT, MODEL_ACCESS), "utf8");
  // Comments explain the separation and must stay; only CODE lines are checked.
  const code = access
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  for (const word of ["audience", '"internal"', '"external"']) {
    if (code.includes(word)) {
      bad.push(`${MODEL_ACCESS}: the code mentions ${word}. Which models may see the work must not depend on who reads it.`);
    }
  }
  return bad;
}

/** 4 · Ordinary work routes free, from BOTH the intake label and the router's content scan. */
export function ordinaryWorkRoutesFree(classifyModelAccess, scanForModelAccess) {
  const bad = [];
  for (const text of ORDINARY_WORK) {
    const labelled = classifyModelAccess({ text, intakeKind: "drafting" }).access;
    if (labelled !== "public_model_approved") {
      bad.push(`intake labels "${text.slice(0, 56)}…" ${labelled}. It is not private info.`);
    }
    const scanned = scanForModelAccess(msg(text), LEXICON, {});
    if (scanned.access !== "public_model_approved") {
      bad.push(`the router's scan calls "${text.slice(0, 56)}…" ${scanned.access} — ${scanned.reason}. It is not private info.`);
    }
  }
  return bad;
}

/** 5 · LP and deal material still cannot reach a training-permitting route. */
export function privateWorkStaysPrivate(scanForModelAccess) {
  const bad = [];
  for (const text of PRIVATE_WORK) {
    const scanned = scanForModelAccess(msg(text), LEXICON, {});
    if (scanned.access !== "private_model_only") {
      bad.push(`the router's scan would send "${text.slice(0, 56)}…" to a route that may train on it.`);
    }
    for (const leak of ["$5m", "$12m", "2%", "Northgate"]) {
      if (scanned.reason.includes(leak)) {
        bad.push(`the refusal for "${text.slice(0, 40)}…" quotes "${leak}" back into the log.`);
      }
    }
  }
  return bad;
}

/** RULE 0 · An empty fixture group is a failure, not a pass. */
export function rule0(groups) {
  const empty = Object.entries(groups).filter(([, v]) => !v || v.length === 0).map(([k]) => k);
  return empty.length
    ? [`examined nothing: ${empty.join(", ")} is empty. A guard over an empty loop reports success ` +
       `for a reason that has nothing to do with the thing it guards.`]
    : [];
}

// ─── Running it ──────────────────────────────────────────────────────────────

function report(heading, problems) {
  if (!problems.length) return 0;
  console.error(`\n${heading}:`);
  for (const p of problems) console.error(`  - ${p}`);
  return problems.length;
}

const classifyMod = await load(CLASSIFY, ["classifyModelAccess", "classifyAudience"]);
const accessMod = await load(MODEL_ACCESS, ["scanForModelAccess"]);
const { classifyModelAccess, classifyAudience } = classifyMod;
const { scanForModelAccess } = accessMod;

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual).slice(0, 400)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  expect("the shipped classifiers keep the axes independent", axesAreIndependent(classifyModelAccess, classifyAudience), false);
  expect("all four corners are reachable", allFourCornersAreReachable(classifyModelAccess, classifyAudience), false);
  expect("the router cannot see the audience", theRouterCannotSeeTheAudience(), false);
  expect("ordinary work routes free", ordinaryWorkRoutesFree(classifyModelAccess, scanForModelAccess), false);
  expect("LP and deal material stays private", privateWorkStaysPrivate(scanForModelAccess), false);
  expect("the real fixtures pass Rule 0", rule0({ AUDIENCE_FIXTURES, ACCESS_FIXTURES, ORDINARY_WORK, PRIVATE_WORK }), false);

  /* ─── THE NEGATIVE PROOFS ─── the broken state, restored, required to come back red. ─── */

  // THE SIBLING'S BUG, EXACTLY: internal read as "too sensitive to train on".
  const asTheSiblingHadIt = ({ text, intakeKind }) => {
    const base = classifyModelAccess({ text, intakeKind });
    if (classifyAudience({ text }).audience === "internal") return { access: "private_model_only", matched: ["internal"] };
    return base;
  };
  expect("model access derived from the audience, as the sibling had it", axesAreIndependent(asTheSiblingHadIt, classifyAudience), true);

  // THE MIRROR: audience derived from how private the material is.
  const audienceFromAccess = ({ text }) =>
    classifyModelAccess({ text, intakeKind: "drafting" }).access === "private_model_only"
      ? { audience: "internal", matched: ["derived"] }
      : classifyAudience({ text });
  expect("audience derived from the model access", axesAreIndependent(classifyModelAccess, audienceFromAccess), true);

  // ONE AXIS WITH TWO NAMES: both labels always move together, so two corners never occur.
  const alwaysInternalWhenPrivate = ({ text }) =>
    classifyModelAccess({ text, intakeKind: "drafting" }).access === "private_model_only"
      ? { audience: "internal", matched: [] }
      : { audience: "external", matched: [] };
  expect("two labels that always move together", allFourCornersAreReachable(classifyModelAccess, alwaysInternalWhenPrivate), true);

  // THE FLAT DETECTOR, AS IT STOOD BEFORE THIS CHANGE — every pattern sufficient alone.
  const flatPatterns = [
    { re: /\$\s?\d[\d,.]*\s?(k\b|m\b|bn\b|b\b|million|billion|thousand)/i, what: "a money figure" },
    { re: /\b(commitment|committed|capital call|called capital|drawdown|subscription)\b/i, what: "commitment language" },
    { re: /\b(carry|carried interest|hurdle|preferred return|waterfall|clawback)\b/i, what: "economics language" },
    { re: /\b(side letter|most favou?red nation|\bmfn\b|lpa\b|limited partnership agreement)\b/i, what: "side-letter language" },
    { re: /\b(pre-?money|post-?money|valuation|cap table|ownership|fully diluted)\b/i, what: "deal-term language" },
    { re: /\b(cheque size|check size|ticket size|allocation|pro rata)\b/i, what: "allocation language" },
    { re: /\b(term sheet|due diligence|data ?room|diligence request)\b/i, what: "diligence language" },
  ];
  const flatScan = (messages) => {
    const hay = messages.map((m) => m.content).join("\n").toLowerCase();
    const hits = flatPatterns.filter((p) => p.re.test(hay)).map((p) => p.what);
    return hits.length
      ? { access: "private_model_only", privateOnly: true, kinds: hits, reason: `this content carries ${hits.join(", ")}` }
      : { access: "public_model_approved", privateOnly: false, kinds: [], reason: "" };
  };
  expect("the flat detector, restored — a salary band and a seating plan read as LP material",
    ordinaryWorkRoutesFree(classifyModelAccess, flatScan), true);
  // AND IT MUST STILL CATCH THE REAL MATERIAL, which is why narrowing it was safe rather than lax.
  expect("the flat detector still caught the real material (so the narrowing is what changed)",
    privateWorkStaysPrivate(flatScan), false);

  // A DETECTOR THAT SIMPLY SAYS YES TO EVERYTHING — the lazy way to make check 5 pass.
  const alwaysPublic = () => ({ access: "public_model_approved", privateOnly: false, kinds: [], reason: "" });
  expect("a scan that never finds anything", privateWorkStaysPrivate(alwaysPublic), true);

  // A REFUSAL THAT QUOTES THE MATERIAL BACK INTO THE LOG.
  const leaky = (messages) => ({
    access: "private_model_only", privateOnly: true, kinds: ["x"],
    reason: `this content carries ${messages.map((m) => m.content).join(" ")}`,
  });
  expect("a refusal that quotes the figures back into the log", privateWorkStaysPrivate(leaky), true);

  // AN AUDIENCE FIELD ADDED TO THE ROUTER — checked as source, so it is simulated on a copy.
  const withAudience = () => {
    const policy = readFileSync(join(ROOT, POLICY), "utf8");
    const ctx = policy.slice(policy.indexOf("export interface PolicyContext"), policy.indexOf("export type RouteStage"));
    return /^\s*audience\??:/m.test(`${ctx}\n  audience: string;`) ? [] : ["fixture did not match"];
  };
  expect("the audience-field fixture matches the pattern this check uses", withAudience(), false);

  for (const group of ["AUDIENCE_FIXTURES", "ACCESS_FIXTURES", "ORDINARY_WORK", "PRIVATE_WORK"]) {
    expect(`an empty ${group} fails Rule 0`, rule0({ ...{ AUDIENCE_FIXTURES, ACCESS_FIXTURES, ORDINARY_WORK, PRIVATE_WORK }, [group]: [] }), true);
  }

  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log("\nSELF-TEST PASSED");
  process.exit(0);
}

let failures = 0;
failures += report("RULE 0", rule0({ AUDIENCE_FIXTURES, ACCESS_FIXTURES, ORDINARY_WORK, PRIVATE_WORK }));
if (failures === 0) {
  failures += report("AN AXIS IS BEING READ OFF THE OTHER", axesAreIndependent(classifyModelAccess, classifyAudience));
  failures += report("A CORNER OF THE MATRIX IS UNREACHABLE", allFourCornersAreReachable(classifyModelAccess, classifyAudience));
  failures += report("THE ROUTER CAN SEE THE AUDIENCE", theRouterCannotSeeTheAudience());
  failures += report("ORDINARY WORK IS BARRED FROM THE FREE LANES", ordinaryWorkRoutesFree(classifyModelAccess, scanForModelAccess));
  failures += report("LP OR DEAL MATERIAL COULD REACH A TRAINING-PERMITTING ROUTE", privateWorkStaysPrivate(scanForModelAccess));
}

if (failures) {
  console.error(
    `\nMost work is internal and not private, and it should run on a free reasoning lane. The two\n` +
    `labels exist so that "a partner is reading this" can never again be mistaken for "no model may\n` +
    `train on this". Fix the axis that is reading the other one.`,
  );
  process.exit(1);
}

console.log(
  `TWO AXES HOLD: ${ACCESS_FIXTURES.length} access × ${AUDIENCE_FIXTURES.length} audience fixtures crossed with neither ` +
  `moving the other, all four corners reachable, ${ORDINARY_WORK.length} ordinary work cards routed free, ` +
  `${PRIVATE_WORK.length} LP and deal cards held to a no-training route.`,
);
