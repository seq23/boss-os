/**
 * THE ONE TAGGED-LINK HELPER (Growth Director, 21 Nov 2026). Every poster that links to one of her
 * sites adds the same three tags, so the scoreboard can say which channel sent a visit, a request or
 * a sale: utm_source (the platform), utm_medium (social, pin, email, profile, partner),
 * utm_campaign (the business's campaign or format slug). Porch & Party's /request reads them since
 * p-n-p PR #225.
 *
 * KeepMyProof promises no analytics, so a KeepMyProof link is NEVER tagged: tagLink refuses it by
 * name (NamedStop NO_TRACKING_PROMISE) rather than quietly returning the bare link, so a poster that
 * tries finds out in its test.
 */
import { NO_TRACKING } from "./scoreboard.mjs";

export const MEDIUMS = Object.freeze(["social", "pin", "email", "profile", "partner", "listing"]);
/** Domains whose business forbids tracking. */
export const NO_TRACKING_DOMAINS = Object.freeze({ "keepmyproof.com": "keepmyproof" });

const SLUG = /^[a-z0-9][a-z0-9_-]{0,40}$/;

export function tagLink(url, { source, medium, campaign }) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const biz = NO_TRACKING_DOMAINS[host];
  if (biz && NO_TRACKING[biz]) throw Object.assign(new Error(`NAMED STOP [NO_TRACKING_PROMISE] ${host} promises no analytics; its links are never tagged.`), { code: "NO_TRACKING_PROMISE" });
  for (const [k, v] of Object.entries({ source, medium, campaign })) if (!SLUG.test(String(v ?? ""))) throw new Error(`tagLink: ${k} must be a lowercase slug`);
  if (!MEDIUMS.includes(medium)) throw new Error(`tagLink: medium must be one of ${MEDIUMS.join(", ")}`);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", medium);
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}
