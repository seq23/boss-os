import { describe, expect, it } from "vitest";
import { pauseOver, noticeOwner } from "../scripts/ops/task-notices.mjs";
import { employeeMail, sendersFor } from "../scripts/ops/notify.mjs";

/**
 * THE 16 NOV 2026 "Paused until Mon, Nov 16, 8:40 AM: Monthly quality read" EMAIL, replayed with its
 * real times: written 7:40 AM Central (13:40Z) announcing 8:40 AM (14:40Z), sent by the drain at
 * 12:43 PM (18:43Z), four hours after the pause it announced had ended, under "Decide (1)" and
 * "Reply to this email with what it needs" with nothing to decide.
 */
process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
const WRITTEN = Date.UTC(2026, 10, 16, 13, 40, 51);
const RESUME = Date.UTC(2026, 10, 16, 14, 40, 51);
const SENT = Date.UTC(2026, 10, 16, 18, 43, 12);
const notice = {
  id: "tnt_synthpause1", kind: "stop:WAITING_FOR_CLAUDE", from_name: "Kendra", task_id: "tsk_m5guardpause1", created_at: WRITTEN,
  subject: "Paused until Mon, Nov 16, 8:40 AM: Synthetic quality read [tsk_m5guardpause1]",
  body: '"Synthetic quality read" is paused, not lost.\n\nEvery worker that may do it is out until Mon, Nov 16, 8:40 AM (Central). It starts again on its own then.',
};
const detail = (status: string, extra: any[] = []) => ({
  task: { id: notice.task_id, status },
  events: [{ event: "named_stop", ts: WRITTEN - 200, detail: JSON.stringify({ code: "WAITING_FOR_CLAUDE", resume_at: RESUME }) }, ...extra],
});

describe("a pause notice the drain reaches late", () => {
  it("is not sent once the pause it announced is over, or the task runs or is done", () => {
    expect(pauseOver(notice, detail("queued"), SENT)).toMatch(/over/);
    expect(pauseOver(notice, detail("running"), WRITTEN + 60_000)).toMatch(/running/);
    expect(pauseOver(notice, detail("done"), WRITTEN + 60_000)).toMatch(/done/);
    // A later stop (the next hourly retry) does not move the announced time.
    expect(pauseOver(notice, detail("queued", [{ event: "named_stop", ts: RESUME + 1000, detail: JSON.stringify({ resume_at: SENT + 3_600_000 }) }]), SENT)).toMatch(/over/);
  });
  it("is still sent while the pause it announced is true (negative proof)", () => {
    expect(pauseOver(notice, detail("queued"), WRITTEN + 10 * 60_000)).toBeNull();
    expect(pauseOver({ ...notice, kind: "stopped" }, detail("queued"), SENT)).toBeNull();
    expect(pauseOver(notice, null, SENT)).toBeNull();
  });
});

describe("a notice with no question", () => {
  it("renders no Decide block and asks for no reply; a could-not-do still asks (negative proof)", () => {
    const sender = sendersFor("Kendra")[0]!;
    const told = employeeMail(sender, { to: "owner@example.com", subject: notice.subject, text: notice.body, owner: noticeOwner(notice) });
    for (const part of [told.text, told.html]) {
      expect(part).not.toMatch(/Decide \(\d+\)/);
      expect(part).not.toMatch(/Reply to this email/i);
    }
    expect(told.text).toMatch(/Nothing to do/);
    const cnd = { kind: "could_not_do", from_name: "Kendra", task_id: "tsk_m5guardpause2", subject: "I could not book the table", body: "I could not book the table at Example Cafe: they only take bookings by phone." };
    const asked = employeeMail(sender, { to: "owner@example.com", subject: cnd.subject, text: cnd.body, owner: noticeOwner(cnd) });
    expect(asked.text).toMatch(/Reply to this email/i);
  });
});
