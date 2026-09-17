#!/usr/bin/env node
/**
 * A STAGE MOVE IS THE RECORD'S OWN FACT, AND A REFUSAL IS NOT A DEAD ROW.
 *
 * ─── The defect ─────────────────────────────────────────────────────────────
 *
 * The Dealflow board computed the next stage itself — `SPINE.find(order + 1)` against its own
 * last-fetched copy of the deal — and sent it to `/transition` as an absolute target. That makes
 * the page the authority on a fact only the record holds, and it LOSES PRESSES:
 *
 *     press ──▶ server moves NEW → SCREENING ──▶ board.reload() starts
 *     press ──▶ board still says NEW, so the button still says "move to screening"
 *            ──▶ POST { to: "SCREENING" } ──▶ record is ALREADY SCREENING
 *            ──▶ OPPORTUNITY_TRANSITIONS refuses it as illegal, correctly
 *            ──▶ the move the partner asked for does not happen
 *
 * And it stayed broken, because `moveTo` called `onChanged()` only on success. The row kept the
 * stale copy that caused the refusal, so it offered the same refused move again — for ever, until
 * somebody reloaded the page by hand.
 *
 * `p57`'s pipeline walk caught this at a DIFFERENT STAGE on every run, which is what a lost race
 * looks like from the outside and is why it read as flake. It is not flake. A partner pressing
 * "move it on" twice in quick succession gets a dead row.
 *
 * ─── What is checked, by RUNNING the shipped code ───────────────────────────
 *
 *   1. THE STALE-CLIENT RACE IS REPLAYED over every stage of the spine, using the real
 *      `nextStageKey`. For each step it computes what a client one stage behind would have named,
 *      and shows that (a) that stale target differs from the true next stage — so the race is real
 *      and not theoretical — and (b) reading from the record gives the right answer anyway.
 *   2. EVERY SPINE STEP IS A LEGAL TRANSITION, checked against the lifecycle map parsed out of
 *      `investment.ts`. Two lists of the same facts with no link between them is the defect this
 *      repository is written against; this is the link.
 *   3. OFF THE SPINE AND AT THE END OF IT, THERE IS NO NEXT STAGE. `CLOSED`, `PASS` and
 *      `WITHDRAWN` return null rather than a guess.
 *   4. NO ADVANCE CONTROL NAMES A STAGE. Every `deal-advance` / `deal-record-advance` control is
 *      wired to a handler that posts to `/advance`, and no handler reachable from one sends a
 *      `to:` it computed from `next`.
 *   5. THE SERVER ADVANCE PATH EXISTS END TO END: `nextStageKey` → `nextOnSpine` →
 *      `advanceOpportunity` → a handler → a registered route. A guard that cannot be reached
 *      governs nothing.
 *   6. EVERY MOVE HANDLER RE-READS ON REFUSAL, so a row refused for being stale stops being stale.
 *
 * RULE 0: zero spine steps replayed is a HARD FAILURE. An empty spine would make every rule above
 * pass over nothing, which is the "runs but inert" defect wearing a green tick.
 *
 *   node scripts/validate/a-stage-move-is-the-records-own.mjs
 *   node scripts/validate/a-stage-move-is-the-records-own.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PIPELINE = "src/shared/investment/pipeline.ts";
const SERVICE = "src/worker/services/investment.ts";
const ROUTES = "src/worker/index.ts";
const BOARD = "src/client/pages/DealflowPage.tsx";

/** Strip comment lines, so a rule never passes on prose that merely describes it. */
const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

/**
 * The lifecycle map, read out of the service rather than restated here.
 *
 * A validator carrying its own copy of the transitions would be a THIRD list, and the first thing
 * it would stop catching is the two it was written to keep in agreement.
 */
export function parseTransitions(serviceSrc) {
  const block = /OPPORTUNITY_TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(serviceSrc);
  if (!block) return null;
  const map = {};
  for (const m of block[1].matchAll(/^\s*([A-Z_]+):\s*\[([^\]]*)\]/gm)) {
    map[m[1]] = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
  }
  return Object.keys(map).length ? map : null;
}

export function check({ steps, transitions, offSpine, service, routes, board }) {
  const problems = [];
  const serviceCode = code(service);
  const boardCode = code(board);

  // ── RULE 0 ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(steps) || steps.length === 0) {
    problems.push(
      "No spine steps were replayed, so every rule below examined nothing. An empty spine is a " +
      "hard failure, not a pass on an empty loop.",
    );
    return problems;
  }
  if (!transitions) {
    problems.push(
      `Could not read OPPORTUNITY_TRANSITIONS out of ${SERVICE}. The lifecycle is the authority on ` +
      `whether a spine step is legal, and a validator that cannot find it is checking the spine ` +
      `against nothing.`,
    );
    return problems;
  }

  for (const s of steps) {
    // ── 1. The race is real, and reading from the record survives it ─────────
    if (s.next === null) {
      problems.push(
        `${s.from} is on the spine and has no next stage. The walk stops there and the control ` +
        `would offer nothing.`,
      );
      continue;
    }
    if (s.staleNext !== null && s.staleNext === s.next) {
      problems.push(
        `A client one stage behind at ${s.from} would have named ${s.staleNext}, which is the same ` +
        `as the true next stage. That makes this step's replay prove nothing — the fixture is ` +
        `wrong, not the code.`,
      );
    }
    if (s.staleNext !== null && transitions[s.from]?.includes(s.staleNext)) {
      problems.push(
        `At ${s.from}, the stale target ${s.staleNext} is STILL a legal transition. The lost press ` +
        `would then move the deal somewhere nobody asked for, which is worse than a refusal.`,
      );
    }

    // ── 2. Every spine step is a legal transition ───────────────────────────
    if (!transitions[s.from]?.includes(s.next)) {
      problems.push(
        `The spine steps ${s.from} → ${s.next}, and OPPORTUNITY_TRANSITIONS does not allow it ` +
        `(${(transitions[s.from] ?? []).join(", ") || "nothing"}). The board's order and the ` +
        `lifecycle have drifted apart, and the board is the one deciding where deals go.`,
      );
    }
  }

  // ── 3. Off the spine, and at the end of it, there is no next stage ─────────
  for (const [status, next] of Object.entries(offSpine)) {
    if (next !== null) {
      problems.push(
        `${status} is not a place a deal moves on from, and the spine offered ${next}. ` +
        `CLOSED is the end of the line; PASS and WITHDRAWN are decisions, and reopening one is a ` +
        `deliberate move to SCREENING that a person makes, never a step something takes for them.`,
      );
    }
  }

  // ── 4. No advance control names a stage ───────────────────────────────────
  // A window around each control, because the testid and the onClick sit on one line in one place
  // and on separate lines in the other. Slicing beats a regex that has to know the formatting.
  const advanceControls = [...boardCode.matchAll(/deal-advance-|deal-record-advance/g)].map((m) =>
    boardCode.slice(Math.max(0, m.index - 300), m.index + 300),
  );
  if (advanceControls.length === 0) {
    problems.push(
      `${BOARD} renders no advance control at all. The endpoint would then be the "exists but ` +
      `nothing invokes it" defect.`,
    );
  }
  for (const window of advanceControls) {
    const onClick = /onClick=\{\(\)\s*=>\s*void\s+(\w+)\(([^)]*)\)/.exec(window);
    if (!onClick) {
      problems.push(`An advance control in ${BOARD} has no recognisable onClick; it cannot be checked.`);
      continue;
    }
    if (onClick[1] !== "advance" || onClick[2].trim() !== "") {
      problems.push(
        `An advance control in ${BOARD} calls \`${onClick[1]}(${onClick[2]})\`. "Move it on" must ` +
        `carry NO target — the moment the page names a stage, a page that is one reload behind ` +
        `names the wrong one and the press is lost.`,
      );
    }
  }
  if (/\/advance`?,?\s*\{\s*method:\s*"POST",\s*body/.test(boardCode)) {
    problems.push(`${BOARD} sends a body to /advance. There is nothing to send, and anything sent can be stale.`);
  }
  if (!/opportunities\/\$\{[^}]+\}\/advance/.test(boardCode)) {
    problems.push(`${BOARD} never calls the /advance endpoint, so the board is still naming stages itself.`);
  }

  // ── 5. The path runs end to end ───────────────────────────────────────────
  if (!/export function nextStageKey/.test(code(readFileSync(join(ROOT, PIPELINE), "utf8")))) {
    problems.push(`${PIPELINE} does not export \`nextStageKey\`, so the spine has no single owner.`);
  }
  if (!/nextStageKey/.test(serviceCode)) {
    problems.push(
      `${SERVICE} does not read \`nextStageKey\`. If it keeps its own copy of the order, the two ` +
      `lists drift and the drifted one decides where deals go.`,
    );
  }
  if (!/export async function advanceOpportunity/.test(serviceCode)) {
    problems.push(`${SERVICE} has no \`advanceOpportunity\`, so nothing computes the target from the record.`);
  }
  if (!/export async function handleAdvanceOpportunity/.test(serviceCode)) {
    problems.push(`${SERVICE} has no handler for it, so the function cannot be reached over HTTP.`);
  }
  if (!/\.post\("\/api\/opportunities\/:id\/advance", handleAdvanceOpportunity\)/.test(code(routes))) {
    problems.push(
      `${ROUTES} does not register the advance route. A guard that cannot be reached governs ` +
      `nothing — Rule 0 applies to the route table too.`,
    );
  }

  // ── 6. A refusal re-reads ─────────────────────────────────────────────────
  if (/if\s*\(!failed\)\s*reloadAll\(\)/.test(boardCode) || /else\s+onChanged\(\)/.test(boardCode)) {
    problems.push(
      `${BOARD} still re-reads only when a move SUCCEEDS. The usual cause of a refusal is that this ` +
      `copy of the deal is behind the record, and keeping the stale copy is what turned one lost ` +
      `press into a row that refused every press after it.`,
    );
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

/**
 * Replay the race against the real `nextStageKey`.
 *
 * `staleNext` is what a board ONE STAGE BEHIND would have named — the exact condition the lost
 * press happens under. It is computed with the same shipped function, from the previous status, so
 * the fixture cannot drift away from the code it is testing.
 */
async function replay() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, PIPELINE)}`);
  const spine = mod.SPINE.map((s) => s.key);

  const steps = [];
  for (let i = 0; i < spine.length - 1; i++) {
    steps.push({
      from: spine[i],
      next: mod.nextStageKey(spine[i]),
      // A page still showing the PREVIOUS stage names the stage the record has just left.
      staleNext: i === 0 ? null : mod.nextStageKey(spine[i - 1]),
    });
  }

  const offSpine = {};
  for (const s of ["CLOSED", "PASS", "WITHDRAWN"]) offSpine[s] = mod.nextStageKey(s);
  return { steps, offSpine };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const { steps, offSpine } = await replay();
  const service = readFileSync(join(ROOT, SERVICE), "utf8");
  const good = {
    steps,
    offSpine,
    transitions: parseTransitions(service),
    service,
    routes: readFileSync(join(ROOT, ROUTES), "utf8"),
    board: readFileSync(join(ROOT, BOARD), "utf8"),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "RULE 0: an empty spine passes over nothing",
      input: { ...good, steps: [] },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: the control names the stage again",
      input: {
        ...good,
        board: good.board.replace("onClick={() => void advance()}", "onClick={() => void moveTo(next.key)}"),
      },
      expect: 1,
    },
    {
      name: "the board stops calling /advance",
      input: { ...good, board: good.board.replaceAll("/advance", "/transition") },
      expect: 1,
    },
    {
      name: "THE SECOND DEFECT: a refusal no longer re-reads",
      input: { ...good, board: good.board.replace("    onChanged();\n  }", "    else onChanged();\n  }") },
      expect: 1,
    },
    {
      name: "the route is never registered",
      input: { ...good, routes: good.routes.replace('.post("/api/opportunities/:id/advance", handleAdvanceOpportunity)', "") },
      expect: 1,
    },
    {
      name: "the spine steps somewhere the lifecycle forbids",
      input: { ...good, transitions: { ...good.transitions, SCREENING: ["PASS", "WITHDRAWN"] } },
      expect: 1,
    },
    {
      name: "a terminal stage offers a next one",
      input: { ...good, offSpine: { ...good.offSpine, CLOSED: "NEW" } },
      expect: 1,
    },
    {
      name: "the service keeps its own copy of the order",
      input: { ...good, service: good.service.replaceAll("nextStageKey", "ownPrivateSpine") },
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found > 0;
    if (!ok) {
      failed++;
      console.error(`  ✘ ${c.name}: expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }
  if (failed) {
    console.error(`\na-stage-move-is-the-records-own self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-stage-move-is-the-records-own self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missing = [PIPELINE, SERVICE, ROUTES, BOARD].filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.error(`a-stage-move-is-the-records-own FAILED — ${missing.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const { steps, offSpine } = await replay();
  const service = readFileSync(join(ROOT, SERVICE), "utf8");
  const problems = check({
    steps,
    offSpine,
    transitions: parseTransitions(service),
    service,
    routes: readFileSync(join(ROOT, ROUTES), "utf8"),
    board: readFileSync(join(ROOT, BOARD), "utf8"),
  });

  if (problems.length) {
    console.error("a-stage-move-is-the-records-own FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-stage-move-is-the-records-own: ${steps.length} spine steps replayed under a one-stage-stale ` +
    `board; every stale target is refused by the lifecycle and every true target is legal, ` +
    `${Object.keys(offSpine).length} stages off the end of the line offer nothing, no advance ` +
    `control names a stage, the path runs nextStageKey → nextOnSpine → advanceOpportunity → ` +
    `handler → route, and a refusal re-reads. OK.`,
  );
}
