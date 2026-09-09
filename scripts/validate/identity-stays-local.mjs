#!/usr/bin/env node
/**
 * SHE MAY SEE WHO THESE PEOPLE ARE. THE CLOUD MAY NOT.
 *
 * ─── What changed on 9 September 2026, and what must not ───────────────────
 *
 * The browser-side resolver is gone, because the People tab it served is gone: "i dont like this
 * people tab at all id rather just scrap it. id rather monique just send me deliverables she
 * suggests about people to speak to (no codenames needed)".
 *
 * THE IDENTITY BOUNDARY DID NOT MOVE — the place identities are resolved did. It is now
 * `scripts/ops/people-worth-a-call.mjs`, which reads her own extraction on her own Mac, writes real
 * names into an email to herself, and posts nothing but counts back to the Worker. That is a
 * STRONGER position than a browser resolver, not a weaker one: the names never enter a page that
 * also holds an api client.
 *
 * The three rules, restated for where the work actually happens now:
 *
 *   1. `POST /relationships/sync` STILL REFUSES an '@' or a '.' in a code name. That guard caught a
 *      real leak on its first run and nothing here is a reason to relax it by a character.
 *   2. THE RECOMMENDER NEVER POSTS A NAME. `people-worth-a-call.mjs` may talk to the Worker — it
 *      posts the notice — so "no fetch" is the wrong test for it. The right test is that no name,
 *      address or pick reaches a Boss OS URL: the notice payload is counts and prose it composes
 *      itself, and the picks go only to Resend.
 *   3. NOTHING RESOLVED IS SENT ANYWHERE FROM THE CLIENT. No file under `src/client` may pass a
 *      resolved identity into an api call.
 *
 * RULE 0: it exits non-zero if the recommender or the sync guard is missing, because a scan that
 * cannot find the thing it governs is broken rather than satisfied.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

const RESOLVER = "scripts/ops/people-worth-a-call.mjs";
const SYNC = "src/worker/boss/routes/relationships.ts";

/** The guard on the wire, in the exact shape it has to keep. */
const SYNC_GUARD = /name\.includes\("@"\)\s*\|\|\s*name\.includes\("\."\)/;

/**
 * A name or an address handed to a Boss OS URL.
 *
 * NOT "does it call fetch" — the recommender legitimately posts a notice to the Worker, so a blanket
 * network ban would have to be switched off, and a validator that has to be switched off is a
 * validator nobody trusts. What matters is the SHAPE of what goes: any request whose body reaches
 * for a pick, a name or an email address is the leak, and everything else is counts.
 */
const POSTS_A_NAME = /body:\s*JSON\.stringify\((?:(?!\)\s*,)[\s\S]){0,600}?\b(p\.name|p\.email|picks|contacts|\bnames\b)\b/;

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
    /*
     * ONLY THE REQUESTS AIMED AT BOSS OS ARE JUDGED. The Resend call in this file carries every real
     * name deliberately: it is her own mailbox, on her own machine, and that is the entire point of
     * the deliverable. Scanning it as one undifferentiated file would either pass everything or fail
     * the feature, so the scan splits on where the request is going.
     */
    for (const block of resolverSrc.split(/await fetch\(/).slice(1)) {
      const target = block.slice(0, 200);
      const isBossOs = /ORIGIN|boss\.sequoiataylor|\/api\/boss/.test(target);
      if (!isBossOs) continue;
      if (POSTS_A_NAME.test(block.slice(0, 1200))) {
        bad.push(
          `${RESOLVER} puts a name, an address or a pick into a request to Boss OS. ` +
          "The Worker learns counts and the prose it is handed; the names go to her mailbox and nowhere else.",
        );
      }
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
    [RESOLVER]: 'await fetch(`${ORIGIN}/api/boss/approvals`, { body: JSON.stringify({ title: "3 people", summary }) });\n'
      + 'await fetch("https://api.resend.com/emails", { body: JSON.stringify({ to, text: picks.map((p) => p.email).join("") }) });',
    [SYNC]: 'if (name.includes("@") || name.includes(".")) { throw badRequest("no"); }',
    "src/client/boss/pages/Leaky.tsx": "api.createPerson({ full_name: resolve(idMap, code).label })",
    LEAKY_RECOMMENDER: 'await fetch(`${ORIGIN}/api/boss/approvals`, { body: JSON.stringify({ title: t, picks }) });',
    "src/client/boss/pages/Fine.tsx": "<Named map={idMap} code={r.full_name} />",
  };
  const r = scan(["src/client/boss/pages/Leaky.tsx", "src/client/boss/pages/Fine.tsx"], (f) => fixtures[f] ?? "");
  const fail = [];
  if (!r.bad.some((x) => x.includes("Leaky.tsx"))) fail.push("a resolved name sent to the API was not caught");
  if (r.bad.some((x) => x.includes("Fine.tsx"))) fail.push("ordinary rendering was flagged");

  const weakened = scan([], (f) => (f === SYNC ? "no guard here at all" : fixtures[f] ?? ""));
  if (!weakened.bad.some((x) => x.includes("no longer refuses"))) fail.push("a weakened sync guard passed");

  const gone = scan([], () => "");
  if (!gone.bad.some((x) => x.includes("is missing"))) fail.push("a missing recommender passed");

  // THE ONE THAT MATTERS: names to Resend are fine, the same names to the Worker are not.
  if (r.bad.some((x) => x.includes(RESOLVER))) fail.push("names sent to her own mailbox were flagged");
  const leaks = scan([], (f) => (f === RESOLVER ? fixtures.LEAKY_RECOMMENDER : fixtures[f] ?? ""));
  if (!leaks.bad.some((x) => x.includes("into a request to Boss OS"))) fail.push("picks posted to the Worker passed");

  if (fail.length) {
    console.error("IDENTITY SELF-TEST FAILED:");
    for (const x of fail) console.error("  ✗", x);
    process.exit(1);
  }
  console.log("identity self-test: 6 fixtures — a leaked name, a weakened guard, a missing recommender, "
    + "picks posted to the Worker, and the legitimate Resend send left alone.");
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
const clientFiles = walk("src/client");
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
