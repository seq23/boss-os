#!/usr/bin/env node
/** Render only. Loading the job is the coordinator's separate action. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shiftPlist, centralToLocalOffset } from "./plist-central.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function renderPlist({ repo, logs, offset = centralToLocalOffset() }) {
  const command = "duty-run.sh pnp-corporate-outreach.mjs -- npm run --silent pnp:outreach -- --live";
  const template = fs.readFileSync(path.join(here, "launchd", "com.seq.boss-pnp-outreach.plist"), "utf8");
  return shiftPlist(template.replace("__COMMAND__", command).replace("__REPO__", xml(repo)).replaceAll("__LOGS__", xml(logs)), offset)
    .replace('<plist version="1.0">', '<!-- central-shifted -->\n<plist version="1.0">');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = process.argv[process.argv.indexOf("--out") + 1];
  if (!process.argv.includes("--out") || !out) throw new Error("--out is required; this command never loads launchd.");
  const logs = path.join(os.homedir(), "Library", "Logs", "boss-pnp-outreach");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(out, renderPlist({ repo: process.env.BOSS_OS_REPO ?? path.resolve(here, "../.."), logs }));
}
