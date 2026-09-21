/**
 * THE OPEN PROBLEMS, WRITTEN FOR THE RUN TO READ FIRST. Through the vault; one file; no mail.
 *
 *   npm run vault:run -- node scripts/ops/kdp-open.mjs ~/.boss-os/kdp/open.json
 */
import { writeFile } from "node:fs/promises";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const OUT = process.argv[2];
if (!OUT) { console.error("usage: kdp-open.mjs <out-file>"); process.exit(2); }
if (!process.env.BOSS_PASSCODE) { console.error("NAMED STOP [NO_PASSCODE] run this through the vault."); process.exit(11); }

const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
if (!unlock.ok) { console.error(`NAMED STOP [UNLOCK_FAILED] ${unlock.status}`); process.exit(3); }
const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
const res = await fetch(`${ORIGIN}/api/boss/kdp/mail/open`, { headers: { cookie } });
if (!res.ok) { console.error(`NAMED STOP [OPEN_UNREAD] ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(4); }
const { data } = await res.json();
await writeFile(OUT, JSON.stringify({ read_at: new Date().toISOString(), open: data.open ?? [] }, null, 2) + "\n");
console.log(`open problems: ${(data.open ?? []).length} → ${OUT}`);
