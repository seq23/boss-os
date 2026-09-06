import type { ReactNode } from "react";

export type TabId = "today" | "inbox" | "people" | "capital" | "spirit" | "team" | "memory" | "trading" | "vault";

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
};

/** Canon §15: Today is the default operating screen, and so the first tab. */
const LABELS: Record<TabId, string> = {
  today: "Today", inbox: "Inbox", people: "People", capital: "Capital",
  spirit: "Spirit", team: "Team", memory: "Memory", trading: "Trading", vault: "Vault",
};

export function Shell({
  tab, onTab, title, lane, pending, onSettings, settingsOpen, children,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  title: string;
  lane: "ops" | "trading";
  pending: number;
  onSettings: () => void;
  settingsOpen: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="shell"
      style={{ ["--lane" as string]: lane === "trading" ? "var(--lane-trading)" : "var(--lane-ops)" }}
    >
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

      <main className="page">{children}</main>

      <nav className="tabs" aria-label="Sections">
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
