#!/usr/bin/env node
/**
 * PUT EVERY OUTREACH BUSINESS DOMAIN ON THE time-2-read WORKSPACE, AT $0 (9 Oct 2026).
 *
 *   npm run vault:run -- node scripts/outreach/domains.mjs           # do it
 *   npm run vault:run -- node scripts/outreach/domains.mjs --check   # read-only: what is missing
 *
 * For each business in `src/worker/boss/outreach/catalog.ts` whose sender is not the mailbox itself:
 *   1. Site Verification token for the domain → TXT record in Cloudflare DNS → verify;
 *   2. the domain added to the Workspace as a SECONDARY domain (free; no licence);
 *   3. the sender (hello@<domain>) added as an ALIAS of st@time-2-read.com (free; no new user);
 *   4. a Gmail send-as for that alias, so Gmail sends From it without rewriting;
 *   5. SPF on the domain includes Google, keeping whatever it already includes.
 * The Worker then notices the alias in the send-as list on its next tick, proves it with one email
 * to the test inbox, and only then lets the business send.
 *
 * ─── $0, CHECKED, NOT ASSUMED ─────────────────────────────────────────────────
 * Owner's rule: never a new user, licence, plan or billing change. This script calls no endpoint
 * that creates a user, and it COUNTS the Workspace's users before and after; a different count
 * aborts with a named failure. Secondary domains and aliases carry no charge.
 *
 * ─── NAMED STOP ──────────────────────────────────────────────────────────────
 * Until the delegation scopes below are granted, Google refuses the token and this prints the exact
 * click path and exits 3. Credentials are read by name from the vault runner's environment:
 * GSC_SERVICE_ACCOUNT_JSON and CLOUDFLARE_API_TOKEN. Nothing is printed from either.
 */
import { createSign } from "node:crypto";
import { BUSINESSES, OUTREACH_MAILBOX } from "../../src/worker/boss/outreach/catalog.ts";

const CHECK_ONLY = process.argv.includes("--check");
const ADMIN = process.env.OUTREACH_WORKSPACE_ADMIN ?? OUTREACH_MAILBOX;
const G = "https://www.googleapis.com/auth/";
const SCOPES = {
  domain: `${G}admin.directory.domain`,
  alias: `${G}admin.directory.user.alias`,
  users: `${G}admin.directory.user.readonly`,
  verify: `${G}siteverification`,
  sendas: `${G}gmail.settings.sharing`,
};
const CLIENT_ID = "109529914046573753934";

const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
const CF = process.env.CLOUDFLARE_API_TOKEN;
if (!creds) { console.error("NAMED STOP: GSC_SERVICE_ACCOUNT_JSON is not in the environment. Run under `npm run vault:run --`."); process.exit(3); }

const b64 = (s) => Buffer.from(s).toString("base64url");
async function token(sub, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const c = b64(JSON.stringify({ iss: creds.client_email, sub, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 1800 }));
  const s = createSign("RSA-SHA256"); s.update(`${h}.${c}`);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${s.sign(creds.private_key).toString("base64url")}` }),
  });
  const j = await r.json();
  return j.access_token ?? null;
}

async function g(tok, method, url, body) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, j };
}

const tokens = {};
const missing = [];
for (const [k, scope] of Object.entries(SCOPES)) {
  tokens[k] = await token(k === "sendas" ? OUTREACH_MAILBOX : ADMIN, scope);
  if (!tokens[k]) missing.push(scope);
}
if (missing.length) {
  console.error("NAMED STOP [OUTREACH_DOMAINS_SCOPES]: Google refused these delegation scopes:");
  for (const m of missing) console.error(`  ${m}`);
  console.error(`
  One screen, as the Workspace super admin (admin.google.com):
    Security → Access and data control → API controls → Manage Domain Wide Delegation
    → client ${CLIENT_ID} → Edit → append to the existing list (comma-separated):
      ${Object.values(SCOPES).join(",")}
    → Authorize.
  Then run:  npm run vault:run -- node scripts/outreach/domains.mjs
  (If the super admin is not ${ADMIN}, set OUTREACH_WORKSPACE_ADMIN to that address.) Adds $0: no user, no licence.`);
  process.exit(3);
}

const countUsers = async () => {
  let n = 0, page = "";
  do {
    const r = await g(tokens.users, "GET", `https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=500${page ? `&pageToken=${page}` : ""}`);
    if (r.status !== 200) throw new Error(`users.list ${r.status}: ${JSON.stringify(r.j).slice(0, 200)}`);
    n += (r.j.users ?? []).length; page = r.j.nextPageToken ?? "";
  } while (page);
  return n;
};
const usersBefore = await countUsers();
console.log(`Workspace users before: ${usersBefore}`);

async function cfZone(domain) {
  if (!CF) return null;
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${domain}`, { headers: { authorization: `Bearer ${CF}` } });
  return (await r.json()).result?.[0]?.id ?? null;
}
async function cfTxt(zone, name, content, replaceIf) {
  const H = { authorization: `Bearer ${CF}`, "content-type": "application/json" };
  const list = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?type=TXT&name=${name}`, { headers: H })).json();
  const recs = list.result ?? [];
  if (recs.some((r) => r.content.replace(/"/g, "") === content)) return "present";
  const old = replaceIf ? recs.find((r) => replaceIf(r.content.replace(/"/g, ""))) : null;
  if (CHECK_ONLY) return old ? "would update" : "would add";
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records${old ? `/${old.id}` : ""}`, {
    method: old ? "PUT" : "POST", headers: H, body: JSON.stringify({ type: "TXT", name, content, ttl: 300 }),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`Cloudflare TXT ${name}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return old ? "updated" : "added";
}

const report = [];
const sendAs = await g(tokens.sendas, "GET", "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs");
const haveSendAs = new Set((sendAs.j.sendAs ?? []).map((s) => s.sendAsEmail.toLowerCase()));

for (const b of BUSINESSES) {
  if (b.sender === OUTREACH_MAILBOX) continue;
  const row = { domain: b.domain };
  try {
    const zone = await cfZone(b.domain);
    // 1. Verify ownership.
    const t = await g(tokens.verify, "POST", "https://www.googleapis.com/siteVerification/v1/token", { verificationMethod: "DNS_TXT", site: { type: "INET_DOMAIN", identifier: b.domain } });
    if (t.status !== 200) throw new Error(`verification token ${t.status}`);
    if (zone) row.txt = await cfTxt(zone, b.domain, t.j.token);
    else row.txt = `NOT ON CLOUDFLARE — add TXT ${b.domain} "${t.j.token}" at its DNS host`;
    if (!CHECK_ONLY && zone) {
      const v = await g(tokens.verify, "POST", "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT", { site: { type: "INET_DOMAIN", identifier: b.domain } });
      row.verified = v.status === 200 ? "yes" : `not yet (${v.status}; DNS may need minutes)`;
    }
    // 2. Secondary domain.
    const d = await g(tokens.domain, "GET", `https://admin.googleapis.com/admin/directory/v1/customer/my_customer/domains/${b.domain}`);
    if (d.status === 200) row.workspace = d.j.verified ? "secondary domain, verified" : "secondary domain, unverified";
    else if (!CHECK_ONLY) {
      const ins = await g(tokens.domain, "POST", "https://admin.googleapis.com/admin/directory/v1/customer/my_customer/domains", { domainName: b.domain });
      row.workspace = ins.status === 200 ? "secondary domain added" : `domain insert ${ins.status}: ${JSON.stringify(ins.j).slice(0, 120)}`;
    } else row.workspace = "would add secondary domain";
    // 3. Alias on the one existing user.
    if (!CHECK_ONLY) {
      const a = await g(tokens.alias, "POST", `https://admin.googleapis.com/admin/directory/v1/users/${OUTREACH_MAILBOX}/aliases`, { alias: b.sender });
      row.alias = a.status === 200 ? "added" : a.status === 409 ? "present" : `alias ${a.status}: ${JSON.stringify(a.j).slice(0, 120)}`;
    }
    // 4. Send-as.
    if (haveSendAs.has(b.sender)) row.sendAs = "present";
    else if (!CHECK_ONLY) {
      const s = await g(tokens.sendas, "POST", "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", { sendAsEmail: b.sender, displayName: b.brand, treatAsAlias: true });
      row.sendAs = s.status === 200 ? `added (${s.j.verificationStatus ?? "accepted"})` : `sendAs ${s.status}: ${JSON.stringify(s.j).slice(0, 120)}`;
    } else row.sendAs = "would add";
    // 5. SPF keeps what is there and adds Google.
    if (zone) {
      const list = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?type=TXT&name=${b.domain}`, { headers: { authorization: `Bearer ${CF}` } })).json();
      const spf = (list.result ?? []).map((r) => r.content.replace(/"/g, "")).find((c) => c.startsWith("v=spf1"));
      const want = spf
        ? (spf.includes("_spf.google.com") ? spf : spf.replace("v=spf1", "v=spf1 include:_spf.google.com"))
        : "v=spf1 include:_spf.google.com ~all";
      row.spf = await cfTxt(zone, b.domain, want, (c) => c.startsWith("v=spf1"));
    } else row.spf = "NOT ON CLOUDFLARE — SPF must include _spf.google.com at its DNS host";
  } catch (err) {
    row.error = err.message;
  }
  report.push(row);
}

const usersAfter = await countUsers();
for (const r of report) console.log(JSON.stringify(r));
if (usersAfter !== usersBefore) {
  console.error(`FAILED: Workspace users changed ${usersBefore} → ${usersAfter}. This script must never add a user or a licence.`);
  process.exit(1);
}
console.log(`Workspace users after: ${usersAfter} (unchanged — $0 added).`);
