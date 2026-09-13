import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/**
 * WHICH MACHINE THIS IS — resolved from one place, by everything that needs it.
 *
 * ─── The footgun this removes ──────────────────────────────────────────────
 *
 *   $ npm run vault:run -- node scripts/sync-agent/agent.mjs work-once
 *   BOSS_OS_DEVICE_ID is not set. Register the device first, then export its id.
 *
 * Measured: ONE of the fifteen boss launchd plists sets `BOSS_OS_DEVICE_ID`, and
 * `install-agent-launchd.sh` hardcoded the default `dev_mac_seq` while baking it into that one
 * generated file. So the value existed in exactly one place — a generated artefact nobody edits —
 * and every hand-invocation died. Including `run-now`, which had just been built so that a duty
 * could be fired BY HAND and proven rather than promised. The answer was findable only by grepping
 * a plist, and the error named a "register the device" step that does not exist anywhere.
 *
 * ─── Why this is NOT in the vault, despite being asked for there ────────────
 *
 * `install-agent-launchd.sh` already carried the reason, and it is right:
 *
 *   "THE DEVICE ID IS NOT A SECRET AND DOES NOT BELONG IN THE VAULT. It names which machine claimed
 *    a run so the evidence says where the work happened; anyone reading the audit log sees it
 *    anyway. `vault:run` carries secrets, this carries an identifier, and keeping them apart is
 *    what stops the vault turning into a config file."
 *
 * That boundary is worth more than the convenience. `vault:status` prints "Keys present" and a
 * device id in that list would read as a credential — and once one non-secret is in there, the
 * argument against the next one is gone.
 *
 * THE ACTUAL DEFECT WAS NEVER THE VAULT'S ABSENCE. It was that the id had no home at all: the
 * installer knew it, nothing else did, and nothing connected them. So it gets a home, next to the
 * other machine-local state this system already keeps — `~/.boss-os/capital`, `~/.boss-os/reports`,
 * `~/.boss-os/local.db` — and the installer READS it from there rather than defining it.
 *
 * ONE VALUE, ONE HOME, and the environment still wins so a second machine or a test can say who it
 * is without touching the file.
 */

export const DEVICE_FILE = join(homedir(), ".boss-os", "device.json");

/** The default for HER Mac, and the only place this string appears. */
export const DEFAULT_DEVICE_ID = "dev_mac_seq";

/** The one command that fixes an unresolved id. Quoted verbatim by every error that needs it. */
export const REMEDY = `npm run device:set -- <id>   (writes ${DEVICE_FILE}; defaults to ${DEFAULT_DEVICE_ID})`;

/**
 * The id for this machine, or null.
 *
 * NULL RATHER THAN A DEFAULT, deliberately. Inventing `dev_mac_seq` on a machine that never
 * registered would attribute runs to her Mac from somewhere else, and the whole point of the id is
 * that the evidence says where the work actually happened.
 */
export function resolveDeviceId(env = process.env) {
  const fromEnv = (env.BOSS_OS_DEVICE_ID ?? "").trim();
  if (fromEnv) return fromEnv;

  if (!existsSync(DEVICE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(DEVICE_FILE, "utf8"));
    const id = typeof parsed?.device_id === "string" ? parsed.device_id.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

/** Write the id to its one home. Used by the installer and by `npm run device:set`. */
export function writeDeviceId(id = DEFAULT_DEVICE_ID) {
  const value = String(id).trim() || DEFAULT_DEVICE_ID;
  mkdirSync(dirname(DEVICE_FILE), { recursive: true });
  writeFileSync(DEVICE_FILE, `${JSON.stringify({ device_id: value }, null, 2)}\n`);
  return value;
}

/**
 * The sentence an unresolved id produces.
 *
 * IT NAMES THE REMEDY, which the old one did not. "Register the device first, then export its id"
 * described a step that exists nowhere in this repository, so the only way forward was to grep a
 * generated plist — which is what actually happened.
 */
export function missingDeviceIdMessage() {
  return (
    "BOSS_OS_DEVICE_ID is not set and no device is registered on this machine.\n" +
    `  It lives in ${DEVICE_FILE}, next to the rest of this system's machine-local state.\n` +
    `  Fix: ${REMEDY}\n` +
    "  Or set BOSS_OS_DEVICE_ID for a single command; the environment always wins.\n" +
    "  It is NOT a secret and is deliberately not in the vault — it names which machine claimed a\n" +
    "  run, which anyone reading the audit log sees anyway."
  );
}

// ─── `npm run device:set` / `device:show` ────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("device-id.mjs")) {
  const [, , cmd, arg] = process.argv;
  if (cmd === "set") {
    console.log(`device id: ${writeDeviceId(arg ?? DEFAULT_DEVICE_ID)}  →  ${DEVICE_FILE}`);
  } else {
    const id = resolveDeviceId();
    if (!id) {
      console.error(missingDeviceIdMessage());
      process.exit(1);
    }
    console.log(id);
  }
}
