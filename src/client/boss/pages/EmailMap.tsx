import { useState } from "react";
import { emailRepos } from "@shared/boss/maps/chain.mjs";
import { FromRepoLine, repoOnly } from "./Maps";
import manifest from "@shared/boss/emailMap/manifest.json";

/**
 * THE EMAIL MAP (owner, 31 Oct 2026: "one Email Map page inside Boss OS, all businesses"). Every
 * automated email anything of hers sends — to her, Valerie, Scooter, prospects, brands, LPs,
 * offices, groups — grouped by business. Rendered from the ONE list,
 * src/shared/boss/emailMap/manifest.json; never a copy (tests/outboundEmailMap.test.ts).
 *
 * Phone first (390px), calm: the summary first, a pull-down to pick a business, then one labelled
 * expander per business. Each email shows what it is, who sends it, to whom and when without
 * opening; "Show details" holds the from address, where it runs, its trigger and how to pause it.
 *
 * Links in: /?tab=emails, /?tab=emails&business=<key>.
 */
export interface EmailRow {
  /** A short name for the card's title (a few words); `what` is the description under it. */
  id: string; business: string; name: string; what: string; sender: string; owner: string; from: string; to: string;
  when: string; runs: string; trigger: string; pause: string; launchd?: string[];
  /** Why a row runs outside any repo (an external tool), so the code scan expects no path. */
  external_why?: string;
  code: Array<{ repo: string; paths: string[] }>;
}
export interface EmailManifest {
  businesses: Array<{ key: string; label: string; blurb: string }>;
  runs: Record<string, string>;
  rows: EmailRow[];
}

export const EMAIL_MAP = manifest as EmailManifest;

/** Where it runs, in two or three plain words for the card. */
export const RUNS_SHORT: Record<string, string> = {
  "cloud-cron": "Cloud, on a schedule",
  "cloud-event": "Cloud, when something happens",
  github: "GitHub, on a schedule",
  supabase: "The app's cloud",
  mac: "Your Mac",
  session: "Claude session only",
  folded: "Inside the morning email",
  inert: "Switched off",
  "spry-weekly": "Inside the Spry Labs weekly",
  "external-tool": "An outside tool",
  "not-email": "Not an email",
};

const FOLDED = (r: EmailRow) => r.runs === "folded" || r.runs === "spry-weekly";
const OFF = (r: EmailRow) => r.runs === "inert" || r.runs === "not-email";
const SENDS = (r: EmailRow) => !FOLDED(r) && !OFF(r);

/** "6:40 AM": the one clock both Team → Duties and this page print (12-hour; the zone is said once). */
export function centralClock(hour: number, minute: number): string {
  const h = ((Number(hour) + 11) % 12) + 1;
  return `${h}:${String(minute).padStart(2, "0")} ${Number(hour) < 12 ? "AM" : "PM"}`;
}

/**
 * One total and the parts that make it (ship review, 27 Nov 2026: "85 = 64 + 21, then 11 more…, 4 are
 * switched off" left her unsure whether the total was 85, 96 or 100). Every row is in exactly one part.
 */
export function summaryParts(rows: EmailRow[]) {
  const sends = rows.filter(SENDS);
  const mac = sends.filter((r) => r.runs === "mac").length;
  return { total: rows.length, sends: sends.length, cloud: sends.length - mac, mac, folded: rows.filter(FOLDED).length, off: rows.filter(OFF).length };
}

export function summaryLine(m: EmailManifest = EMAIL_MAP): string {
  const p = summaryParts(m.rows);
  return `${p.total} automated emails listed across ${m.businesses.length} businesses. ` +
    `${p.sends} go out on their own: ${p.cloud} from the cloud whatever your Mac is doing, ${p.mac} only when your Mac is awake. ` +
    `${p.folded} are sections inside another email (Simone's morning email or the Spry Labs weekly). ` +
    `${p.off} ${p.off === 1 ? "is" : "are"} switched off or not an email.`;
}

/** A business's count, in the same three parts as the summary, naming each. */
export function countLine(rows: EmailRow[]): string {
  const p = summaryParts(rows);
  return [
    `${p.sends} ${p.sends === 1 ? "email" : "emails"}`,
    p.folded ? `${p.folded} ${p.folded === 1 ? "section" : "sections"} inside another email` : "",
    p.off ? `${p.off} switched off` : "",
  ].filter(Boolean).join(" · ");
}

export function EmailMap() {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const start = q.get("business");
  const [pick, setPick] = useState<string>(EMAIL_MAP.businesses.some((b) => b.key === start) ? (start as string) : "all");
  const only = repoOnly();
  const shown = EMAIL_MAP.businesses.filter((b) => pick === "all" || b.key === pick);
  return (
    <div className="brains" data-testid="email-map">
      <p className="brain-summary">{summaryLine()}</p>
      <FromRepoLine tab="emails" />
      <p className="brain-hint">Tap a business to see its emails. Each one says who sends it, to whom and when; "Show details" says where it runs and how to pause it. All times are Central.</p>
      <label className="email-map-filter">
        <span>Show:</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Show: choose a business">
          <option value="all">All businesses</option>
          {EMAIL_MAP.businesses.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      {shown.map((b) => {
        const rows = EMAIL_MAP.rows.filter((r) => r.business === b.key && (!only || emailRepos(r).includes(only)));
        if (only && !rows.length) return null;
        return (
          <details key={`${pick}-${b.key}`} className="brain-expander email-map-business" open={pick !== "all" || Boolean(only)} data-testid={`email-business-${b.key}`}>
            <summary>
              <span className="email-map-business-name">{b.label}</span>
              <span className="email-map-count">{countLine(rows)}</span>
            </summary>
            <p className="brain-hint">{b.blurb}</p>
            <div className="brain-cards">
              {rows.map((r) => <EmailCard key={r.id} row={r} />)}
            </div>
          </details>
        );
      })}
      <p className="brain-hint">This page is built from the Email Map list in Boss OS. A new email anywhere goes on that list in the same change, or the build fails.</p>
    </div>
  );
}

function EmailCard({ row }: { row: EmailRow }) {
  return (
    <div className="brain-card email-map-card" data-testid={`email-${row.id}`}>
      <span className="email-map-what">{row.name}</span>
      <span className="brain-card-line">{row.what}</span>
      <span className="brain-card-line">From {row.sender} · to {row.to}</span>
      <span className="brain-card-line">{row.when}</span>
      <span className="email-map-runs">{RUNS_SHORT[row.runs] ?? row.runs}</span>
      <details className="brain-rev">
        <summary>Show details</summary>
        <dl className="email-map-dl">
          <dt>Sent by</dt><dd>{row.sender}{row.owner !== row.sender ? ` (looked after by ${row.owner})` : ""}</dd>
          <dt>From address</dt><dd>{row.from}</dd>
          <dt>To</dt><dd>{row.to}</dd>
          <dt>When</dt><dd>{row.when}</dd>
          <dt>Where it runs</dt><dd>{EMAIL_MAP.runs[row.runs] ?? row.runs}</dd>
          <dt>What starts it</dt><dd>{row.trigger}</dd>
          <dt>How to pause it</dt><dd>{row.pause}</dd>
          <dt>Code</dt>
          <dd className="email-map-code">
            {row.code.map((c) => c.repo === "external" ? "Not in a repo" : `${c.repo}: ${c.paths.join(", ")}`).join(" · ")}
          </dd>
        </dl>
      </details>
    </div>
  );
}
