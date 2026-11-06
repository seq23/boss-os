/**
 * Google's grounding redirect → the page it points to (meeting-prep research, 6 Nov 2026).
 *
 * One HEAD request per link, redirects not followed, no body read: only the Location header is used.
 * Only links on Google's own grounding-redirect host are asked; anything else returns null, so
 * this cannot be pointed at an arbitrary address.
 */
export const GROUNDING_REDIRECT = /^https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//;

export async function followGroundingLink(url: string): Promise<string | null> {
  if (!GROUNDING_REDIRECT.test(url)) return null;
  const r = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) }).catch(() => null);
  const loc = r?.headers.get("location") ?? null;
  return loc && /^https:\/\//.test(loc) ? loc : null;
}
