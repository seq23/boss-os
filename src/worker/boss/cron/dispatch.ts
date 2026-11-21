/**
 * BOSS OS'S OWN CLOCK FOR ITS GITHUB JOBS (21 Nov 2026, Kendra's alarm mail:morning-email).
 *
 * GitHub's `schedule` event is best effort, and from about 2026-11-17 20:40Z it fired this account's
 * workflows once every 6-9 hours: on 21 Nov no tick of the morning email reached 06:40-09:00 Central,
 * so nothing was built or sent. The clock is now this Worker's five-minute Cloudflare cron. GitHub
 * stays the runner: each job is fired by a repository_dispatch on seq23/boss-os, at the times its
 * Schedule row's own crons say (src/shared/boss/schedule/clock.mjs, `trigger.clock: "worker"`).
 *
 * ONE DISPATCH PER SLOT. The slot's key is claimed in D1 (`cloud_job_dispatches`, migration 0370)
 * before the call; a slot already accepted is never fired again, a refused one is retried on the next
 * tick while it is still inside the catch-up window. A Worker outage costs one catch-up per job, never
 * a replay of the day; a job's own guard (the morning's sent marker) still stops a second email.
 *
 * NEVER SILENT. No token is NAMED STOP [CLOUD_CLOCK_NO_TOKEN]; GitHub refusing is NAMED STOP
 * [CLOUD_CLOCK_REFUSED] with its status. Either raises ONE Kendra alarm (`mail:cloud-clock`), which
 * the next accepted dispatch closes. Every tick logs `OUTPUT <n> cloud_dispatches`.
 */
import type { Env } from "../env";
import schedule from "../../../shared/boss/schedule/manifest.json";
import { clockRows, dueJobs, type DueJob } from "../../../shared/boss/schedule/clock.mjs";
import { raiseAlarm, clearAlarm } from "../alarms/kendra";
import { logEvent } from "../lib/log";

/** One repository on one fixed host: never read from a request. */
export const DISPATCH_URL = "https://api.github.com/repos/seq23/boss-os/dispatches";
export const CLOCK_ALARM_KEY = "mail:cloud-clock";
/** A claim older than this was a tick that died mid-call; the next tick may take the slot again. */
export const RECLAIM_MS = 4 * 60_000;
const TIMEOUT_MS = 10_000;

export interface CloudClockResult {
  due: number;
  dispatched: string[];
  already: string[];
  failed: Array<{ key: string; status: string; detail: string }>;
  stop: string | null;
  output: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function claim(env: Env, j: DueJob, now: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, status, attempts)
     VALUES (?1, ?2, ?3, ?4, ?5, 'claimed', 1)
     ON CONFLICT(key) DO UPDATE SET status = 'claimed', claimed_at = excluded.claimed_at, attempts = cloud_job_dispatches.attempts + 1
      WHERE cloud_job_dispatches.status IN ('refused', 'no_token', 'error')
         OR (cloud_job_dispatches.status = 'claimed' AND cloud_job_dispatches.claimed_at < ?6)`,
  ).bind(j.key, j.id, j.event, j.due_at, now, now - RECLAIM_MS).run();
  return (r.meta.changes ?? 0) > 0;
}

async function record(env: Env, key: string, status: string, detail: string, now: number): Promise<void> {
  await env.DB.prepare(`UPDATE cloud_job_dispatches SET status = ?, detail = ?, dispatched_at = ? WHERE key = ?`)
    .bind(status, detail.slice(0, 300), status === "accepted" ? now : null, key).run();
}

export async function runCloudClock(env: Env, now = Date.now(), fetchImpl: Fetch = fetch): Promise<CloudClockResult> {
  const out: CloudClockResult = { due: 0, dispatched: [], already: [], failed: [], stop: null, output: "" };
  if (clockRows(schedule).length === 0) {
    // Rule 0: a clock with nothing to fire is a clock that silently fires nothing.
    out.stop = "NAMED STOP [CLOUD_CLOCK_NO_JOBS] the Schedule has no row with trigger.clock \"worker\"";
    out.output = `OUTPUT 0 cloud_dispatches (${out.stop})`;
    console.error(out.output);
    return out;
  }
  const due = dueJobs(schedule, now);
  out.due = due.length;
  for (const j of due) {
    if (!(await claim(env, j, now))) { out.already.push(j.key); continue; }
    if (!env.GITHUB_SEQ23_PAT) {
      const detail = "the Worker holds no GITHUB_SEQ23_PAT, so it cannot fire the job on GitHub";
      await record(env, j.key, "no_token", detail, now);
      out.failed.push({ key: j.key, status: "no_token", detail });
      out.stop = `NAMED STOP [CLOUD_CLOCK_NO_TOKEN] ${detail}`;
      continue;
    }
    try {
      const res = await fetchImpl(DISPATCH_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.GITHUB_SEQ23_PAT}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "boss-os-clock",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event_type: j.event, client_payload: { key: j.key, due_at: new Date(j.due_at).toISOString() } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 204 || res.ok) {
        await record(env, j.key, "accepted", `GitHub accepted it (${res.status})`, now);
        out.dispatched.push(j.key);
      } else {
        const said = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        const detail = `GitHub refused the dispatch with ${res.status}${said ? `: ${said}` : ""}`;
        await record(env, j.key, "refused", detail, now);
        out.failed.push({ key: j.key, status: "refused", detail });
        out.stop = `NAMED STOP [CLOUD_CLOCK_REFUSED] ${detail}`;
      }
    } catch (err) {
      const detail = `the call to GitHub failed: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`;
      await record(env, j.key, "error", detail, now);
      out.failed.push({ key: j.key, status: "error", detail });
      out.stop = `NAMED STOP [CLOUD_CLOCK_REFUSED] ${detail}`;
    }
  }
  if (out.stop) {
    const jobs = [...new Set(out.failed.map((f) => f.key.split(":")[0]))].join(", ");
    await raiseAlarm(env, {
      key: CLOCK_ALARM_KEY, kind: "owner_mail",
      text: `Boss OS's clock could not start ${jobs} on GitHub: ${out.failed[0]?.detail ?? out.stop}. The jobs did not run at their time; it tries again every five minutes for half an hour, and the next start that works closes this.`,
    }, now).catch((err) => console.error("cloud clock: the alarm could not be raised", err));
    await logEvent(env.DB, { level: "error", scope: "cloud_clock", event: "cloud_clock_stop", lane: "ops", detail: { stop: out.stop, failed: out.failed } }).catch(() => undefined);
  } else if (out.dispatched.length) {
    await clearAlarm(env, CLOCK_ALARM_KEY, "the next start on GitHub was accepted", now).catch(() => false);
  }
  out.output = `OUTPUT ${out.dispatched.length} cloud_dispatches (due ${out.due}, already started ${out.already.length}, failed ${out.failed.length})${out.stop ? ` ${out.stop}` : ""}`;
  if (out.due) console.log(out.output);
  return out;
}
