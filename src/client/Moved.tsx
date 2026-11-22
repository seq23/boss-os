import React from "react";
import { westPeekOsUrlFor } from "./surface";

/**
 * What an old fund-screen address shows now. It is self-contained on purpose: no style sheet, no
 * API call and no sign-in, so it cannot fail into a blank page. Colours follow the reader's light
 * or dark setting; the layout is one column that fits a 390px phone with a 16px gutter.
 */
const CSS = `
:root { color-scheme: light dark; --bg: #fdf8f4; --fg: #1f1a17; --muted: #5c534d; --link: #8a3b12; }
@media (prefers-color-scheme: dark) { :root { --bg: #171412; --fg: #f3ede8; --muted: #b9aea6; --link: #f0a274; } }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
.moved { box-sizing: border-box; max-width: 34rem; margin: 0 auto; padding: 18vh 16px 32px;
  font: 17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
.moved h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
.moved p { margin: 0 0 16px; color: var(--muted); }
.moved a { color: var(--link); font-weight: 600; overflow-wrap: anywhere; }
`;

export function Moved({ hash }: { hash: string }) {
  const target = westPeekOsUrlFor(hash);
  return (
    <main className="moved">
      <style>{CSS}</style>
      <h1>This page has moved</h1>
      <p>The West Peek fund screens that used to open here now live in West Peek OS.</p>
      <p>
        <a href={target}>Open it in West Peek OS</a>
      </p>
    </main>
  );
}
