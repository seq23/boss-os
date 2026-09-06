/**
 * The before-meeting brief — canon §40's meeting intelligence, first half.
 *
 * The existing `tpl_meeting_dossier` template has, until this phase, had
 * nowhere to write: it names an output contract ("who they are, what they want,
 * what you want, three questions, one ask, known landmines") and no table held
 * the result. The brief is that contract, filled from real rows.
 *
 * Nothing here invents content. Every section either cites the row it came from
 * or says it is unavailable and why. A dossier that guesses is worse than a
 * dossier that admits the gap, because the Boss cannot tell the difference in
 * the room.
 */

import { newId } from "../lib/id";
import { conflict, notFound } from "../lib/http";
import { rescoreRelationship, type RelationshipRow } from "./scoring";

const DAY_MS = 86_400_000;

/** The template's output contract asks for three. Canon §5 caps it there too. */
export const SUGGESTED_QUESTION_COUNT = 3;

export const DOSSIER_TEMPLATE_ID = "tpl_meeting_dossier";

export interface MeetingRow {
  id: string;
  lane: string;
  person_id: string;
  relationship_id: string | null;
  organization_id: string | null;
  title: string;
  purpose: string | null;
  the_ask: string | null;
  scheduled_at: number;
  duration_min: number | null;
  location: string | null;
  status: string;
  held_at: number | null;
  created_at: number;
  updated_at: number;
}

interface PersonRow {
  id: string;
  full_name: string;
  role: string | null;
  organization_id: string | null;
  bio: string | null;
  privacy_class: string;
  email: string | null;
}

interface FollowUpRow {
  id: string;
  owner: string;
  title: string;
  due_at: number;
  status: string;
}

interface PriorMeetingRow {
  id: string;
  title: string;
  scheduled_at: number;
  status: string;
  captured_at: number | null;
  notes: string | null;
  sentiment: string | null;
  commitments_made: string | null;
  commitments_received: string | null;
}

function absent(reason: string) {
  return { available: false as const, reason };
}

function present<T>(value: T) {
  return { available: true as const, value };
}

function parseList(raw: string | null): { text: string; due_at?: number }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function days(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** `{{key}}` substitution, the same shape the template library already uses. */
export function renderTemplate(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? `(${key} not given)`);
}

export interface GeneratedBrief {
  id: string;
  meeting_id: string;
  template_id: string | null;
  generated_at: number;
  dossier: unknown;
  relationship_history: unknown;
  suggested_questions: { question: string; why: string; source_type: string; source_id: string | null }[];
  the_ask: unknown;
  prompt: string | null;
}

/**
 * Builds and stores the brief for one meeting.
 *
 * A meeting gets one brief. Regenerating it would overwrite the preparation the
 * Boss has already read, so a second request is refused rather than silently
 * replacing what was there.
 */
export async function generateBrief(
  db: D1Database,
  meetingId: string,
  now = Date.now(),
): Promise<GeneratedBrief> {
  const meeting = await db.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(meetingId).first<MeetingRow>();
  if (!meeting) throw notFound("No meeting with that id");
  if (meeting.status === "cancelled") throw conflict("That meeting is cancelled", "Briefing it would prepare you for a room nobody is in.");

  const existing = await db
    .prepare(`SELECT id, generated_at FROM meeting_briefs WHERE meeting_id = ?`)
    .bind(meetingId)
    .first<{ id: string; generated_at: number }>();
  if (existing) {
    throw conflict(
      "That meeting already has a brief",
      "A brief is preparation, not a document to regenerate. Read the one you have, or capture the meeting.",
    );
  }

  // Scores are re-derived before they are quoted: a brief that reports a stale
  // health number is a brief that argues from a number nobody would defend.
  if (meeting.relationship_id) await rescoreRelationship(db, meeting.relationship_id, now);

  const [person, relationship, organization, priorMeetings, followUps, memories, template] = await Promise.all([
    db.prepare(`SELECT * FROM people WHERE id = ?`).bind(meeting.person_id).first<PersonRow>(),
    meeting.relationship_id
      ? db.prepare(`SELECT * FROM relationships WHERE id = ?`).bind(meeting.relationship_id).first<RelationshipRow>()
      : Promise.resolve(null),
    meeting.organization_id
      ? db.prepare(`SELECT id, name, kind, notes FROM organizations WHERE id = ?`).bind(meeting.organization_id)
          .first<{ id: string; name: string; kind: string | null; notes: string | null }>()
      : Promise.resolve(null),
    db
      .prepare(
        `SELECT m.id, m.title, m.scheduled_at, m.status,
                c.captured_at, c.notes, c.sentiment, c.commitments_made, c.commitments_received
           FROM meetings m
      LEFT JOIN meeting_captures c ON c.meeting_id = m.id
          WHERE m.person_id = ? AND m.id <> ? AND m.scheduled_at <= ?
          ORDER BY m.scheduled_at DESC
          LIMIT 5`,
      )
      .bind(meeting.person_id, meeting.id, meeting.scheduled_at)
      .all<PriorMeetingRow>(),
    db
      .prepare(
        `SELECT id, owner, title, due_at, status FROM follow_ups
          WHERE person_id = ? AND status IN ('open','dropped')
          ORDER BY due_at ASC LIMIT 25`,
      )
      .bind(meeting.person_id)
      .all<FollowUpRow>(),
    db
      .prepare(
        `SELECT m.id, m.title, m.body, m.tier, m.created_at
           FROM memory_items m
           JOIN meeting_captures c ON c.id = m.source_id
           JOIN meetings mt ON mt.id = c.meeting_id
          WHERE mt.person_id = ? AND m.source_type = 'meeting_capture' AND m.status = 'active'
          ORDER BY m.created_at DESC LIMIT 10`,
      )
      .bind(meeting.person_id)
      .all<{ id: string; title: string; body: string; tier: string; created_at: number }>(),
    db
      .prepare(`SELECT id, prompt, output_contract FROM task_templates WHERE id = ? AND enabled = 1`)
      .bind(DOSSIER_TEMPLATE_ID)
      .first<{ id: string; prompt: string | null; output_contract: string }>(),
  ]);

  if (!person) throw notFound("The meeting points at a person who is not on file");

  const prior = priorMeetings.results ?? [];
  const held = prior.filter((m) => m.captured_at !== null);
  const openFollowUps = (followUps.results ?? []).filter((f) => f.status === "open");
  const droppedFollowUps = (followUps.results ?? []).filter((f) => f.status === "dropped");
  const overdue = openFollowUps.filter((f) => f.due_at < now);
  const owedByBoss = openFollowUps.filter((f) => f.owner === "boss");
  const owedByThem = openFollowUps.filter((f) => f.owner === "them");
  const lastCapture = held[0] ?? null;

  // ── Who they are ─────────────────────────────────────────────────────────
  const whoTheyAre = {
    name: person.full_name,
    role: person.role ?? null,
    organization: organization ? { id: organization.id, name: organization.name, kind: organization.kind } : null,
    relationship_kind: relationship?.kind ?? null,
    privacy_class: person.privacy_class,
    bio: person.bio ? present(person.bio) : absent("No background has been written for this person yet."),
    scores: relationship
      ? {
          strategic_importance: relationship.strategic_importance,
          trust_level: relationship.trust_level,
          recency_score: relationship.recency_score,
          opportunity_value: relationship.opportunity_value,
          relationship_health: relationship.relationship_health,
        }
      : null,
    scores_note: relationship ? null : "No relationship record exists for this person, so there is nothing scored.",
  };

  // ── What they want ───────────────────────────────────────────────────────
  // Evidence only: what they are waiting on you for, and what they asked for
  // last time. Never a guess about motive.
  const theirWants: { text: string; source_type: string; source_id: string }[] = [];
  for (const f of owedByBoss) {
    theirWants.push({ text: `Waiting on you: ${f.title} (due ${isoDay(f.due_at)})`, source_type: "follow_up", source_id: f.id });
  }
  if (lastCapture) {
    for (const c of parseList(lastCapture.commitments_made)) {
      theirWants.push({ text: `Asked for last time: ${c.text}`, source_type: "meeting", source_id: lastCapture.id });
    }
  }
  const whatTheyWant = theirWants.length
    ? present(theirWants.slice(0, 5))
    : absent("Nothing on record says what they want. No prior capture and nothing outstanding.");

  // ── What we want ─────────────────────────────────────────────────────────
  const whatWeWant = meeting.purpose
    ? present(meeting.purpose)
    : absent("No purpose was recorded for this meeting. Decide it before you walk in.");

  // ── Landmines ────────────────────────────────────────────────────────────
  const landmines: { text: string; severity: string; source_type: string; source_id: string | null }[] = [];
  for (const f of overdue.filter((f) => f.owner === "boss")) {
    landmines.push({
      text: `You are ${days(now - f.due_at)} day${days(now - f.due_at) === 1 ? "" : "s"} late on: ${f.title}`,
      severity: "high", source_type: "follow_up", source_id: f.id,
    });
  }
  for (const f of droppedFollowUps) {
    landmines.push({ text: `You dropped rather than kept: ${f.title}`, severity: "high", source_type: "follow_up", source_id: f.id });
  }
  if (relationship && relationship.trust_level < 40) {
    landmines.push({
      text: `Trust is recorded at ${relationship.trust_level}/100. Treat agreement in the room as provisional.`,
      severity: "medium", source_type: "relationship", source_id: relationship.id,
    });
  }
  if (relationship?.last_contact_at && relationship.recency_score === 0) {
    landmines.push({
      text: `You have not been in contact since ${isoDay(relationship.last_contact_at)}. Expect to re-establish context.`,
      severity: "medium", source_type: "relationship", source_id: relationship.id,
    });
  }
  if (relationship && relationship.last_contact_at === null) {
    landmines.push({
      text: "No contact has ever been recorded with this person. Nothing here is warm.",
      severity: "medium", source_type: "relationship", source_id: relationship.id,
    });
  }

  // ── Suggested questions ──────────────────────────────────────────────────
  const questions = suggestQuestions({
    person, relationship, meeting, owedByThem, overdue, lastCapture, priorHeld: held.length, now,
  });

  // ── Relationship history ─────────────────────────────────────────────────
  const relationshipHistory = {
    meetings: prior.map((m) => ({
      id: m.id,
      title: m.title,
      scheduled_at: m.scheduled_at,
      captured: m.captured_at !== null,
      sentiment: m.sentiment,
      commitments_made: parseList(m.commitments_made),
      commitments_received: parseList(m.commitments_received),
    })),
    meetings_held: held.length,
    first_meeting_at: prior.length ? prior[prior.length - 1].scheduled_at : null,
    last_capture: lastCapture
      ? { meeting_id: lastCapture.id, captured_at: lastCapture.captured_at, sentiment: lastCapture.sentiment, notes: lastCapture.notes }
      : null,
    open_follow_ups: openFollowUps.map((f) => ({ id: f.id, owner: f.owner, title: f.title, due_at: f.due_at, overdue: f.due_at < now })),
    overdue_follow_ups: overdue.length,
    dropped_follow_ups: droppedFollowUps.length,
    remembered: (memories.results ?? []).map((m) => ({ id: m.id, title: m.title, tier: m.tier, created_at: m.created_at })),
    scores: relationship
      ? {
          strategic_importance: relationship.strategic_importance,
          trust_level: relationship.trust_level,
          recency_score: relationship.recency_score,
          opportunity_value: relationship.opportunity_value,
          relationship_health: relationship.relationship_health,
          cadence_days: relationship.cadence_days,
          last_contact_at: relationship.last_contact_at,
          next_touch_due_at: relationship.next_touch_due_at,
          detail: relationship.score_detail ? JSON.parse(relationship.score_detail) : null,
        }
      : null,
  };

  const theAsk = meeting.the_ask
    ? present(meeting.the_ask)
    : absent("No single ask was set for this meeting. One clear ask is the template's contract; decide it before the room.");

  const dossier = {
    who_they_are: whoTheyAre,
    what_they_want: whatTheyWant,
    what_we_want: whatWeWant,
    landmines,
    landmines_note: landmines.length ? null : "Nothing on file suggests a landmine. That is the record, not a guarantee.",
    output_contract: template?.output_contract ?? null,
  };

  const prompt = template?.prompt
    ? renderTemplate(template.prompt, {
        person: `${person.full_name}${person.role ? `, ${person.role}` : ""}${organization ? ` (${organization.name})` : ""}`,
        context: meeting.purpose ?? meeting.title,
      })
    : null;

  const id = newId("brf");
  await db
    .prepare(
      `INSERT INTO meeting_briefs
         (id, meeting_id, template_id, generated_at, dossier, relationship_history, suggested_questions, the_ask, prompt, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, meeting.id, template?.id ?? null, now,
      JSON.stringify(dossier), JSON.stringify(relationshipHistory), JSON.stringify(questions),
      JSON.stringify(theAsk), prompt, now,
    )
    .run();

  // 'briefed' only moves forward from 'scheduled'; a captured meeting keeps its
  // status, because a brief written after the fact does not un-hold it.
  await db
    .prepare(`UPDATE meetings SET status = 'briefed', updated_at = ? WHERE id = ? AND status = 'scheduled'`)
    .bind(now, meeting.id)
    .run();

  return {
    id,
    meeting_id: meeting.id,
    template_id: template?.id ?? null,
    generated_at: now,
    dossier,
    relationship_history: relationshipHistory,
    suggested_questions: questions,
    the_ask: theAsk,
    prompt,
  };
}

/**
 * Three questions, chosen from what is actually true about this relationship.
 *
 * Each candidate carries the row that justifies it. Generic questions exist at
 * the bottom of the list only so the brief is never empty; anything real
 * outranks them.
 */
function suggestQuestions(ctx: {
  person: PersonRow;
  relationship: RelationshipRow | null;
  meeting: MeetingRow;
  owedByThem: FollowUpRow[];
  overdue: FollowUpRow[];
  lastCapture: PriorMeetingRow | null;
  priorHeld: number;
  now: number;
}): { question: string; why: string; source_type: string; source_id: string | null }[] {
  const { person, relationship, meeting, owedByThem, overdue, lastCapture, priorHeld, now } = ctx;
  const candidates: { question: string; why: string; source_type: string; source_id: string | null }[] = [];

  for (const f of owedByThem) {
    candidates.push({
      question: `Where did "${f.title}" land?`,
      why: `They committed to it${f.due_at < now ? ` and it was due ${isoDay(f.due_at)}` : `, due ${isoDay(f.due_at)}`}.`,
      source_type: "follow_up",
      source_id: f.id,
    });
  }

  const lateOwed = overdue.filter((f) => f.owner === "boss")[0];
  if (lateOwed) {
    candidates.push({
      question: `I owe you "${lateOwed.title}" — is it still the thing you need, or has it changed?`,
      why: `You are late on it. Naming it first is cheaper than being asked.`,
      source_type: "follow_up",
      source_id: lateOwed.id,
    });
  }

  if (lastCapture?.captured_at) {
    candidates.push({
      question: `What has changed for you since ${isoDay(lastCapture.captured_at)}?`,
      why: "There is a capture from that meeting to compare the answer against.",
      source_type: "meeting",
      source_id: lastCapture.id,
    });
  }

  if (relationship && relationship.recency_score < 40 && relationship.last_contact_at) {
    candidates.push({
      question: `It has been ${days(now - relationship.last_contact_at)} days — what is taking most of your attention now?`,
      why: `Recency scores ${relationship.recency_score}/100 against a ${relationship.cadence_days}-day cadence.`,
      source_type: "relationship",
      source_id: relationship.id,
    });
  }

  if (relationship && relationship.trust_level < 50) {
    candidates.push({
      question: "What would make working together feel worth your time?",
      why: `Trust is recorded at ${relationship.trust_level}/100; this is a trust question, not a deal question.`,
      source_type: "relationship",
      source_id: relationship.id,
    });
  }

  if (relationship && relationship.opportunity_value >= 60) {
    candidates.push({
      question: "If we did one thing together in the next quarter, what should it be?",
      why: `Opportunity value is recorded at ${relationship.opportunity_value}/100.`,
      source_type: "relationship",
      source_id: relationship.id,
    });
  }

  if (relationship && relationship.strategic_importance >= 70 && priorHeld === 0) {
    candidates.push({
      question: "Who else should I know, and what should I have asked you that I have not?",
      why: `Strategic importance is ${relationship.strategic_importance}/100 and this is the first meeting on record.`,
      source_type: "relationship",
      source_id: relationship.id,
    });
  }

  if (meeting.purpose) {
    candidates.push({
      question: `On ${meeting.purpose} — what would make that easy for you to say yes to?`,
      why: "It is the purpose recorded for this meeting.",
      source_type: "meeting",
      source_id: meeting.id,
    });
  }

  candidates.push({
    question: `What is the most useful thing I could do for you in the next 90 days?`,
    why: `Nothing more specific is on record for ${person.full_name} yet.`,
    source_type: "person",
    source_id: person.id,
  });

  const seen = new Set<string>();
  const chosen: typeof candidates = [];
  for (const c of candidates) {
    if (seen.has(c.question)) continue;
    seen.add(c.question);
    chosen.push(c);
    if (chosen.length === SUGGESTED_QUESTION_COUNT) break;
  }
  return chosen;
}
