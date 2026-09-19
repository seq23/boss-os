#!/usr/bin/env node
/**
 * THE SPEND LEVER ON SCREEN IS THE SPEND LEVER THE ROUTER OBEYS.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * On 18 September 2026 production read:
 *
 *   settings.spend_lever                 = 'MODERATE'
 *   settings.spend_lever_moderate_micros = 25000000      ($25.00 per backend, per month)
 *
 * and the Settings screen said FREE ONLY — $0. Nothing threw, nothing was logged, and no test
 * failed. `GET /system/spend-lever` answers `{ lever, positions, lane_budgets, backend_spend }`;
 * the panel stored the whole envelope and read `envelope.position` — one level too shallow on every
 * line. Every read fell through to a fallback derived from `budgets.hard_stop`, and `setSpendLever`
 * writes `hard_stop = 1` for MODERATE as well as FREE_ONLY, so that fallback was a two-state guess
 * at a three-state lever. It could never say MODERATE, and it defaulted to the reassuring end.
 *
 * WHAT THAT COSTS. This is the one screen whose entire job is telling her whether money may be
 * spent, on an account already $48.67 into a month against a ~$10 target. It told her $0 was the
 * ceiling while $25 a backend was authorised, and it hid the input that would have let her change
 * the figure — that input renders only at `position === "MODERATE"`, which could never be true.
 *
 * ─── Why this is a runnable check and not a comment ─────────────────────────
 *
 * The derivation now lives in `src/shared/boss/spendLeverView.mjs` rather than inline in the TSX,
 * for one reason: a derivation inside a component is one no test can reach without rendering, and
 * this one was wrong for as long as it existed while every test passed. Here it is run against the
 * exact envelope the route returns.
 *
 *   1. THE ENVELOPE THE ROUTE SENDS IS THE ENVELOPE THE VIEW READS. The route's `ok(c, {...})` keys
 *      are parsed out of `routes/models.ts` and fed to `leverView`. A rename on either side fails
 *      here rather than rendering a wrong position in silence.
 *   2. EVERY POSITION SURVIVES THE ROUND TRIP, MODERATE INCLUDED. The case that was broken is the
 *      case that is pinned.
 *   3. AN UNREADABLE LEVER NAMES NO POSITION. `known` is false and `position` is null — never a
 *      guess, and never the reassuring one.
 *   4. THE SCREEN DOES NOT DERIVE A POSITION OF ITS OWN. `Settings.tsx` must call `leverView` and
 *      must not read `hard_stop`, which is what the old guess was built from.
 *   5. THE FIGURE'S SCOPE IS STATED. The lever's allowance is per backend; `spentScope` must say
 *      which population `spent` came from, so a label can never claim a scope the figure lacks.
 *
 * RULE 0: examining zero positions is a FAILURE. SPEND_LEVER_POSITIONS is read from the server, so
 * an empty or unparseable list is a broken scan rather than a clean repo.
 *
 *   node scripts/validate/the-lever-she-sees-is-the-lever-that-spends.mjs
 *   node scripts/validate/the-lever-she-sees-is-the-lever-that-spends.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leverView } from "../../src/shared/boss/spendLeverView.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/*
 * THE ROUTE THE CLIENT CALLS, not a route that happens to share the name. On 19 September 2026 the
 * scan parsed `models.get("/spend-lever")` (/api/models/spend-lever) while `api.spendLever()` calls
 * `/system/spend-lever`, served by `spendLeverRoutes.get("/")` in routes/backends.ts — which
 * answered the flat state, so the panel read "could not be read" on every healthy build and this
 * scan was green. Both routes are parsed now, and the client's path is checked against the mount.
 */
const ROUTE = "src/worker/boss/routes/backends.ts";
const SIBLING_ROUTE = "src/worker/boss/routes/models.ts";
const CLIENT_API = "src/client/boss/api.ts";
const MOUNT = "src/worker/boss/index.ts";
const STATE = "src/worker/boss/router/spend.ts";
const SCREEN = "src/client/boss/pages/Settings.tsx";

/**
 * The top-level keys `GET /spend-lever` puts in its response body.
 *
 * READ FROM THE ROUTE, NOT LISTED HERE. A list here would be the second copy of the thing whose
 * first copy is what drifted.
 */
export function envelopeKeys(src, handler = 'spendLeverRoutes.get("/"') {
  const at = src.indexOf(handler);
  if (at < 0) return [];
  const body = src.slice(at, src.indexOf("});", at));
  const ret = body.indexOf("return ok(c, {");
  if (ret < 0) return [];
  const obj = body.slice(ret + "return ok(c, {".length);
  /*
   * Top-level keys only: a key at the start of a line with exactly four spaces of indent. The
   * SHORTHAND FORM MUST COUNT — `lever,` with no colon is exactly how the one key that matters is
   * written, and a colon-only pattern read the envelope as not carrying it at all.
   */
  return [...obj.matchAll(/^ {4}([a-z_]+)\s*(?::|,\s*$)/gm)].map((m) => m[1]);
}

/**
 * The source of the `SpendLever` component alone.
 *
 * Runs to the next top-level `function ` declaration, which is how every other component in this
 * file is separated. Returns "" when the declaration is gone, so the caller can fail loudly rather
 * than scan an empty string and pass.
 */
export function leverComponent(src) {
  const at = src.indexOf("function SpendLever(");
  if (at < 0) return "";
  const next = src.indexOf("\nfunction ", at + 1);
  return src.slice(at, next < 0 ? src.length : next);
}

/** Every position the server will accept, read from its own constant. */
export function serverPositions(src) {
  const m = /SPEND_LEVER_POSITIONS\s*=\s*\[([^\]]*)\]/.exec(src);
  return m ? [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]) : [];
}

/**
 * Build the envelope exactly as the route does, for one position.
 *
 * The nested shape and the camelCase spelling are both deliberate: they are what the server really
 * sends, and both are what the old flat snake_case reads missed.
 */
function envelopeFor(position, moderateMicros = 25_000_000) {
  const allowanceMicros = position === "MODERATE" ? moderateMicros : 0;
  return {
    lever: {
      position,
      allowanceMicros,
      uncapped: position === "OPEN",
      moderateMicros,
      moderateSource: "owner_set",
      label: `label for ${position}`,
      remedy: `remedy for ${position}`,
    },
    positions: ["FREE_ONLY", "MODERATE", "OPEN"],
    lane_budgets: [{ lane: "ops", period: "month", limit_micros: 52_500_000, spent_micros: 0, hard_stop: 1 }],
    backend_spend: [
      { id: "bk_anthropic", spent_micros: 1_000_000, own_ceiling_micros: 5_000_000 },
      { id: "bk_claude_code", spent_micros: 24_926_608, own_ceiling_micros: 50_000_000 },
    ],
  };
}

function scan() {
  const problems = [];
  const routeSrc = read(ROUTE);
  const screenSrc = read(SCREEN);
  const positions = serverPositions(read(STATE)).length > 0
    ? serverPositions(read(STATE))
    : serverPositions(routeSrc);

  // 1. The envelope the route sends carries the key the view reads.
  const keys = envelopeKeys(routeSrc);
  if (!keys.includes("lever")) {
    problems.push(
      `${ROUTE}'s /spend-lever response does not carry a top-level \`lever\` key (it carries ` +
      `[${keys.join(", ")}]). \`leverView\` reads \`envelope.lever\`, so the panel would show no ` +
      `position at all — or, before this guard existed, a guessed one.`,
    );
  }
  if (!keys.includes("backend_spend")) {
    problems.push(
      `${ROUTE}'s /spend-lever response does not carry \`backend_spend\`, which is the population the ` +
      `lever's per-backend allowance is measured against.`,
    );
  }

  // 1b. The sibling route at /api/models/spend-lever answers the same envelope, so the two can
  // never drift apart again — a screen switched from one path to the other reads the same shape.
  const siblingKeys = envelopeKeys(read(SIBLING_ROUTE), 'models.get("/spend-lever"');
  for (const key of ["lever", "backend_spend"]) {
    if (!siblingKeys.includes(key)) {
      problems.push(`${SIBLING_ROUTE}'s /spend-lever response does not carry \`${key}\`; the two lever routes must answer one envelope.`);
    }
  }

  // 1c. THE CLIENT CALLS THE ROUTE THIS SCAN PARSES. `api.spendLever()` names a path; the mount in
  // index.ts says which handler serves it. If either moves, the scan is looking at the wrong door.
  const apiSrc = read(CLIENT_API);
  const apiPath = /spendLever:\s*\(\)\s*=>\s*call<[^>]*>\("([^"]+)"\)/.exec(apiSrc)?.[1] ?? null;
  if (apiPath !== "/system/spend-lever") {
    problems.push(`${CLIENT_API} spendLever() calls ${apiPath ?? "no readable path"}; this scan parses the handler behind /system/spend-lever.`);
  }
  if (!/app\.route\("\/api\/system\/spend-lever",\s*spendLeverRoutes\)/.test(read(MOUNT))) {
    problems.push(`${MOUNT} does not mount spendLeverRoutes at /api/system/spend-lever, so the client's path is not served by the handler this scan parses.`);
  }

  // 2 and 5. Every position survives the round trip.
  let checked = 0;
  for (const position of positions) {
    checked += 1;
    const view = leverView(envelopeFor(position), { spent_micros: 0, limit_micros: 52_500_000 });
    if (view.position !== position) {
      problems.push(
        `leverView showed "${view.position}" for a lever stored at "${position}". This is the ` +
        `18 Sep 2026 fault exactly: MODERATE rendered as "Free only" and told her no money could be ` +
        `spent while $25 a backend was authorised.`,
      );
    }
    if (!view.known) {
      problems.push(`leverView reported the lever unreadable when it was stored at "${position}".`);
    }
    if (position === "MODERATE" && view.allowance !== 25_000_000) {
      problems.push(
        `At MODERATE, leverView's allowance is ${view.allowance} micros, not the lever's own ` +
        `25000000. The old panel showed the ops-month LANE budget here, which is a different scope ` +
        `and a different number.`,
      );
    }
    if (view.spentScope !== "dearest_backend") {
      problems.push(
        `At "${position}", leverView did not state that its figure came from a backend ` +
        `(spentScope = "${view.spentScope}"). The allowance is per backend, so a figure from any ` +
        `other population would be set against a ceiling it does not belong to.`,
      );
    }
  }

  // 3. An unreadable lever names no position.
  for (const [name, envelope] of [["null", null], ["an envelope with no lever", { positions: [] }]]) {
    const view = leverView(envelope, { spent_micros: 7, limit_micros: 52_500_000 });
    if (view.position !== null || view.known) {
      problems.push(
        `With ${name}, leverView invented the position "${view.position}". Guessing on this screen is ` +
        `worse than saying nothing: the guess that costs money is the reassuring one.`,
      );
    }
    if (view.spent !== 7) {
      problems.push(`With ${name}, leverView dropped the stated ops-month fallback figure.`);
    }
  }

  /*
   * 4. The screen does not derive a position of its own.
   *
   * SCOPED TO THE `SpendLever` COMPONENT, not to the whole file. `hard_stop` is read legitimately
   * elsewhere in Settings — the Budgets list prints "stops work at the limit" from it — and a
   * file-wide ban would have been a validator that fails on correct code, which is how a check gets
   * switched off rather than obeyed.
   */
  const code = leverComponent(screenSrc).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  if (code.length === 0) {
    problems.push(
      `${SCREEN} no longer contains a \`function SpendLever(\` declaration, so this scan could not ` +
      `find the component it governs and checked none of it.`,
    );
  }
  if (!/leverView\s*\(/.test(code)) {
    problems.push(
      `${SCREEN} does not call leverView. A derivation written inline in the component is one no test ` +
      `can reach without rendering, which is how this one stayed wrong while every test passed.`,
    );
  }
  if (/hard_stop/.test(code)) {
    problems.push(
      `${SCREEN} still reads \`hard_stop\` to decide what to show for the lever. That is the old ` +
      `two-state guess at a three-state lever — it writes 1 for MODERATE and FREE_ONLY alike, so it ` +
      `can only ever be right by accident.`,
    );
  }

  return { checked, problems };
}

// ─── Self-test: the source readers, proved on text ──────────────────────────

function selfTest() {
  let failed = 0;
  const cases = [
    {
      name: "the envelope's top-level keys are read",
      fn: (src) => envelopeKeys(src, 'models.get("/spend-lever"'),
      src: `models.get("/spend-lever", async (c) => {\n  const lever = 1;\n  return ok(c, {\n    lever,\n    positions: SPEND_LEVER_POSITIONS,\n    lane_budgets: (x).map((b) => ({\n      lane: b.lane,\n    })),\n    backend_spend: y,\n  });\n});`,
      want: ["lever", "positions", "lane_budgets", "backend_spend"],
    },
    {
      name: "the route the client calls is parsed by its own handler name",
      fn: envelopeKeys,
      src: `spendLeverRoutes.get("/", async (c) => {\n  return ok(c, {\n    lever: state,\n    positions: P,\n    backend_spend: y,\n  });\n});`,
      want: ["lever", "positions", "backend_spend"],
    },
    {
      name: "the flat state the route used to answer carries no lever key",
      fn: envelopeKeys,
      src: `spendLeverRoutes.get("/", async (c) => {\n  return ok(c, {\n    ...state,\n    allowance_micros: 1,\n    positions: P,\n  });\n});`,
      want: ["allowance_micros", "positions"],
    },
    {
      name: "a renamed envelope key is noticed",
      fn: (src) => envelopeKeys(src, 'models.get("/spend-lever"'),
      src: `models.get("/spend-lever", async (c) => {\n  return ok(c, {\n    spend_lever,\n    positions: P,\n  });\n});`,
      want: ["spend_lever", "positions"],
    },
    {
      name: "the lever component is isolated from its neighbours",
      fn: leverComponent,
      src: `function Other() { const x = b.hard_stop; }\nfunction SpendLever({ budgets }) {\n  return leverView(lever, opsMonth);\n}\nfunction After() { hard_stop; }\n`,
      want: "function SpendLever({ budgets }) {\n  return leverView(lever, opsMonth);\n}",
    },
    {
      name: "a removed lever component reads as empty rather than as the whole file",
      fn: leverComponent,
      src: `function Other() { hard_stop; }\n`,
      want: "",
    },
    {
      name: "the server's positions are read from its constant",
      fn: serverPositions,
      src: `export const SPEND_LEVER_POSITIONS = ["FREE_ONLY", "MODERATE", "OPEN"] as const;`,
      want: ["FREE_ONLY", "MODERATE", "OPEN"],
    },
  ];
  for (const c of cases) {
    const got = c.fn(c.src);
    if (JSON.stringify(got) !== JSON.stringify(c.want)) {
      console.error(`  ✗ ${c.name}: expected ${JSON.stringify(c.want)}, got ${JSON.stringify(got)}`);
      failed += 1;
    }
  }
  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { checked, problems } = scan();

if (checked === 0) {
  console.error(
    "SPEND LEVER SCAN EXAMINED NO POSITIONS. SPEND_LEVER_POSITIONS could not be read from\n" +
    "src/worker/boss/router/spend.ts, so every round-trip assertion ran over an empty list.\n" +
    "That is a broken scan, not a clean repo.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("SPEND LEVER SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A screen that says $0 while $25 a backend is authorised is worse than a screen that says\n" +
    "nothing: it is the one she checks in order to stop worrying about money.",
  );
  process.exit(1);
}

console.log(
  `SPEND LEVER SCAN PASSED: ${checked} position(s) round-trip from the route's envelope to the screen ` +
  `with the position, the allowance and the scope intact; an unreadable lever names none; and the ` +
  `screen derives nothing of its own from hard_stop.`,
);
selfTest();
