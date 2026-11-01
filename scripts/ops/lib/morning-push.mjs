#!/usr/bin/env node
/**
 * Keeps one morning section in Boss OS (POST /api/boss/morning/sections). Spawned by the writers in
 * src/shared/boss/mail/morning.mjs so they stay synchronous; reads { mode, section, body, script } on
 * stdin. Prints nothing that names anyone; the reason for a miss is its last stderr line.
 *
 * Exit 0: kept, or skipped on purpose (no passcode on the Mac, a test, BOSS_MORNING_STORE=off).
 * Exit 1: not kept, on the Mac — the Mac file stands and your-day falls back to it.
 * Exit 3: not kept on a cloud runner — there is no Mac file, so the writer fails the run by name.
 */
import { bossApi } from "./duty-kit.mjs";
import { isCloudRun } from "../../lib/vault-env.mjs";

const cloud = isCloudRun();
const fail = (why) => { console.error(String(why).slice(0, 200)); process.exit(cloud ? 3 : 1); };

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
if (process.env.VITEST || process.env.BOSS_MORNING_STORE === "off") process.exit(0);
if (!process.env.BOSS_PASSCODE) { if (cloud) fail("no BOSS_PASSCODE on the runner"); process.exit(0); }
const { script, ...req } = JSON.parse(raw);
// The job's own name: the cloud runner's job id, else the script that wrote.
const job = process.env.BOSS_MORNING_JOB || process.env.JOB || script || "unknown";
// Three tries (a network blip at 05:30 must not cost the morning its section): 0s, 3s, 12s.
let last = null;
for (const wait of [0, 3_000, 12_000]) {
  if (wait) await new Promise((r) => setTimeout(r, wait));
  try {
    const api = await bossApi();
    await api.post("/morning/sections", { ...req, job });
    process.exit(0);
  } catch (e) { last = e; if (/→ 4\d\d/.test(String(e?.message))) break; /* refused, not a blip */ }
}
fail(last?.message ?? last);
