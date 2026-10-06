/**
 * DATED DEFERRED WORK IS ITS OWN TASK (R14, R23 — 6 Oct 2026).
 *
 * An employee's result line `Deferred to YYYY-MM-DD: <the ask>` (the practice every prompt carries)
 * opens a task on the same desk that runs on that date: enqueued with a delay, so the task drain
 * does not pick it up before then, and reported like any other task when it runs.
 *
 * THE DUPLICATE CHECK IS EQUALITY ON A JSON FIELD, NEVER LIKE. West Peek OS #228: its deferral
 * checked `description LIKE '%<key>%'`, D1 refused the pattern ("LIKE or GLOB pattern too complex")
 * and every deferred item threw. Here the key is a short hash (`deferKey`) compared with `=`.
 */
import type { Env } from "../env";
import { admitTask } from "../tasks/admit";
import { deferredItemsIn, deferKey } from "../../../shared/boss/service/practices.mjs";

export interface DeferSource {
  id: string;
  lane: string;
  title: string;
  employee_id: string | null;
  input: Record<string, unknown>;
}

/** Every deferred line in `text` → one dated task each. Returns the new task ids (an existing one is not repeated). */
export async function deferFromResult(env: Env, source: DeferSource, text: string): Promise<string[]> {
  const made: string[] = [];
  for (const item of deferredItemsIn(text)) {
    const key = deferKey(source.id, item);
    const already = await env.DB
      .prepare(`SELECT id FROM tasks WHERE json_extract(input, '$.deferred.key') = ? LIMIT 1`)
      .bind(key)
      .first<{ id: string }>();
    if (already) continue;
    const due = Date.parse(item.due_at);
    const date = item.due_at.slice(0, 10);
    const admitted = await admitTask(env, {
      title: `${item.ask.slice(0, 100)} (deferred to ${date})`,
      lane: source.lane,
      employee_id: source.employee_id,
      not_before: due,
      input: {
        source: "deferred",
        deferred: { key, from_task: source.id, due_at: item.due_at },
        ...(typeof source.input.from === "string" ? { from: source.input.from } : {}),
        body: `Deferred on ${new Date().toISOString().slice(0, 10)} from task ${source.id} ("${source.title.slice(0, 120)}") to ${date}: ${item.ask}`,
      },
    });
    if (admitted.created && admitted.task_id) made.push(admitted.task_id);
  }
  return made;
}
