#!/usr/bin/env node
/**
 * AN OPERATIONAL SCRIPT MUTATES THIS REPOSITORY'S APPLICATION AND NO OTHER.
 *
 * ─── The incident, reproduced ───────────────────────────────────────────────────────────────────
 *
 * `npm run vault:sync:cloudflare` was run from this repository on 17 September 2026 and wrote EIGHT
 * SECRETS to the Cloudflare Worker `west-peek-os` — a different business's live application — and
 * printed "Cloudflare secret sync complete." `scripts/vault/cloudflare-mapping.json` carried
 * `"worker_name": "west-peek-os"`, and the line that read it had the same string as its fallback,
 * so there was no value of that file that could have targeted this repository.
 *
 * The same run silently skipped ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY and
 * PERPLEXITY_API_KEY, because a key the mapping had never heard of was simply not iterated. A
 * person provisioning Boss OS therefore got no provider credentials here AND mutated somebody
 * else's app, and both halves reported success.
 *
 * ─── Why the existing scan could not see it ─────────────────────────────────────────────────────
 *
 * `no-cross-repo-coupling.mjs` proves the same property and reads `src/` ONLY. Every operational
 * script in this repository is outside it, and operational scripts are the files that actually
 * perform effects against remote infrastructure. The boundary was enforced where nothing deploys
 * and unenforced where everything does. This scan is that gap, closed.
 *
 * The standing rule it enforces: Boss OS carries West Peek chassis code BY COPY AND DIVERGE —
 * never import, never extend, and never write to.
 *
 * ─── What is checked ────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE SYNC TARGET IS DERIVED FROM wrangler.toml, not typed into a JSON file. One statement of
 *      one fact; a mapping that DECLARES a different name is a hard failure, not a preference.
 *   2. NO OPERATIONAL SCRIPT NAMES A FOREIGN CLOUDFLARE APPLICATION AS A TARGET. The vault's own
 *      custody path and keychain service are exempt BY NAME and with a reason: the vault is one
 *      store on her machine shared by both repositories, and reading a secret out of it is not
 *      writing to another application.
 *   3. THE ALLOWLIST CANNOT SILENTLY OMIT. The sync classifies every key the vault holds — synced,
 *      or deliberately not with a written reason — and aborts naming anything in neither.
 *   4. EVERY not_synced ENTRY CARRIES A REASON. An exclusion with no reason is an oversight with a
 *      name.
 *   5. THE PROVIDER KEYS ARE ACTUALLY SYNCED. The four that were silently skipped are named here,
 *      so the specific regression cannot return quietly.
 *
 * RULE 0: zero scripts scanned, or zero mapped keys, is a HARD FAILURE.
 *
 *   node scripts/validate/an-operational-script-writes-to-this-repos-worker.mjs
 *   node scripts/validate/an-operational-script-writes-to-this-repos-worker.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeployTarget } from "../vault/deploy-target.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = join(ROOT, "scripts");
const MAPPING = "scripts/vault/cloudflare-mapping.json";
const VAULT = "scripts/vault/vault.mjs";

/** Applications that are NOT this one. Naming them is how the refusal stays specific. */
const FOREIGN_APPS = ["west-peek-os", "west-peek-network-os", "agency-event-os", "wp-os"];

/**
 * THE VAULT IS ONE STORE ON HER MACHINE AND BOTH REPOSITORIES READ IT.
 *
 * `~/.west-peek-os/vault` and the keychain service `west-peek-os-vault` are where the encrypted
 * secrets live, historically named after the repository that created the vault. READING a secret
 * out of a shared store is not writing to another application, which is the thing this scan exists
 * to prevent — so these strings are exempt, by pattern, with this reason written down. Renaming
 * them would invalidate every secret she currently holds.
 */
const SHARED_CUSTODY = [/\.west-peek-os/, /west-peek-os-vault/];

/**
 * ─── WHAT A VIOLATION LOOKS LIKE, AND WHY IT IS NOT "THE NAME APPEARS" ─────────────────────────
 *
 * `no-cross-repo-coupling.mjs` already settled this question for `src/`: NAMING A REPOSITORY IN
 * ORDER TO REFUSE IT IS THE OPPOSITE OF COUPLING, and an exclusion that is only an absence gets
 * picked up again by the next scope that says "all her repos". Half this repository's scans name
 * West Peek by hand, deliberately, to exclude it.
 *
 * So the test is not the name. It is the name ON A LINE THAT PERFORMS A REMOTE EFFECT — a
 * Cloudflare API path, a wrangler invocation, a deploy or a remote D1 execution. That is the shape
 * the confirmed defect actually had: a PUT to
 * `api.cloudflare.com/.../workers/scripts/west-peek-os/secrets`.
 */
const REMOTE_EFFECT = /api\.cloudflare\.com|workers\/scripts\/|wrangler\s|--name\b|d1\s+execute|deploy\b/;

/**
 * `scripts/validate/` IS EXEMPT AS A DIRECTORY, with the same reasoning and one more fact: a
 * validator performs no effects. Its whole job is to name what must not happen, and every scan in
 * there that mentions West Peek does so inside a refusal, a fixture or an explanation of an
 * incident. Including them would mean this scan fails on the sentence describing the bug it exists
 * to catch. The files that DO reach infrastructure — scripts/ops, scripts/vault, scripts/deploy —
 * are all still scanned, and the count below is what proves it examined them.
 */
const EXEMPT_DIR = "scripts/validate/";

/** Keys whose silent omission is the confirmed regression. Named so it cannot come back quietly. */
const MUST_SYNC = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|js|sh|json)$/.test(entry)) out.push(full);
  }
  return out;
}

export function check({ scripts, mapping, wrangler, vaultSource }) {
  const bad = [];

  // ── RULE 0 ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(scripts) || scripts.length === 0) {
    return ["no operational scripts were scanned, so every rule below passed over nothing"];
  }
  if (!mapping || !Array.isArray(mapping.secret_names) || mapping.secret_names.length === 0) {
    return ["the Cloudflare sync mapping is missing or names no secrets, so nothing was classified"];
  }

  // ── 1. The target is derived, and the declaration agrees ───────────────────
  const target = parseDeployTarget(wrangler);
  if (!target) {
    bad.push("wrangler.toml has no [env.production] name, so there is no deploy target to check a sync against");
  } else if (mapping.worker_name && mapping.worker_name !== target) {
    bad.push(
      `${MAPPING} names worker "${mapping.worker_name}" and wrangler.toml [env.production] deploys "${target}". ` +
      `One of these is another application. This is the confirmed defect: the mapping said west-peek-os and ` +
      `eight secrets went there.`,
    );
  }
  if (!/deployTargetWorkerName\(\)/.test(vaultSource)) {
    bad.push(
      `${VAULT} does not derive its target from wrangler.toml. A worker name typed into a JSON file is a second ` +
      `statement of a fact the deploy config already owns, and two statements are how they came to disagree.`,
    );
  }
  if (/const workerName = mapping\.worker_name \?\?/.test(vaultSource)) {
    bad.push(`${VAULT} still falls back to a hardcoded worker name, so a missing mapping picks a target by default`);
  }

  // ── 2. No script names a foreign application as a target ───────────────────
  const effectful = scripts.filter((s) => !s.path.startsWith(EXEMPT_DIR));
  if (effectful.length === 0) {
    return ["every script was exempt, so the one rule that matters here examined nothing"];
  }
  for (const { path, text } of effectful) {
    for (const raw of text.split("\n")) {
      const line = raw.replace(/^\s*(\/\/|\*|\/\*|#).*$/, "");
      if (!line.trim()) continue;
      if (!REMOTE_EFFECT.test(line)) continue;
      if (SHARED_CUSTODY.some((re) => re.test(line))) continue;
      const hit = FOREIGN_APPS.find((app) => new RegExp(`\\b${app}\\b`).test(line));
      if (!hit) continue;
      bad.push(
        `${path} performs a remote effect against the foreign application "${hit}": ${line.trim().slice(0, 140)}. ` +
        `Boss OS carries West Peek chassis code by copy and diverge — it may never write to West Peek's own ` +
        `infrastructure.`,
      );
    }
  }

  // ── 3. The allowlist cannot silently omit ──────────────────────────────────
  if (!/const unclassified = held\.filter/.test(vaultSource)) {
    bad.push(
      `${VAULT} does not check the vault for keys the mapping never heard of. That omission is why this Worker ` +
      `had no provider credentials: four keys were in the vault, absent from the list, and never iterated.`,
    );
  }
  if (!/if \(unclassified\.length\) \{\s*fail\(/.test(vaultSource)) {
    bad.push(`${VAULT} computes an unclassified set and does not fail on it — a check that only reports`);
  }

  // ── 4. Every exclusion carries a reason ────────────────────────────────────
  const notSynced = mapping.not_synced ?? {};
  if (Object.keys(notSynced).length === 0) {
    bad.push(
      `${MAPPING} declares no not_synced list. Every key the vault holds has to be classified somewhere, and a ` +
      `list with nothing excluded means keys will be excluded by absence again.`,
    );
  }
  for (const [name, reason] of Object.entries(notSynced)) {
    if (typeof reason !== "string" || reason.trim().length < 12) {
      bad.push(`${MAPPING}: not_synced.${name} has no written reason`);
    }
    if (mapping.secret_names.includes(name)) {
      bad.push(`${MAPPING}: ${name} is both synced and not synced. The classification has to be one or the other.`);
    }
  }

  // ── 5. The four keys that were silently skipped ────────────────────────────
  for (const name of MUST_SYNC) {
    if (!mapping.secret_names.includes(name)) {
      bad.push(
        `${MAPPING} does not sync ${name}. It is set on the production Worker and it was silently skipped by the ` +
        `run that caused this scan to exist.`,
      );
    }
  }

  return bad;
}

// ─── Gathering ──────────────────────────────────────────────────────────────

function gather() {
  const scripts = walk(SCRIPTS).map((full) => ({
    path: relative(ROOT, full),
    text: readFileSync(full, "utf8"),
  }));
  const mappingPath = join(ROOT, MAPPING);
  const mapping = existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, "utf8")) : null;
  const wrangler = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const vaultSource = existsSync(join(ROOT, VAULT)) ? readFileSync(join(ROOT, VAULT), "utf8") : "";
  return { scripts, mapping, wrangler, vaultSource };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const good = gather();
  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    { name: "RULE 0: no scripts scanned", input: { ...good, scripts: [] }, expect: 1 },
    { name: "RULE 0: a mapping that names no secrets", input: { ...good, mapping: { secret_names: [] } }, expect: 1 },
    {
      name: "THE ACTUAL DEFECT: the mapping pointing at another business's Worker",
      input: { ...good, mapping: { ...good.mapping, worker_name: "west-peek-os" } },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a hardcoded worker-name fallback",
      input: {
        ...good,
        vaultSource: good.vaultSource.replace(
          "const workerName = deployTargetWorkerName();",
          'const workerName = mapping.worker_name ?? "west-peek-os";',
        ),
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a script writing to a foreign application",
      input: {
        ...good,
        scripts: [
          ...good.scripts,
          { path: "scripts/ops/oops.mjs", text: "await fetch(`https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/" + "west-peek-os" + "/secrets`);" },
        ],
      },
      expect: 1,
    },
    {
      name: "the shared vault custody path is NOT a violation",
      input: {
        ...good,
        scripts: [
          ...good.scripts,
          { path: "scripts/ops/reads.mjs", text: 'const dir = join(homedir(), ".west-peek-os", "vault");' },
        ],
      },
      expect: 0,
    },
    {
      name: "THE ACTUAL DEFECT: an allowlist that silently omits",
      input: { ...good, vaultSource: good.vaultSource.replace("const unclassified = held.filter", "const ignored = held.filter") },
      expect: 1,
    },
    {
      name: "an unclassified check that reports and does not fail",
      input: {
        ...good,
        vaultSource: good.vaultSource.replace("if (unclassified.length) {\n        fail(", "if (unclassified.length) {\n        console.warn("),
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: the four provider keys dropped from the list again",
      input: {
        ...good,
        mapping: { ...good.mapping, secret_names: good.mapping.secret_names.filter((n) => !n.startsWith("ANTHROPIC")) },
      },
      expect: 1,
    },
    {
      name: "an exclusion with no reason",
      input: { ...good, mapping: { ...good.mapping, not_synced: { ...good.mapping.not_synced, SOMETHING: "" } } },
      expect: 1,
    },
    {
      name: "a key classified both ways",
      input: {
        ...good,
        mapping: { ...good.mapping, not_synced: { ...good.mapping.not_synced, OPENAI_API_KEY: "contradicts the synced list" } },
      },
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found > 0;
    if (!ok) {
      failed++;
      console.error(`  ✘ ${c.name}: expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
      if (c.expect === 0) for (const p of check(c.input)) console.error(`      • ${p}`);
    }
  }
  if (failed) {
    console.error(`\noperational-script-target self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`operational-script-target self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const world = gather();
  const problems = check(world);
  if (problems.length) {
    console.error("OPERATIONAL SCRIPT TARGET SCAN FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  console.log(
    `OPERATIONAL SCRIPT TARGET OK — ${world.scripts.length} script(s) scanned, none naming another application as ` +
    `a target (${world.scripts.filter((s) => !s.path.startsWith(EXEMPT_DIR)).length} of them effectful, outside ` +
    `scripts/validate); the Cloudflare sync derives "${parseDeployTarget(world.wrangler)}" from wrangler.toml, classifies ` +
    `${world.mapping.secret_names.length} key(s) as synced and ${Object.keys(world.mapping.not_synced ?? {}).length} ` +
    `as deliberately held back with a reason each, and aborts by name on anything in neither.`,
  );
}
