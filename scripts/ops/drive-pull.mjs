#!/usr/bin/env node
/**
 * Pull a Google Drive folder to disk — the package behind a repo change.
 *
 * Walks the folder recursively, exports Docs as text, Sheets as CSV and Slides as PDF, and copies
 * everything else byte for byte. Read-only (`drive.readonly`), impersonating the Workspace user the
 * service account is delegated for. Written on 20 Sep 2026 while a Claude Code session did the
 * westpeek.ventures refresh by hand; `repo-change.mjs` runs it at PLAN time so Danielle reads the
 * same package a person would.
 *
 * THE CREDENTIAL COMES FROM THE VAULT (`GSC_SERVICE_ACCOUNT_JSON`) and is never written anywhere.
 * Run it through `npm run vault:run -- node scripts/ops/drive-pull.mjs <folder-id> <out-dir>`.
 *
 * RULE 0: an empty folder is reported as such (exit 3), never as a quiet success.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const SUBJECT = process.env.DRIVE_SUBJECT ?? "sequoia@westpeek.ventures";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ROOT = process.argv[2]; const OUT = process.argv[3];
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function accessToken(creds) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: SUBJECT, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const s = createSign("RSA-SHA256"); s.update(`${header}.${claims}`);
  const sig = b64url(s.sign(creds.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` }) });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0,300)}`);
  return (await res.json()).access_token;
}
const EXPORT = { "application/vnd.google-apps.document": ["text/plain", ".txt"], "application/vnd.google-apps.spreadsheet": ["text/csv", ".csv"], "application/vnd.google-apps.presentation": ["application/pdf", ".pdf"] };
async function walk(token, id, dir) {
  mkdirSync(dir, { recursive: true });
  let pageToken = "";
  do {
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q", `'${id}' in parents and trashed=false`);
    u.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size)");
    u.searchParams.set("supportsAllDrives", "true"); u.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0,300)}`);
    const j = await r.json(); pageToken = j.nextPageToken ?? "";
    for (const f of j.files) {
      if (f.mimeType === "application/vnd.google-apps.folder") { await walk(token, f.id, join(dir, f.name)); continue; }
      let url, name = f.name;
      if (EXPORT[f.mimeType]) { const [mt, ext] = EXPORT[f.mimeType]; url = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(mt)}`; name += ext; }
      else if (f.mimeType.startsWith("application/vnd.google-apps")) { console.log(`SKIP ${dir}/${f.name} (${f.mimeType})`); continue; }
      else url = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`;
      const d = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!d.ok) { console.log(`FAIL ${dir}/${name} ${d.status}`); continue; }
      writeFileSync(join(dir, name), Buffer.from(await d.arrayBuffer()));
      console.log(`${dir}/${name} (${f.size ?? "export"})`);
    }
  } while (pageToken);
}
const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
if (!creds) throw new Error("No service account in the environment.");
if (!ROOT || !OUT) { console.error("usage: drive-pull.mjs <folder-id> <out-dir>"); process.exit(2); }
let pulled = 0;
const origLog = console.log;
console.log = (...a) => { if (!/^(SKIP|FAIL) /.test(String(a[0] ?? ""))) pulled += 1; origLog(...a); };
await walk(await accessToken(creds), ROOT, OUT);
console.log = origLog;
if (pulled === 0) { console.error(`NAMED STOP [EMPTY_PACKAGE] folder ${ROOT} yielded no readable file.`); process.exit(3); }
console.log(`pulled ${pulled} file(s) into ${OUT}`);
