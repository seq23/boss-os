#!/usr/bin/env node
/**
 * IS THERE ANYTHING LEFT TO CHASE? Asked of Boss OS before any KDP run reads a single email.
 *
 * ─── The run this stops ────────────────────────────────────────────────────
 *
 * 14 September 2026, 09:23 Central: `kdp-watch.sh` fired on schedule, read her mailbox, and emailed
 * her that seven covers were waiting for her approval and that once approved Simone would "publish
 * all 7 titles immediately". She had approved them on the 9th. Six of the seven titles had been
 * Live on the bookshelf since the 12th. The register — `GET /api/boss/kdp` — said `blocked: 0` the
 * whole time. Nothing in the run asked it.
 *
 * So this asks, first, and prints ONE line: `KDP-CHASE: OPEN — …` or `KDP-CHASE: CLOSED — …`.
 * Exit 0 when open, 3 when closed, 4 when it could not find out (which is NOT "closed": a run that
 * cannot read the register must not treat silence as permission to stop, or as permission to go).
 *
 * `chase.open` is computed by the Worker from two facts and nothing else: whether any title on the
 * register is `blocked`, and whether she has stopped the commitment herself. The run does not get
 * to have an opinion about either.
 *
 *   npm run --silent vault:run -- node scripts/ops/kdp-chase-open.mjs
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

async function main() {
  if (!process.env.BOSS_PASSCODE) {
    console.log("KDP-CHASE: UNKNOWN — no passcode in the environment; run this through the vault.");
    process.exit(4);
  }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) {
    console.log(`KDP-CHASE: UNKNOWN — unlock failed (${unlock.status}).`);
    process.exit(4);
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  const res = await fetch(`${ORIGIN}/api/boss/kdp`, { headers: { cookie } });
  if (!res.ok) {
    console.log(`KDP-CHASE: UNKNOWN — could not read the register (${res.status}).`);
    process.exit(4);
  }
  const { data } = await res.json();
  const chase = data?.chase;
  if (!chase || typeof chase.open !== "boolean") {
    console.log("KDP-CHASE: UNKNOWN — the register answered without a `chase` field; the Worker is older than this script.");
    process.exit(4);
  }
  if (chase.open) {
    console.log(`KDP-CHASE: OPEN — ${chase.why}`);
    process.exit(0);
  }
  console.log(`KDP-CHASE: CLOSED — ${chase.why}`);
  process.exit(3);
}

main().catch((err) => {
  console.log(`KDP-CHASE: UNKNOWN — ${err?.message ?? err}`);
  process.exit(4);
});
