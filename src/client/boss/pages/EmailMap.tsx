import { useState } from "react";
import manifest from "@shared/boss/emailMap/manifest.json";

/**
 * THE EMAIL MAP (owner, 31 Oct 2026: "one Email Map page inside Boss OS, all businesses"). Every
 * automated email anything of hers sends — to her, Valerie, Scooter, prospects, brands, LPs,
 * offices, groups — grouped by business. Rendered from the ONE list,
 * src/shared/boss/emailMap/manifest.json; never a copy (tests/outboundEmailMap.test.ts).
 *
 * Phone first (390px), calm: the summary first, a pull-down to pick a business, then one labelled
 * expander per business. Each email shows what it is, who sends it, to whom and when without
 * opening; "Show details ▾" holds the from address, where it runs, its trigger and how to pause it.
 *
 * Links in: /?tab=emails, /?tab=emails&business=<key>.
 */
export interface EmailRow {
  id: string; business: string; what: string; sender: string; owner: string; from: string; to: string;
  when: string; runs: string; trigger: string; pause: string; launchd?: string[];
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
  "not-email": "Not an email",
};

const SENDS = (r: EmailRow) => r.runs !== "inert" && r.runs !== "not-email" && r.runs !== "folded";

export function summaryLine(m: EmailManifest = EMAIL_MAP): string {
  const sending = m.rows.filter(SENDS);
  const mac = sending.filter((r) => r.runs === "mac").length;
  const folded = m.rows.filter((r) => r.runs === "folded").length;
  const off = m.rows.filter((r) => r.runs === "inert" || r.runs === "not-email").length;
  return `${sending.length} automated emails across ${m.businesses.length} businesses. ` +
    `${sending.length - mac} send from the cloud whatever your Mac is doing; ${mac} need your Mac awake. ` +
    `${folded} more are lines inside Simone's morning email; ${off} ${off === 1 ? "is" : "are"} switched off or not email.`;
}

export function EmailMap() {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const start = q.get("business");
  const [pick, setPick] = useState<string>(EMAIL_MAP.businesses.some((b) => b.key === start) ? (start as string) : "all");
  const shown = EMAIL_MAP.businesses.filter((b) => pick === "all" || b.key === pick);
  return (
    <div className="brains email-map" data-testid="email-map">
      <p className="brain-summary">{summaryLine()}</p>
      <p className="brain-hint">Tap a business to see its emails. Each one says who sends it, to whom and when; "Show details ▾" says where it runs and how to pause it.</p>
      <label className="email-map-filter">
        <span>Show:</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Show: choose a business">
          <option value="all">All businesses</option>
          {EMAIL_MAP.businesses.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      {shown.map((b) => {
        const rows = EMAIL_MAP.rows.filter((r) => r.business === b.key);
        const live = rows.filter(SENDS).length;
        return (
          <details key={`${pick}-${b.key}`} className="brain-expander email-map-business" open={pick !== "all"} data-testid={`email-business-${b.key}`}>
            <summary>
              <span className="email-map-business-name">{b.label}</span>
              <span className="email-map-count">{live} {live === 1 ? "email" : "emails"}{rows.length > live ? ` · ${rows.length - live} more listed` : ""} — tap to open ▾</span>
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
      <span className="email-map-what">{row.what}</span>
      <span className="brain-card-line">From {row.sender} · to {row.to}</span>
      <span className="brain-card-line">{row.when}</span>
      <span className="email-map-runs">{RUNS_SHORT[row.runs] ?? row.runs}</span>
      <details className="brain-rev">
        <summary>Show details ▾</summary>
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
