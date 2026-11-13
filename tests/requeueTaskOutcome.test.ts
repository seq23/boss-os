import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script
import { waitForOutcome } from "../scripts/ops/requeue-task.mjs";

/**
 * The post-land proof for a requeued task reads three outcomes, not two (13 Nov 2026): a duty that is
 * correctly WAITING for a seat's usage reset (queued, newest named stop USAGE_LIMIT) is not a timeout.
 */
const fast = { pollMs: 1, maxWaitMs: 20, sleep: async () => {} };
const reader = (data: unknown) => async () => data;

describe("requeue-task waitForOutcome", () => {
  it("a queued task under NAMED STOP [USAGE_LIMIT] is waiting for the reset, with its time", async () => {
    const resumeAt = Date.UTC(2026, 10, 14, 13, 0);
    const out = await waitForOutcome("tsk_x", { ...fast, fetchTask: reader({
      task: { status: "queued" },
      events: [
        { event: "dispatched", detail: JSON.stringify({ run_id: "brn_old", backend_id: "bk_codex" }) },
        { event: "named_stop", detail: JSON.stringify({ code: "USAGE_LIMIT", resume_at: resumeAt }) },
      ],
    }) });
    expect(out).toMatchObject({ outcome: "waiting", resumeAt });
  });

  it("a queued task with no stop and no dispatch is still a timeout", async () => {
    const out = await waitForOutcome("tsk_x", { ...fast, fetchTask: reader({ task: { status: "queued" }, events: [] }) });
    expect(out.outcome).toBe("timed_out");
  });

  it("a different named stop is not read as a usage wait", async () => {
    const out = await waitForOutcome("tsk_x", { ...fast, fetchTask: reader({
      task: { status: "queued" }, events: [{ event: "named_stop", detail: JSON.stringify({ code: "NO_SEAT_AVAILABLE", resume_at: 1 }) }],
    }) });
    expect(out.outcome).toBe("timed_out");
  });

  it("dispatched after the stop, and failed, read as before", async () => {
    const dispatched = await waitForOutcome("tsk_x", { ...fast, fetchTask: reader({
      task: { status: "running" },
      events: [
        { event: "named_stop", detail: JSON.stringify({ code: "USAGE_LIMIT", resume_at: 1 }) },
        { event: "dispatched", detail: JSON.stringify({ run_id: "brn_new", backend_id: "bk_codex" }) },
      ],
    }) });
    expect(dispatched).toMatchObject({ outcome: "dispatched", runId: "brn_new", backendId: "bk_codex" });
    const failed = await waitForOutcome("tsk_x", { ...fast, fetchTask: reader({ task: { status: "failed", error: "no" }, events: [] }) });
    expect(failed).toMatchObject({ outcome: "failed", error: "no" });
  });
});
