#!/usr/bin/env node
/**
 * THURSDAY 07:00 CENTRAL: "SELLERS FOR WHAT YOUR LPS WANT TO BUY" (owner, 1 Nov 2026).
 *
 * The mirror of Tuesday's "Buyers for what you're selling", for her BUY orders (what her LPs want).
 * The same code path with the side inverted — `buyer-hunt.mjs` hunts the other side of whatever she
 * holds, and `--side sell` already meant "hunt sellers". This file exists so the Thursday run has a
 * script name of its own for its duty row (`duty_seller_hunt`, Monique), which
 * `validate:launchd-duty-link` needs to tell the two weekly runs apart.
 *
 * It finds (a) people in her own mail who said they hold or can source the company and (b) funds
 * that report holding it in public SEC filings. Size is matched on overlap (a $100M seller fills a
 * $15M buy), price within the deal grid's tolerance, older orders rank lower, ~6-month lookback
 * (`lib/side-hunt.mjs`). No paid service, no model, no 8Raise; nothing leaves her Mac but the one
 * email to her. Matches are never Decide items.
 *
 *   npm run capital:sellers                    # print it
 *   npm run capital:sellers -- --send --email  # the Thursday job: keep the finds and email her
 */
if (!process.argv.includes("--side")) process.argv.push("--side", "sell");
const { runHunt } = await import("./buyer-hunt.mjs");
runHunt("sell").catch((err) => { console.error(`SELLER HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
