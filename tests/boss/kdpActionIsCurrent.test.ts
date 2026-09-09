import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, uid } from "./helpers";

/**
 * THE SCREEN MAY NOT ASK HER FOR SOMETHING SHE HAS ALREADY DONE.
 *
 * ─── Observed on production, 9 September 2026 ──────────────────────────────
 *
 *   covers: { state: "approved", may_publish: true, decided_at: 09:30:38 }
 *   action: { detail: "Approve the replacement covers in Boss OS (state: approved), then Simone
 *             will upload and publish." }
 *
 * Simone's run finished at 09:24:24 and wrote that sentence. She approved at 09:30:38, six minutes
 * later, and nothing recomputed it — so the screen spent the rest of the day telling her to repeat a
 * completed step, and she reported it twice.
 *
 * IT IS THE SAME DEFECT AS THE BADGE THAT SAID 9 OVER AN EMPTY INBOX, and as the count she reported
 * stuck at 12 in the other product: a value derived once at write time and never reconciled with the
 * state it describes. Three instances in one day makes it a class, and the class is what this file
 * holds down — the action is recomputed from the covers row on every read.
 */

const CASE_TITLE = "kdp_action_test";

async function seedBlockedTitle() {
  await env.DB.prepare(`DELETE FROM kdp_titles WHERE title_ref = ?`).bind(CASE_TITLE).run();
  await env.DB
    .prepare(
      `INSERT INTO kdp_titles (title_ref, label, state, state_changed_at, first_seen_at, updated_at) VALUES (?,?, 'blocked', ?, ?, ?)`,
    )
    .bind(CASE_TITLE, "A blocked title", Date.now(), Date.now(), Date.now())
    .run();
}

/** The exact stored sentence production was serving, written before her verdict existed. */
const STALE = "Approve the replacement covers in Boss OS (state: approved), then Simone will upload and publish.";

async function seedCheck() {
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO kdp_case_checks (id, checked_at, sentinel, determination, next_action, needs_owner, source, created_at)
       VALUES (?,?, 'no-reply', 'Nothing new from support.', ?, 0, 'test', ?)`,
    )
    .bind(uid("kcc"), now, STALE, now)
    .run();
}

async function seedCovers(state: string) {
  const now = Date.now();
  const approvalId = uid("apr");
  await env.DB
    .prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, risk, status, requested_at, expires_at)
       VALUES (?, 'ops', 'Covers', 'Look at these', 'judgement_call', 'medium', 'pending', ?, NULL)`,
    )
    .bind(approvalId, now)
    .run();
  await env.DB
    .prepare(
      `INSERT INTO judgement_calls
         (id, approval_id, employee_id, title, question, resume_kind, state, attempt, created_at, updated_at)
       VALUES (?,?, 'emp_chief', 'Covers', 'Do these look right?', 'kdp_cover_upload', ?, 1, ?, ?)`,
    )
    .bind(uid("jdg"), approvalId, state, now, now)
    .run();
}

describe("the KDP action is recomputed from state, never served from the last run's string", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM judgement_calls WHERE resume_kind = 'kdp_cover_upload'`).run();
    await env.DB.prepare(`DELETE FROM kdp_case_checks`).run();
    await seedBlockedTitle();
    await seedCheck();
  });

  it("stops asking her to approve covers the moment they are approved", async () => {
    await seedCovers("approved");

    const res = await apiJson<any>("/api/kdp");
    const { action, covers } = res.body.data;

    // Rule 0: the assertions are worthless if the fixture did not actually reach the state.
    expect(covers).toBeTruthy();
    expect(covers.may_publish).toBe(true);
    const stored = await env.DB.prepare(`SELECT next_action FROM kdp_case_checks`).first<{ next_action: string }>();
    expect(stored?.next_action).toBe(STALE);

    // THE FIX. The stale sentence is still on the row and is no longer what she is shown.
    expect(action.who).toBe("simone");
    expect(action.detail).not.toContain("Approve the replacement covers");
    expect(action.headline).toContain("You approved the covers");
  });

  it("does ask her while they are actually waiting, so the fix does not silence a real request", async () => {
    await seedCovers("awaiting");
    const res = await apiJson<any>("/api/kdp");
    expect(res.body.data.covers.state).toBe("awaiting");
    expect(res.body.data.action.who).toBe("her");
    expect(res.body.data.action.headline).toContain("waiting on your verdict");
  });

  it("falls back to the case's own state when no covers batch has ever been raised", async () => {
    const res = await apiJson<any>("/api/kdp");
    expect(res.body.data.covers).toBeNull();
    // The stored sentence is legitimate here: nothing has superseded it.
    expect(res.body.data.action.who).toBe("simone");
  });
});
