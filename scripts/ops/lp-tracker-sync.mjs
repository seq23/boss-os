/**
 * THE WEDNESDAY COPY, DONE BY A MACHINE.
 *
 * Twin writes LP outreach into one spreadsheet. Her partner reads a different one. Every week she
 * copies the new rows across by hand, before a meeting, with a deadline attached. When this was
 * first read the source ran to 22 August and his copy ended on 5 August — so the chore had already
 * failed silently, and he had been looking at a five-week-old picture while believing otherwise.
 *
 * That is the real argument for automating it. Not the ten minutes: a manual sync fails quietly,
 * and nobody discovers it until someone acts on a stale number in a meeting.
 *
 * ─── It authenticates AS ITSELF, and that is not an accident ────────────────
 *
 * `gmail-metadata.mjs` impersonates `staylor@spry.vc` through domain-wide delegation, because a
 * mailbox belongs to a user. These two spreadsheets are owned by two OTHER accounts — one of them
 * outside her domain entirely — and were shared directly with the service account. Impersonating
 * anyone here would make the call act as that person, who was never given access, and it would fail
 * with a 404 that reads exactly like a wrong file id.
 *
 * So: no `sub` claim. The share IS the authorization, and it is the narrower of the two mechanisms —
 * the account sees only files someone explicitly handed it, rather than anything in a domain.
 *
 * ─── Append-only, always ────────────────────────────────────────────────────
 *
 * This writes to a document another person owns and edits. It appends rows to ONE named tab and
 * has no code path that deletes, clears, reorders or rewrites anything — not as a policy applied at
 * runtime, but because the only Sheets method it calls is `values.append`. A sync that could
 * "correct" his sheet is a sync that can destroy his work while he is looking at it.
 *
 * ─── Dry run by default ─────────────────────────────────────────────────────
 *
 * The first thing it does to someone else's spreadsheet should be printable. `--commit` is required
 * to write; without it the run reports exactly which rows it would add and stops.
 */

const SOURCE_ID = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
const DEST_ID = process.env.LP_DEST_SHEET ?? "1ksPqkry_mu3DwPj4zvgAKimzHnNAhNVi8y-9Q-gken0";
// "Sent Log", not "Outreach Log". Discovered by listing the tabs rather than assumed from the
// document's title — the first draft guessed and got a 400 that reads like a malformed range.
const SOURCE_TAB = process.env.LP_SOURCE_TAB ?? "Sent Log";
const DEST_TAB = process.env.LP_DEST_TAB ?? "AI Outreach";
const SCOPES = "https://www.googleapis.com/auth/spreadsheets";
const COMMIT = process.argv.includes("--commit");

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** No `sub`: the account acts as itself, because the sheets were shared with it directly. */
async function accessToken(creds) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  // Signed once. An earlier draft called sign() twice inside a template string and then patched the
  // result with a regex — two different signatures over the same input, and the one that survived
  // was whichever the replace happened to keep.
  const signature = b64url(signer.sign(creds.private_key));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

async function values(token, id, tab) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}`;
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("has not been used in project")) {
      throw new Error(
        "The Google Sheets API is not enabled on the service account's project.\n" +
        "  Enable it once at console.cloud.google.com → APIs & Services → Library → Google Sheets API.",
      );
    }
    if (res.status === 404 || res.status === 403) {
      throw new Error(
        `Cannot read "${tab}" in ${id} (${res.status}).\n` +
        `  Share the sheet with the service account address as a Viewer (source) or Editor (destination),\n` +
        `  and check the tab is named exactly "${tab}".`,
      );
    }
    throw new Error(`read failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()).values ?? [];
}

/**
 * A row's identity.
 *
 * DATE + EMAIL + DRIP STAGE, because none of the three alone is unique: the same person is mailed
 * repeatedly, several people are mailed in the same batch second, and a person moves through drip
 * stages. Getting this wrong in the safe direction re-appends rows that are already there, which is
 * the failure mode that pollutes a partner's sheet — so the key is deliberately specific.
 */
const keyOf = (r) => [r[0], (r[5] ?? "").toLowerCase(), r[7]].join("|").trim();

async function main() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("No service account in the environment.");
  const token = await accessToken(creds);

  const [src, dst] = await Promise.all([
    values(token, SOURCE_ID, SOURCE_TAB),
    values(token, DEST_ID, DEST_TAB),
  ]);

  // Row 0 is the header in both. A source with only a header has nothing to sync and is not an error.
  const srcRows = src.slice(1).filter((r) => (r[0] ?? "").trim());
  const dstRows = dst.slice(1).filter((r) => (r[0] ?? "").trim());
  const have = new Set(dstRows.map(keyOf));
  const missing = srcRows.filter((r) => !have.has(keyOf(r)));

  const latest = (rows) => rows.map((r) => r[0]).filter(Boolean).sort().at(-1) ?? "none";
  console.log(`source "${SOURCE_TAB}": ${srcRows.length} rows, latest ${latest(srcRows)}`);
  console.log(`dest   "${DEST_TAB}": ${dstRows.length} rows, latest ${latest(dstRows)}`);
  console.log(`missing from dest: ${missing.length}`);

  if (missing.length === 0) {
    console.log("Nothing to sync.");
    return;
  }
  for (const r of missing.slice(0, 5)) console.log(`  + ${r[0]} ${r[5] ?? ""} (stage ${r[7] ?? "?"})`);
  if (missing.length > 5) console.log(`  … and ${missing.length - 5} more`);

  if (!COMMIT) {
    console.log("\nDRY RUN. Nothing was written. Re-run with --commit to append these rows.");
    return;
  }

  /*
   * `values.append` IS THE ONLY WRITE THIS FILE MAKES. INSERT_ROWS rather than OVERWRITE, so it
   * cannot land on top of anything a person added below the data while this was running.
   */
  const u = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${DEST_ID}/values/${encodeURIComponent(DEST_TAB)}:append`);
  u.searchParams.set("valueInputOption", "RAW");
  u.searchParams.set("insertDataOption", "INSERT_ROWS");
  const res = await fetch(u, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values: missing }),
  });
  if (!res.ok) throw new Error(`append failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  console.log(`\nAppended ${missing.length} rows to "${DEST_TAB}" (${out.updates?.updatedRange ?? "range unreported"}).`);
}

main().catch((err) => {
  console.error(`lp sync failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
