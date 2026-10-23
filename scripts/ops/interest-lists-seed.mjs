#!/usr/bin/env node
/**
 * SEEDS HER RAINMAKER AND DO-NOT-SUGGEST LISTS INTO D1 FROM A FILE OUTSIDE THIS REPOSITORY.
 *
 * The repo is public, so no name or address on either list is ever written here. The entries she
 * gave on 23 Oct 2026 sit in `~/.boss-os/capital/lists-seed.json` on her Mac:
 *
 *   { "same_firm": ["<someone>@<domain> (who they are)"], "do_not_suggest": ["<Name> at <firm> (<address>)"] }
 *
 * Each line is posted to `POST /api/boss/capital/lists` exactly as her reply would be read, and is
 * idempotent: an entry already on the list stays as it is. After this, she edits both lists by
 * replying in plain words to any Monique email.
 *
 *   npm run capital:lists-seed
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bossSession } from "./interest-grid.mjs";

const FILE = process.env.CAPITAL_LISTS_SEED ?? path.join(os.homedir(), ".boss-os", "capital", "lists-seed.json");

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`NAMED STOP [NO_SEED_FILE] ${FILE} does not exist. It lives on her Mac, never in the repo.`);
    process.exit(5);
  }
  const seed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const session = await bossSession();
  if (!session) process.exit(4);
  let done = 0;
  for (const list of ["same_firm", "do_not_suggest"]) {
    for (const who of seed[list] ?? []) {
      const res = await session.post("/capital/lists", { list, action: "add", who, source: "seed" });
      if (!res?.ok) { console.error(`  ${list}: one entry refused (${res?.status ?? "no response"})`); continue; }
      done += 1;
    }
  }
  if (done === 0) { console.error("NAMED STOP [NOTHING_SEEDED] the file held no entry Boss OS accepted."); process.exit(6); }
  console.log(`CAPITAL-LISTS-SEEDED: ${done} entr${done === 1 ? "y" : "ies"} (names not printed).`);
}

main().catch((err) => { console.error(`LISTS SEED FAILED: ${err?.stack ?? err}`); process.exit(1); });
