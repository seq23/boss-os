/**
 * THE DRAIN TELLS A GATE HOLD FROM A REFUSAL (repair, 6 Nov 2026). The gate answers a held email with
 * 422 `{ held: true, problems }`; the drain stops at the first sender (every sender would hold the same
 * words) and reports it as a hold, so the notice keeps its send attempts. Synthetic data.
 */
import { describe, expect, it } from "vitest";
import { gateHoldOf, isGateHold, sendNotice } from "../scripts/ops/task-notices.mjs";

process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
process.env.BOSS_OS_FALLBACK_MAIL_KEY = process.env.BOSS_OS_FALLBACK_MAIL_KEY ?? "test-fallback-not-real";

const notice = { kind: "stopped", from_name: "Simone", task_id: "tsk_synthetic02", subject: "Stopped: a synthetic job", body: "\"A synthetic job\" stopped. Reply to clear it." };
const held = JSON.stringify({ held: true, problems: ["longer than 9000 characters", "Decide is not first"] });

describe("a gate hold is not a failed send", () => {
  it("reads only a 422 that says held", () => {
    expect(gateHoldOf(422, held)).toBe("longer than 9000 characters; Decide is not first");
    expect(gateHoldOf(422, JSON.stringify({ error: "invalid" }))).toBeNull();
    expect(gateHoldOf(403, held)).toBeNull();
    expect(gateHoldOf(422, "not json")).toBeNull();
  });

  it("stops at the first sender and returns a hold", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response(held, { status: 422 }); }) as typeof fetch;
    const error = await sendNotice(notice, { fetchImpl, to: "o@example.com" });
    expect(isGateHold(error)).toBe(true);
    expect(calls).toBe(1);
  });

  it("a provider refusal is still a refusal (negative proof)", async () => {
    const fetchImpl = (async () => new Response("domain not verified", { status: 403 })) as typeof fetch;
    const error = await sendNotice(notice, { fetchImpl, to: "o@example.com" });
    expect(error).toMatch(/403/);
    expect(isGateHold(error)).toBe(false);
  });
});
