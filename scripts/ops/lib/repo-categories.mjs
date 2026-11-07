/**
 * The Mac's read of her repo categories: ~/Brains/personal.md (the hourly copy of the personal
 * brain), parsed by the one parser (src/shared/boss/repos/categories.mjs). Never a copied list.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRepoCategories, isParkedRepo } from "../../../src/shared/boss/repos/categories.mjs";

let cached = null;
export function readRepoCategories({ home = homedir(), fresh = false } = {}) {
  if (cached && !fresh && home === cached.home) return cached.cats;
  const f = join(home, "Brains", "personal.md");
  const cats = existsSync(f) ? parseRepoCategories(readFileSync(f, "utf8")) : { problem: `${f.replace(home, "~")} is not on this Mac, so the repo categories could not be read` };
  cached = { home, cats };
  return cats;
}

/**
 * PARKED REPOS ARE OFF LIMITS TO THE AUTOMATIC FIXER (7 Nov 2026). The brain's "Parked …" lines
 * ("no work, no jobs … until she un-parks it") are read here, never copied into code. An unreadable
 * brain parks nothing and says why (`problem`), so the caller can print it.
 */
export function parkedRepos(opts) {
  const cats = readRepoCategories(opts);
  return { parked: cats.problem ? [] : (cats.parked ?? []), problem: cats.problem ?? null };
}
export const isParked = (repo, opts) => isParkedRepo(repo, readRepoCategories(opts));
