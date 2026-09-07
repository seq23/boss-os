/**
 * WHAT IS WORKING AND WHAT IS NOT — Camille's weekly read of the properties.
 *
 * Her ask: "the employees should also be looking for ways to help me improve my side hustles.
 * checking google search console and figuring out whats working and whats fucking not."
 *
 * ─── This is deliberately NOT the daily check I argued against ──────────────
 *
 * Search Console lags two to three days, so a daily number is yesterday's weather with no decision
 * attached — a habit rather than a system. Weekly, compared against the previous week, is the
 * shortest window where a change means anything.
 *
 * ─── It reports MOVEMENT, not totals ────────────────────────────────────────
 *
 * A table of impressions is a dashboard: she reads it, feels something, and does nothing. What can
 * actually be acted on is what CHANGED — a query that gained a hundred impressions and no clicks is
 * a title tag problem; a page that lost half its clicks is a ranking slip; a query newly appearing
 * is a foothold. Those have different fixes, so they are reported as different things.
 *
 * ─── Why a local script and not an agent ────────────────────────────────────
 *
 * The Claude Code runner strips every credential from its environment on purpose — nothing matching
 * KEY, TOKEN, SECRET or PASSCODE survives — so an agent cannot authenticate to her Search Console
 * and should not be able to. Agents research the open web; local jobs read her accounts. That split
 * is the architecture rather than an inconvenience, and it is why this runs as her.
 */

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const JSON_OUT = process.argv.includes("--json");
const MIN_IMPRESSIONS = Number(process.env.GSC_MIN_IMPRESSIONS ?? 50);

const b64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(creds) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // As itself: Search Console properties are shared with the service account address directly,
  // exactly like the spreadsheets. No impersonation, no domain-wide delegation.
  const c = b64(JSON.stringify({
    iss: creds.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const s = createSign("RSA-SHA256");
  s.update(`${h}.${c}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${h}.${c}.${b64(s.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function query(token, site, dimension, startDate, endDate) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions: [dimension], rowLimit: 500 }),
    },
  );
  if (!res.ok) return null;
  return (await res.json()).rows ?? [];
}

/**
 * Week over week, per key.
 *
 * THE LAG IS BUILT IN. Search Console is two to three days behind, so "this week" ends three days
 * ago rather than today — otherwise the most recent days are always partial and every property
 * looks like it is collapsing.
 */
function compare(current, previous) {
  const prev = new Map((previous ?? []).map((r) => [r.keys[0], r]));
  const out = [];
  for (const row of current ?? []) {
    const key = row.keys[0];
    const was = prev.get(key);
    out.push({
      key,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
      clicks_delta: row.clicks - (was?.clicks ?? 0),
      impressions_delta: row.impressions - (was?.impressions ?? 0),
      position_delta: was ? was.position - row.position : null, // positive = improved
      is_new: !was,
    });
  }
  // Anything that vanished entirely: the loudest signal and invisible if you only read what is there.
  for (const [key, was] of prev) {
    if (!(current ?? []).some((r) => r.keys[0] === key) && was.clicks > 0) {
      out.push({
        key, clicks: 0, impressions: 0, position: null,
        clicks_delta: -was.clicks, impressions_delta: -was.impressions,
        position_delta: null, is_new: false, vanished: true,
      });
    }
  }
  return out;
}

async function main() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) { console.error("No service account in the environment."); process.exitCode = 1; return; }
  const token = await accessToken(creds);

  const sitesRes = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!sitesRes.ok) {
    throw new Error(
      `Search Console refused (${sitesRes.status}). The service account must be added as a user on ` +
      `each property: Search Console → Settings → Users and permissions → Add user → ` +
      `${creds.client_email} (Full or Restricted).`,
    );
  }
  const sites = ((await sitesRes.json()).siteEntry ?? []).map((s) => s.siteUrl);
  if (sites.length === 0) {
    console.log(`No properties are shared with ${creds.client_email}.`);
    console.log("Add it in Search Console → Settings → Users and permissions on each property.");
    return;
  }

  // This week ends 3 days ago because the data does; the week before it is the comparison.
  const thisWeek = [day(10), day(3)];
  const lastWeek = [day(17), day(10)];

  const report = [];
  for (const site of sites) {
    const [qNow, qPrev, pNow, pPrev] = await Promise.all([
      query(token, site, "query", ...thisWeek),
      query(token, site, "query", ...lastWeek),
      query(token, site, "page", ...thisWeek),
      query(token, site, "page", ...lastWeek),
    ]);
    if (qNow === null) continue;

    const queries = compare(qNow, qPrev).filter((r) => r.impressions >= MIN_IMPRESSIONS || r.vanished);
    const pages = compare(pNow, pPrev);

    report.push({
      site,
      clicks: (qNow ?? []).reduce((n, r) => n + r.clicks, 0),
      clicks_prev: (qPrev ?? []).reduce((n, r) => n + r.clicks, 0),
      /*
       * THE THREE THINGS THAT HAVE DIFFERENT FIXES.
       * Rising = do more of it. Impressions up with no clicks = the title or snippet is wrong, not
       * the ranking. Falling = something slipped, and it is the only one that is urgent.
       */
      rising: queries.filter((r) => r.clicks_delta > 0).sort((a, b) => b.clicks_delta - a.clicks_delta).slice(0, 5),
      seen_not_clicked: queries
        .filter((r) => r.impressions_delta > 20 && r.clicks_delta <= 0 && r.clicks === 0)
        .sort((a, b) => b.impressions_delta - a.impressions_delta).slice(0, 5),
      falling: queries.filter((r) => r.clicks_delta < 0).sort((a, b) => a.clicks_delta - b.clicks_delta).slice(0, 5),
      pages_falling: pages.filter((r) => r.clicks_delta < -2).sort((a, b) => a.clicks_delta - b.clicks_delta).slice(0, 3),
    });
  }

  if (JSON_OUT) { console.log(JSON.stringify({ checked_at: new Date().toISOString(), report }, null, 2)); return; }

  console.log(`Property performance — ${thisWeek[0]} to ${thisWeek[1]} vs the week before\n`);
  for (const r of report) {
    const delta = r.clicks - r.clicks_prev;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    console.log(`${r.site}`);
    console.log(`  ${r.clicks} clicks ${arrow} ${delta >= 0 ? "+" : ""}${delta}`);
    for (const q of r.rising) console.log(`    rising    "${q.key}" +${q.clicks_delta} clicks`);
    for (const q of r.seen_not_clicked) console.log(`    seen only "${q.key}" +${q.impressions_delta} impressions, 0 clicks — title/snippet, not ranking`);
    for (const q of r.falling) console.log(`    falling   "${q.key}" ${q.clicks_delta} clicks`);
    for (const p of r.pages_falling) console.log(`    page down ${p.key} ${p.clicks_delta} clicks`);
    if (!r.rising.length && !r.seen_not_clicked.length && !r.falling.length) console.log("    nothing moved enough to act on");
    console.log();
  }
}

main().catch((err) => {
  console.error(`property performance failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
