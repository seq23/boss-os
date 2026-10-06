/**
 * SECRETS BY EMAIL, HANDS OFF — THE WORKER HALF (R3, R4; 6 Oct 2026).
 *
 * A COPY of West Peek OS's `services/secretHandoff.ts`, never an import. She writes
 * `SECRET RUNWARE_API_KEY=abc123` on its own line in an email to boss@ from one of her own
 * DMARC-verified addresses (the same gate every instruction passes). This file is all of what
 * happens to the value:
 *
 *   1 · the name is checked (`secretNameProblem`): vendor-prefixed, never a reserved name;
 *   2 · the value is encrypted (AES-256-GCM under BOSS_OS_SECRET_HANDOFF_KEY, a Worker secret set from
 *       the vault) into `boss_secret_handoff` with a TTL — never into `boss_inbound_mail`, a task, a
 *       notice, a log line or the reply;
 *   3 · the raw message is scrubbed BEFORE it is written to R2 and before any door reads it
 *       (`scrubSecretValues`), so nothing downstream can copy the value anywhere;
 *   4 · her Mac's pass (`scripts/ops/service-tick.mjs`) collects pending rows over her own session,
 *       writes each into the vault through `vault.mjs set NAME` on stdin, and says so — the row is
 *       deleted;
 *   5 · every task or repo change that waited for that NAME resumes (`resumeForSecret`) — no second
 *       ask, no new task.
 *
 * FAIL CLOSED: no key configured → nothing is stored, the reply names why, and the value is still
 * scrubbed from everything the Worker kept.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import {
  readSecretLines, scrubSecretValues, nothingButSecrets, secretDoorLine, SECRET_HANDOFF_KEY_NAME,
} from "../../../shared/boss/service/secretLines.mjs";
import { registeredRepoIn, repoIn } from "../../../shared/boss/repoChange/lane.mjs";

/** How long an uncollected value may wait for her Mac. */
export const SECRET_HANDOFF_TTL_MS = 7 * 24 * 3600_000;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function cipherKey(env: Env): Promise<CryptoKey | null> {
  const raw = env.BOSS_OS_SECRET_HANDOFF_KEY;
  if (!raw) return null;
  let bytes: Uint8Array;
  try { bytes = unb64(raw.trim()); } catch { return null; }
  if (bytes.byteLength !== 32) return null;
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function secretDoorConfigured(env: Env): Promise<boolean> {
  return (await cipherKey(env)) !== null;
}

export async function encryptSecret(env: Env, value: string): Promise<{ ciphertext: string; iv: string } | null> {
  const key = await cipherKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(value));
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

export async function decryptSecret(env: Env, row: { ciphertext: string; iv: string }): Promise<string | null> {
  const key = await cipherKey(env);
  if (!key) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv) as BufferSource }, key, unb64(row.ciphertext) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export interface SecretDoorOutcome {
  /** The raw MIME with every value scrubbed — what every door downstream must read instead. */
  raw: string;
  stored: Array<{ name: string; repo: string | null }>;
  refused: Array<{ name: string; why: string }>;
  /** True when the written part was nothing but SECRET lines and a greeting: no task is opened. */
  onlySecrets: boolean;
  /** Names of tasks/changes that resumed because a key they waited for arrived. */
  resumed: string[];
  /** The line her reply carries, or null when the message had no SECRET line. */
  line: string | null;
}

/**
 * RUN THE DOOR on an authorised message, BEFORE it is stored or read by anything else. `readable` is
 * the decoded text (the caller decodes once); the returned `raw` is what the caller must keep.
 */
export async function secretDoor(
  env: Env,
  input: { raw: string; readable: string; subject: string; sender: string; mailId: string },
): Promise<SecretDoorOutcome> {
  const read = readSecretLines(input.readable);
  if (!read.found.length && !read.refused.length) {
    return { raw: input.raw, stored: [], refused: [], onlySecrets: false, resumed: [], line: null };
  }
  const raw = scrubSecretValues(input.raw, read.values);
  const repo = repoIn(`${input.subject}\n${read.scrubbed}`) ?? registeredRepoIn(`${input.subject}\n${read.scrubbed}`)?.repo ?? null;
  const configured = await secretDoorConfigured(env);
  const stored: SecretDoorOutcome["stored"] = [];
  const refused: SecretDoorOutcome["refused"] = [...read.refused];
  const now = Date.now();
  for (const f of read.found) {
    if (!configured) {
      refused.push({ name: f.name, why: `the secret door is not configured on the Worker (${SECRET_HANDOFF_KEY_NAME} is unset); nothing was kept` });
      continue;
    }
    const enc = await encryptSecret(env, f.value);
    if (!enc) { refused.push({ name: f.name, why: "the value could not be encrypted; nothing was kept" }); continue; }
    const id = newId("shk");
    await env.DB
      .prepare(
        `INSERT INTO boss_secret_handoff (id, name, repo, ciphertext, iv, requested_by, mail_id, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(id, f.name, repo, enc.ciphertext, enc.iv, input.sender.toLowerCase(), input.mailId, now, now + SECRET_HANDOFF_TTL_MS)
      .run();
    stored.push({ name: f.name, repo });
    await audit(env.DB, { actor: "boss", lane: "ops", entityType: "secret_handoff", entityId: id, action: "stored", detail: { name: f.name, repo } });
  }
  for (const r of refused) {
    await logEvent(env.DB, { level: "warn", scope: "intake", event: "secret_handoff_refused", lane: "ops", entityId: input.mailId, detail: { name: r.name, why: r.why } });
  }
  const resumed: string[] = [];
  for (const s of stored) resumed.push(...(await resumeForSecret(env, s.name)));
  const line = `${secretDoorLine(stored, refused)}${resumed.length ? ` ${resumed.length} piece${resumed.length === 1 ? "" : "s"} of work that waited for it ${resumed.length === 1 ? "is" : "are"} running again now.` : ""}`;
  return { raw, stored, refused, onlySecrets: nothingButSecrets(read.scrubbed), resumed, line };
}

/** Record that a task or a repo change waits for a key, by NAME. Idempotent per (name, task, change). */
export async function recordSecretWait(env: Env, w: { name: string; taskId?: string | null; changeId?: string | null }): Promise<boolean> {
  const out = await env.DB
    .prepare(
      `INSERT INTO boss_secret_wait (id, secret_name, task_id, change_id, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(newId("swt"), w.name, w.taskId ?? null, w.changeId ?? null, Date.now())
    .run();
  return (out.meta?.changes ?? 0) > 0;
}

/**
 * R4 — THE KEY ARRIVED: every open wait for it resumes. A task is requeued; a repo change that
 * stopped is sent back to PLAN (its next run finds the key in the vault); a change still moving
 * simply picks it up on its next phase. Returns the ids resumed.
 */
export async function resumeForSecret(env: Env, name: string): Promise<string[]> {
  const rows = await env.DB
    .prepare(`SELECT id, task_id, change_id FROM boss_secret_wait WHERE secret_name = ? AND resumed_at IS NULL LIMIT 20`)
    .bind(name)
    .all<{ id: string; task_id: string | null; change_id: string | null }>();
  const out: string[] = [];
  const now = Date.now();
  for (const r of rows.results ?? []) {
    if (r.change_id) {
      await env.DB
        .prepare(
          `UPDATE repo_changes SET phase = CASE WHEN phase = 'failed' THEN 'plan' ELSE phase END, failure = NULL,
                  claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ? WHERE id = ?`,
        )
        .bind(now, r.change_id)
        .run();
    await env.DB
      .prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = (SELECT task_id FROM repo_changes WHERE id = ?) AND status = 'failed'`)
      .bind(r.change_id)
      .run();
      out.push(r.change_id);
    }
    if (r.task_id) {
      const task = await env.DB.prepare(`SELECT id, lane, status FROM tasks WHERE id = ?`).bind(r.task_id).first<{ id: string; lane: string; status: string }>();
      if (task && task.status !== "running") {
        await env.DB.batch([
          env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(task.id),
          env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'resumed_for_secret',?)`)
            .bind(newId("tev"), task.id, now, JSON.stringify({ name })),
        ]);
        await env.TASKS.send({ taskId: task.id, lane: task.lane });
        out.push(task.id);
      }
    }
    await env.DB.prepare(`UPDATE boss_secret_wait SET resumed_at = ? WHERE id = ?`).bind(now, r.id).run();
  }
  return out;
}

/** Expired hand-offs are deleted before anything is read: a value nobody collected does not sit forever. */
export async function expireSecretHandoffs(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM boss_secret_handoff WHERE expires_at < ?`).bind(Date.now()).run();
}
