#!/usr/bin/env node
/**
 * BOSS OS WEARS ITS OWN NAME, AND ONLY EVER ANSWERS ON ITS OWN DOMAIN.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Two defects, both of which have recurred, both of which look like something else when they fail.
 *
 * **1. The tab icon was West Peek's.** `src/client/public/icon.svg` and `boss-mark.svg` are both
 * `<title>WP mark</title>` — a black tile carrying a white WP monogram and West Peek Ventures'
 * canonical orange #f05a1a. Boss OS is the owner's personal operating system; West Peek is a
 * separate business. The fund's monogram sat in the browser tab of her own OS from the day this
 * repository was cloned out of the West Peek OS chassis, and nothing noticed because a favicon has
 * no test, no type and no runtime error. Her words, 8 September 2026: *"the Boss OS needs a
 * different logo in the tab for the cloudbased app — we need to get rid of all west peek os
 * branding in boss os."*
 *
 * **2. `boss.westpeek.ventures` is not a domain.** It does not resolve and never has; the Boss OS
 * cloud app is `boss.sequoiataylor.com`. It has appeared as a default origin in ops scripts at
 * least twice and been corrected by hand both times. A default that never resolves does not fail
 * as a typo — it fails as a connection error, a 401, or a CORS message, which sends whoever is
 * debugging it at the auth layer instead of at the string. That is the signature of something that
 * needs a check rather than a third manual fix.
 *
 * ─── The line this scan draws, and why it is drawn there ────────────────────
 *
 * `westpeek.ventures` IS legitimate as an EMAIL DOMAIN and must stay. `sequoia@westpeek.ventures`
 * is her fund's real sending address — the one OPERATIONS names as still unconnected, blocking LP
 * reply detection and an opt-out compliance defect open since 19 August. The chassis's `firm_user`
 * rows and its whole test fixture set use addresses on it too. A blanket ban on the string would
 * fail on her own business's data, which is precisely the mistake the owner warned against: the
 * fund's DATA inside Boss OS is content, not branding.
 *
 * So: **an address on that domain is fine. A HOST is not.** Anything shaped like a URL, an origin,
 * or a bare `boss.westpeek.ventures` is a bug.
 *
 * Likewise, the chassis is still in this tree and `src/client/App.tsx` is West Peek OS's own shell.
 * West Peek's mark belongs in West Peek's app. What may not happen is Boss OS's entry document, its
 * manifest, its service worker or its icons carrying it — those are shared by both apps and served
 * on her domain.
 *
 * RULE 0: a scan that examined no files is a broken scan, not a clean repo.
 *
 *   node scripts/validate/boss-identity.mjs
 *   node scripts/validate/boss-identity.mjs --self-test
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The one correct origin for the Boss OS cloud app. */
export const BOSS_ORIGIN = "https://boss.sequoiataylor.com";

/**
 * A host on westpeek.ventures — and ONLY the shapes that are actually wrong.
 *
 * THREE THINGS ARE LEGITIMATE AND MUST PASS, which is why this is not a substring match:
 *
 *   · **An email address.** `sequoia@westpeek.ventures` is her fund's real sending address, the one
 *     OPERATIONS names as still unconnected. The chassis's `firm_user` rows and its whole fixture
 *     set live on it too.
 *   · **The verified sending DOMAIN.** `emailTransport.ts`, `sendAs.ts` and migration 0065 name
 *     `westpeek.ventures` because it is a domain verified with Cloudflare Email Routing that the
 *     fund may send as. That is mail infrastructure, and it works.
 *   · **The fund's public website.** `brand-access-login.mjs` serves West Peek's own Access login
 *     page and links to West Peek's own site, correctly.
 *
 * ONE THING IS ALWAYS WRONG: `boss.westpeek.ventures`. It has never resolved, the Boss OS cloud app
 * is boss.sequoiataylor.com, and it has appeared as a default origin twice. A URL pointing at any
 * host on that domain from Boss OS's own code is the other half of the same mistake.
 *
 * So the rule is: the `boss.` subdomain in any form, or a schemed URL on the domain appearing in a
 * file that belongs to Boss OS rather than to the chassis.
 */
export const BAD_HOST = /(?<![\w.@-])(?:https?:\/\/|\/\/)?boss\.westpeek\.ventures(?![\w-])/gi;

/** A schemed URL anywhere on the domain, which is wrong inside Boss OS's own half of the tree. */
export const ANY_URL = /(?<![\w.@-])(?:https?:\/\/|\/\/)(?:[a-z0-9-]+\.)*westpeek\.ventures(?![\w-])/gi;

/** The half of this repository that is Boss OS rather than the West Peek chassis. */
const BOSS_OWNED = /^(src\/worker\/boss\/|src\/client\/boss\/|src\/shared\/boss\/|scripts\/ops\/|scripts\/sync-agent\/|docs\/boss\/|tests\/boss\/|migrations\/01[5-9]\d_boss|migrations\/02\d\d_boss)/;

export function badHostsIn(text) {
  const hits = [];
  for (const m of text.matchAll(BAD_HOST)) {
    // An email address is `local@domain`. The lookbehind already excludes `@`, so anything reaching
    // here is a bare or schemed host.
    hits.push(m[0]);
  }
  return hits;
}

/** Files where a West Peek mark would be Boss OS's, because both apps are served from them. */
const SHARED_IDENTITY = [
  "src/client/index.html",
  "src/client/public/manifest.webmanifest",
  "src/client/public/sw.js",
];

/** Boss OS's own mark must exist, be its own file, and not be the WP monogram. */
const BOSS_MARK = "src/client/public/boss-os-mark.svg";

const SCAN_DIRS = ["src", "scripts", "migrations", "docs/boss", "tests", "e2e"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".sh", ".sql", ".md", ".json", ".html", ".css", ".webmanifest", ".toml"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(extname(full))) out.push(full);
  }
  return out;
}

export function scan(root) {
  const failures = [];
  const files = [];
  for (const d of SCAN_DIRS) files.push(...walk(join(root, d)));
  for (const extra of ["wrangler.toml", "package.json", "README.md"]) {
    const p = join(root, extra);
    if (existsSync(p)) files.push(p);
  }

  // 1 · No host on a domain that does not exist.
  for (const f of files) {
    const rel = f.slice(root.length + 1);
    // This file describes the rule and necessarily contains examples of what it forbids.
    if (rel.endsWith("scripts/validate/boss-identity.mjs")) continue;
    const text = readFileSync(f, "utf8");
    const hits = badHostsIn(text);
    // Inside Boss OS's own files, ANY schemed URL on that domain is a wrong origin.
    if (BOSS_OWNED.test(rel)) hits.push(...(text.match(ANY_URL) ?? []));
    for (const hit of hits) {
      failures.push(
        `${rel}: "${hit}" is a host on a domain that does not resolve.\n` +
        `      The Boss OS cloud app is ${BOSS_ORIGIN}. An origin that never answers fails as a\n` +
        `      connection error or a 401, which sends whoever debugs it to the auth layer.`,
      );
    }
  }

  // 2 · Boss OS's mark exists and is Boss OS's.
  const markPath = join(root, BOSS_MARK);
  if (!existsSync(markPath)) {
    failures.push(`${BOSS_MARK} is missing — Boss OS has no mark of its own, so the tab falls back to the chassis's.`);
  } else {
    const mark = readFileSync(markPath, "utf8");
    // The monogram's signature, not the words: this file's own comment explains what it replaced,
    // and a validator that fires on a doc comment is one that gets switched off.
    if (/>\s*WP\s*</.test(mark) || /fill="#f05a1a"/i.test(mark)) {
      failures.push(`${BOSS_MARK} is still the West Peek monogram. It is meant to be Boss OS's own.`);
    }
  }

  // 3 · The shared entry surfaces point at Boss OS's mark and never at the chassis's.
  for (const rel of SHARED_IDENTITY) {
    const p = join(root, rel);
    if (!existsSync(p)) { failures.push(`${rel} is missing.`); continue; }
    const text = readFileSync(p, "utf8");
    if (/["'(]\/(?:icon\.svg|boss-mark\.svg)/.test(text)) {
      failures.push(
        `${rel}: references /icon.svg or /boss-mark.svg, which are West Peek's WP monogram.\n` +
        `      This file is served to BOTH apps, so on boss.sequoiataylor.com it puts the fund's\n` +
        `      mark in her own OS's tab. Use /boss-os-mark.svg and its PNG sizes.`,
      );
    }
    if (!text.includes("boss-os-mark.svg") && !text.includes("boss-os-192.png")) {
      failures.push(`${rel}: does not reference Boss OS's own mark at all.`);
    }
  }

  /*
   * 4 · THE BUILT CLIENT, when there is one — because the source being right is not the same as
   * what she loads being right.
   *
   * A stale `dist/` is how a favicon rename appears to have failed: `wrangler deploy` bundles the
   * Worker without running `vite build`, so it ships today's backend with whatever client was last
   * built and reports success either way. That is already a documented trap in this repository
   * (`npm run deploy:production` exists because of it). Checking the artefact closes the loop.
   *
   * SKIPPED, NOT FAILED, when dist is absent. A developer who has never built is not a defect, and
   * the source checks above already cover the same ground. The deploy path builds first and then
   * runs this, which is where the check has teeth.
   */
  const dist = join(root, "dist/client");
  if (existsSync(dist)) {
    for (const rel of ["index.html", "manifest.webmanifest", "sw.js"]) {
      const p = join(dist, rel);
      if (!existsSync(p)) { failures.push(`dist/client/${rel} is missing from the build.`); continue; }
      const text = readFileSync(p, "utf8");
      if (/["'(]\/(?:icon\.svg|boss-mark\.svg)/.test(text)) {
        failures.push(`dist/client/${rel}: the BUILT client still points at West Peek's WP monogram. The build is stale — run \`npm run build\`.`);
      }
      if (!text.includes("boss-os-mark.svg") && !text.includes("boss-os-192.png")) {
        failures.push(`dist/client/${rel}: the BUILT client does not carry Boss OS's mark.`);
      }
    }
    if (!existsSync(join(dist, "boss-os-mark.svg"))) {
      failures.push("dist/client/boss-os-mark.svg is missing — the mark was not copied into the build.");
    }
  }

  // 5 · The document says Boss OS.
  const html = join(root, "src/client/index.html");
  if (existsSync(html) && !/<title>\s*Boss OS\s*<\/title>/.test(readFileSync(html, "utf8"))) {
    failures.push("src/client/index.html: the document title is not Boss OS.");
  }

  return { failures, examined: files.length };
}

/* ── self-test ──────────────────────────────────────────────────────────────
 *
 * A validator that cannot demonstrate it still catches what it exists to catch does not belong in
 * the gate. Each fixture is one of the two real defects, plus the false positive that would make
 * this scan get switched off.
 */
function selfTest() {
  const cases = [
    {
      name: "an email address on westpeek.ventures is NOT a failure",
      text: "const MP = { 'x-wpos-dev-user': 'sequoia@westpeek.ventures' };",
      expectHits: 0,
    },
    {
      name: "a schemed host is caught",
      text: 'const ORIGIN = process.env.X ?? "https://boss.westpeek.ventures";',
      expectHits: 1,
    },
    {
      name: "a bare host is caught",
      text: "Open boss.westpeek.ventures in your browser.",
      expectHits: 1,
    },
    {
      name: "a protocol-relative Boss host is caught",
      text: 'fetch("//boss.westpeek.ventures/api")',
      expectHits: 1,
    },
    {
      name: "the verified SENDING DOMAIN is not a host and must pass",
      text: 'const VERIFIED_DOMAIN = "westpeek.ventures"; // Cloudflare Email Routing',
      expectHits: 0,
    },
    {
      name: "but any schemed URL on it is caught inside Boss OS's own files",
      text: 'const ORIGIN = "https://westpeek.ventures";',
      expectHits: 0,
      urlHits: 1,
    },
    {
      name: "an address with a subdomain-looking local part is still an address",
      text: "ops@westpeek.ventures",
      expectHits: 0,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const hits = badHostsIn(c.text).length;
    if (hits !== c.expectHits) {
      console.error(`  ✗ ${c.name}: expected ${c.expectHits} hit(s), got ${hits}`);
      failed++;
    }
    if (c.urlHits !== undefined) {
      const urls = (c.text.match(ANY_URL) ?? []).length;
      if (urls !== c.urlHits) {
        console.error(`  ✗ ${c.name}: expected ${c.urlHits} URL hit(s), got ${urls}`);
        failed++;
      }
    }
  }

  // The file-level fixtures: a tree with the WP mark wired into the shared entry document.
  const dir = mkdtempSync(join(tmpdir(), "boss-identity-"));
  try {
    mkdirSync(join(dir, "src/client/public"), { recursive: true });
    writeFileSync(join(dir, "src/client/index.html"), '<html><head><title>Boss OS</title><link rel="icon" href="/icon.svg" /></head></html>');
    writeFileSync(join(dir, "src/client/public/manifest.webmanifest"), '{"icons":[{"src":"/boss-os-mark.svg"}]}');
    writeFileSync(join(dir, "src/client/public/sw.js"), 'const SHELL = ["/boss-os-mark.svg"];');
    writeFileSync(join(dir, "src/client/public/boss-os-mark.svg"), "<svg><title>Boss OS</title></svg>");
    const { failures } = scan(dir);
    if (!failures.some((f) => f.includes("index.html") && f.includes("WP monogram"))) {
      console.error("  ✗ the WP mark wired into the shared entry document was not caught");
      failed++;
    }

    // And the same tree with Boss OS's own mark passes.
    writeFileSync(join(dir, "src/client/index.html"), '<html><head><title>Boss OS</title><link rel="icon" href="/boss-os-mark.svg" /></head></html>');
    const clean = scan(dir);
    if (clean.failures.length !== 0) {
      console.error(`  ✗ a clean tree failed: ${clean.failures.join(" | ")}`);
      failed++;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failed) {
    console.error(`\nIDENTITY SELF-TEST FAILED: ${failed} case(s).`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length + 2} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const { failures, examined } = scan(ROOT);

  // RULE 0. Finding no files means the directories moved, not that the repo is clean.
  if (examined === 0) {
    console.error("IDENTITY SCAN EXAMINED NOTHING: no source files were found to scan.");
    console.error("The tree has moved. That is a broken scan, not a clean repository.");
    process.exit(2);
  }

  if (failures.length) {
    console.error("BOSS IDENTITY SCAN FAILED:\n");
    for (const f of failures) console.error("  ✗", f);
    console.error(
      `\nBoss OS is her own operating system. The Boss OS cloud app answers on ${BOSS_ORIGIN}\n` +
      "and wears its own mark. West Peek's mark belongs in West Peek's app, which is not this one.",
    );
    process.exit(1);
  }

  console.log(
    `BOSS IDENTITY SCAN PASSED: ${examined} files carry no host on a domain that does not resolve, ` +
    `the entry document and manifest carry Boss OS's own mark, and the title is Boss OS.`,
  );
}
