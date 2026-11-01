/**
 * READS ONE REPO'S `search-loop-week` REPORTS FROM GITHUB (owner, 1 Nov 2026: the search growth loop).
 * Shared by the Monday Search Readiness audit (scripts/ops/search-readiness-audit.mjs) and the
 * Wednesday Spry Labs email (scripts/ops/spry-weekly.mjs), so both read the same reports the same way.
 * Through `gh` (already signed in on her Mac): GET only, no key, no paid service.
 *
 * Returns `{ weeks, adopted }` — every parsed report younger than the age limit, and whether the repo
 * has adopted the engine at all (a search-loop workflow, or any report ever uploaded) — or
 * `{ problem }` in plain words when GitHub could not be read. Never an empty list for "unread".
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOP_ARTIFACT, LOOP_MAX_AGE_DAYS, LOOP_SCHEMA } from "../../../src/shared/boss/searchLoop/week.mjs";

const OWNER = "seq23";
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "pipe"] });

/** A workflow whose file or name says it runs the search loop. */
export const LOOP_WORKFLOW_RE = /search[-_ ]?loop/i;

function jsonFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) jsonFiles(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

export function fetchLoopWeeks(repo, { run = gh, now = Date.now(), maxAgeDays = LOOP_MAX_AGE_DAYS, cap = 12 } = {}) {
  let list, flows;
  try {
    list = JSON.parse(run(["api", `repos/${OWNER}/${repo}/actions/artifacts?name=${LOOP_ARTIFACT}&per_page=30`]));
  } catch {
    return { problem: "GitHub could not be reached from the Mac" };
  }
  try {
    flows = JSON.parse(run(["api", `repos/${OWNER}/${repo}/actions/workflows?per_page=100`]));
  } catch {
    flows = null;
  }
  const arts = list.artifacts ?? [];
  const adopted = arts.length > 0 || (flows?.workflows ?? []).some((w) => LOOP_WORKFLOW_RE.test(`${w.path ?? ""} ${w.name ?? ""}`));
  const fresh = arts
    .filter((a) => !a.expired && now - Date.parse(a.created_at) <= (maxAgeDays + 1) * 86_400_000)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const runs = [...new Set(fresh.map((a) => a.workflow_run?.id).filter(Boolean))].slice(0, cap);
  const weeks = [];
  for (const id of runs) {
    const dir = mkdtempSync(join(tmpdir(), "search-loop-week-"));
    try {
      run(["run", "download", String(id), "-R", `${OWNER}/${repo}`, "-n", LOOP_ARTIFACT, "-D", dir]);
      for (const f of jsonFiles(dir)) {
        try {
          const w = JSON.parse(readFileSync(f, "utf8"));
          if (w && typeof w === "object" && (w.schema === undefined || w.schema === LOOP_SCHEMA) && w.site) weeks.push(w);
        } catch { /* a file that is not JSON is not a report */ }
      }
    } catch { /* this run's report could not be downloaded; the others still count */ }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { weeks, adopted };
}
