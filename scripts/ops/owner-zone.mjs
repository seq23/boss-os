#!/usr/bin/env node
/**
 * HER MAC'S ZONE, TOLD TO BOSS OS (6 Nov 2026). Jobs are defined in Central; times shown to her are in
 * the zone her Mac is on now, with Central in brackets when different (src/shared/boss/ownerTime.mjs).
 * This reads the Mac's zone (`readlink /etc/localtime`) and writes it to the Boss OS setting
 * `owner_timezone` (PUT /api/boss/system/owner-timezone) when it differs.
 *
 * Run by ~/bin/tz-watch.sh (launchd com.seq.tz-watch: on a zone change, at login, hourly; entry
 * "boss-owner-zone") and once at the end of scripts/ops/install-agent-launchd.sh. A failure exits
 * non-zero, so tz-watch leaves it unrecorded and tries again within the hour.
 *
 *   npm run -s vault:run -- node scripts/ops/owner-zone.mjs            # set it if it differs
 *   npm run -s vault:run -- node scripts/ops/owner-zone.mjs --dry-run  # say what it would do
 */
import { execFileSync } from "node:child_process";
import { validZone } from "../../src/shared/boss/ownerTime.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

/** "/var/db/timezone/zoneinfo/America/Chicago" → "America/Chicago"; null when it is not a zone. Pure. */
export function zoneFromLink(link) {
  const m = /zoneinfo\/(.+)$/.exec(String(link ?? "").trim());
  return m ? validZone(m[1]) : null;
}

export function macZone() {
  if (process.env.OWNER_ZONE_MAC) return validZone(process.env.OWNER_ZONE_MAC);
  try { return zoneFromLink(execFileSync("readlink", ["/etc/localtime"], { encoding: "utf8" })); } catch { return null; }
}

/** Compare and set. `api` = { get, put }. Returns the census line; throws a named stop. */
export async function syncOwnerZone(api, zone, { dry = false } = {}) {
  if (!zone) throw Object.assign(new Error("NAMED STOP [MAC_ZONE_UNREAD] the Mac's zone could not be read from /etc/localtime; Boss OS keeps its last zone. Retried within the hour."), { code: 2 });
  const have = await api.get("/system/owner-timezone").then((d) => d?.tz ?? null);
  if (have === zone) return `owner-zone: Boss OS already has ${zone}; nothing to change.`;
  if (dry) return `owner-zone: would set ${zone} (Boss OS has ${have ?? "nothing"}); dry run, nothing written.`;
  const r = await api.put("/system/owner-timezone", { tz: zone, via: "mac owner-zone.mjs" });
  if (r?.tz !== zone) throw Object.assign(new Error(`NAMED STOP [OWNER_ZONE_NOT_SAVED] Boss OS answered ${JSON.stringify(r?.tz ?? null)} for ${zone}. Retried within the hour.`), { code: 9 });
  return `owner-zone: set ${zone} (was ${have ?? "unset"}).`;
}

async function session() {
  if (!process.env.BOSS_PASSCODE) throw Object.assign(new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run -s vault:run -- node scripts/ops/owner-zone.mjs"), { code: 3 });
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw Object.assign(new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${u.status})`), { code: u.status >= 500 ? 75 : 3 });
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const call = (method) => async (p, body) => {
    const r = await fetch(`${ORIGIN}/api/boss${p}`, { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw Object.assign(new Error(`NAMED STOP [OWNER_ZONE_UNREACHABLE] Boss OS answered ${r.status} for the time zone. Retried within the hour.`), { code: r.status >= 500 ? 75 : 9 });
    return (await r.json()).data;
  };
  return { get: call("GET"), put: call("PUT") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => console.log(await syncOwnerZone(await session(), macZone(), { dry: process.argv.includes("--dry-run") })))()
    .catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
