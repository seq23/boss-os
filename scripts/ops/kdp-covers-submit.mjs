/**
 * Put the finished covers in her Inbox, so she can look at them and say yes.
 *
 * ─── Why this script exists at all ─────────────────────────────────────────
 *
 * Amazon support diagnosed the publishing block as Cover Creator images failing server-side
 * processing; uploading finished covers directly is their prescribed fix. Seven were generated at
 * 1600x2560. The covers could have been uploaded by hand in ten minutes and she chose otherwise:
 *
 *   "i dont care about this happening right away id rather see them in my inbox for approval
 *    and then approve them and have simone publish them"
 *
 * So the seven blocked titles publish through the Inbox or they do not publish.
 *
 * ─── The question this settles: can images reach the Inbox at all? ─────────
 *
 * YES, AND ONLY THIS WAY. An agent cannot do it — the Claude Code runner strips every credential
 * from its environment, so an agent can neither unlock the vault nor authenticate to Boss OS. A
 * local script run through the vault can. It is the same split that puts Simone's mail reading on
 * her Mac: the employee owns the work, a local job is the only thing that can perform this part of
 * it. There is no fallback to a link or a published page, because the bytes genuinely arrive.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * No covers, no docket. A judgement call raised with nothing in it would ask her to approve an
 * empty frame, which is the one thing the asset rendering exists to prevent.
 *
 *   npm run kdp:covers            # raise it
 *   npm run kdp:covers -- --dir /somewhere/else
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join, basename } from "node:path";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const argDir = process.argv.indexOf("--dir");
const DIR = argDir !== -1 ? process.argv[argDir + 1] : (process.env.BOSS_OS_COVERS_DIR ?? `${process.env.HOME}/.boss-os/kdp/covers/final`);

const MEDIA = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** `proof-of-income.jpg` reads as "Proof of income" on the card. She named the books; this is a slug. */
const labelFor = (file) =>
  basename(file, extname(file)).replace(/[-_]+/g, " ").replace(/^./, (ch) => ch.toUpperCase());

async function main() {
  let files;
  try {
    files = (await readdir(DIR)).filter((f) => MEDIA[extname(f).toLowerCase()]).sort();
  } catch {
    console.error(`NAMED STOP [NO_COVER_DIR] ${DIR} does not exist.`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(`NAMED STOP [NO_COVERS] ${DIR} holds no images.`);
    console.error("  A judgement call with nothing in it would ask her to approve an empty frame.");
    process.exit(3);
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] run this through the vault: npm run kdp:covers");
    process.exit(4);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  const headers = { "content-type": "application/json", cookie };

  const raise = await fetch(`${ORIGIN}/api/boss/judgement`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      employee_id: "emp_chief",
      deliverable_id: "del_kdp_publication",
      lane: "ops",
      risk: "medium",
      title: `${files.length} replacement covers for the blocked Kindle titles`,
      question:
        "Amazon says the publishing block is Cover Creator images failing on their side, and that uploading finished covers fixes it. " +
        "These are the replacements. Approve and Simone uploads them, publishes ONE title first, checks it actually reaches Live on the bookshelf, " +
        "then does the rest — or send them back with a sentence saying what is wrong.",
      resume_kind: "kdp_cover_upload",
      // A second batch replaces the first on her screen rather than sitting beside it: two dockets
      // showing different covers for the same seven books is a way to approve the wrong set.
      supersedes_key: "kdp_cover_upload",
      assets: files.map((f) => ({ label: labelFor(f), media_type: MEDIA[extname(f).toLowerCase()] })),
    }),
  });
  if (!raise.ok) throw new Error(`raising the judgement call failed (${raise.status}): ${(await raise.text()).slice(0, 300)}`);
  const { data } = await raise.json();

  let uploaded = 0;
  for (let i = 0; i < files.length; i += 1) {
    const body = await readFile(join(DIR, files[i]));
    const res = await fetch(`${ORIGIN}/api/boss/judgement/${data.id}/asset/${i}`, {
      method: "PUT",
      headers: { "content-type": MEDIA[extname(files[i]).toLowerCase()], cookie },
      body,
    });
    if (!res.ok) {
      /*
       * A FAILED UPLOAD IS REPORTED AND THE SLOT STAYS MISSING. It is NOT retried silently and the
       * docket is NOT withdrawn: the card renders the named absence, and she can see that six of
       * seven arrived rather than being shown six and told nothing.
       */
      console.error(`  ✗ ${files[i]} did not upload (${res.status}) — the slot will read as missing on the card.`);
      continue;
    }
    uploaded += 1;
    console.log(`  ✓ ${files[i]}`);
  }

  console.log(
    `Raised in her Inbox: ${data.id} (attempt ${data.attempt}), ${uploaded} of ${files.length} covers uploaded.` +
    (uploaded < files.length ? " The missing ones say so on the card rather than showing an empty frame." : ""),
  );
}

main().catch((err) => {
  console.error(`cover submission failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
