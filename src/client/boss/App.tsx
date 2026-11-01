import { useEffect, useState } from "react";
import { api } from "./api";
import { Shell, type TabId } from "./components/Shell";
import { ScreenBoundary } from "./components/ScreenBoundary";
import { Lock } from "./pages/Lock";
import { Today, BriefingPage } from "./pages/Today";
import { TellSimone } from "./components/TellSimone";
import { Sheet } from "./components/TodayList";
import { CommandPage } from "./pages/CommandPage";
import { MailPage } from "./pages/MailPage";
import { Inbox } from "./pages/Inbox";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Capital } from "./pages/Capital";
import { Spirit } from "./pages/Spirit";
import { Team, type TeamView } from "./pages/Team";
import { Memory } from "./pages/Memory";
import { Brains } from "./pages/Brains";
import { EmailMap } from "./pages/EmailMap";
import { Trading } from "./pages/Trading";
import { Vault } from "./pages/Vault";
import { Settings } from "./pages/Settings";
import { Systems } from "./pages/Systems";
import { startAutoFlush, pendingCount } from "./offline/outbox";
import { MorningItem, WorkItem } from "./pages/MorningItem";
import { readRoute, readFocus, readGateFocus, type Route } from "./nav";

/*
 * ─── THE PEOPLE TAB IS GONE, AND THE RECORD IS NOT ──────────────────────────
 *
 * Her verdict, 9 September 2026: "i dont like this people tab at all id rather just scrap it. id
 * rather monique just send me deliverables she suggests about people to speak to (no codenames
 * needed)".
 *
 * It was two hundred and sixty-seven rows of code names — SANDPIPER, HERON, ROOK — sorted by how
 * late each one was, twenty-five of them reading "469d late". A directory, in a private language,
 * in an order nobody asked for. The screen was not under-built; browsing was the wrong answer to
 * the question.
 *
 * WHAT REPLACED IT IS A DELIVERABLE. `scripts/ops/people-worth-a-call.mjs` runs weekly on her Mac,
 * reads the same correspondence, and emails her three to five people BY REAL NAME with why each one
 * and what to say — plus a notice in the Inbox saying it ran. The contacts, the exchange counts and
 * the local identity map are all untouched: what was scrapped is the tab, not the record.
 */
const TITLES: Record<TabId, string> = {
  today: "Today", inbox: "Inbox", capital: "Capital",
  spirit: "Spirit", team: "Team", brains: "Brains", emails: "Email Map", memory: "Memory", trading: "Trading", vault: "Vault",
  systems: "Systems",
};

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  // Canon §15: Today is the default operating screen.
  const [tab, setTab] = useState<TabId>("today");
  // boss fix D — a link in her morning email ("See the full grid") opens the Deals page directly.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "capital") setTab("capital"); }, []); // boss fix D
  // Combined boss fix — Danielle's "Stopped work on …" email opens the change on Systems → Properties.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "systems") setTab("systems"); }, []);
  /*
   * EVERY LINK IN HER MORNING EMAIL OPENS ITS OWN SCREEN (24 Oct 2026): an item of the morning, a
   * piece of work, an employee's open work, an Inbox approval, or Today at the briefing. The address
   * bar carries which (nav.ts); the browser's Back returns to where she was.
   */
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [focus, setFocus] = useState(() => readFocus());
  const [gateFocus, setGateFocus] = useState(() => readGateFocus());
  // THE FLOATING "✎ TELL SIMONE" (31 Oct 2026): one tap from any tab, a sheet over the page.
  const [tellOpen, setTellOpen] = useState(() => readFocus() === "tell");
  // Today's one "needs you" count, on the Today tab wherever she is.
  const [needsYou, setNeedsYou] = useState(0);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (t && t in TITLES) setTab(t as TabId);
    if (t === "inbox" && q.get("approval")) setOpenApproval(q.get("approval"));
    const onPop = () => {
      setRoute(readRoute());
      const f = readFocus();
      setFocus(f);
      setGateFocus(readGateFocus());
      if (f === "tell") setTellOpen(true);
      // A link to a place on Today (a coach talk, a gate, the briefing) opens Today.
      if (f && f !== "tell") { setTab("today"); setSettingsOpen(false); setOpenApproval(null); }
      // In-app links carry a tab too (Today's "Open Spirit ›", a lead's "Open ›", an approval row).
      const q = new URLSearchParams(window.location.search);
      const t = q.get("tab");
      if (!f && t && t in TITLES) { setTab(t as TabId); setSettingsOpen(false); setOpenApproval(t === "inbox" ? q.get("approval") : null); if (t === "team") setTeamStart(q.get("team") === "duties" ? "duties" : "team"); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const closeRoute = () => { if (route) { window.history.pushState({}, "", "/"); setRoute(null); } };
  // Today's Operations line opens Team on Duties; any other way in opens it on the roster.
  const [teamStart, setTeamStart] = useState<TeamView>("team");
  // Your team → "Open LP replies" lands on that Deals view (Builder U).
  const [capitalStart, setCapitalStart] = useState<"lp" | "prospects" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [openApproval, setOpenApproval] = useState<string | null>(null);
  // Bumped by Today's "Open Recent work"; Team scrolls to its Recent work list when it changes.
  const [recentFocus, setRecentFocus] = useState(0);
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

  /*
   * THE BADGE IS RE-READ ON EVERY NAVIGATION, NOT ONCE AT UNLOCK.
   *
   * ─── What she was shown on 9 September 2026 ──────────────────────────────
   *
   *   Today card: "Approval Inbox - 9 waiting".  Tab badge: 9.
   *   Inbox tab:  "0 waiting on you - Nothing needs you".  The API: [].
   *
   * The number was not wrong when it was fetched; it was fetched once, at unlock, and then nothing
   * in the application ever asked again. Approvals expire on the cron, judgement calls are raised by
   * local jobs, and a decision taken on one screen changes the count for every other - so a
   * once-only read is a number that is correct for a few minutes a day.
   *
   * She reported the identical thing in the other product ("still says 12 unread even tho i read it
   * all"), so it is a pattern rather than an incident, and the two halves are fixed together:
   * `approvals/pending.ts` makes the count and the list one query on the server, and this makes the
   * client ask again every time she moves.
   *
   * A FAILED READ CLEARS THE BADGE RATHER THAN KEEPING THE OLD ONE. A stale number is
   * indistinguishable from a fresh one, and this whole defect is what that costs.
   */
  /*
   * THAT SHE OPENED THE APP (31 Oct 2026, the tough-love emails). One ping when the app is unlocked
   * and again when it comes back to the front, at most every 20 minutes. It records a day and a time.
   */
  useEffect(() => {
    if (!unlocked) return;
    let last = 0;
    const ping = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 20 * 60_000) return;
      last = Date.now();
      void api.practiceOpened().catch(() => undefined);
    };
    ping();
    document.addEventListener("visibilitychange", ping);
    return () => document.removeEventListener("visibilitychange", ping);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || tab === "today") return;
    api.practiceList().then((l) => setNeedsYou(l?.needs_you ?? 0)).catch(() => undefined);
  }, [unlocked, tab]);

  useEffect(() => {
    if (!unlocked) return;
    api.status()
      .then((s) => setPending(s?.counts?.pending_approvals ?? 0))
      .catch(() => setPending(0));
  }, [unlocked, tab]);

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
  const title = route ? (route.kind === "morning" ? "This morning" : route.kind === "task" ? "The work" : route.kind === "command" ? "Your request" : route.kind === "mail" ? "Your email" : "Open work")
    : settingsOpen ? "Settings" : tab === "today" && focus === "briefing" ? "Briefing" : openApproval && tab === "inbox" ? "Docket" : TITLES[tab];

  return (
    <Shell
      tab={tab}
      onTab={(t) => { closeRoute(); setTab(t); setTeamStart("team"); setCapitalStart(undefined); setSettingsOpen(false); setOpenApproval(null); }}
      onBack={route || tab !== "today" || settingsOpen || focus === "briefing" ? () => { closeRoute(); if (focus) { window.history.pushState({}, "", "/"); setFocus(null); setGateFocus(null); } setTab("today"); setTeamStart("team"); setCapitalStart(undefined); setSettingsOpen(false); setOpenApproval(null); } : undefined}
      title={title}
      lane={lane}
      pending={pending}
      offline={offline}
      waiting={waiting}
      onSettings={() => { setSettingsOpen((v) => !v); setOpenApproval(null); }}
      settingsOpen={settingsOpen}
      needsYou={needsYou}
      onTellSimone={() => setTellOpen(true)}
      sheet={tellOpen ? (
        <Sheet title="Tell Simone" onClose={() => setTellOpen(false)} testId="tell-sheet">
          <TellSimone focus onOpenRecentWork={() => { setTellOpen(false); setTeamStart("team"); setTab("team"); setRecentFocus((n) => n + 1); }} />
        </Sheet>
      ) : null}
    >
      {/*
        * KEYED ON THE SCREEN, so navigating away clears a failure rather than carrying it. See
        * ScreenBoundary for why this exists: without it, one screen's render error took the entire
        * application down to a blank page, navigation included.
        */}
      <ScreenBoundary key={route ? JSON.stringify(route) : settingsOpen ? "settings" : tab} screen={settingsOpen ? "Settings" : title}>
      {route ? (
        route.kind === "morning" ? <MorningItem day={route.day} id={route.item} />
          : route.kind === "command" ? <CommandPage id={route.id} />
          : route.kind === "mail" ? <MailPage id={route.id} />
          : route.kind === "task" ? <WorkItem taskId={route.id} />
          : <WorkItem employeeId={route.id} />
      ) : settingsOpen ? (
        <Settings onLock={async () => {
              await api.lock();
              try { localStorage.removeItem("boss-os-unlocked-here"); } catch { /* private window */ }
              setUnlocked(false);
              setSettingsOpen(false);
            }} />
      ) : tab === "today" && focus === "briefing" ? (
        <BriefingPage />
      ) : tab === "today" ? (
        <Today
          focus={focus}
          gateFocus={gateFocus}
          onNeedsYou={setNeedsYou}
          onOpenOperations={() => { setTeamStart("duties"); setTab("team"); }}
          // "Open Recent work" after telling Simone: Your team, at its Recent work list.
          onOpenRecentWork={() => { setTeamStart("team"); setTab("team"); setRecentFocus((n) => n + 1); }}
        />
      ) : tab === "inbox" ? (
        openApproval ? (
          <ApprovalDetail
            id={openApproval}
            onBack={() => setOpenApproval(null)}
            onDecided={() => setInboxKey((k) => k + 1)}
          />
        ) : (
          <Inbox onBack={() => setTab("today")} key={inboxKey} onCountChange={setPending} onOpen={setOpenApproval} />
        )
      ) : tab === "capital" ? (
        <Capital key={capitalStart ?? "default"} start={capitalStart} />
      ) : tab === "spirit" ? (
        <Spirit />
      ) : tab === "team" ? (
        <Team key={teamStart} start={teamStart} focusRecent={recentFocus} onOpenDeals={(v) => { setCapitalStart(v); setTab("capital"); }} />
      ) : tab === "brains" ? (
        <Brains />
      ) : tab === "emails" ? (
        <EmailMap />
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
