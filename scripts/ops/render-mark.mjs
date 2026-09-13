#!/usr/bin/env node
/**
 * The mark's PNG sizes, rendered FROM the mark.
 *
 * ─── The defect this exists to prevent ──────────────────────────────────────
 *
 * `boss-os-mark.svg` is the source and `boss-os-32.png`, `-180`, `-192` and `-512` are derived from
 * it. Nothing derived them: they were produced once, by hand, and the relationship lived in a
 * sentence. A favicon change that updates the SVG and leaves four stale PNGs behind is the classic
 * version of this bug, and it is worse than not changing anything — she sees the new icon in one
 * place and the old one in another, depending on which size the surface asks for, so it reads as
 * broken rather than as changed.
 *
 * "Two components each keeping their own copy of the same fact, free to disagree" is this
 * repository's most-named defect. Five files holding one drawing is exactly that, and a script is
 * the link.
 *
 * ─── --check, so CI can hold the line ───────────────────────────────────────
 *
 * Re-renders into memory and compares byte-for-byte with what is committed. A PNG that no longer
 * matches its SVG fails, which is the only way "these are derived" stays true rather than becoming
 * a comment about how they once were.
 *
 *   node scripts/ops/render-mark.mjs
 *   node scripts/ops/render-mark.mjs --check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "src/client/public");
const SOURCE = join(DIR, "boss-os-mark.svg");

/**
 * Every size, and what asks for it — so a future reader can tell whether one is still needed.
 *
 *   32   the browser tab, and the size the whole design is actually judged at
 *   180  apple-touch-icon, the iOS home screen
 *   192  the web manifest's standard icon
 *   512  the manifest's large and maskable icon, and the app-store-shaped surfaces
 */
const SIZES = [32, 180, 192, 512];

const check = process.argv.includes("--check");
const svg = readFileSync(SOURCE);

let changed = 0;
for (const size of SIZES) {
  const out = join(DIR, `boss-os-${size}.png`);
  /*
   * `density` SCALED TO THE TARGET, which is the part that is easy to get wrong. librsvg rasterises
   * at 96dpi by default and then resamples, so a 512px icon rendered from a 160px viewBox arrives
   * soft. Rendering AT the target resolution keeps the edges that carry the mark at 16 pixels.
   */
  const png = await sharp(svg, { density: Math.round((72 * size) / 160) * 4 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (check) {
    const existing = readFileSync(out);
    if (!existing.equals(png)) {
      console.error(`NAMED STOP [STALE_PNG] ${out.replace(`${ROOT}/`, "")} does not match boss-os-mark.svg.`);
      console.error("  Run: node scripts/ops/render-mark.mjs");
      changed += 1;
    }
  } else {
    writeFileSync(out, png);
    console.log(`  boss-os-${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
  }
}

if (check && changed) process.exit(1);
console.log(
  check
    ? `render-mark --check: all ${SIZES.length} PNGs match boss-os-mark.svg.`
    : `Rendered ${SIZES.length} sizes from ${SOURCE.replace(`${ROOT}/`, "")}.`,
);
