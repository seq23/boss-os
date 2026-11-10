import { useState } from "react";
import sitesMap from "@shared/boss/maps/sites.json";
import { socialRepos } from "@shared/boss/maps/chain.mjs";
import { FromRepoLine, repoOnly } from "./Maps";
import manifest from "@shared/boss/socialMap/manifest.json";

/**
 * THE SOCIAL MAP (owner, 8 Nov 2026: "a canonical map of what repos and sites have social media
 * pages"). Every social and profile account of every business and friends' site: its status, what
 * posts to it and the decision behind it. Rendered from the ONE list,
 * src/shared/boss/socialMap/manifest.json; never a copy (tests/socialMap.test.ts).
 *
 * Phone first (390px), calm, the Email Map's shape: the summary first, a pull-down to pick a
 * business, then three sections (your businesses, support systems, friends' sites) with one
 * labelled expander per business. Each account shows platform, handle, status and who posts
 * without opening; "Show details ▾" holds the decision and the code.
 *
 * Links in: /?tab=social, /?tab=social&business=<key>.
 */
export interface SocialRow {
  id: string; business: string; site: string; platform: string; handle: string | null; url: string | null;
  account_email: string; account_email_note?: string;
  status: string; decision: string; no_url_why?: string;
  posts: { by: "job" | "hand" | "none"; what: string; code?: Array<{ repo: string; paths: string[] }>; jobs?: string[] };
}
export interface SocialManifest {
  statuses: Record<string, string>;
  groups: Record<string, string>;
  businesses: Array<{ key: string; label: string; group: string; blurb: string }>;
  rows: SocialRow[];
}

export const SOCIAL_MAP = manifest as unknown as SocialManifest;

/** The page's three sections, in order; a group sits in exactly one. */
export const SECTIONS: Array<{ key: string; label: string; groups: string[] }> = [
  { key: "mine", label: "Your businesses", groups: ["divine_9", "other"] },
  { key: "support", label: "Support systems", groups: ["support"] },
  { key: "friends", label: "Friends' sites", groups: ["friends"] },
];

/** Status in two or three plain words for the card, and its colour class (green = posting by itself). */
export const STATUS_SHORT: Record<string, { words: string; tone: string }> = {
  live_auto: { words: "Posts by itself", tone: "social-status-auto" },
  live_manual: { words: "Live, by hand", tone: "social-status-manual" },
  planned: { words: "Planned", tone: "social-status-planned" },
  paused: { words: "Paused", tone: "social-status-off" },
  dead: { words: "Gone", tone: "social-status-off" },
  never: { words: "Decided: none", tone: "social-status-off" },
};

/** account_email in plain words; a business address shows as itself. */
const ACCOUNT_WORDS: Record<string, string> = {
  "personal — move": "Your personal address: to move to the brand's.",
  unknown: "Not recorded yet.",
  "no account": "No account.",
};

const count = (rows: SocialRow[], s: string) => rows.filter((r) => r.status === s).length;

export function summaryLine(m: SocialManifest = SOCIAL_MAP): string {
  const off = count(m.rows, "dead") + count(m.rows, "never");
  return `${m.rows.length} listed for ${m.businesses.length} businesses and friends' sites: ` +
    `${count(m.rows, "live_auto")} post by themselves, ${count(m.rows, "live_manual")} are live and posted by hand (or are a profile only), ` +
    `${count(m.rows, "planned")} are planned, ${count(m.rows, "paused")} are paused and ${off} are gone or decided against.`;
}

export function SocialMap() {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const start = q.get("business");
  const [pick, setPick] = useState<string>(SOCIAL_MAP.businesses.some((b) => b.key === start) ? (start as string) : "all");
  const only = repoOnly();
  return (
    <div className="brains" data-testid="social-map">
      <p className="brain-summary">{summaryLine()}</p>
      <FromRepoLine tab="social" />
      <p className="brain-hint">Tap a business to see its accounts. Each one says its status and who posts to it; "Show details ▾" says why.</p>
      <label className="email-map-filter">
        <span>Show:</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Show: choose a business">
          <option value="all">All businesses</option>
          {SOCIAL_MAP.businesses.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      {SECTIONS.map((sec) => {
        const shown = SOCIAL_MAP.businesses.filter((b) => sec.groups.includes(b.group) && (pick === "all" || b.key === pick));
        if (!shown.length) return null;
        return (
          <section key={sec.key} className="social-section" data-testid={`social-section-${sec.key}`}>
            <h2 className="social-section-title">{sec.label}</h2>
            {shown.map((b) => {
              const rows = SOCIAL_MAP.rows.filter((r) => r.business === b.key && (!only || socialRepos(r, sitesMap as any).includes(only)));
              if (only && !rows.length) return null;
              const auto = count(rows, "live_auto");
              return (
                <details key={`${pick}-${b.key}`} className="brain-expander email-map-business" open={pick !== "all" || Boolean(only)} data-testid={`social-business-${b.key}`}>
                  <summary>
                    <span className="email-map-business-name">{b.label}</span>
                    <span className="email-map-count">{rows.length} listed{auto ? ` · ${auto} ${auto === 1 ? "posts" : "post"} by ${auto === 1 ? "itself" : "themselves"}` : ""} — tap to open ▾</span>
                  </summary>
                  <p className="brain-hint">{b.blurb}</p>
                  <div className="brain-cards">
                    {rows.map((r) => <SocialCard key={r.id} row={r} />)}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
      <p className="brain-hint">This page is built from the Social Map list in Boss OS. A new account, profile link or posting job goes on that list in the same change, or the build fails.</p>
    </div>
  );
}

function SocialCard({ row }: { row: SocialRow }) {
  const st = STATUS_SHORT[row.status] ?? { words: row.status, tone: "social-status-off" };
  return (
    <div className="brain-card email-map-card" data-testid={`social-${row.id}`}>
      <span className="email-map-what">{row.platform}{row.handle ? ` · ${row.handle}` : ""}</span>
      <span className="brain-card-line">{row.posts.what}</span>
      <span className={`social-status ${st.tone}`}>{st.words}</span>
      {row.url ? <a className="social-open" href={row.url} target="_blank" rel="noreferrer">Open the profile ›</a> : null}
      <details className="brain-rev">
        <summary>Show details ▾</summary>
        <dl className="email-map-dl">
          <dt>Site</dt><dd>{row.site}</dd>
          <dt>Status</dt><dd>{SOCIAL_MAP.statuses[row.status] ?? row.status}</dd>
          <dt>Who posts</dt><dd>{row.posts.by === "job" ? "A job" : row.posts.by === "hand" ? "By hand" : "Nobody"}: {row.posts.what}</dd>
          <dt>Account under</dt><dd>{ACCOUNT_WORDS[row.account_email] ?? row.account_email}{row.account_email_note ? ` ${row.account_email_note}` : ""}</dd>
          <dt>Decision</dt><dd>{row.decision}</dd>
          {row.url ? null : <><dt>Address</dt><dd>{row.no_url_why ?? "None yet."}</dd></>}
          {row.posts.code?.length ? <><dt>Code</dt><dd className="email-map-code">{row.posts.code.map((c) => `${c.repo}: ${c.paths.join(", ")}`).join(" · ")}</dd></> : null}
        </dl>
      </details>
    </div>
  );
}
