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

const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.westpeek.ventures";
const LP_SHEET = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
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

async function tab(token, sheet, name) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent(name)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  return (await res.json()).values ?? [];
}

/**
 * 'YYYY-MM' out of whatever the sheet happens to hold in its date column.
 *
 * THE COLUMN IS NOT CONSISTENT AND THAT IS NOT A BUG TO FIX HERE. The Sent Log's first row reads
 * `2026-07-23T12:08:57Z` and its last reads `2026-09-07 12:41:00` — two writers, two formats, one
 * column. Both start with an ISO date, so the first seven characters are the month in every row
 * that has one, and anything that does not match is dropped rather than guessed at. Guessing a
 * month is how a send lands in the wrong one for ever.
 */
const monthOf = (value) => {
  const m = /^(\d{4}-\d{2})/.exec(String(value ?? "").trim());
  return m ? m[1] : null;
};

const local = (offsetDays) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("No service account in the environment. Run this through `npm run returns:contribute`.");

  const nowMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
    .format(new Date()).slice(0, 7);
  const month = TARGET_MONTH ?? nowMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`"${month}" is not a month. Use YYYY-MM.`);

  const measurements = [];
  const failures = [];

  // ─── West Peek: LP sends against LP replies ────────────────────────────────
  const sheetToken = await accessToken(creds, "https://www.googleapis.com/auth/spreadsheets");
  const sent = await tab(sheetToken, LP_SHEET, "Sent Log");
  const replies = await tab(sheetToken, LP_SHEET, "Reply Log");

  if (!sent || !replies) {
    failures.push(
      "The LP tracker could not be read in full, so nothing was contributed for the raise. A send " +
      "count without a reply count is the vanity number this ledger exists to refuse.",
    );
  } else {
    const sentRows = sent.slice(1).filter((r) => (r[0] ?? "").trim());
    const replyRows = replies.slice(1).filter((r) => (r[0] ?? "").trim());

    const sentByMonth = new Map();
    for (const r of sentRows) {
      const m = monthOf(r[0]);
      if (m) sentByMonth.set(m, (sentByMonth.get(m) ?? 0) + 1);
    }
    const repliesByMonth = new Map();
    for (const r of replyRows) {
      const m = monthOf(r[0]);
      if (m) repliesByMonth.set(m, (repliesByMonth.get(m) ?? 0) + 1);
    }

    /*
     * A REPLY IS COUNTED IN THE MONTH IT ARRIVED, not the month the email that produced it was
     * sent, and that is a real distortion at these volumes — an August send answered in September
     * appears as September effort it did not cause. It is stated rather than corrected, because
     * correcting it needs a thread id the sheet does not carry, and a silently wrong attribution
     * would be worse than a labelled approximate one.
     */
    const note = "Replies are counted in the month they arrived, not the month of the send that earned them.";

    for (const m of new Set([...sentByMonth.keys(), ...repliesByMonth.keys()])) {
      measurements.push({
        line: "west_peek_raise", period: m, source: "lp_tracker",
        effort_label: "LP emails sent", effort_count: sentByMonth.get(m) ?? 0,
        outcome_label: "replies", outcome_count: repliesByMonth.get(m) ?? 0,
        note,
      });
    }

    // The lifetime pair, which is the one she already knows and the one the ledger is judged by.
    measurements.push({
      line: "west_peek_raise", period: "all", source: "lp_tracker",
      effort_label: "LP emails sent, all time", effort_count: sentRows.length,
      outcome_label: "replies", outcome_count: replyRows.length,
      note,
    });
  }

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

      for (const site of sites) {
        const host = site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
        const line = lineByHost.get(host);
        if (!line) continue; // A property that belongs to no declared line is not silently pooled.
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
  for (const f of failures) console.error(`  gap: ${f}`);

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
