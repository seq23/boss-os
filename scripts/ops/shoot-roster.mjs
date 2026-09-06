#!/usr/bin/env node
/**
 * The roster's portraits, shot from the casting sheet.
 *
 * WHY A SCRIPT AND NOT A FEATURE. The Worker already has a governed image client
 * (`src/worker/effects/runwareClient.ts`) for an employee who needs a picture mid-task. This is a
 * different thing: a one-off shoot for seven seats, run by the owner, writing files into the
 * repository. That is an ops task, so it lives beside `workers-ai-usage.mjs` and runs where the
 * vault already is — the same reason no account-scoped token lives in the Worker.
 *
 * IT READS THE CASTING SHEET AND NOTHING ELSE. Prompts are `_style` + the seat's one `look` line.
 * No prompt is written here, so changing how the roster looks means editing the casting sheet — the
 * one place appearance is allowed to live. There is no race, appearance or demographic column in
 * the employees table, in the registry, or in the worker, and this script does not create one.
 *
 * WHAT IT COSTS. Seven images, well under a cent in total. It prints the figure Runware reports
 * rather than an estimate, and refuses to invent one when the vendor does not say — the same rule
 * `vendor_spend` follows, where a cost the vendor did not report is NULL and never zero.
 *
 *   npm run vault:run -- npm run ops:shoot-roster
 *   npm run vault:run -- npm run ops:shoot-roster -- --only Camille
 *   npm run vault:run -- npm run ops:shoot-roster -- --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "src/client/public/employees-boss");
const SHEET = join(DIR, "CASTING.json");
const RUNWARE_URL = "https://api.runware.ai/v1";

const KEY = process.env.RUNWARE_API_KEY;
const dryRun = process.argv.includes("--dry-run");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1];

if (!KEY && !dryRun) {
  console.error(
    "RUNWARE_API_KEY is not set.\n\nRun it through the vault so the key is never typed or echoed:\n" +
      "  npm run vault:run -- npm run ops:shoot-roster",
  );
  process.exit(1);
}

const sheet = JSON.parse(readFileSync(SHEET, "utf8"));
const cast = sheet.cast.filter((c) => !only || c.name.toLowerCase() === only.toLowerCase());

if (cast.length === 0) {
  console.error(`No seat named "${only}" in the casting sheet.`);
  process.exit(1);
}

console.log(`Shooting ${cast.length} portrait${cast.length === 1 ? "" : "s"} from ${SHEET}\n`);

let spent = 0;
let unpriced = 0;
const written = [];

for (const seat of cast) {
  const prompt = `${sheet._style} ${seat.look}.`;
  const out = join(DIR, `${seat.name.toLowerCase()}.jpg`);

  if (dryRun) {
    console.log(`  ${seat.name.padEnd(10)} would write ${out.replace(ROOT + "/", "")}`);
    console.log(`             ${prompt.slice(0, 150)}…\n`);
    continue;
  }

  process.stdout.write(`  ${seat.name.padEnd(10)} ${seat.role.padEnd(28)} `);

  const res = await fetch(RUNWARE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        taskType: "imageInference",
        taskUUID: crypto.randomUUID(),
        positivePrompt: prompt.slice(0, 2_000),
        width: 768,
        height: 768,
        model: "runware:100@1",
        numberResults: 1,
        outputType: "base64Data",
        outputFormat: "JPEG",
      },
    ]),
  }).catch((e) => ({ ok: false, status: 0, _err: String(e) }));

  if (!res.ok) {
    console.log(`FAILED (HTTP ${res.status}${res._err ? ` — ${res._err}` : ""})`);
    continue;
  }

  const body = await res.json();
  const failure = body.errors?.[0]?.message;
  if (failure) {
    console.log(`REFUSED — ${failure}`);
    continue;
  }

  const b64 = body.data?.[0]?.imageBase64Data;
  if (typeof b64 !== "string" || !b64.length) {
    console.log("no image in the response");
    continue;
  }

  const bytes = Buffer.from(b64, "base64");
  writeFileSync(out, bytes);
  written.push({ name: seat.name, file: `${seat.name.toLowerCase()}.jpg`, bytes: bytes.length });

  // The vendor's own reported cost, or nothing. Never a guess — an invented figure in a cost record
  // is the defect 0174 exists to prevent.
  const cost = body.data?.[0]?.cost;
  if (typeof cost === "number") spent += cost;
  else unpriced += 1;

  console.log(`${(bytes.length / 1024).toFixed(0)} KB` + (typeof cost === "number" ? `  $${cost.toFixed(5)}` : "  (no cost reported)"));
}

if (dryRun) {
  console.log("Dry run — nothing was sent and nothing was written.");
  process.exit(0);
}

// A manifest beside the assets, so the honesty statement travels with the files rather than living
// only in a comment somebody has to go looking for.
if (written.length) {
  const manifest = {
    _honesty: sheet._honesty,
    generated_at: new Date().toISOString(),
    direction: "One direction for all seven, from CASTING.json _style. Per-seat variation is the `look` line only.",
    portraits: written,
  };
  writeFileSync(join(DIR, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
}

console.log(`\n  ${written.length}/${cast.length} written to ${DIR.replace(ROOT + "/", "")}`);
console.log(`  Cost reported by Runware: $${spent.toFixed(5)}${unpriced ? ` (${unpriced} image(s) reported no cost and are not counted as zero)` : ""}`);
if (written.length) console.log("  These are AI-generated images of people who do not exist. MANIFEST.json says so beside them.");
