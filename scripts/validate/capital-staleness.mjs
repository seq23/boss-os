#!/usr/bin/env node
/**
 * A STALE BLOCK IS NOT LIVE INVENTORY.
 *
 * Her rule, in her words: "capital doesnt need to forget that deals go stale and something over 6
 * months old is likely stale and the buyer and seller matchup likely wont work, but they can go
 * back as far as they want to find me people who would be interested in buying something new or
 * people i should reach out to".
 *
 * Two halves, and they pull in opposite directions, which is why this is a validator and not a
 * comment. The CROSS must decay. OUTREACH must not.
 *
 * What this caught: `halfLifeDays` checked `durability === "transacted"` BEFORE the sell branch and
 * returned Infinity on either side. Eleven blocks sold in March 2026 therefore scored freshness
 * 1.0 forever and paired against fresh buyers as if the stock were still available. `transacted`
 * is a durable fact about a PERSON — it is why a buyer's mandate never expires — and was never
 * meant to assert that inventory persists.
 *
 * Every assertion below is behavioural: it calls the real exported functions on constructed rows.
 * None of it asserts prose.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { halfLifeDays, freshness, standingMatches, assignedSearch, revivals, atHerBrokerage, HER_BROKERAGE_DOMAIN } from "../ops/interest-match.mjs";

const NOW = Date.parse("2026-09-10T12:00:00Z");

/*
 * ─── THE LIVE LEDGER LIVES ON ONE MACHINE ────────────────────────────────────
 *
 * `~/.boss-os/capital/ledger.json` is her deal ledger: 545 rows of who wants what, correctly never
 * committed. Two checks below run the rules against it because fixtures alone cannot prove the
 * suppression is exercised by real data. That makes those two checks machine-bound, and on
 * 2026-09-12 the first CI run that ever got past `npm ci` failed on exactly that: ENOENT on a file
 * that cannot exist on a GitHub runner, read as a validation failure. The fixed rule:
 *
 *   - ledger present            → run the live checks; a present-but-EMPTY ledger is a hard fail,
 *                                 here and in CI, because that is "examined 0" wearing a file name.
 *   - ledger absent, in CI      → NAMED STOP [LEDGER_NOT_HERE]: say so on stdout and count what
 *                                 DID run. The ten behavioural assertions still ran; the stop is
 *                                 green because it is a fact about the runner, not about the code.
 *   - ledger absent, not in CI  → hard fail. On the machine that owns the ledger an absent file
 *                                 means the writer stopped, and that is precisely the silent break
 *                                 this half of the validator exists to notice.
 *
 * CI is detected by the `CI` variable GitHub Actions always sets. Nothing else may widen this.
 */
const LEDGER_PATH = `${process.env.HOME}/.boss-os/capital/ledger.json`;
const IN_CI = process.env.CI === "true";
const notHere = [];
function liveLedger(label) {
  if (!fs.existsSync(LEDGER_PATH)) {
    if (!IN_CI) throw new Error(`${LEDGER_PATH} is absent on the machine that owns it — the ledger writer has stopped, or HOME is wrong`);
    notHere.push(label);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  const rows = raw.interests ?? raw.rows ?? raw;
  const all = Array.isArray(rows) ? rows : Object.values(rows);
  assert.ok(all.length > 0, `${LEDGER_PATH} holds no interests — this check examined nothing`);
  return all;
}
const row = (o) => ({ asset: "Polymarket", confidence: "high", ...o });
const fails = [];
const check = (label, fn) => { try { fn(); } catch (e) { fails.push(`${label}: ${e.message}`); } };

// 1. A sell decays on BOTH durabilities. This is the regression itself.
check("a transacted sell must not be immortal", () => {
  const hl = halfLifeDays(row({ side: "sell", durability: "transacted", date: "2026-03-12", size_usd: 8e6 }));
  assert.notEqual(hl, Infinity, "a transacted SELL still returned an infinite half-life");
  assert.equal(hl, halfLifeDays(row({ side: "sell", durability: "wants_now", date: "2026-03-12", size_usd: 8e6 })),
    "durability changed a sell's half-life; inventory ages the same either way");
});

// 2. Six months old is materially dead as a cross, on either durability.
for (const durability of ["transacted", "wants_now"]) {
  check(`a ${durability} sell older than six months is stale`, () => {
    const f = freshness(row({ side: "sell", durability, date: "2026-03-01", size_usd: 8e6 }), NOW);
    assert.ok(f.ageDays > 180, `constructed row is only ${f.ageDays}d old — the fixture drifted`);
    assert.ok(f.score < 0.25, `scored ${f.score.toFixed(3)}; a six-month-old block must not read as live supply`);
  });
}

// 3. A BUYER'S MANDATE PERSISTS. The fix must not have flattened the other side.
check("an institutional buyer's mandate does not expire", () => {
  const hl = halfLifeDays(row({ side: "buy", durability: "transacted", date: "2025-03-12", size_usd: 1e9 }));
  assert.equal(hl, Infinity, "a transacted buyer stopped being durable");
  assert.ok(halfLifeDays(row({ side: "buy", durability: "wants_now", date: "2025-03-12", size_usd: 1e9 })) >= 365,
    "a $1B standing buy mandate decays too fast to survive a year");
});

// 4. THE CROSS: a stale transacted sell must not pair with a fresh buyer.
check("a stale transacted sell must not cross", () => {
  const stale = row({ side: "sell", durability: "transacted", date: "2026-02-01", size_usd: 50e6,
    principal: "Stale Seller", principal_email: "stale@example.com" });
  const fresh = row({ side: "buy", durability: "wants_now", date: "2026-09-08", size_usd: 50e6,
    principal: "Fresh Buyer", principal_email: "fresh@example.com" });
  const { picked } = standingMatches([stale, fresh], new Set(), NOW);
  assert.equal(picked.length, 0, "a block sold seven months ago was offered as a live cross");
});

// 5. The same pair, with a FRESH sell, must cross — or assertion 4 proves nothing.
check("a fresh sell against the same buyer must still cross", () => {
  const freshSell = row({ side: "sell", durability: "wants_now", date: "2026-09-05", size_usd: 50e6,
    principal: "Fresh Seller", principal_email: "fs@example.com" });
  const fresh = row({ side: "buy", durability: "wants_now", date: "2026-09-08", size_usd: 50e6,
    principal: "Fresh Buyer", principal_email: "fresh@example.com" });
  const { picked } = standingMatches([freshSell, fresh], new Set(), NOW);
  assert.equal(picked.length, 1, "the matcher stopped crossing live supply; staleness was applied as a blanket cutoff");
});

// 6. OUTREACH REACHES BACK AS FAR AS THE LEDGER GOES. No cutoff, ever.
check("an eighteen-month-old interest is still reachable for outreach", () => {
  const ancient = row({ side: "buy", durability: "wants_now", date: "2025-03-01", size_usd: 250e6,
    principal: "Old Buyer", principal_email: "old@example.com" });
  const found = assignedSearch([ancient], "Polymarket", "buy", 250e6, new Set(), NOW);
  assert.equal(found.length, 1, "an 18-month-old buyer vanished from the assigned search — age became a cutoff");
  assert.ok(found[0].ageDays > 500, "the fixture is not actually old");
});
check("an ancient unfilled interest is still revivable", () => {
  const ancient = row({ side: "buy", durability: "wants_now", date: "2025-03-01", size_usd: 250e6,
    principal: "Old Buyer", principal_email: "old@example.com" });
  assert.ok(revivals([ancient], [], new Set(), NOW, 5).picked.length >= 1,
    "the revival list applied a staleness cutoff; that is the half of the rule that must not decay");
});

// 7. HARD-FAIL ON AN EMPTY LEDGER rather than passing an empty loop.
check("the live ledger offers no stale-sell cross", () => {
  const all = liveLedger("stale-sell cross against the live ledger");
  if (!all) return;
  const { picked } = standingMatches(all, new Set(), Date.now());
  const stale = picked.filter((m) => m.sellAge > 180);
  assert.equal(stale.length, 0,
    `${stale.length} live cross(es) rest on a sell older than six months: ${stale.map((m) => `${m.asset} sell ${m.sellAge}d`).join(", ")}`);
});

/*
 * ─── 8. TWO BROKERS AT HER OWN FIRM ARE NOT A CROSS SHE BROKERS ─────────────
 *
 * Her words, 10 September 2026: "monique should not send me cross connections between 2 disparate
 * emails @rainmakersecurities — those are 2 brokers at my brokerage firm who can cross trades on
 * their own."
 *
 * ONE SIDE IS STILL A REAL DEAL, and that half needs guarding at least as much as the suppression
 * does: a well-meaning widening of this rule would delete the ordinary shape of her business, where
 * her firm holds the paper and an outside buyer wants it.
 *
 * AND IT MUST KEY ON `intermediated_by`. Not one of the 545 rows in the live ledger carries a
 * `@rainmakersecurities.com` PRINCIPAL address and 242 carry one as the intermediary, because a rep
 * never sends his client's address. A version of this that only read `principal_email` would
 * suppress nothing, examine nothing, and pass — this repo's "runs but inert" defect in one field
 * name. The last assertion is the guard against exactly that.
 */
const rmBuy = { asset: "Kalshi", side: "buy", confidence: "high", durability: "wants_now",
  date: "2026-09-01", size_usd: 20e6, principal: "unnamed client of A", intermediated_by: "mgrosman@rainmakersecurities.com" };
const rmSell = { asset: "Kalshi", side: "sell", confidence: "high", durability: "wants_now",
  date: "2026-09-01", size_usd: 20e6, principal: "unnamed client of B", intermediated_by: "shamedanchi@rainmakersecurities.com" };
const outsideBuy = { ...rmBuy, principal: "Outside Buyer", intermediated_by: "colton@hiive.com" };

check("both sides at her own firm is suppressed", () => {
  const r = standingMatches([rmBuy, rmSell], new Set(), NOW);
  assert.equal(r.picked.length, 0, "a Rainmaker-to-Rainmaker cross was recommended to her");
  assert.equal(r.coBroker, 1, `the suppression was not counted (coBroker=${r.coBroker}); a filter she cannot see is one she cannot correct`);
});

check("one side at her own firm is a real co-broker deal and survives", () => {
  const r = standingMatches([outsideBuy, rmSell], new Set(), NOW);
  assert.equal(r.picked.length, 1, "an outside buyer against a Rainmaker seller was suppressed — that is the business, not a conflict");
  assert.equal(r.coBroker, 0, "a legitimate one-sided pairing was counted as an internal cross");
});

check("the firm is detected on intermediated_by, not only principal_email", () => {
  assert.ok(atHerBrokerage({ intermediated_by: "msutic@rainmakersecurities.com" }),
    "a rep on intermediated_by was not recognised — this is how 242 of 545 live rows carry the firm, so the rule would be inert");
  assert.ok(atHerBrokerage({ principal_email: "someone@rainmakersecurities.com" }), "a direct principal address was not recognised");
  assert.ok(!atHerBrokerage({ intermediated_by: "colton@hiive.com" }), "an outside firm was treated as hers");
  assert.ok(!atHerBrokerage({ principal_email: null, intermediated_by: null }), "an empty row was treated as hers");
});

// HARD-FAIL ON ZERO EXAMINED: the rule must be exercised against the real ledger, not only fixtures.
check("the live ledger actually exercises the co-broker rule", () => {
  const all = liveLedger("co-broker rule against the live ledger");
  if (!all) return;
  const atFirm = all.filter(atHerBrokerage).length;
  assert.ok(atFirm > 0,
    `0 of ${all.length} live rows resolve to ${HER_BROKERAGE_DOMAIN}. Either the ledger no longer records the `
    + "intermediary or the domain has changed — either way this suppression is guarding nothing.");
  const r = standingMatches(all, new Set(), Date.now());
  for (const m of r.picked) {
    assert.ok(!(atHerBrokerage(m.buy) && atHerBrokerage(m.sell)),
      `${m.asset} was recommended with your own firm on both sides: ${m.buy.intermediated_by} <> ${m.sell.intermediated_by}`);
  }
});

// ─── Self-test: the three ledger states, driven through this same file with a controlled HOME ──
if (process.argv.includes("--self-test")) {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, mkdirSync } = fs;
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const run = (home, ci) => spawnSync(process.execPath, [new URL(import.meta.url).pathname],
    { encoding: "utf8", env: { ...process.env, HOME: home, CI: ci ? "true" : "", GITHUB_ACTIONS: "" } });
  let failed = 0;
  const expect = (name, cond) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ self-test: ${name}`); failed += 1; } };

  const empty = mkdtempSync(join(tmpdir(), "capital-staleness-nohome-"));
  const inCi = run(empty, true);
  expect("absent ledger in CI is a NAMED STOP and exits 0", inCi.status === 0 && /NAMED STOP \[LEDGER_NOT_HERE\]/.test(inCi.stdout));
  expect("absent ledger in CI still reports the assertions that DID run", /\d+ behavioural assertions ran/.test(inCi.stdout));
  const local = run(empty, false);
  expect("absent ledger on the owning machine is a hard fail", local.status === 1 && /ledger writer has stopped/.test(local.stderr));

  const hollow = mkdtempSync(join(tmpdir(), "capital-staleness-empty-"));
  mkdirSync(join(hollow, ".boss-os", "capital"), { recursive: true });
  writeFileSync(join(hollow, ".boss-os", "capital", "ledger.json"), JSON.stringify({ interests: [] }));
  const emptyCi = run(hollow, true);
  expect("a present but EMPTY ledger is a hard fail even in CI", emptyCi.status === 1 && /examined nothing/.test(emptyCi.stderr));

  if (failed) { console.error(`CAPITAL STALENESS SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("CAPITAL STALENESS SELF-TEST PASSED");
  process.exit(0);
}

if (fails.length) {
  console.error(`CAPITAL STALENESS FAIL (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
const ran = 12 - notHere.length;
for (const s of notHere) console.log(`NAMED STOP [LEDGER_NOT_HERE]: ${s} — ${LEDGER_PATH} does not exist on this runner (CI=true); it is checked where the ledger lives.`);
console.log(`CAPITAL STALENESS PASS: ${ran} behavioural assertions ran — a sell decays on either durability, six months reads as stale, a buyer's mandate stays durable, a stale sell cannot cross while a fresh one still does, and outreach reaches back with no cutoff. Two brokers at her own firm never cross; one side still does.`
  + (notHere.length ? "" : " Live ledger offers 0 stale-sell crosses and 0 internal co-broker crosses."));
