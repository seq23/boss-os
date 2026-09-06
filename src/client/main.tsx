import React from "react";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);

/**
 * One bundle, two surfaces, and only one of them mounts.
 *
 * Boss OS arrived as a complete SPA - its own Shell, its own lock screen, its own nine tabs - and
 * the chassis it was ported into is still the West Peek fund OS. They are not merged in the UI for
 * the same reason they are not merged on the server: both define global CSS and both own the whole
 * screen, so loading them together would leave whichever style sheet lost the race silently
 * restyling the other app.
 *
 * So the import is DYNAMIC and exclusive. `/boss` and anything under it mounts Boss OS and loads
 * only Boss OS's styles; every other path mounts the chassis and loads only the chassis's. The
 * Worker already serves index.html for any non-/api path, so both are reachable as normal URLs.
 *
 * This is the interim shape, not the destination. When the fund domain is stripped - the same
 * finish line tests/boss/chassisTables.ts ratchets towards - Boss OS becomes the root app and this
 * branch goes away with it.
 */
/*
 * WHICH APP MOUNTS IS DECIDED BY THE HOST, NOT ONLY THE PATH.
 *
 * boss.sequoiataylor.com served West Peek Ventures' entire fund interface - branded West Peek,
 * asking the owner to sign in as you@westpeek.ventures, with Thesis, Dealflow, Portfolio and Fund
 * strategy in the sidebar - because this line defaulted to the chassis and only /boss escaped it.
 * That is one business's interface on another's domain, which is the exact thing the owner's
 * separation rule exists to prevent.
 *
 * IT HAD TO BE FIXED HERE, NOT ON THE SERVER. The first fix was a redirect in the Worker, and it
 * could never have run: Cloudflare's assets binding answers "/" directly and the fetch handler is
 * never invoked for it. Verified against production - the redirect deployed and "/" still returned
 * 200. The client is the only place that sees every navigation.
 *
 * BOSS_HOSTS is an allowlist rather than a pattern, because "does this look like a Boss host" is a
 * question with a wrong answer. Anywhere else - localhost, previews - keeps the old behaviour, so
 * the chassis's 129 E2E journeys still drive it at "/". They are the regression suite for the
 * domain being removed, and they go when it does.
 */
const BOSS_HOSTS = new Set(["boss.sequoiataylor.com"]);
const isBoss =
  BOSS_HOSTS.has(location.hostname) ||
  location.pathname === "/boss" ||
  location.pathname.startsWith("/boss/");

if (isBoss) {
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
  void (async () => {
    await import("./styles.css").catch(() => {});
    const { App } = await import("./App");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })();
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
