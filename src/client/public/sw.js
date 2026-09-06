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

const CACHE = "boss-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/boss-mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
      fetch(event.request).catch(() => caches.match("/index.html").then((r) => r ?? Response.error())),
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
