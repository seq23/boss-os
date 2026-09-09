#!/usr/bin/env node
/**
 * SHE MAY SEE WHO THESE PEOPLE ARE. THE CLOUD MAY NOT.
 *
 * ─── What changed, and what must not ───────────────────────────────────────
 *
 * The People tab now resolves code names to real identities in the browser on her Mac, from the file
 * `contacts-sync.mjs` writes. That is a deliberate reading of the privacy boundary: it governs WHAT
 * LEAVES HER MACHINE, not what she is allowed to see on her own screen. She is the one person who
 * already knows every one of these identities, and a screen showing her pseudonyms of her own
 * contacts protected nothing — it was simply unreadable.
 *
 * The rule that must survive that change, exactly as strong as before:
 *
 *   1. `POST /relationships/sync` STILL REFUSES an '@' or a '.' in a code name. That guard caught a
 *      real leak on its first run and is not to be weakened by a character.
 *   2. THE RESOLVER NEVER TALKS TO THE NETWORK. `identity.ts` holds no fetch, no api import, and no
 *      POST. Resolution is a rendering step.
 *   3. NOTHING RESOLVED IS SENT ANYWHERE. No client file may pass a resolved identity into an api
 *      call — the one shape that would turn a rendering convenience into the leak the whole design
 *      exists to prevent.
 *
 * RULE 0: it exits non-zero if the resolver or the sync guard is missing, because a scan that cannot
 * find the thing it governs is broken rather than satisfied.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

const RESOLVER = "src/client/boss/identity.ts";
const SYNC = "src/worker/boss/routes/relationships.ts";

/** The guard on the wire, in the exact shape it has to keep. */
const SYNC_GUARD = /name\.includes\("@"\)\s*\|\|\s*name\.includes\("\."\)/;

/** Anything that would carry a value out of the browser. */
const NETWORKY = /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|from "\.\.?\/api"|from "\.\/api"/;

/** A resolved identity handed to an api call — the one shape that turns rendering into leaking. */
const SENDS_RESOLVED = /api\.[a-zA-Z]+\([^)]*\b(resolve\(|\.by_code|identityMap|idMap)\b/;

function scan(files, read) {
  const bad = [];
  let examined = 0;

  const resolverSrc = read(RESOLVER);
  if (!resolverSrc) {
    bad.push(`${RESOLVER} is missing — the resolver this scan governs does not exist.`);
  } else {
    examined += 1;
    if (NETWORKY.test(resolverSrc)) {
      bad.push(`${RESOLVER} can reach the network. Resolution is a rendering step and must never send anything.`);
    }
  }

  const syncSrc = read(SYNC);
  if (!syncSrc) {
    bad.push(`${SYNC} is missing — the guard that refuses a real address on the wire cannot be checked.`);
  } else {
    examined += 1;
    if (!SYNC_GUARD.test(syncSrc)) {
      bad.push(
        `${SYNC} no longer refuses a code name containing '@' or '.'. That guard caught a real leak on ` +
        "its first run and letting the browser show names is not a reason to relax it.",
      );
    }
  }

  for (const f of files) {
    const src = read(f);
    if (!src) continue;
    examined += 1;
    if (SENDS_RESOLVED.test(src)) {
      bad.push(`${f} passes a resolved identity into an API call. Names stay in the browser.`);
    }
  }

  return { bad, examined };
}

if (SELF_TEST) {
  const fixtures = {
    [RESOLVER]: "export function resolve(map, code) { return map.by_code[code]; }",
    [SYNC]: 'if (name.includes("@") || name.includes(".")) { throw badRequest("no"); }',
    "src/client/boss/pages/Leaky.tsx": "api.createPerson({ full_name: resolve(idMap, code).label })",
    "src/client/boss/pages/Fine.tsx": "<Named map={idMap} code={r.full_name} />",
  };
  const r = scan(["src/client/boss/pages/Leaky.tsx", "src/client/boss/pages/Fine.tsx"], (f) => fixtures[f] ?? "");
  const fail = [];
  if (!r.bad.some((x) => x.includes("Leaky.tsx"))) fail.push("a resolved name sent to the API was not caught");
  if (r.bad.some((x) => x.includes("Fine.tsx"))) fail.push("ordinary rendering was flagged");

  const weakened = scan([], (f) => (f === SYNC ? "no guard here at all" : fixtures[f] ?? ""));
  if (!weakened.bad.some((x) => x.includes("no longer refuses"))) fail.push("a weakened sync guard passed");

  const gone = scan([], () => "");
  if (!gone.bad.some((x) => x.includes("is missing"))) fail.push("a missing resolver passed");

  if (fail.length) {
    console.error("IDENTITY SELF-TEST FAILED:");
    for (const x of fail) console.error("  ✗", x);
    process.exit(1);
  }
  console.log("identity self-test: 4 fixtures, the scan catches a leaked name, a weakened guard and a missing resolver.");
  process.exit(0);
}

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : null);
const clientFiles = walk("src/client").filter((f) => f !== RESOLVER);
const { bad, examined } = scan(clientFiles, read);

if (examined === 0) {
  console.error("IDENTITY SCAN EXAMINED NOTHING. The client tree has moved; that is a broken scan.");
  process.exit(2);
}

if (bad.length) {
  console.error("A NAME WENT SOMEWHERE IT MUST NOT:");
  for (const x of bad) console.error("  ✗", x);
  process.exit(1);
}

console.log(`identity stays local: ${examined} file(s) examined, the sync guard intact, 0 names on the wire.`);
