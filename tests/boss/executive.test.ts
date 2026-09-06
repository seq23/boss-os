import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, insertApproval, insertMemory, insertTask, row, uid } from "./helpers";
import { TODAY_BLOCKS } from "../../src/worker/boss/routes/today";
import { SNAPSHOT_TABLES } from "../../src/worker/boss/routes/vault";

/**
 * Phase 11 — Executive OS Core.
 *
 * Each test picks its own year. Days are real rows keyed by date and open loops
 * carry forward across days on purpose, so tests that shared a calendar would
 * leak into each other and the leak would look like a feature working.
 */
const DAY = (year: number, day = 1) => `${year}-01-${String(day).padStart(2, "0")}`;

describe("Phase 11 — Today renders the thirteen canon elements", () => {
  it("creates the day on first read and persists every block", async () => {
    const date = DAY(2031);
    const { status, body } = await apiJson(`/api/today?date=${date}`);
    expect(status).toBe(200);

    expect(body.data.blocks.map((b: any) => b.key)).toEqual(TODAY_BLOCKS.map((b) => b.key));
    expect(body.data.blocks).toHaveLength(13);

    const day = await row(`SELECT * FROM days WHERE id = ?`, date);
    expect(day).toBeTruthy();
    expect(day!.date_ts).toBe(Date.parse(`${date}T00:00:00.000Z`));
    expect(JSON.parse(day!.day_flow_json)).toHaveLength(13);

    const blocks = await all(`SELECT block_key, block_order FROM day_flow_blocks WHERE day_id = ? ORDER BY block_order`, date);
    expect(blocks.map((b) => b.block_key)).toEqual(TODAY_BLOCKS.map((b) => b.key));
  });

  it("rebuilds in place rather than stacking a second set of blocks each read", async () => {
    const date = DAY(2032);
    await api(`/api/today?date=${date}`);
    await api(`/api/today?date=${date}`);
    const count = await row(`SELECT COUNT(*) AS n FROM day_flow_blocks WHERE day_id = ?`, date);
    expect(count!.n).toBe(13);
  });

  it("reads real rows from the subsystems that already exist", async () => {
    const date = DAY(2033);
    await insertApproval({ risk: "high", title: "Ship the thing" });
    await insertTask({ status: "running" });
    await insertMemory({ created_at: Date.parse(`${date}T09:00:00.000Z`) });

    const { body } = await apiJson(`/api/today?date=${date}`);
    const by = Object.fromEntries(body.data.blocks.map((b: any) => [b.key, b]));

    expect(by.approval_inbox.content.pending).toBeGreaterThanOrEqual(1);
    expect(by.approval_inbox.content.by_risk.high).toBeGreaterThanOrEqual(1);
    expect(by.approval_inbox.content.oldest).toBeTruthy();
    expect(by.executive_briefing.content.open_tasks).toBeGreaterThanOrEqual(1);
    expect(by.executive_briefing.content.captures_today).toBeGreaterThanOrEqual(1);
    expect(by.employee_status.content.by_status.active).toBeGreaterThanOrEqual(1);
    expect(by.trading_status.content.live_enabled).toBe(false);
  });

  /**
   * Two elements still have no substrate. Canon lists them, so the block
   * exists and says what is missing and when it arrives. A block that quietly
   * showed plausible-looking nothing would be the worse failure.
   *
   * Meetings left this list in Phase 13 and Spirit Signal in Phase 16, when
   * each got tables to read.
   */
  it("records an absent subsystem as absent instead of inventing one", async () => {
    const { body } = await apiJson(`/api/today?date=${DAY(2034)}`);
    const by = Object.fromEntries(body.data.blocks.map((b: any) => [b.key, b]));

    expect(by.meetings.content.available).toBeUndefined();
    expect(by.meetings.content.meetings).toEqual([]);
    expect(by.spirit_signal.content.available).toBeUndefined();
    expect(by.spirit_signal.content.moon.phase).toBeTruthy();

    for (const [key, phase] of [["coaching_focus", 12], ["daily_thinking_lens", 12]] as const) {
      expect(by[key].content.available).toBe(false);
      expect(by[key].content.arrives_in_phase).toBe(phase);
      expect(by[key].is_empty).toBe(true);
      expect(by[key].content.reason).toBeTruthy();
    }

    const rendered = JSON.stringify(body.data.blocks);
    expect(rendered).not.toMatch(/TODO|FIXME|lorem|placeholder/i);
  });

  it("keeps continuity and trading closed until they are relevant", async () => {
    const { body } = await apiJson(`/api/today?date=${DAY(2035)}`);
    const by = Object.fromEntries(body.data.blocks.map((b: any) => [b.key, b]));
    // No snapshot has been taken in this database, which is exactly when
    // continuity is relevant.
    expect(by.continuity_status.content.relevant).toBe(true);
    expect(by.trading_status.content.relevant).toBe(false);
    expect(by.trading_status.is_empty).toBe(true);
  });
});

describe("Phase 11 — the three gates", () => {
  it("refuses a fourth priority, because the cap is the gate", async () => {
    const { status, body } = await apiJson(`/api/today/gates/morning`, {
      method: "POST",
      body: { day_id: DAY(2036), priorities: ["a", "b", "c", "d"] },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/3 priorit/);
  });

  it("records the morning gate as an entry and on the day, once", async () => {
    const date = DAY(2037);
    await insertApproval({ status: "pending" });

    const first = await apiJson(`/api/today/gates/morning`, {
      method: "POST",
      body: {
        day_id: date,
        priorities: ["Close the raise", "Ship Today", "Walk"],
        identity_cue: "Operator",
        body_floor: "Sleep before midnight",
        commitment: "One hard thing before noon",
      },
    });
    expect(first.status).toBe(201);

    const entry = await row(`SELECT * FROM gate_entries WHERE day_id = ? AND gate = 'morning'`, date);
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry!.payload).priorities).toHaveLength(3);

    const day = await row(`SELECT * FROM days WHERE id = ?`, date);
    expect(day!.morning_completed_at).toBeTruthy();
    expect(JSON.parse(day!.morning_contract).approvals_waiting_at_gate).toBeGreaterThanOrEqual(1);
    // The agenda engine is Phase 12; its absence is recorded, not guessed at.
    expect(JSON.parse(day!.morning_agenda).available).toBe(false);
    expect(day!.gate_entries_count).toBe(1);

    const again = await apiJson(`/api/today/gates/morning`, {
      method: "POST",
      body: { day_id: date, priorities: ["Something else"] },
    });
    expect(again.status).toBe(409);

    const entries = await row(`SELECT COUNT(*) AS n FROM gate_entries WHERE day_id = ?`, date);
    expect(entries!.n).toBe(1);
  });

  it("puts the contract on the screen once the morning gate has run", async () => {
    const date = DAY(2038);
    await apiJson(`/api/today/gates/morning`, {
      method: "POST",
      body: { day_id: date, priorities: ["Only this"], commitment: "No meetings" },
    });
    const { body } = await apiJson(`/api/today?date=${date}`);
    const contract = body.data.blocks.find((b: any) => b.key === "todays_contract");
    expect(contract.is_empty).toBe(false);
    expect(contract.content.contract.priorities).toEqual(["Only this"]);
    expect(contract.content.contract.commitment).toBe("No meetings");
  });

  it("sweeps the approval inbox at midday and caps the checks at three", async () => {
    const date = DAY(2039);
    const tooMany = await apiJson(`/api/today/gates/midday`, {
      method: "POST",
      body: { day_id: date, checks: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] },
    });
    expect(tooMany.status).toBe(400);

    const { status, body } = await apiJson(`/api/today/gates/midday`, {
      method: "POST",
      body: { day_id: date, checks: [{ text: "Inbox", done: true }, { text: "Body" }], adjustments: "Dropped the deck" },
    });
    expect(status).toBe(201);
    expect(body.data.approval_sweep.swept_at).toBeTruthy();

    const day = await row(`SELECT * FROM days WHERE id = ?`, date);
    expect(JSON.parse(day!.midday_checks)[0].done).toBe(true);
    expect(JSON.parse(day!.midday_adjustments).approval_sweep).toBeTruthy();
  });

  it("refuses an attention allocation larger than a day", async () => {
    const { status, body } = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: { day_id: DAY(2040), attention: [{ focus_area: "Deals", pct: 60 }, { focus_area: "Build", pct: 50 }] },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/110%/);
  });

  /**
   * The build plan is explicit: the Night Gate feeds the existing memory
   * promotion sweep, not a parallel one. This asserts the candidates it shows
   * are the same `promotion_events` rows the sweep writes, gated by the same
   * approvals.
   */
  it("feeds the existing promotion gate rather than a second one", async () => {
    const date = DAY(2041);
    const memId = uid("mem");
    await insertMemory({
      id: memId, tier: "working", hits: 9, confidence: 0.95,
      created_at: Date.now() - 30 * 86_400_000, title: "A durable lesson",
    });

    const { status, body } = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: {
        day_id: date,
        attention: [{ focus_area: "Deals", pct: 55 }, { focus_area: "Build", pct: 45 }],
        review: ["What did I avoid?"],
        evidence: { note: "Shipped Today", wins: ["Phase 11"] },
      },
    });
    expect(status).toBe(201);
    expect(body.data.promotions.sweep.proposed).toBeGreaterThanOrEqual(1);

    const event = await row(
      `SELECT * FROM promotion_events WHERE item_id = ? AND outcome = 'proposed'`, memId,
    );
    expect(event).toBeTruthy();
    const approval = await row(`SELECT * FROM approvals WHERE id = ?`, event!.approval_id);
    expect(approval!.kind).toBe("memory_promotion");
    expect(approval!.status).toBe("pending");

    const candidates = body.data.promotions.candidates.map((c: any) => c.item_id);
    expect(candidates).toContain(memId);

    const day = await row(`SELECT * FROM days WHERE id = ?`, date);
    expect(JSON.parse(day!.night_attention)).toHaveLength(2);
    expect(JSON.parse(day!.night_evidence).review).toHaveLength(1);
  });

  /**
   * The review prompts and tomorrow's seed are optional parts of the Night
   * Gate, and the form sends the empty list rather than omitting the field. An
   * empty list is "nothing to review", not "you failed to review".
   */
  it("closes the day with no review prompts and nothing seeded for tomorrow", async () => {
    const date = DAY(2046);
    const { status, body } = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: {
        day_id: date,
        attention: [{ focus_area: "Everything", pct: 100 }],
        review: [],
        tomorrow_seed: { priorities: [] },
      },
    });
    expect(status).toBe(201);
    expect(body.data.tomorrow_seed.priorities).toEqual([]);

    const day = await row(`SELECT * FROM days WHERE id = ?`, date);
    expect(JSON.parse(day!.night_evidence).review).toEqual([]);
    const seeded = await all(`SELECT * FROM open_loops WHERE day_id = ?`, DAY(2046, 2));
    expect(seeded).toHaveLength(0);
  });

  /**
   * A refused gate must not leave anything behind. The Night Gate runs the
   * promotion sweep, which writes rows and raises approvals, so the refusal has
   * to come first — otherwise a double submit quietly proposes promotions and
   * then says it did nothing.
   */
  it("refuses a second night gate without running the promotion sweep again", async () => {
    const date = DAY(2047);
    await insertMemory({
      tier: "working", hits: 9, confidence: 0.95,
      created_at: Date.now() - 30 * 86_400_000, title: "First sweep candidate",
    });

    const first = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: { day_id: date, attention: [{ focus_area: "Deals", pct: 100 }] },
    });
    expect(first.status).toBe(201);

    await insertMemory({
      tier: "working", hits: 9, confidence: 0.95,
      created_at: Date.now() - 30 * 86_400_000, title: "Second sweep candidate",
    });
    const before = await row(`SELECT COUNT(*) AS n FROM promotion_events`);

    const again = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: { day_id: date, attention: [{ focus_area: "Deals", pct: 100 }] },
    });
    expect(again.status).toBe(409);

    const after = await row(`SELECT COUNT(*) AS n FROM promotion_events`);
    expect(after!.n).toBe(before!.n);
  });

  it("seeds tomorrow onto tomorrow's screen, not into a note nobody reads", async () => {
    const date = DAY(2042, 10);
    const tomorrow = DAY(2042, 11);

    const { status } = await apiJson(`/api/today/gates/night`, {
      method: "POST",
      body: {
        day_id: date,
        attention: [{ focus_area: "Everything", pct: 100 }],
        tomorrow_seed: { priorities: ["Call the LP", "Fix the migration"], notes: "Start early" },
      },
    });
    expect(status).toBe(201);

    const seeded = await all(`SELECT * FROM open_loops WHERE day_id = ? ORDER BY created_at`, tomorrow);
    expect(seeded.map((l) => l.title)).toEqual(["Call the LP", "Fix the migration"]);
    expect(JSON.parse(seeded[0].detail).seeded_by).toBe("night_gate");

    const { body } = await apiJson(`/api/today?date=${tomorrow}`);
    const loops = body.data.blocks.find((b: any) => b.key === "open_loops");
    expect(loops.is_empty).toBe(false);
    expect(loops.content.loops.map((l: any) => l.title)).toEqual(
      expect.arrayContaining(["Call the LP", "Fix the migration"]),
    );
  });
});

describe("Phase 11 — open loops", () => {
  it("keeps an unresolved loop on the screen after the date rolls over", async () => {
    const monday = DAY(2043, 5);
    const friday = DAY(2043, 9);

    const created = await apiJson(`/api/today/loops`, {
      method: "POST",
      body: { day_id: monday, title: "Chase the signed copy", kind: "follow_up", priority: 1 },
    });
    expect(created.status).toBe(201);

    const { body } = await apiJson(`/api/today?date=${friday}`);
    const loops = body.data.blocks.find((b: any) => b.key === "open_loops");
    const carried = loops.content.loops.find((l: any) => l.id === created.body.data.id);
    expect(carried).toBeTruthy();
    expect(carried.carried_from).toBe(monday);
    expect(loops.content.carried_forward).toBeGreaterThanOrEqual(1);
  });

  it("resolving a loop takes it off the screen without deleting it", async () => {
    const date = DAY(2044);
    const created = await apiJson(`/api/today/loops`, {
      method: "POST", body: { day_id: date, title: "Send the note" },
    });
    const id = created.body.data.id;

    const closed = await apiJson(`/api/today/loops/${id}/resolve`, { method: "POST", body: {} });
    expect(closed.status).toBe(200);

    const stored = await row(`SELECT * FROM open_loops WHERE id = ?`, id);
    expect(stored!.status).toBe("resolved");
    expect(stored!.resolved_at).toBeTruthy();

    const { body } = await apiJson(`/api/today?date=${date}`);
    const loops = body.data.blocks.find((b: any) => b.key === "open_loops");
    expect(loops.content.loops.find((l: any) => l.id === id)).toBeUndefined();

    const again = await apiJson(`/api/today/loops/${id}/resolve`, { method: "POST", body: {} });
    expect(again.status).toBe(409);
  });

  it("deferring carries the loop forward instead of rewriting today's record", async () => {
    const created = await apiJson(`/api/today/loops`, {
      method: "POST", body: { title: "Read the memo", kind: "decision_pending" },
    });
    const id = created.body.data.id;
    const today = created.body.data.day_id;

    const deferred = await apiJson(`/api/today/loops/${id}/defer`, { method: "POST", body: { note: "Not today" } });
    expect(deferred.status).toBe(200);
    expect(deferred.body.data.loop.status).toBe("deferred");

    const carried = deferred.body.data.carried;
    expect(carried.title).toBe("Read the memo");
    expect(carried.status).toBe("open");
    expect(carried.day_id).not.toBe(today);

    const audited = await row(
      `SELECT * FROM audit_log WHERE entity_id = ? AND action = 'deferred'`, id,
    );
    expect(audited).toBeTruthy();
  });

  it("refuses a kind of loop it does not have", async () => {
    const { status } = await apiJson(`/api/today/loops`, {
      method: "POST", body: { title: "Nope", kind: "invented" },
    });
    expect(status).toBe(400);
  });
});

describe("Phase 11 — continuity covers the executive tables", () => {
  it("snapshots days, blocks, loops and gate entries with everything else", async () => {
    for (const table of ["days", "day_flow_blocks", "open_loops", "gate_entries"]) {
      expect(SNAPSHOT_TABLES).toContain(table);
    }

    await api(`/api/today?date=${DAY(2045)}`);
    const { status, body } = await apiJson(`/api/vault/snapshots`, { method: "POST", body: { label: "phase11" } });
    expect(status).toBe(201);

    const snapshot = await row(`SELECT * FROM vault_snapshots WHERE id = ?`, body.data.id);
    expect(snapshot!.status).toBe("complete");
    const counts = JSON.parse(snapshot!.table_counts);
    expect(counts.days).toBeGreaterThanOrEqual(1);
    expect(counts.day_flow_blocks).toBeGreaterThanOrEqual(13);
    expect(counts).toHaveProperty("open_loops");
    expect(counts).toHaveProperty("gate_entries");
  });
});

describe("Phase 11 — the day exists whether or not anyone opened it", () => {
  it("rolls the day from the nightly cron", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();

    await worker.scheduled!({ cron: "0 3 * * *", scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
    await waitOnExecutionContext(ctx);

    const run = await row(`SELECT steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    const step = JSON.parse(run!.steps).find((s: any) => s.name === "roll_day");
    expect(step.status).toBe("ok");
    expect(step.detail.blocks).toBe(13);

    const day = await row(`SELECT * FROM days WHERE id = ?`, step.detail.day);
    expect(day).toBeTruthy();
    expect(JSON.parse(day!.day_flow_json)).toHaveLength(13);
  });
});
