/**
 * PUT HER CANON IN THE VAULT, HASHED.
 *
 * The documents in `docs/boss/` are what this system implements — the A-Player Mode contract, the
 * coaching manual, the sovereignty addendum. Every gate, floor and verdict in Boss OS traces back
 * to a line in one of them, and until now nothing anywhere held a hash of any of it.
 *
 * That matters for one question: does the system still match what she agreed to? Without hashes
 * that is answered by reading nineteen files and remembering. With them it is a diff.
 *
 * IDEMPOTENT AND SAFE TO RUN ON EVERY DEPLOY. An unchanged document is skipped; a changed one is
 * stored as a NEW row beside the old, because the whole value of a chain is that it shows the
 * moment something changed. This never deletes.
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DOCS = new URL("../../docs/boss", import.meta.url).pathname;

async function main() {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const files = (await readdir(DOCS)).filter((f) => f.endsWith(".md")).sort();
  let stored = 0;
  let changed = 0;
  let same = 0;

  for (const f of files) {
    const content = await readFile(join(DOCS, f), "utf8");
    const res = await fetch(`${ORIGIN}/api/boss/vault/entries`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ key: f, kind: "canon_doc", content }),
    });
    if (!res.ok) {
      console.error(`  ✗ ${f}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const d = (await res.json()).data;
    if (!d.stored) { same++; continue; }
    stored++;
    if (d.changed) changed++;
    console.log(`  ${d.changed ? "changed" : "stored "} ${f}  ${d.sha256.slice(0, 12)}  ${d.bytes} bytes`);
  }

  console.log(`\n${files.length} canon documents: ${stored} written (${changed} changed), ${same} already current.`);
}

main().catch((err) => {
  console.error(`canon sync failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
