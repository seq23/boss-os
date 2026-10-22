#!/usr/bin/env node
/**
 * ZORA'S FRIDAY ARCHIVE AUDIT (owner, 22 Oct 2026).
 *
 * duty_archive_audit (migration 0288), Fridays 08:40 CT on her Mac through duty-run.sh. Two jobs:
 *
 *   1. NOTHING GOES STALE QUIETLY. The living documents are checked against the code or the live data
 *      they describe; anything 14+ days stale is FIXED when the fix belongs to a lane that can make it
 *      (a boss-os repo document → a repo change on Danielle's desk, which plans, asks her once and
 *      lands on green) or FLAGGED to its owner in Zora's email:
 *        docs/OUTBOUND_EMAIL_MAP.md       "Last verified" vs. the newest commit to any boss-os file it cites
 *        docs/SIDE_BUSINESS_REVIEW.md     its date line vs. 14 days
 *        ~/HANDOFF.md                     its Today section's date vs. 14 days (Today is replaced daily)
 *        Open Loops page (claude.ai)      every item dated 14+ days ago, read through her Claude session
 *   2. EVERYTHING DELIVERED CAN BE FOUND. Every page in her artifact gallery (research pages, mock-ups,
 *      playbooks, previews) is filed on the ONE list, `delivered_work` (POST /api/boss/research/delivered;
 *      Camille's research pages file themselves on delivery). Pages that belong to the fund are left
 *      for the fund's own archive — Boss OS never lists them.
 *
 * A source it cannot read is a NAMED STOP line in the email, never a pass. Rule 0: nothing read → exit 3.
 *
 *   npm run archive:audit            # check, fix/flag, file, email what moved
 *   npm run archive:audit -- --dry   # check and print only
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  askClaudeJson, bossApi, loadState, movedReadings, readNothingStop, saveState, sendAs, stateMap,
} from "./lib/duty-kit.mjs";

const DRY = process.argv.includes("--dry");
/** The one model this duty names (its duty row says the same): a short Haiku run on her Claude seat, mail headers or the gallery only. */
export const MODEL = "claude-haiku-4-5-20251001";
const DAY = 86_400_000;
export const STALE_DAYS = 14;
const REPO = process.env.BOSS_OS_REPO ?? join(homedir(), "GitHub", "boss-os");
const HANDOFF = process.env.BOSS_HANDOFF ?? join(homedir(), "HANDOFF.md");
export const OPEN_LOOPS_URL = "https://claude.ai/artifact/QhkCPRzzuNm9Kd1ystTuDd";

/** Pages that belong to the fund are not Boss OS's to file (boss-os never lists West Peek paths). */
export const NOT_OURS_RE = /\b(west ?peek|porter|scooter|\blp\b|lps|investor|fund strategy|deals section|secondar(y|ies)|allocator|mega-check|contract digest)\b/i;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "12 Oct 2026", "2026-10-12", "October 12, 2026" → ms, or null. Pure. */
export function dateIn(text) {
  const s = String(text ?? "");
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(s);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] !== undefined) return Date.UTC(+m[3], MONTHS[m[2].slice(0, 4).toLowerCase()], +m[1]);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) return Date.UTC(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

export const daysSince = (t, now) => Math.floor((now - t) / DAY);

/** The kind a delivered page is filed under, from its title. Pure. */
export function kindOf(title) {
  const t = String(title ?? "").toLowerCase();
  if (/\b(mock|preview|wireframe|layout|design|directions?)\b/.test(t)) return "mockup";
  if (/\b(playbook|checklist|plan|walk-through|how-to|routing)\b/.test(t)) return "playbook";
  if (/\b(report|review|numbers|digest|map)\b/.test(t)) return "report";
  return "page";
}

/** The HANDOFF Today section's date, or null. Pure. */
export function handoffTodayDate(md) {
  const at = String(md ?? "").search(/^#{1,3}\s*Today\b.*$/im);
  if (at === -1) return null;
  return dateIn(String(md).slice(at, at + 400));
}

/** The boss-os files a map row cites (Code column), for the "newer than verified" comparison. Pure. */
export function citedBossFiles(mapMd) {
  const files = new Set();
  for (const line of String(mapMd ?? "").split("\n")) {
    if (!/^\|\s*`[^`]+`\s*\|/.test(line)) continue;
    for (const m of line.matchAll(/boss-os\s+([^|]+)/g)) {
      // A bare name is read against the directory of the path before it ("task-notices.mjs + notify.mjs").
      let dir = "";
      for (const tok of m[1].split(/[,+;]\s*/)) {
        const p = tok.trim().split(/\s+/)[0] ?? "";
        if (/^(scripts|src|workers|docs)\/[\w./-]+\.\w+$/.test(p)) { files.add(p); dir = p.slice(0, p.lastIndexOf("/") + 1); }
        else if (dir && /^[\w.-]+\.(mjs|js|ts|sh|md)$/.test(p)) files.add(dir + p);
      }
    }
  }
  return [...files];
}

function lastCommit(paths) {
  const r = spawnSync("git", ["-C", REPO, "log", "-1", "--format=%ct", "origin/main", "--", ...paths], { encoding: "utf8" });
  const t = Number(String(r.stdout ?? "").trim()) * 1000;
  return Number.isFinite(t) && t > 0 ? t : null;
}

function readDoc(rel) {
  const p = join(REPO, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function auditEmailMap(now) {
  const key = "doc:OUTBOUND_EMAIL_MAP";
  const md = readDoc("docs/OUTBOUND_EMAIL_MAP.md");
  if (!md) return { key, state: "stop", line: `The Outbound Email Map is not in ${REPO}.` };
  const verified = dateIn((/Last verified[^\n]*/i.exec(md) ?? [""])[0]);
  if (verified === null) return { key, state: "alert", line: "Outbound Email Map: no 'Last verified' date — it cannot say how current it is.", owner: "Zora" };
  const code = lastCommit(citedBossFiles(md));
  const age = daysSince(verified, now);
  if (code && code > verified + DAY && age >= STALE_DAYS) {
    return { key, state: "alert", owner: "Danielle", fix: "boss-os docs/OUTBOUND_EMAIL_MAP.md", line: `Outbound Email Map last verified ${age} days ago; sending code it cites changed after that (${new Date(code).toISOString().slice(0, 10)}).` };
  }
  return { key, state: "ok", line: `Outbound Email Map verified ${age} days ago; no cited sending code changed since.` };
}

function auditSideBusiness(now) {
  const key = "doc:SIDE_BUSINESS_REVIEW";
  const md = readDoc("docs/SIDE_BUSINESS_REVIEW.md");
  if (!md) return { key, state: "stop", line: `The Side Business Review copy is not in ${REPO}.` };
  const dated = dateIn(md.split("\n").slice(0, 15).join("\n"));
  const committed = lastCommit(["docs/SIDE_BUSINESS_REVIEW.md"]);
  const t = Math.max(dated ?? 0, committed ?? 0);
  if (!t) return { key, state: "alert", owner: "Zora", line: "Side Business Review: no date and no commit — cannot say how current it is." };
  const age = daysSince(t, now);
  return age >= STALE_DAYS
    ? { key, state: "alert", owner: "Danielle", fix: "boss-os docs/SIDE_BUSINESS_REVIEW.md", line: `Side Business Review last refreshed ${age} days ago.` }
    : { key, state: "ok", line: `Side Business Review refreshed ${age} days ago.` };
}

function auditHandoff(now) {
  const key = "doc:HANDOFF";
  if (!existsSync(HANDOFF)) return { key, state: "stop", line: `${HANDOFF} does not exist on this Mac.` };
  const md = readFileSync(HANDOFF, "utf8");
  const today = handoffTodayDate(md);
  const mtime = statSync(HANDOFF).mtimeMs;
  const t = today ?? mtime;
  const age = daysSince(t, now);
  return age >= STALE_DAYS
    ? { key, state: "alert", owner: "you (the coordinating session)", line: `~/HANDOFF.md ${today ? "Today section is dated" : "was last written"} ${age} days ago — Today is meant to be replaced each working day.` }
    : { key, state: "ok", line: `~/HANDOFF.md current (${age} day${age === 1 ? "" : "s"}).` };
}

/** One Claude-session read: the artifact gallery and the Open Loops page. */
function readGalleryAndLoops() {
  const a = askClaudeJson(
    "Use the Artifact tool. First call it with action \"list\", scope \"mine\", limit 200. Then call it with action \"read\" on " + OPEN_LOOPS_URL + ". " +
    "Reply with ONLY one JSON object: {\"artifacts\":[{\"title\":\"…\",\"url\":\"https://claude.ai/artifact/…\",\"updated\":\"YYYY-MM-DD\"}], " +
    "\"open_loops\":[{\"item\":\"<the item in at most 15 words>\",\"date\":\"YYYY-MM-DD or null\",\"owner\":\"<who owns it, or null>\"}]}. Include every artifact and every open item.",
    { model: MODEL, maxTurns: 8 },
  );
  if (!a.ok || typeof a.json !== "object" || a.json === null) return { ok: false, why: a.ok ? "the answer was not an object" : a.why };
  return { ok: true, artifacts: Array.isArray(a.json.artifacts) ? a.json.artifacts : null, loops: Array.isArray(a.json.open_loops) ? a.json.open_loops : null };
}

async function main() {
  const now = Date.now();
  const prev = loadState("archive-audit");
  const readings = [auditEmailMap(now), auditSideBusiness(now), auditHandoff(now)];

  const g = readGalleryAndLoops();
  let filed = 0;
  let toFile = [];
  if (!g.ok || g.loops === null) {
    readings.push({ key: "open_loops", state: "stop", line: `The Open Loops page could not be read through her Claude session (${g.ok ? "no open_loops list" : g.why}).` });
  } else {
    const stale = g.loops.filter((l) => { const t = dateIn(l?.date); return t !== null && daysSince(t, now) >= STALE_DAYS; });
    readings.push(stale.length
      ? { key: "open_loops", state: "alert", owner: "each item's owner", line: `Open Loops: ${stale.length} of ${g.loops.length} item(s) are 14+ days old — ${stale.slice(0, 6).map((l) => `${String(l.item).slice(0, 80)} (${l.owner ?? "no owner named"})`).join("; ")}.` }
      : { key: "open_loops", state: "ok", line: `Open Loops: ${g.loops.length} item(s), none 14+ days old.` });
  }
  if (!g.ok || g.artifacts === null) {
    readings.push({ key: "gallery", state: "stop", line: `The artifact gallery could not be listed through her Claude session (${g.ok ? "no artifacts list" : g.why}).` });
  } else {
    toFile = g.artifacts
      .filter((x) => /^https:\/\/claude\.ai\/(code\/)?artifact\//.test(String(x?.url ?? "")) && String(x?.title ?? "").trim() && !NOT_OURS_RE.test(String(x.title)))
      .map((x) => ({ kind: kindOf(x.title), title: String(x.title).trim().slice(0, 200), location: x.url, delivered_at: dateIn(x.updated) }));
    readings.push({ key: "gallery", state: "ok", line: `Artifact gallery: ${g.artifacts.length} page(s), ${toFile.length} Boss OS piece(s) to keep on the list.` });
  }

  for (const r of readings) console.log(`  [${r.state}] ${r.line}`);
  const stop = readNothingStop(readings, "ARCHIVE_READ_NOTHING");
  if (stop) { console.error(stop); process.exit(3); }
  if (DRY) { console.log("ARCHIVE-AUDIT-COMPLETE: dry"); return; }

  const api = await bossApi();
  const known = new Set(((await api.get("/research/delivered"))?.items ?? []).map((i) => i.location));
  const fresh = toFile.filter((x) => !known.has(x.location));
  if (fresh.length) { filed = (await api.post("/research/delivered", { items: fresh }))?.filed ?? 0; }

  // FIXED, not only flagged: a stale boss-os document goes to Danielle's repo lane once per staleness.
  const moved = movedReadings(readings, prev.states ?? {});
  const fixes = [];
  for (const r of moved.filter((m) => m.state === "alert" && m.fix)) {
    try {
      await api.post("/tasks", {
        title: `Bring ${r.fix.split(" ")[1]} current (Zora's archive audit)`,
        lane: "ops", employee_id: "emp_repo",
        input: { prompt: `seq23/boss-os — ${r.line} Re-verify ${r.fix.split(" ")[1]} against the code and live data it describes, update its date line, and keep its test green. Zora found this on her Friday archive audit.` },
      });
      fixes.push(`- Danielle has it: ${r.line}`);
    } catch (e) {
      fixes.push(`- Could not hand to Danielle (${String(e?.message ?? e).slice(0, 80)}): ${r.line}`);
    }
  }

  if (moved.length || filed) {
    const flagged = moved.filter((m) => m.state === "alert" && !m.fix);
    const stops = moved.filter((m) => m.state === "stop");
    const cleared = moved.filter((m) => m.state === "ok" || m.state === "cleared");
    const text = [
      "Sequoia,", "",
      `Friday archive audit: ${fixes.length + flagged.length} stale, ${filed} newly filed.`, "",
      ...(fixes.length ? ["BEING FIXED", ...fixes, ""] : []),
      ...(flagged.length ? ["STALE — FOR ITS OWNER", ...flagged.map((m) => `- ${m.line} Owner: ${m.owner ?? "unnamed"}.`), ""] : []),
      ...(filed ? [`FILED — ${filed} delivered piece(s) added to the one list (GET /api/boss/research/delivered)`, ...fresh.slice(0, 15).map((x) => `- ${x.title}: ${x.location}`), ""] : []),
      ...(cleared.length ? ["CURRENT AGAIN", ...cleared.map((m) => `- ${m.line}`), ""] : []),
      ...(stops.length ? ["I COULD NOT READ (said once)", ...stops.map((m) => `- ${m.line}`), ""] : []),
      "— Zora, Archivist",
    ].join("\n");
    if (!(await sendAs("Zora", { subject: `Archive: ${fixes.length + flagged.length} stale, ${filed} filed`, text }))) {
      console.error("NAMED STOP [NO_MAIL_SENT] the audit moved and no email could be sent; state not saved."); process.exit(8);
    }
  }
  saveState("archive-audit", { at: new Date(now).toISOString(), states: stateMap(readings) });
  console.log(`ARCHIVE-AUDIT-COMPLETE: ${moved.length} moved, ${filed} filed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`ARCHIVE-AUDIT FAILED: ${err?.message ?? err}`); process.exit(1); });
}
