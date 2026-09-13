#!/usr/bin/env node
/**
 * ONE TYPE SCALE FOR TODAY, AND A HEADING IS NEVER QUIETER THAN WHAT IT INTRODUCES.
 *
 * ─── The defect this is the guard for, in her words ─────────────────────────
 *
 *   "u need to work on formatting for all the sections in the today page. even in exec briefing u
 *    have some bold stuff that i feel like should not be ---headings should be bold and have diff
 *    visual weight than the normal text and some headings are 1 vs 2 ---i mean u need to adjust the
 *    formatting of both sections at the end (today contract and the briefing)"
 *
 * All three complaints were one structural fault, and `renderSection` in `Today.tsx` held it in two
 * adjacent lines:
 *
 *     <p className="eyebrow">{sec.heading}</p>        ← the HEADING: 11px, --muted
 *     <div className="row-title">{sec.so_what}</div>  ← the TEXT UNDER IT: heavier, full ink
 *
 * Every briefing section was headed by something quieter than its own first sentence. That is
 * "headings should ... have diff visual weight than the normal text", exactly.
 *
 * "some headings are 1 vs 2" was literal: the block title, the pillar header, the section heading
 * and the body drew from four unrelated classes with no ordered relationship between them, so two
 * things at the same structural level rendered at different weights depending on which block they
 * were in.
 *
 * And "some bold stuff that i feel like should not be" was BOLD DOING TWO JOBS. 0205's prompt asked
 * every bullet to bold its key phrase. When every bullet contains bold, the bold marks nothing —
 * and it outweighed the muted heading above it, so the loudest thing on the screen was a phrase in
 * the middle of a sentence. Migration 0237 stops asking for it; `bold()` stays so the month of
 * reports already written still renders.
 *
 * ─── What is checked, and why it is a SCALE rather than pixels ──────────────
 *
 * A rule about particular pixel values would freeze the design and say nothing about hierarchy. The
 * property that actually matters is ORDERING, and it is checked as ordering:
 *
 *   1. FOUR LEVELS EXIST as `--today-N-size` / `--today-N-weight` in the token block, sizes strictly
 *      DECREASING and weights never INCREASING as the level goes down. That single property is what
 *      makes an inversion impossible rather than merely absent today.
 *   2. NO HEADING LEVEL IS MUTED. A heading in `--muted` is the reported defect with a new class.
 *   3. BOTH BLOCKS DRAW FROM IT. The briefing's section heading and Today's Contract's pillar header
 *      resolve their size to a scale variable, not to a raw pixel value of their own.
 *   4. THE HEADING OUTRANKS ITS CONTENT WHERE IT IS RENDERED. In `Today.tsx`, the class on
 *      `sec.heading` must sit at a HIGHER level than the class on `sec.so_what` — checked on the
 *      real JSX, because that adjacency is where the bug actually lived.
 *   5. NOTHING ASKS FOR BOLD INSIDE SENTENCES ANY MORE, and `bold()` still exists for history.
 *
 * RULE 0: fewer than two scale levels parsed, or finding no heading/content pair to compare, is a
 * HARD FAILURE — an ordering check over one item is no check at all.
 *
 *   node scripts/validate/one-scale-for-the-morning.mjs
 *   node scripts/validate/one-scale-for-the-morning.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CSS = "src/client/boss/styles.css";
const SCREEN = "src/client/boss/pages/Today.tsx";
const BODY_VIEW = "src/client/boss/pages/BodyContract.tsx";

/** The scale, as [{ level, size, weight }] in declared order. */
export function scale(css) {
  const levels = [];
  for (let n = 1; n <= 9; n += 1) {
    const size = new RegExp(`--today-${n}-size\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(css);
    const weight = new RegExp(`--today-${n}-weight\\s*:\\s*(\\d+)`).exec(css);
    if (!size || !weight) break;
    levels.push({ level: n, size: Number(size[1]), weight: Number(weight[1]) });
  }
  return levels;
}

/** A class's rule body, by class name. */
export function ruleFor(css, cls) {
  const m = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : null;
}

/** Which scale level a class sits at, or null if it does not draw from the scale. */
export function levelOf(css, cls) {
  const body = ruleFor(css, cls);
  if (!body) return null;
  const m = /font-size\s*:\s*var\(--today-(\d)-size\)/.exec(body);
  return m ? Number(m[1]) : null;
}

/** The className on the JSX expression that renders `expr`, or null. */
export function classRendering(screen, expr) {
  const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`className="([a-z0-9 _-]+)"[^>]*>\\s*\\{${escaped}`, "i").exec(screen);
  return m ? m[1].trim().split(/\s+/)[0] : null;
}

export function check({ css, screen, bodyView, prompt }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");
  const screenCode = code(screen);

  const levels = scale(css);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (levels.length < 2) {
    problems.push(
      `${CSS} declares ${levels.length} level(s) of the Today scale. An ordering check over fewer than ` +
      `two items is not a check — it would pass over any hierarchy at all, including the inverted one.`,
    );
    return problems;
  }

  // ── 1. The scale is ordered ──────────────────────────────────────────────
  for (let i = 1; i < levels.length; i += 1) {
    const up = levels[i - 1];
    const down = levels[i];
    if (down.size >= up.size) {
      problems.push(
        `Level ${down.level} is ${down.size}px and level ${up.level} above it is ${up.size}px. Sizes must ` +
        `strictly decrease down the scale — that ordering is the whole reason a heading cannot end up ` +
        `quieter than the text it introduces.`,
      );
    }
    if (down.weight > up.weight) {
      problems.push(
        `Level ${down.level} is weight ${down.weight} under a level ${up.level} of ${up.weight}. A heavier ` +
        `child is the inversion she reported, expressed in weight instead of size.`,
      );
    }
  }

  // ── 2. No heading level is muted ─────────────────────────────────────────
  for (const lvl of levels.slice(0, Math.max(1, levels.length - 1))) {
    const body = ruleFor(css, `today-${lvl.level}`);
    if (body && /color\s*:\s*var\(--muted\)/.test(body)) {
      problems.push(
        `\`.today-${lvl.level}\` resolves to \`--muted\`. That is the reported defect with a new class name: ` +
        `the briefing's headings were 11px muted over full-ink content.`,
      );
    }
  }

  // ── 3. Both blocks draw from the scale ───────────────────────────────────
  const pillarLevel = levelOf(css, "pillar");
  if (pillarLevel === null) {
    problems.push(
      `\`.pillar\` — Today's Contract's section heading — does not take its size from the scale. Two ` +
      `blocks each with their own type sizes is "some headings are 1 vs 2", which is what she said.`,
    );
  }
  for (const cls of ["today-1", "today-2", "today-3", "today-4"].slice(0, levels.length)) {
    if (levelOf(css, cls) === null) problems.push(`${CSS} has no \`.${cls}\` rule drawing on the scale.`);
  }
  if (!/today-[1-4]/.test(code(bodyView)) && !/bodygroup/.test(code(bodyView))) {
    problems.push(`${BODY_VIEW} draws on neither the scale nor the classes that do.`);
  }

  // ── 4. The heading outranks its own content, where it is rendered ────────
  const headingClass = classRendering(screenCode, "sec.heading");
  const soWhatClass = classRendering(screenCode, "sec.so_what");
  if (!headingClass || !soWhatClass) {
    problems.push(
      `Could not find both the briefing's section heading and its \`so_what\` line in ${SCREEN}. That ` +
      `adjacency is where the inversion lived, and a scan that cannot see it has examined nothing.`,
    );
    return problems; // RULE 0.
  }
  const hl = levelOf(css, headingClass);
  const sl = levelOf(css, soWhatClass);
  if (hl === null) {
    problems.push(
      `The briefing's section heading renders as \`.${headingClass}\`, which is not on the Today scale. ` +
      `It was \`.eyebrow\` — 11px, muted — directly above its own first sentence.`,
    );
  } else if (sl === null) {
    problems.push(`The briefing's \`so_what\` renders as \`.${soWhatClass}\`, which is not on the Today scale, so nothing orders it against its heading.`);
  } else if (hl >= sl) {
    problems.push(
      `The briefing's heading renders at level ${hl} (\`.${headingClass}\`) above content at level ${sl} ` +
      `(\`.${soWhatClass}\`). A heading may not be quieter than or equal to the text it introduces — this ` +
      `is the exact pair she was looking at.`,
    );
  }

  // ── 5. Bold is not spent inside sentences ────────────────────────────────
  if (prompt && /Bold the key phrase|\*\*markdown asterisks\*\*/i.test(prompt)) {
    problems.push(
      `The briefing prompt still asks every bullet to bold its key phrase. When every bullet has bold, ` +
      `the bold marks nothing and competes with the heading — "some bold stuff that i feel like should ` +
      `not be".`,
    );
  }
  if (!/function bold\(/.test(screenCode)) {
    problems.push(
      `${SCREEN} no longer has \`bold()\`. Nothing is asked to EMIT \`**\` any more, but every report ` +
      `already written carries it, and removing the renderer would turn a month of history into ` +
      `punctuation noise. It is also deliberately not a markdown parser — the text comes from a run ` +
      `that reads the open web.`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function newestPrompt(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest = null;
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/\$\.prompt/.test(src) && /duty_exec_intel/.test(src)) latest = src;
  }
  return latest;
}

function selfTest() {
  const good = {
    css: readFileSync(join(ROOT, CSS), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    bodyView: readFileSync(join(ROOT, BODY_VIEW), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      /*
       * THE NEGATIVE PROOF ASKED FOR BY NAME: put the eyebrow heading back above the row-title.
       * `.eyebrow` is not on the scale, so the guard must name it rather than shrug.
       */
      name: "THE ACTUAL DEFECT: the eyebrow heading restored above a row-title",
      input: {
        ...good,
        screen: good.screen
          .replace('<p className="today-2">{sec.heading', '<p className="eyebrow">{sec.heading')
          .replace('<div className="today-4">{sec.so_what}', '<div className="row-title">{sec.so_what}'),
      },
      expect: 1,
    },
    {
      name: "heading and content collapsed onto the same level",
      input: { ...good, screen: good.screen.replace('<p className="today-2">{sec.heading', '<p className="today-4">{sec.heading') },
      expect: 1,
    },
    {
      name: "a scale whose sizes stop decreasing",
      input: { ...good, css: good.css.replace("--today-3-size: 16px;", "--today-3-size: 18px;") },
      expect: 1,
    },
    {
      name: "a child level made heavier than its parent",
      input: { ...good, css: good.css.replace("--today-4-weight: 400;", "--today-4-weight: 700;") },
      expect: 1,
    },
    {
      name: "a heading level turned muted",
      input: { ...good, css: good.css.replace(/\.today-2 \{([^}]*)color: var\(--ink\)/, ".today-2 {$1color: var(--muted)") },
      expect: 1,
    },
    {
      name: "the pillar heading taken off the shared scale",
      input: { ...good, css: good.css.replace("  font-size: var(--today-2-size);\n  font-weight: var(--today-2-weight);\n  line-height: 1.3;\n  color: var(--ink);\n  margin: 22px 0 8px;", "  font-size: 18px;\n  font-weight: 600;\n  line-height: 1.3;\n  color: var(--ink);\n  margin: 22px 0 8px;") },
      expect: 1,
    },
    {
      name: "bold-every-bullet asked for again",
      input: { ...good, prompt: `${good.prompt}\nBold the key phrase in every bullet.` },
      expect: 1,
    },
    {
      name: "bold() deleted, breaking every historical report",
      input: { ...good, screen: good.screen.replace("function bold(", "function notBold(") },
      expect: 1,
    },
    { name: "RULE 0 — no scale declared at all", input: { ...good, css: good.css.replace(/--today-1-size[^;]*;/, "") }, expect: 1 },
    {
      name: "RULE 0 — the heading/content pair no longer findable",
      input: { ...good, screen: good.screen.replace(/\{sec\.so_what\}/g, "{nothing}") },
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\none-scale-for-the-morning self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`one-scale-for-the-morning self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [CSS, SCREEN, BODY_VIEW].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`one-scale-for-the-morning FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const css = readFileSync(join(ROOT, CSS), "utf8");
  const problems = check({
    css,
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    bodyView: readFileSync(join(ROOT, BODY_VIEW), "utf8"),
    prompt: newestPrompt(join(ROOT, "migrations")),
  });

  if (problems.length) {
    console.error("one-scale-for-the-morning FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const levels = scale(css);
  console.log(
    `one-scale-for-the-morning: ${levels.length} ordered levels (${levels.map((l) => `${l.size}px/${l.weight}`).join(" → ")}), ` +
    `both blocks drawing from them, and the briefing's heading outranking its own content. OK.`,
  );
}
