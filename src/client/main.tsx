import React from "react";
import { createRoot } from "react-dom/client";
import { Moved } from "./Moved";
import { surfaceFor } from "./surface";

const root = createRoot(document.getElementById("root")!);

/*
 * WHICH SURFACE MOUNTS IS DECIDED BY THE HOST, NOT ONLY THE PATH (surface.ts says why).
 *
 * It has to be decided here, not on the server: Cloudflare's assets binding answers "/" directly
 * and the fetch handler is never invoked for it (verified against production), so the client is
 * the only place that sees every navigation. Boss OS is imported dynamically so the moved page
 * never downloads it.
 */
if (surfaceFor(location.hostname, location.pathname) === "boss") {
  void (async () => {
    // A stylesheet is not load-bearing. Awaiting it unguarded meant one uncached CSS file offline
    // rejected before the app was even imported, and the reader got a blank page instead of an
    // unstyled one — the worse of the two failures by a distance.
    await import("./boss/styles.css").catch(() => {});
    const { default: BossApp } = await import("./boss/App");
    root.render(
      <React.StrictMode>
        <BossApp />
      </React.StrictMode>,
    );
  })();
} else {
  // The retired West Peek fund screens (22 Nov 2026): a plain page naming where they went.
  document.title = "This page has moved";
  root.render(
    <React.StrictMode>
      <Moved hash={location.hash} />
    </React.StrictMode>,
  );
}

/*
 * Register the service worker so the app is installable and opens offline (P20, GAP-20).
 * It caches the app SHELL only — /api/* is never cached, so state is never served stale from a
 * device. Registration failure is non-fatal: the app works without it.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline shell unavailable; the app still works online */
    });
  });
}
