#!/usr/bin/env node
/**
 * EVERY EMPLOYEE CAN BE REACHED BY NAME, AND A TAG NEVER AUTHORISES ANYTHING.
 *
 * ─── What she asked for ─────────────────────────────────────────────────────
 *
 * Mail one address — `boss@sequoiataylor.com` — and reach any employee with `#firstname`. The tag
 * list is therefore the ROSTER, derived from the `employees` table at the moment mail arrives, so
 * that hiring somebody gives them a working address with no code change.
 *
 * A derived list is the right design and it has a failure mode a hardcoded one does not: it can
 * derive WRONGLY, silently, for one person. Two employees whose first names collide, a seat whose
 * name is punctuation, a lifecycle value the query does not select — each of those makes exactly
 * one colleague unreachable while every other tag keeps working, so nothing looks broken. Mail to
 * that person does not bounce; it goes to the Chief of Staff and looks like it worked.
 *
 * ─── HOW THIS IS PROVEN, AND WHY NOT WITH A COPY OF THE RULE ───────────────
 *
 * The roster is rebuilt by REPLAYING EVERY MIGRATION into an in-memory SQLite database and running
 * the intake's own query against it. Not parsed out of the SQL with a regex, not a fixture: the 215
 * migrations that ship, applied in order, asked the same question the Worker asks.
 *
 * And the routing is checked by CALLING `routeToSeat` — the actual function `inboundMail.ts` calls.
 * `src/shared/boss/intake/mail.mjs` is a `.mjs` with a `.d.mts` precisely so this file can import
 * it. A validator that reimplemented the tag rule in order to check the tag rule would be asserting
 * its own copy, which is the defect ("two components each keeping their own list with no link")
 * that this guard exists to prevent, committed inside the guard.
 *
 * ─── AUTHORISATION IS THE SENDER. THE TAG ONLY ROUTES. ─────────────────────
 *
 * The tags are publishable on purpose — anyone who learns `#monique` can type it, and it buys them
 * nothing. That is only true while the sender check is unconditional and comes FIRST, so this
 * asserts the order in the handler source as well as the behaviour of the predicates.
 *
 * RULE 0: ZERO EMPLOYEES EXAMINED IS A FAILURE, NOT A PASS. A loop over an empty roster reports "no
 * unreachable employees" and is indistinguishable from a working system.
 *
 *   node scripts/validate/every-employee-has-a-reachable-tag.mjs
 *   node scripts/validate/every-employee-has-a-reachable-tag.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  BOSS_DEFAULT_ROUTE_ROLE, BOSS_INTAKE_SENDERS, dmarcPassed, isOwner,
  replyBody, routeToSeat, seatTag,
} from "../../src/shared/boss/intake/mail.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HANDLER = "src/worker/boss/intake/inboundMail.ts";

/**
 * The exact query the intake runs. Copied ONCE, here, and asserted below to still be present in the
 * handler — so this validator cannot drift into checking a roster the Worker does not see.
 */
const ROSTER_SQL =
  `SELECT id, name, role, lane, department FROM employees
    WHERE status = 'active' AND lifecycle IN ('active','provisional')
    ORDER BY created_at`;

/** Replay the shipped migrations and ask them who works here. */
export function rosterFromMigrations(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failed = [];
  for (const f of files) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  const roster = db.prepare(ROSTER_SQL).all();
  return { roster, files: files.length, failed };
}

/** Rule: every seat is reachable by its own tag, and lands on ITSELF. */
export function unreachable(roster) {
  const bad = [];
  const byTag = new Map();
  for (const s of roster) {
    const t = seatTag(s.name);
    if (!/^#[a-z0-9]+$/.test(t)) {
      bad.push(`${s.name} (${s.id}) produces the tag "${t}", which is not a usable hashtag.`);
      continue;
    }
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(s);
  }
  for (const [tag, seats] of byTag) {
    if (seats.length > 1) {
      bad.push(`${tag} is shared by ${seats.map((s) => `${s.name} (${s.id})`).join(" and ")} — neither can be reached by name.`);
      continue;
    }
    // BEHAVIOURAL: route a real message and check who actually takes it.
    const route = routeToSeat(`please handle this ${tag}`, roster);
    if (!route) { bad.push(`${tag} routed to nothing at all.`); continue; }
    if (route.outcome !== "ROUTED" || route.seat.id !== seats[0].id) {
      bad.push(`${tag} should reach ${seats[0].name} (${seats[0].id}) and instead came back ${route.outcome} on ${route.seat.id}.`);
    }
  }
  return bad;
}

/** Rule: nothing is ever dropped, and an unknown tag is answered rather than guessed. */
export function neverDropped(roster) {
  const bad = [];
  const cases = [
    ["a tag no employee answers to", "please look at this #nobodyhere"],
    ["no tag at all", "just a note with no hashtag in it"],
    ["an empty message", ""],
    ["a West Peek tag typed by mistake", "#wpdealflow this came to the wrong system"],
  ];
  for (const [name, text] of cases) {
    const route = routeToSeat(text, roster);
    if (!route) { bad.push(`${name}: routed to nothing. Mail must never be dropped.`); continue; }
    if (!route.seat?.id) { bad.push(`${name}: came back with no seat.`); continue; }
    if (!roster.some((s) => s.id === route.seat.id)) {
      bad.push(`${name}: routed to ${route.seat.id}, who is not on the active roster.`);
    }
    if (route.outcome === "ROUTED") {
      bad.push(`${name}: reported ROUTED, so she would be told an employee was named when none was.`);
    }
    if (!route.why || route.why.length < 10) bad.push(`${name}: gave no reason, so the reply cannot say what happened.`);
  }
  // The named default has to exist, or "route to a named default" is a promise nothing keeps.
  if (!roster.some((s) => String(s.role).toLowerCase() === BOSS_DEFAULT_ROUTE_ROLE.toLowerCase())) {
    bad.push(`No active employee holds the role "${BOSS_DEFAULT_ROUTE_ROLE}", which is the declared default for unroutable mail.`);
  }
  return bad;
}

/** Rule: the reply advertises the tags from the roster, so it can never list a seat that is gone. */
export function replyNamesEveryone(roster) {
  const bad = [];
  const route = routeToSeat("no tag here", roster);
  const body = replyBody(route, roster, "a subject");
  for (const s of roster) {
    if (!body.includes(seatTag(s.name))) {
      bad.push(`the reply does not tell her about ${seatTag(s.name)} (${s.name}), so that seat is undiscoverable.`);
    }
  }
  return bad;
}

/**
 * Rule: the SENDER authorises, the tag never does — asserted on behaviour and on order.
 */
export function authorisationIsTheSender(handlerSource) {
  const bad = [];

  // Behaviour: neither predicate can be satisfied by anything a stranger controls in the body.
  if (isOwner("attacker@example.com")) bad.push("isOwner() accepted an address that is not hers.");
  if (isOwner("")) bad.push("isOwner() accepted an empty address.");
  if (!BOSS_INTAKE_SENDERS.every((a) => isOwner(a))) bad.push("isOwner() rejects an address on its own allowlist.");
  if (dmarcPassed(null)) bad.push("dmarcPassed() treated a MISSING Authentication-Results header as a pass — an unchecked message would be trusted.");
  if (dmarcPassed("spf=pass; dkim=pass")) bad.push("dmarcPassed() accepted SPF and DKIM without DMARC — those authenticate the envelope, not the From: header the allowlist trusts.");
  if (dmarcPassed("dmarc=fail")) bad.push("dmarcPassed() accepted an explicit dmarc=fail.");
  if (!dmarcPassed("mx.example.com; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com")) {
    bad.push("dmarcPassed() rejected a genuine passing header.");
  }

  if (handlerSource === null) return [...bad, `${HANDLER} could not be read, so the order of the checks is unverified.`];

  // Order: the sender is settled before the roster is even read.
  const authAt = handlerSource.indexOf("const authorised =");
  const rosterAt = handlerSource.indexOf("await activeRoster(env)");
  const refuseAt = handlerSource.indexOf("REFUSED_SENDER");
  if (authAt === -1) bad.push(`${HANDLER} no longer computes an \`authorised\` value.`);
  if (rosterAt === -1) bad.push(`${HANDLER} no longer reads the roster from D1 — the tags would have to come from somewhere else.`);
  if (authAt !== -1 && rosterAt !== -1 && authAt > rosterAt) {
    bad.push("the roster is read before the sender is authorised — a tag would be resolved for an unauthenticated message.");
  }
  if (refuseAt !== -1 && rosterAt !== -1 && refuseAt > rosterAt) {
    bad.push("an unauthorised sender is refused only after the roster is read, so the tag is doing work before the sender is checked.");
  }
  if (!/if \(!authorised\)/.test(handlerSource)) {
    bad.push(`${HANDLER} has no unconditional refusal branch for an unauthorised sender.`);
  }
  /*
   * The tag must never be able to grant. A tag named in the authorisation expression is the bug.
   *
   * BOUNDED TO THE STATEMENT, not to a fixed number of characters. A 200-character window ran past
   * the semicolon into the next block — which legitimately talks about tags, because that is what
   * the handler does two lines later — and reported the correct code as a violation while quoting
   * the line that was fine. A guard that cries wolf on compliant code is a guard somebody deletes.
   */
  const semi = handlerSource.indexOf(";", authAt);
  const authLine = handlerSource.slice(authAt, semi === -1 ? authAt + 200 : semi + 1);

  /*
   * ─── THE SHAPE OF THE EXPRESSION, NOT A LIST OF FORBIDDEN WORDS ──────────
   *
   * The first version of this rule looked for the words "tag", "route" and "seat" in the
   * authorisation expression, and its own negative proof walked straight through it: replacing the
   * check with
   *
   *     const authorised = isOwner(sender) || subject.includes("#monique");
   *
   * mentions none of those words and the guard passed it. That is the precise failure this whole
   * validator exists to prevent — a public word granting entry — and the guard could not see it.
   *
   * So the assertion is now structural. The authorisation is a CONJUNCTION of exactly two things:
   * the address is one of hers, and DMARC proved it. Any `||` is an escape hatch by construction;
   * a missing `dmarc` term means a forged `From:` header is trusted; and a literal hashtag has no
   * business in the expression at all. All three are caught by the shape rather than by vocabulary,
   * so the next way somebody thinks of to weaken it is caught too.
   */
  if (/#[a-z0-9]/i.test(authLine)) {
    bad.push(`the authorisation expression contains a literal hashtag: "${authLine.trim()}". A hashtag is a public word and can never authorise.`);
  }
  if (/\|\|/.test(authLine)) {
    bad.push(`the authorisation expression contains an OR: "${authLine.trim()}". Both the address AND the DMARC result must hold; an alternative is a way in that bypasses one of them.`);
  }
  if (!/\bisOwner\s*\(/.test(authLine)) {
    bad.push(`the authorisation expression does not check the sender against her addresses: "${authLine.trim()}".`);
  }
  if (!/\bdmarc/i.test(authLine)) {
    bad.push(`the authorisation expression does not require DMARC: "${authLine.trim()}". A From: header is a string anybody can type, so an allowlist checked against an unverified one is a comment, not a control.`);
  }
  if (/\btags?\b|\broute\b|\bseat\b|hashtag/i.test(authLine)) {
    bad.push(`the authorisation expression mentions the tag: "${authLine.trim()}". The tag routes; it never authorises.`);
  }
  // And the query this validator asserts against must be the query the handler actually runs.
  const normalise = (s) => s.replace(/\s+/g, " ").trim();
  if (!normalise(handlerSource).includes(normalise(ROSTER_SQL))) {
    bad.push(`${HANDLER} no longer runs the roster query this validator checks, so the two have drifted apart.`);
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

// `--print-roster`: the replayed active roster as JSON, for a sibling scan that needs the same list
// without running this one as a side effect (every-employee-address-receives.mjs).
if (process.argv.includes("--print-roster")) {
  console.log(JSON.stringify(rosterFromMigrations().roster));
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  const good = [
    { id: "emp_chief", name: "Simone", role: "Chief of Staff", lane: "ops" },
    { id: "emp_relationship", name: "Monique", role: "Director of Relationships", lane: "ops" },
  ];
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  expect("a healthy roster is reachable", unreachable(good), false);
  expect("two employees sharing a first name", unreachable([
    ...good, { id: "emp_new", name: "Monique", role: "Analyst", lane: "ops" },
  ]), true);
  expect("a seat whose name yields no usable tag", unreachable([
    ...good, { id: "emp_odd", name: "—", role: "Analyst", lane: "ops" },
  ]), true);
  expect("nothing is dropped on a healthy roster", neverDropped(good), false);
  expect("a roster with no Chief of Staff has no declared default", neverDropped([good[1]]), true);
  expect("the reply names every seat", replyNamesEveryone(good), false);

  const realHandler = existsSync(join(ROOT, HANDLER)) ? readFileSync(join(ROOT, HANDLER), "utf8") : null;
  expect("the real handler authorises on the sender first", authorisationIsTheSender(realHandler), false);
  expect("a handler that reads the roster before authorising", authorisationIsTheSender(
    realHandler?.replace("const authorised =", "const __moved =")
      .replace("const roster = await activeRoster(env);", "const roster = await activeRoster(env);\n  const authorised = isOwner(sender) && dmarc;") ?? null,
  ), true);
  expect("a handler where the TAG grants entry", authorisationIsTheSender(
    realHandler?.replace("const authorised = isOwner(sender) && dmarc;", "const authorised = isOwner(sender) || tag === '#monique';") ?? null,
  ), true);

  if (failed) { console.error(`EMPLOYEE TAG SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("EMPLOYEE TAG SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const { roster, files, failed } = rosterFromMigrations();

if (failed.length) {
  console.error(`EMPLOYEE TAG SCAN FAILED — ${failed.length} migration(s) could not be applied, so the roster is not the one that ships:`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(2);
}

/*
 * RULE 0. Zero employees is not "no unreachable employees" — it is a query that has stopped
 * matching the schema, reporting a clean bill of health over an empty loop.
 */
if (roster.length === 0) {
  console.error(`EMPLOYEE TAG SCAN FAILED — ${files} migration(s) applied and the roster query returned 0 employees.`);
  console.error("  Either the seed no longer runs or the intake's query no longer matches the schema.");
  console.error("  Every #firstname in this system would silently fall through to the default seat.");
  process.exit(2);
}

const handlerPath = join(ROOT, HANDLER);
const handlerSource = existsSync(handlerPath) ? readFileSync(handlerPath, "utf8") : null;

const problems = [
  ...unreachable(roster),
  ...neverDropped(roster),
  ...replyNamesEveryone(roster),
  ...authorisationIsTheSender(handlerSource),
];

if (problems.length) {
  console.error(`EMPLOYEE TAG SCAN FAILED — ${problems.length} problem(s) across ${roster.length} employee(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `EMPLOYEE TAG SCAN PASSED: ${files} migrations replayed, ${roster.length} active employee(s), `
  + `every one reachable by name — ${roster.map((s) => seatTag(s.name)).join(" ")} — `
  + "unknown and missing tags answered rather than dropped, and authorisation settled on the sender before the roster is read.",
);
