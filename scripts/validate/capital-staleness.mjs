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
import { halfLifeDays, freshness, standingMatches, assignedSearch, revivals } from "../ops/interest-match.mjs";

const NOW = Date.parse("2026-09-10T12:00:00Z");
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
  const path = `${process.env.HOME}/.boss-os/capital/ledger.json`;
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const rows = raw.interests ?? raw.rows ?? raw;
  const all = Array.isArray(rows) ? rows : Object.values(rows);
  assert.ok(all.length > 0, `${path} holds no interests — this check examined nothing`);
  const { picked } = standingMatches(all, new Set(), Date.now());
  const stale = picked.filter((m) => m.sellAge > 180);
  assert.equal(stale.length, 0,
    `${stale.length} live cross(es) rest on a sell older than six months: ${stale.map((m) => `${m.asset} sell ${m.sellAge}d`).join(", ")}`);
});

if (fails.length) {
  console.error(`CAPITAL STALENESS FAIL (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("CAPITAL STALENESS PASS: 8 behavioural assertions — a sell decays on either durability, six months reads as stale, a buyer's mandate stays durable, a stale sell cannot cross while a fresh one still does, and outreach reaches back with no cutoff. Live ledger offers 0 stale-sell crosses.");
