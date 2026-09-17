/**
 * THE WORKER THIS REPOSITORY ACTUALLY DEPLOYS TO — stated once, read by everything.
 *
 * It lives in its own module rather than inside `vault.mjs` because `vault.mjs` runs its CLI on
 * import, so nothing else could read the function without also running a command. A fact that only
 * one file can reach is a fact every other file will eventually restate, and restating this one is
 * exactly how `cloudflare-mapping.json` came to say "west-peek-os" while wrangler.toml said
 * "boss-os" — eight secrets written to a different business's application, reported as success.
 *
 * `[env.production] name` is the authority because that is the profile `npm run deploy:production`
 * uses. The TOP-LEVEL `name` is the local miniflare profile and is deliberately never deployed, so
 * it is deliberately not what this reads.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function parseDeployTarget(tomlText) {
  let inProduction = false;
  for (const raw of String(tomlText).split("\n")) {
    const line = raw.split("#")[0].trim();
    if (line.startsWith("[")) {
      inProduction = line === "[env.production]";
      continue;
    }
    if (!inProduction) continue;
    const m = /^name\s*=\s*"([^"]+)"/.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function deployTargetWorkerName(tomlText) {
  const text = tomlText ?? readFileSync(join(REPO_ROOT, "wrangler.toml"), "utf8");
  const name = parseDeployTarget(text);
  if (!name) throw new Error("wrangler.toml has no [env.production] name — there is no deploy target to sync to.");
  return name;
}
