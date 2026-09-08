import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * ONE SCREEN MAY FAIL. THE PRODUCT MAY NOT DISAPPEAR.
 *
 * WHAT THIS FIXES, exactly. On 8 September 2026 the owner reported "the vault screen also crashes".
 * It did not crash the way that phrase usually means — an empty panel, an error message. `Vault.tsx`
 * called `.map()` on an object the API client had mistyped as an array, React threw during render,
 * and with no boundary anywhere in this application the exception unwound the ENTIRE tree. The
 * result was a blank cream rectangle: no heading, no navigation, no way back to Today. Reloading
 * landed on Today only because the tab is not in the URL — had it been, the app would have been
 * unreachable until she guessed to clear it.
 *
 * A RENDER BUG IS A BUG IN ONE SCREEN AND SHOULD COST ONE SCREEN. Every fetch in this app already
 * fails gracefully — `ApiError` is caught and drawn by `<ErrorNotice>`. Rendering had no equivalent,
 * so the two halves of the same failure had wildly different blast radii: a 500 from the server was
 * a paragraph, and a typo in the shape of a 200 was the whole product.
 *
 * IT SAYS WHICH SCREEN AND WHAT HAPPENED, and offers the one action that helps. A boundary that
 * renders "Something went wrong" teaches the reader nothing and cannot be reported; this one names
 * the tab and carries the real message, because the person reading it is the person who has to
 * decide whether it matters this morning.
 *
 * IT RESETS ON NAVIGATION. `key` is the tab id at the call site, so moving to another screen mounts
 * a fresh boundary rather than leaving a sticky error the reader cannot clear. Coming back to the
 * broken screen shows the error again, which is correct — it has not been fixed.
 *
 * WHY A CLASS. `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent. This is
 * the one place in the Boss client where a class component is not a style choice.
 */
export class ScreenBoundary extends Component<
  { screen: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only place a stack survives here; there is no client error sink and
    // inventing one would be a network call on the path that is already failing.
    console.error(`Boss OS — the ${this.props.screen} screen failed to render`, error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="notice" style={{ borderColor: "var(--reject)" }}>
        <strong>The {this.props.screen} screen could not be drawn.</strong>
        <p className="row-sub" style={{ marginTop: 6 }}>{error.message}</p>
        <p className="row-sub" style={{ marginTop: 6 }}>
          Nothing was changed and nothing was lost. Every other screen still works — this one is
          broken and the rest of Boss OS is not.
        </p>
        <button className="btn btn-small" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
          Try this screen again
        </button>
      </div>
    );
  }
}
