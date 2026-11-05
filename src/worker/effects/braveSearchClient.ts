import { fenceUntrusted, isBlockedBrowserHost } from "../../shared/browser/taskPolicy";

/**
 * Brave Search, the web-search API (owner, 5 Nov 2026): the SECOND route for researching a meeting
 * guest, after Gemini's Google-grounded search and before the guest's own pages.
 *
 * READ-ONLY. One host, held here as a constant and never read from a request; one GET per search;
 * the only thing that leaves is the search phrase (the guest's name, firm and company domain — never
 * a committed LP, whom `researchPerson` stops before any search). The key travels in Brave's own
 * header, never in the URL. At most 20 searches a day, claimed in D1 before the call
 * (`research/searchQuota.ts`, the cap in `FREE_ROUTES.svc_brave_search`, backends/guard.ts).
 *
 * WHAT COMES BACK IS UNTRUSTED: each result's snippet is fenced before it can reach a model, exactly
 * as a browsed page is. `fetchImpl` is injected so tests drive the whole path without the network.
 */
export const BRAVE_SEARCH_HOST = "https://api.search.brave.com/res/v1/web/search";

export interface BraveResult {
  url: string;
  title: string;
  /** Brave's own extract of the page (description and extra snippets), tags stripped, fenced. */
  text: string;
}

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;

const plain = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** https, a real public host. Anything else is dropped before it can be cited or browsed. */
function usableUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.protocol !== "https:" || isBlockedBrowserHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function braveSearch(
  apiKey: string | undefined,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; results: BraveResult[] } | { ok: false; detail: string }> {
  if (!apiKey) return { ok: false, detail: "Brave Search has no key on this Worker" };
  const q = query.trim().slice(0, 300);
  if (!q) return { ok: false, detail: "there was nothing to search for" };
  const url = `${BRAVE_SEARCH_HOST}?${new URLSearchParams({ q, count: String(MAX_RESULTS), extra_snippets: "true", safesearch: "moderate" })}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, detail: `Brave Search did not answer (${String((e as Error)?.name ?? "error")})` };
  }
  if (!res.ok) return { ok: false, detail: `Brave Search answered ${res.status}` };
  const body = (await res.json().catch(() => null)) as { web?: { results?: any[] } } | null;
  const results: BraveResult[] = [];
  for (const r of body?.web?.results ?? []) {
    const link = usableUrl(r?.url);
    if (!link || results.some((x) => x.url === link)) continue;
    const text = [plain(r?.description), ...(Array.isArray(r?.extra_snippets) ? r.extra_snippets.map(plain) : [])].filter(Boolean).join(" ");
    results.push({ url: link, title: plain(r?.title).slice(0, 200), text: text ? fenceUntrusted(text) : "" });
    if (results.length >= MAX_RESULTS) break;
  }
  return { ok: true, results };
}
