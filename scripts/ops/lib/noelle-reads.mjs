/**
 * NOELLE'S READ (gap review B2, G12, G14; HOW IT BREAKS "Outage"). Everything the Mac reads for her before
 * she thinks: the weekly sources (READ_SOURCES in src/shared/boss/growth/noelle.mjs) and the calendar,
 * business × channel, from every ledger that holds one.
 *
 * ONE SHAPE, AND A FAILED READ IS NEVER A ZERO. A source read is { at, sha, rows, file } or { error };
 * a queue is a count, or its key goes to `unread` with the reason. "0 scheduled" is only ever written
 * when a ledger answered with zero, so a ledger that is down can never look empty and be filled twice.
 *
 * Every reader takes its I/O as arguments (gh, fetch, d1, fs) so each outage is a test
 * (tests/noelleMac.test.ts). Counts and dates only: no customer, client or LP text is read here.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHANNEL_OWNERS, READ_SOURCES } from "../../../src/shared/boss/growth/noelle.mjs";

export const OWNER = "seq23";

/** Each roster business's repos (the search-loop week and its jobs). */
export const REPOS = Object.freeze({
  "porch-and-party": ["p-n-p"],
  approvalprep: ["approvalprep"],
  "dream-wedding": ["dream-wedding-builder"],
  "a-player-mode": ["sprylabs-hpc-site"],
  keepmyproof: ["keepmyproof"],
  "peace-be-still": ["peace-be-still"],
  "industry-guides": ["local-guides-generator", "local-guides-citation-velocity"],
  "wpp-llm": ["WPP-llm"],
  hicks: ["hicks-consulting-canonical"],
  horse: ["horse-legal-guide-velocity"],
});

/**
 * Sources that are a scheduled GitHub job: the newest successful run is the read (its head sha is the
 * evidence a decision cites). Several repos → the newest across them, rows = how many answered.
 */
export const WORKFLOW_SOURCES = Object.freeze({
  "spry-weekly-summary": [["approvalprep", "spry-weekly-summary.yml"], ["dream-wedding-builder", "spry-weekly-summary.yml"], ["keepmyproof", "spry-weekly-summary.yml"], ["sprylabs-hpc-site", "spry-weekly-summary.yml"], ["peace-be-still", "spry-weekly-summary.yml"]],
  "aplayer-mode-weekly-outcome-report": [["aplayer-mode", "weekly-outcome-report.yml"]],
  "ap-email-nurture": [["approvalprep", "email-nurture.yml"]],
  "dw-email-health": [["dream-wedding-builder", "email-health.yml"]],
  "keepmyproof-monthly-watch": [["keepmyproof", "monthly-watch.yml"]],
  "wpp-llm-query-intelligence": [["WPP-llm", "query-intelligence.yml"]],
  "entity-backlink-watch": [["p-n-p", "entity-backlink-watch.yml"], ["approvalprep", "entity-backlink-watch.yml"], ["dream-wedding-builder", "entity-backlink-watch.yml"], ["keepmyproof", "entity-backlink-watch.yml"], ["sprylabs-hpc-site", "entity-backlink-watch.yml"]],
});

/** Sources that are a file her Mac's own jobs write. */
export const FILE_SOURCES = Object.freeze({
  grid: { path: "~/.boss-os/search-readiness/latest.json", rows: (j) => (Array.isArray(j?.sites) ? j.sites.length : Object.keys(j?.sites ?? {}).length) },
  "fixes-live": { path: "~/.boss-os/search-readiness/fix-status.json", rows: (j) => (Array.isArray(j) ? j.length : Object.keys(j?.briefs ?? j ?? {}).length) },
  "pnp-photo-ask": { path: "~/Library/Logs/boss-pnp-photos/launchd.log", rows: null },
});

/** Sources read live through the Scorecard's own readers (scripts/ops/lib/scorecard-readers.mjs). */
export function metricSources(today) {
  const [y, m] = today.split("-").map(Number);
  // "This season" for P&P: Christmas from 1 Oct, the January takedown from 15 Dec, spring from 1 Mar.
  const seasonStart = m >= 10 ? `${y}-10-01` : m <= 2 ? `${y - 1}-12-15` : `${y}-03-01`;
  return {
    "pnp-season-bookings": { reader: "d1", params: { db: "pnp-admin", sql: `SELECT COUNT(*) AS n FROM requests WHERE is_test = 0 AND datetime(submitted_at) >= datetime('${seasonStart}')` } },
    "pbs-waitlist": { reader: "d1", params: { db: "peace-be-still", sql: "SELECT COUNT(*) AS n FROM waitlist" } },
    kdp: { reader: "kdp-units", params: { days: 30, maxAgeDays: 9 } },
    "guide-leads": { reader: "airtable", params: { key: "AIRTABLE_LKG_LEADS_TOKEN", base: "appDgpv4F5ORCtUU3", table: "Lead Requests", days: 28 } },
  };
}

/** Sources with no reader on this Mac yet: an honest NOT READ with what would read it, never a pass. */
export const NO_READER = Object.freeze({
  "app-store": "no reader yet: the App Store Connect and Play Console ratings need a builder PR (G21)",
  "guide-pinterest-rss": "no reader yet: the guide sites' Pinterest RSS feeds are not counted anywhere",
  "pnp-gbp-post": "no reader yet: the Google Business Profile post log is not kept by any job",
  "pnp-valerie-texts": "no reader yet: Valerie's texts are sent by hand and logged nowhere a job can read",
  "link-prospects": "no reader yet: duty_link_prospects keeps its rows in the Worker, not in Noelle's context",
});

const expand = (p) => p.replace(/^~(?=\/)/, homedir());

/** A file a Mac job writes: its time, its sha-256 and its row count. */
export function readFile(id, { exists = existsSync, read = readFileSync, stat = statSync } = {}) {
  const spec = FILE_SOURCES[id];
  const path = expand(spec.path);
  try {
    if (!exists(path)) return { error: `${spec.path} is not on this Mac` };
    const bytes = read(path);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const at = new Date(stat(path).mtimeMs).toISOString();
    if (!spec.rows) return { at, sha, rows: String(bytes).trim() ? 1 : 0, file: spec.path };
    return { at, sha, rows: spec.rows(JSON.parse(String(bytes))), file: spec.path };
  } catch (e) {
    return { error: `${spec.path}: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}

/** The newest successful run of each workflow (gh api, GET only). */
export function readWorkflow(id, { gh }) {
  const found = [];
  const errors = [];
  for (const [repo, file] of WORKFLOW_SOURCES[id]) {
    try {
      const j = JSON.parse(gh(["api", `repos/${OWNER}/${repo}/actions/workflows/${file}/runs?status=success&per_page=1`]));
      const r = j?.workflow_runs?.[0];
      if (r) found.push({ at: r.updated_at, sha: r.head_sha, file: `${repo}/.github/workflows/${file}` });
      else errors.push(`${repo}: no successful run`);
    } catch (e) {
      errors.push(`${repo}: ${String(e?.message ?? e).split("\n")[0].slice(0, 80)}`);
    }
  }
  if (!found.length) return { error: errors.join("; ") || "no run" };
  const newest = found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return { ...newest, rows: found.length, ...(errors.length ? { note: errors.join("; ") } : {}) };
}

/** One live count through the Scorecard's readers: a number read now, even 0, is one row read. */
export async function readCount(id, spec, { readMetric, ctx, now }) {
  const r = await readMetric(spec, ctx);
  if (r.error || r.raw == null) return { error: r.error ?? "no number" };
  return { at: new Date(now).toISOString(), sha: null, rows: 1, value: Number(r.raw), file: `${spec.reader}:${spec.params?.db ?? spec.params?.table ?? id}` };
}

// ─── The calendar: business × channel, scheduled from now on ───────────────────

/** Buffer keys → the business whose channels they hold (accounts map, buffer-* rows). P&P's Buffer is
 * the Studio's own pipe and is read from the Studio, so it is never counted twice. */
export const BUFFERS = Object.freeze({
  BUFFER_PEACEBESTILL_ACCESS_TOKEN: "peace-be-still",
  BUFFER_APPROVALPREP_ACCESS_TOKEN: "approvalprep",
  BUFFER_BRANDS_ACCESS_TOKEN: "dream-wedding",
});
const SERVICE = { facebook: "facebook-page", instagram: "instagram", threads: "threads", tiktok: "tiktok", pinterest: "pinterest" };

/** Scheduled Buffer posts for one key: { counts: {channel: n}, days: {channel: [YYYY-MM-DD]} } or { error }. */
export async function readBuffer(token, { fetchImpl, now }) {
  if (!token) return { error: "its Buffer key is not in the vault run" };
  const q = async (query, variables) => {
    const r = await fetchImpl("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Buffer answered ${r.status}`);
    const j = await r.json();
    if (j?.errors?.length) throw new Error(`Buffer: ${String(j.errors[0]?.message ?? "error").slice(0, 80)}`);
    return j.data;
  };
  try {
    const orgs = (await q("{ account { organizations { id } } }"))?.account?.organizations ?? [];
    if (!orgs.length) return { error: "Buffer shows no organization" };
    const counts = {}, days = {};
    for (const o of orgs) {
      const d = await q("query($id: OrganizationId!) { posts(input: { organizationId: $id, filter: { status: [scheduled] } }, first: 100) { edges { node { dueAt channelService } } } }", { id: o.id });
      for (const { node } of d?.posts?.edges ?? []) {
        const ch = SERVICE[node.channelService];
        if (!ch || Date.parse(node.dueAt) < now) continue;
        counts[ch] = (counts[ch] ?? 0) + 1;
        (days[ch] ??= []).push(centralDay(Date.parse(node.dueAt)));
      }
    }
    return { counts, days };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 120) };
  }
}

/** A Pinterest drip queue file (variants with a release_date still to come), read from the default branch. */
export const PIN_QUEUES = Object.freeze({
  "dream-wedding:pinterest": ["dream-wedding-builder", "data/pinterest/queue.json"],
  "a-player-mode:pinterest": ["sprylabs-hpc-site", "aplayermode/data/pinterest/queue.json"],
  "approvalprep:pinterest": ["approvalprep", "data/pinterest/queue.json"],
});
export function readPinQueue(key, { gh, today }) {
  const [repo, path] = PIN_QUEUES[key];
  try {
    const j = JSON.parse(gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${OWNER}/${repo}/contents/${path}`]));
    const variants = Array.isArray(j?.variants) ? j.variants : null;
    if (!variants) return { error: `${repo}/${path} has no variants list` };
    const ahead = variants.filter((v) => typeof v?.release_date === "string" && v.release_date > today);
    return { count: ahead.length, days: [...new Set(ahead.map((v) => v.release_date.slice(0, 10)))] };
  } catch (e) {
    return { error: `${repo}/${path}: ${String(e?.message ?? e).split("\n")[0].slice(0, 80)}` };
  }
}

/** P&P Studio's own calendar (D1 social_posts, scheduled from now on), by platform. */
export async function readStudio({ d1, now }) {
  try {
    const rows = await d1(`SELECT platform, substr(scheduled_at, 1, 10) AS day, COUNT(*) AS n FROM social_posts WHERE status IN ('scheduled','waiting') AND scheduled_at >= '${new Date(now).toISOString()}' GROUP BY platform, day`);
    if (!Array.isArray(rows)) return { error: "the Studio answered with no rows list" };
    const counts = {}, days = {};
    for (const r of rows) {
      const ch = SERVICE[r.platform];
      if (!ch) continue;
      counts[ch] = (counts[ch] ?? 0) + Number(r.n);
      (days[ch] ??= []).push(r.day);
    }
    return { counts, days };
  } catch (e) {
    return { error: `the Studio's calendar: ${String(e?.message ?? e).split("\n")[0].slice(0, 100)}` };
  }
}

/** The Central day of a UTC instant. */
export function centralDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * The calendar: { queues: {"biz:channel": n}, days: {"biz:channel": [day]}, unread: {"biz:channel": why} }.
 * Every owned channel ends in exactly one of queues or unread.
 */
export async function readCalendar({ env, fetchImpl, gh, d1, now, today }) {
  const queues = {}, days = {}, unread = {};
  const studio = await readStudio({ d1, now });
  for (const ch of ["instagram", "tiktok", "facebook-page"]) {
    const key = `porch-and-party:${ch}`;
    if (studio.error) unread[key] = studio.error;
    else { queues[key] = studio.counts[ch] ?? 0; days[key] = [...new Set(studio.days[ch] ?? [])].sort(); }
  }
  for (const [tokenName, biz] of Object.entries(BUFFERS)) {
    const b = await readBuffer(env[tokenName], { fetchImpl, now });
    for (const key of Object.keys(CHANNEL_OWNERS).filter((k) => k.startsWith(`${biz}:`) && !PIN_QUEUES[k])) {
      const ch = key.slice(biz.length + 1);
      if (b.error) unread[key] = b.error;
      else { queues[key] = b.counts[ch] ?? 0; days[key] = [...new Set(b.days[ch] ?? [])].sort(); }
    }
  }
  for (const key of Object.keys(PIN_QUEUES)) {
    const p = readPinQueue(key, { gh, today });
    if (p.error) unread[key] = p.error;
    else { queues[key] = p.count; days[key] = p.days.sort(); }
  }
  for (const key of Object.keys(CHANNEL_OWNERS)) if (!(key in queues) && !(key in unread)) unread[key] = "no ledger read for this channel yet (its job keeps no readable queue)";
  return { queues, days, unread };
}

// ─── Everything ─────────────────────────────────────────────────────────────────

/**
 * The whole read. `context` is the Worker's (ai-misses, scorecard summaries, linked to-dos). Returns
 * { reads: {sourceId: read}, calendar }. Every READ_SOURCES id gets an entry.
 */
export async function collectReads({ context, env, fetchImpl, gh, d1, readMetric, metricCtx, fetchLoopWeeks, now, fileIo = {} }) {
  const today = context.today;
  const reads = {};
  const nowIso = new Date(now).toISOString();
  // search-loop week: every roster business's repos.
  {
    const weeks = [];
    const errors = [];
    for (const repo of [...new Set(Object.values(REPOS).flat())]) {
      const r = fetchLoopWeeks(repo, { run: gh, now });
      if (r.problem) errors.push(`${repo}: ${r.problem}`);
      else weeks.push(...r.weeks);
    }
    const newest = weeks.map((w) => w.generated_at ?? w.at).filter(Boolean).sort().pop();
    reads["search-loop-week"] = weeks.length ? { at: newest ?? nowIso, sha: null, rows: weeks.length, file: "search-loop-week artifacts", ...(errors.length ? { note: errors.join("; ").slice(0, 300) } : {}) } : { error: errors.join("; ") || "no search-loop week anywhere" };
  }
  for (const id of Object.keys(FILE_SOURCES)) reads[id] = readFile(id, fileIo);
  for (const id of Object.keys(WORKFLOW_SOURCES)) reads[id] = readWorkflow(id, { gh });
  for (const [id, spec] of Object.entries(metricSources(today))) reads[id] = await readCount(id, spec, { readMetric, ctx: metricCtx, now });
  // The Worker's own tables, read just now through /noelle/context.
  reads["ai-misses"] = Array.isArray(context.aiMisses) ? { at: nowIso, sha: null, rows: context.aiMisses.length, file: "ai_misses" } : { error: "the context carried no AI-answer misses" };
  reads.scorecard = Array.isArray(context.summaries) ? { at: nowIso, sha: null, rows: context.summaries.length, file: "scorecard readings" } : { error: "the context carried no scorecard" };
  reads["linked-todos"] = Array.isArray(context.linkedOpen) ? { at: nowIso, sha: null, rows: context.linkedOpen.length, file: "owner_open_loops" } : { error: "the context carried no linked rows" };
  for (const [id, why] of Object.entries(NO_READER)) reads[id] = { error: why };
  const calendar = await readCalendar({ env, fetchImpl, gh, d1, now, today });
  const readKeys = Object.keys(calendar.queues).length;
  reads.calendar = readKeys ? { at: nowIso, sha: null, rows: readKeys, file: "Studio social_posts, Buffer, Pinterest queues", ...(Object.keys(calendar.unread).length ? { note: `${Object.keys(calendar.unread).length} channels not read` } : {}) } : { error: "no calendar ledger answered" };
  for (const s of READ_SOURCES) if (!reads[s.id]) reads[s.id] = { error: "no reader" };
  return { reads, calendar };
}

/**
 * The photo shelf she may choose from: real job photos first (A3), then the existing AI shots, each as
 * the path under its folder (the AI folder has subfolders: "ai:porch/x.jpg"). A folder that cannot be
 * read is { error }, never an empty shelf she would plan around.
 */
export function photoShelf({ sources, list = (d) => readdirSync(d, { recursive: true }) }) {
  const out = {};
  for (const [kind, dir] of Object.entries(sources)) {
    try {
      out[kind] = list(expand(dir)).map(String).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.split("/").some((x) => x.startsWith("."))).sort();
    } catch (e) {
      out[kind] = { error: `${dir}: ${String(e?.code ?? e?.message ?? e).slice(0, 60)}` };
    }
  }
  return out;
}
