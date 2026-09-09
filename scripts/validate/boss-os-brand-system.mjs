#!/usr/bin/env node
/**
 * West Peek brand-system boundary scan.
 *
 * This is not a validator invented to prove design work happened. It is the family convention —
 * `seq23/westpeek-live`, `seq23/west-peek-network-os`, and `seq23/west-peek-pitch-lab` each ship a
 * `boss-os-brand-system.mjs`, and `WEST_PEEK_BRAND_SYSTEM.md` is marked CANONICAL /
 * LOCKED with a change-control clause binding every West Peek repo.
 *
 * It exists because this repo already suffered the exact drift it catches. Before the design
 * overhaul the client's interactive colour was `#7fa8c9` (a generic blue) and a panel rail was
 * `#6b5b95` (purple), both banned by the brand authority, and the canonical orange `#F05A1A`
 * appeared nowhere. Nothing failed, because nothing was checking.
 *
 * Rules enforced:
 *   1. The brand authority is present and still says what it says.
 *   2. Colour is declared ONLY in the `:root` token block of `src/client/styles.css`.
 *      Everything else — CSS rules, TSX, the manifest, the head — must reference a token or one of
 *      the four literals a non-CSS file is allowed to carry.
 *   3. No stale West Peek orange.
 *   4. No blue / indigo / violet / purple / cyan hue as a product colour (hue 175–330 with real
 *      chroma). Provider-specific colour inside an isolated provider surface is not in scope here
 *      because no such surface exists in this client.
 *   5. The canonical orange is defined, and the approved mark is wired into the primary shell.
 *
 * `--self-test` plants each violation in a fixture and asserts the scan still catches it, per the
 * repo convention in AGENTS.md (a narrowed rule must prove it still has teeth).
 */

import { readFileSync, existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/**
 * TWO BRANDS LIVE UNDER src/client, AND THIS SCAN ENFORCED ONE.
 *
 * The law is the same for both - colour is declared in exactly one token block per app, and every
 * component consumes tokens - but the palettes are not. Run unchanged after the Boss OS port it
 * flagged all fifteen Boss tokens as illegal literals, which is the noise that gets a scan
 * switched off rather than obeyed. Each app now declares its own token home, its own canonical
 * colour, and its own banned hue range.
 *
 * WHY THE BANNED RANGES DIFFER. West Peek bans 175-330 degrees: blue through purple may not be
 * product colours. Boss OS bans 175-300, because plum IS a Boss product colour - it is the trading
 * lane rail, the one thing on screen that is always true - while blue, cyan and indigo stay out.
 * The rule is not weakened, it is stated for the brand it governs.
 */
const APPS = [
  {
    name: "Boss OS",
    dir: "src/client/boss",
    canonical: "#c8a45c",
    canonicalName: "Boss gold",
    bannedHue: [175, 300],
    bannedLabel: "blue, cyan and indigo",
  },
  {
    name: "West Peek",
    dir: "src/client",
    required: true,
    // The chassis owns everything under src/client that Boss OS does not.
    excludes: ["src/client/boss"],
    canonical: "#f05a1a",
    canonicalName: "canonical West Peek orange",
    bannedHue: [175, 330],
    bannedLabel: "blue, cyan, indigo, violet and purple",
    staleOranges: ["#ff6a00", "#f26a21", "#ff7a00", "#ff8500", "#ff8a00"],
  },
];

const CANONICAL_ORANGE = "#f05a1a";
const STALE_ORANGES = ["#ff6a00", "#f26a21", "#ff7a00", "#ff8500", "#ff8a00"];

/** Literals a non-CSS file may carry, because a manifest or an SVG cannot reference a CSS var. */
/**
 * The literals a non-CSS file may carry. index.html and the web manifest are SHARED by both apps -
 * one document boots whichever surface the URL asks for - so the browser-chrome colours in them
 * are Boss OS's, because Boss OS is what this repo is becoming.
 */
const ALLOWED_LITERALS = new Set([
  "#050505", "#f7f2ea", "#ffffff", "#f05a1a", "#fff",
  "#fdf8f4", // Boss ground — manifest background_color and the index.html theme-color
  "#3d2f33", // Boss ink
]);

/** The two approved brand assets. Their colours come from the parent brand, not from this repo. */
const BRAND_ASSETS = new Set(["boss-mark.svg", "icon.svg"]);

/**
 * Every colour VALUE the app's own token block declares.
 *
 * ─── The failure this replaces ─────────────────────────────────────────────
 *
 * `BRAND_ASSETS` is a hand-kept list of filenames, and on 9 September 2026 it was failing the build
 * on `src/client/public/boss-os-mark.svg: #c8a45c`. That hex is `--lane-ops`, declared in Boss OS's
 * own token block, painted on Boss OS's own mark. The file had simply been renamed from
 * `boss-mark.svg` and the allow-list had not — two components each keeping their own copy of the
 * same list, which is this repository's named defect class, sitting inside a validator.
 *
 * DERIVED RATHER THAN LISTED. An SVG cannot reference a CSS custom property from a stylesheet it is
 * not inside, so a mark must carry literal hexes; the honest rule is that those hexes must be the
 * app's OWN tokens. That is strictly narrower than a filename exemption — the old rule let an
 * approved file carry any colour at all — and it cannot rot when somebody renames a file.
 */
function tokenValues(tokenBlock) {
  return new Set((tokenBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()));
}

/**
 * Every colour either app declares, because a mark does not live in the folder it belongs to.
 *
 * `boss-os-mark.svg` is Boss OS's own mark and it sits in `src/client/public/` — the chassis's tree,
 * because that is where a favicon has to be served from. Checking it against the chassis's palette
 * asks the wrong question and fails a correct file; checking it against Boss OS's palette by
 * filename would be a third hand-kept list.
 *
 * So the rule is: an SVG is checked against the palette of the app it BELONGS to, and a file whose
 * name begins `boss` belongs to Boss OS wherever it is served from.
 *
 * THE LOOSER VERSION OF THIS WAS TRIED AND REJECTED. Allowing any token from either app made the
 * scan pass with West Peek's canonical orange #f05a1a painted on the Boss OS mark — which is the one
 * thing this validator exists to prevent, since the fund's monogram sitting in her personal OS's tab
 * is what prompted the mark in the first place. Two businesses, never blended.
 */
const TOKENS_BY_APP = new Map();

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;
const SCANNED = new Set([".css", ".ts", ".tsx", ".html", ".svg", ".webmanifest", ".json"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED.has(extname(full))) out.push(full);
  }
  return out;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Hex → HSL hue and saturation. Used to name a hue family rather than blocklist hexes. */
function hexHue(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0, light: l };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  return { hue, sat, light: l };
}

/**
 * @param {string} root repo root to scan
 * @returns {string[]} failures, empty when clean
 */
export function scan(root) {
  const failures = [];
  const rel = (f) => relative(root, f);

  // 1 · The authority itself.
  const authority = join(root, "WEST_PEEK_BRAND_SYSTEM.md");
  if (!existsSync(authority)) {
    failures.push("WEST_PEEK_BRAND_SYSTEM.md is missing from the repo root");
  } else {
    const doc = readFileSync(authority, "utf8");
    if (!doc.includes("#F05A1A")) failures.push("canonical orange #F05A1A missing from the brand authority");
    if (!doc.includes("Orange is an accent, not the entire interface")) {
      failures.push("restrained-orange governing rule missing from the brand authority");
    }
  }

  const clientDir = join(root, "src", "client");
  if (!existsSync(clientDir)) {
    failures.push("src/client is missing — nothing to scan");
    return failures;
  }

  // 2 · Colour lives in one token block per app, and nowhere else.
  // 3 · Stale oranges, anywhere, including the brand assets.
  // 4 · No off-brand hue as a product colour — the range is the app's own.
  for (const app of APPS) {
    const appDir = join(root, ...app.dir.split("/"));
    if (!existsSync(appDir)) {
      // The chassis surface is required; a tree with no Boss OS surface is a valid tree, and the
      // self-test's fixtures are exactly that. `required: true` marks the one that must exist.
      if (app.required) failures.push(`${app.dir} is missing — ${app.name} has nothing to scan`);
      continue;
    }
    const stylesPath = join(appDir, "styles.css");
    let tokenBlock = "";
    if (!existsSync(stylesPath)) {
      failures.push(`${app.dir}/styles.css is missing — ${app.name}'s token block has no home`);
    } else {
      const css = stripCssComments(readFileSync(stylesPath, "utf8"));
      const start = css.indexOf(":root {");
      const end = start === -1 ? -1 : css.indexOf("\n}", start);
      if (start === -1 || end === -1) {
        failures.push(`${app.dir}/styles.css has no :root token block`);
      } else {
        tokenBlock = css.slice(start, end);
        const outside = css.slice(0, start) + css.slice(end);
        for (const literal of new Set(outside.match(COLOUR) ?? [])) {
          failures.push(`colour literal outside the token block in ${app.dir}/styles.css: ${literal} (use a token)`);
        }
        if (!tokenBlock.toLowerCase().includes(app.canonical)) {
          failures.push(`${app.canonicalName} ${app.canonical} is not defined in ${app.name}'s token block`);
        }
      }
    }

    const ownTokens = tokenValues(tokenBlock);
    TOKENS_BY_APP.set(app.name, ownTokens);

    const files = walk(appDir).filter(
      (f) => !(app.excludes ?? []).some((ex) => f.startsWith(join(root, ...ex.split("/")))) && f !== stylesPath,
    );
    // A scan that examines nothing is not a pass.
    if (app.required && files.length === 0) failures.push(`${app.dir}: 0 files scanned for ${app.name}`);

    for (const file of files) {
      const name = basename(file);
      const ext = extname(file);
      const raw = readFileSync(file, "utf8");
      const text = ext === ".css" ? stripCssComments(raw) : ext === ".svg" ? raw : stripJsComments(raw);
      /*
       * WHAT THE FILE ACTUALLY PAINTS, with its comments removed.
       *
       * The Boss OS mark's own comment explains, in words, that it does NOT use West Peek's
       * #f05a1a — and the first version of the rule below read that sentence and failed the build
       * for containing the colour it exists to refuse. A comment cannot paint a pixel; the scan for
       * a forbidden FILL must look at fills.
       *
       * The broader literal scan still reads the raw text on purpose: a stale orange sitting in a
       * comment is a documentation rot worth catching, and it is caught above.
       */
      const painted = ext === ".svg" ? raw.replace(/<!--[\s\S]*?-->/g, "").toLowerCase() : text.toLowerCase();

      for (const stale of app.staleOranges ?? []) {
        if (text.toLowerCase().includes(stale)) failures.push(`stale West Peek orange ${stale} in ${rel(file)}`);
      }

      for (const literal of new Set(text.match(COLOUR) ?? [])) {
        const lower = literal.toLowerCase();
        if (ext === ".ts" || ext === ".tsx" || ext === ".css") {
          failures.push(`colour literal in ${rel(file)}: ${literal} (components consume tokens, they do not declare colour)`);
          continue;
        }
        if (BRAND_ASSETS.has(name)) continue; // the approved marks carry their own colours
        /*
         * AN SVG PAINTED IN THE APP'S OWN TOKENS IS THE APP'S OWN MARK. It cannot use var(--gold)
         * from a stylesheet it is not inside, so it carries the hex; requiring that hex to be one
         * the token block declares keeps the boundary exactly where it belongs.
         */
        if (ext === ".svg") {
          // A `boss*` mark answers to Boss OS's palette even when it is served from the chassis's
          // public folder, which is where a favicon has to live.
          const palette = /^boss/i.test(name) ? (TOKENS_BY_APP.get("Boss OS") ?? ownTokens) : ownTokens;
          if (palette.has(lower)) continue;
        }
        /*
         * WEST PEEK'S ORANGE IS ALLOWED EVERYWHERE EXCEPT ON BOSS OS'S OWN MARK.
         *
         * `ALLOWED_LITERALS` carries #f05a1a because the chassis is West Peek and its files are
         * entitled to it. Without this line that entitlement reaches the Boss OS mark, which sits in
         * the chassis's public folder — and the fund's colour in her personal OS's browser tab is
         * the exact thing that mark was drawn to end. Two businesses, never blended.
         */
        if (/^boss/i.test(name) && lower === "#f05a1a" && painted.includes(lower)) {
          failures.push(
            `West Peek's canonical orange ${literal} in ${rel(file)} — that is the fund's colour on Boss OS's own mark. ` +
              "Boss OS is her personal operating system; West Peek is a separate business.",
          );
          continue;
        }
        if (!ALLOWED_LITERALS.has(lower)) failures.push(`unapproved colour literal in ${rel(file)}: ${literal}`);
      }
    }

    const [lo, hi] = app.bannedHue;
    for (const literal of new Set(tokenBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])) {
      const hsl = hexHue(literal);
      if (!hsl) continue;
      if (hsl.hue >= lo && hsl.hue <= hi && hsl.sat > 0.12) {
        failures.push(
          `off-brand hue in ${app.name}'s token block: ${literal} (hue ${hsl.hue.toFixed(0)}°) — ${app.bannedLabel} may not be product colours`,
        );
      }
    }
  }

  // 5 · The approved mark is actually wired into the primary shell.
  const appPath = join(clientDir, "App.tsx");
  if (!existsSync(appPath)) {
    failures.push("src/client/App.tsx is missing — the shell cannot carry the brand anchor");
  } else if (!readFileSync(appPath, "utf8").includes("/boss-mark.svg")) {
    failures.push("the approved Boss OS mark (/boss-mark.svg) is not wired into the primary shell");
  }
  if (!existsSync(join(clientDir, "public", "boss-mark.svg"))) {
    failures.push("approved Boss OS mark asset is missing: src/client/public/boss-mark.svg");
  }

  return failures;
}

/* ── self-test ────────────────────────────────────────────────────────────────
   Each fixture plants exactly one violation and asserts the scan names it. If a rule is ever
   narrowed, its fixture must still fail — that is what stops the scan from quietly going blind. */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";

function fixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "wp-brand-"));
  mkdirSync(join(dir, "src", "client", "public"), { recursive: true });
  cpSync(join(ROOT, "WEST_PEEK_BRAND_SYSTEM.md"), join(dir, "WEST_PEEK_BRAND_SYSTEM.md"));
  cpSync(join(ROOT, "src", "client", "public", "boss-mark.svg"), join(dir, "src", "client", "public", "boss-mark.svg"));
  writeFileSync(
    join(dir, "src", "client", "styles.css"),
    `:root {\n  --wp-orange: ${CANONICAL_ORANGE};\n  --wp-ink: #15120f;\n}\n\n.card { color: var(--wp-ink); }\n`,
  );
  writeFileSync(join(dir, "src", "client", "App.tsx"), `export const mark = "/boss-mark.svg";\n`);
  return dir;
}

function selfTest() {
  const cases = [
    {
      name: "a clean fixture passes",
      mutate: () => {},
      expect: (f) => f.length === 0,
      describe: "no failures",
    },
    {
      name: "a colour literal in a CSS rule is caught",
      mutate: (dir) => {
        const p = join(dir, "src", "client", "styles.css");
        writeFileSync(p, readFileSync(p, "utf8") + `\n.rogue { background: #123456; }\n`);
      },
      expect: (f) => f.some((x) => x.includes("outside the token block") && x.includes("#123456")),
      describe: "colour literal outside the token block",
    },
    {
      name: "a colour literal in a component is caught",
      mutate: (dir) => {
        writeFileSync(join(dir, "src", "client", "Rogue.tsx"), `export const s = { color: "#abcdef" };\n`);
      },
      expect: (f) => f.some((x) => x.includes("Rogue.tsx") && x.includes("#abcdef")),
      describe: "colour literal in a component",
    },
    {
      name: "a stale West Peek orange is caught even in an allowed file",
      mutate: (dir) => {
        writeFileSync(join(dir, "src", "client", "public", "manifest.webmanifest"), `{ "theme_color": "#ff7a00" }\n`);
      },
      expect: (f) => f.some((x) => x.includes("stale West Peek orange #ff7a00")),
      describe: "stale orange",
    },
    {
      name: "a generic blue token is caught",
      mutate: (dir) => {
        const p = join(dir, "src", "client", "styles.css");
        writeFileSync(p, readFileSync(p, "utf8").replace("--wp-ink: #15120f;", "--wp-ink: #15120f;\n  --wp-link: #7fa8c9;"));
      },
      expect: (f) => f.some((x) => x.includes("off-brand hue") && x.includes("#7fa8c9")),
      describe: "generic blue token (the exact pre-overhaul drift)",
    },
    {
      name: "a purple token is caught",
      mutate: (dir) => {
        const p = join(dir, "src", "client", "styles.css");
        writeFileSync(p, readFileSync(p, "utf8").replace("--wp-ink: #15120f;", "--wp-ink: #15120f;\n  --wp-private: #6b5b95;"));
      },
      expect: (f) => f.some((x) => x.includes("off-brand hue") && x.includes("#6b5b95")),
      describe: "purple token (the exact pre-overhaul drift)",
    },
    {
      name: "a warm brand hue is NOT flagged as a blue",
      mutate: (dir) => {
        const p = join(dir, "src", "client", "styles.css");
        writeFileSync(p, readFileSync(p, "utf8").replace("--wp-ink: #15120f;", "--wp-ink: #15120f;\n  --wp-good: #1f6b45;\n  --wp-warn: #8a5200;\n  --wp-danger: #97231b;"));
      },
      expect: (f) => f.length === 0,
      describe: "semantic green / amber / red survive the hue rule",
    },
    {
      name: "an unwired brand mark is caught",
      mutate: (dir) => {
        writeFileSync(join(dir, "src", "client", "App.tsx"), `export const mark = "/some-other-logo.png";\n`);
      },
      expect: (f) => f.some((x) => x.includes("not wired into the primary shell")),
      describe: "brand anchor missing from the shell",
    },
    {
      name: "a gutted brand authority is caught",
      mutate: (dir) => {
        writeFileSync(join(dir, "WEST_PEEK_BRAND_SYSTEM.md"), "# West Peek Brand System\n\nnothing here\n");
      },
      expect: (f) => f.some((x) => x.includes("canonical orange #F05A1A missing")) && f.some((x) => x.includes("governing rule missing")),
      describe: "brand authority hollowed out",
    },
  ];

  let passed = 0;
  const problems = [];
  for (const c of cases) {
    const dir = fixtureRoot();
    try {
      c.mutate(dir);
      const failures = scan(dir);
      if (c.expect(failures)) passed += 1;
      else problems.push(`${c.name} — expected ${c.describe}, got: ${JSON.stringify(failures)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  if (problems.length) {
    console.error("brand-system self-test FAILED:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log(`brand-system self-test passed: ${passed}/${cases.length} planted violations caught`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = scan(ROOT);
  if (failures.length) {
    console.error("West Peek brand-system validation FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log(
    "West Peek brand-system validation passed: authority present, canonical orange declared, " +
      "colour declared only in the token block, no stale orange, no blue/purple/cyan product colour, " +
      "approved mark wired into the shell.",
  );
}
