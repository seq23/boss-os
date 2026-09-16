#!/usr/bin/env node
/**
 * THE HUNT WORKS FROM THE BOOK SHE FILED, NOT FROM A FILE SOMEBODY TYPED.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * Her live book has one way in: an email (or a console message) to Monique, parsed by the Worker
 * and stored versioned in D1. `capital-book.mjs --pull` mirrors it to `~/.boss-os/capital/book.json`
 * "so the buyer hunt on her Mac works from the same inventory". Measured on 15 September 2026:
 *
 *   - `buyer-hunt.mjs` and `filing-hunt.mjs` read `book.txt`, a file she typed on 10 September.
 *   - NOTHING read `book.json`. No mirror had ever been pulled on her machine.
 *   - The Tuesday launchd job hunted without pulling.
 *   - So the hunt ran on six lots that did not include the Databricks she filed on the 11th, and
 *     the question "please add searching for buyers of Databricks to the weekly list" sat on Today
 *     at HIGH for four days about a name that was already in her book.
 *
 * "SO D1 IS AUTHORITATIVE AND THE LOCAL FILE IS A MIRROR" was a sentence in a header. This is what
 * makes it a property of the code.
 *
 * ─── The rule ──────────────────────────────────────────────────────────────
 *
 *   1. Both hunts import the ONE mirror reader, `scripts/ops/lib/book-mirror.mjs`, and call it.
 *   2. The writer, `capital-book.mjs`, takes its paths from that same module — one home for the
 *      file, so writer and readers cannot disagree about where the book is.
 *   3. The installer's weekly buyers job pulls the mirror BEFORE either hunt runs.
 *   4. Neither hunt drops a sizeless lot. "size TBD — no size yet; I hunt buyers anyway" is a
 *      promise the intake makes in writing, and a `&& l.size_usd` filter would break it silently.
 *
 * RULE 0: a hunt file that cannot be read, or an installer with no buyers stanza, is a FAILURE.
 *
 *   node scripts/validate/the-hunt-reads-the-mirror.mjs
 *   node scripts/validate/the-hunt-reads-the-mirror.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HUNTS = ["scripts/ops/buyer-hunt.mjs", "scripts/ops/filing-hunt.mjs"];
const WRITER = "scripts/ops/capital-book.mjs";
const INSTALLER = "scripts/ops/install-agent-launchd.sh";
const MIRROR = "./lib/book-mirror.mjs";

export function findings(files) {
  const bad = [];
  for (const h of HUNTS) {
    const src = files[h];
    if (!src) { bad.push(`${h}: unreadable`); continue; }
    if (!src.includes(MIRROR)) bad.push(`${h}: does not import ${MIRROR}`);
    if (!/mirrorOrStop\(\)/.test(src)) bad.push(`${h}: never calls mirrorOrStop()`);
    if (/\.side === HER_SIDE && l(?:ot)?\.size_usd\)/.test(src) || /p\.side === HER_SIDE && p\.size_usd\)/.test(src)) {
      bad.push(`${h}: drops sizeless lots (filters on size_usd)`);
    }
  }
  const w = files[WRITER] ?? "";
  if (!w.includes(MIRROR)) bad.push(`${WRITER}: does not take its paths from ${MIRROR}`);
  const sh = files[INSTALLER] ?? "";
  const buyers = /<string>([^<]*duty-run\.sh buyer-hunt\.mjs[^<]*)<\/string>/.exec(sh);
  if (!buyers) bad.push(`${INSTALLER}: no buyers stanza runs duty-run.sh buyer-hunt.mjs`);
  else {
    const cmd = buyers[1];
    const pull = cmd.indexOf("capital:book -- --pull");
    const hunt = Math.min(...["filing-hunt.mjs", "buyer-hunt.mjs", "capital:hunts"].map((t) => (cmd.indexOf(t) === -1 ? Infinity : cmd.indexOf(t))));
    if (pull === -1) bad.push(`${INSTALLER}: the buyers job never pulls the mirror (capital:book -- --pull)`);
    else if (pull > hunt) bad.push(`${INSTALLER}: the buyers job pulls the mirror AFTER hunting`);
  }
  return bad;
}

function load() {
  const files = {};
  for (const f of [...HUNTS, WRITER, INSTALLER]) {
    try { files[f] = readFileSync(join(ROOT, f), "utf8"); } catch { files[f] = null; }
  }
  return files;
}

function run() {
  const bad = findings(load());
  if (bad.length) {
    console.error("FAIL: the hunt and the book she filed are two lists again:");
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log(`OK: ${HUNTS.length} hunts read the mirror through ${MIRROR}, the writer shares its paths, the weekly job pulls before it hunts, and sizeless lots are hunted.`);
}

function selfTest() {
  const real = load();
  if (findings(real).length) { console.error("self-test: the real tree should pass"); process.exit(1); }

  // The 15 September state: hunts read book.txt, nothing read the mirror, the job did not pull.
  const before = { ...real };
  before["scripts/ops/buyer-hunt.mjs"] = real["scripts/ops/buyer-hunt.mjs"]
    .replace(`import { mirrorOrStop } from "${MIRROR}";`, "")
    .replace("mirrorOrStop()", "null")
    .replace("filter((p) => p.side === HER_SIDE)", "filter((p) => p.side === HER_SIDE && p.size_usd)");
  before[INSTALLER] = real[INSTALLER].replace("npm run --silent capital:book -- --pull; ", "");
  const f = findings(before);
  const expect = ["does not import", "never calls", "drops sizeless", "never pulls"];
  for (const e of expect) {
    if (!f.some((b) => b.includes(e))) { console.error(`self-test: expected a finding containing "${e}", got ${JSON.stringify(f)}`); process.exit(1); }
  }
  // A pull that runs after the hunt is the same defect with better manners.
  const late = { ...real, [INSTALLER]: real[INSTALLER].replace("npm run --silent capital:book -- --pull; ", "").replace("capital:buyers -- --send</string>", "capital:buyers -- --send; npm run --silent capital:book -- --pull</string>") };
  if (!findings(late).some((b) => b.includes("AFTER hunting"))) { console.error("self-test: a late pull must be caught"); process.exit(1); }
  // An unreadable hunt is Rule 0.
  if (!findings({ ...real, "scripts/ops/buyer-hunt.mjs": null }).some((b) => b.includes("unreadable"))) { console.error("self-test: an unreadable hunt must fail"); process.exit(1); }
  console.log("self-test OK: the real tree passes; the 15 September state, a late pull and an unreadable hunt each fail.");
}

if (process.argv.includes("--self-test")) selfTest(); else run();
