/**
 * THE HALF OF THE RETURN LEDGER THAT ONLY HER MAC CAN SEE.
 *
 * Boss OS computes what D1 holds — touches, buyer candidates, deals, backlink prospects — and it
 * cannot compute the two numbers that matter most, because the Claude Code runner strips every
 * credential from its environment on purpose. The LP tracker is a Google Sheet and Search Console
 * needs a service account, so both are unreachable from the Worker by design rather than by
 * omission. This script runs as her, reads them, and POSTs the counts in.
 *
 * It sends COUNTS AND NOTHING ELSE. No LP name, no address, no firm, no query, no URL — the
 * endpoint has no column to put any of those in. What crosses the wire is "542 emails, 4 replies,
 * September".
 *
 *   npm run returns:contribute              # the current month, plus every month in the LP sheet
 *   npm run returns:contribute -- --month 2026-08
 *   npm run returns:contribute -- --dry-run # print what would be sent, send nothing
 *
 * ─── Why a ratio is refused rather than half-sent ────────────────────────────
 *
 * If the Reply Log cannot be read, the send count is NOT contributed on its own. "542 emails sent"
 * with no reply number beside it is the vanity figure this whole feature exists to stop printing,
 * and a row with a null outcome and no reason attached is worse than no row: the ledger would show
 * the line as unmeasured while quietly holding a number that says otherwise. Either both halves
 * arrive or the failure is reported.
 */

import { createSign } from "node:crypto";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DRY = process.argv.includes("--dry-run");
const monthArg = process.argv.indexOf("--month");
const TARGET_MONTH = monthArg !== -1 ? process.argv[monthArg + 1] : null;

const b64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** As itself, not impersonating: both the sheets and the Search Console properties are shared with
 * the service account address directly. Same pattern as packet-remind.mjs and property-performance.mjs. */
async function accessToken(creds, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: creds.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const s = createSign("RSA-SHA256");
  s.update(`${h}.${claim}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${h}.${claim}.${b64(s.sign(creds.private_key))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

const local = (offsetDays) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("No service account in the environment. Run this through `npm run returns:contribute`.");

  const nowMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
    .format(new Date()).slice(0, 7);
  const month = TARGET_MONTH ?? nowMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`"${month}" is not a month. Use YYYY-MM.`);

  const measurements = [];
  /*
   * TWO LISTS, NOT ONE, AND THE EXIT CODE ONLY WATCHES THE FIRST.
   *
   * A `failure` is something that went wrong in this run — a sheet that would not read, an API that
   * refused — and it must exit non-zero, because a scheduled job that fails quietly leaves the
   * ledger showing last month's numbers as if they were this month's.
   *
   * A `gap` is a standing fact about her estate that this run correctly observed: 19 Search Console
   * properties belong to no declared income line. That is worth printing every time and it is not a
   * failure of the run. Exiting 1 on it would make a healthy job look broken for ever, which is how
   * a red status stops being read at all.
   */
  const failures = [];
  const gaps = [];

  /*
   * ─── WEST PEEK'S RAISE IS NOT CONTRIBUTED, AND THAT IS THE OWNER'S DECISION ───
   *
   * 19 September 2026: "I don't want it to track the LP stuff for West Peek on that tab — that's
   * irrelevant here … the overall amount of money raised and all that is not for Boss OS." This
   * block used to read the LP tracker's Sent Log and Reply Log and contribute "LP emails sent /
   * replies" as the `west_peek_raise` line. The Worker now refuses that line by name
   * (`RETURN_LINES` in today/returns.ts), so the read is gone rather than sent and rejected.
   * Monique's LP-reply duties (lp-replies.sh, lp-positive.mjs) are her personal LP search and are
   * untouched by this.
   */

  // ─── Spry: Search Console impressions against clicks, per line ─────────────
  //
  // The properties belonging to each line are read from the Worker rather than restated here.
  // A second copy of that mapping in this file would drift from projects.ts the first time a
  // property moved between lines, and nothing would ever say so.
  const cookie = await unlock();
  const ledger = await getJson(`${ORIGIN}/api/boss/wealth/returns?period=${month}`, cookie);
  const lineByHost = new Map();
  for (const def of ledger.data.lines_defined ?? []) {
    for (const property of def.properties ?? []) {
      const host = String(property).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
      // "local guides generator — 5 verticals" and "@howweknowdeep" are descriptions rather than
      // domains. A property with no dot is not a host and is skipped rather than matched loosely.
      if (host.includes(".")) lineByHost.set(host, def.line);
    }
  }

  const gscToken = await accessToken(creds, "https://www.googleapis.com/auth/webmasters.readonly");
  const sitesRes = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${gscToken}` },
  });
  if (!sitesRes.ok) {
    failures.push(`Search Console refused (${sitesRes.status}); no traffic was contributed for the Spry lines.`);
  } else {
    /*
     * THE WINDOW IS THE CALENDAR MONTH, CLIPPED BY THE LAG. Search Console is two to three days
     * behind, so a month-to-date read ends three days ago; asking for today's date would return a
     * partial final day and make every current month look like a collapse. `window_days` records
     * how much of the month was actually covered, so a part-month is never compared to a full one
     * by accident.
     */
    const start = `${month}-01`;
    const lastOfMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString().slice(0, 10);
    const end = lastOfMonth < local(3) ? lastOfMonth : local(3);

    if (end < start) {
      failures.push(`${month} has no Search Console data yet — the API lags three days and the month has not started.`);
    } else {
      const windowDays = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
      const totals = new Map();
      const sites = ((await sitesRes.json()).siteEntry ?? []).map((s) => s.siteUrl);
      let matched = 0;
      const unattributed = [];

      for (const site of sites) {
        const host = site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
        const line = lineByHost.get(host);
        /*
         * A PROPERTY BELONGING TO NO DECLARED LINE IS NAMED, NOT SILENTLY POOLED.
         *
         * Pooling it would invent traffic for a line that did not earn it. Skipping it quietly
         * would be worse in a different way, which is what the first version did: 19 of her 23
         * Search Console properties are not listed against any income line in projects.ts, so most
         * of the portfolio's traffic was being dropped on the floor with nothing saying so. That is
         * a real gap in what the OS knows about her own estate, and it belongs in the output.
         */
        if (!line) { unattributed.push(host); continue; }
        matched++;
        const res = await fetch(
          `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${gscToken}`, "content-type": "application/json" },
            body: JSON.stringify({ startDate: start, endDate: end, dimensions: [], rowLimit: 1 }),
          },
        );
        if (!res.ok) { failures.push(`${site}: Search Console returned ${res.status}`); continue; }
        const row = ((await res.json()).rows ?? [])[0];
        const acc = totals.get(line) ?? { clicks: 0, impressions: 0, sites: 0 };
        acc.clicks += row?.clicks ?? 0;
        acc.impressions += row?.impressions ?? 0;
        acc.sites += 1;
        totals.set(line, acc);
      }

      if (unattributed.length) {
        gaps.push(
          `${unattributed.length} Search Console propert${unattributed.length === 1 ? "y belongs" : "ies belong"} to no income line ` +
          `declared in projects.ts, so their traffic is attributed to nothing: ${unattributed.join(", ")}.`,
        );
      }

      if (matched === 0) {
        failures.push(
          "No Search Console property matched a declared line. Either the service account has lost access, " +
          "or projects.ts lists properties under names that are not their domains.",
        );
      }

      for (const [line, acc] of totals) {
        measurements.push({
          line, period: month, source: "search_console",
          effort_label: `impressions earned across ${acc.sites} propert${acc.sites === 1 ? "y" : "ies"}`,
          effort_count: Math.round(acc.impressions),
          outcome_label: "clicks", outcome_count: Math.round(acc.clicks),
          window_days: windowDays,
          note: end < lastOfMonth ? `Month to date: ${start} to ${end}. Search Console lags three days.` : null,
        });
      }
    }
  }

  // ─── Report, then send ────────────────────────────────────────────────────
  for (const m of measurements) {
    const ratio = m.effort_count > 0 && m.outcome_count !== null
      ? ` · ${Math.round((m.outcome_count / m.effort_count) * 1000)} per 1,000`
      : "";
    console.log(`${m.period}  ${m.line.padEnd(18)} ${m.outcome_count} ${m.outcome_label} from ${m.effort_count} ${m.effort_label}${ratio}`);
  }
  for (const g of gaps) console.log(`  gap: ${g}`);
  for (const f of failures) console.error(`  FAILED: ${f}`);

  /*
   * RULE 0: A RUN THAT MEASURED NOTHING MUST NOT EXIT 0. Both sources failing looks identical to a
   * quiet success from the outside — the ledger simply shows last month's numbers again — and this
   * is exactly the "runs but inert" defect the repo keeps producing.
   */
  if (measurements.length === 0) {
    console.error("Nothing could be measured. Neither the LP tracker nor Search Console produced a usable pair.");
    process.exitCode = 1;
    return;
  }

  if (DRY) { console.log(`\nDRY RUN. ${measurements.length} measurements would be sent to ${ORIGIN}.`); return; }

  const res = await fetch(`${ORIGIN}/api/boss/wealth/returns`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ measurements }),
  });
  if (!res.ok) throw new Error(`contribution refused (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  console.log(`\nRecorded ${out.data.recorded} measurements.`);
  if (failures.length) process.exitCode = 1;
}

async function unlock() {
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) throw new Error(`unlock failed (${res.status})`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getJson(url, cookie) {
  const res = await fetch(url, { headers: { cookie } });
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json();
}

main().catch((err) => {
  console.error(`return ledger contribution failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
