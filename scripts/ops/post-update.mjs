#!/usr/bin/env node
/**
 * ONE "JUST SO YOU KNOW" LINE ONTO THE UPDATES PAGE, NEVER AN EMAIL (owner, 7 Nov 2026).
 * For a Mac job whose news needs nothing from her (~/bin/disk-sweep.sh's low-disk line). One row per key.
 *
 *   npm run update:post -- --key mac-disk:2026-11-07 --from Simone --subject "Mac disk: 12 GB free" --body "…"
 *
 * Exit 0 = on the page (or already there today); exit 9 = NAMED STOP [UPDATE_REFUSED].
 */
import { postUpdate } from "./mac-cleanup.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? "" : ""; };
const r = await postUpdate({ key: arg("key"), from_name: arg("from") || "Simone", subject: arg("subject"), body: arg("body") });
if (!r.ok) { console.error(`NAMED STOP [UPDATE_REFUSED] ${r.error}`); process.exit(9); }
console.log(`OUTPUT updates=1 (${r.already ? "already on the Updates page" : "on the Updates page"})`);
