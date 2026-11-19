#!/usr/bin/env node
/**
 * `npm run buffer:check` (under vault:run) — every Buffer's live channels against the Accounts map's
 * buffer-* rows. Exit 0 clean · 1 problems, by name · 2 NAMED STOP (nothing read). The Sunday cohesion
 * check runs it with the Email Map and Schedule checks and says any gap in the Monday line.
 */
import { readFileSync } from "node:fs";
import { runBufferCheck } from "./lib/buffer-channels.mjs";

const accounts = JSON.parse(readFileSync(new URL("../../src/shared/boss/maps/accounts.json", import.meta.url), "utf8"));
const r = await runBufferCheck({ accounts });
console.log(r.census);
if (r.problems.length) { console.error(r.problems.map((p) => `  ${p}`).join("\n")); process.exit(1); }
if (r.stop) { console.error(r.stop); process.exit(2); }
console.log("Every Buffer holds exactly the channels the Accounts map lists.");
