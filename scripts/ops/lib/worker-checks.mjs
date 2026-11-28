import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CENTRAL, dayOf, instantAt, wallClock } from "../../../src/shared/boss/schedule/clock.mjs";
import { slotTimes } from "./schedule.mjs";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dueOn(slots, day) {
  if (!slots?.length) return null;
  const [y, m, d] = day.split("-").map(Number);
  const { dow } = wallClock(instantAt(CENTRAL, y, m, d, 12));
  return slots.some((slot) => {
    if (/^(always|every |hourly )/.test(slot)) return true;
    const [days] = slot.split(" ");
    if (days.startsWith("day")) return days.split(",").includes(`day${d}`);
    return slotTimes(slot).some((time) => time.day === DAYS[dow]);
  });
}

function readCount(spec, duty, evidence) {
  if (spec.count === "duty-input") return evidence.duties ? evidence.duties[duty]?.source ?? 0 : null;
  if (spec.count === "duty-handled") return evidence.duties ? evidence.duties[duty]?.handled ?? 0 : null;
  if (spec.count === "sites") return evidence.siteAudit?.source ?? null;
  if (spec.count === "site-audit") return evidence.siteAudit?.handled ?? null;
  if (spec.count === "properties") return evidence.propertyCount ?? null;
  if (spec.count === "mail-listed" || spec.count === "mail-handled") {
    const day = evidence.mailCounts?.[spec.state];
    if (!day) return null;
    // A mailbox that went unread that day cannot vouch for its handled count.
    if (spec.count === "mail-handled") return day.unread?.length ? null : day.handled;
    return day.source;
  }
  if (spec.count === "property-read") {
    if (!evidence.properties) return null;
    const result = evidence.properties[spec.reader];
    return result && result.handled < result.source ? null : result?.handled ?? 0;
  }
  return null;
}

/**
 * Toni's listed and handled message counts for `day`, read from each job's own state file (toni-mail.mjs
 * `mailCounts`), keyed by the state name the manifest gives (`"count": "mail-listed", "state": "risk-watch"`).
 * A state file that is missing, unreadable or has no entry for that day gives no counts, so the row reads
 * "couldn't check", never 0.
 */
export async function readMailCounts(day, schedule, env = process.env) {
  if (!day) return null;
  const states = [...new Set(Object.values(schedule?.workerJobs ?? {}).flatMap((job) => [job.source, job.handled])
    .filter((spec) => /^mail-(?:listed|handled)$/.test(spec?.count ?? "") && /^[a-z-]+$/.test(spec.state ?? "")).map((spec) => spec.state))];
  const dir = env.BOSS_OS_STATE_DIR ?? join(homedir(), ".boss-os", "duties");
  const read = await Promise.all(states.map(async (state) => {
    try {
      const counts = JSON.parse(await readFile(join(dir, `${state}.json`), "utf8"))?.counts?.[day];
      return Number.isSafeInteger(counts?.source) && Number.isSafeInteger(counts?.handled) && Array.isArray(counts.unread ?? [])
        ? [state, { source: counts.source, handled: counts.handled, unread: counts.unread ?? [] }] : null;
    } catch { return null; }
  }));
  return Object.fromEntries(read.filter(Boolean));
}

/** Compare the current audit's target list with the saved sites that reached a verdict. */
export async function readSiteAudit(day, sites, env) {
  if (!day || !Array.isArray(sites?.grid_repos) || !sites.grid_repos.length) return null;
  const domains = new Set(sites.grid_repos.map(({ domain }) => domain));
  const dir = env.SEARCH_READINESS_DIR ?? join(homedir(), ".boss-os", "search-readiness");
  const nextUtcDay = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);
  const read = await Promise.all([day, nextUtcDay].map(async (fileDay) => {
    try {
      const report = JSON.parse(await readFile(join(dir, `results-${fileDay}.json`), "utf8"));
      return Number.isFinite(Date.parse(report.at)) && dayOf(report.at) === day && Array.isArray(report.sites) ? report : null;
    } catch { return null; }
  }));
  const report = read.filter(Boolean).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const handled = report && new Set(report.sites.filter((site) => domains.has(site.site?.domain)
    && site.results?.some((reading) => ["pass", "fail"].includes(reading.status))).map((site) => site.site.domain)).size;
  return { source: domains.size, handled: handled ?? null };
}

function check(job, schedule, id, evidence, launchd) {
  const day = evidence?.day;
  const trigger = schedule?.trigger ?? {};
  const noReading = () => ({ state: "unknown", evidence: "Couldn't check: today's count sources were unavailable." });
  if (!day) return noReading();
  const receipt = evidence.workflows?.[schedule?.id] ?? evidence.runs?.[trigger.duty] ?? evidence.worker?.[id];
  const due = dueOn(schedule?.slots, day);
  const onDay = (label) => launchd.activity?.[label]?.has(day);
  if (job.kind === "plumbing") {
    if (receipt?.source > 0) return receipt.handled > 0
      ? { state: "verified", evidence: `${day}: a successful run was recorded.` }
      : { state: "missing", evidence: `${day}: runs were recorded, but none finished successfully.` };
    if ((job.label ? [job.label] : trigger.launchd ?? []).some(onDay)) {
      return { state: "verified", evidence: `${day}: the job wrote to its dedicated launchd log.` };
    }
    if (due === false) return { state: "nothing_due", evidence: `${day}: no run was scheduled.` };
    if (due && (trigger.clock === "worker" && evidence.workflows || trigger.duty && evidence.runs || receipt)) {
      return { state: "missing", evidence: `${day}: a run was due, but its run ledger has no receipt.` };
    }
    return { state: "unknown", evidence: `${day}: couldn't check for a dated run receipt.` };
  }

  const source = readCount(job.source, trigger.duty, evidence);
  const handled = readCount(job.handled, trigger.duty, evidence);
  if (due === false && !receipt?.source && !handled) return { state: "nothing_due", evidence: `${day}: no run was scheduled.` };
  if (!Number.isSafeInteger(source) || !Number.isSafeInteger(handled) || source < 0 || handled < 0) {
    const absent = [
      source === null && (job.source.evidence ?? "the source count"),
      handled === null && (job.handled.evidence ?? "the handled count"),
    ].filter(Boolean);
    return { state: "unknown", evidence: `${day}: couldn't check ${absent.join(" or ") || "the source and handled counts"}.` };
  }
  if (handled < source) return { state: "missing", evidence: `${day}: handled ${handled} of ${source} source items.` };
  // A mail count of zero is a reading (the mailboxes were listed and held nothing); a duty input of zero is not.
  if (source === 0 && due && job.source.count !== "mail-listed") return { state: "unknown", evidence: `${day}: couldn't check coverage; a duty was due, but no input task was filed.` };
  return source === 0
    ? { state: "nothing_due", evidence: `${day}: the source had no items to handle.` }
    : { state: "verified", evidence: `${day}: handled ${handled} of ${source} source items.` };
}

/** Reuse Simone's report row states and evidence so the existing alert path handles misses. */
export function workerChecks(schedule, inputs, launchd) {
  const schedules = new Map(schedule.rows.map((r) => [r.id, r]));
  const duties = new Map(inputs.duties.map((d) => [d.id, d]));
  return Object.entries(schedule.workerJobs ?? {}).flatMap(([id, job]) => {
    if (job.oneShot || job.source?.count === "existing") return [];
    const row = schedules.get(job.schedule ?? id);
    const trigger = row?.trigger ?? {};
    const label = job.label ?? trigger.launchd?.[0];
    const paused = duties.get(trigger.duty)?.paused || (label && launchd.disabled?.has(label));
    return [{
      kind: "schedule",
      id: `worker-check:${id}`,
      name: `${job.owner} · ${row?.name ?? job.call ?? label ?? id}`,
      aim: job.kind === "plumbing" ? "Confirm a scheduled run." : "Compare source items with handled items.",
      coverage: paused ? "paused" : "listed",
      ...(paused ? { state: "nothing_due", evidence: "The job is paused." } : check(job, row, id, inputs.workerEvidence, launchd)),
    }];
  });
}
