#!/usr/bin/env node
/**
 * Deploy to production, in the only safe order (P50).
 *
 * THE SHARP EDGE THIS REMOVES. `wrangler deploy` succeeding says nothing about whether migrations
 * applied. That shipped code against absent tables TWICE in one day — both times the deploy output
 * looked perfect and the feature 500'd in production.
 *
 * The fix is not discipline, it is a script. Four steps, and it stops at the first one that fails:
 *
 *   1 · apply migrations
 *   2 · VERIFY none are pending — the step a human skips
 *   3 * build and deploy
 *   4 · verify the worker answers
 *
 * Migrations before code, because the reverse ships code against tables that do not exist.
 */

import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
const say = (s) => process.stdout.write(`${s}\n`);
const die = (s) => { process.stderr.write(`\n✗ ${s}\n`); process.exit(1); };

// ---------------------------------------------------------------------------
// COMMISSIONING GATE (Boss OS). This repo began as a copy of West Peek OS, whose
// wrangler.toml named REAL provisioned West Peek resources. Deploying before Boss
// OS has its own would have published Boss OS code onto West Peek's live Worker
// and migrated West Peek's production database.
//
// So: refuse to deploy while any production identifier is still a placeholder.
// A named stop nobody sees is not a named stop, so this prints why and exits 1.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
// Anchored to a real section header at the start of a line. `indexOf` matched the words
// "[env.production]" inside a comment near the top of the file, so the slice began above the LOCAL
// profile and the gate read its deliberate all-zero placeholders as if they were production's -
// a gate that blocks a correctly commissioned deploy, which is how a gate gets bypassed.
const prodStart = toml.search(/^\[env\.production\]$/m);
if (prodStart === -1) die("wrangler.toml has no [env.production] section — refusing to deploy blind.");
const prod = toml.slice(prodStart);
const placeholders = [];
if (/database_id = "0{8}-0{4}-0{4}-0{4}-0{12}"/.test(prod)) placeholders.push("D1 database_id");
if (/\bid = "0{32}"/.test(prod)) placeholders.push("KV namespace id");

if (placeholders.length) {
  die(
    `NAMED STOP: Boss OS is not commissioned, so this refuses to deploy.\n` +
    `  still placeholder: ${placeholders.join(", ")}\n\n` +
    `  Provision Boss OS's OWN Cloudflare resources and put their ids in\n` +
    `  wrangler.toml under [env.production].\n` +
    `  Never reuse a West Peek id here.`
  );
}

say("1/4  applying migrations…");
try {
  const out = run("npx wrangler d1 migrations apply WP_OS_DB --env production --remote");
  const applied = [...out.matchAll(/│ (\d{4}_[a-z_]+\.sql)\s+│ ✅/g)].map((m) => m[1]);
  say(applied.length ? `     applied: ${applied.join(", ")}` : "     nothing to apply");
} catch (err) {
  die(`migration apply failed:\n${err.stdout ?? err.message}`);
}

say("2/4  verifying no migrations are pending…");
const list = run("npx wrangler d1 migrations list WP_OS_DB --env production --remote");
if (!/No migrations to apply/i.test(list)) {
  // The whole reason this script exists. A pending migration here means the next step would ship
  // code against a schema that does not have what it needs.
  die(`migrations are STILL pending after apply — refusing to deploy code against a stale schema:\n${list}`);
}
say("     clean");

say("3/4  building and deploying…");
try {
  run("npm run build");
  const out = run("npx wrangler deploy --env production");
  const version = out.match(/Current Version ID:\s*([0-9a-f-]+)/)?.[1];
  say(`     deployed ${version ?? "(version id not reported)"}`);
} catch (err) {
  die(`deploy failed:\n${err.stdout ?? err.message}`);
}

/*
 * STEP 4 USED TO BE DECORATION. Its catch printed "check manually" and fell through to a final
 * line that said "deployed and verified" regardless - so a deploy whose health check never
 * connected reported success in the same words as one that passed. Observed on the first real
 * deploy of this repo, 5 Sep 2026: the custom domain's certificate was still issuing, curl
 * returned nothing, and the script congratulated itself.
 *
 * A verification that cannot fail is not a verification. It retries, because a freshly created
 * custom domain legitimately takes a minute to serve TLS, and then it either passes or the
 * script exits non-zero saying which.
 */
say("4/4  verifying the worker answers…");
const HOST = "boss.sequoiataylor.com";
const HEALTH = `https://${HOST}/api/health`;

/*
 * RESOLVED THROUGH A PUBLIC RESOLVER, NOT THIS MACHINE'S.
 *
 * The first deploy of a new custom domain creates the DNS record moments after the operator's
 * resolver has already cached a miss for that name. `dig` saw the record and `curl` said "could
 * not resolve host" for several minutes afterwards - so a check that trusts the local resolver is
 * testing the laptop, not the deployment. It asks 1.1.1.1 and pins the answer with --resolve, and
 * falls back to ordinary resolution if that lookup fails.
 */
let health = null;
for (let attempt = 1; attempt <= 6; attempt++) {
  let pin = "";
  try {
    const ip = run(`dig +short ${HOST} @1.1.1.1`).trim().split("\n").filter((l) => /^\d+\./.test(l))[0];
    if (ip) pin = `--resolve ${HOST}:443:${ip}`;
  } catch {
    pin = "";
  }
  try {
    health = run(`curl -s ${pin} -o /dev/null -w "%{http_code}" --max-time 20 ${HEALTH}`).trim();
  } catch {
    health = "000";
  }
  // 302 is correct and expected where Cloudflare Access fronts the Worker: it redirects an
  // unauthenticated probe to its login. A 5xx means the Worker is up and broken.
  if (health === "200" || health === "302") break;
  if (attempt < 6) {
    say(`     HTTP ${health} — not answering yet, retrying (${attempt}/5)`);
    run(`sleep 20`);
  }
}
if (health === "200" || health === "302") {
  say(`     ok (HTTP ${health})`);
} else {
  die(
    `the Worker deployed but ${HEALTH} never answered (last: HTTP ${health}).\n` +
    `  A new custom domain can take a few minutes to serve TLS. This already resolves through\n` +
    `  1.1.1.1 rather than trusting the local resolver, so a failure here is the edge, not DNS.\n` +
    `  The code IS deployed. This is a failed verification, not a failed deploy.`,
  );
}

say("\n✓ deployed and verified");
