#!/usr/bin/env node
/**
 * THE GRID IN THE SYSTEM IS HER GRID, EXACTLY, AND THE EXCLUSIONS ARE NAMED RATHER THAN ABSENT.
 *
 * ─── Her words ──────────────────────────────────────────────────────────────
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 * ─── Why a validator and not a comment ─────────────────────────────────────
 *
 * "The grid" is a DEFINED TERM, agreed 29 August 2026: one exact set, keyed by canonical domain, and
 * never re-derived from a directory listing. Three things had already gone wrong for want of holding
 * that:
 *
 *   1. `today/projects.ts` carried five vague `spry` entries with no repo field and no domains, and
 *      a run that read it reported she had "4 side hustles".
 *   2. `spry-heartbeat.mjs` kept a SECOND list of eight repos, assembled from `gh repo list`, which
 *      included two she had never named and omitted four she had — both client repos among them.
 *   3. AN AGENT WORKING "PORTFOLIO-WIDE" BRANCHED AND MERGED INTO `west-peek-network-os`. She caught
 *      it and said it does not pertain. That is the expensive one, and it is the reason the
 *      exclusions have to be NAMED: an exclusion that is merely an absence is picked up again by the
 *      very next scope that says "all her repos", and nothing objects.
 *
 * So the table she gave is written down here, as the expectation, and the build fails if the system's
 * grid stops matching it. This file is the second copy on purpose — a validator's fixture IS allowed
 * to be the second copy, because its whole job is to disagree with the first one.
 *
 * ─── THE CASE THAT MADE THIS A RULE, KEPT AS A FIXTURE ─────────────────────
 *
 * `local-guides-generator` owns FIVE of the properties on its own — uscisexam, dentistryguides,
 * theaccidentguides, neuroevalguides, hormonesivhair. It is also the one she called secondary, so it
 * is the one most likely to be quietly dropped by somebody tidying up. Dropping it loses five
 * properties in one edit, and the negative proof below does exactly that and shows the guard name it.
 *
 * RULE 0: an empty grid HARD-FAILS. A scan over no properties proves nothing while reading as a pass.
 *
 *   node scripts/validate/the-grid-is-her-twelve-properties.mjs
 *   node scripts/validate/the-grid-is-her-twelve-properties.mjs --self-test
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRID_FILE = "src/shared/boss/grid.mjs";

/**
 * HER TABLE, VERBATIM.
 *
 * `domains` is what she named. The wedding cluster and the authority network she gave by label and
 * count rather than by domain, so `count` carries that and `domains` stays empty — inventing four
 * plausible wedding domains to make the column look full is exactly how a grid stops being one.
 */
export const HER_GRID = [
  {
    repos: ["local-guides-generator"],
    tier: "secondary",
    owner: "hers",
    domains: ["uscisexam.com", "dentistryguides.com", "theaccidentguides.com", "neuroevalguides.com", "hormonesivhair.com"],
  },
  { repos: ["local-guides-citation-velocity"], tier: "primary", owner: "hers", domains: ["theindustryguides.com"] },
  { repos: ["horse-legal-guide-velocity"], tier: "primary", owner: "client", domains: ["horselegalguide.com"] },
  { repos: ["hicks-consulting-canonical"], tier: "primary", owner: "client", domains: ["hicksconsulting.org"] },
  { repos: ["WPP-llm"], tier: "primary", owner: "hers", domains: ["virtualagency-os.com"] },
  {
    // ONE PROPERTY, TWO DOMAINS. hpc = high performance coach. Never counted as two.
    repos: ["sprylabs-hpc-site"],
    tier: "primary",
    owner: "hers",
    domains: ["billionairehighperformancecoach.com", "spryexecutiveos.com"],
  },
  { repos: ["approvalprep"], tier: "primary", owner: "hers", domains: ["approvalprep.com"] },
  { repos: ["dream-wedding-builder"], tier: "primary", owner: "hers", domains: [], count: 4 },
  // Added 13 Sep 2026, her words: "all 3 are mine." See the note above HER_GRID.
  { repos: ["how-we-know"], tier: "primary", owner: "hers", domains: [], handles: ["@howweknowdeep"] },
  // time-2-read.com is hers and has NO repo on her GitHub. Named so its absence is a recorded fact
  // rather than something a later reader takes for an oversight.
  { repos: ["heygetonmylevel"], tier: "primary", owner: "hers", domains: ["heygetonmylevel.com", "time-2-read.com"] },
  { repos: ["authority-backlink-network", "p-n-p"], tier: "infrastructure", owner: "hers", domains: [] },
];

/**
 * Out of scope, and every one of these must be NAMED in the system's own exclusion list.
 *
 * `west-peek` is first because it is the one with an incident behind it.
 */
export const HER_EXCLUSIONS = [
  "west-peek",
  "join-west-peek-main",
  "spry-vc",
  "secondaries",
  "founder-dilution-dashboard",
  "901johnsons-site",
  "cynthia-brown-dds-site",
  "sheila-bruce",
  "shannon-armstrong-bail-network",
  "dianne-place-recovery-services",
  "charm-nest",
  "courtscope",
  "agency-event-os",
];

export function check(grid) {
  const problems = [];
  const { GRID, EXCLUDED, isExcluded, suggestingKeys } = grid ?? {};

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  if (!Array.isArray(GRID) || GRID.length === 0) {
    problems.push(
      `${GRID_FILE} declares no grid. "The grid" is a defined term meaning one exact set of properties, ` +
      `and an empty one means everything downstream — the side-hustle slot, the daily examination, the ` +
      `spry lane in projects.ts — is scanning nothing while reporting success.`,
    );
    return problems;
  }
  if (!Array.isArray(EXCLUDED) || EXCLUDED.length === 0) {
    problems.push(
      `${GRID_FILE} names no exclusions. On 29 Aug 2026 an agent working "portfolio-wide" branched and ` +
      `merged into west-peek-network-os. An exclusion that is only an absence cannot stop that happening ` +
      `again, because the next scope that says "all her repos" includes it by default.`,
    );
    return problems;
  }

  // ── 1. Every property she named is present, with its repo ─────────────────
  const byRepo = new Map();
  for (const p of GRID) for (const r of p.repos ?? []) byRepo.set(r.toLowerCase(), p);

  for (const want of HER_GRID) {
    for (const repo of want.repos) {
      const got = byRepo.get(repo.toLowerCase());
      if (!got) {
        problems.push(
          `The grid does not contain \`${repo}\`, which is on her table` +
          (want.domains.length
            ? ` and carries ${want.domains.length} propert${want.domains.length === 1 ? "y" : "ies"}: ${want.domains.join(", ")}.`
            : ` (${want.count ?? want.repos.length} property/ies).`),
        );
        continue;
      }
      if (got.tier !== want.tier) {
        problems.push(
          `\`${repo}\` is \`${got.tier}\` in the grid and \`${want.tier}\` on her table.` +
          (want.tier === "secondary"
            ? ` Her words: "we really just include it in case something needs to be fixed but the content ` +
              `generator and all the real work is in velocity." A secondary property is watched and fixed ` +
              `and must not propose work to her in the ordinary course.`
            : want.tier === "infrastructure"
              ? ` projects.ts settles it: "A cost centre, not a line — never a day's work."`
              : ""),
        );
      }
      if (got.owner !== want.owner) {
        problems.push(
          `\`${repo}\` is "${got.owner}" in the grid and "${want.owner}" on her table. The client ` +
          `distinction is not decoration: a client property's "needs her" item is a reply in her name on ` +
          `somebody else's site, and it has to read as one.`,
        );
      }
      for (const d of want.domains) {
        if (!(got.domains ?? []).map((x) => x.toLowerCase()).includes(d)) {
          problems.push(`\`${repo}\` does not carry the domain ${d}. The grid is keyed by canonical domain, which is why a directory listing does not reproduce it.`);
        }
      }
    }
  }

  // ── 2. Nothing has crept in that is not on her table ──────────────────────
  const hers = new Set(HER_GRID.flatMap((p) => p.repos.map((r) => r.toLowerCase())));
  for (const repo of byRepo.keys()) {
    if (!hers.has(repo)) {
      problems.push(
        `The grid contains \`${repo}\`, which is NOT on her table. The grid is an exact set she defined; ` +
        `a repo added to it here is a repo she did not put in her portfolio, and it will start proposing ` +
        `work to her.`,
      );
    }
  }

  // ── 3. The exclusions are named, and west-peek is refused in practice ─────
  const named = (EXCLUDED ?? []).map((e) => String(e.match ?? "").toLowerCase());
  for (const x of HER_EXCLUSIONS) {
    if (!named.some((n) => x.toLowerCase().startsWith(n) || n.startsWith(x.toLowerCase()))) {
      problems.push(
        `\`${x}\` is not NAMED as excluded. Leaving it out is not the same as excluding it: the next ` +
        `portfolio-wide scope picks up whatever is not refused by name.`,
      );
    }
  }
  for (const e of EXCLUDED ?? []) {
    if (!String(e.why ?? "").trim()) {
      problems.push(`The exclusion "${e.match}" says no reason. A bare list decays into folklore and the next reader cannot tell a deliberate exclusion from a stale one.`);
    }
  }

  /*
   * ASSERTED ON BEHAVIOUR, NOT ONLY ON THE LIST. `isExcluded` has to refuse the repo in every form
   * it actually arrives in — bare name, `owner/name`, and the full path the local job holds. The
   * sibling guard `mayAutoFix` learned this the same way: a guard that only understands one form is
   * a guard with a hole in it.
   */
  if (typeof isExcluded === "function") {
    for (const form of [
      "west-peek-network-os",
      "seq23/west-peek-network-os",
      "/Users/sequoiataylor/GitHub/west-peek-os",
      "CourtScope_api",
    ]) {
      if (!isExcluded(form)) {
        problems.push(`isExcluded("${form}") returned false. It is out of scope in every form it can arrive in, or it is not out of scope.`);
      }
    }
    for (const inScope of ["approvalprep", "seq23/WPP-llm", "/Users/sequoiataylor/GitHub/sprylabs-hpc-site"]) {
      if (isExcluded(inScope)) problems.push(`isExcluded("${inScope}") returned true — a grid property was refused as out of scope.`);
    }
  } else {
    problems.push(`${GRID_FILE} exports no \`isExcluded\`, so nothing can enforce the exclusions in practice.`);
  }

  // ── 4. Only primary properties may propose work to her ────────────────────
  if (typeof suggestingKeys === "function") {
    const suggesting = new Set(suggestingKeys());
    for (const p of GRID) {
      if (p.tier !== "primary" && suggesting.has(p.key)) {
        problems.push(
          `\`${p.key}\` is ${p.tier} and is still allowed to put an item in front of her. ` +
          `${p.why_tier ?? "Watched and fixed, never suggested."}`,
        );
      }
    }
    if (suggesting.size === 0) {
      problems.push(`suggestingKeys() is empty, so the side-hustle slot can never produce anything and would be silently retired.`);
    }
  } else {
    problems.push(`${GRID_FILE} exports no \`suggestingKeys\`.`);
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function fixture(over = {}) {
  const GRID = (over.GRID ?? HER_GRID.map((p, i) => ({
    key: `k${i}`,
    label: `L${i}`,
    domains: p.domains,
    property_count: p.count,
    repos: p.repos,
    owner: p.owner,
    tier: p.tier,
  })));
  const EXCLUDED = over.EXCLUDED ?? HER_EXCLUSIONS.map((m) => ({ match: m, why: "Out of scope." }));
  const isExcluded = (repo) => {
    const name = String(repo ?? "").toLowerCase().replace(/\/+$/, "").split("/").pop() ?? "";
    return EXCLUDED.some((e) => name.startsWith(String(e.match).toLowerCase()));
  };
  const suggestingKeys = over.suggestingKeys ?? (() => GRID.filter((p) => p.tier === "primary").map((p) => p.key));
  return { GRID, EXCLUDED, isExcluded, suggestingKeys };
}

function selfTest() {
  const cases = [
    { name: "her table passes", input: fixture(), expect: 0 },
    {
      name: "THE CASE THAT MADE THIS A RULE: local-guides-generator dropped, losing five properties",
      input: fixture({ GRID: fixture().GRID.filter((p) => !p.repos.includes("local-guides-generator")) }),
      expect: 1,
    },
    {
      name: "the generator promoted out of secondary, so it starts proposing work to her",
      input: (() => {
        const f = fixture();
        f.GRID.find((p) => p.repos.includes("local-guides-generator")).tier = "primary";
        return f;
      })(),
      expect: 1,
    },
    {
      name: "a client repo recorded as hers",
      input: (() => {
        const f = fixture();
        f.GRID.find((p) => p.repos.includes("hicks-consulting-canonical")).owner = "hers";
        return f;
      })(),
      expect: 1,
    },
    {
      name: "bhpc and spryexecutiveos split into two properties",
      input: (() => {
        const f = fixture();
        f.GRID.find((p) => p.repos.includes("sprylabs-hpc-site")).domains = ["billionairehighperformancecoach.com"];
        return f;
      })(),
      expect: 1,
    },
    {
      name: "a repo she never named added to the grid",
      input: (() => {
        const f = fixture();
        f.GRID.push({ key: "extra", label: "x", domains: [], repos: ["some-experiment"], owner: "hers", tier: "primary" });
        return f;
      })(),
      expect: 1,
    },
    {
      name: "THE INCIDENT: west-peek no longer named as excluded",
      input: fixture({ EXCLUDED: HER_EXCLUSIONS.filter((m) => !m.includes("west-peek")).map((m) => ({ match: m, why: "Out of scope." })) }),
      expect: 1,
    },
    {
      name: "an exclusion with no reason behind it",
      input: fixture({ EXCLUDED: HER_EXCLUSIONS.map((m) => ({ match: m, why: "" })) }),
      expect: 1,
    },
    {
      name: "infrastructure allowed to propose a day's work",
      input: (() => {
        const f = fixture();
        f.suggestingKeys = () => f.GRID.map((p) => p.key);
        return f;
      })(),
      expect: 1,
    },
    { name: "RULE 0 — an empty grid", input: fixture({ GRID: [] }), expect: 1 },
    { name: "RULE 0 — no exclusions at all", input: fixture({ EXCLUDED: [] }), expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
      if (c.expect === 0) for (const p of check(c.input)) console.error(`          • ${p}`);
    }
  }
  if (failed) {
    console.error(`\nthe-grid-is-her-twelve-properties self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-grid-is-her-twelve-properties self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  let grid = null;
  try {
    grid = await import(join(ROOT, GRID_FILE));
  } catch (err) {
    console.error(`the-grid-is-her-twelve-properties FAILED — ${GRID_FILE} could not be read: ${err?.message ?? err}`);
    process.exit(1);
  }

  const problems = check(grid);
  if (problems.length) {
    console.error("the-grid-is-her-twelve-properties FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    console.error(
      '"The grid" is a defined term of hers, agreed 29 August 2026: one exact set of properties, keyed by\n' +
      "canonical domain. It is never re-derived from a directory listing and she is never asked which\n" +
      "repos she meant.\n",
    );
    process.exit(1);
  }

  const properties = grid.GRID.reduce((n, p) => n + Math.max(p.domains.length, p.property_count ?? 1), 0);
  console.log(
    `the-grid-is-her-twelve-properties: ${grid.GRID.length} grid rows covering ${properties} propert(ies) ` +
    `across ${grid.gridRepos().length} repositories, ${grid.suggestingKeys().length} of them allowed to ` +
    `propose work to her, and ${grid.EXCLUDED.length} exclusions named — west-peek among them. OK.`,
  );
  selfTest();
}
