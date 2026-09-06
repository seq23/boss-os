import { useEffect, useState } from "react";
import { api } from "./api";
import { Shell, type TabId } from "./components/Shell";
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

const TITLES: Record<TabId, string> = {
  today: "Today", inbox: "Inbox", people: "People", capital: "Capital",
  spirit: "Spirit", team: "Team", memory: "Memory", trading: "Trading", vault: "Vault",
};

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  // Canon §15: Today is the default operating screen.
  const [tab, setTab] = useState<TabId>("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [openApproval, setOpenApproval] = useState<string | null>(null);
  const [inboxKey, setInboxKey] = useState(0);

  useEffect(() => {
    api.authState().then((s) => setUnlocked(s.unlocked)).catch(() => setUnlocked(false));
  }, []);

  // Today is the default tab now, so the Inbox badge can no longer wait for the
  // Inbox to mount before it knows what is waiting.
  useEffect(() => {
    if (unlocked) api.status().then((s) => setPending(s?.counts?.pending_approvals ?? 0)).catch(() => {});
  }, [unlocked]);

  if (unlocked === null) return <div className="lock"><p>Waking up</p></div>;
  if (!unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;

  const lane = tab === "trading" ? "trading" : "ops";
  const title = settingsOpen ? "Settings" : openApproval && tab === "inbox" ? "Docket" : TITLES[tab];

  return (
    <Shell
      tab={tab}
      onTab={(t) => { setTab(t); setSettingsOpen(false); setOpenApproval(null); }}
      title={title}
      lane={lane}
      pending={pending}
      onSettings={() => { setSettingsOpen((v) => !v); setOpenApproval(null); }}
      settingsOpen={settingsOpen}
    >
      {settingsOpen ? (
        <Settings onLock={async () => { await api.lock(); setUnlocked(false); setSettingsOpen(false); }} />
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
      ) : (
        <Vault />
      )}
    </Shell>
  );
}
