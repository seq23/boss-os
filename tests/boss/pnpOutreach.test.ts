import { env, createExecutionContext } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";

const NOW = Date.parse("2026-11-12T16:20:00Z");
const row = (i: number) => ({ company: `Example Building ${i}`, domain: `building${i}.example.test`, contact_first: "Alex", contact_email: `office@building${i}.example.test`, role: "property manager", kind: "lobby", line: "The building has a reception desk.", source_url: "https://example.test/contact", line_source_url: "https://example.test/about" });
const status = { sent_today: 0, followups_today: 0, corporate_booked: 0, stopped: null, suppressed: [], taken_over: [], replies: [], do_not_contact: [] };
const post = (body: unknown) => apiJson("/api/pnp-outreach", { method: "POST", body });
const list = async () => (await apiJson("/api/pnp-outreach")).body.data.rows as any[];
async function add(i: number) {
  await post({ op: "import", rows: [row(i)] });
  await post({ op: "verdict", email: row(i).contact_email, verdict: "valid" });
  return (await list()).find((r) => r.domain === row(i).domain)!;
}

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); });

describe("corporate outreach D1 desk", () => {
  it("requires a session and registers a visible duty with the actual job", async () => {
    const res = await worker.fetch(new Request("https://boss.test/api/pnp-outreach"), env, createExecutionContext());
    expect(res.status).toBe(401);
    const duty = await env.DB.prepare("SELECT * FROM standing_duties WHERE id='duty_pnp_corporate_outreach'").first<any>();
    expect(duty.employee_id).toBe("emp_research"); expect(duty.timezone).toBe("America/Chicago"); expect([duty.local_hour, duty.local_minute]).toEqual([10, 20]);
    // A Mac job picks its own seats (Codex, then Claude; pinned in tests/pnpCorporateOutreach.test.ts),
    // so the Worker's seat ladder is never on it; the duty says the order in words.
    expect(JSON.parse(duty.task_input).backend_ladder).toBeUndefined();
    expect(JSON.parse(duty.task_input).research_seats).toBe("Codex subscription first, then Claude subscription; never a paid API.");
    expect(duty.success_criteria).toContain("12 first emails");
  });
  it("dedupes by domain and rejects a missing public source", async () => {
    expect((await post({ op: "import", rows: [{ ...row(1), source_url: "" }] })).status).toBe(400);
    await post({ op: "import", rows: [row(1), { ...row(1), contact_email: "other@building1.example.test" }] });
    expect(await list()).toHaveLength(1); expect((await list())[0].state).toBe("found");
    expect((await post({ op: "claim", id: (await list())[0].id, touch: 1, status })).body.data.claimed).toBe(false);
  });
  it("cap 12/day is atomic across concurrent claims and reserves uncertain sends", async () => {
    const rows = [];
    for (let i = 0; i < 15; i++) rows.push(await add(i));
    const claims = await Promise.all(rows.map((r) => post({ op: "claim", id: r.id, touch: 1, status })));
    expect(claims.filter((r) => r.body.data.claimed)).toHaveLength(12);
    expect((await list()).filter((r) => r.first_attempt_at === NOW)).toHaveLength(12);
    expect((await post({ op: "claim", id: rows[0].id, touch: 1, status })).body.data.claimed).toBe(false);
  });
  it("records the first message receipt and follow-up max 1 in the same sequence", async () => {
    const r = await add(1);
    await post({ op: "claim", id: r.id, touch: 1, status });
    await post({ op: "result", id: r.id, touch: 1, message_id: "<synthetic-first>" });
    expect((await list())[0]).toMatchObject({ state: "sent1", first_message_id: "<synthetic-first>" });
    expect((await post({ op: "claim", id: r.id, touch: 2, status })).body.data.claimed).toBe(false);
    vi.mocked(Date.now).mockReturnValue(NOW + 5 * 86400000);
    expect((await post({ op: "claim", id: r.id, touch: 2, status })).body.data.claimed).toBe(true);
    expect((await post({ op: "claim", id: r.id, touch: 2, status })).body.data.claimed).toBe(false);
    await post({ op: "result", id: r.id, touch: 2, message_id: "<synthetic-followup>" });
    expect((await list())[0]).toMatchObject({ state: "sent2", followup_message_id: "<synthetic-followup>" });
  });
  it("rejects bookings, season end, exclusions and invalid verdicts even with a wrong caller", async () => {
    const r = await add(1);
    for (const s of [{ ...status, corporate_booked: 4 }, { ...status, do_not_contact: [row(1).company] }, { ...status, taken_over: [row(1).contact_email] }]) expect((await post({ op: "claim", id: r.id, touch: 1, status: s })).body.data.claimed).toBe(false);
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-12-07T16:20:00Z"));
    expect((await post({ op: "claim", id: r.id, touch: 1, status })).body.data.claimed).toBe(false);
    vi.mocked(Date.now).mockReturnValue(NOW);
    await post({ op: "import", rows: [row(2)] });
    await post({ op: "verdict", email: row(2).contact_email, verdict: "catchall" });
    expect((await list()).find((x) => x.domain === row(2).domain).state).toBe("skipped");
  });
  it("applies suppression, takeover, real replies and exclusions to the persisted domain", async () => {
    for (let i = 1; i <= 4; i++) await add(i);
    await post({ op: "status", status: { ...status, suppressed: [row(1).contact_email], taken_over: ["colleague@building2.example.test"], replies: [{ email: row(3).contact_email, kind: "question", at: NOW }], do_not_contact: [row(4).company] } });
    expect(Object.fromEntries((await list()).map((r) => [r.domain, r.state]))).toEqual({ [row(1).domain]: "suppressed", [row(2).domain]: "taken_over", [row(3).domain]: "replied", [row(4).domain]: "skipped" });
  });
});
