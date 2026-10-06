/**
 * THE WAITS HER MAC CLEARS BY ITSELF — DNS RECORDS (R27) AND DRIVE FOLDERS (R21). 6 Oct 2026.
 *
 * Copied from West Peek OS's `dnsWaits.ts` and `driveWatches.ts` and diverged: Boss OS has no
 * claimer identity of its own, so her Mac's pass (`scripts/ops/service-tick.mjs`) reads these over
 * her own session; and a DNS record is re-checked by resolving it (DNS over HTTPS), because the
 * record was already read back from Cloudflare by the repo lane when it asked for it.
 *
 * Both are SELF-CLEARING waits: she is told once, in three parts, that nothing is needed from her
 * beyond the record or the files, and the Mac says "live" / loads the files when they appear.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { driveFoldersIn } from "../../../shared/boss/service/practices.mjs";
import { noticeOnce } from "./notices";

export const DNS_WAIT_DAYS = 7;
export const DRIVE_WATCH_DAYS = 14;

export interface DnsRecordAsked { host: string; type: string; name: string; target: string; live_at?: string | null }

/** Why a reported record is not one to wait on, or null. Read back, never guessed: every field is required. */
export function dnsRecordProblem(r: Partial<DnsRecordAsked>): string | null {
  if (!r?.host || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(r.host)) return "no host";
  if (!r.type || !/^(CNAME|A|AAAA|TXT)$/i.test(r.type)) return "the record type is not CNAME, A, AAAA or TXT";
  if (!r.name || !r.target) return "the record's name or target is missing — it must be read back from Cloudflare, never guessed";
  return null;
}

/** Record each DNS wait once; returns the ids of the new ones. */
export async function recordDnsWaits(env: Env, w: { changeId: string | null; repo: string; records: readonly Partial<DnsRecordAsked>[] }): Promise<string[]> {
  const out: string[] = [];
  const now = Date.now();
  for (const r of w.records.slice(0, 5)) {
    if (dnsRecordProblem(r)) continue;
    const id = newId("dns");
    const res = await env.DB
      .prepare(
        `INSERT INTO boss_dns_wait (id, change_id, repo, host, record_type, record_name, record_target, live_at, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      )
      .bind(id, w.changeId, w.repo, r.host!.toLowerCase(), r.type!.toUpperCase(), r.name!, r.target!, r.live_at ?? null, now, now + DNS_WAIT_DAYS * 86_400_000)
      .run();
    if ((res.meta?.changes ?? 0) > 0) out.push(id);
  }
  return out;
}

/** Record the Drive folders an ask names, for a task or a repo change. Returns how many are new. */
export async function recordDriveWatches(env: Env, w: { text: string; taskId?: string | null; changeId?: string | null }): Promise<number> {
  let added = 0;
  const now = Date.now();
  for (const f of driveFoldersIn(w.text)) {
    const res = await env.DB
      .prepare(
        `INSERT INTO boss_drive_watch (id, task_id, change_id, folder_id, url, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      )
      .bind(newId("dwt"), w.taskId ?? null, w.changeId ?? null, f.id, f.url, now, now + DRIVE_WATCH_DAYS * 86_400_000)
      .run();
    added += res.meta?.changes ?? 0;
  }
  return added;
}

/**
 * WHAT HER MAC FOUND IN A WATCHED FOLDER. Empty → "still empty" is noticed ONCE. Files → their text
 * is added to the waiting task and the task runs again with no new email; a repo change re-reads its
 * package at PLAN on its own, so it is only marked loaded.
 */
export async function applyDriveWatchStatus(
  env: Env,
  id: string,
  s: { files: number; text?: string | null },
): Promise<{ state: string; resumed: string | null }> {
  const row = await env.DB.prepare(`SELECT * FROM boss_drive_watch WHERE id = ?`).bind(id).first<any>();
  if (!row) return { state: "gone", resumed: null };
  const now = Date.now();
  if (row.state !== "waiting") return { state: row.state, resumed: null };
  if (now > Number(row.expires_at)) {
    await env.DB.prepare(`UPDATE boss_drive_watch SET state = 'expired', checked_at = ? WHERE id = ?`).bind(now, id).run();
    return { state: "expired", resumed: null };
  }
  const task = row.task_id
    ? await env.DB.prepare(`SELECT id, lane, title, status, input, employee_id FROM tasks WHERE id = ?`).bind(row.task_id).first<any>()
    : null;
  if (!s.files) {
    await env.DB.prepare(`UPDATE boss_drive_watch SET checked_at = ? WHERE id = ?`).bind(now, id).run();
    if (!row.empty_told_at && task) {
      const from = task.employee_id
        ? (await env.DB.prepare(`SELECT name FROM employees WHERE id = ?`).bind(task.employee_id).first<{ name: string }>())?.name ?? "Boss OS"
        : "Boss OS";
      await noticeOnce(env, {
        task, fromName: from, kind: "drive_empty", subject: `Still empty: the Drive folder for ${String(task.title).slice(0, 100)}`,
        lines: [`The Drive folder you named for "${task.title}" has nothing in it yet: ${row.url}`],
        wait: { kind: "DRIVE_EMPTY", fill: { what: row.url } },
      });
      await env.DB.prepare(`UPDATE boss_drive_watch SET empty_told_at = ? WHERE id = ?`).bind(now, id).run();
    }
    return { state: "waiting", resumed: null };
  }
  await env.DB.prepare(`UPDATE boss_drive_watch SET state = 'loaded', loaded_at = ?, checked_at = ?, files = ? WHERE id = ?`)
    .bind(now, now, s.files, id).run();
  let input: Record<string, unknown> = {};
  try { input = task?.input ? JSON.parse(task.input) : {}; } catch { input = {}; }
  const changeId = row.change_id ?? ((input.repo_change as { change_id?: string } | undefined)?.change_id ?? null);
  if (changeId) {
    // A repo change reads its package itself at PLAN: one that stopped on the empty folder goes back to PLAN.
    await env.DB
      .prepare(`UPDATE repo_changes SET phase = 'plan', failure = NULL, claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ? WHERE id = ? AND phase = 'failed'`)
      .bind(now, changeId)
      .run();
    await env.DB
      .prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = (SELECT task_id FROM repo_changes WHERE id = ?) AND status = 'failed'`)
      .bind(changeId)
      .run();
    return { state: "loaded", resumed: changeId };
  }
  if (!task || task.status === "running" || task.status === "cancelled") return { state: "loaded", resumed: null };
  const text = String(s.text ?? "").slice(0, 40_000);
  input = { ...input, drive_files: { folder: row.url, files: s.files, text } };
  const before = typeof input.body === "string" ? input.body : "";
  input.body = `${before}${before ? "\n\n" : ""}The ${s.files} file(s) from the Drive folder you named (${row.url}) arrived:\n${text || "(no readable text in them)"}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL, input = ? WHERE id = ?`).bind(JSON.stringify(input), task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'drive_files_loaded',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ watch: id, files: s.files })),
  ]);
  await env.TASKS.send({ taskId: task.id, lane: task.lane });
  return { state: "loaded", resumed: task.id };
}
