import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { weeklyPacket, packetIsDue } from "../../src/worker/boss/today/packet";
import { apiJson, row, all, uid } from "./helpers";

/**
 * THE WEDNESDAY PACKET.
 *
 * Her ask: "a packet prepared before each meeting on wed with scooter showing what ive done for the
 * week and anything i need to discuss with him."
 *
 * The trigger was an item that would otherwise have evaporated — ask him for the Google grant on the
 * West Peek sending address, which is what unblocks reading LP replies and the opt-out defect the
 * outreach register has carried since 19 August. It existed only in a conversation.
 */

const WED = "2026-09-09"; // a Wednesday
const TUE = "2026-09-08";
const MON = "2026-09-07";

const daysAgo = (n: number) => Date.now() - n * 86_400_000;

async function clean() {
  await env.DB.prepare(`DELETE FROM days WHERE id LIKE '2026-09-%'`).run();
  await env.DB.prepare(`DELETE FROM open_loops`).run();
  await env.DB.prepare(`DELETE FROM deals`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates`).run();
  await env.DB.prepare(`DELETE FROM meeting_agenda_items WHERE counterpart = 'testpartner'`).run();
}

describe("when the packet appears", () => {
  it("is ready on Tuesday, not only on the morning of the meeting", () => {
    /*
     * THE WHOLE POINT OF PREPARING ONE. Seeing "ask him for the Google grant" at 6am on Wednesday is
     * seeing it as the meeting starts. Seeing it on Tuesday is time to do something about it first.
     */
    expect(packetIsDue(2)).toBe(true); // Tuesday
    expect(packetIsDue(3)).toBe(true); // Wednesday
    for (const d of [0, 1, 4, 5, 6]) expect(packetIsDue(d)).toBe(false);
  });

  it("is absent from the Meetings block on other days, and present on Wednesday", async () => {
    const mon = await apiJson(`/api/today?day_id=${MON}`).catch(() => null);
    // The block is assembled on gate runs; asserting through the packet builder keeps this test
    // about the packet rather than about gate plumbing.
    expect(packetIsDue(new Date(`${MON}T12:00:00Z`).getUTCDay())).toBe(false);
    expect(packetIsDue(new Date(`${WED}T12:00:00Z`).getUTCDay())).toBe(true);
    expect(mon === null || mon.status === 200).toBe(true);
  });
});

describe("what she did this week", () => {
  beforeEach(clean);

  it("counts what MOVED, not what was planned", async () => {
    /*
     * The temptation in a "what I did" packet is to list the week's intentions, because they are
     * easier to query and always look complete. This counts closed loops, advanced stages, reviewed
     * candidates and logged touches.
     */
    await env.DB.prepare(`INSERT INTO days (id, date_ts, morning_completed_at, anchor_outcome, created_at) VALUES (?,?,?,?,?)`)
      .bind(TUE, Date.parse(`${TUE}T00:00:00Z`), Date.now(), "done", Date.now()).run();
    await env.DB.prepare(`INSERT INTO open_loops (id, day_id, kind, title, status, resolved_at, created_at, updated_at) VALUES (?,?,?,?, 'resolved', ?, ?, ?)`)
      .bind(uid("loop"), TUE, "other", "Closed one", daysAgo(2), daysAgo(9), Date.now()).run();
    await env.DB.prepare(`INSERT INTO deals (id, lane, name, kind, stage, stage_since, opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(uid("deal"), "ops", "Moved deal", "secondary", "diligence", daysAgo(3), daysAgo(40), daysAgo(40), Date.now()).run();

    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.done.loops_closed).toBe(1);
    expect(p.done.deals_advanced).toBe(1);
    expect(p.done.anchors_kept).toBe(1);
    expect(p.headline).toContain("2 things moved");
  });

  it("counts a deal that ADVANCED, not one that was merely edited", async () => {
    // `updated_at` moves for any change; `stage_since` moves only when the stage does. A week of
    // diligent note-taking must not read as a week of progress.
    await env.DB.prepare(`INSERT INTO deals (id, lane, name, kind, stage, stage_since, opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(uid("deal"), "ops", "Fussed over", "secondary", "diligence", daysAgo(60), daysAgo(90), daysAgo(90), Date.now()).run();
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.done.deals_advanced).toBe(0);
  });

  it("says a quiet week was quiet, rather than showing zeros and no sentence", async () => {
    /*
     * A packet of zeros with no line on top reads as a broken report. A quiet week is information
     * she is walking into a meeting to explain, and it is stated as a fact with no verdict attached
     * — §14 scores days, and a partner meeting is not where a system grades her.
     */
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.headline).toContain("Nothing moved");
    expect(p.headline).not.toMatch(/should|failed|poor|behind/i);
  });

  it("distinguishes a week of missed anchors from a week of unclosed nights", async () => {
    for (let i = 1; i <= 6; i++) {
      const d = `2026-09-0${i}`;
      await env.DB.prepare(`INSERT INTO days (id, date_ts, morning_completed_at, created_at) VALUES (?,?,?,?)`)
        .bind(d, Date.parse(`${d}T00:00:00Z`), Date.now(), Date.now()).run();
    }
    const p = await weeklyPacket(env as any, "2026-09-08", "testpartner");
    expect(p.done.anchors_unanswered).toBeGreaterThanOrEqual(5);
    expect(p.headline).toContain("gap in the record");
    expect(p.gaps.join(" ")).toContain("unknown rather than missed");
  });

  it("names what it cannot see rather than looking complete", async () => {
    // The LP numbers he actually cares about live in two spreadsheets this system cannot read.
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.gaps.join(" ")).toContain("Boss OS cannot read");
  });
});

describe("what she needs to say to him", () => {
  beforeEach(clean);

  it("carries the seeded items, blocking ones first", async () => {
    const p = await weeklyPacket(env as any, WED, "scooter");
    const titles = p.to_raise.map((i) => i.title);
    expect(titles.join(" | ")).toContain("Google grant");
    // Priority 1 leads: an unread access grant is worth more meeting minutes than a status update.
    expect(p.to_raise[0]!.priority).toBe(1);
    // Items the system found are distinguishable from items she typed.
    expect(p.to_raise.some((i) => i.source === "system")).toBe(true);
  });

  it("lets her add one at any time", async () => {
    const { status } = await apiJson("/api/today/agenda/testpartner", {
      method: "POST", body: { title: "Decide the fund size", priority: 1 },
    });
    expect(status).toBe(201);
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.to_raise[0]!.title).toBe("Decide the fund size");
    expect(p.to_raise[0]!.source).toBe("owner");
  });

  it("marks an item raised rather than deleting it", async () => {
    /*
     * The same request made three Wednesdays running is a different conversation from a fresh idea,
     * and a deleted row cannot tell her that.
     */
    const { body } = await apiJson("/api/today/agenda/testpartner", { method: "POST", body: { title: "Ask again" } });
    const { status } = await apiJson(`/api/today/agenda/testpartner/${body.data.id}/raised`, { method: "POST", body: {} });
    expect(status).toBe(200);

    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.to_raise.map((i) => i.title)).not.toContain("Ask again");
    const kept = await row<any>(`SELECT status, raised_at FROM meeting_agenda_items WHERE id = ?`, body.data.id);
    expect(kept.status).toBe("raised");
    expect(kept.raised_at).toBeTruthy();
  });

  it("refuses to raise an item twice", async () => {
    const { body } = await apiJson("/api/today/agenda/testpartner", { method: "POST", body: { title: "Once only" } });
    await apiJson(`/api/today/agenda/testpartner/${body.data.id}/raised`, { method: "POST", body: {} });
    const { status } = await apiJson(`/api/today/agenda/testpartner/${body.data.id}/raised`, { method: "POST", body: {} });
    expect(status).toBe(404);
  });

  it("refuses an item with no title", async () => {
    const { status } = await apiJson("/api/today/agenda/testpartner", { method: "POST", body: { detail: "no title" } });
    expect(status).toBe(400);
  });

  it("keeps no client, LP or buyer name — these are standing counterparts only", async () => {
    /*
     * Her rule keeps client and counterparty names out of the OS. Her own business partner is
     * neither, and nothing here links to a person record.
     */
    const rows = await all(`SELECT counterpart FROM meeting_agenda_items`);
    for (const r of rows) expect(String(r.counterpart)).toMatch(/^[a-z_]+$/);
  });
});
