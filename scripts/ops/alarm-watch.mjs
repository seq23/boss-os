#!/usr/bin/env node
/**
 * ALARM WATCH — the post-land proof for a Kendra repair (8 Nov 2026, alarm output:duty_exec_intel).
 *
 * A Kendra alarm closes itself on the Worker's hourly tick once its condition clears. A repair is
 * proven when its alarm reads `closed`, not when the PR is green. This is ONE bounded, blocking,
 * read-only command: it polls GET /api/boss/alarms for one key until the row is closed, prints the
 * closed reason, and exits 0; at the deadline it exits 2 as a NAMED STOP. It spends nothing and
 * sends nothing.
 *
 *   npm run -s alarm:watch -- output:duty_exec_intel [--minutes 90] [--every 60]
 *   node scripts/ops/alarm-watch.mjs --self-test
 *
 * Exit: 0 closed · 2 NAMED STOP (still open at the deadline, or the key never seen) · 1 usage/error.
 */
import { bossApi } from "./lib/duty-kit.mjs";

/** What one read of the alarm list says about a key. Pure. */
export function alarmState(alarms, key) {
  const row = (alarms ?? []).find((a) => a?.alarm_key === key);
  if (!row) return { state: "absent" };
  if (row.status === "closed") return { state: "closed", reason: row.closed_reason ?? "no reason recorded", at: row.closed_at };
  return { state: "open", text: row.text, seen: row.seen };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

function selfTest() {
  const cases = [
    [alarmState([], "output:x").state, "absent"],
    [alarmState([{ alarm_key: "output:x", status: "open", text: "t", seen: 3 }], "output:x").state, "open"],
    [alarmState([{ alarm_key: "output:y", status: "closed" }, { alarm_key: "output:x", status: "closed", closed_reason: "the newest run met its floor" }], "output:x").reason, "the newest run met its floor"],
    [alarmState([{ alarm_key: "output:y", status: "closed" }], "output:x").state, "absent"],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length) { console.error(`SELF-TEST FAILED: ${bad.length} case(s)`); process.exit(1); }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const key = process.argv.slice(2).find((a) => /^(output|task|mail):/.test(a));
  if (!key) { console.error("usage: alarm-watch.mjs <alarm key, e.g. output:duty_exec_intel> [--minutes 90] [--every 60]"); process.exit(1); }
  const minutes = Math.min(Math.max(arg("--minutes", 90), 1), 180);
  const every = Math.min(Math.max(arg("--every", 60), 15), 600);
  const deadline = Date.now() + minutes * 60_000;
  let last = { state: "not read" };
  for (;;) {
    try {
      // A fresh session each poll: a 90-minute wait can outlive one.
      const api = await bossApi();
      last = alarmState((await api.get("/alarms"))?.alarms, key);
    } catch (err) {
      last = { state: "not read", why: err instanceof Error ? err.message : String(err) };
    }
    if (last.state === "closed") {
      console.log(`OUTPUT alarm ${key} closed: ${last.reason}${last.at ? ` (${new Date(Number(last.at)).toISOString()})` : ""}`);
      process.exit(0);
    }
    if (Date.now() + every * 1000 > deadline) break;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
  const why = last.state === "open" ? `still open after ${minutes} min: ${last.text ?? ""}`
    : last.state === "absent" ? `no alarm with this key open or closed in the last 7 days`
    : `not read: ${last.why ?? "unknown"}`;
  console.error(`NAMED STOP [ALARM_NOT_CLOSED] ${key} — ${why}`);
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
