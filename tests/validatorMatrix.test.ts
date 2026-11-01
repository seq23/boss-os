/**
 * THE VALIDATOR MATRIX (owner, 1 Nov 2026): the pure checks, the Mac reader and the Monday line.
 * Synthetic repos and review files only; the real ones live on her Mac.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMatrix, keyOf, matrixFlagWords, matrixSummary, parseReviewFile, registryFrom, snapshotProblems } from "../src/shared/boss/validators/matrix.mjs";
import { readMatrix } from "../scripts/ops/validator-matrix.mjs";
import { cohesionCheckLine } from "../src/shared/boss/brains/brain.mjs";

const row = (name: string, kind = "safety") => ({ name, protects: `${name} holds`, why: "an incident", kind, runs: "pr" });
const review = (repo: string, rows: any[]) => parseReviewFile(`validators-${repo}.json`, rows);

describe("names compare across the shapes repos use", () => {
  it("a script, a file and a CI step name for the same check share one key", () => {
    expect(keyOf("guard:seo-surfaces")).toBe("seo-surfaces");
    expect(keyOf("scripts/check-seo-surfaces.mjs")).toBe("seo-surfaces");
    expect(keyOf("src/test/guards/seo-surfaces.test.ts")).toBe("seo-surfaces");
    expect(keyOf("validate_citation_contract.py")).toBe("citation-contract");
    expect(keyOf("prerender-and-sitemap (check.yml step)")).toBe("prerender-and-sitemap");
  });
});

describe("a review file", () => {
  it("is read by its name alone and its rows are checked", () => {
    const r = parseReviewFile("validators-alpha.json", [row("validate:no-secrets"), { name: "x", protects: "", kind: "style" }, row("validate:no-secrets")]);
    expect(r.repo).toBe("alpha");
    expect(r.rows.map((x) => x.name)).toEqual(["validate:no-secrets", "x"]);
    expect(r.problems.join(" | ")).toMatch(/kind "style"/);
    expect(r.problems.join(" | ")).toMatch(/does not say what it protects/);
    expect(r.problems.join(" | ")).toMatch(/listed twice/);
    expect(parseReviewFile("validators-empty.json", []).problems).toEqual(["validators-empty.json lists no validators"]);
    expect(parseReviewFile("notes.json", []).repo).toBeNull();
  });
});

describe("the matrix flags both directions and shows duplicates", () => {
  const alpha = registryFrom({
    scripts: { "validate:no-secrets": "node scripts/validate/no-secrets.mjs", validate: "npm run validate:no-secrets", "validate:all": "x" },
    files: ["scripts/validate/no-secrets.mjs", "scripts/validate/orphan.mjs", "scripts/validate/lib/shared.mjs", "tests/validate_x.py"],
  });
  const beta = registryFrom({ files: ["scripts/check-no-secrets.mjs"], steps: ["Prerender and sitemap"] });

  it("a script's own file is not a second validator; runners and helpers are not validators", () => {
    expect(alpha.entries.map((e) => e.key).sort()).toEqual(["no-secrets", "orphan"]);
  });
  it("a clean matrix flags nothing", () => {
    const m = buildMatrix({ reviews: [review("alpha", [row("validate:no-secrets"), row("orphan")])], registries: { alpha } });
    expect([m.unlisted, m.unmatrixed, m.problems]).toEqual([[], [], []]);
    expect(matrixFlagWords(m)).toBeNull();
    expect(matrixSummary(m)).toBe("2 validators across 1 repo · all listed");
  });
  it("a row its repo does not carry, and a validator the matrix lacks, are both flagged", () => {
    const m = buildMatrix({
      reviews: [review("alpha", [row("validate:no-secrets"), row("validate:gone")]), review("beta", [row("check-no-secrets"), row("prerender-and-sitemap (check.yml step)", "central-seo")])],
      registries: { alpha, beta },
      otherRepos: ["gamma", "alpha"],
    });
    expect(m.unlisted).toEqual([{ repo: "alpha", name: "validate:gone" }]);
    expect(m.unmatrixed).toEqual([{ repo: "alpha", name: "scripts/validate/orphan.mjs" }]);
    expect(m.duplicates).toEqual([{ key: "no-secrets", repos: ["alpha", "beta"] }]);
    expect(m.rows.find((r) => r.repo === "beta" && r.key === "no-secrets")?.also).toEqual(["alpha"]);
    expect(m.not_imported).toEqual(["gamma"]);
    expect(matrixFlagWords(m)).toBe("1 validator in the matrix is not in its repo's list (alpha); 1 validator is not in the matrix (alpha)");
  });
  it("Rule 0: no review files, or a registry that yields nothing, is never all clear", () => {
    expect(buildMatrix({}).problems).toEqual(["no validators-<repo>.json file was found, so nothing was checked"]);
    expect(matrixFlagWords(buildMatrix({}))).toMatch(/could not read everything/);
    const m = buildMatrix({ reviews: [review("alpha", [row("x")])], registries: { alpha: registryFrom({}) } });
    expect(m.problems.join()).toMatch(/alpha: no validator could be read/);
    expect(matrixFlagWords(null)).toBe("the validator matrix was not read this week");
  });
  it("a repo not on this Mac is unread, not flagged", () => {
    const m = buildMatrix({ reviews: [review("alpha", [row("x")])], registries: { alpha: null } });
    expect(m.unread).toEqual(["alpha"]);
    expect(m.unlisted).toEqual([]);
  });
  it("the Worker refuses a snapshot of the wrong shape", () => {
    expect(snapshotProblems(buildMatrix({ reviews: [review("alpha", [row("x")])] }))).toEqual([]);
    expect(snapshotProblems({ rows: [{ repo: "a" }] }).length).toBeGreaterThan(0);
  });
});

describe("the Mac reader", () => {
  it("picks up a new review file with no code change", () => {
    const home = mkdtempSync(join(tmpdir(), "vm-"));
    const dir = join(home, ".boss-os", "reviews");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "validators-alpha.json"), JSON.stringify([row("validate:no-secrets")]));
    writeFileSync(join(dir, "notes.txt"), "not a review");
    const repos = new Map([["alpha", "/a"], ["delta", "/d"]]);
    const read = (d: string) => (d === "/a" ? registryFrom({ scripts: { "validate:no-secrets": "" } }) : registryFrom({ files: ["scripts/validate/thing.mjs"] }));
    let m = readMatrix({ home, repos, read });
    expect(m.repos).toEqual(["alpha"]);
    expect(m.not_imported).toEqual(["delta"]);
    writeFileSync(join(dir, "validators-delta.json"), JSON.stringify([row("thing")]));
    m = readMatrix({ home, repos, read });
    expect(m.repos).toEqual(["alpha", "delta"]);
    expect(m.rows).toHaveLength(2);
    expect(matrixFlagWords(m)).toBeNull();
  });
});

describe("Simone's Monday line carries what is flagged, never blocking", () => {
  const clean = { strays_moved: [], memory_index_lines: 10, repos_missing_pointer: [], skills_flagged: [], unchecked: [] };
  it("says the flag, and says nothing when nothing is flagged", () => {
    expect(cohesionCheckLine([], { ...clean, validators_flag: "2 validators are not in the matrix (alpha)" })).toBe("Cohesion: 2 validators are not in the matrix (alpha)");
    expect(cohesionCheckLine([], { ...clean, validators_flag: null })).toBe("Cohesion: all clear");
  });
});
