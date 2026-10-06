/**
 * WHAT HAPPENS AFTER ANY EMPLOYEE'S RESULT, WHOEVER RAN IT (R6, R14, R15, R23 — 6 Oct 2026).
 *
 * One function, called from both places a task's result lands: the queue consumer (cloud rungs) and
 * the backend-run report (her Mac's seats). "Two components each keeping their own list" is this
 * repository's most-named defect; this is the one list.
 *
 *   · `Deferred to YYYY-MM-DD: <ask>` lines → a dated task each (`deferFromResult`);
 *   · `Missing key: VENDOR_NAME` lines → a wait on that key, and ONE notice naming it with the
 *     SECRET line that sends it. Her Mac looks in the vault before that notice goes (R5,
 *     `scripts/ops/task-notices.mjs`): a key the vault already holds resumes the work instead;
 *   · a task she sent by email that finished → the result comes back to her by email, done-lines
 *     and all, with the token that lets her reply to it.
 *
 * Never throws: the result is already recorded, and a follow-up that failed is logged, not lost.
 */
import type { Env } from "../env";
import { logEvent } from "../lib/log";
import { missingKeysIn } from "../../../shared/boss/service/practices.mjs";
import { deferFromResult } from "./deferred";
import { recordSecretWait } from "./secretHandoff";
import { noticeOnce } from "./notices";

export interface ResultTask {
  id: string;
  lane: string;
  title: string;
  employee_id: string | null;
  input: Record<string, unknown>;
  attempts?: number | null;
}

export async function afterResult(env: Env, task: ResultTask, text: string, o: { done: boolean; fromName: string }): Promise<{ deferred: string[]; missing: string[]; told: boolean }> {
  const out = { deferred: [] as string[], missing: [] as string[], told: false };
  try {
    out.deferred = await deferFromResult(env, task, text);
    for (const name of missingKeysIn(text)) {
      await recordSecretWait(env, { name, taskId: task.id });
      const id = await noticeOnce(env, {
        task, fromName: o.fromName, kind: "missing_secret", secretName: name,
        subject: `Needs a key: ${name} for ${task.title.slice(0, 100)}`,
        lines: [`"${task.title}" needs ${name}, and everything that does not need it is done.`],
        wait: { kind: "MISSING_SECRET", fill: { what: name } },
      });
      if (id) out.missing.push(name);
    }
    const mailed = typeof task.input.from === "string" && task.input.from.includes("@");
    if (o.done && mailed && text.trim()) {
      const id = await noticeOnce(env, {
        task, fromName: o.fromName, kind: `done#${Number(task.attempts ?? 0)}`,
        subject: `Done: ${task.title.slice(0, 140)}`,
        lines: [
          text.trim().slice(0, 20_000),
          ...(out.deferred.length ? ["", `Deferred, each as its own task on its date: ${out.deferred.join(", ")}.`] : []),
        ],
      });
      out.told = Boolean(id);
    }
  } catch (err) {
    await logEvent(env.DB, {
      level: "error", scope: "queue", event: "after_result_failed", lane: task.lane, entityId: task.id,
      detail: { message: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
  }
  return out;
}
