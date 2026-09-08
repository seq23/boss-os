import { useEffect, useState } from "react";
import { api } from "./api";
import { Shell, type TabId } from "./components/Shell";
import { ScreenBoundary } from "./components/ScreenBoundary";
import { Lock } from "./pages/Lock";
import { Today } from "./pages/Today";
import { Inbox } from "./pages/Inbox";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { People } from "./pages/People";
import { Capital } from "./pages/Capital";
import { Spirit } from "./pages/Spirit";
import { Team } from "./pages/Team";
import { Memory } from "./pages/Memory";
import { Trading } from "./pages/Trading";
import { Vault } from "./pages/Vault";
import { Settings } from "./pages/Settings";
import { Systems } from "./pages/Systems";
import { startAutoFlush, pendingCount } from "./offline/outbox";

const TITLES: Record<TabId, string> = {
  today: "Today", inbox: "Inbox", people: "People", capital: "Capital",
  spirit: "Spirit", team: "Team", memory: "Memory", trading: "Trading", vault: "Vault",
  systems: "Systems",
};

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  // Canon §15: Today is the default operating screen.
  const [tab, setTab] = useState<TabId>("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [openApproval, setOpenApproval] = useState<string | null>(null);
  const [inboxKey, setInboxKey] = useState(0);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [waiting, setWaiting] = useState(0);

  /*
   * The outbox runs for the whole session, not per screen: a capture written on Today must still
   * flush if the connection returns while the reader is somewhere else entirely.
   */
  useEffect(() => {
    const stop = startAutoFlush(setWaiting);
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    void pendingCount().then(setWaiting);
    return () => {
      stop();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /*
   * OFFLINE, A LOCK SCREEN IS THE WRONG ANSWER.
   *
   * authState() is a network call, so with no connection it fails and the app used to fall to the
   * lock screen — where the passcode cannot be checked either. The one thing Boss OS promises
   * offline is capture, and that made capture unreachable at exactly the moment it was needed.
   *
   * So a session that HAS been unlocked on this device is remembered, and an unreachable
   * authState() renders the app rather than the lock. This grants nothing: every API call still
   * goes to the server and is still refused without a valid session. It only decides which screen
   * a reader with no connection is looking at, and the useful answer is the one they can write on.
   */
  useEffect(() => {
    api
      .authState()
      .then((s) => {
        setUnlocked(s.unlocked);
        try {
          if (s.unlocked) localStorage.setItem("boss-os-unlocked-here", "1");
          else localStorage.removeItem("boss-os-unlocked-here");
        } catch { /* private window: fall back to the lock screen, which is the safe direction */ }
      })
      .catch((err) => {
        /*
         * UNREACHABLE IS THE SIGNAL, NOT `navigator.onLine`.
         *
         * onLine lies in both directions — it reports a captive portal as online, and under
         * Playwright's offline emulation it stays true while every request fails. The honest
         * question is whether the server answered, and an ApiError with no status is exactly
         * "the request never got there". A real 401 still falls to the lock screen, as it must.
         */
        const unreachable = (err as { status?: number } | null)?.status === undefined;
        let known = false;
        try { known = localStorage.getItem("boss-os-unlocked-here") === "1"; } catch { known = false; }
        setUnlocked(unreachable && known);
      });
  }, []);

  // Today is the default tab now, so the Inbox badge can no longer wait for the
  // Inbox to mount before it knows what is waiting.
  useEffect(() => {
    if (unlocked) api.status().then((s) => setPending(s?.counts?.pending_approvals ?? 0)).catch(() => {});
  }, [unlocked]);

  if (unlocked === null) return <div className="lock"><p>Waking up</p></div>;
  if (!unlocked)
    return (
      <Lock
        onUnlock={() => {
          setUnlocked(true);
          // Remembered HERE, on unlock, because the mount effect already ran and will not run
          // again — which is why the flag was never written and the offline path never engaged.
          try { localStorage.setItem("boss-os-unlocked-here", "1"); } catch { /* private window */ }
        }}
      />
    );

  const lane = tab === "trading" ? "trading" : "ops";
  const title = settingsOpen ? "Settings" : openApproval && tab === "inbox" ? "Docket" : TITLES[tab];

  return (
    <Shell
      tab={tab}
      onTab={(t) => { setTab(t); setSettingsOpen(false); setOpenApproval(null); }}
      title={title}
      lane={lane}
      pending={pending}
      offline={offline}
      waiting={waiting}
      onSettings={() => { setSettingsOpen((v) => !v); setOpenApproval(null); }}
      settingsOpen={settingsOpen}
    >
      {/*
        * KEYED ON THE SCREEN, so navigating away clears a failure rather than carrying it. See
        * ScreenBoundary for why this exists: without it, one screen's render error took the entire
        * application down to a blank page, navigation included.
        */}
      <ScreenBoundary key={settingsOpen ? "settings" : tab} screen={settingsOpen ? "Settings" : TITLES[tab]}>
      {settingsOpen ? (
        <Settings onLock={async () => {
              await api.lock();
              try { localStorage.removeItem("boss-os-unlocked-here"); } catch { /* private window */ }
              setUnlocked(false);
              setSettingsOpen(false);
            }} />
      ) : tab === "today" ? (
        <Today />
      ) : tab === "inbox" ? (
        openApproval ? (
          <ApprovalDetail
            id={openApproval}
            onBack={() => setOpenApproval(null)}
            onDecided={() => setInboxKey((k) => k + 1)}
          />
        ) : (
          <Inbox key={inboxKey} onCountChange={setPending} onOpen={setOpenApproval} />
        )
      ) : tab === "people" ? (
        <People />
      ) : tab === "capital" ? (
        <Capital />
      ) : tab === "spirit" ? (
        <Spirit />
      ) : tab === "team" ? (
        <Team />
      ) : tab === "memory" ? (
        <Memory />
      ) : tab === "trading" ? (
        <Trading />
      ) : tab === "vault" ? (
        <Vault />
      ) : (
        <Systems />
      )}
      </ScreenBoundary>
    </Shell>
  );
}
