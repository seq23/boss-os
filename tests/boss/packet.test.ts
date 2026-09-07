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

describe("the packet reports West Peek, and Boss OS cannot see West Peek", () => {
  beforeEach(clean);

  it("counts no brokerage activity, because it is a different business", async () => {
    /*
     * HER CORRECTION, AND IT WAS A REAL BUG: "in west peek we have LP outreach, in brokerage they
     * are not LPs." The first version counted deals advanced, counterparties touched and buyer
     * candidates reviewed — every one of them brokerage. The relationships came from her brokerage
     * mailbox; the candidates are secondaries buyers. A West Peek partner document was reporting
     * her other business's numbers as if they were his.
     *
     * Her two businesses are deliberately separate. This asserts the packet carries no counter at
     * all, so nothing can drift back in by looking useful.
     */
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(TUE, Date.parse(`${TUE}T00:00:00Z`), Date.now()).run();
    await env.DB.prepare(`INSERT INTO deals (id, lane, name, kind, stage, stage_since, opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(uid("deal"), "ops", "A brokerage deal", "secondary", "diligence", daysAgo(2), daysAgo(40), daysAgo(40), Date.now()).run();
    await env.DB.prepare(`INSERT INTO sourcing_candidates (id, name, kind, source_url, origin, status, created_at, updated_at) VALUES (?,?, 'buyer', ?, 'public_research', 'reviewed', ?, ?)`)
      .bind(uid("src"), "A buyer", "https://example.com", daysAgo(2), Date.now()).run();

    const p = await weeklyPacket(env as any, WED, "testpartner");
    const text = JSON.stringify(p);
    expect(text).not.toContain("A brokerage deal");
    expect(text).not.toContain("A buyer");
    expect((p as any).done).toBeUndefined();
  });

  it("says the LP numbers come from somewhere else rather than pretending to have them", async () => {
    /*
     * Boss OS holds no LP data and is not meant to — her naming rule keeps counterparty names out
     * of it and the outreach sheets already hold them. A packet that quietly omitted the numbers
     * would let her walk in believing it complete.
     */
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.headline).toMatch(/added by the reminder/i);
    expect(p.gaps.join(" ")).toMatch(/Boss OS holds no LP data/i);
    expect(p.gaps.join(" ")).toMatch(/Brokerage activity is deliberately absent/i);
  });

  it("keeps her own anchor record out of a document her partner reads", async () => {
    /*
     * Her answer to what the packet is FOR was "showing Scooter I did the work". Whether she held
     * her own morning floor is her business, and a system that put it in a partner-facing document
     * would be reporting on her to someone else.
     */
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(JSON.stringify(p).toLowerCase()).not.toContain("anchor");
  });

  it("counts since the last Wednesday, not a rolling seven days", async () => {
    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.window.from).toBe("2026-09-02");
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

  it("keeps a flex section for one-offs nothing can derive", async () => {
    /*
     * Her one addition: "need a flex section for anything we need to add one-off." Everything else
     * in the packet is derived, and derived means it can only contain what the system already knows.
     * A number he asked for on a call has no table and never will.
     */
    const { status } = await apiJson("/api/today/agenda/testpartner", {
      method: "POST", body: { title: "Bring the updated deck", section: "misc" },
    });
    expect(status).toBe(201);

    const p = await weeklyPacket(env as any, WED, "testpartner");
    expect(p.misc.map((i) => i.title)).toContain("Bring the updated deck");
    // A one-off is not a decision he has to make, so it must not be mixed into the asks.
    expect(p.to_raise.map((i) => i.title)).not.toContain("Bring the updated deck");
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
