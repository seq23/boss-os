import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * THE NAV MEASURES ITSELF, AND THE PAGE READS THE MEASUREMENT.
 *
 * THE DEFECT. `.shell` reserved `--tab-h` (64px) of bottom padding for a nav declared
 * `grid-template-columns: repeat(5, 1fr)` and handed TEN tabs. Ten items across five columns is
 * two rows, so the nav was ~128px tall and the page reserved half of it: the last 64px of every
 * scrollable screen sat underneath it, permanently. Visible on Capital ("Nothing in the pipeline"
 * cut in half), on Vault (the seventh snapshot row), on Spirit and on Team.
 *
 * WHY MEASURE RATHER THAN WRITE `calc(var(--tab-h) * 2)`. Two is the answer for ten tabs at this
 * width with this font. It is the wrong answer the moment a tab is added, the label wraps, the
 * reader has a larger text size set, or the safe-area inset changes on rotation - and it would be
 * wrong silently, in exactly the way the original 64px was wrong silently. A measurement cannot
 * drift out of agreement with the thing it measures.
 *
 * The observer writes `--nav-h` onto the shell. The static default below is a floor for the first
 * paint and for anyone running without JS layout effects; it is deliberately the two-row value, so
 * the failure mode of the fallback is a little too much space rather than a hidden row.
 */
function useMeasuredNav() {
  const navRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const shell = shellRef.current;
    if (!nav || !shell) return;

    const apply = () => shell.style.setProperty("--nav-h", `${nav.offsetHeight}px`);
    apply();

    // ResizeObserver rather than a resize listener: the nav can change height without the window
    // doing so - a font finishing loading, a text-size preference, a tab label wrapping.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return { navRef, shellRef };
}

/**
 * How far down the page the reader is, and whether there is anything left.
 *
 * Drives two things and adds no chrome for either: the rail doubles as a reading gauge, and the
 * scrim above the nav retracts once there is nothing more to see. Both answer "is something
 * hidden down there?" - which, given the defect above, this interface owed the reader an answer to.
 */
function useReadingPosition() {
  const [progress, setProgress] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      // A page shorter than the viewport is not "0% read", it is "all of it". Reporting 0 there
      // would leave the gauge showing an empty rail on a page with nothing missing.
      if (max <= 1) {
        setScrollable(false);
        setProgress(1);
        setAtEnd(true);
        return;
      }
      const y = doc.scrollTop;
      setScrollable(true);
      setProgress(Math.min(1, Math.max(0, y / max)));
      // A couple of pixels of slack: sub-pixel layout and elastic scrolling both mean the exact
      // equality never quite lands, which would leave the end-mark forever one pixel away.
      setAtEnd(max - y <= 2);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // Content arriving after load changes the answer, and this app renders almost everything after
    // a fetch, so the first measurement is nearly always the wrong one on its own.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(document.body);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer?.disconnect();
    };
  }, []);

  return { progress, scrollable, atEnd };
}

export type TabId = "today" | "inbox" | "people" | "capital" | "spirit" | "team" | "memory" | "trading" | "vault" | "systems";

const ICONS: Record<TabId, ReactNode> = {
  today: <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3.5 2" />,
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M3 13l3-8h12l3 8v6H3z" />,
  people: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0M18 4.5l1.2 2.4 2.6.4-1.9 1.8.4 2.6-2.3-1.2-2.3 1.2.4-2.6-1.9-1.8 2.6-.4z" />,
  capital: <path d="M4 20V10M10 20V5M16 20v-7M22 20V8M3 20h18" />,
  spirit: <path d="M17 3a9 9 0 11-9 15.9A9 9 0 0017 3zM19.5 14l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />,
  team: <path d="M8 11a3 3 0 100-6 3 3 0 000 6zM3 20a5 5 0 0110 0M16 12a3 3 0 100-6M15 20a5 5 0 016-4" />,
  memory: <path d="M12 4v16M12 7a3 3 0 013-3h4v13h-4a3 3 0 00-3 3M12 7a3 3 0 00-3-3H5v13h4a3 3 0 013 3" />,
  trading: <path d="M3 17l5-6 4 3 5-8M21 6h-4M21 6v4" />,
  vault: <path d="M4 4h16v16H4zM12 9a3 3 0 100 6 3 3 0 000-6zM12 15v3" />,
  systems: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />,
};

/** Canon §15: Today is the default operating screen, and so the first tab. */
const LABELS: Record<TabId, string> = {
  today: "Today", inbox: "Inbox", people: "People", capital: "Capital",
  spirit: "Spirit", team: "Team", memory: "Memory", trading: "Trading", vault: "Vault",
  systems: "Systems",
};

export function Shell({
  tab, onTab, title, lane, pending, onSettings, settingsOpen, offline, waiting, children,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  title: string;
  lane: "ops" | "trading";
  pending: number;
  onSettings: () => void;
  settingsOpen: boolean;
  /** The browser says there is no connection. */
  offline?: boolean;
  /** Captures written offline and not yet sent. */
  waiting?: number;
  children: ReactNode;
}) {
  const { navRef, shellRef } = useMeasuredNav();
  const { progress, scrollable, atEnd } = useReadingPosition();

  return (
    <div
      className="shell"
      ref={shellRef}
      data-scrollable={scrollable ? "yes" : "no"}
      data-at-end={atEnd ? "yes" : "no"}
      style={{
        ["--lane" as string]: lane === "trading" ? "var(--lane-trading)" : "var(--lane-ops)",
        ["--read" as string]: String(progress),
      }}
    >
      {/*
        * The lane rail, doing a second job.
        *
        * The stripe down the left edge is already the one element that is always on screen and
        * always means something - gold for operations, plum for trading. Giving it a brighter
        * travelling segment turns it into a reading gauge without adding a scrollbar, a widget or
        * a percentage anywhere. It is the only ornament in this interface that earns its place by
        * answering a question the reader actually has.
        *
        * aria-hidden: it is a restatement of scroll position, which assistive technology already
        * conveys properly. Announcing it again would be noise.
        */}
      <div className="railgauge" aria-hidden="true" />
      <header className="topbar">
        <h1>{title}</h1>
        <button
          className="lane-chip"
          onClick={onSettings}
          aria-pressed={settingsOpen}
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
        >
          {settingsOpen ? "Close" : lane === "trading" ? "Trading" : "Operations"}
        </button>
      </header>

      {/*
        * Batch 7 requires the offline and sync state to be VISIBLE. Silence here is the failure
        * mode: a person who cannot tell "saved" from "kept" either stops trusting the app or
        * writes the same thing twice. It says nothing at all when there is nothing to say.
        */}
      {(offline || (waiting ?? 0) > 0) && (
        <div className="syncbar" role="status">
          {offline ? "Offline" : "Back online"}
          {(waiting ?? 0) > 0 && (
            <span className="syncbar-count">
              {waiting} waiting to send
            </span>
          )}
        </div>
      )}

      <main className="page">
        {children}
        {/*
          * The page says it has finished, rather than just stopping.
          *
          * With the nav overlapping content, "the end" and "cut off" looked identical, which is
          * what made the defect survive - you could not tell a short page from a clipped one.
          *
          * ALWAYS RENDERED, HIDDEN BY CSS. Rendering it conditionally froze the renderer, and the
          * loop is worth writing down because it is easy to rebuild: the mark is ~41px tall, so
          * mounting it makes the page taller, which can flip `scrollable` from false to true;
          * ResizeObserver reports the height change, the mark unmounts, the page shrinks, and the
          * two states oscillate inside the observer callback forever. Keeping it in the layout at
          * all times means no state this component holds can change the document's height, which
          * is what breaks the cycle at the source rather than damping it with a threshold.
          */}
        <div className="page-end" aria-hidden="true" />
      </main>

      {/*
        * A scrim, not a wall. Content dissolves into the page edge instead of being guillotined by
        * the nav's top border, and it retracts at the bottom so the last row is never left looking
        * like there is something beyond it.
        */}
      <div className="page-scrim" aria-hidden="true" />

      <nav className="tabs" aria-label="Sections" ref={navRef}>
        {(Object.keys(LABELS) as TabId[]).map((id) => (
          <button
            key={id}
            className="tab"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => onTab(id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[id]}
            </svg>
            {id === "inbox" && pending > 0 && <span className="tab-badge">{pending}</span>}
            {LABELS[id]}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint}
    </div>
  );
}

export function Loading() {
  return <>{[0, 1, 2].map((i) => <div className="skel" key={i} />)}</>;
}
