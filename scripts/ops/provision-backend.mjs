#!/usr/bin/env node
/**
 * Provision a cloud backend's provider and model rows into a REMOTE D1, from code.
 *
 * WHY THIS EXISTS RATHER THAN JUST CALLING THE ENDPOINT. `POST /api/models/provision/:backendId`
 * is the real provisioner and stays the only one the running system offers. It needs an owner
 * session, and BOSS_PASSCODE lives solely in Worker secret storage — not in the vault, not in
 * .dev.vars — so an operator at a terminal cannot reach it. This is the terminal's door to the
 * same act, for the case where the owner is not sitting in front of the Backends screen.
 *
 * IT READS `CLOUD_BACKENDS`, IT DOES NOT RESTATE IT. Every id, slug, price and context length is
 * bundled out of src/worker/boss/router/backends.ts, which is what keeps this from becoming a
 * second list that drifts from the first. The host in particular is never typed here and never
 * taken from an argument — that is what keeps the single OpenRouter egress-allowlist entry honest.
 *
 * WHAT IT WILL NOT DO: enable a disabled backend, touch a route default, or write a benchmark.
 * Models arrive `unbenchmarked` and cleared only to low risk, exactly as the endpoint leaves them,
 * so they can carry continuity work and cannot become a default without an approved promotion
 * card. Those gates are the owner's and this script does not stand in for her.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const backendId = process.argv[2];
const env = process.argv[3] ?? "production";
if (!backendId) {
  console.error("usage: node scripts/ops/provision-backend.mjs <backend_id> [wrangler_env]");
  process.exit(2);
}

const bundle = join(mkdtempSync(join(tmpdir(), "prov-")), "wiring.mjs");
await build({
  entryPoints: ["src/worker/boss/router/backends.ts"],
  bundle: true, format: "esm", platform: "neutral", outfile: bundle, logLevel: "silent",
});
const { WIRING_BY_BACKEND } = await import(bundle);

const def = WIRING_BY_BACKEND.get(backendId);
if (!def) {
  console.error(`No cloud backend wiring for "${backendId}". Known: ${[...WIRING_BY_BACKEND.keys()].join(", ")}`);
  process.exit(1);
}
if (!def.models.length) {
  console.error(`${def.providerName} has no model seeds, so there is nothing to provision.`);
  process.exit(1);
}

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? "NULL" : String(Number(v)));

const d1 = (args) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "boss-os", "--env", env, "--remote", ...args], {
    encoding: "utf8",
  });

/*
 * A DISABLED BACKEND IS OFF ON PURPOSE, and this refuses it for the same reason the endpoint does.
 * The check reads the live row rather than assuming one, so the refusal is about what is there.
 */
const raw = d1(["--json", "--command", `SELECT status FROM execution_backends WHERE id = ${q(backendId)};`]);
const status = JSON.parse(raw.slice(raw.indexOf("[")))[0]?.results?.[0]?.status;
if (!status) {
  console.error(`${backendId} is not in the registry on ${env}.`);
  process.exit(1);
}
if (status !== "enabled") {
  console.error(
    `${backendId} is "${status}" on ${env}, so it will not be provisioned.\n` +
      `Only an enabled backend may take work. Commission it first — Systems → Backends, or ` +
      `PATCH /api/backends/${backendId} with { status: "enabled", reason }.`,
  );
  process.exit(1);
}

/*
 * EVERY SLUG IS CHECKED AGAINST THE ACCOUNT BEFORE A ROW IS WRITTEN.
 *
 * A model row whose slug does not exist provisions perfectly and then fails at the first call,
 * which means the failure lands on whoever typed the first sentence rather than on the operator
 * who installed it. That is exactly how `@cf/meta/llama-3.1-8b-instruct` got seeded: a plausible
 * name for a build this account does not carry.
 *
 * IT HARD-FAILS WHEN IT CANNOT CHECK. A catalogue that comes back empty or unreadable is an
 * unanswered question, not a pass — treating it as one would restore the silence this exists to
 * end. Only Workers AI has a catalogue command; other providers are skipped by name, and say so.
 */
if (def.baseUrl === "binding:AI") {
  let catalogue = "";
  try {
    catalogue = execFileSync("npx", ["wrangler", "ai", "models"], { encoding: "utf8" });
  } catch (err) {
    console.error(`Could not read the Workers AI model catalogue, so no slug could be checked: ${err.message}`);
    process.exit(1);
  }
  const known = new Set(catalogue.match(/@cf\/[^\s│|]+/g) ?? []);
  if (!known.size) {
    console.error("`wrangler ai models` returned no model slugs. Refusing to provision unverified rows.");
    process.exit(1);
  }
  const missing = def.models.filter((m) => !known.has(m.slug));
  if (missing.length) {
    console.error(
      `These slugs are not in the account's catalogue, so they would fail at the first call:\n` +
        missing.map((m) => `  ${m.id}  ${m.slug}`).join("\n") +
        `\n\nFix them in src/worker/boss/router/backends.ts. Run \`npx wrangler ai models\` to see what exists.`,
    );
    process.exit(1);
  }
  console.log(`Checked ${def.models.length} slug(s) against the account catalogue: all present.\n`);
} else {
  console.log(`No catalogue command exists for ${def.providerName}, so its slugs are UNCHECKED.\n`);
}

const sql = [
  `INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled)`,
  `VALUES (${q(def.providerId)}, ${q(def.providerName)}, ${q(def.baseUrl)}, ${q(def.credential.name)}, 1);`,
  ...def.models.map(
    (m) =>
      `INSERT OR IGNORE INTO models (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k,` +
      ` context_tokens, enabled, privacy_class, capability_tier, benchmark_status, max_risk)` +
      ` VALUES (${q(m.id)}, ${q(def.providerId)}, ${q(m.slug)}, ${q(m.displayName)}, ${n(m.inMicros1k)},` +
      ` ${n(m.outMicros1k)}, ${n(m.contextTokens)}, 1, 'cloud', ${q(m.capabilityTier)}, 'unbenchmarked', 'low');`,
  ),
  // The endpoint audits, so this audits. A provisioning nobody can find later is one that has to be
  // inferred from the rows it left behind.
  `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail) VALUES (` +
    `${q(`aud_prov_${backendId}_${Date.now().toString(36)}`)}, ${n(Date.now())}, 'boss', 'ops',` +
    ` 'execution_backend', ${q(backendId)}, 'provisioned', ${q(
      JSON.stringify({
        provider_id: def.providerId,
        models: def.models.map((m) => m.id),
        via: "scripts/ops/provision-backend.mjs",
      }),
    )});`,
].join("\n");

const file = join(mkdtempSync(join(tmpdir(), "prov-sql-")), "provision.sql");
writeFileSync(file, sql);
console.log(`${sql}\n`);

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "boss-os", "--env", env, "--remote", "--file", file, "--yes"],
  { stdio: "inherit" },
);

console.log(
  `\nProvisioned ${def.providerName} on ${env}: ${def.models.length} model(s), unbenchmarked, cleared to low risk.\n` +
    `They can carry continuity work now. Becoming a route default still needs a benchmark and an approved card.`,
);
