/*
 * Boss OS service worker.
 *
 * Deliberately small and deliberately honest:
 *
 * - The APP SHELL is cached so the operator can open the app on a bad connection and see a real
 *   interface instead of a browser error.
 * - `/api/*` is NEVER cached HERE. Boss OS is single-user and is meant to be usable offline, but
 *   a silently stale approval count is a lie with a timestamp on it. Offline reads are therefore
 *   an explicit, labelled feature in the client - last-known state shown AS last-known, with the
 *   time it was taken - not an invisible cache layer in the service worker. Writes never queue.
 * - There is no background sync and no push handler, because no push service is configured. When
 *   one exists, it belongs here — pretending otherwise would put a dead feature in the manifest.
 */

// v2: the app that answers at this host CHANGED. A browser that loaded the old bundle has the
// chassis in its shell cache, and the activate handler deletes every cache but this one - so
// bumping the name is what actually evicts it rather than leaving it to expire.
const CACHE = "boss-shell-v2";
/*
 * "/index.html" IS DELIBERATELY NOT HERE, AND THAT IS THE WHOLE OFFLINE FIX.
 *
 * The asset handler answers /index.html with a redirect to "/", so the cached entry came back with
 * `redirected: true`. A navigation request may never be answered with a redirected response —
 * Chrome fails the load with net::ERR_FAILED — so the offline shell fell over at the one moment it
 * existed for, while every other signal looked healthy: the worker registered, activated, took
 * control, and its cache held all five entries.
 *
 * "/" is the same document without the redirect, so it is the only navigation fallback.
 */
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/boss-mark.svg"];

/**
 * Cache the shell AND the hashed bundles it needs, at install.
 *
 * THE BUG THIS FIXES. A service worker does not control the page that registered it, so the very
 * first visit fetches /assets/index-*.js straight from the network, unintercepted and uncached.
 * Reload with no connection and the document came back from cache while its only script did not:
 * an empty <div id="root"> and a blank screen. It would have started working on the SECOND online
 * visit, which is the worst kind of bug — absent whenever anyone thinks to look for it.
 *
 * The asset filenames carry a build hash, so they cannot be listed here. They are read out of the
 * cached document instead, which needs no build step and cannot drift from what was shipped.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const doc = await cache.match("/");
  if (!doc) return;
  /*
   * TWO HOPS, BECAUSE THE APP IS A DYNAMIC IMPORT.
   *
   * The document only references the entry chunk. Boss OS and the chassis are loaded by
   * `import()` at runtime — exclusively, so that two apps with global CSS never load together —
   * which means their chunks appear as string literals INSIDE the entry bundle and nowhere in the
   * HTML. Caching only what the document names left the entry script cached and the app it loads
   * missing: offline, the page came back and rendered an empty root.
   *
   * So the document is scanned, then what the document named is scanned in turn. Two passes is
   * enough for Vite's shape and stops well short of crawling.
   */
  /*
   * Both spellings, resolved against whatever named them. The document says "/assets/index-x.js";
   * that bundle names its dynamic chunks RELATIVELY, as "./App-y.js" — which a /assets/ pattern can
   * never match, so the first version of this cached the entry script and none of the app it
   * loads. Resolving against the referrer handles both without guessing at the base path.
   */
  const refs = (text, baseHref) =>
    [
      ...new Set(
        [...text.matchAll(/["'`]((?:\.{0,2}\/)[A-Za-z0-9_./-]+\.(?:js|css))["'`]/g)].map((m) => {
          try {
            return new URL(m[1], new URL(baseHref, self.location.origin)).pathname;
          } catch {
            return null;
          }
        }),
      ),
    ].filter((h) => h && h.startsWith("/assets/"));

  const take = async (href) => {
    try {
      const res = await fetch(href);
      if (!res.ok) return null;
      const copy = res.clone();
      await cache.put(href, res);
      return copy;
    } catch {
      return null;
    }
  };

  /*
   * Crawl to closure rather than a fixed number of hops. The document names the entry, the entry
   * names the app chunks, and an app chunk names its own stylesheet — which is where a two-pass
   * version stopped, leaving the CSS uncached. Bounded by a pass limit and by only following
   * things already under /assets/, so it terminates on any build shape rather than on this one.
   */
  const seen = new Set();
  let frontier = refs(await doc.clone().text(), "/");
  for (let pass = 0; pass < 4 && frontier.length > 0; pass++) {
    const fresh = frontier.filter((h) => !seen.has(h));
    fresh.forEach((h) => seen.add(h));
    // Individually, so one missing asset cannot fail the whole install the way addAll would.
    const fetched = await Promise.all(fresh.map(take));
    const next = new Set();
    for (const res of fetched) {
      if (!res) continue;
      const type = res.headers.get("content-type") || "";
      if (!type.includes("javascript") && !type.includes("css")) continue;
      const from = new URL(res.url, self.location.origin).pathname;
      for (const href of refs(await res.text(), from)) if (!seen.has(href)) next.add(href);
    }
    frontier = [...next];
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Institutional state is never served from cache.
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
