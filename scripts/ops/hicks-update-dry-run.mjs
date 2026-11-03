#!/usr/bin/env node
/**
 * DRY RUN OF THE HICKS QUARTERLY UPDATE: live numbers, nothing stored, nothing sent.
 *
 *   npm run -s vault:run -- npm run -s hicks:dry-run -- --name <greeting name> \
 *     --last-sent <clicks> --last-sent-at <ISO time> [--told author,ai-visits] [--carry "<line>"] [--past-subjects "a|b"]
 *
 * Reads Search Console as the read-only service account (GSC_SERVICE_ACCOUNT_JSON, injected by the
 * vault, never printed) and the merged PRs with `gh` (GET only), then prints the draft the Worker's
 * quarterly job would put in front of her, composed by the same module (src/shared/boss/clients/
 * hicksUpdate.mjs). The greeting name and the last figure are arguments: no client name in the repo.
 * Rule 0: a source it cannot read prints "not read", and the run says which.
 */
import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { REPO, SITE, clickWindows, sumWindows, plainFixes, composeDraft, draftProblems, aiWindows, researchWins } from "../../src/shared/boss/clients/hicksUpdate.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function gscToken() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return { ok: false, why: "no Search Console key in this process (run it through the vault)" };
  const creds = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: creds.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const s = createSign("RSA-SHA256"); s.update(unsigned);
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${s.sign(creds.private_key).toString("base64url")}` }) }).catch(() => null);
  if (!res?.ok) return { ok: false, why: `Search Console token refused (${res?.status ?? "no answer"})` };
  return { ok: true, token: (await res.json()).access_token };
}

async function readClicks(now) {
  const t = await gscToken();
  if (!t.ok) return t;
  const h = { authorization: `Bearer ${t.token}`, "content-type": "application/json" };
  const sites = await (await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: h })).json().catch(() => ({}));
  const have = new Set((sites.siteEntry ?? []).map((s) => s.siteUrl));
  const property = [`sc-domain:${SITE}`, `https://www.${SITE}/`, `https://${SITE}/`].find((p) => have.has(p));
  if (!property) return { ok: false, why: `no Search Console property for ${SITE} is shared with the service account` };
  const w = clickWindows(now);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: h, body: JSON.stringify({ startDate: w.prev.start, endDate: w.now.end, dimensions: ["date"], rowLimit: 500 }) });
  if (!res.ok) return { ok: false, why: `Search Console answered ${res.status}` };
  const rows = ((await res.json()).rows ?? []).map((r) => ({ date: r.keys[0], clicks: r.clicks }));
  const q = async (dim, win, map) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: h, body: JSON.stringify({ startDate: win.start, endDate: win.end, dimensions: [dim], rowLimit: 1000 }) });
    return r.ok ? ((await r.json()).rows ?? []).map(map) : null;
  };
  const qm = (x) => ({ query: x.keys[0], position: x.position, impressions: x.impressions }), pm = (x) => ({ page: x.keys[0], impressions: x.impressions });
  const [qn, qp, pn, pp] = [await q("query", w.now, qm), await q("query", w.prev, qm), await q("page", w.now, pm), await q("page", w.prev, pm)];
  const ai = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/search-loop/ai-daily.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const research = researchWins({
    queries: qn && qp ? { ok: true, now: qn, prev: qp } : { ok: false, why: "Search Console did not answer" },
    pages: pn && pp ? { ok: true, now: pn, prev: pp } : { ok: false, why: "Search Console did not answer" },
    ai: ai ? { ok: true, ...aiWindows(ai, w) } : { ok: false, why: "the AI measurement file did not answer" },
  });
  return { ok: true, ...sumWindows(rows, w), windows: w, property, research };
}

function readFixes(since) {
  try {
    const out = execFileSync("gh", ["pr", "list", "-R", REPO, "--state", "merged", "--limit", "100", "--json", "title,mergedAt"], { encoding: "utf8" });
    const prs = JSON.parse(out).map((p) => ({ title: p.title, merged_at: p.mergedAt })).filter((p) => !since || p.merged_at > since);
    return { ok: true, prs };
  } catch (e) { return { ok: false, why: `GitHub did not answer (${String(e?.message ?? e).slice(0, 80)})` }; }
}

async function main() {
  const now = Date.now();
  const lastSentAt = opt("--last-sent-at");
  const lastSent = opt("--last-sent") == null ? null : Number(opt("--last-sent"));
  const told = (opt("--told") ?? "").split(",").filter(Boolean);
  const c = await readClicks(now);
  const f = readFixes(lastSentAt);
  const clicks = c.ok ? { ok: true, now: c.now, prev: c.prev, lastSent, lastSentAt: lastSentAt ? Date.parse(lastSentAt) : null } : c;
  const fixes = f.ok ? { ok: true, items: plainFixes(f.prs, { told }) } : f;
  const carry = opt("--carry") ? [{ id: "carry", line: opt("--carry") }] : [];
  const pastSubjects = (opt("--past-subjects") ?? "").split("|").filter(Boolean);
  const research = c.ok ? c.research : { wins: [], unread: ["research: Search Console not read"], dropped: [] };
  const draft = composeDraft({ name: opt("--name"), clicks, fixes, carryOver: carry, pastSubjects, wins: research.wins, now });
  console.log(`Subject: ${draft.subject}\n\n${draft.text}\n`);
  console.log(`-- census: verdict ${draft.verdict}; clicks ${c.ok ? `${c.now} (${c.windows.now.start}..${c.windows.now.end}) vs ${c.prev} before, last email ${lastSent ?? "not given"}` : `not read: ${c.why}`}; PRs since last email ${f.ok ? f.prs.length : `not read: ${f.why}`}, plain fixes ${fixes.ok ? fixes.items.length : "not read"}; problems: ${draftProblems(draft.text, draft.subject).join("; ") || "none"}`);
  console.log(`-- research: wins ${research.wins.map((x) => x.key).join(", ") || "none"}; unread: ${research.unread.join(" | ") || "none"}; dropped: ${research.dropped.join(", ") || "none"}`);
}

main().catch((e) => { console.error(`NAMED STOP [HICKS_DRY_RUN_FAILED] ${e?.message ?? e}`); process.exit(1); });
