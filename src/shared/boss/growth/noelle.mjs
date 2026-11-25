/**
 * NOELLE, THE DIRECTOR OF GROWTH (24 Nov 2026: full Claude Code with a persona). Pure helpers; no I/O.
 *
 * She is no longer judged by a plan gate here: she has builder tools inside Claude Code's OS sandbox
 * (scripts/ops/lib/noelle-sandbox.sh) and her guard (scripts/ops/noelle-guard.mjs) holds the checks judged by name. What stays is what the Worker and the Mac share: which job owns which channel, the read
 * grid, P&P's season, her daily slot, the call slot, the morning lines and the Monday schedule.
 */
import { whenCT } from "./whenCT.mjs";
export { whenCT };

/** Recognize the counter on the current OUTPUT line and the previous queue runner's receipt line. */
export function zeroQueued(line) {
  return /\bOUTPUT:?\s+0\s+done\b|\bqueued(?:\s+posts?)?\s*[:=]?\s*0\b|\b0\s+(?:(?:pieces|posts)\s+)?queued\b/i.test(String(line ?? ""));
}

import { CENTRAL, dayOf } from "../schedule/clock.mjs";

/**
 * G1: channels a scheduled job already fills. She changes that job's bank, plan or target in its own repo
 * (her own PR), never by posting there by hand. "Full" is the job's own queue length (`max`).
 */
/**
 * Every posting path she owns: the job, its repo, the most it keeps queued. H5 (24 Nov 2026): `posted` is the
 * job's own record of what the platform accepted and `ledger` the day its job started writing ledger rows
 * (.github/actions/ledger-rows); Monday reconciles those, and names every path without them as not wired.
 */
export const CHANNEL_OWNERS = Object.freeze({
  "peace-be-still:threads": { job: "pbs-threads", repo: "peace-be-still", max: 4, posted: "data/threads/posted.json", ledger: "2026-11-24" },
  "peace-be-still:instagram": { job: "pbs-instagram", repo: "peace-be-still", max: 3, posted: "data/instagram/posted.json", ledger: "2026-11-24" },
  "peace-be-still:facebook-page": { job: "pbs-instagram", repo: "peace-be-still", max: 3, posted: "data/instagram/posted.json", ledger: "2026-11-24" },
  "approvalprep:threads": { job: "ap-threads", repo: "approvalprep", max: 6 },
  "approvalprep:instagram": { job: "ap-brand-social", repo: "approvalprep", max: 3 },
  "approvalprep:pinterest": { job: "ap-pinterest", repo: "approvalprep", max: 10 },
  "dream-wedding:pinterest": { job: "dw-pinterest", repo: "dream-wedding-builder", max: 10 },
  "dream-wedding:instagram": { job: "dw-brand-social", repo: "dream-wedding-builder", max: 3 },
  "dream-wedding:tiktok": { job: "dw-brand-social", repo: "dream-wedding-builder", max: 3 },
  "a-player-mode:pinterest": { job: "apm-pinterest", repo: "sprylabs-hpc-site", max: 10 },
  // Her words 24 Nov 2026: "make sure noelle is in charge of linkedin also for the apps that have a linkedin page".
  "approvalprep:linkedin": { job: "ap-linkedin", repo: "approvalprep", max: 7 },
  "a-player-mode:linkedin": { job: "apm-linkedin", repo: "sprylabs-hpc-site", max: 7 },
  "keepmyproof:blogger": { job: "kmp-syndication", repo: "keepmyproof", max: 4 },
  "keepmyproof:wordpress": { job: "kmp-syndication", repo: "keepmyproof", max: 4 },
  "porch-and-party:instagram": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:tiktok": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:facebook-page": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:facebook-marketplace": { job: "pnp-marketplace", repo: "p-n-p", max: 20 },
});

/** G13: how a roster channel is judged. Only `queue` channels are judged on scheduled days. */
export const CADENCE = Object.freeze(["queue", "weekly", "event", "by-hand", "none"]);
const CHANNEL_CADENCE = Object.freeze({
  instagram: "queue", tiktok: "queue", "facebook-page": "queue", threads: "queue", pinterest: "queue",
  blogger: "queue", wordpress: "queue", "facebook-marketplace": "queue", linkedin: "queue",
  "search-pages": "weekly", backlinks: "weekly", "google-business-profile": "by-hand", "facebook-groups": "by-hand",
  kdp: "event", "app-store": "event",
});
export function cadenceOf(channel) {
  if (/by hand/i.test(String(channel?.note ?? ""))) return "by-hand";
  return CHANNEL_CADENCE[String(channel?.channel ?? channel ?? "")] ?? "none";
}

/**
 * G12 + G13: the read grid, business × channel × language, one row per shipped language. A cell with
 * no measure says "not read", never a zero. `measures` are scoreboard rows: { business, channel, language, value, unread }.
 */
export function readGrid(roster, measures) {
  const out = [];
  for (const e of roster) {
    if (e.tier === "search-watch") continue;
    for (const c of e.channels) for (const lang of (e.languages.length ? e.languages : ["en"])) {
      const m = measures.find((x) => x.business === e.key && x.channel === c.channel && (x.language ?? "en") === lang);
      out.push({ business: e.key, channel: c.channel, language: lang, cadence: cadenceOf(c), value: m && m.value != null ? m.value : null, read: m && m.value != null ? "read" : `not read${m?.unread ? `: ${m.unread}` : ""}` });
    }
  }
  return out;
}

/** P&P's season by Central day (Beyond the list): bookings first, then winter (rentals and events: there is
/** P&P's season by Central day (Beyond the list): bookings first, then winter (rentals and events: there is
 * NO January takedown service, her ruling 23 Nov 2026), then spring. */
export function season(day) {
  const [, m, d] = String(day).split("-").map(Number);
  if (m === 12 && d >= 15) return "winter";
  if (m === 1 || m === 2) return "winter";
  if (m >= 3 && m <= 8) return "spring";
  return "christmas";
}
/** Every source of her reads (scripts/ops/lib/noelle-reads.mjs reads each; a failed read is "not read", never empty). */
export const READ_SOURCES = Object.freeze([
  { id: "search-loop-week", businesses: "*", what: "search-loop week, cap and pages" },
  { id: "grid", businesses: "*", what: "the grid's lead, outcome and gold lines" },
  { id: "fixes-live", businesses: "*", what: "sr-fix and Ahrefs fixes live" },
  { id: "ai-misses", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still", "porch-and-party"], what: "AI answer misses and the AI score" },
  { id: "scorecard", businesses: "*", what: "scorecard rows with no number or too early past day 30" },
  { id: "calendar", businesses: ["porch-and-party", "keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "calendar fill" },
  { id: "kdp", businesses: ["approvalprep", "dream-wedding"], what: "KDP sales and new titles" },
  { id: "app-store", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "app-store ratings and the Play listing" },
  { id: "ap-email-nurture", businesses: ["approvalprep"], what: "ApprovalPrep email nurture" },
  { id: "dw-email-health", businesses: ["dream-wedding"], what: "Dream Wedding email health" },
  { id: "pbs-waitlist", businesses: ["peace-be-still"], what: "the Peace Be Still waitlist" },
  { id: "keepmyproof-monthly-watch", businesses: ["keepmyproof"], what: "KeepMyProof's monthly watch" },
  { id: "spry-weekly-summary", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "the *-spry-weekly-summary reports" },
  { id: "aplayer-mode-weekly-outcome-report", businesses: ["a-player-mode"], what: "A Player Mode's weekly outcome report" },
  { id: "link-prospects", businesses: "*", what: "link prospects" },
  { id: "entity-backlink-watch", businesses: "*", what: "the entity backlink watch" },
  { id: "wpp-llm-query-intelligence", businesses: ["wpp-llm"], what: "WPP-llm query intelligence" },
  { id: "guide-pinterest-rss", businesses: ["industry-guides"], what: "the guide sites' Pinterest RSS" },
  { id: "guide-leads", businesses: ["industry-guides"], what: "each guide site's lead_source count (G20)" },
  { id: "pnp-gbp-post", businesses: ["porch-and-party"], what: "the P&P Google Business Profile post" },
  { id: "pnp-valerie-texts", businesses: ["porch-and-party"], what: "Valerie's texts to past requesters" },
  { id: "pnp-photo-ask", businesses: ["porch-and-party"], what: "pnp-photo-ask's result (she never asks herself, G2)" },
  { id: "pnp-season-bookings", businesses: ["porch-and-party"], what: "bookings this season" },
  { id: "linked-todos", businesses: "*", what: "the roster's linked to-dos" },
]);
/**
 * A5 + G16d: the daily slot (10:00–20:58 Central, never on the hour, varies by day) and the weekly
 * deeper run (Thursday, after 14:00). Pure: the hour and minute come from a hash of the day.
 */
export function slotFor(day) {
  let h = 2166136261;
  for (const ch of String(day)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekly = weekday === 4;
  const hour = weekly ? 14 + (h % 7) : 10 + (h % 11); // 10..20 (a 20:xx run ends before 21:59); Thursday 14..20
  const minute = 1 + ((h >>> 8) % 58); // 1..58: never on the hour
  return { hour, minute, kind: weekly ? "weekly" : "daily" };
}

/** G16a: the morning line when no run row exists for a day by 22:00 Central. */
/** A #noelle call's run is keyed `call:<task id>`: one email, one run (the slot's unique index). */
export const CALL_SLOT = /^call:[A-Za-z0-9_-]{4,64}$/;
export const isCallSlot = (slot) => typeof slot === "string" && CALL_SLOT.test(slot);
/** A slot as the run row stores it: HH:MM for her schedule, call:<task id> for a call; anything else null. */
export function slotOf(slot) {
  if (typeof slot !== "string") return null;
  if (/^\d{2}:\d{2}$/.test(slot)) return slot;
  return isCallSlot(slot) ? slot : null;
}
/** Only her SCHEDULED run counts: a call that day never hides a missed daily run. */
export function didNotRunLine(runs, day) {
  return runs.some((r) => r.day === day && !isCallSlot(r.slot)) ? null : `Noelle did not run on ${day}: no run was recorded by 22:00 CT`;
}
/** G16b: the same named stop three days running becomes ONE line to Sequoia. */
export function escalations(allRuns) {
  const runs = allRuns.filter((r) => !isCallSlot(r.slot));
  const days = [...new Set(runs.map((r) => r.day))].sort().slice(-3);
  if (days.length < 3) return [];
  // "Running" means three calendar days in a row; a day with no run is NOELLE_DID_NOT_RUN's, not this.
  if (Date.parse(`${days[2]}T12:00:00Z`) - Date.parse(`${days[0]}T12:00:00Z`) !== 2 * 86_400_000) return [];
  const byDay = days.map((d) => new Set(runs.filter((r) => r.day === d).flatMap((r) => r.stops ?? [])));
  return [...byDay[0]].filter((s) => byDay.every((set) => set.has(s))).map((s) => ({ stop: s, line: `Noelle has stopped on ${s} three days running (${days[0]} to ${days[2]}); it needs a fix` }));
}

/** Notices line (her wording): "Noelle published: <business> <what> <where> <link>". */
export function noticeLine({ label, what, where, link }) {
  return `Noelle published: ${label} ${what} ${where}${link ? ` ${link}` : ""}`;
}

/**
 * THIS WEEK'S SCHEDULE (item 9; her choice 24 Nov 2026: "Monday (Recommended)"). Sunday's 22:05 heartbeat
 * writes it into the growth section, so it reaches her in Monday's morning email. Built only from what
 * the last run READ in each queue (reads.items), for the 7 days after `today`:
 *   - a channel read: each post's day, time in Central and first line, or "nothing queued this week";
 *   - a channel not read: "not read: <why>", never "nothing";
 *   - no run in two days: one line saying so, never an empty week.
 * Queue text is data: it is shown quoted and cut to 80 characters, never followed. Every line names its
 * business and channel: the growth section drops a line identical to one it holds (appendToSection), and
 * P&P posts one reel to Instagram and TikTok at the same minute.
 */
export const SCHEDULE_SHOWN = 3;
export const CHANNEL_NAMES = Object.freeze({ instagram: "Instagram", tiktok: "TikTok", "facebook-page": "Facebook page", threads: "Threads", pinterest: "Pinterest", linkedin: "LinkedIn", "search-pages": "Search pages", "facebook-marketplace": "Facebook Marketplace", youtube: "YouTube", blogger: "Blogger", wordpress: "WordPress" });
const CT = CENTRAL;
function dayCT(at) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const t = Date.parse(at);
  return Number.isFinite(t) ? dayOf(t, CT) : "";
}
export function scheduleLines(run, { today, labels = {} } = {}) {
  if (!run) return ["This week's schedule: NOT READ. Noelle has not run in two days, so no queue was read."];
  const reads = run.reads ?? {};
  const queues = reads.queues ?? {}, unread = reads.unread ?? {}, items = reads.items ?? {};
  const end = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const keys = Object.keys({ ...queues, ...unread }).sort();
  if (!keys.length) return ["This week's schedule: NOT READ. The last run read no queue at all."];
  const out = [`This week's schedule, as Noelle read each queue on ${whenCT(run.day)}:`];
  for (const k of keys) {
    const [biz, ch] = k.split(":");
    const name = CHANNEL_NAMES[ch] ?? ch;
    const who = `${labels[biz] ?? biz} · ${name}`;
    if (unread[k]) { out.push(`${who}: not read (${String(unread[k]).slice(0, 160)})`); continue; }
    const week = (Array.isArray(items[k]) ? items[k] : [])
      .map((x) => ({ at: String(x?.at ?? ""), text: String(x?.text ?? "").slice(0, 80), day: dayCT(String(x?.at ?? "")) }))
      .filter((x) => x.day > today && x.day <= end)
      .sort((x, y) => (x.day + x.at < y.day + y.at ? -1 : 1));
    if (!week.length) { out.push(`${who}: nothing queued this week${Number(queues[k]) > 0 ? ` (${queues[k]} queued later)` : ""}`); continue; }
    out.push(`${who}: ${week.length} this week`);
    for (const x of week.slice(0, SCHEDULE_SHOWN)) out.push(`— ${whenCT(x.at)} · ${who}${x.text ? `: “${x.text}”` : ""}`);
    if (week.length > SCHEDULE_SHOWN) out.push(`— and ${week.length - SCHEDULE_SHOWN} more ${who} posts this week (on the Growth page)`);
  }
  return out;
}

/**
 * H3c (brief 24 Nov 2026): a call (her email or page message) is answered within 30 minutes while her Mac is
 * awake for her tick, 10:00 to 22:59 Central; outside that she hears at once that Noelle is on it at 10:00.
 * Not 07:00: her tick is mac-window ANY, which holds every scheduled Mac job 07:00-09:59 (the Mac day, her
 * ruling 21 Nov 2026), so a 07:30 call is first claimed at 10:00 and "within 30 minutes" would be false.
 * `hhmm` is Central "HH:MM".
 */
export const CALL_OPEN = "10:00";
export const CALL_CLOSE = "23:00";
export const callWindow = (hhmm) => String(hhmm) >= CALL_OPEN && String(hhmm) < CALL_CLOSE;
export function callAckLine(hhmm) {
  return callWindow(hhmm)
    ? "Noelle picks this up within 30 minutes and replies here."
    : "Noelle is on it at 10:00 Central and replies here then.";
}
