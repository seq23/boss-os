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
 * before the call. Accepted slots are final. Temporary refusals back off and stay in the ledger
 * until their retry deadline. Terminal refusals and expired retries raise the Kendra alarm
 * (`mail:cloud-clock`), which the next accepted dispatch closes.
 */
import type { Env } from "../env";
import schedule from "../../../shared/boss/schedule/manifest.json";
import { CATCH_UP_MINUTES, clockRows, dueJobs, type DueJob } from "../../../shared/boss/schedule/clock.mjs";
import { raiseAlarm, clearAlarm } from "../alarms/kendra";
import { logEvent } from "../lib/log";

/** One repository on one fixed host: never read from a request. */
export const DISPATCH_URL = "https://api.github.com/repos/seq23/boss-os/dispatches";
export const CLOCK_ALARM_KEY = "mail:cloud-clock";
/** A claim older than this was a tick that died mid-call; the next tick may take the slot again. */
export const RECLAIM_MS = 4 * 60_000;
const TIMEOUT_MS = 10_000;
const MINUTE_MS = 60_000;
const TICK_MS = 5 * MINUTE_MS;

/** GitHub's primary or secondary rate limit: a wait, never a fault. Pure. */
export function rateLimited(status: number, headers: Headers, body: string): boolean {
  return (status === 403 || status === 429) &&
    (status === 429 || headers.get("x-ratelimit-remaining") === "0" ||
      headers.has("retry-after") || /rate limit/i.test(body));
}

/** How long a slot stays retryable: until the quota frees or the catch-up ends, never past 90 minutes. Pure. */
export function retryUntil(dueAt: number, freeAt: number): number {
  return Math.min(dueAt + 90 * MINUTE_MS, Math.max(dueAt + CATCH_UP_MINUTES * MINUTE_MS, freeAt));
}

function retryAfter(headers: Headers, now: number): number {
  const delay = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-remaining") === "0" ? headers.get("x-ratelimit-reset") : null;
  const hinted = delay === null ? 0 : /^\d+$/.test(delay) ? now + Number(delay) * 1000 : Date.parse(delay);
  return Math.max(now + MINUTE_MS, hinted || 0, Number(reset) * 1000 || 0);
}

type Slot = Pick<DueJob, "id" | "event" | "due_at" | "key">;
type PendingSlot = Slot & { detail: string; retry_until: number; retry_after: number };
type DispatchResult = { status: string; detail: string; retryAfter?: number };

export interface CloudClockResult {
  due: number;
  dispatched: string[];
  already: string[];
  waiting: string[];
  failed: Array<{ key: string; status: string; detail: string }>;
  stop: string | null;
  output: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function claim(env: Env, j: Slot, now: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, status, attempts)
     VALUES (?1, ?2, ?3, ?4, ?5, 'claimed', 1)
     ON CONFLICT(key) DO UPDATE SET status = 'claimed', claimed_at = excluded.claimed_at, attempts = cloud_job_dispatches.attempts + 1
      WHERE ((cloud_job_dispatches.status IN ('refused', 'no_token', 'error')
               AND (cloud_job_dispatches.retry_until IS NULL OR cloud_job_dispatches.retry_after <= ?5))
             OR (cloud_job_dispatches.status = 'claimed' AND cloud_job_dispatches.claimed_at < ?6))
        AND (cloud_job_dispatches.retry_until IS NULL OR cloud_job_dispatches.retry_until >= ?5)`,
  ).bind(j.key, j.id, j.event, j.due_at, now, now - RECLAIM_MS).run();
  return (r.meta.changes ?? 0) > 0;
}

async function dispatch(j: Slot, token: string | undefined, now: number, fetchImpl: Fetch): Promise<DispatchResult> {
  if (!token) {
    return { status: "no_token", detail: "the Worker holds no GITHUB_SEQ23_PAT, so it cannot fire the job on GitHub" };
  }
  try {
    const res = await fetchImpl(DISPATCH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "boss-os-clock",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event_type: j.event, client_payload: { key: j.key, due_at: new Date(j.due_at).toISOString() } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { status: "accepted", detail: `GitHub accepted it (${res.status})` };

    const body = await res.text().catch(() => "");
    const said = body.replace(/\s+/g, " ").slice(0, 160);
    const detail = `GitHub refused the dispatch with ${res.status}${said ? `: ${said}` : ""}`;
    if (rateLimited(res.status, res.headers, body) || res.status >= 500) {
      return { status: "refused", detail, retryAfter: retryAfter(res.headers, now) };
    }
    return { status: "refused", detail };
  } catch (err) {
    const detail = `the call to GitHub failed: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`;
    return { status: "error", detail, retryAfter: now + MINUTE_MS };
  }
}

export async function runCloudClock(env: Env, now = Date.now(), fetchImpl: Fetch = fetch): Promise<CloudClockResult> {
  const out: CloudClockResult = { due: 0, dispatched: [], already: [], waiting: [], failed: [], stop: null, output: "" };
  if (clockRows(schedule).length === 0) {
    // Rule 0: a clock with nothing to fire is a clock that silently fires nothing.
    out.stop = "NAMED STOP [CLOUD_CLOCK_NO_JOBS] the Schedule has no row with trigger.clock \"worker\"";
    out.output = `OUTPUT 0 cloud_dispatches (${out.stop})`;
    console.error(out.output);
    return out;
  }
  // Read pending rows even when a newer slot of the same job is due or the catch-up window has passed.
  const { results: pending } = await env.DB.prepare(
    `SELECT key, job AS id, event, due_at, detail, retry_until, retry_after FROM cloud_job_dispatches
     WHERE retry_after IS NOT NULL ORDER BY due_at`,
  ).all<PendingSlot>();
  const due = new Map<string, Slot>(dueJobs(schedule, now).map((j) => [j.key, j]));
  for (const j of pending) due.set(j.key, j);
  const byKey = new Map(pending.map((j) => [j.key, j]));
  out.due = due.size;
  const faults: typeof out.failed = [];

  for (const j of due.values()) {
    const previous = byKey.get(j.key);
    if (previous && previous.retry_until < now) {
      const expired = await env.DB.prepare(
        `UPDATE cloud_job_dispatches SET status = 'error', retry_after = NULL
         WHERE key = ? AND retry_until < ? AND retry_after IS NOT NULL
           AND (status <> 'claimed' OR claimed_at < ?)`,
      ).bind(j.key, now, now - RECLAIM_MS).run();
      if (expired.meta.changes) {
        faults.push({ key: j.key, status: "expired", detail: previous.detail });
      }
      continue;
    }
    if (previous && previous.retry_after > now) {
      out.waiting.push(j.key);
      continue;
    }
    if (!(await claim(env, j, now))) { out.already.push(j.key); continue; }

    const result = await dispatch(j, env.GITHUB_SEQ23_PAT, now, fetchImpl);
    // Leave two five-minute ticks after the quota frees (a tick can land seconds late), within the
    // absolute 90-minute slot cap.
    const next = result.retryAfter;
    const until = next === undefined ? null : retryUntil(j.due_at, next + 2 * TICK_MS);
    const exhausted = until !== null && now >= until;
    await env.DB.prepare(
      `UPDATE cloud_job_dispatches SET status = ?, detail = ?, dispatched_at = ?, retry_until = ?, retry_after = ?
       WHERE key = ? AND status = 'claimed' AND claimed_at = ?`,
    ).bind(result.status, result.detail.slice(0, 300), result.status === "accepted" ? now : null,
      until, exhausted ? null : next ?? null, j.key, now).run();

    if (result.status === "accepted") {
      out.dispatched.push(j.key);
    } else {
      const failure = { key: j.key, status: exhausted ? "expired" : result.status, detail: result.detail };
      out.failed.push(failure);
      if (next === undefined || exhausted) faults.push(failure);
      else out.waiting.push(j.key);
    }
  }

  if (faults.length) {
    const slot = (key: string) => {
      const [job, day, hour, minute] = key.split(":");
      return `${job} for ${day} at ${hour}:${minute} Central`;
    };
    const first = faults[0]!;
    const cause = first.status === "expired" ? `the retry window ended after ${first.detail}` : first.detail;
    const tag = faults.some((f) => f.status === "no_token") ? "CLOUD_CLOCK_NO_TOKEN" : "CLOUD_CLOCK_REFUSED";
    out.stop = `NAMED STOP [${tag}] ${first.detail}`;
    await raiseAlarm(env, {
      key: CLOCK_ALARM_KEY, kind: "owner_mail",
      text: `Boss OS's clock could not start ${faults.map((f) => slot(f.key)).join(", ")} on GitHub. ${cause}. The next accepted dispatch closes this alarm.`,
    }, now).catch((err) => console.error("cloud clock: the alarm could not be raised", err));
    await logEvent(env.DB, { level: "error", scope: "cloud_clock", event: "cloud_clock_stop", lane: "ops", detail: { stop: out.stop, failed: faults } }).catch(() => undefined);
  } else if (out.dispatched.length) {
    await clearAlarm(env, CLOCK_ALARM_KEY, "the next start on GitHub was accepted", now).catch(() => false);
  }
  out.output = `OUTPUT ${out.dispatched.length} cloud_dispatches (due ${out.due}, already started ${out.already.length}, failed ${out.failed.length}, waiting ${out.waiting.length})${out.stop ? ` ${out.stop}` : ""}`;
  if (out.due) console.log(out.output);
  return out;
}
