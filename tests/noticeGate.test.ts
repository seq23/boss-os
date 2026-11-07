/**
 * EMAIL ONLY WHEN SHE MUST ACT (owner, 7 Nov 2026: "either consolidate the emails or make those
 * notifications on some page inside boss os only"). Her inbox on 7 Nov: fifteen "Reminder:" emails
 * from Simone in one minute, each "Nothing to decide — this is just so you know."
 *
 * The one gate is `sendNotice` in the drain on her Mac: a notice written with needs_her = 0 never
 * reaches the mail sender; a notice that needs her still does. Synthetic data.
 */
import { describe, expect, it } from "vitest";
import { sendNotice, ON_PAGE } from "../scripts/ops/task-notices.mjs";
import { needsHer } from "../src/shared/boss/mail/noticeGate.mjs";
import { reminderEmail } from "../src/shared/boss/openLoops/openLoops.mjs";

process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
process.env.BOSS_OS_FALLBACK_MAIL_KEY = process.env.BOSS_OS_FALLBACK_MAIL_KEY ?? "test-fallback-not-real";

const counting = () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ id: "re_synthetic" }), { status: 200 }); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

const loop = { id: "olp_synthetic", title: "A synthetic loop", finish_line: "Live", next_step: "Sign in to the store", owner: "sequoia", next_date: "2026-11-06" };
const mail = reminderEmail(loop, { origin: "https://boss.example", late: 1, nth: 1 });

describe("the one gate: a notice that needs nothing from her never calls the mail sender", () => {
  it("a reminder written as its writer writes it (needs_her from needsHer) is kept off email", async () => {
    const notice = { kind: "open_loop_reminder", from_name: "Simone", task_id: loop.id, subject: mail.subject, body: mail.body, needs_her: needsHer({ kind: "open_loop_reminder" }) ? 1 : 0 };
    expect(notice.needs_her).toBe(0);
    const { calls, fetchImpl } = counting();
    expect(await sendNotice(notice, { fetchImpl, to: "o@example.com" })).toBe(ON_PAGE);
    expect(calls).toEqual([]);
  });

  it("a Done notice for work an alarm started by itself, and a pause that restarts itself, stay off email", async () => {
    for (const kind of ["done#0", "stop:CODEX_LIMIT"]) {
      const { calls, fetchImpl } = counting();
      const notice = { kind, from_name: "Kendra", task_id: "tsk_synthetic03", subject: "Done (partial): a synthetic alarm", body: "Synthetic.", needs_her: needsHer({ kind, systemStarted: true }) ? 1 : 0 };
      expect(needsHer({ kind }), `${kind} for work she asked for`).toBe(true);
      expect(await sendNotice(notice, { fetchImpl, to: "o@example.com" })).toBe(ON_PAGE);
      expect(calls).toEqual([]);
    }
  });

  it("a notice that needs her still calls the mail sender (negative proof)", async () => {
    for (const n of [
      { kind: "stopped", needs_her: needsHer({ kind: "stopped" }) ? 1 : 0 },
      // Work she asked for, however she asked (research, a prep, a reply): its answer is emailed.
      { kind: "done#0", needs_her: needsHer({ kind: "done#0" }) ? 1 : 0 },
      { kind: "missing_secret", needs_her: 1 },
    ]) {
      expect(n.needs_her).toBe(1);
      const { calls, fetchImpl } = counting();
      const out = await sendNotice({ ...n, from_name: "Simone", task_id: "tsk_synthetic04", subject: n.kind === "stopped" ? "Stopped: a synthetic job" : "Your synthetic job", body: "\"A synthetic job\" has an answer. Reply to clear it." }, { fetchImpl, to: "o@example.com" });
      expect(out, n.kind).not.toBe(ON_PAGE);
      expect(calls.length, `${n.kind}: ${out}`).toBeGreaterThan(0);
    }
  });

  it("an old row with no field fails toward email, never toward silence", async () => {
    const { calls, fetchImpl } = counting();
    await sendNotice({ kind: "could_not_do", from_name: "Simone", task_id: "tsk_synthetic05", subject: "Could not do: a synthetic job", body: "Synthetic. Reply to this email." }, { fetchImpl, to: "o@example.com" });
    expect(calls.length).toBeGreaterThan(0);
  });
});
