/**
 * THE SCHEDULE'S GUARD (owner approved the rebalanced week, 1 Nov 2026: "a Schedule page in Boss OS,
 * next to the Email Map ... it stays true on its own").
 *
 * src/shared/boss/schedule/manifest.json is the one list the Schedule page renders. This module keeps
 * it true, the same way scripts/ops/lib/email-map.mjs keeps the Email Map true:
 *
 *   - every Boss OS duty, every launchd job on her Mac, and every GitHub Actions / Cloudflare cron in
 *     her repos has a row (client repos excepted: they are never listed in Boss OS);
 *   - every row's slots equal what the real trigger fires, in Central time.
 *
 * Read by tests/schedule.test.ts (CI: the installer's plists, the duties the migrations build, this
 * repo's own crons) and by scripts/ops/schedule-check.mjs (`npm run schedule:check`, on her Mac: the
 * live duties, the plists launchd actually holds, and the crons on every repo's default branch).
 *
 * ─── A SLOT ──────────────────────────────────────────────────────────────────────────────────────
 * One string, Central time:
 *   "mon 07:15"            weekly          "mon,wed,fri 05:30"   those days
 *   "daily 06:15"          every day       "day1 09:30"          the 1st of each month
 *   "hourly :23"           every hour at :23
 *   "daily 06:00-22:40/20m"  every 20 minutes from 06:00 to 22:40 (four or more evenly spaced times)
 *   "every 300s"           launchd StartInterval;  "every 15m" a cron/interval;  "always" KeepAlive
 * Days are written in the order mon..sun; a set of all seven is "daily".
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { centralToLocalOffset } from "../plist-central.mjs";
import { clientRepoProblems, isClientRepo, repoDir } from "./email-map.mjs";

export const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

// ─── Canonical slots ──────────────────────────────────────────────────────────────────────────

/**
 * Events → canonical slot strings. An event is `{ dow?: 0-6, dom?: 1-31, mins?: minute-of-day }`,
 * or `{ hourlyAt: m }`, `{ every: "300s" }`, `{ always: true }`. Pure.
 */
export function canonical(events) {
  const out = new Set();
  const byTime = new Map(); // mins → Set(dow)
  const monthly = new Map(); // mins → Set(dom)
  for (const e of events) {
    if (e.always) out.add("always");
    else if (e.every) out.add(`every ${e.every}`);
    else if (e.hourlyAt != null) out.add(`hourly :${pad(e.hourlyAt)}`);
    else if (e.dom != null) { if (!monthly.has(e.mins)) monthly.set(e.mins, new Set()); monthly.get(e.mins).add(e.dom); }
    else { if (!byTime.has(e.mins)) byTime.set(e.mins, new Set()); for (const d of e.dow == null ? [0, 1, 2, 3, 4, 5, 6] : [e.dow]) byTime.get(e.mins).add(d); }
  }
  for (const [mins, doms] of monthly) out.add(`${[...doms].sort((a, b) => a - b).map((d) => `day${d}`).join(",")} ${hhmm(mins)}`);
  // Group times that share the same day set, then compress evenly spaced runs of four or more.
  const groups = new Map(); // dayKey → [mins]
  for (const [mins, dows] of byTime) {
    const key = dows.size === 7 ? "daily" : ORDER.filter((n) => dows.has(DAY_NAMES.indexOf(n))).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mins);
  }
  for (const [key, list] of groups) {
    const t = [...new Set(list)].sort((a, b) => a - b);
    const step = t.length >= 4 ? t[1] - t[0] : 0;
    if (step > 0 && t.every((m, i) => i === 0 || m - t[i - 1] === step)) out.add(`${key} ${hhmm(t[0])}-${hhmm(t[t.length - 1])}/${step}m`);
    else for (const m of t) out.add(`${key} ${hhmm(m)}`);
  }
  return [...out].sort();
}

export const sameSlots = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ─── launchd ─────────────────────────────────────────────────────────────────────────────────

/** The StartCalendarInterval / StartInterval / KeepAlive of one plist's text, as events. `shift` is subtracted from each Hour (Mac zone → Central). */
export function plistEvents(text, shift = 0) {
  const ev = [];
  if (/<key>KeepAlive<\/key>\s*<(true|dict)/.test(text)) ev.push({ always: true });
  const si = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(text);
  if (si) ev.push({ every: `${si[1]}s` });
  const at = text.indexOf("<key>StartCalendarInterval</key>");
  if (at === -1) return ev;
  const rest = text.slice(at + "<key>StartCalendarInterval</key>".length);
  const isArray = /^\s*<array>/.test(rest);
  const block = isArray ? rest.slice(0, rest.indexOf("</array>")) : rest.slice(0, rest.indexOf("</dict>") + 7);
  for (const m of block.matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
    const get = (k) => { const r = new RegExp(`<key>${k}</key>\\s*<integer>(\\d+)</integer>`).exec(m[1]); return r ? Number(r[1]) : null; };
    const [wd, day, hour, minute] = [get("Weekday"), get("Day"), get("Hour"), get("Minute") ?? 0];
    if (hour == null) { ev.push({ hourlyAt: minute }); continue; }
    let h = hour - shift;
    let dShift = 0;
    if (h < 0) { h += 24; dShift = -1; } else if (h >= 24) { h -= 24; dShift = 1; }
    const e = { mins: h * 60 + minute };
    if (wd != null) e.dow = (((wd % 7) + dShift) + 7) % 7;
    if (day != null) e.dom = Math.max(1, day + dShift);
    ev.push(e);
  }
  return ev;
}

/** Every launchd job the installer writes: `{ label: slots }`, hours as written (Central). Pure. */
export function installerJobs(sh) {
  const vars = {};
  for (const m of sh.matchAll(/^([A-Z0-9_]*LABEL)="([^"]+)"/gm)) vars[m[1]] = m[2];
  const jobs = {};
  // Heredoc stanzas: <key>Label</key><string>$X_LABEL</string> ... </plist>
  for (const m of sh.matchAll(/<key>Label<\/key><string>\$([A-Z0-9_]*LABEL)<\/string>([\s\S]*?)<\/plist>/g)) {
    const label = vars[m[1]];
    if (label) jobs[label] = canonical(plistEvents(m[2]));
  }
  // install_l_job <label> "<cmd>" '<dicts>' <logs>
  for (const m of sh.matchAll(/^install_l_job (\S+) "[^"]*" '([^']*)'/gm)) {
    jobs[m[1]] = canonical(plistEvents(`<key>StartCalendarInterval</key><array>${m[2]}</array>`));
  }
  return jobs;
}

/** The labels this Mac's launchd holds that the Schedule must carry (her own families only). */
export const LAUNCHD_FAMILIES = /^(com\.seq\.|com\.howweknow\.|ventures\.westpeek\.)/;

/** Every plist installed on this Mac: `{ label: slots }` in Central (each Hour moved back from the Mac's zone). */
export function installedJobs(dir = path.join(homedir(), "Library", "LaunchAgents"), shift = centralToLocalOffset()) {
  const jobs = {};
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith(".plist")) continue;
    const label = f.slice(0, -".plist".length);
    if (!LAUNCHD_FAMILIES.test(label)) continue;
    let text;
    try { text = execFileSync("plutil", ["-convert", "xml1", "-o", "-", path.join(dir, f)], { encoding: "utf8" }); } catch { text = readFileSync(path.join(dir, f), "utf8"); }
    text = text.replace(/<key>(\w+)<\/key>\s*\n\s*</g, "<key>$1</key><");
    jobs[label] = canonical(plistEvents(text, shift));
  }
  return jobs;
}

// ─── Duties ──────────────────────────────────────────────────────────────────────────────────

/** A standing_duties row → its slots. Pure. */
export function dutySlots(d) {
  const mins = Number(d.local_hour) * 60 + Number(d.local_minute ?? 0);
  if (d.cadence === "monthly") return canonical([{ dom: 1, mins }]);
  let days = null;
  try { days = d.weekdays ? JSON.parse(d.weekdays) : null; } catch { days = null; }
  if (Array.isArray(days) && days.length) return canonical(days.map((dow) => ({ dow: Number(dow), mins })));
  if (d.cadence === "weekly") return canonical([{ dow: Number(d.weekday ?? 1), mins }]);
  return canonical([{ mins }]);
}

// ─── Crons (GitHub Actions, Cloudflare) ──────────────────────────────────────────────────────

function expand(field, lo, hi) {
  const out = new Set();
  for (const part of field.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let [a, b] = range === "*" ? [lo, hi] : range.split("-").map(Number);
    if (b == null) b = stepS ? hi : a;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out];
}

/** One UTC cron → events in Central, at the offset in force at `now` (CST = -6, CDT = -5). Pure. */
export function cronEvents(cron, utcOffsetHours = chicagoOffset()) {
  const tz = /^CRON_TZ=(\S+)\s+/.exec(cron.trim());
  if (tz) {
    if (tz[1] !== "America/Chicago") return [];
    cron = cron.trim().slice(tz[0].length);
    utcOffsetHours = 0;
  }
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return [];
  const [mi, ho, dom, , dow] = f;
  if (mi === "*" && ho === "*") return [{ every: "1m" }];
  if (/^\*\/\d+$/.test(mi) && ho === "*") return [{ every: `${mi.split("/")[1]}m` }];
  const minutes = expand(mi, 0, 59);
  if (ho === "*" && minutes.length === 1 && dom === "*" && dow === "*") return [{ hourlyAt: (minutes[0]) }];
  const hours = expand(ho, 0, 23);
  const days = dow === "*" ? null : expand(dow.replace(/7/g, "0"), 0, 6);
  const doms = dom === "*" ? null : expand(dom, 1, 31);
  const ev = [];
  for (const h of hours) for (const m of minutes) {
    let ct = h * 60 + m + utcOffsetHours * 60;
    let shift = 0;
    if (ct < 0) { ct += 1440; shift = -1; } else if (ct >= 1440) { ct -= 1440; shift = 1; }
    if (doms) for (const d of doms) ev.push({ dom: Math.max(1, d + shift), mins: ct });
    else if (days) for (const d of days) ev.push({ dow: (d + shift + 7) % 7, mins: ct });
    else ev.push({ mins: ct });
  }
  return ev;
}

/** Chicago's offset from UTC in hours at `now` (-6 or -5). */
export function chicagoOffset(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour12: false, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - now.getTime()) / 3_600_000);
}

/**
 * DST PAIRS. A workflow that must fire at one Central time all year declares two UTC crons and a guard
 * step that lets only the one matching Chicago's offset run: `if [ "$SCHEDULE" = "<cron>" ] && [
 * "$offset" != "-0500" ]; then run=false` means <cron> runs only in summer (CDT). Returns the crons
 * that run only at each offset. Pure.
 */
export function gatedCrons(yaml) {
  const only = { "-5": [], "-6": [] };
  for (const m of yaml.matchAll(/"\$SCHEDULE"\s*=\s*"([^"]+)"\s*\]\s*&&\s*\[\s*"\$offset"\s*!=\s*"-0(500|600)"/g)) only[m[2] === "500" ? "-5" : "-6"].push(m[1].trim());
  return only;
}

/** The crons of a file that really run at this offset (the other half of a DST pair is skipped). Pure. */
export function activeCrons({ crons, gated }, utcOffset = chicagoOffset()) {
  const off = gated?.[String(utcOffset === -5 ? -6 : -5)] ?? [];
  return crons.filter((c) => !off.includes(c));
}

/** The crons a workflow file declares. Pure. */
export function workflowCrons(yaml) {
  // GitHub reads a cron in UTC unless the entry carries `timezone:`; one in Chicago is written
  // "CRON_TZ=America/Chicago <cron>" here, so cronEvents reads it as Central with no DST shift.
  const lines = yaml.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)-\s*cron:\s*["']([^"']+)["']/.exec(line);
    if (!m) return;
    let tz = null;
    for (let j = i + 1; j < lines.length; j++) {
      const t = /^(\s*)timezone:\s*["']?([A-Za-z_/]+)["']?/.exec(lines[j]);
      if (t && t[1].length > m[1].length) { tz = t[2]; break; }
      if (/^\s*-\s/.test(lines[j]) || (lines[j].trim() && /^(\s*)/.exec(lines[j])[1].length <= m[1].length)) break;
    }
    out.push(tz ? `CRON_TZ=${tz} ${m[2].trim()}` : m[2].trim());
  });
  return out;
}

/** The crons a wrangler.toml / wrangler.jsonc declares, per env (top level is ""). Pure, best effort. */
export function wranglerCrons(text) {
  const out = [];
  for (const m of text.matchAll(/crons["']?\s*[=:]\s*\[([^\]]*)\]/g)) for (const c of m[1].matchAll(/["']([^"']+)["']/g)) out.push(c[1].trim());
  return out;
}

// ─── The manifest ────────────────────────────────────────────────────────────────────────────

export function readSchedule(root) {
  return JSON.parse(readFileSync(path.join(root, "src/shared/boss/schedule/manifest.json"), "utf8"));
}

const SLOT_RE = /^(always|every \d+[sm]|hourly :\d\d|(daily|(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*|day\d{1,2}(,day\d{1,2})*) \d\d:\d\d(-\d\d:\d\d\/\d+m)?)$/;

/** The shape every row must have; a row the page cannot show fully is a problem by name. */
export function shapeProblems(m) {
  const keys = new Set(m.businesses.map((b) => b.key));
  const systems = new Set(Object.keys(m.systems));
  const ids = new Set();
  const out = [];
  for (const r of m.rows) {
    if (ids.has(r.id)) out.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    for (const f of ["id", "name", "what", "business", "system"]) if (typeof r[f] !== "string" || !r[f].trim()) out.push(`${r.id ?? "(no id)"}: ${f} is empty`);
    if (!keys.has(r.business)) out.push(`${r.id}: business ${r.business} is not one of the page's businesses`);
    if (!systems.has(r.system)) out.push(`${r.id}: system ${r.system} is not a known place`);
    if (typeof r.emails !== "boolean" || typeof r.heavy !== "boolean") out.push(`${r.id}: emails and heavy must be true or false`);
    if (!Array.isArray(r.slots) || r.slots.length === 0) out.push(`${r.id}: no slots (when does it run?)`);
    for (const s of r.slots ?? []) if (!SLOT_RE.test(s)) out.push(`${r.id}: slot "${s}" is not a slot`);
    const t = r.trigger ?? {};
    if (!t.duty && !t.launchd && !t.repo && !t.wpos) out.push(`${r.id}: names no trigger (duty, launchd, repo file or West Peek OS job)`);
    if (t.repo && (!t.file || !Array.isArray(t.crons) || !t.crons.length)) out.push(`${r.id}: a repo trigger needs its file and its crons`);
  }
  return out;
}

/** Client repos never appear (the Email Map's exclusion, one list). */
export function scheduleClientProblems(m, scanned = []) {
  const asMap = { rows: m.rows.map((r) => ({ ...r, code: r.trigger?.repo ? [{ repo: r.trigger.repo }] : [] })) };
  return clientRepoProblems(asMap, scanned);
}

/** Rows naming a duty, by duty id. */
export const rowsByDuty = (m) => new Map(m.rows.filter((r) => r.trigger?.duty).map((r) => [r.trigger.duty, r]));
/** Rows naming a launchd label, by label (a row may carry several labels). */
export function rowsByLabel(m) {
  const out = new Map();
  for (const r of m.rows) for (const l of [].concat(r.trigger?.launchd ?? [])) out.set(l, r);
  return out;
}

/** The slots a launchd label must fire: the row's `tick` (a daily tick on a weekly duty) when given, else its slots. */
export const labelSlots = (r, label) => r.trigger?.ticks?.[label] ?? r.slots;

/** Duties (rows from D1 or the API) against the manifest. */
export function dutyProblems(m, duties) {
  const by = rowsByDuty(m);
  const out = [];
  for (const d of duties) {
    if (d.removed_at || d.removed) continue;
    const r = by.get(d.id);
    if (!r) { out.push(`duty ${d.id} (${d.name}) runs and no Schedule row names it`); continue; }
    const real = dutySlots(d);
    if (!sameSlots(real, r.slots)) out.push(`${r.id}: the duty ${d.id} runs ${real.join(" + ")}, the Schedule says ${r.slots.join(" + ")}`);
  }
  const live = new Set(duties.filter((d) => !(d.removed_at || d.removed)).map((d) => d.id));
  for (const [id, r] of by) if (!live.has(id)) out.push(`${r.id}: names duty ${id}, which does not exist (or was removed)`);
  return out;
}

/** launchd jobs (`{ label: slots }`) against the manifest. `retired` labels may exist without rows. */
export function launchdProblems(m, jobs) {
  const by = rowsByLabel(m);
  const out = [];
  for (const [label, slots] of Object.entries(jobs)) {
    const r = by.get(label);
    if (!r) { out.push(`launchd ${label} fires ${slots.join(" + ") || "(nothing)"} and no Schedule row names it`); continue; }
    const want = labelSlots(r, label);
    if (!sameSlots(slots, want)) out.push(`${r.id}: launchd ${label} really fires ${slots.join(" + ")} Central, the Schedule says ${want.join(" + ")}`);
  }
  return out;
}

/** The labels rows name that this set of jobs does not hold. */
export const missingLabels = (m, jobs) => [...rowsByLabel(m).keys()].filter((l) => !(l in jobs));

/**
 * Crons of one repo (`[{ file, crons }]`) against the manifest: every scheduled file has a row whose
 * crons are exactly the file's, and every row's slots are among what those crons really fire now.
 */
export function cronProblems(m, repo, files, utcOffset = chicagoOffset()) {
  const rows = m.rows.filter((r) => r.trigger?.repo === repo);
  const out = [];
  for (const { file, crons } of files) {
    if (!crons.length) continue;
    const mine = rows.filter((r) => r.trigger.file === file);
    if (!mine.length) { out.push(`${repo}: ${file} runs on ${crons.join(" | ")} and no Schedule row names it`); continue; }
    const named = new Set(mine.flatMap((r) => r.trigger.crons));
    for (const c of crons) if (!named.has(c)) out.push(`${repo}: ${file} cron "${c}" is on no Schedule row`);
    const f = files.find((x) => x.file === file);
    for (const r of mine) {
      for (const c of r.trigger.crons) if (!crons.includes(c)) out.push(`${r.id}: cron "${c}" is no longer in ${repo}/${file}`);
      const live = activeCrons({ crons: r.trigger.crons, gated: f.gated }, utcOffset);
      const real = canonical(live.flatMap((c) => cronEvents(c, utcOffset)));
      if (!sameSlots(real, r.slots)) out.push(`${r.id}: says ${r.slots.join(" + ")}, but its crons fire ${real.join(" + ")} Central now`);
    }
  }
  const scheduled = new Set(files.filter((f) => f.crons.length).map((f) => f.file));
  for (const r of rows) if (!scheduled.has(r.trigger.file)) out.push(`${r.id}: ${repo}/${r.trigger.file} has no schedule any more (or is gone/disabled)`);
  return out;
}

/** One repo's scheduled files on its default branch (workflows that are not disabled, wrangler configs). */
export function repoCronFiles(repo, root, { fetch = true, disabled = new Set() } = {}) {
  const dir = scheduleRepoDir(repo, root);
  if (!dir) return null;
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  if (fetch) { try { git("fetch", "-q", "origin"); } catch { /* offline: read what is here */ } }
  let ref = "origin/main";
  try { ref = git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").trim(); } catch { /* default */ }
  const files = git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean);
  const out = [];
  for (const f of files) {
    const wf = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f);
    const wr = /(^|\/)wrangler\.(toml|jsonc?)$/.test(f) && !/node_modules|fixtures?\//.test(f);
    if (!wf && !wr) continue;
    if (wf && disabled.has(f)) continue;
    const text = git("show", `${ref}:${f}`);
    const crons = wf ? (/^\s*schedule:/m.test(text) ? workflowCrons(text) : []) : wranglerCrons(text);
    if (crons.length) out.push({ file: f, crons: [...new Set(crons)], gated: wf ? gatedCrons(text) : { "-5": [], "-6": [] } });
  }
  return out;
}

/** Workflows GitHub has switched off in a repo (paths). Empty when gh cannot answer. */
export function disabledWorkflows(owner, repo) {
  try {
    const j = JSON.parse(execFileSync("gh", ["api", `repos/${owner}/${repo}/actions/workflows?per_page=100`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    return new Set((j.workflows ?? []).filter((w) => w.state !== "active").map((w) => w.path));
  } catch { return new Set(); }
}

/** Her repos that could carry a schedule: every non-archived repo of the owner that is not a client's. */
export function candidateRepos(owner) {
  const j = JSON.parse(execFileSync("gh", ["repo", "list", owner, "--limit", "300", "--json", "name,isArchived"], { encoding: "utf8" }));
  return j.filter((r) => !r.isArchived).map((r) => r.name).filter((n) => !isClientRepo(n));
}

/** Where a repo's checkout is on her Mac (seq-bin is ~/bin), or null. */
export function scheduleRepoDir(repo, root) {
  if (repo === "seq-bin") return existsSync(path.join(homedir(), "bin", ".git")) ? path.join(homedir(), "bin") : null;
  return repoDir(repo, root);
}

/** A repo with no checkout here: its active scheduled workflows, read through the GitHub API. */
export function repoCronFilesApi(owner, repo) {
  const api = (p) => JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 << 20 }));
  const out = [];
  for (const w of api(`repos/${owner}/${repo}/actions/workflows?per_page=100`).workflows ?? []) {
    if (w.state !== "active" || !/^\.github\/workflows\//.test(w.path)) continue;
    let text = "";
    try { text = Buffer.from(api(`repos/${owner}/${repo}/contents/${w.path}`).content ?? "", "base64").toString("utf8"); } catch { continue; }
    const crons = /^\s*schedule:/m.test(text) ? workflowCrons(text) : [];
    if (crons.length) out.push({ file: w.path, crons: [...new Set(crons)], gated: gatedCrons(text) });
  }
  return out;
}

// ─── The approved week (what the page shows) against the rows ───────────────────────────────

/** "5:30", "6:00pm", "10pm", "7:00–8:00", "Before 6am" → `{ from, to }` minutes (inclusive), or null. Pure. */
export function displayWindow(t) {
  const one = (s, pmHint = false) => {
    const m = /^(\d{1,2})(?::(\d\d))?\s*(am|pm)?$/i.exec(s.trim());
    if (!m) return null;
    let h = Number(m[1]);
    const pm = (m[3] ?? "").toLowerCase() === "pm" || (pmHint && h < 12);
    if (pm && h < 12) h += 12;
    if ((m[3] ?? "").toLowerCase() === "am" && h === 12) h = 0;
    return { mins: h * 60 + Number(m[2] ?? 0), exactMinute: m[2] != null };
  };
  const before = /^before\s+(.+)$/i.exec(t.trim());
  if (before) { const b = one(before[1]); return b ? { from: 0, to: b.mins - 1 } : null; }
  const range = t.split(/\s*[–-]\s*/);
  if (range.length === 2) {
    const a = one(range[0]); const b = one(range[1]);
    return a && b ? { from: a.mins, to: b.mins + (b.exactMinute ? 0 : 59) } : null;
  }
  const a = one(t);
  if (!a) return null;
  return a.exactMinute ? { from: a.mins, to: a.mins } : { from: a.mins, to: a.mins + 59 };
}

/** The (day, minute) pairs a slot fires on in a week (monthly, hourly and interval slots fire on none here). */
export function slotTimes(slot) {
  const m = /^(daily|[a-z,]+) (\d\d):(\d\d)(?:-(\d\d):(\d\d)\/(\d+)m)?$/.exec(slot);
  if (!m || /^day\d/.test(m[1])) return [];
  const days = m[1] === "daily" ? ORDER : m[1].split(",");
  const start = Number(m[2]) * 60 + Number(m[3]);
  const times = [start];
  if (m[4]) for (let t = start + Number(m[6]); t <= Number(m[4]) * 60 + Number(m[5]); t += Number(m[6])) times.push(t);
  return days.flatMap((d) => times.map((t) => ({ day: d, mins: t })));
}

/**
 * Every line of the approved week names rows that really run on that day inside its stated time.
 * Returns `{ problems, pending }`: a pending line (jobs in another repo still moving) is listed, not failed.
 */
export function weekProblems(m) {
  const byId = new Map(m.rows.map((r) => [r.id, r]));
  const problems = [];
  const pending = [];
  for (const day of m.week ?? []) {
    for (const it of day.items) {
      if (!m.tags?.[it.tag]) problems.push(`${day.label} ${it.time}: tag ${it.tag} is not one of the page's tags`);
      if (typeof it.text !== "string" || !it.text.trim()) problems.push(`${day.label} ${it.time}: no words`);
      const win = displayWindow(it.time);
      if (!win) { problems.push(`${day.label}: "${it.time}" is not a time the page can check`); continue; }
      if (it.pending) { pending.push(`${day.label} ${it.time} — ${it.text.slice(0, 70)}`); continue; }
      if (!it.refs?.length) { problems.push(`${day.label} ${it.time}: names no job (and is not marked pending)`); continue; }
      for (const id of it.refs) {
        const r = byId.get(id);
        if (!r) { problems.push(`${day.label} ${it.time}: names ${id}, which is not a row`); continue; }
        const hits = r.slots.flatMap(slotTimes).filter((s) => s.day === day.day && s.mins >= win.from && s.mins <= win.to);
        if (!hits.length) problems.push(`${day.label} ${it.time} "${it.text.slice(0, 50)}": ${id} does not run then (it runs ${r.slots.join(" + ")})`);
      }
    }
  }
  return { problems, pending };
}
