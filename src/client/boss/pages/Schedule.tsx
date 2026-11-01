import type { CSSProperties } from "react";
import manifest from "@shared/boss/schedule/manifest.json";

/**
 * THE SCHEDULE (owner approved the rebalanced week, 1 Nov 2026: "a Schedule page in Boss OS, next to
 * the Email Map ... it stays true on its own"). ☰ More → Schedule, /?tab=schedule.
 *
 * Rendered from the ONE list, src/shared/boss/schedule/manifest.json, never a copy. Phone first
 * (390px), calm: the approved week as she approved it — one section per day, each line with its
 * time (Central), whose it is, one plain sentence, and "emails you" when it does — then "Every day",
 * "Not shown on this page", and, folded away, every scheduled job with where it runs and when.
 * tests/schedule.test.ts and `npm run schedule:check` fail when a job runs at a time this page does
 * not show. Client sites are never listed here.
 */
export interface ScheduleRow {
  id: string; name: string; what: string; business: string; brand?: string; system: string;
  slots: string[]; emails: boolean; heavy: boolean;
  trigger: { duty?: string; launchd?: string[]; repo?: string; file?: string; crons?: string[]; wpos?: string };
}
export interface WeekItem { time: string; tag: string; text: string; emails: boolean; refs: string[]; pending?: boolean }
export interface ScheduleManifest {
  approved: { on: string; artifact: string; doc: string };
  tags: Record<string, { label: string; color: string }>;
  week: Array<{ day: string; label: string; items: WeekItem[] }>;
  everyDay: string[];
  notShown: string[];
  businesses: Array<{ key: string; label: string }>;
  systems: Record<string, string>;
  rows: ScheduleRow[];
}

export const SCHEDULE = manifest as unknown as ScheduleManifest;

const DAY_WORDS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** One slot in plain words: "Mon & Fri 8:00 am", "Every day 6:15 am", "Every 5 minutes". */
export function slotWords(slot: string): string {
  if (slot === "always") return "Always on";
  let m = /^every (\d+)([sm])$/.exec(slot);
  if (m) { const mins = m[2] === "s" ? Math.round(Number(m[1]) / 60) : Number(m[1]); return mins <= 1 ? "Every minute" : `Every ${mins} minutes`; }
  m = /^hourly :(\d\d)$/.exec(slot);
  if (m) return `Every hour at :${m[1]}`;
  m = /^(\S+) (\d\d:\d\d)(?:-(\d\d:\d\d)\/(\d+)m)?$/.exec(slot);
  if (!m) return slot;
  const [, d = "", start = "00:00", end, step] = m;
  const days = d === "daily" ? "Every day"
    : d === "mon,tue,wed,thu,fri" ? "Weekdays"
    : d.startsWith("day") ? `Monthly, the ${d.split(",").map((x) => x.slice(3)).join(" & ")}`
    : d.split(",").map((x) => DAY_WORDS[x] ?? x).join(" & ");
  return end ? `${days}, every ${step} min, ${clock(start)}–${clock(end)}` : `${days} ${clock(start)}`;
}

export function summaryLine(s: ScheduleManifest = SCHEDULE): string {
  const lines = s.week.reduce((a, d) => a + d.items.length, 0);
  const mails = s.week.reduce((a, d) => a + d.items.filter((i) => i.emails).length, 0);
  return `Your week, one theme a day: ${lines} weekly jobs, ${mails} of them email you. All times are Central. ${s.rows.length} scheduled jobs in all, listed at the bottom.`;
}

function Tag({ tag }: { tag: string }) {
  const t = SCHEDULE.tags[tag];
  return <span className="schedule-tag" style={{ "--tag": t?.color } as CSSProperties}>{t?.label ?? tag}</span>;
}

export function Schedule() {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }).toLowerCase().slice(0, 3);
  return (
    <div className="brains" data-testid="schedule">
      <p className="brain-summary">{summaryLine()}</p>
      <p className="brain-hint">Tap a day to open it. "✉ emails you" marks the jobs that write to you.</p>
      {SCHEDULE.week.map((d) => {
        const mails = d.items.filter((i) => i.emails).length;
        return (
          <details key={d.day} className="brain-expander schedule-day" open={d.day === today} data-testid={`schedule-day-${d.day}`}>
            <summary>
              <span className="email-map-business-name">{d.label}</span>
              <span className="email-map-count">{d.items.length} weekly jobs · {mails} {mails === 1 ? "email" : "emails"} to you — tap to open ▾</span>
            </summary>
            <div className="schedule-rows">
              {d.items.map((it, i) => (
                <div key={i} className="schedule-row" data-testid={`schedule-item-${d.day}-${i}`}>
                  <span className="schedule-time">{it.time}</span>
                  <div className="schedule-body">
                    <Tag tag={it.tag} />
                    <span className="schedule-text">{it.text}</span>
                    {it.emails ? <span className="schedule-mail">✉ emails you</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
      <details className="brain-expander" data-testid="schedule-every-day">
        <summary><span className="email-map-business-name">Every day</span><span className="email-map-count">Not moving — tap to open ▾</span></summary>
        <ul className="schedule-list">{SCHEDULE.everyDay.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </details>
      <details className="brain-expander" data-testid="schedule-not-shown">
        <summary><span className="email-map-business-name">Not shown on this page</span><span className="email-map-count">Tap to open ▾</span></summary>
        <ul className="schedule-list">{SCHEDULE.notShown.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </details>
      <details className="brain-expander" data-testid="schedule-all-jobs">
        <summary><span className="email-map-business-name">Every scheduled job</span><span className="email-map-count">{SCHEDULE.rows.length} jobs, by where they run — tap to open ▾</span></summary>
        {Object.entries(SCHEDULE.systems).map(([key, label]) => {
          const rows = SCHEDULE.rows.filter((r) => r.system === key);
          if (!rows.length) return null;
          return (
            <details key={key} className="brain-expander schedule-system">
              <summary><span className="schedule-text">{label}</span><span className="email-map-count">{rows.length} jobs ▾</span></summary>
              <div className="brain-cards">
                {rows.map((r) => (
                  <div key={r.id} className="brain-card email-map-card" data-testid={`schedule-job-${r.id}`}>
                    <span className="email-map-what">{r.brand ? `${r.brand}: ` : ""}{r.name}</span>
                    <span className="brain-card-line">{r.what}</span>
                    <span className="brain-card-line">{r.slots.map(slotWords).join(" · ")}</span>
                    <span className="email-map-runs">{SCHEDULE.businesses.find((b) => b.key === r.business)?.label ?? r.business}{r.emails ? " · emails you" : ""}{r.heavy ? " · heavy" : ""}</span>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </details>
      <p className="brain-hint">Approved {SCHEDULE.approved.on}. This page is built from the Schedule list in Boss OS. A job that runs at a time this page does not show fails the build.</p>
    </div>
  );
}
