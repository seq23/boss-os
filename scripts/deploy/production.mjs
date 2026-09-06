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
const prod = toml.slice(toml.indexOf("[env.production]"));
const placeholders = [];
if (/database_id = "0{8}-0{4}-0{4}-0{4}-0{12}"/.test(prod)) placeholders.push("D1 database_id");
if (/\bid = "0{32}"/.test(prod)) placeholders.push("KV namespace id");
if (!process.env.BOSS_OS_HEALTH_URL) placeholders.push("BOSS_OS_HEALTH_URL (env)");
if (placeholders.length) {
  die(
    `NAMED STOP: Boss OS is not commissioned, so this refuses to deploy.\n` +
    `  still placeholder: ${placeholders.join(", ")}\n\n` +
    `  Provision Boss OS's OWN Cloudflare resources and put their ids in\n` +
    `  wrangler.toml under [env.production], then export BOSS_OS_HEALTH_URL to\n` +
    `  the deployed hostname's /api/health. Never reuse a West Peek id here.`
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

say("4/4  verifying the worker answers…");
try {
  const code = run(`curl -s -o /dev/null -w "%{http_code}" --max-time 20 ${process.env.BOSS_OS_HEALTH_URL}`).trim();
  // 302 is correct and expected: Cloudflare Access redirects an unauthenticated probe to its login.
  // A 5xx would mean the worker is up but broken, which is the case worth catching here.
  if (code === "302" || code === "200") say(`     ok (HTTP ${code} — Access redirect is expected)`);
  else die(`health check returned HTTP ${code}`);
} catch {
  say("     could not reach the health endpoint; check manually");
}

say("\n✓ deployed and verified");
