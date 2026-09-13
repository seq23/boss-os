#!/usr/bin/env node
/**
 * THE BODY CONTRACT SHOWS ITS KINDS, AND NOTHING IN IT CAN GO MISSING.
 *
 * ─── The defect this is the guard for, in her words ─────────────────────────
 *
 *   "reformat the today contract section. i need to make sure i can delineate between movment and
 *    etc..."
 *
 * `agenda.pillars.body` is a flat bag of ten fields and Today rendered them as ONE RUN at one
 * weight: the movement floor, five launch movements, five somatic lanes, medicine, water, food and
 * the safety stop, stacked with nothing saying which was which. So MEDICATION — non-negotiable and
 * time-boxed — read as another suggestion, and the SAFETY STOP — the line that says when to stop —
 * read as a sixth exercise. Two of the ten fields, `minimum_viable` and `language_rule`, were not
 * rendered AT ALL, which nothing anywhere could have told her.
 *
 * ─── The two rules ──────────────────────────────────────────────────────────
 *
 *   1. THE KINDS ARE DISTINCT. Four kinds — movement, intake, medical, stop — each with a label on
 *      the screen and its own rail colour in the stylesheet. Checked as CSS rules that actually
 *      differ, not as class names that exist: four classes resolving to the same colour is the flat
 *      run again with more markup.
 *
 *   2. EVERY FIELD OF THE PAYLOAD IS SHOWN. The `BodyContract` interface in the worker is the
 *      authority on what the payload contains; `BODY_FIELD_GROUPS` in the client is the claim about
 *      where each field appears. They must agree exactly, and every field must be REFERENCED in the
 *      view — a field classified in the registry and never read is classified and invisible.
 *
 *      This is the rule that matters in a year. A field added to the contract next spring cannot
 *      silently vanish from her morning, because adding it turns this build red until someone says
 *      which kind it is.
 *
 *   PLUS ONE NAMED CASE. `safety_stop` may not be in the movement group. It is not an exercise, and
 *   the whole complaint was that it looked like one.
 *
 * RULE 0: zero contract fields parsed, zero registry entries, or zero kinds found is a HARD
 * FAILURE. Both rules are loops, and a loop over an empty set is how a validator stays green
 * forever while the thing it guards rots.
 *
 *   node scripts/validate/the-body-contract-shows-its-kinds.mjs
 *   node scripts/validate/the-body-contract-shows-its-kinds.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CONTRACT = "src/worker/boss/today/body.ts";
const VIEW = "src/client/boss/pages/BodyContract.tsx";
const SCREEN = "src/client/boss/pages/Today.tsx";
const CSS = "src/client/boss/styles.css";

/** The four kinds, and the one field whose kind is not negotiable. */
const KINDS = ["movement", "intake", "medical", "stop"];
const STOP_FIELD = "safety_stop";

/**
 * The fields of `interface BodyContract { … }` — the authority on what the payload holds — each
 * with whether it is a BOOLEAN.
 *
 * The type matters, and it took a failed negative proof to learn why. A boolean like `bed_only` is
 * a CONDITION: its only legitimate appearance in a view is inside a guard. Everything else is
 * CONTENT, and content that appears only inside a guard is content that is never on the screen —
 * which is precisely how `language_rule` was lost. The first draft of this scan asked only whether
 * the field name appeared anywhere in the view, and passed a build where the line rendering
 * `language_rule` had been deleted, because `(body.medication || body.language_rule)` still
 * mentioned it. A reference is not a rendering.
 */
export function contractFields(source) {
  const m = /interface BodyContract\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*\??\s*:\s*([^;\n]+)/gim)].map((x) => ({
    name: x[1],
    boolean: /^\s*boolean\b/.test(x[2]),
  }));
}

/**
 * Is this field's value actually put on the screen?
 *
 * The three shapes that render something: interpolated whole (`{body.f}`), defaulted before a list
 * (`body.f ?? []`), or mapped (`body.f.map(`). A bare mention in a boolean test is none of them.
 */
export function isRendered(viewCode, field) {
  return new RegExp(`\\{\\s*body\\.${field}\\s*\\}|body\\.${field}\\s*\\?\\?|body\\.${field}\\s*\\.map\\(`).test(viewCode);
}

/** The `BODY_FIELD_GROUPS` registry, as { field: kind }. */
export function registry(source) {
  const m = /BODY_FIELD_GROUPS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!m) return {};
  const out = {};
  for (const entry of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*:\s*"([a-z]+)"/g)) out[entry[1]] = entry[2];
  return out;
}

/** The `border-left-color` each kind's rule declares, so "distinct" means visibly distinct. */
export function railColours(css) {
  const out = {};
  for (const kind of KINDS) {
    const rule = new RegExp(`\\.bodygroup-${kind}\\s*\\{([^}]*)\\}`).exec(css);
    if (!rule) continue;
    const colour = /border-left-color\s*:\s*([^;]+);/.exec(rule[1]);
    if (colour) out[kind] = colour[1].trim();
  }
  return out;
}

export function check({ contract, view, screen, css }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const viewCode = code(view);

  const fields = contractFields(contract);
  const groups = registry(view);
  const colours = railColours(css);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (fields.length === 0) {
    problems.push(
      `${CONTRACT} declares no readable \`interface BodyContract\`. Every check below iterates its ` +
      `fields, so this scan would pass by examining nothing.`,
    );
    return problems;
  }
  if (Object.keys(groups).length === 0) {
    problems.push(
      `${VIEW} declares no readable \`BODY_FIELD_GROUPS\`. The registry IS the guarantee that a new ` +
      `field cannot fall out of her morning; with none, ${fields.length} fields are unaccounted for.`,
    );
    return problems;
  }

  // ── 1. The kinds are distinct, on the screen and in the stylesheet ───────
  const used = new Set(Object.values(groups));
  for (const kind of used) {
    if (!KINDS.includes(kind)) {
      problems.push(`${VIEW} classifies a field as "${kind}", which is not one of ${KINDS.join(", ")}.`);
    }
  }
  if (used.size < 2) {
    problems.push(
      `${VIEW} puts every field in one kind. The complaint was that movement, food, medicine and the ` +
      `stop condition all looked like the same instruction; one group is that, restated.`,
    );
  }
  for (const kind of used) {
    if (!KINDS.includes(kind)) continue;
    if (!colours[kind]) {
      problems.push(
        `${CSS} has no \`.bodygroup-${kind}\` rule setting \`border-left-color\`. A kind with no mark ` +
        `of its own is not delineated from the kind above it.`,
      );
    }
  }
  const distinct = new Set(Object.values(colours));
  if (Object.keys(colours).length > 1 && distinct.size !== Object.keys(colours).length) {
    problems.push(
      `${CSS} gives two kinds the same rail colour (${Object.entries(colours).map(([k, v]) => `${k}=${v}`).join(", ")}). ` +
      `Four classes resolving to one colour is the flat undifferentiated run again, with more markup.`,
    );
  }
  if (!/bodygroup-label/.test(viewCode)) {
    problems.push(`${VIEW} renders no label at the head of each group, so a colour is the only clue to what a group IS.`);
  }

  // ── 2. Every field of the payload is classified AND read ─────────────────
  for (const { name: field, boolean: isFlag } of fields) {
    if (!groups[field]) {
      problems.push(
        `\`${field}\` is in the Body contract payload and is NOT in \`BODY_FIELD_GROUPS\`. This is the ` +
        `rule that matters in a year: a field added to the contract and never classified is a field ` +
        `that silently never reaches her morning, exactly as \`minimum_viable\` and \`language_rule\` ` +
        `did not.`,
      );
      continue;
    }
    if (isFlag) {
      // A boolean is a condition, not content; appearing in a guard is the whole of its job.
      if (!new RegExp(`body\\.${field}\\b`).test(viewCode)) {
        problems.push(`\`${field}\` is classified as "${groups[field]}" and is never read in ${VIEW}.`);
      }
      continue;
    }
    if (!isRendered(viewCode, field)) {
      problems.push(
        `\`${field}\` is classified as "${groups[field]}" and its VALUE never reaches the screen in ` +
        `${VIEW} — at most it is mentioned in a condition. Classified and invisible is worse than ` +
        `unclassified: the registry says it is handled and it is not, which is exactly the state ` +
        `\`language_rule\` was in.`,
      );
    }
  }
  const fieldNames = fields.map((f) => f.name);
  for (const field of Object.keys(groups)) {
    if (!fieldNames.includes(field)) {
      problems.push(
        `\`${field}\` is classified in ${VIEW} but is not a field of \`BodyContract\`. A registry that ` +
        `drifts from its subject is decoration.`,
      );
    }
  }

  // ── The named case: the stop is not an exercise ──────────────────────────
  if (fields.some((f) => f.name === STOP_FIELD) && groups[STOP_FIELD] && groups[STOP_FIELD] !== "stop") {
    problems.push(
      `\`${STOP_FIELD}\` is grouped as "${groups[STOP_FIELD]}". It is the line that says when to STOP, ` +
      `and it was reading as a sixth exercise at the bottom of the movement list — which is half of ` +
      `what she was complaining about.`,
    );
  }

  // ── The screen actually uses the view ────────────────────────────────────
  if (!/<BodyContractView\b/.test(code(screen))) {
    problems.push(
      `${SCREEN} does not render \`<BodyContractView>\`. The grouping exists and nothing invokes it, ` +
      `which is this repository's most-repeated defect.`,
    );
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodContract = `
export interface BodyContract {
  launch_sequence: string[];
  somatic: SomaticSelection[];
  hydration: string;
  safety_stop: string;
  bed_only: boolean;
}
`;
  const goodView = `
export const BODY_FIELD_GROUPS: Record<string, BodyKind> = {
  launch_sequence: "movement",
  somatic: "movement",
  bed_only: "movement",
  hydration: "intake",
  safety_stop: "stop",
};
export function BodyContractView({ body }) {
  return (
    <div className="bodycontract">
      <p className="bodygroup-label">Movement</p>
      <ol>{(body.launch_sequence ?? []).map((m) => <li>{m}</li>)}</ol>
      {body.bed_only && <p>A bed-only day.</p>}
      <ul>{(body.somatic ?? []).map((s) => <li>{s.movement}</li>)}</ul>
      <dd>{body.hydration}</dd>
      <p className="bodygroup-stopline">{body.safety_stop}</p>
    </div>
  );
}
`;
  const goodScreen = `<BodyContractView body={pillars.body} />`;
  const goodCss = `
.bodygroup-movement { border-left-color: var(--gold); }
.bodygroup-intake { border-left-color: var(--blush-deep); }
.bodygroup-medical { border-left-color: var(--rose); }
.bodygroup-stop { border-left-color: var(--reject); }
`;
  const good = { contract: goodContract, view: goodView, screen: goodScreen, css: goodCss };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: a payload field with no group at all",
      input: { ...good, contract: goodContract.replace("  hydration: string;\n", "  hydration: string;\n  medication: string;\n") },
      expect: 1,
    },
    {
      name: "a field classified and then never rendered at all",
      input: { ...good, view: goodView.replace("<dd>{body.hydration}</dd>", "") },
      expect: 1,
    },
    {
      /*
       * THE CASE THAT CAUGHT THIS SCAN OUT. The first draft asked only whether the field NAME
       * appeared in the view, and a field left behind in a boolean guard satisfied it while
       * rendering nothing — which is the state `language_rule` was actually in.
       */
      name: "a field left behind in a guard, rendering nothing",
      input: { ...good, view: goodView.replace("<dd>{body.hydration}</dd>", "{body.hydration && <span />}") },
      expect: 1,
    },
    {
      name: "THE OTHER HALF: the safety stop filed as a movement",
      input: { ...good, view: goodView.replace('safety_stop: "stop"', 'safety_stop: "movement"') },
      expect: 1,
    },
    {
      name: "every field collapsed back into one kind",
      input: {
        ...good,
        view: goodView.replace('hydration: "intake"', 'hydration: "movement"').replace('safety_stop: "stop"', 'safety_stop: "movement"'),
      },
      expect: 1,
    },
    {
      name: "two kinds sharing a rail colour",
      input: { ...good, css: goodCss.replace(".bodygroup-intake { border-left-color: var(--blush-deep); }", ".bodygroup-intake { border-left-color: var(--gold); }") },
      expect: 1,
    },
    {
      name: "a kind with no rule in the stylesheet",
      input: { ...good, css: goodCss.replace(".bodygroup-stop { border-left-color: var(--reject); }", "") },
      expect: 1,
    },
    {
      name: "groups rendered with no labels",
      input: { ...good, view: goodView.replace(/bodygroup-label/g, "row-sub") },
      expect: 1,
    },
    {
      name: "a registry entry for a field the payload does not have",
      input: { ...good, view: goodView.replace('hydration: "intake",', 'hydration: "intake",\n  skincare: "intake",') },
      expect: 1,
    },
    {
      name: "the view exists and the screen never renders it",
      input: { ...good, screen: "// nothing here" },
      expect: 1,
    },
    { name: "RULE 0 — no BodyContract interface to read", input: { ...good, contract: "// gone" }, expect: 1 },
    { name: "RULE 0 — no registry to read", input: { ...good, view: goodView.replace("BODY_FIELD_GROUPS", "SOMETHING_ELSE") }, expect: 1 },
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
    console.error(`\nthe-body-contract-shows-its-kinds self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-body-contract-shows-its-kinds self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missing = [CONTRACT, VIEW, SCREEN, CSS].filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.error(`the-body-contract-shows-its-kinds FAILED — ${missing.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const contract = readFileSync(join(ROOT, CONTRACT), "utf8");
  const view = readFileSync(join(ROOT, VIEW), "utf8");
  const problems = check({
    contract,
    view,
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    css: readFileSync(join(ROOT, CSS), "utf8"),
  });

  if (problems.length) {
    console.error("the-body-contract-shows-its-kinds FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const fields = contractFields(contract);
  const kinds = new Set(Object.values(registry(view)));
  console.log(
    `the-body-contract-shows-its-kinds: all ${fields.length} Body contract fields are classified into ` +
    `${kinds.size} visually distinct kinds and every one is rendered. OK.`,
  );
}
