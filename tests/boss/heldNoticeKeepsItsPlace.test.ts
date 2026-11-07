/**
 * A HELD NOTICE KEEPS ITS PLACE (repair, 6 Nov 2026). The DNA research report for Valerie was held
 * by the plain-email gate on her Mac; a hold is the same words every run until the sender is fixed,
 * so counting it as a failed send would spend the five attempts that decide whether she is ever told.
 * A hold is counted in `holds`, never `attempts`, keeps being offered up to MAX_HOLDS, and both
 * ceilings are named in `/pending`.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, row, uid } from "./helpers";
import { MAX_HOLDS, MAX_SEND_ATTEMPTS } from "../../src/worker/boss/routes/taskNotices";

async function seedNotice(over: { attempts?: number; holds?: number } = {}) {
  const id = uid("tnt");
  await env.DB
    .prepare(
      `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, attempts, holds)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, uid("tsk"), "ops", "Camille", "done#3", "Synthetic report (full report)", "the body", Date.now(), over.attempts ?? 0, over.holds ?? 0)
    .run();
  return id;
}

type Pending = { data: { items: { id: string }[]; gave_up: number; gave_up_held: number; held: number; max_holds: number } };
const pending = async () => (await (await api("/api/task-notices/pending")).json()) as Pending;

describe("a notice held by the plain-email gate keeps its place", () => {
  it("counts a hold in holds, never attempts, and keeps offering it", async () => {
    const id = await seedNotice();
    for (let i = 0; i < MAX_SEND_ATTEMPTS + 1; i += 1) {
      const res = await api(`/api/task-notices/${id}/failed`, { method: "POST", body: { error: "held by the plain-email gate: longer than 9000 characters", held: true } });
      expect(res.status).toBe(200);
    }
    const r = await row(`SELECT attempts, holds, error, sent_at FROM boss_task_notices WHERE id = ?`, id);
    expect(r).toMatchObject({ attempts: 0, holds: MAX_SEND_ATTEMPTS + 1, sent_at: null });
    expect(String(r!.error)).toContain("9000");
    const p = await pending();
    // Past the five-attempt ceiling in holds, and still offered: the repaired sender will send it.
    expect(p.data.items.map((x) => x.id)).toContain(id);
    expect(p.data.held).toBeGreaterThanOrEqual(1);
    expect(await row(`SELECT event FROM system_events WHERE event = 'task_notice_held' AND detail LIKE ?`, `%${id}%`)).not.toBeNull();
  });

  it("a real refusal still spends an attempt (negative proof)", async () => {
    const id = await seedNotice();
    await api(`/api/task-notices/${id}/failed`, { method: "POST", body: { error: "403 domain not verified" } });
    expect(await row(`SELECT attempts, holds FROM boss_task_notices WHERE id = ?`, id)).toMatchObject({ attempts: 1, holds: 0 });
  });

  it("gives a hold up at its own ceiling and names it, never silently", async () => {
    const id = await seedNotice({ holds: MAX_HOLDS - 1 });
    const res = await api(`/api/task-notices/${id}/failed`, { method: "POST", body: { error: "held by the plain-email gate: Decide is not first", held: true } });
    expect(((await res.json()) as { data: { gave_up: boolean } }).data.gave_up).toBe(true);
    const p = await pending();
    expect(p.data.items.map((x) => x.id)).not.toContain(id);
    expect(p.data.gave_up_held).toBeGreaterThanOrEqual(1);
    expect(p.data.gave_up).toBeGreaterThanOrEqual(1);
    expect(p.data.max_holds).toBe(MAX_HOLDS);
  });
});
