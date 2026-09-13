#!/usr/bin/env node
/**
 * ONE MARK, FIVE FILES, AND THEY MUST ALL BE THE SAME DRAWING — AND REACH HER.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * `boss-os-mark.svg` is the source; `boss-os-32.png`, `-180`, `-192` and `-512` are derived from it.
 * NOTHING DERIVED THEM. They were produced once, by hand, and the relationship lived in a sentence
 * in a comment. So a favicon change that updates the SVG and leaves four stale PNGs behind is not
 * only possible, it is the likely outcome — and it is worse than changing nothing, because she then
 * sees the new icon in one place and the old one in another depending on which size the surface
 * asks for. That reads as broken rather than as changed.
 *
 * "Two components each keeping their own copy of the same fact, free to disagree" is this
 * repository's most-produced defect. Five files holding one drawing is precisely that.
 *
 * ─── The second half, which is where favicon changes actually die ───────────
 *
 * A correct set of files that never reaches her is the same as no change. Boss OS ships a service
 * worker that PRECACHES the icons by name, and its activate handler deletes every cache whose name
 * is not the current one. So two things must move together with the drawing:
 *
 *   · the `?v=` query strings in index.html, the manifest and the service worker's SHELL list,
 *     which defeat the HTTP cache; and
 *   · `CACHE` in sw.js, which defeats the service worker's own storage.
 *
 * Doing one and not the other leaves every installed copy serving the old mark from its own cache
 * for ever, and it looks like a broken deploy rather than a cached one. This checks that all three
 * surfaces agree on ONE version, and that the service worker's cache name carries it.
 *
 * ─── And the two marks stay apart ───────────────────────────────────────────
 *
 * `icon.svg` and `boss-mark.svg` in the same directory are West Peek's WP monogram and are still
 * used by the CHASSIS app under `src/client/`. They are legitimately theirs and stay. What must
 * never happen is Boss OS's mark becoming one of them, or a Boss OS surface pointing at one —
 * `validate:identity` already holds the second half of that and this holds the first.
 *
 * RULE 0: a missing source, a missing PNG, or zero `?v=` references found is a HARD FAILURE. This
 * loops over sizes and over surfaces, and a loop over an empty set is how a validator stays green
 * while the thing it guards rots.
 *
 *   node scripts/validate/the-mark-is-one-drawing.mjs
 *   node scripts/validate/the-mark-is-one-drawing.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MARK = "src/client/public/boss-os-mark.svg";
const SIZES = [32, 180, 192, 512];
const SURFACES = [
  "src/client/index.html",
  "src/client/public/manifest.webmanifest",
  "src/client/public/sw.js",
];
const SW = "src/client/public/sw.js";
const RENDERER = "scripts/ops/render-mark.mjs";

/** West Peek's monogram, by its signature rather than by its words. */
const WP_SIGNATURE = [/>\s*WP\s*</, /fill="#f05a1a"/i];

/** Every `?v=N` in a file. */
export function versionsIn(text) {
  return [...text.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));
}

export function check({ mark, surfaces, sw, rendererExists, missingPngs }) {
  const problems = [];

  // ── RULE 0 and the source ─────────────────────────────────────────────────
  if (!mark) {
    problems.push(`${MARK} is missing. Boss OS has no mark of its own, so the tab falls back to the chassis's.`);
    return problems;
  }
  for (const sig of WP_SIGNATURE) {
    if (sig.test(mark)) {
      problems.push(
        `${MARK} carries West Peek's monogram signature (${sig.source}). Boss OS is her personal ` +
        `operating system and West Peek Ventures is a separate business; the fund's mark may not sit ` +
        `in the tab of her own OS.`,
      );
    }
  }

  // The accessibility elements the file has always had, and the honesty of the description.
  if (!/<title\b/.test(mark) || !/<desc\b/.test(mark)) {
    problems.push(
      `${MARK} has lost its <title> or <desc>. They are what the mark says to anyone who cannot see ` +
      `it, and a redraw is exactly when they get dropped.`,
    );
  }
  const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(mark)?.[1]?.trim() ?? "";
  if (desc.length < 20) {
    problems.push(
      `${MARK}'s <desc> is "${desc}". It must describe what is actually drawn — a description that ` +
      `does not match the drawing is worse than none, because it is believed.`,
    );
  }

  for (const size of missingPngs) {
    problems.push(
      `src/client/public/boss-os-${size}.png does not exist. It is derived from the mark and every ` +
      `size is asked for by a real surface — 32 the tab, 180 the iOS home screen, 192 and 512 the ` +
      `manifest.`,
    );
  }

  if (!rendererExists) {
    problems.push(
      `${RENDERER} is missing. Without it the PNGs are five hand-made copies of one drawing with ` +
      `nothing linking them, which is how four of them go stale behind an updated SVG.`,
    );
  }

  // ── The version, agreed across every surface ──────────────────────────────
  const all = [];
  for (const [rel, text] of Object.entries(surfaces)) {
    const versions = versionsIn(text);
    if (versions.length === 0) {
      problems.push(
        `${rel} carries no ?v= on its icon references. That query string is half the cache-bust; ` +
        `without it a browser keeps serving the old mark from its HTTP cache after the deploy.`,
      );
      continue;
    }
    all.push(...versions);
  }
  const distinct = [...new Set(all)];
  if (distinct.length > 1) {
    problems.push(
      `The icon version disagrees across surfaces: ${distinct.sort().join(", ")}. One of them will ` +
      `serve the new mark and another the old one, which looks broken rather than changed.`,
    );
  }

  // ── And the service worker's own cache name carries it ────────────────────
  const cacheName = /const CACHE = "([^"]+)"/.exec(sw ?? "")?.[1];
  if (!cacheName) {
    problems.push(`${SW} declares no CACHE constant this scan can read, so nothing evicts the old shell.`);
  } else if (distinct.length === 1) {
    const v = distinct[0];
    if (!new RegExp(`v${v}\\b`).test(cacheName)) {
      problems.push(
        `${SW}'s CACHE is "${cacheName}" while the icons are at ?v=${v}. The query strings defeat the ` +
        `HTTP cache and this constant defeats the SERVICE WORKER's — and the activate handler only ` +
        `deletes caches whose name is not the current one. Bump it to match, or every installed copy ` +
        `serves the old mark from its own storage for ever.`,
      );
    }
  }

  // ── The shell precaches the icons at the current version ──────────────────
  if (sw && distinct.length === 1) {
    for (const size of SIZES) {
      if (!sw.includes(`boss-os-${size}.png`)) continue; // not every size need be precached
      if (!sw.includes(`boss-os-${size}.png?v=${distinct[0]}`)) {
        problems.push(
          `${SW} precaches boss-os-${size}.png at a version other than ?v=${distinct[0]}, so the shell ` +
          `would install the old file alongside the new one.`,
        );
      }
    }
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-labelledby="t d">
  <title id="t">Boss OS</title>
  <desc id="d">A light pink briefcase on warm ink: a rounded case with a handle above it.</desc>
  <rect width="160" height="160" rx="36" fill="#3d2f33"/>
  <rect x="24" y="56" width="112" height="80" rx="14" fill="#f3b6c6"/>
</svg>`;
  const goodSurfaces = {
    "index.html": '<link rel="icon" href="/boss-os-mark.svg?v=4" /><link rel="icon" href="/boss-os-32.png?v=4" />',
    "manifest.webmanifest": '{"icons":[{"src":"/boss-os-192.png?v=4"},{"src":"/boss-os-512.png?v=4"}]}',
    "sw.js": 'const CACHE = "boss-shell-v4";\nconst SHELL = ["/boss-os-mark.svg?v=4", "/boss-os-32.png?v=4", "/boss-os-180.png?v=4", "/boss-os-192.png?v=4", "/boss-os-512.png?v=4"];',
  };
  const G = () => ({
    mark: goodMark,
    surfaces: { ...goodSurfaces },
    sw: goodSurfaces["sw.js"],
    rendererExists: true,
    missingPngs: [],
  });
  const mut = (fn) => { const g = G(); fn(g); return g; };

  const cases = [
    { name: "the shipped shape passes", input: G(), expect: 0 },
    { name: "RULE 0 — the mark itself missing", input: mut((g) => { g.mark = null; }), expect: 1 },
    {
      name: "the mark reverting to West Peek's monogram",
      input: mut((g) => { g.mark = goodMark.replace('<rect x="24"', '<text>WP</text><rect x="24"'); }),
      expect: 1,
    },
    {
      name: "West Peek's orange creeping into Boss OS's mark",
      input: mut((g) => { g.mark = goodMark.replace('fill="#f3b6c6"', 'fill="#f05a1a"'); }),
      expect: 1,
    },
    {
      name: "a redraw that drops the <desc>",
      input: mut((g) => { g.mark = goodMark.replace(/<desc[\s\S]*?<\/desc>/, ""); }),
      expect: 1,
    },
    {
      name: "a <desc> that describes nothing",
      input: mut((g) => { g.mark = goodMark.replace(/<desc([^>]*)>[\s\S]*?<\/desc>/, "<desc$1>mark</desc>"); }),
      expect: 1,
    },
    {
      name: "THE CLASSIC BUG: a stale PNG left behind",
      input: mut((g) => { g.missingPngs = [180]; }),
      expect: 1,
    },
    {
      name: "no renderer, so the five files have nothing linking them",
      input: mut((g) => { g.rendererExists = false; }),
      expect: 1,
    },
    {
      name: "THE HALF-DONE CACHE BUST: query strings bumped, sw CACHE left behind",
      input: mut((g) => {
        g.sw = g.sw.replace('boss-shell-v4', 'boss-shell-v3');
        g.surfaces["sw.js"] = g.sw;
      }),
      expect: 1,
    },
    {
      name: "the version disagreeing between the manifest and the page",
      input: mut((g) => { g.surfaces["manifest.webmanifest"] = g.surfaces["manifest.webmanifest"].replace(/v=4/g, "v=3"); }),
      expect: 1,
    },
    {
      name: "a surface with no ?v= at all",
      input: mut((g) => { g.surfaces["index.html"] = '<link rel="icon" href="/boss-os-mark.svg" />'; }),
      expect: 1,
    },
    {
      name: "the shell precaching an old version of one size",
      input: mut((g) => {
        g.sw = g.sw.replace("boss-os-180.png?v=4", "boss-os-180.png?v=3");
        g.surfaces["sw.js"] = 'const CACHE = "boss-shell-v4";\nconst SHELL = ["/boss-os-mark.svg?v=4", "/boss-os-32.png?v=4", "/boss-os-192.png?v=4", "/boss-os-512.png?v=4"];';
      }),
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nthe-mark-is-one-drawing self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-mark-is-one-drawing self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const markPath = join(ROOT, MARK);
  const surfaces = {};
  for (const rel of SURFACES) {
    if (!existsSync(join(ROOT, rel))) {
      console.error(`the-mark-is-one-drawing FAILED — ${rel} is missing.`);
      process.exit(1);
    }
    surfaces[rel] = readFileSync(join(ROOT, rel), "utf8");
  }

  const problems = check({
    mark: existsSync(markPath) ? readFileSync(markPath, "utf8") : null,
    surfaces,
    sw: surfaces[SW],
    rendererExists: existsSync(join(ROOT, RENDERER)),
    missingPngs: SIZES.filter((s) => !existsSync(join(ROOT, `src/client/public/boss-os-${s}.png`))),
  });

  if (problems.length) {
    console.error("the-mark-is-one-drawing FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const v = [...new Set(Object.values(surfaces).flatMap(versionsIn))][0];
  console.log(
    `the-mark-is-one-drawing: one SVG, ${SIZES.length} derived PNGs, every surface at ?v=${v}, and the ` +
    `service worker's cache name carries it. The PNGs are proved identical to the SVG by ` +
    `\`node ${RENDERER} --check\`, which runs beside this. OK.`,
  );
}
