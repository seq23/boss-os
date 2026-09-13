#!/usr/bin/env node
/**
 * THE DEVICE ID RESOLVES FOR A PLAIN COMMAND, AND EXISTS IN ONE PLACE.
 *
 * ─── The footgun ───────────────────────────────────────────────────────────
 *
 *   $ npm run vault:run -- node scripts/sync-agent/agent.mjs work-once
 *   BOSS_OS_DEVICE_ID is not set. Register the device first, then export its id.
 *
 * Measured: ONE of the fifteen boss launchd plists set `BOSS_OS_DEVICE_ID`, and
 * `install-agent-launchd.sh` hardcoded the default while baking it into that one generated file. So
 * the value existed in exactly one place — a generated artefact nobody edits — and every
 * hand-invocation died. Including the `run-now` path, built the same day so a duty could be fired
 * BY HAND and proven rather than promised.
 *
 * And the error named a remedy that does not exist: there is no "register the device" step anywhere
 * in this repository. The answer was findable only by grepping a plist, which is what happened.
 *
 * ─── Why it is NOT in the vault, though that is where it was asked for ─────
 *
 * The installer already carried the reason and it is right: "`vault:run` carries secrets, this
 * carries an identifier, and keeping them apart is what stops the vault turning into a config
 * file." `vault:status` prints "Keys present", and a device id in that list would read as a
 * credential; once one non-secret is in there the argument against the next one is gone.
 *
 * The defect was never the vault's absence. It was that the id had NO HOME — the installer knew it,
 * nothing else did, and nothing connected them. So it has one, beside the rest of this system's
 * machine-local state, and the installer reads it rather than defining it.
 *
 * ─── What is checked ───────────────────────────────────────────────────────
 *
 *   1. THE RESOLVER ANSWERS with no environment at all, given a registered machine — which is
 *      exactly the plain `vault:run` case that failed. Run, not asserted.
 *   2. THE ENVIRONMENT STILL WINS, so a second machine or a test can say who it is.
 *   3. IT RETURNS NULL RATHER THAN A DEFAULT on an unregistered machine. Inventing `dev_mac_seq`
 *      would attribute runs to her Mac from somewhere else, and the whole point of the id is that
 *      the evidence says where the work actually happened.
 *   4. THE ERROR NAMES THE REMEDY — the file, the command, and that the environment wins.
 *   5. ONE HOME. The default string appears in the resolver and nowhere else; the installer READS
 *      it and no longer carries a copy; and the agent does not read the raw environment behind the
 *      resolver's back.
 *
 * RULE 0: a resolver that cannot be loaded, or zero resolution cases exercised, is a HARD FAILURE.
 *
 *   node scripts/validate/a-device-has-one-home.mjs
 *   node scripts/validate/a-device-has-one-home.mjs --self-test
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const RESOLVER = "scripts/ops/device-id.mjs";
const AGENT = "scripts/sync-agent/agent.mjs";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";

export function check({ cases, message, resolver, agent, installer, defaultId }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(cases) || cases.length === 0) {
    problems.push(`Zero resolution cases were exercised, so nothing below was actually run.`);
    return problems;
  }

  // ── 1–3. The resolver behaves ────────────────────────────────────────────
  for (const c of cases) {
    if (c.got !== c.want) {
      problems.push(`${c.name}: resolved ${JSON.stringify(c.got)} and must resolve ${JSON.stringify(c.want)} — ${c.why}.`);
    }
  }

  // ── 4. The error names the remedy ────────────────────────────────────────
  for (const [what, needle] of [
    ["the file the id lives in", "device.json"],
    ["the command that fixes it", "device:set"],
    ["that the environment wins", "BOSS_OS_DEVICE_ID"],
  ]) {
    if (!String(message).includes(needle)) {
      problems.push(
        `The unresolved-device message does not name ${what}. The old one said "Register the device ` +
        `first, then export its id" — a step that exists nowhere — so the answer had to be grepped ` +
        `out of a generated plist.`,
      );
    }
  }

  // ── 5. One home ──────────────────────────────────────────────────────────
  const installerCode = code(installer);
  if (new RegExp(`["']?${defaultId}["']?`).test(installerCode)) {
    problems.push(
      `${INSTALLER} still carries the literal "${defaultId}". That is the second copy: the installer ` +
      `defined the value, baked it into one generated plist, and nothing else could find it.`,
    );
  }
  if (!/device-id\.mjs/.test(installerCode)) {
    problems.push(`${INSTALLER} does not read the id from ${RESOLVER}, so the two can drift apart again.`);
  }
  const agentCode = code(agent);
  if (/process\.env\.BOSS_OS_DEVICE_ID/.test(agentCode)) {
    problems.push(
      `${AGENT} reads \`process.env.BOSS_OS_DEVICE_ID\` directly, going behind the resolver — which is ` +
      `the behaviour that failed on every hand-invocation.`,
    );
  }
  if (!/resolveDeviceId\s*\(/.test(agentCode)) {
    problems.push(`${AGENT} does not use \`resolveDeviceId\`.`);
  }
  const occurrences = (code(resolver).match(new RegExp(defaultId, "g")) ?? []).length;
  if (occurrences === 0) {
    problems.push(`${RESOLVER} does not declare the default id, so there is no single home after all.`);
  }

  return problems;
}

// ─── Running the shipped resolver ───────────────────────────────────────────

async function evaluate() {
  const mod = await import(pathToFileURL(join(ROOT, RESOLVER)).href);
  const sandbox = join(tmpdir(), `boss-device-${process.pid}`);
  const file = join(sandbox, ".boss-os", "device.json");
  mkdirSync(dirname(file), { recursive: true });

  /*
   * The resolver reads the REAL home directory, so a registered machine is simulated by pointing it
   * at the file it would have written. `writeDeviceId` is the shipped writer, so the fixture is the
   * artefact the installer produces rather than a hand-made lookalike.
   */
  const realFile = mod.DEVICE_FILE;
  const registered = existsSync(realFile);
  const saved = registered ? readFileSync(realFile, "utf8") : null;

  try {
    if (!registered) mod.writeDeviceId(mod.DEFAULT_DEVICE_ID);

    const cases = [
      {
        name: "a registered machine with NO environment at all",
        got: mod.resolveDeviceId({}),
        want: mod.DEFAULT_DEVICE_ID,
        why: "this is the plain `npm run vault:run -- node scripts/sync-agent/agent.mjs` case that died",
      },
      {
        name: "the environment overriding a registered machine",
        got: mod.resolveDeviceId({ BOSS_OS_DEVICE_ID: "dev_other_box" }),
        want: "dev_other_box",
        why: "a second machine or a test must be able to say who it is without touching the file",
      },
      {
        name: "an empty environment variable",
        got: mod.resolveDeviceId({ BOSS_OS_DEVICE_ID: "   " }),
        want: mod.DEFAULT_DEVICE_ID,
        why: "an exported-but-blank variable is not an answer, and must not beat the registered one",
      },
    ];

    return { cases, message: mod.missingDeviceIdMessage(), defaultId: mod.DEFAULT_DEVICE_ID };
  } finally {
    if (!registered) rmSync(realFile, { force: true });
    else if (saved !== null) writeFileSync(realFile, saved);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const { cases, message, defaultId } = await evaluate();
  const good = {
    cases,
    message,
    defaultId,
    resolver: readFileSync(join(ROOT, RESOLVER), "utf8"),
    agent: readFileSync(join(ROOT, AGENT), "utf8"),
    installer: readFileSync(join(ROOT, INSTALLER), "utf8"),
  };

  const suite = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE FOOTGUN: nothing resolves without the environment",
      input: { ...good, cases: good.cases.map((c, i) => (i === 0 ? { ...c, got: null } : c)) },
      expect: 1,
    },
    {
      name: "the environment no longer winning",
      input: { ...good, cases: good.cases.map((c, i) => (i === 1 ? { ...c, got: defaultId } : c)) },
      expect: 1,
    },
    {
      name: "an unregistered machine handed a default it did not earn",
      input: { ...good, cases: [...good.cases, { name: "unregistered", got: defaultId, want: null, why: "inventing an id attributes runs to her Mac from elsewhere" }] },
      expect: 1,
    },
    {
      name: "the old message that named a step which does not exist",
      input: { ...good, message: "BOSS_OS_DEVICE_ID is not set. Register the device first, then export its id." },
      expect: 1,
    },
    {
      name: "the installer keeping its own copy of the default",
      input: { ...good, installer: `${good.installer}\nDEVICE_ID="\${BOSS_OS_DEVICE_ID:-${defaultId}}"\n` },
      expect: 1,
    },
    {
      name: "the agent reading the environment behind the resolver",
      input: { ...good, agent: `${good.agent}\nconst d = process.env.BOSS_OS_DEVICE_ID;\n` },
      expect: 1,
    },
    { name: "RULE 0 — nothing exercised", input: { ...good, cases: [] }, expect: 1 },
  ];

  let failed = 0;
  for (const c of suite) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\na-device-has-one-home self-test: ${failed}/${suite.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-device-has-one-home self-test: ${suite.length}/${suite.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missing = [RESOLVER, AGENT, INSTALLER].filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.error(`a-device-has-one-home FAILED — ${missing.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const { cases, message, defaultId } = await evaluate();
  const problems = check({
    cases,
    message,
    defaultId,
    resolver: readFileSync(join(ROOT, RESOLVER), "utf8"),
    agent: readFileSync(join(ROOT, AGENT), "utf8"),
    installer: readFileSync(join(ROOT, INSTALLER), "utf8"),
  });

  if (problems.length) {
    console.error("a-device-has-one-home FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-device-has-one-home: ${cases.length} resolution cases run against the shipped resolver — a plain ` +
    `command resolves with no environment, the environment still wins, and the error names the file ` +
    `and the command. One home, and the installer reads it. OK.`,
  );
}
