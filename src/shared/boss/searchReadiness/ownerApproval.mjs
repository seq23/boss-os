/**
 * WHICH REPAIRS ON AN `owner_approval` SITE WAIT FOR HER YES, AND WHICH ARE JUST FIXED.
 *
 * Owner, 3 Nov 2026 (Hicks): "she cares deeply about her site so i need to approve any changes to
 * hicks live published site and published resources". Later the same day: "if it has repairs for
 * already published resources they should just fix them not queue".
 *
 * So on a site with `owner_approval` in sites.json, a repair whose every page sits under one of the
 * site's `owner_approval_direct_repairs.paths` (Hicks: the /resources/ and /insights/ calendar posts
 * and the quiet-lane /questions/ pages) is ordinary work: fixed and landed like any other site.
 * Everything else still waits for her yes: core pages (home, about, services, contact, the landing
 * pages), the hub pages themselves (/resources/ is a listing, not a post), and any repair whose pages
 * cannot be read from the brief. Title or topic changes and unpublishing are never repairs; the fixer
 * prompt keeps those held.
 *
 * FAILS CLOSED: no page named → held. One core page among many posts → held.
 *
 * Read by: `fixBriefs` (audit.mjs, the Search Readiness fix queue) and `landAll`
 * (scripts/ops/site-audit-lib.mjs, the Ahrefs site-audit duty's land step).
 */

const URL_RE = /https?:\/\/[^\s"'<>()\]]+/gi;
const PATH_RE = /(?:^|[\s"'(`])(\/[A-Za-z0-9._~%\-/]*)/g;

/** The path prefixes whose published posts are repaired directly on this site (may be empty). */
export function directRepairPaths(site) {
  const p = site?.owner_approval_direct_repairs?.paths;
  return Array.isArray(p) ? p.filter((x) => typeof x === "string" && x.startsWith("/")) : [];
}

const hostOk = (site, host) => {
  const h = String(host ?? "").toLowerCase().replace(/^www\./, "");
  const d = String(site?.domain ?? "").toLowerCase().replace(/^www\./, "");
  return !d || h === d;
};

/** Every page path of this site named in the given texts (URLs on its host, or bare paths). */
export function pagesIn(site, texts) {
  const out = new Set();
  for (const t of texts ?? []) {
    const s = String(t ?? "");
    for (const m of s.matchAll(URL_RE)) {
      try {
        const u = new URL(m[0].replace(/[.,;:]+$/, ""));
        if (hostOk(site, u.hostname)) out.add(u.pathname || "/");
      } catch { /* not a URL */ }
    }
    const noUrls = s.replace(URL_RE, " ");
    for (const m of noUrls.matchAll(PATH_RE)) out.add(m[1].replace(/[.,;:]+$/, ""));
  }
  return [...out].filter(Boolean);
}

/** Is this path a published post under one of the site's direct-repair prefixes (not the hub itself)? */
export function isDirectRepairPath(site, path) {
  const p = String(path ?? "");
  return directRepairPaths(site).some((pre) => {
    const base = pre.endsWith("/") ? pre : `${pre}/`;
    return p.startsWith(base) && p.slice(base.length).replace(/\/+$/, "").length > 0;
  });
}

/**
 * Does this repair wait for her yes? False for any site without `owner_approval`, for an approved
 * plan, and for a repair whose every named page is a published post under a direct-repair path.
 */
export function heldForOwner(site, { approved = false, texts = [] } = {}) {
  if (!site?.owner_approval || approved) return false;
  const pages = pagesIn(site, texts);
  if (!pages.length) return true;
  return !pages.every((p) => isDirectRepairPath(site, p));
}
