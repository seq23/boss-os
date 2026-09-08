// TEMP probe: unlock the live Boss OS API and GET paths given on argv.
const BASE = process.env.BOSS_BASE || "https://boss.sequoiataylor.com";
const pc = process.env.BOSS_PASSCODE;
if (!pc) { console.error("no BOSS_PASSCODE"); process.exit(1); }
const r = await fetch(`${BASE}/api/boss/auth/unlock`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ passcode: pc }),
});
const setC = r.headers.get("set-cookie") || "";
const cookie = setC.split(";")[0];
console.error("unlock", r.status, cookie ? "cookie ok" : await r.text());
for (const p of process.argv.slice(2)) {
  const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
  const txt = await res.text();
  console.log(`\n===== ${p} → ${res.status} =====`);
  console.log(txt.length > 200000 ? txt.slice(0, 200000) : txt);
}
