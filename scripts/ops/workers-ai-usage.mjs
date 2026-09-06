#!/usr/bin/env node
/**
 * How much of Workers AI's free allowance has actually been used.
 *
 * WHY THIS IS A SCRIPT AND NOT A SCREEN. The Workers AI binding does not report neurons consumed —
 * there is no field on the response, and a Worker cannot read its own remaining balance. The true
 * figure exists only in Cloudflare's GraphQL analytics API, which needs an ACCOUNT-SCOPED token:
 * the same token that can edit D1, deploy Workers and read R2.
 *
 * Putting that token into the Worker so a page could draw a progress bar would trade this system's
 * entire credential posture for a number. So this runs where the token already lives — the owner's
 * machine, through the encrypted vault — which is the same shape as every other private-side
 * capability here, and the same reason the Claude Code key never enters the cloud half.
 *
 * WHY IT MATTERS AT ALL. The owner's standing instruction is to keep everything as close to $0 as
 * possible, and Workers AI's included allowance is the only genuinely free cloud tier this system
 * has. "Free" is a claim with a boundary, and this is the only honest way to see the boundary.
 *
 *   npm run ops:workers-ai-usage
 *   npm run ops:workers-ai-usage -- --days 7
 *
 * It reads. It writes nothing, anywhere.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "8d147e242033699dd37c6f5a451f48d2";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

/** Cloudflare's published included allowance. A boundary, not a measurement. */
const FREE_NEURONS_PER_DAY = 10_000;

if (!TOKEN) {
  console.error(
    "CLOUDFLARE_API_TOKEN is not set.\n\n" +
      "Run this through the vault so the token is never typed or echoed:\n" +
      "  npm run vault:run -- npm run ops:workers-ai-usage",
  );
  process.exit(1);
}

const daysArg = process.argv.indexOf("--days");
const days = daysArg === -1 ? 1 : Math.max(1, Number(process.argv[daysArg + 1]) || 1);
const since = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

const query = `query {
  viewer {
    accounts(filter: {accountTag: "${ACCOUNT_ID}"}) {
      aiInferenceAdaptiveGroups(limit: 100, filter: {datetimeHour_geq: "${since}"}) {
        sum { totalNeurons }
        dimensions { modelId }
      }
    }
  }
}`;

const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});

const body = await res.json().catch(() => null);

if (!res.ok || !body) {
  console.error(`Cloudflare returned ${res.status} and no readable body.`);
  process.exit(1);
}

/*
 * A GraphQL error arrives inside a 200. Treating HTTP status as the answer is how a failed read
 * gets reported as zero usage - which, for a question whose whole purpose is "am I still inside the
 * free tier", is the most dangerous possible wrong answer.
 */
if (body.errors?.length) {
  console.error("Cloudflare refused the query:");
  for (const e of body.errors) console.error(`  - ${e.message}`);
  console.error(
    "\nIf this says the token lacks permission, the token needs Account Analytics: Read.\n" +
      "That is a READ permission and does not widen anything else the token can do.",
  );
  process.exit(1);
}

const groups = body.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
const total = groups.reduce((sum, g) => sum + Number(g.sum?.totalNeurons ?? 0), 0);
const budget = FREE_NEURONS_PER_DAY * days;
const pct = budget > 0 ? (total / budget) * 100 : 0;

console.log(`Workers AI — the last ${days} day${days === 1 ? "" : "s"}, since ${since}\n`);

if (groups.length === 0) {
  // AN EMPTY RESULT IS AN ANSWER, and it is stated as one. Rendering nothing here would leave the
  // reader unable to tell "no inference ran" from "the query failed quietly".
  console.log("  No Workers AI inference recorded in this window.");
} else {
  for (const g of groups.sort((a, b) => Number(b.sum?.totalNeurons ?? 0) - Number(a.sum?.totalNeurons ?? 0))) {
    const n = Number(g.sum?.totalNeurons ?? 0);
    console.log(`  ${String(n).padStart(9)} neurons   ${g.dimensions?.modelId ?? "(unknown model)"}`);
  }
  console.log("");
}

console.log(`  TOTAL      ${String(total).padStart(9)} neurons`);
console.log(`  Included   ${String(budget).padStart(9)} neurons  (${FREE_NEURONS_PER_DAY.toLocaleString()}/day)`);
console.log(`  Used       ${pct.toFixed(2).padStart(9)}%`);

if (total > budget) {
  // Stated plainly and without alarm. Exceeding the allowance is a fact about the account, not a
  // fault in the system, and it is exactly the fact the owner asked to be able to see.
  console.log(
    `\n  OVER THE INCLUDED ALLOWANCE by ${(total - budget).toLocaleString()} neurons.\n` +
      `  Beyond the free tier Cloudflare charges $0.011 per 1,000 neurons.`,
  );
}

console.log(
  `\n  This is Cloudflare's own figure, read from the account. Boss OS's cost ledger records ` +
    `Workers AI\n  calls at zero and says so — it cannot see this number from inside a Worker.`,
);
