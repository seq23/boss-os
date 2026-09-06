/**
 * The after-meeting capture — canon §40's meeting intelligence, second half.
 *
 * A meeting that is not captured is a meeting that did not happen, as far as
 * the system is concerned: the commitments live in someone's head and the
 * durable facts are lost. So a capture always leaves two things behind.
 *
 * 1. At least one follow-up. If commitments were made, each becomes one. If
 *    none were, the recap is the commitment — a meeting with no next step is
 *    the failure mode, not a state to record silently.
 * 2. At least one memory promotion candidate. What was learned enters memory at
 *    `capture`, the only tier anything may be created at, and is proposed for
 *    promotion through the one existing gate rather than a second one.
 */

import { newId } from "../lib/id";
import { badRequest, conflict, notFound } from "../lib/http";
import { proposePromotion } from "../routes/memory";
import { clampScore, rescoreRelationship, type RelationshipRow } from "./scoring";
import type { MeetingRow } from "./brief";

const DAY_MS = 86_400_000;

/** Defaults, used only when the commitment carried no date of its own. */
const DUE_OWED_BY_BOSS_MS = 3 * DAY_MS;
const DUE_OWED_BY_THEM_MS = 7 * DAY_MS;
const DUE_RECAP_MS = 2 * DAY_MS;

export const CAPTURE_TEMPLATE_ID = "tpl_after_meeting";

const SENTIMENTS = new Set(["warm", "neutral", "cool"]);

export interface Commitment {
  text: string;
  due_at?: number;
}

export interface CaptureInput {
  notes: string;
  commitments_made?: unknown;
  commitments_received?: unknown;
  sentiment?: unknown;
  trust_delta?: unknown;
  memories?: unknown;
  held_at?: unknown;
}

export interface CaptureResult {
  capture: Record<string, unknown>;
  follow_ups: Record<string, unknown>[];
  memory_candidates: {
    memory_id: string;
    title: string;
    approval_id: string;
    from_tier: string;
    to_tier: string;
  }[];
  relationship: RelationshipRow | null;
}

function commitments(value: unknown, what: string): Commitment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${what} is a list`, "Send [{ text, due_at }].");
  return value.map((raw: any) => {
    const text = typeof raw === "string" ? raw : String(raw?.text ?? "");
    if (!text.trim()) throw badRequest(`An empty ${what.toLowerCase()} entry is not a commitment`);
    const dueAt = raw?.due_at === undefined || raw?.due_at === null ? undefined : Number(raw.due_at);
    if (dueAt !== undefined && !Number.isFinite(dueAt)) throw badRequest("A commitment's due_at is an epoch millisecond timestamp");
    return { text: text.trim(), due_at: dueAt };
  });
}

/**
 * Records the capture and everything it obliges.
 *
 * One capture per meeting: re-capturing would rewrite what was said in a room
 * that is over. Corrections belong in a new memory, not an edited record.
 */
export async function captureMeeting(
  db: D1Database,
  meetingId: string,
  input: CaptureInput,
  now = Date.now(),
): Promise<CaptureResult> {
  const notes = String(input?.notes ?? "").trim();
  if (!notes) throw badRequest("A capture needs the notes from the room", "Send { notes, commitments_made, commitments_received }.");

  const meeting = await db.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(meetingId).first<MeetingRow>();
  if (!meeting) throw notFound("No meeting with that id");
  if (meeting.status === "cancelled") throw conflict("That meeting is cancelled", "There is nothing to capture from a room nobody was in.");

  const existing = await db
    .prepare(`SELECT id FROM meeting_captures WHERE meeting_id = ?`)
    .bind(meetingId)
    .first<{ id: string }>();
  if (existing) {
    throw conflict(
      "That meeting has already been captured",
      "A capture is a record of what was said, not a document to revise. Capture the correction as a new memory instead.",
    );
  }

  const person = await db
    .prepare(`SELECT id, full_name FROM people WHERE id = ?`)
    .bind(meeting.person_id)
    .first<{ id: string; full_name: string }>();
  if (!person) throw notFound("The meeting points at a person who is not on file");

  const made = commitments(input.commitments_made, "Commitments made");
  const received = commitments(input.commitments_received, "Commitments received");

  const sentiment = input.sentiment === undefined || input.sentiment === null ? null : String(input.sentiment);
  if (sentiment !== null && !SENTIMENTS.has(sentiment)) {
    throw badRequest(`"${sentiment}" is not a sentiment`, `One of: ${[...SENTIMENTS].join(", ")}.`);
  }

  const trustDeltaRaw = input.trust_delta === undefined || input.trust_delta === null ? 0 : Number(input.trust_delta);
  if (!Number.isFinite(trustDeltaRaw) || Math.abs(trustDeltaRaw) > 50) {
    throw badRequest("A trust delta is between -50 and 50", "One meeting does not remake a relationship.");
  }
  const trustDelta = Math.round(trustDeltaRaw);

  const heldAtRaw = input.held_at === undefined || input.held_at === null ? meeting.scheduled_at : Number(input.held_at);
  if (!Number.isFinite(heldAtRaw)) throw badRequest("held_at is an epoch millisecond timestamp");
  const heldAt = heldAtRaw;

  const memoriesInput = input.memories === undefined || input.memories === null ? [] : input.memories;
  if (!Array.isArray(memoriesInput)) throw badRequest("memories is a list", "Send [{ title, body }].");

  const captureId = newId("mcp");

  // ── Follow-ups ───────────────────────────────────────────────────────────
  const followUps: {
    id: string; owner: string; title: string; due_at: number; detail: Record<string, unknown>;
  }[] = [];

  for (const c of made) {
    followUps.push({
      id: newId("fup"), owner: "boss", title: c.text,
      due_at: c.due_at ?? now + DUE_OWED_BY_BOSS_MS,
      detail: { source: "commitment_made", meeting_id: meeting.id, person: person.full_name },
    });
  }
  for (const c of received) {
    followUps.push({
      id: newId("fup"), owner: "them", title: c.text,
      due_at: c.due_at ?? now + DUE_OWED_BY_THEM_MS,
      detail: { source: "commitment_received", meeting_id: meeting.id, person: person.full_name },
    });
  }
  if (followUps.length === 0) {
    followUps.push({
      id: newId("fup"), owner: "boss",
      title: `Send ${person.full_name} a recap and the next step`,
      due_at: now + DUE_RECAP_MS,
      detail: {
        source: "derived",
        reason: "No commitment was recorded on either side. The recap is the next step, and a meeting with no next step is the failure this catches.",
        meeting_id: meeting.id,
      },
    });
  }

  // ── Memory candidates ────────────────────────────────────────────────────
  const memoryDrafts = (memoriesInput as any[]).map((m) => {
    const title = String(m?.title ?? "").trim();
    const body = String(m?.body ?? "").trim();
    if (!title || !body) throw badRequest("A memory needs a title and a body");
    const confidence = m?.confidence === undefined ? 0.6 : Number(m.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw badRequest("A memory's confidence is between 0 and 1");
    }
    return { id: newId("mem"), title, body, confidence };
  });

  if (memoryDrafts.length === 0) {
    memoryDrafts.push({
      id: newId("mem"),
      title: `What the meeting with ${person.full_name} established`,
      body: notes,
      confidence: 0.5,
    });
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const statements = [
    db
      .prepare(
        `INSERT INTO meeting_captures
           (id, meeting_id, template_id, captured_at, notes, commitments_made, commitments_received,
            sentiment, trust_delta, follow_up_count, memory_candidate_count, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        captureId, meeting.id, CAPTURE_TEMPLATE_ID, now, notes,
        JSON.stringify(made), JSON.stringify(received), sentiment, trustDelta,
        followUps.length, memoryDrafts.length, now,
      ),
    db.prepare(`UPDATE meetings SET status = 'captured', held_at = ?, updated_at = ? WHERE id = ?`)
      .bind(heldAt, now, meeting.id),
  ];

  for (const f of followUps) {
    statements.push(
      db
        .prepare(
          `INSERT INTO follow_ups
             (id, lane, person_id, relationship_id, meeting_id, capture_id, owner, title, detail, due_at, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
        )
        .bind(
          f.id, meeting.lane, meeting.person_id, meeting.relationship_id, meeting.id, captureId,
          f.owner, f.title, JSON.stringify(f.detail), f.due_at, now, now,
        ),
    );
  }

  for (const m of memoryDrafts) {
    statements.push(
      db
        .prepare(
          `INSERT INTO memory_items (id, lane, tier, title, body, source_type, source_id, confidence, created_at, status)
           VALUES (?,?,'capture',?,?,'meeting_capture',?,?,?,'active')`,
        )
        .bind(m.id, meeting.lane, m.title, m.body, captureId, m.confidence, now),
    );
  }

  await db.batch(statements);

  // Promotion candidates are raised after the batch: each is an approval card
  // plus its promotion event, and the approval must not exist before the memory
  // it points at.
  const candidates: CaptureResult["memory_candidates"] = [];
  for (const m of memoryDrafts) {
    const proposal = await proposePromotion(
      db,
      { id: m.id, lane: meeting.lane, tier: "capture", title: m.title, body: m.body },
      "working",
      {
        reason: `Captured from the meeting with ${person.full_name} on ${new Date(heldAt).toISOString().slice(0, 10)}`,
        now,
      },
    );
    candidates.push({
      memory_id: m.id, title: m.title, approval_id: proposal.approval_id,
      from_tier: proposal.from_tier, to_tier: proposal.to_tier,
    });
  }

  // ── The relationship moves ───────────────────────────────────────────────
  let relationship: RelationshipRow | null = null;
  if (meeting.relationship_id) {
    const current = await db
      .prepare(`SELECT trust_level FROM relationships WHERE id = ?`)
      .bind(meeting.relationship_id)
      .first<{ trust_level: number }>();
    if (current) {
      await db
        .prepare(`UPDATE relationships SET last_contact_at = ?, trust_level = ?, updated_at = ? WHERE id = ?`)
        .bind(
          Math.max(heldAt, 0),
          clampScore(current.trust_level + trustDelta, current.trust_level),
          now,
          meeting.relationship_id,
        )
        .run();
      relationship = await rescoreRelationship(db, meeting.relationship_id, now);
    }
  }

  const capture = await db.prepare(`SELECT * FROM meeting_captures WHERE id = ?`).bind(captureId).first<Record<string, unknown>>();
  const stored = await db
    .prepare(`SELECT * FROM follow_ups WHERE capture_id = ? ORDER BY due_at ASC`)
    .bind(captureId)
    .all<Record<string, unknown>>();

  return {
    capture: capture ?? { id: captureId },
    follow_ups: stored.results ?? [],
    memory_candidates: candidates,
    relationship,
  };
}
