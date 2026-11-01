/**
 * THE VALIDATOR MATRIX (owner, 1 Nov 2026: "every validator × repo, the behaviour it protects, why,
 * kind, when it runs"). One pure module: the Mac runner (scripts/ops/validator-matrix.mjs, run inside
 * the Sunday cohesion check), the Worker (routes/validators.ts, the Monday line) and the page
 * (pages/Validators.tsx) all import it, so there is no second list.
 *
 * Sources, both read on her Mac, never copied into this public repo:
 *   1. The matrix rows: every `validators-<repo>.json` in ~/.boss-os/reviews/ (written by each repo's
 *      cleanup agent: [{ name, protects, why, kind, runs? }]). A new file is picked up on the next run
 *      by its name alone; nothing here lists the repos.
 *   2. Each repo's own registry, read from its `main`: the package scripts, validator files and CI
 *      step names it carries (`registryFrom`).
 *
 * Flagged, never blocking (owner, 1 Nov 2026): a matrix row its repo does not carry ("not in its
 * repo's list"), and a validator the repo carries that the matrix lacks ("not in the matrix"). They
 * reach Simone's Monday line through the cohesion check. Duplicates across repos are shown.
 *
 * RULE 0: zero review files, a file with zero rows, or a registry that yields nothing are problems by
 * name, never a quiet all clear.
 */

export const KINDS = Object.freeze(["safety", "behaviour", "central-seo"]);
export const KIND_WORDS = Object.freeze({ safety: "Safety", behaviour: "Behaviour", "central-seo": "Search (central)" });
export const REVIEW_FILE = /^validators-([a-z0-9][a-z0-9._-]*)\.json$/;
const MAX_TEXT = 300;

/** A validator's name as one comparable key: "guard:seo-surfaces", "check-seo-surfaces.mjs" → "seo-surfaces". */
export function keyOf(name) {
  let s = String(name ?? "").trim().toLowerCase();
  s = s.split(/\s+(?:\(|--|\/)/)[0] ?? s; // "learn-build --check / --self-test", "x (check.yml step)"
  s = s.replace(/^.*\//, "");
  s = s.replace(/(\.(test|spec))?\.(m?[jt]sx?|cjs|py|sh|ya?ml|json)$/, "");
  s = s.replace(/^(validate|guard|check|verify|lint|test|presubmit)[:_-]/, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

/** Words for when a validator runs. */
export function runsWords(runs) {
  const r = String(runs ?? "").toLowerCase();
  if (r === "pr") return "on every change";
  if (r === "scheduled") return "on a schedule";
  if (r === "main") return "after each merge";
  if (r === "deploy") return "at deploy";
  return r ? r : "when it runs is not written down yet";
}

/** One review file → its rows, stamped with the repo from the file name. */
export function parseReviewFile(fileName, json) {
  const m = REVIEW_FILE.exec(String(fileName));
  if (!m) return { repo: null, rows: [], problems: [`${fileName} is not named validators-<repo>.json`] };
  const repo = m[1];
  const problems = [];
  const list = Array.isArray(json) ? json : Array.isArray(json?.validators) ? json.validators : null;
  if (!list) return { repo, rows: [], problems: [`${fileName} is not a list of validators`] };
  if (!list.length) problems.push(`${fileName} lists no validators`);
  const rows = [];
  const seen = new Set();
  for (const [i, v] of list.entries()) {
    const name = String(v?.name ?? "").trim();
    if (!name) { problems.push(`${fileName} row ${i + 1} has no name`); continue; }
    if (seen.has(name)) { problems.push(`${repo}: "${name}" is listed twice`); continue; }
    seen.add(name);
    const kind = String(v?.kind ?? "").trim().toLowerCase();
    if (!KINDS.includes(kind)) problems.push(`${repo}: "${name}" has kind "${kind || "none"}", not one of ${KINDS.join(", ")}`);
    if (!String(v?.protects ?? "").trim()) problems.push(`${repo}: "${name}" does not say what it protects`);
    rows.push({
      repo, name, key: keyOf(name),
      protects: String(v?.protects ?? "").slice(0, MAX_TEXT),
      why: String(v?.why ?? "").slice(0, MAX_TEXT),
      kind: KINDS.includes(kind) ? kind : "behaviour",
      runs: v?.runs == null ? null : String(v.runs).slice(0, 40),
    });
  }
  return { repo, rows, problems };
}

const SCRIPT_NAME = /^(validate|guard|check|verify|presubmit)[:_-]/;
/** Runners that run other validators, never a validator of their own. */
const AGGREGATE = new Set(["validate", "check", "guard", "verify", "presubmit", "test", "lint", "all", "full", "changed", "release", "ci", "fast", "quick", "pr", "scans", "everything"]);
const VALIDATOR_DIR = /(^|\/)(validators?|validate|guards|checks)\/[^/]+\.(m?[jt]sx?|cjs|py|sh)$/;
const VALIDATOR_FILE = /(^|\/)(validate|check|guard)[-_][^/]+\.(m?[jt]sx?|cjs|py|sh)$/;
const SKIP = /(^|\/)(node_modules|fixtures?|__fixtures__|dist|build|_archive|archive|_vendor|vendor|tests?|__tests__)\/|__init__\.py$/;

/**
 * A repo's registry: what it carries as a validator, from its `main`.
 *   scripts — package.json script names; files — every tracked path; steps — CI step names.
 * `entries` are the validator-shaped ones (compared against the matrix); `known` is every key the
 * repo carries in any form (a matrix row found there is "listed").
 */
export function registryFrom({ scripts = {}, files = [], steps = [] } = {}) {
  // scripts: { name: command } (a list of names is accepted too).
  const cmds = Array.isArray(scripts) ? Object.fromEntries(scripts.map((n) => [n, ""])) : scripts;
  const entries = new Map();
  const add = (name, where) => { const k = keyOf(name); if (k && !AGGREGATE.has(k) && !entries.has(k)) entries.set(k, { key: k, name, where }); };
  const commandText = Object.values(cmds).join("\n");
  for (const s of Object.keys(cmds)) if (SCRIPT_NAME.test(s) && !AGGREGATE.has(s)) add(s, "script");
  for (const f of files) {
    if (SKIP.test(f) || /\.d\.[mc]?ts$/.test(f) || !(VALIDATOR_DIR.test(f) || VALIDATOR_FILE.test(f))) continue;
    if (commandText.includes(f)) continue; // a file a package script runs is that script's validator, not a second one
    add(f, "file");
  }
  const known = new Set(entries.keys());
  for (const f of files) if (!/(^|\/)node_modules\//.test(f)) known.add(keyOf(f));
  for (const s of Object.keys(cmds)) known.add(keyOf(s));
  for (const s of steps) known.add(keyOf(s));
  return { entries: [...entries.values()], known };
}

/**
 * The matrix: every row with whether its repo carries it and which other repos have the same check,
 * plus what is flagged. `registries` maps repo → registryFrom(...) or null when the repo could not be
 * read on this Mac. `otherRepos` are repos read that carry validators but have no review file yet.
 */
export function buildMatrix({ reviews = [], registries = {}, otherRepos = [] } = {}) {
  const problems = [];
  if (!reviews.length) problems.push("no validators-<repo>.json file was found, so nothing was checked");
  const rows = reviews.flatMap((r) => r.rows);
  for (const r of reviews) problems.push(...r.problems);
  const byKey = new Map();
  for (const r of rows) byKey.set(r.key, [...new Set([...(byKey.get(r.key) ?? []), r.repo])]);
  const unread = [];
  const unlisted = [];
  const unmatrixed = [];
  const out = rows.map((r) => {
    const reg = registries[r.repo];
    const listed = reg ? reg.known.has(r.key) : null;
    if (reg && !listed) unlisted.push({ repo: r.repo, name: r.name });
    return { ...r, listed, also: (byKey.get(r.key) ?? []).filter((x) => x !== r.repo) };
  });
  for (const r of reviews) {
    const reg = registries[r.repo];
    if (!reg) { unread.push(r.repo); continue; }
    if (!reg.entries.length) problems.push(`${r.repo}: no validator could be read from its main, so its list went unchecked`);
    const mine = new Set(r.rows.map((x) => x.key));
    for (const e of reg.entries) if (!mine.has(e.key)) unmatrixed.push({ repo: r.repo, name: e.name });
  }
  const duplicates = [...byKey.entries()].filter(([, repos]) => repos.length > 1)
    .map(([key, repos]) => ({ key, repos: [...repos].sort() })).sort((a, b) => b.repos.length - a.repos.length || a.key.localeCompare(b.key));
  return {
    rows: out, repos: reviews.map((r) => r.repo).sort(), unlisted, unmatrixed, unread: unread.sort(),
    not_imported: [...new Set(otherRepos)].filter((r) => !reviews.some((x) => x.repo === r)).sort(),
    duplicates, problems,
  };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const few = (xs, n = 3) => (xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} and ${xs.length - n} more`);

/**
 * The words for Simone's Monday line, or null when nothing is flagged. Never red; never blocking.
 */
export function matrixFlagWords(m) {
  if (!m) return "the validator matrix was not read this week";
  const bits = [];
  const repos = (xs) => few([...new Set(xs.map((x) => x.repo))]);
  if (m.unlisted?.length) bits.push(`${plural(m.unlisted.length, "validator")} in the matrix ${m.unlisted.length === 1 ? "is" : "are"} not in ${m.unlisted.length === 1 ? "its repo's" : "their repo's"} list (${repos(m.unlisted)})`);
  if (m.unmatrixed?.length) bits.push(`${plural(m.unmatrixed.length, "validator")} ${m.unmatrixed.length === 1 ? "is" : "are"} not in the matrix (${repos(m.unmatrixed)})`);
  if (m.problems?.length) bits.push(`the validator matrix could not read everything (${few(m.problems, 2)})`);
  return bits.length ? bits.join("; ") : null;
}

/** Line 1 of the page: one count, computed once. */
export function matrixSummary(m) {
  const n = m.rows.length;
  const flagged = (m.unlisted?.length ?? 0) + (m.unmatrixed?.length ?? 0);
  return `${plural(n, "validator")} across ${plural(m.repos.length, "repo")} · ${flagged ? `${flagged} to tidy` : "all listed"}`;
}

/** Shape checks for a snapshot the Mac posts (the Worker refuses one that fails). */
export function snapshotProblems(s) {
  const p = [];
  if (!s || typeof s !== "object") return ["the snapshot is not an object"];
  if (!Array.isArray(s.rows)) p.push("rows is not a list");
  if (!Array.isArray(s.repos)) p.push("repos is not a list");
  for (const k of ["unlisted", "unmatrixed", "duplicates", "problems", "not_imported", "unread"]) if (!Array.isArray(s[k])) p.push(`${k} is not a list`);
  if (Array.isArray(s.rows)) for (const r of s.rows) {
    if (!r || typeof r.repo !== "string" || typeof r.name !== "string" || !KINDS.includes(r.kind)) { p.push(`a row is missing its repo, name or kind`); break; }
  }
  return p;
}
