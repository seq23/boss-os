#!/usr/bin/env node
/**
 * EVERY PLIST THE LAUNCHD INSTALLER WRITES IS A PROPERTY LIST LAUNCHD CAN PARSE.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * Tuesday 15 September 2026, 07:25 Central. `com.seq.boss-scooter-sheet` fired on schedule and
 * `duty_scooter_sheet` recorded:
 *
 *   bash: -c: line 0: syntax error near unexpected token `&'
 *   bash: -c: line 0: `npm run --silent lp:sync -- --commit &amp;& npm run --silent lp:outcomes -- --commit'
 *
 * The stanza wrote `&amp;&amp;` inside a `<string>` — correctly escaped — in a file whose OTHER
 * command line carried a bare `&&`. A bare ampersand is not XML. launchd's parser therefore read
 * the file leniently, and in that mode it decoded the escaped pair as `&amp;&`: half an entity,
 * handed to bash. The job installed, loaded, fired, and did no work, and the failure was visible
 * only in a duty row that took a day to go loud.
 *
 * THE RULE IS BINARY. A file is either well-formed XML or it is not, and a lenient parser's output
 * on a malformed file is undefined by anyone's specification. So: no bare `&` in any `<string>` the
 * installer writes, and every `&` is one of the five XML entities. `plutil -lint` enforces this on
 * the Mac at install time; this enforces it in CI over the installer's own text, where there is no
 * plutil, so the class is caught before the file ever reaches her machine.
 *
 * RULE 0: examining zero stanzas, or zero `<string>` lines, is a FAILURE — the installer has always
 * had a dozen and a validator that finds none has lost the file, not proven it clean.
 *
 *   node scripts/validate/the-installer-writes-well-formed-plists.mjs
 *   node scripts/validate/the-installer-writes-well-formed-plists.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLER = "scripts/ops/install-agent-launchd.sh";

/** A bare `&` — one not beginning `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` or a numeric reference. */
const BARE_AMPERSAND = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/**
 * Every `<string>…</string>` line inside a plist heredoc, with the stanza it belongs to.
 *
 * Heredocs are recognised by `cat > "$X" <<TAG` … `TAG`; anything outside one is shell, where `&&`
 * is correct and none of this applies.
 */
export function plistStrings(sh) {
  const out = [];
  const lines = sh.split("\n");
  let tag = null;
  let stanza = null;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (tag === null) {
      const m = /^cat\s*>\s*"?\$?\{?([A-Z_]+)\}?(?:\.plist)?"?\s*<<\s*'?([A-Za-z_]+)'?\s*$/.exec(l.trim())
        ?? /^cat\s*>\s*(\S+)\s*<<\s*'?([A-Za-z_]+)'?\s*$/.exec(l.trim());
      if (m) { stanza = m[1]; tag = m[2]; }
      continue;
    }
    if (l.trim() === tag) { tag = null; stanza = null; continue; }
    const s = /<string>(.*)<\/string>/.exec(l);
    if (s) out.push({ line: i + 1, stanza, text: s[1] });
  }
  return out;
}

export function findings(sh) {
  const strings = plistStrings(sh);
  const bad = strings.filter((s) => BARE_AMPERSAND.test(s.text));
  return { strings, bad };
}

function run() {
  const sh = readFileSync(join(ROOT, INSTALLER), "utf8");
  const { strings, bad } = findings(sh);
  if (strings.length === 0) {
    console.error(`FAIL: no <string> lines found inside any plist heredoc in ${INSTALLER}. That is a lost file, not a clean one.`);
    process.exit(1);
  }
  if (bad.length) {
    console.error(`FAIL: ${bad.length} <string> line(s) in ${INSTALLER} carry a bare '&' — not XML, and launchd's lenient fallback mangles the escaped ones beside it:`);
    for (const b of bad) console.error(`  line ${b.line} (${b.stanza}): ${b.text.slice(0, 110)}`);
    console.error("  Write every && as &amp;&amp; inside a <string>.");
    process.exit(1);
  }
  console.log(`OK: ${strings.length} <string> line(s) across the installer's plists are well-formed XML (no bare '&').`);
}

function selfTest() {
  const good = [
    'cat > "$PLIST" <<PLISTEOF', "<plist><dict>", "    <string>cd $REPO &amp;&amp; npm run x</string>", "</dict></plist>", "PLISTEOF",
  ].join("\n");
  const g = findings(good);
  if (g.strings.length !== 1 || g.bad.length !== 0) { console.error("self-test: the well-formed stanza should pass"); process.exit(1); }

  // The exact shape that failed on 15 September: one escaped line and one bare one in the same file.
  const scooter = [
    'cat > "$SHEET_PLIST" <<SHEETEOF', "<plist><dict>",
    "    <string>cd $REPO && bash duty-run.sh lp-tracker-sync.mjs -- bash -c 'npm run lp:sync &amp;&amp; npm run lp:outcomes'</string>",
    "</dict></plist>", "SHEETEOF",
  ].join("\n");
  const s = findings(scooter);
  if (s.bad.length !== 1) { console.error("self-test: the scooter-sheet shape must be caught"); process.exit(1); }

  // Shell outside a heredoc may use && freely; that is not a plist.
  const shell = ['launchctl unload "$X" 2>/dev/null || true', 'cd "$REPO" && npm test'].join("\n");
  if (findings(shell).strings.length !== 0) { console.error("self-test: shell lines are not plist strings"); process.exit(1); }

  // Rule 0 stands on the real file: it must contain stanzas.
  const real = findings(readFileSync(join(ROOT, INSTALLER), "utf8"));
  if (real.strings.length < 10) { console.error(`self-test: the real installer should carry many <string> lines, found ${real.strings.length}`); process.exit(1); }

  console.log("self-test OK: the well-formed stanza passes, the 15 September shape fails, shell is ignored, and the real file is populated.");
}

if (process.argv.includes("--self-test")) selfTest(); else run();
