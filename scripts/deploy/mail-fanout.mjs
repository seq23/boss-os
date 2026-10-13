#!/usr/bin/env node
/**
 * Deploy the Industry Guides mail fan-out Worker (src/mail-fanout/index.ts) with its own config.
 * Run by `npm run deploy:production` after the main Worker, or alone: `npm run deploy:mail-fanout`.
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (the vault runner or CI).
 */
import { execSync } from "node:child_process";
try {
  const out = execSync("npx wrangler deploy -c workers/industry-guides-mail-fanout/wrangler.toml", { stdio: "pipe", encoding: "utf8" });
  const version = out.match(/Current Version ID:\s*([0-9a-f-]+)/)?.[1];
  console.log(`mail fan-out deployed ${version ?? "(version id not reported)"}`);
} catch (err) {
  console.error(`mail fan-out deploy failed:\n${err.stdout ?? ""}${err.stderr ?? err.message}`);
  process.exit(1);
}
