import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row } from "./helpers";
import { healthScore, recencyScore } from "../../src/worker/boss/relationships/scoring";

/**
 * Phase 13 — Relationship Capital OS.
 *
 * The acceptance sentence for this phase is a sequence, not a table: a meeting
 * produces a brief before and a capture after, and the capture creates at least
 * one follow-up and at least one memory promotion candidate. Most of what is
 * below walks that sequence against a real database and checks what it left
 * behind, rather than checking that rows can be inserted.
 */

const DAY = 86_400_000;

let seq = 0;
const nextName = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

async function newPerson(over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/relationships/people", {
    method: "POST",
    body: { full_name: nextName("Test Person"), role: "Founder", ...over },
  });
  expect(status).toBe(201);
  return body.data as any;
}

async function newRelationship(personId: string, over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/relationships", {
    method: "POST",
    body: { person_id: personId, kind: "investor", strategic_importance: 80, trust_level: 60, opportunity_value: 70, ...over },
  });
  expect(status).toBe(201);
  return body.data as any;
}

async function newMeeting(personId: string, over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/relationships/meetings", {
    method: "POST",
    body: {
      person_id: personId,
      title: nextName("Test Meeting"),
      purpose: "Agree the terms of the next round",
      the_ask: "A written commitment by the end of the month",
      scheduled_at: Date.now(),
      ...over,
    },
  });
  expect(status).toBe(201);
  return body.data as any;
}

describe("Phase 13 — the five scoring dimensions", () => {
  it("stores the three judgements and derives the two that are derived", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id, {
      strategic_importance: 90, trust_level: 70, opportunity_value: 40,
      cadence_days: 30, last_contact_at: Date.now() - 10 * DAY,
    });

    expect(rel.strategic_importance).toBe(90);
    expect(rel.trust_level).toBe(70);
    expect(rel.opportunity_value).toBe(40);
    // Contacted inside the cadence, so recency is full.
    expect(rel.recency_score).toBe(100);
    expect(rel.relationship_health).toBeGreaterThan(0);

    const detail = JSON.parse(rel.score_detail);
    expect(detail.weights.trust_level).toBeGreaterThan(0);
    expect(detail.inputs.strategic_importance).toBe(90);
    expect(detail.penalties).toEqual([]);
    expect(rel.next_touch_due_at).toBe(rel.last_contact_at + 30 * DAY);
  });

  it("decays recency with silence and reaches zero at three cadences", () => {
    const now = Date.now();
    expect(recencyScore(null, 30, now)).toBe(0);
    expect(recencyScore(now - 10 * DAY, 30, now)).toBe(100);
    expect(recencyScore(now - 60 * DAY, 30, now)).toBe(50);
    expect(recencyScore(now - 95 * DAY, 30, now)).toBe(0);
  });

  it("penalises a relationship for what is owed and not delivered", () => {
    const base = {
      strategic_importance: 80, trust_level: 70, recency_score: 100,
      opportunity_value: 60, dropped_commitments: 0, ever_contacted: true,
    };
    const clean = healthScore({ ...base, overdue_follow_ups: 0 });
    const late = healthScore({ ...base, overdue_follow_ups: 2 });
    const dropped = healthScore({ ...base, overdue_follow_ups: 0, dropped_commitments: 2 });

    expect(late.health).toBeLessThan(clean.health);
    expect(dropped.health).toBeLessThan(clean.health);
    expect(late.detail.penalties[0]!.reason).toMatch(/late/);
    // The cap is real: ten late follow-ups do not zero a relationship.
    expect(healthScore({ ...base, overdue_follow_ups: 10 }).detail.penalty_total).toBe(24);
  });

  it("re-derives health when a follow-up goes overdue", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id, { last_contact_at: Date.now() - 2 * DAY });
    const before = rel.relationship_health;

    await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Send the deck", due_at: Date.now() - 3 * DAY },
    });

    const { body } = await apiJson(`/api/relationships/${rel.id}/rescore`, { method: "POST" });
    expect(body.data.relationship_health).toBeLessThan(before);
    expect(JSON.parse(body.data.score_detail).penalties.length).toBeGreaterThan(0);
  });

  it("refuses to be told what the derived dimensions are", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id);
    const { status, body } = await apiJson(`/api/relationships/${rel.id}`, {
      method: "PATCH",
      body: { relationship_health: 100 },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/derived/);
  });

  it("keeps one relationship per person", async () => {
    const person = await newPerson();
    await newRelationship(person.id);
    const { status, body } = await apiJson("/api/relationships", {
      method: "POST",
      body: { person_id: person.id },
    });
    expect(status).toBe(409);
    expect(body.hint).toMatch(/one tie/);
  });
});

describe("Phase 13 — the substrate reads back", () => {
  it("lists organizations, people, relationships and meetings on their own routes", async () => {
    const { body: org } = await apiJson("/api/relationships/organizations", {
      method: "POST", body: { name: nextName("Meridian Partners"), kind: "firm" },
    });
    const person = await newPerson({ organization_id: org.data.id });
    const rel = await newRelationship(person.id);
    const meeting = await newMeeting(person.id);

    const orgs = await apiJson("/api/relationships/organizations");
    expect(orgs.status).toBe(200);
    expect(orgs.body.data.some((o: any) => o.id === org.data.id)).toBe(true);

    const people = await apiJson("/api/relationships/people");
    expect(people.body.data.find((p: any) => p.id === person.id).organization_name).toBe(org.data.name);

    const list = await apiJson("/api/relationships");
    const listed = list.body.data.find((r: any) => r.id === rel.id);
    expect(listed.full_name).toBe(person.full_name);
    expect(listed.meetings_count).toBe(1);

    const meetings = await apiJson("/api/relationships/meetings");
    expect(meetings.body.data.some((m: any) => m.id === meeting.id)).toBe(true);

    const one = await apiJson(`/api/relationships/${rel.id}`);
    expect(one.body.data.person_id).toBe(person.id);

    const profile = await apiJson(`/api/relationships/people/${person.id}`);
    expect(profile.body.data.meetings.length).toBe(1);
    expect(profile.body.data.relationship.id).toBe(rel.id);
  });

  it("refuses a second organization with the same name and an unknown person", async () => {
    const name = nextName("Duplicate Holdings");
    await apiJson("/api/relationships/organizations", { method: "POST", body: { name } });
    const again = await apiJson("/api/relationships/organizations", { method: "POST", body: { name } });
    expect(again.status).toBe(409);

    const meeting = await apiJson("/api/relationships/meetings", {
      method: "POST", body: { person_id: "per_nope", title: "Ghost", scheduled_at: Date.now() },
    });
    expect(meeting.status).toBe(400);
  });

  /**
   * A foreign key that fails inside SQLite is a 500 and a stack trace. Anything
   * a caller can get wrong is checked first, so the answer says what to fix.
   */
  it("answers a bad reference rather than letting a foreign key throw", async () => {
    const person = await newPerson();
    const other = await newPerson();
    const theirMeeting = await newMeeting(other.id);

    const meeting = await apiJson("/api/relationships/meetings", {
      method: "POST",
      body: { person_id: person.id, title: "Wrong org", scheduled_at: Date.now(), organization_id: "org_nope" },
    });
    expect(meeting.status).toBe(400);

    const followUp = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Wrong meeting", due_at: Date.now(), meeting_id: theirMeeting.id },
    });
    expect(followUp.status).toBe(400);
    expect(followUp.body.error).toMatch(/someone else/);
  });
});

describe("Phase 13 — the before-meeting brief", () => {
  it("builds the dossier tpl_meeting_dossier has never had anywhere to write", async () => {
    const person = await newPerson({ role: "General Partner", bio: "Led the seed round at Northwind." });
    await newRelationship(person.id, { trust_level: 30, last_contact_at: Date.now() - 100 * DAY, cadence_days: 30 });
    const meeting = await newMeeting(person.id);

    const { status, body } = await apiJson(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });
    expect(status).toBe(201);
    const brief = body.data;

    expect(brief.template_id).toBe("tpl_meeting_dossier");
    expect(brief.dossier.who_they_are.name).toBe(person.full_name);
    expect(brief.dossier.who_they_are.bio.available).toBe(true);
    expect(brief.dossier.who_they_are.scores.trust_level).toBe(30);
    expect(brief.dossier.what_we_want.available).toBe(true);
    expect(brief.the_ask.available).toBe(true);
    expect(brief.suggested_questions).toHaveLength(3);
    for (const q of brief.suggested_questions) {
      expect(q.question.length).toBeGreaterThan(5);
      expect(q.why.length).toBeGreaterThan(5);
    }

    // The template's prompt is rendered with the real person, not left with holes.
    expect(brief.prompt).toContain(person.full_name);
    expect(brief.prompt).not.toMatch(/\{\{|TODO|FIXME|placeholder/i);

    // Low trust and long silence are landmines, and each cites the row it came from.
    const texts = brief.dossier.landmines.map((l: any) => l.text).join(" ");
    expect(texts).toMatch(/Trust is recorded at 30/);
    expect(texts).toMatch(/not been in contact/);
    for (const l of brief.dossier.landmines) expect(l.source_id).toBeTruthy();

    const stored = await row(`SELECT * FROM meeting_briefs WHERE meeting_id = ?`, meeting.id);
    expect(stored).toBeTruthy();
    expect(await row(`SELECT status FROM meetings WHERE id = ?`, meeting.id)).toMatchObject({ status: "briefed" });
  });

  it("says what it does not know rather than inventing it", async () => {
    const person = await newPerson({ bio: null });
    const meeting = await newMeeting(person.id, { purpose: null, the_ask: null });

    const { body } = await apiJson(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });
    expect(body.data.dossier.who_they_are.bio.available).toBe(false);
    expect(body.data.dossier.what_we_want.available).toBe(false);
    expect(body.data.dossier.what_we_want.reason).toBeTruthy();
    expect(body.data.dossier.what_they_want.available).toBe(false);
    expect(body.data.the_ask.available).toBe(false);
    // No relationship record: the block says so instead of scoring zeroes.
    expect(body.data.dossier.who_they_are.scores).toBeNull();
    expect(body.data.dossier.who_they_are.scores_note).toBeTruthy();
  });

  it("reads the history of the tie, not just the room", async () => {
    const person = await newPerson();
    await newRelationship(person.id);
    const first = await newMeeting(person.id, { scheduled_at: Date.now() - 30 * DAY, title: "First meeting" });
    await api(`/api/relationships/meetings/${first.id}/capture`, {
      method: "POST",
      body: {
        notes: "They want a data room before committing.",
        commitments_made: [{ text: "Send the data room link", due_at: Date.now() - 20 * DAY }],
        commitments_received: [{ text: "Introduce two LPs", due_at: Date.now() - 15 * DAY }],
      },
    });

    const second = await newMeeting(person.id, { title: "Second meeting" });
    const { body } = await apiJson(`/api/relationships/meetings/${second.id}/brief`, { method: "POST" });
    const history = body.data.relationship_history;

    expect(history.meetings_held).toBe(1);
    expect(history.meetings[0].commitments_made[0].text).toBe("Send the data room link");
    expect(history.open_follow_ups.length).toBe(2);
    expect(history.overdue_follow_ups).toBeGreaterThanOrEqual(2);
    expect(history.remembered.length).toBeGreaterThanOrEqual(1);

    // What they want is evidence, not a guess: it cites the follow-up they are waiting on.
    expect(body.data.dossier.what_they_want.available).toBe(true);
    expect(JSON.stringify(body.data.dossier.what_they_want.value)).toContain("Send the data room link");

    // A commitment the Boss is late on is the first question, and it is theirs.
    const questions = body.data.suggested_questions.map((q: any) => q.question).join(" ");
    expect(questions).toMatch(/Introduce two LPs|data room/);
  });

  it("refuses to regenerate a brief over the preparation already read", async () => {
    const person = await newPerson();
    const meeting = await newMeeting(person.id);
    await api(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });
    const { status, body } = await apiJson(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already has a brief/);
  });

  it("has nothing to brief for a meeting that does not exist", async () => {
    const { status } = await apiJson(`/api/relationships/meetings/mtg_nope/brief`, { method: "POST" });
    expect(status).toBe(404);
  });
});

describe("Phase 13 — the after-meeting capture", () => {
  it("creates a follow-up and a memory promotion candidate from one capture", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id, { trust_level: 50, last_contact_at: null });
    const meeting = await newMeeting(person.id);
    await api(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });

    const { status, body } = await apiJson(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST",
      body: {
        notes: "They will not lead but will follow a priced round. Their check size is 500k.",
        commitments_made: [{ text: "Send the updated model" }],
        commitments_received: [{ text: "Confirm the check size in writing" }],
        sentiment: "warm",
        trust_delta: 10,
      },
    });
    expect(status).toBe(201);

    // At least one follow-up — here, one per commitment, each with an owner.
    expect(body.data.follow_ups.length).toBe(2);
    expect(body.data.follow_ups.map((f: any) => f.owner).sort()).toEqual(["boss", "them"]);
    const stored = await all(`SELECT * FROM follow_ups WHERE meeting_id = ?`, meeting.id);
    expect(stored.length).toBe(2);
    for (const f of stored) expect(f.due_at).toBeGreaterThan(0);

    // At least one memory promotion candidate: a capture-tier memory, a proposed
    // promotion event, and a pending approval — the one existing gate.
    expect(body.data.memory_candidates.length).toBeGreaterThanOrEqual(1);
    const candidate = body.data.memory_candidates[0];
    const item = await row(`SELECT * FROM memory_items WHERE id = ?`, candidate.memory_id);
    expect(item!.tier).toBe("capture");
    expect(item!.source_type).toBe("meeting_capture");

    const event = await row(`SELECT * FROM promotion_events WHERE item_id = ?`, candidate.memory_id);
    expect(event!.outcome).toBe("proposed");
    expect(event!.to_tier).toBe("working");

    const approval = await row(`SELECT * FROM approvals WHERE id = ?`, candidate.approval_id);
    expect(approval!.status).toBe("pending");
    expect(approval!.kind).toBe("memory_promotion");

    // The relationship moved: contact is recorded and trust took the delta.
    const after = await row(`SELECT * FROM relationships WHERE id = ?`, rel.id);
    expect(after!.trust_level).toBe(60);
    expect(after!.last_contact_at).toBeGreaterThan(0);
    expect(after!.recency_score).toBe(100);
    expect(await row(`SELECT status FROM meetings WHERE id = ?`, meeting.id)).toMatchObject({ status: "captured" });
  });

  it("still leaves a next step when nothing was committed in the room", async () => {
    const person = await newPerson();
    await newRelationship(person.id);
    const meeting = await newMeeting(person.id);

    const { body } = await apiJson(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST",
      body: { notes: "Mostly catching up. Nothing was decided." },
    });

    expect(body.data.follow_ups.length).toBe(1);
    expect(body.data.follow_ups[0].title).toContain(person.full_name);
    expect(JSON.parse(body.data.follow_ups[0].detail).source).toBe("derived");
    expect(JSON.parse(body.data.follow_ups[0].detail).reason).toBeTruthy();
    expect(body.data.memory_candidates.length).toBe(1);
  });

  it("takes the memories it is given rather than summarising over them", async () => {
    const person = await newPerson();
    const meeting = await newMeeting(person.id);
    const { body } = await apiJson(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST",
      body: {
        notes: "Long conversation about the fund's thesis.",
        memories: [
          { title: "Their fund will not lead pre-seed", body: "Stated twice, unprompted.", confidence: 0.9 },
          { title: "They rate the CTO hire", body: "Called it the reason they are still interested." },
        ],
      },
    });
    expect(body.data.memory_candidates.length).toBe(2);
    const titles = body.data.memory_candidates.map((m: any) => m.title);
    expect(titles).toContain("Their fund will not lead pre-seed");
    const pending = await all(
      `SELECT a.id FROM approvals a WHERE a.kind = 'memory_promotion' AND a.status = 'pending' AND a.origin_id IN (?,?)`,
      body.data.memory_candidates[0].memory_id, body.data.memory_candidates[1].memory_id,
    );
    expect(pending.length).toBe(2);
  });

  it("refuses to rewrite a room that is over", async () => {
    const person = await newPerson();
    const meeting = await newMeeting(person.id);
    await api(`/api/relationships/meetings/${meeting.id}/capture`, { method: "POST", body: { notes: "Held." } });
    const { status, body } = await apiJson(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST", body: { notes: "Held, again." },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already been captured/);
  });

  it("refuses a capture with nothing in it", async () => {
    const person = await newPerson();
    const meeting = await newMeeting(person.id);
    const { status } = await apiJson(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST", body: { notes: "   " },
    });
    expect(status).toBe(400);
  });
});

describe("Phase 13 — follow-ups reach the screen", () => {
  it("surfaces an overdue follow-up into open loops and Today, once", async () => {
    const person = await newPerson();
    await newRelationship(person.id, { strategic_importance: 90 });
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Return their term sheet comments", due_at: Date.now() - 9 * DAY },
    });
    const followUpId = created.data.id;

    const { body: first } = await apiJson("/api/today");
    const loops = await all(`SELECT * FROM open_loops WHERE source_id = ?`, followUpId);
    expect(loops.length).toBe(1);
    expect(loops[0].source_type).toBe("relationship");
    expect(loops[0].kind).toBe("follow_up");
    // Nine days late for a strategically central tie is a high-priority loop.
    expect(loops[0].priority).toBe(1);
    expect(JSON.parse(loops[0].detail).days_late).toBeGreaterThanOrEqual(9);

    const blocks = Object.fromEntries(first.data.blocks.map((b: any) => [b.key, b]));
    expect(blocks.open_loops.content.total).toBeGreaterThanOrEqual(1);
    expect(blocks.meetings.content.follow_ups_overdue).toBeGreaterThanOrEqual(1);

    // Reading the screen again must not stack a second loop for the same commitment.
    await api("/api/today");
    expect((await all(`SELECT * FROM open_loops WHERE source_id = ?`, followUpId)).length).toBe(1);

    const stored = await row(`SELECT loop_id, surfaced_at FROM follow_ups WHERE id = ?`, followUpId);
    expect(stored!.loop_id).toBe(loops[0].id);
    expect(stored!.surfaced_at).toBeGreaterThan(0);
  });

  it("does not let a look at tomorrow take today's overdue commitments", async () => {
    const person = await newPerson();
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Answer their question", due_at: Date.now() - DAY },
    });

    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    await api(`/api/today?date=${tomorrow}`);
    expect(await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id)).toEqual([]);

    // It lands on today, where the Boss actually is.
    const { body } = await apiJson("/api/today");
    const loops = await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id);
    expect(loops.length).toBe(1);
    expect(loops[0].day_id).toBe(body.data.day.id);
  });

  it("leaves a follow-up that is not due yet off the board", async () => {
    const person = await newPerson();
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Quarterly check-in", due_at: Date.now() + 30 * DAY },
    });
    await api("/api/today");
    expect(await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id)).toEqual([]);
  });

  it("closes the commitment when the loop it raised is resolved", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id);
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Send the summary", due_at: Date.now() - DAY },
    });
    await api("/api/today");
    const loop = (await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id))[0];

    const { status } = await apiJson(`/api/today/loops/${loop.id}/resolve`, { method: "POST", body: {} });
    expect(status).toBe(200);

    const followUp = await row(`SELECT status, completed_at FROM follow_ups WHERE id = ?`, created.data.id);
    expect(followUp!.status).toBe("done");
    expect(followUp!.completed_at).toBeGreaterThan(0);
    // Kept, so the health penalty for being late goes with it.
    const scored = await row(`SELECT score_detail FROM relationships WHERE id = ?`, rel.id);
    expect(JSON.parse(scored!.score_detail).inputs.overdue_follow_ups).toBe(0);
  });

  it("carries the commitment onto tomorrow when its loop is deferred", async () => {
    const person = await newPerson();
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Chase the intro", due_at: Date.now() - DAY },
    });
    await api("/api/today");
    const loop = (await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id))[0];

    const { body } = await apiJson(`/api/today/loops/${loop.id}/defer`, { method: "POST", body: {} });
    const followUp = await row(`SELECT status, loop_id FROM follow_ups WHERE id = ?`, created.data.id);
    expect(followUp!.status).toBe("open");
    expect(followUp!.loop_id).toBe(body.data.carried.id);
  });

  it("closes the loop when the commitment itself is completed", async () => {
    const person = await newPerson();
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Send the notes", due_at: Date.now() - DAY },
    });
    await api("/api/today");
    const loop = (await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id))[0];

    await api(`/api/relationships/follow-ups/${created.data.id}/complete`, { method: "POST", body: {} });
    expect(await row(`SELECT status FROM open_loops WHERE id = ?`, loop.id)).toMatchObject({ status: "resolved" });

    const { status } = await apiJson(`/api/relationships/follow-ups/${created.data.id}/complete`, { method: "POST", body: {} });
    expect(status).toBe(409);
  });

  it("costs relationship health when a commitment is dropped rather than kept", async () => {
    const person = await newPerson();
    const rel = await newRelationship(person.id, { last_contact_at: Date.now() - DAY });
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Introduce them to the CFO", due_at: Date.now() + DAY },
    });
    const before = (await row(`SELECT relationship_health FROM relationships WHERE id = ?`, rel.id))!.relationship_health;

    await api(`/api/relationships/follow-ups/${created.data.id}/drop`, { method: "POST", body: {} });
    const after = await row(`SELECT relationship_health, score_detail FROM relationships WHERE id = ?`, rel.id);
    expect(after!.relationship_health).toBeLessThan(before);
    expect(JSON.parse(after!.score_detail).inputs.dropped_commitments).toBe(1);
  });

  it("surfaces on the cron tick as its own recorded step", async () => {
    const person = await newPerson();
    const { body: created } = await apiJson("/api/relationships/follow-ups", {
      method: "POST",
      body: { person_id: person.id, title: "Reply to their email", due_at: Date.now() - 2 * DAY },
    });

    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    await worker.scheduled!({ cron: "0 3 * * *", scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
    await waitOnExecutionContext(ctx);

    expect((await all(`SELECT * FROM open_loops WHERE source_id = ?`, created.data.id)).length).toBe(1);
    const run = await row(`SELECT steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    const steps = JSON.parse(run!.steps);
    expect(steps.map((s: any) => s.name)).toContain("surface_follow_ups");
    expect(steps.find((s: any) => s.name === "surface_follow_ups").status).toBe("ok");
  });
});

describe("Phase 13 — Meetings on the Today screen", () => {
  it("fills canon §15's fourth element from real rows", async () => {
    const person = await newPerson();
    await newRelationship(person.id);
    const meeting = await newMeeting(person.id, { scheduled_at: Date.now() });

    const { body: before } = await apiJson("/api/today");
    const blockBefore = before.data.blocks.find((b: any) => b.key === "meetings");
    expect(blockBefore.content.available).toBeUndefined();
    expect(blockBefore.is_empty).toBe(false);
    const listed = blockBefore.content.meetings.find((m: any) => m.id === meeting.id);
    expect(listed).toBeTruthy();
    expect(listed.full_name).toBe(person.full_name);
    expect(listed.briefed).toBe(false);
    expect(blockBefore.content.unbriefed).toBeGreaterThanOrEqual(1);

    await api(`/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" });
    await api(`/api/relationships/meetings/${meeting.id}/capture`, {
      method: "POST",
      body: { notes: "Agreed to revisit in a month.", commitments_made: [{ text: "Send the one-pager" }] },
    });

    const { body: after } = await apiJson("/api/today");
    const blockAfter = after.data.blocks.find((b: any) => b.key === "meetings");
    const now = blockAfter.content.meetings.find((m: any) => m.id === meeting.id);
    expect(now.briefed).toBe(true);
    expect(now.captured).toBe(true);

    // The block is persisted like every other one, not assembled for the response.
    const persisted = await row(
      `SELECT content, is_empty FROM day_flow_blocks WHERE day_id = ? AND block_key = 'meetings'`,
      after.data.day.id,
    );
    expect(JSON.parse(persisted!.content).meetings.some((m: any) => m.id === meeting.id)).toBe(true);
    expect(persisted!.is_empty).toBe(0);
  });

  it("says nothing was in the diary rather than inventing a day", async () => {
    const { body } = await apiJson("/api/today?date=2039-02-02");
    const block = body.data.blocks.find((b: any) => b.key === "meetings");
    expect(block.content.meetings).toEqual([]);
    expect(block.content.total).toBe(0);
    expect(JSON.stringify(block)).not.toMatch(/TODO|FIXME|lorem|placeholder/i);
  });
});

/**
 * The acceptance sentence for the phase, walked end to end in one test: a
 * meeting produces a brief before and a capture after; the capture creates at
 * least one follow-up and at least one memory promotion candidate; and the
 * follow-up, once due, is on the Today screen.
 */
describe("Phase 13 — acceptance", () => {
  it("brief before, capture after, follow-up and promotion candidate behind it", async () => {
    const { body: org } = await apiJson("/api/relationships/organizations", {
      method: "POST",
      body: { name: nextName("Northwind Capital"), kind: "fund" },
    });
    const person = await newPerson({ organization_id: org.data.id, role: "Managing Partner" });
    const relationship = await newRelationship(person.id, {
      kind: "investor", strategic_importance: 85, trust_level: 55, opportunity_value: 75,
      cadence_days: 21, last_contact_at: Date.now() - 40 * DAY,
    });
    const meeting = await newMeeting(person.id, {
      title: "Series A follow-on",
      purpose: "Decide whether they follow on",
      the_ask: "A soft commitment for 500k",
      scheduled_at: Date.now(),
    });

    // Before the room.
    const { status: briefStatus, body: briefBody } = await apiJson(
      `/api/relationships/meetings/${meeting.id}/brief`, { method: "POST" },
    );
    expect(briefStatus).toBe(201);
    expect(briefBody.data.dossier.who_they_are.organization.name).toBe(org.data.name);
    expect(briefBody.data.suggested_questions.length).toBe(3);
    expect(briefBody.data.relationship_history.scores.strategic_importance).toBe(85);

    // After the room.
    const { status: captureStatus, body: captureBody } = await apiJson(
      `/api/relationships/meetings/${meeting.id}/capture`,
      {
        method: "POST",
        body: {
          notes: "They will follow on at 500k if the round is priced by June.",
          commitments_made: [{ text: "Send the priced-round terms", due_at: Date.now() - DAY }],
          commitments_received: [{ text: "Confirm 500k in writing" }],
          sentiment: "warm",
          trust_delta: 5,
        },
      },
    );
    expect(captureStatus).toBe(201);
    expect(captureBody.data.follow_ups.length).toBeGreaterThanOrEqual(1);
    expect(captureBody.data.memory_candidates.length).toBeGreaterThanOrEqual(1);

    // The promotion candidate is a real card at the one gate.
    const candidate = captureBody.data.memory_candidates[0];
    const approval = await row(`SELECT status, kind, origin_id FROM approvals WHERE id = ?`, candidate.approval_id);
    expect(approval).toMatchObject({ status: "pending", kind: "memory_promotion", origin_id: candidate.memory_id });

    // The overdue commitment is on the screen, and the relationship is scored on it.
    const { body: today } = await apiJson("/api/today");
    const blocks = Object.fromEntries(today.data.blocks.map((b: any) => [b.key, b]));
    const loopTitles = blocks.open_loops.content.loops.map((l: any) => l.title).join(" | ");
    expect(loopTitles).toContain("Send the priced-round terms");
    expect(blocks.meetings.content.meetings.some((m: any) => m.id === meeting.id && m.captured)).toBe(true);

    const scored = await row(`SELECT * FROM relationships WHERE id = ?`, relationship.id);
    expect(scored!.trust_level).toBe(60);
    expect(scored!.recency_score).toBe(100);
    expect(JSON.parse(scored!.score_detail).inputs.overdue_follow_ups).toBe(1);
    expect(scored!.relationship_health).toBeGreaterThan(0);
  });
});
