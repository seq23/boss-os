import { OWNER_TIMEZONE, wallClock, zonedTime } from "./timezone";

/**
 * ─── ONE OPERATIONS VIEW: EMPLOYEE DUTIES AND MACHINE-RUN EMAIL PATHS, MERGED ───
 *
 * Owner, 12 Oct 2026 (approved): no separate Operations page; Team → Duties becomes the single
 * operations view. Everything on a schedule is one list there: the duties the employees own, and
 * every sending path in docs/OUTBOUND_EMAIL_MAP.md, each with the seat that owns it.
 *
 * THE MAP IS THE SOURCE. The client imports the markdown itself at build (`?raw`), and the owner
 * of each path lives in ONE file beside it (docs/outbound_email_owners.json), so the page can never
 * disagree with the doc and there are never two lists. tests/outboundEmailMap.test.ts fails CI on a
 * map row with no owner entry, an owner that is not a seat, or a cited file that does not exist.
 */

export interface MapRow {
  id: string;
  business: string;
  email: string;
  from: string;
  to: string;
  transport: string;
  trigger: string;
  runsWhere: string;
  footer: string;
  code: string;
  pause: string;
  status: string;
  note: string;
}

export interface OwnerEntry {
  seat: string;
  why: string;
}

export interface OwnersFile {
  /** Owners who are not Boss OS seats: another business's employee, or a client. */
  outside: string[];
  owners: Record<string, OwnerEntry>;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

/** The inventory table: the one whose header row starts `| Id |`. Zero rows means it moved. */
export function parseOutboundMap(doc: string): MapRow[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Id\s*\|/.test(l));
  if (start === -1) return [];
  const header = cells(lines[start]!);
  const at = (name: string) => header.indexOf(name);
  const col = (c: string[], name: string) => (at(name) === -1 ? "" : (c[at(name)] ?? "").replace(/`/g, "").trim());
  const rows: MapRow[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const c = cells(line);
    rows.push({
      id: (c[0] ?? "").replace(/`/g, "").trim(),
      business: col(c, "Business"),
      email: col(c, "Email"),
      from: col(c, "From"),
      to: col(c, "To"),
      transport: col(c, "Transport"),
      trigger: col(c, "Trigger"),
      runsWhere: col(c, "Runs where"),
      footer: col(c, "Footer / company line"),
      code: col(c, "Code"),
      pause: col(c, "How to pause"),
      status: col(c, "Status"),
      note: col(c, "Note"),
    });
  }
  return rows;
}

/** Inert paths look like senders and send nothing; "Not email" is listed so nobody hunts for it. */
export const isInert = (r: MapRow) => /inert/i.test(r.runsWhere) || /^already (inert|off)/i.test(r.pause);
const isOnEvent = (r: MapRow) => /on event|session|external/i.test(r.runsWhere);

/** Where it runs, in the six words the owner asked for. */
export function whereItRuns(r: MapRow): string {
  const w = r.runsWhere.toLowerCase();
  if (w.includes("launchd")) return "Mac launchd";
  if (w.includes("cloudflare cron")) return "Cloudflare cron";
  if (w.includes("on event")) return "Pages function";
  if (w.includes("github")) return "GitHub Actions";
  if (w.includes("session")) return "session";
  if (w.includes("external")) return "outside service";
  if (w.includes("not email")) return /launchd/i.test(r.trigger) ? "Mac launchd" : "not email";
  if (w.includes("cloudflare")) return "Cloudflare (inert)";
  return r.runsWhere || "unknown";
}

export type PauseControl =
  | { kind: "action"; label: string; target: "outreach" }
  | { kind: "command"; label: string; command: string }
  | { kind: "off"; label: string }
  | { kind: "none"; label: string };

/**
 * A pause control only where a real switch exists. Monique's outreach has one in the app (Team →
 * Outreach kill switch). A launchd job or a GitHub workflow has a one-line switch, shown as the
 * command. An inert path is already off. Everything else — removing a key, a vendor dashboard — is
 * not a switch, and the screen says "no switch" in plain words.
 */
export function pauseControl(r: MapRow): PauseControl {
  if (r.id === "monique-outreach") return { kind: "action", label: "Pause: kill switch on Team → Outreach", target: "outreach" };
  if (isInert(r)) return { kind: "off", label: "already off" };
  const cmd = r.pause.match(/(launchctl bootout \S+|gh workflow disable [^,;()]+)/);
  if (cmd) return { kind: "command", label: "switch", command: cmd[1]!.trim() };
  return { kind: "none", label: "no switch" };
}

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Next fire of a five-field cron whose day-of-month and month are `*`. Minute: `*`, `*\/n` or n. */
function nextCron(expr: string, now: number): number | null {
  const [mi, hr, , , dw] = expr.trim().split(/\s+/);
  if (mi === undefined || hr === undefined || dw === undefined) return null;
  const okMin = (m: number) => mi === "*" || (mi.startsWith("*/") ? m % Number(mi.slice(2)) === 0 : m === Number(mi));
  const okHr = (h: number) => hr === "*" || h === Number(hr);
  const okDow = (d: number) => dw === "*" || d === Number(dw);
  let t = Math.floor(now / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 60 * 24 * 8; i++, t += 60_000) {
    const d = new Date(t);
    if (okMin(d.getUTCMinutes()) && okHr(d.getUTCHours()) && okDow(d.getUTCDay())) return t;
  }
  return null;
}

export interface NextRun {
  /** Epoch ms of the next fire, when the trigger names one. */
  at: number | null;
  /** What to print when `at` is null: "on event", "every 5 min", "only in a session". */
  label: string;
}

/**
 * Read the map's Trigger cell for the next fire. The cell is prose written for people, so this
 * reads the shapes the map uses — cron expressions (UTC, Cloudflare and GitHub), "every N min",
 * weekday names, "1st", HH:MM times (UTC when the cell says UTC, else her Mac's Chicago clock) —
 * and says "on event" rather than guessing when none of them is there.
 */
export function nextRunFrom(r: MapRow, now: number): NextRun {
  if (isInert(r)) return { at: null, label: "off" };
  const trigger = r.trigger;
  const crons = trigger.match(/(?:\*\/\d+|\*|\d{1,2}) (?:\*|\d{1,2}) \* \* (?:\*|\d)/g) ?? [];
  if (crons.length) {
    const times = crons.map((c) => nextCron(c, now)).filter((t): t is number => t !== null);
    if (times.length) return { at: Math.min(...times), label: "" };
  }
  const every = trigger.match(/every (\d+) min/i);
  if (every) return { at: null, label: `every ${every[1]} min` };
  if (/session/i.test(r.runsWhere)) return { at: null, label: "only in a session" };
  const text = trigger.replace(/\([^)]*Chicago\)/gi, "");
  const zone = /UTC/.test(text) ? "UTC" : OWNER_TIMEZONE;
  const times = [...text.matchAll(/\b(\d{2}):(\d{2})\b/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  if (times.length === 0) return { at: null, label: isOnEvent(r) ? "on event" : "on event" };
  const days = new Set<number>();
  for (const m of text.matchAll(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g)) days.add(DOW[m[1]!.toLowerCase()]!);
  const monthly = /\b1st\b/.test(text);
  for (let k = 0; k < 40; k++) {
    const day = wallClock(now + k * 86_400_000, zone);
    if (monthly && day.d !== 1) continue;
    if (!monthly && days.size && !days.has(day.dow)) continue;
    const fires = times
      .map(([h, mi]) => zonedTime(day.y, day.m, day.d, h, zone, mi))
      .filter((t) => t > now)
      .sort((a, b) => a - b);
    if (fires.length) return { at: fires[0]!, label: "" };
  }
  return { at: null, label: "on event" };
}

/** What the Worker knows today, from the ledgers that exist (GET /api/employees/operations). */
export interface OperationsLedgers {
  outreach: { sent: number; failed: number; test: number; kill_switch: string; sending: string; paused_domains: number; last: { status: string; at: number } | null };
  task_notices: { sent: number; failed: number; last: { status: string; at: number } | null };
  runs: { duty_failed_today: number; cron_failed_today: number };
  named_stops: number;
  /** Latest wrapper outcome per launchd script, joined to a path by the script it cites. */
  local_jobs: Array<{ local_job: string; outcome: string; finished_at: number; reason: string | null }>;
}

export interface OperationsRow {
  id: string;
  kind: "path";
  owner: string | null;
  ownerKind: "seat" | "outside" | "unassigned";
  what: string;
  business: string;
  cadence: string;
  next: NextRun;
  where: string;
  from: string;
  footer: string;
  lastOutcome: string | null;
  pause: PauseControl;
  inert: boolean;
}

function lastOutcomeFor(r: MapRow, l: OperationsLedgers | null): string | null {
  if (!l) return null;
  const stamp = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  if (r.id === "monique-outreach") {
    const flag = l.outreach.kill_switch === "on" ? "kill switch ON" : `sending ${l.outreach.sending}`;
    return l.outreach.last ? `${l.outreach.last.status} ${stamp(l.outreach.last.at)} · ${flag}` : `nothing sent yet · ${flag}`;
  }
  if (r.id === "boss-task-notices") return l.task_notices.last ? `${l.task_notices.last.status} ${stamp(l.task_notices.last.at)}` : "nothing sent yet";
  const scripts = r.code.replace(/^boss-os\s+/, "").split(/[,+;\s]/).map((s) => s.trim().split("/").pop() ?? "").filter((s) => /\.(mjs|sh)$/.test(s));
  const job = l.local_jobs.filter((j) => scripts.includes(j.local_job.split("/").pop() ?? "")).sort((a, b) => b.finished_at - a.finished_at)[0];
  return job ? `${job.outcome} ${stamp(job.finished_at)}${job.reason && job.outcome !== "ok" ? ` — ${job.reason}` : ""}` : null;
}

/**
 * The merge. Every map row becomes a row with its owner; a row whose owner is missing, or names a
 * seat no longer on the live roster, is "unassigned" and is returned on its own so the screen can
 * put it at the top rather than hide it.
 */
export function mergeOperations(input: {
  mapRows: MapRow[];
  owners: OwnersFile;
  rosterNames: string[];
  ledgers: OperationsLedgers | null;
  now: number;
}): { rows: OperationsRow[]; unassigned: OperationsRow[]; bySeat: Map<string, OperationsRow[]> } {
  if (input.mapRows.length === 0) throw new Error("OUTBOUND_EMAIL_MAP has no inventory rows: the table or its Id column moved.");
  const roster = new Set(input.rosterNames);
  const outside = new Set(input.owners.outside);
  const rows: OperationsRow[] = input.mapRows.map((r) => {
    const entry = input.owners.owners[r.id];
    const seat = entry?.seat?.trim() || null;
    const ownerKind: OperationsRow["ownerKind"] = !seat ? "unassigned" : roster.has(seat) ? "seat" : outside.has(seat) ? "outside" : "unassigned";
    return {
      id: r.id,
      kind: "path",
      owner: ownerKind === "unassigned" ? null : seat,
      ownerKind,
      what: r.email,
      business: r.business,
      cadence: r.trigger,
      next: nextRunFrom(r, input.now),
      where: whereItRuns(r),
      from: r.from,
      footer: r.footer,
      lastOutcome: lastOutcomeFor(r, input.ledgers),
      pause: pauseControl(r),
      inert: isInert(r),
    };
  });
  const bySeat = new Map<string, OperationsRow[]>();
  for (const row of rows) {
    if (!row.owner) continue;
    bySeat.set(row.owner, [...(bySeat.get(row.owner) ?? []), row]);
  }
  return { rows, unassigned: rows.filter((r) => r.ownerKind === "unassigned"), bySeat };
}

export interface Synopsis {
  running: string;
  sent: string;
  needs: string;
  counts: {
    dutiesToday: number;
    pathsScheduled: number;
    pathsOff: number;
    outreachSent: number;
    outreachFailed: number;
    noticesSent: number;
    unassigned: number;
    failedRuns: number;
    namedStops: number;
  };
}

/** A duty runs today when it is switched on and its next fire falls before tomorrow (her zone). */
export function dutiesDueToday(duties: Array<{ suspended?: number | null; next_due_at?: number | null }>, now: number): number {
  const d = wallClock(now);
  const tomorrow = zonedTime(d.y, d.m, d.d, 0) + 86_400_000 + 3_600_000;
  return duties.filter((x) => x.suspended !== 1 && typeof x.next_due_at === "number" && x.next_due_at < tomorrow).length;
}

/** The three numbers lines at the top of Duties, and the one line on Today. */
export function synopsis(input: {
  rows: OperationsRow[];
  unassigned: OperationsRow[];
  dutiesToday: number;
  ledgers: OperationsLedgers | null;
}): Synopsis {
  const off = input.rows.filter((r) => r.inert).length;
  const scheduled = input.rows.filter((r) => !r.inert && (r.next.at !== null || /^every /.test(r.next.label))).length;
  const l = input.ledgers;
  const failedRuns = l ? l.runs.duty_failed_today + l.runs.cron_failed_today + l.outreach.failed + l.task_notices.failed : 0;
  const counts = {
    dutiesToday: input.dutiesToday,
    pathsScheduled: scheduled,
    pathsOff: off,
    outreachSent: l?.outreach.sent ?? 0,
    outreachFailed: l?.outreach.failed ?? 0,
    noticesSent: l?.task_notices.sent ?? 0,
    unassigned: input.unassigned.length,
    failedRuns,
    namedStops: l?.named_stops ?? 0,
  };
  return {
    running: `Running today: ${counts.dutiesToday} duties · ${counts.pathsScheduled} scheduled email paths · ${counts.pathsOff} off`,
    sent: l
      ? `Sent today: outreach ${counts.outreachSent}${counts.outreachFailed ? ` (${counts.outreachFailed} failed)` : ""} · task notices ${counts.noticesSent} · Porter: no ledger in Boss OS`
      : "Sent today: ledgers not loaded",
    needs: `Needs you: ${counts.unassigned} unassigned · ${counts.failedRuns} failed runs · ${counts.namedStops} named stops`,
    counts,
  };
}
