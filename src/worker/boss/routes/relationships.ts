/**
 * Phase 13 — Relationship Capital OS.
 *
 * Canon §40 (relationship capital, meeting intelligence), §10 (privacy class on
 * anything about a person), §51 (Person, Organization, Relationship, Meeting,
 * Follow-Up as first-class objects).
 *
 * The shape of the phase: people and organizations are the substrate,
 * relationships carry the five scores, meetings carry a brief before and a
 * capture after, and follow-ups are what a capture leaves behind. Overdue
 * follow-ups surface onto the day as open loops, which is how a commitment
 * made in a room ends up on the Today screen a week later.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { isLane } from "../../../shared/boss/lanes";
import { clampScore, rescoreRelationship, type RelationshipRow } from "../relationships/scoring";
import { generateBrief } from "../relationships/brief";
import { captureMeeting } from "../relationships/capture";
import { surfaceOverdueFollowUps } from "../relationships/follow_ups";
import { dayId, ensureDay } from "./today";

export const relationships = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

const RELATIONSHIP_KINDS = new Set([
  "investor", "lp", "advisor", "client", "partner", "mentor", "peer",
  "family", "friend", "professional", "other",
]);

const PRIVACY_CLASSES = new Set(["public", "internal", "private", "restricted"]);

const ORG_KINDS = new Set([
  "fund", "firm", "company", "nonprofit", "family_office", "agency", "other",
]);

function requiredText(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(`${what} is required`);
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// ─── Organizations ────────────────────────────────────────────────────────────

relationships.get("/organizations", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT o.*, COUNT(p.id) AS people_count
         FROM organizations o
    LEFT JOIN people p ON p.organization_id = o.id AND p.status = 'active'
        WHERE o.status <> 'archived'
        GROUP BY o.id
        ORDER BY o.name ASC LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

relationships.post("/organizations", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "An organization name");
  const kind = optionalText(b?.kind);
  if (kind && !ORG_KINDS.has(kind)) {
    throw badRequest(`"${kind}" is not a kind of organization`, `One of: ${[...ORG_KINDS].join(", ")}.`);
  }
  const lane = isLane(b?.lane) ? b.lane : "ops";

  const clash = await c.env.DB.prepare(`SELECT id FROM organizations WHERE name = ?`).bind(name).first<{ id: string }>();
  if (clash) throw conflict(`${name} is already on file`, `It is ${clash.id}. Add the person to it rather than creating a second one.`);

  const id = newId("org");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO organizations (id, lane, name, kind, domain, notes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'active',?,?)`,
    )
    .bind(id, lane, name, kind, optionalText(b?.domain), optionalText(b?.notes), now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane, entityType: "organization", entityId: id, action: "created", detail: { name } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`).bind(id).first(), 201);
});

// ─── People ───────────────────────────────────────────────────────────────────

/**
 * The touch list, derived from her mailbox rather than typed.
 *
 * WHY THIS ENDPOINT EXISTS AT ALL. The first design asked her to name five people who had sent her
 * deals. Her verdict was that this is stupid, and the reason is sharper than effort: a list she
 * types is a list of who she REMEMBERS, and the whole failure this instrument catches is that a
 * referral business decays silently. The people who have gone quiet are the first to fall out of
 * memory, so asking the person with the blind spot to enumerate it produces a list with the answer
 * missing. Her mailbox has no blind spot.
 *
 * WHAT ARRIVES HERE IS ALREADY CODE-NAMED. `scripts/ops/contacts-sync.mjs` reads the extraction on
 * her Mac, assigns a stable code name from a hash, and keeps the mapping in a local file that never
 * leaves the machine. This side learns that SANDPIPER has gone 94 days and cannot learn who that
 * is — which is her naming rule honoured by construction rather than by discipline.
 *
 * IT REFUSES A REAL ADDRESS, LOUDLY. An `@` in a code name means the mapping leaked into the
 * payload, and the right response is to reject the whole batch rather than store one and hope
 * somebody notices.
 */
relationships.post("/sync", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const contacts = Array.isArray(b?.contacts) ? b.contacts : null;
  if (!contacts) throw badRequest("Send { contacts: [...] }", "Produced by scripts/ops/contacts-sync.mjs.");

  for (const row of contacts) {
    const name = String(row?.code_name ?? "");
    if (!name) throw badRequest("Every contact needs a code_name");
    if (name.includes("@") || name.includes(".")) {
      throw badRequest(
        `"${name}" looks like a real address, not a code name`,
        "The mapping stays on her machine. Nothing here may carry a counterparty's actual address.",
      );
    }
  }

  const now = Date.now();
  let created = 0;
  let updated = 0;

  for (const row of contacts) {
    const codeName = String(row.code_name);
    const cadence = Math.max(1, Math.round(Number(row.cadence_days) || 30));
    const importance = Math.min(100, Math.max(0, Math.round(Number(row.strategic_importance) || 50)));
    const lastContact = Number(row.last_contact_at) || null;
    /*
     * DUE AGAINST THEIR OWN RHYTHM. Someone she exchanges mail with fortnightly is overdue at three
     * weeks; someone she speaks to twice a year is not. A single default would make one of those
     * two groups permanently wrong, and the noisy one is the group she would learn to ignore.
     */
    const nextDue = lastContact ? lastContact + cadence * 86_400_000 : now;

    const existing = await c.env.DB
      .prepare(`SELECT p.id AS person_id, r.id AS rel_id FROM people p LEFT JOIN relationships r ON r.person_id = p.id WHERE p.full_name = ? LIMIT 1`)
      .bind(codeName)
      .first<{ person_id: string; rel_id: string | null }>();

    if (existing?.rel_id) {
      await c.env.DB
        .prepare(
          `UPDATE relationships
              SET cadence_days = ?, strategic_importance = ?, relationship_health = ?,
                  last_contact_at = ?, next_touch_due_at = ?, scored_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(cadence, importance, importance, lastContact, nextDue, now, now, existing.rel_id)
        .run();
      updated++;
      continue;
    }

    const personId = existing?.person_id ?? newId("per");
    if (!existing?.person_id) {
      await c.env.DB
        .prepare(
          // `restricted` because a counterparty is the most sensitive class of person here, and the
          // row carries a code name precisely so that even this side cannot identify them.
          `INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at)
           VALUES (?, 'ops', ?, 'restricted', ?, ?)`,
        )
        .bind(personId, codeName, now, now)
        .run();
    }
    await c.env.DB
      .prepare(
        `INSERT INTO relationships
           (id, person_id, lane, kind, strategic_importance, trust_level, relationship_health,
            cadence_days, last_contact_at, next_touch_due_at, scored_at, status, created_at, updated_at)
         VALUES (?,?, 'ops', 'professional', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(newId("rel"), personId, importance, importance, importance, cadence, lastContact, nextDue, now, now, now)
      .run();
    created++;
  }

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "relationship", action: "synced_from_mailbox",
    detail: { created, updated, total: contacts.length },
  });

  return ok(c, { created, updated, total: contacts.length }, 201);
});

relationships.get("/people", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.*, o.name AS organization_name,
              r.id AS relationship_id, r.kind AS relationship_kind,
              r.strategic_importance, r.trust_level, r.recency_score,
              r.opportunity_value, r.relationship_health, r.next_touch_due_at
         FROM people p
    LEFT JOIN organizations o ON o.id = p.organization_id
    LEFT JOIN relationships r ON r.person_id = p.id
        WHERE p.status <> 'archived'
        ORDER BY COALESCE(r.strategic_importance, 0) DESC, p.full_name ASC
        LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

relationships.post("/people", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const fullName = requiredText(b?.full_name, "A person's name");
  const lane = isLane(b?.lane) ? b.lane : "ops";
  const privacy = optionalText(b?.privacy_class) ?? "private";
  if (!PRIVACY_CLASSES.has(privacy)) {
    throw badRequest(`"${privacy}" is not a privacy class`, `One of: ${[...PRIVACY_CLASSES].join(", ")}.`);
  }

  const organizationId = optionalText(b?.organization_id);
  if (organizationId) {
    const org = await c.env.DB.prepare(`SELECT id FROM organizations WHERE id = ?`).bind(organizationId).first();
    if (!org) throw badRequest("No organization with that id", "Create it first at POST /api/relationships/organizations.");
  }

  const id = newId("per");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO people (id, lane, full_name, role, organization_id, email, phone, location, bio, privacy_class, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
    )
    .bind(
      id, lane, fullName, optionalText(b?.role), organizationId, optionalText(b?.email),
      optionalText(b?.phone), optionalText(b?.location), optionalText(b?.bio), privacy, now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane, entityType: "person", entityId: id, action: "created", detail: { full_name: fullName } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM people WHERE id = ?`).bind(id).first(), 201);
});

/** Everything known about one person: the tie, the history, what is outstanding. */
relationships.get("/people/:id", async (c) => {
  const id = c.req.param("id");
  const person = await c.env.DB.prepare(`SELECT * FROM people WHERE id = ?`).bind(id).first<any>();
  if (!person) throw notFound("No person with that id");

  const [organization, relationship, meetings, followUps, memories] = await Promise.all([
    person.organization_id
      ? c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`).bind(person.organization_id).first()
      : Promise.resolve(null),
    c.env.DB.prepare(`SELECT * FROM relationships WHERE person_id = ?`).bind(id).first<RelationshipRow>(),
    c.env.DB
      .prepare(
        `SELECT m.*, b.id AS brief_id, b.generated_at AS briefed_at, c.id AS capture_id, c.captured_at
           FROM meetings m
      LEFT JOIN meeting_briefs b ON b.meeting_id = m.id
      LEFT JOIN meeting_captures c ON c.meeting_id = m.id
          WHERE m.person_id = ?
          ORDER BY m.scheduled_at DESC LIMIT 50`,
      )
      .bind(id)
      .all(),
    c.env.DB
      .prepare(`SELECT * FROM follow_ups WHERE person_id = ? ORDER BY status ASC, due_at ASC LIMIT 100`)
      .bind(id)
      .all(),
    c.env.DB
      .prepare(
        `SELECT m.id, m.title, m.tier, m.created_at
           FROM memory_items m
           JOIN meeting_captures c ON c.id = m.source_id
           JOIN meetings mt ON mt.id = c.meeting_id
          WHERE mt.person_id = ? AND m.source_type = 'meeting_capture' AND m.status = 'active'
          ORDER BY m.created_at DESC LIMIT 25`,
      )
      .bind(id)
      .all(),
  ]);

  return ok(c, {
    person,
    organization,
    relationship: relationship ?? null,
    meetings: meetings.results ?? [],
    follow_ups: followUps.results ?? [],
    remembered: memories.results ?? [],
  });
});

// ─── Meetings ─────────────────────────────────────────────────────────────────

relationships.get("/meetings", async (c) => {
  const from = Number(c.req.query("from") ?? Date.now() - 30 * DAY_MS);
  const to = Number(c.req.query("to") ?? Date.now() + 30 * DAY_MS);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw badRequest("from and to are epoch millisecond timestamps");

  const rows = await c.env.DB
    .prepare(
      `SELECT m.*, p.full_name, o.name AS organization_name,
              b.id AS brief_id, b.generated_at AS briefed_at,
              cap.id AS capture_id, cap.captured_at,
              r.relationship_health, r.trust_level, r.strategic_importance
         FROM meetings m
         JOIN people p ON p.id = m.person_id
    LEFT JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN meeting_briefs b ON b.meeting_id = m.id
    LEFT JOIN meeting_captures cap ON cap.meeting_id = m.id
    LEFT JOIN relationships r ON r.id = m.relationship_id
        WHERE m.scheduled_at >= ? AND m.scheduled_at <= ?
        ORDER BY m.scheduled_at ASC LIMIT 200`,
    )
    .bind(from, to)
    .all();
  return ok(c, rows.results ?? []);
});

relationships.post("/meetings", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A meeting title");
  const personId = requiredText(b?.person_id, "A person id");
  const scheduledAt = Number(b?.scheduled_at);
  if (!Number.isFinite(scheduledAt)) throw badRequest("A meeting needs scheduled_at as an epoch millisecond timestamp");

  const person = await c.env.DB
    .prepare(`SELECT id, lane, organization_id, status FROM people WHERE id = ?`)
    .bind(personId)
    .first<{ id: string; lane: string; organization_id: string | null; status: string }>();
  if (!person) throw badRequest("No person with that id", "Add them at POST /api/relationships/people.");
  if (person.status === "archived") throw conflict("That person is archived", "Restore them before booking a meeting.");

  // The relationship is linked automatically when one exists: a meeting that
  // silently missed the tie would score nothing and brief from nothing.
  const relationship = await c.env.DB
    .prepare(`SELECT id FROM relationships WHERE person_id = ?`)
    .bind(personId)
    .first<{ id: string }>();

  const organizationId = optionalText(b?.organization_id);
  if (organizationId) {
    const org = await c.env.DB.prepare(`SELECT id FROM organizations WHERE id = ?`).bind(organizationId).first();
    if (!org) throw badRequest("No organization with that id");
  }

  const id = newId("mtg");
  const now = Date.now();
  const duration = b?.duration_min === undefined || b?.duration_min === null ? null : Number(b.duration_min);
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) throw badRequest("duration_min is a positive number of minutes");

  await c.env.DB
    .prepare(
      `INSERT INTO meetings
         (id, lane, person_id, relationship_id, organization_id, title, purpose, the_ask,
          scheduled_at, duration_min, location, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'scheduled',?,?)`,
    )
    .bind(
      id, person.lane, personId, relationship?.id ?? null,
      organizationId ?? person.organization_id,
      title, optionalText(b?.purpose), optionalText(b?.the_ask),
      scheduledAt, duration, optionalText(b?.location), now, now,
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: person.lane, entityType: "meeting", entityId: id, action: "scheduled",
    detail: { person_id: personId, scheduled_at: scheduledAt },
  });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first(), 201);
});

relationships.get("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const meeting = await c.env.DB.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first<any>();
  if (!meeting) throw notFound("No meeting with that id");

  const [person, brief, capture, followUps] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM people WHERE id = ?`).bind(meeting.person_id).first(),
    c.env.DB.prepare(`SELECT * FROM meeting_briefs WHERE meeting_id = ?`).bind(id).first<any>(),
    c.env.DB.prepare(`SELECT * FROM meeting_captures WHERE meeting_id = ?`).bind(id).first<any>(),
    c.env.DB.prepare(`SELECT * FROM follow_ups WHERE meeting_id = ? ORDER BY due_at ASC`).bind(id).all(),
  ]);

  return ok(c, {
    meeting,
    person,
    brief: brief ? decodeBrief(brief) : null,
    capture: capture ?? null,
    follow_ups: followUps.results ?? [],
  });
});

function decodeBrief(row: any) {
  const parse = (raw: string | null) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };
  return {
    ...row,
    dossier: parse(row.dossier),
    relationship_history: parse(row.relationship_history),
    suggested_questions: parse(row.suggested_questions) ?? [],
    the_ask: parse(row.the_ask),
  };
}

/** The before-meeting brief. Canon §40: you do not walk in cold. */
relationships.post("/meetings/:id/brief", async (c) => {
  const id = c.req.param("id");
  const brief = await generateBrief(c.env.DB, id);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "meeting", entityId: id, action: "briefed",
    detail: { brief_id: brief.id, template_id: brief.template_id, questions: brief.suggested_questions.length },
  });
  await logEvent(c.env.DB, { level: "info", scope: "relationships", event: "meeting_briefed", entityId: id });
  return ok(c, brief, 201);
});

relationships.get("/meetings/:id/brief", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM meeting_briefs WHERE meeting_id = ?`).bind(id).first<any>();
  if (!row) throw notFound("That meeting has no brief yet");
  return ok(c, decodeBrief(row));
});

/**
 * The after-meeting capture. It leaves at least one follow-up and at least one
 * memory promotion candidate behind, and moves the relationship's scores.
 */
relationships.post("/meetings/:id/capture", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<any>().catch(() => null);
  if (!body) throw badRequest("A capture needs a body", "Send { notes, commitments_made, commitments_received }.");

  const result = await captureMeeting(c.env.DB, id, body);

  // The day exists whether or not anyone opened Today, and a follow-up that is
  // already due belongs on the screen now rather than at the next cron tick.
  const now = Date.now();
  const day = await ensureDay(c.env.DB, dayId(now));
  const surfaced = await surfaceOverdueFollowUps(c.env.DB, day.id, now, now);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "meeting", entityId: id, action: "captured",
    detail: {
      capture_id: result.capture.id,
      follow_ups: result.follow_ups.length,
      memory_candidates: result.memory_candidates.length,
    },
  });
  await logEvent(c.env.DB, {
    level: "info", scope: "relationships", event: "meeting_captured", entityId: id,
    detail: { follow_ups: result.follow_ups.length, memory_candidates: result.memory_candidates.length },
  });

  return ok(c, { ...result, surfaced_as_open_loops: surfaced.surfaced }, 201);
});

// ─── Follow-ups ───────────────────────────────────────────────────────────────

relationships.get("/follow-ups", async (c) => {
  const status = c.req.query("status") ?? "open";
  const now = Date.now();
  const overdueOnly = status === "overdue";
  const rows = await c.env.DB
    .prepare(
      `SELECT f.*, p.full_name, m.title AS meeting_title
         FROM follow_ups f
         JOIN people p ON p.id = f.person_id
    LEFT JOIN meetings m ON m.id = f.meeting_id
        WHERE f.status = ? ${overdueOnly ? "AND f.due_at < ?" : ""}
        ORDER BY f.due_at ASC LIMIT 200`,
    )
    .bind(...(overdueOnly ? ["open", now] : [status]))
    .all();
  return ok(c, rows.results ?? []);
});

relationships.post("/follow-ups", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A follow-up title");
  const personId = requiredText(b?.person_id, "A person id");
  const dueAt = Number(b?.due_at);
  if (!Number.isFinite(dueAt)) throw badRequest("A follow-up needs due_at as an epoch millisecond timestamp", "A commitment without a date is a wish.");
  const owner = optionalText(b?.owner) ?? "boss";
  if (owner !== "boss" && owner !== "them") throw badRequest(`"${owner}" does not own follow-ups`, "One of: boss, them.");

  const person = await c.env.DB
    .prepare(`SELECT id, lane FROM people WHERE id = ?`).bind(personId)
    .first<{ id: string; lane: string }>();
  if (!person) throw badRequest("No person with that id");

  const relationship = await c.env.DB
    .prepare(`SELECT id FROM relationships WHERE person_id = ?`).bind(personId).first<{ id: string }>();

  const meetingId = optionalText(b?.meeting_id);
  if (meetingId) {
    const meeting = await c.env.DB
      .prepare(`SELECT id, person_id FROM meetings WHERE id = ?`).bind(meetingId)
      .first<{ id: string; person_id: string }>();
    if (!meeting) throw badRequest("No meeting with that id");
    if (meeting.person_id !== personId) {
      throw badRequest("That meeting was with someone else", "A follow-up belongs to the room it came out of.");
    }
  }

  const id = newId("fup");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO follow_ups (id, lane, person_id, relationship_id, meeting_id, capture_id, owner, title, detail, due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,NULL,?,?,?,?,'open',?,?)`,
    )
    .bind(
      id, person.lane, personId, relationship?.id ?? null, meetingId,
      owner, title, b?.detail === undefined ? null : JSON.stringify(b.detail), dueAt, now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: person.lane, entityType: "follow_up", entityId: id, action: "opened", detail: { person_id: personId, due_at: dueAt } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM follow_ups WHERE id = ?`).bind(id).first(), 201);
});

/**
 * Keeping or dropping a commitment. Both are recorded; only one of them costs
 * relationship health, and the difference is the point of the ledger.
 */
relationships.post("/follow-ups/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (action !== "complete" && action !== "drop") {
    throw badRequest(`"${action}" is not something you can do to a follow-up`, "One of: complete, drop.");
  }

  const followUp = await c.env.DB
    .prepare(`SELECT * FROM follow_ups WHERE id = ?`).bind(id)
    .first<{ id: string; status: string; relationship_id: string | null; loop_id: string | null; lane: string }>();
  if (!followUp) throw notFound("No follow-up with that id");
  if (followUp.status !== "open") throw conflict(`That follow-up is already ${followUp.status}`);

  const now = Date.now();
  const status = action === "complete" ? "done" : "dropped";

  const statements = [
    c.env.DB
      .prepare(`UPDATE follow_ups SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, now, id),
  ];
  // The open loop that represents it closes with it; a loop left open for a
  // commitment that is finished is noise the screen cannot afford.
  if (followUp.loop_id) {
    statements.push(
      c.env.DB
        .prepare(`UPDATE open_loops SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
        .bind(action === "complete" ? "resolved" : "dismissed", now, now, followUp.loop_id),
    );
  }
  await c.env.DB.batch(statements);

  const relationship = followUp.relationship_id
    ? await rescoreRelationship(c.env.DB, followUp.relationship_id, now)
    : null;

  await audit(c.env.DB, { actor: "boss", lane: followUp.lane, entityType: "follow_up", entityId: id, action: status });
  return ok(c, {
    follow_up: await c.env.DB.prepare(`SELECT * FROM follow_ups WHERE id = ?`).bind(id).first(),
    relationship,
  });
});

/** Puts everything already due onto today's board, on demand rather than at cron. */
relationships.post("/follow-ups/surface", async (c) => {
  const now = Date.now();
  const day = await ensureDay(c.env.DB, dayId(now));
  const result = await surfaceOverdueFollowUps(c.env.DB, day.id, now, now);
  return ok(c, { day: day.id, ...result });
});

// ─── Relationships ────────────────────────────────────────────────────────────

relationships.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT r.*, p.full_name, p.role, o.name AS organization_name,
              (SELECT COUNT(*) FROM follow_ups f WHERE f.relationship_id = r.id AND f.status = 'open') AS open_follow_ups,
              (SELECT COUNT(*) FROM follow_ups f WHERE f.relationship_id = r.id AND f.status = 'open' AND f.due_at < ?) AS overdue_follow_ups,
              (SELECT COUNT(*) FROM meetings m WHERE m.relationship_id = r.id) AS meetings_count
         FROM relationships r
         JOIN people p ON p.id = r.person_id
    LEFT JOIN organizations o ON o.id = p.organization_id
        WHERE r.status <> 'closed'
        ORDER BY r.strategic_importance DESC, r.relationship_health ASC
        LIMIT 200`,
    )
    .bind(Date.now())
    .all();
  return ok(c, rows.results ?? []);
});

relationships.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const personId = requiredText(b?.person_id, "A person id");
  const kind = optionalText(b?.kind) ?? "professional";
  if (!RELATIONSHIP_KINDS.has(kind)) {
    throw badRequest(`"${kind}" is not a kind of relationship`, `One of: ${[...RELATIONSHIP_KINDS].join(", ")}.`);
  }

  const person = await c.env.DB
    .prepare(`SELECT id, lane FROM people WHERE id = ?`).bind(personId)
    .first<{ id: string; lane: string }>();
  if (!person) throw badRequest("No person with that id");

  const existing = await c.env.DB
    .prepare(`SELECT id FROM relationships WHERE person_id = ?`).bind(personId).first<{ id: string }>();
  if (existing) {
    throw conflict(
      "That person already has a relationship record",
      `It is ${existing.id}. A person has one tie, scored over time — update it rather than starting a second history.`,
    );
  }

  const cadence = b?.cadence_days === undefined ? 30 : Number(b.cadence_days);
  if (!Number.isFinite(cadence) || cadence < 1 || cadence > 3650) {
    throw badRequest("cadence_days is between 1 and 3650", "It is how often this tie should be touched.");
  }

  const lastContact = b?.last_contact_at === undefined || b?.last_contact_at === null ? null : Number(b.last_contact_at);
  if (lastContact !== null && !Number.isFinite(lastContact)) throw badRequest("last_contact_at is an epoch millisecond timestamp");

  const id = newId("rel");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO relationships
         (id, person_id, lane, kind, strategic_importance, trust_level, recency_score,
          opportunity_value, relationship_health, cadence_days, last_contact_at, notes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,0,?,0,?,?,?,'active',?,?)`,
    )
    .bind(
      id, personId, person.lane, kind,
      clampScore(b?.strategic_importance, 50),
      clampScore(b?.trust_level, 50),
      clampScore(b?.opportunity_value, 0),
      Math.round(cadence), lastContact, optionalText(b?.notes), now, now,
    )
    .run();

  // Every meeting already booked with this person joins the tie, so the first
  // brief after the record exists has a history to read.
  await c.env.DB
    .prepare(`UPDATE meetings SET relationship_id = ?, updated_at = ? WHERE person_id = ? AND relationship_id IS NULL`)
    .bind(id, now, personId)
    .run();

  const scored = await rescoreRelationship(c.env.DB, id, now);
  await audit(c.env.DB, { actor: "boss", lane: person.lane, entityType: "relationship", entityId: id, action: "created", detail: { person_id: personId, kind } });
  return ok(c, scored, 201);
});

relationships.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare(
      `SELECT r.*, p.full_name, p.role, p.privacy_class, o.name AS organization_name
         FROM relationships r
         JOIN people p ON p.id = r.person_id
    LEFT JOIN organizations o ON o.id = p.organization_id
        WHERE r.id = ?`,
    )
    .bind(id)
    .first();
  if (!row) throw notFound("No relationship with that id");
  return ok(c, row);
});

/**
 * Revising a judgement. Only the three dimensions the Boss owns can be set here;
 * recency and health are derived and are re-derived immediately afterwards, so
 * they can never be written to say something the inputs do not support.
 */
relationships.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");

  const current = await c.env.DB.prepare(`SELECT * FROM relationships WHERE id = ?`).bind(id).first<RelationshipRow>();
  if (!current) throw notFound("No relationship with that id");

  for (const derived of ["recency_score", "relationship_health"]) {
    if (b[derived] !== undefined) {
      throw badRequest(
        `${derived} is derived, not set`,
        "It comes from the other four dimensions and what is outstanding. Change those.",
      );
    }
  }

  const updates: Record<string, string | number | null> = {};
  if (b.strategic_importance !== undefined) updates.strategic_importance = clampScore(b.strategic_importance, current.strategic_importance);
  if (b.trust_level !== undefined) updates.trust_level = clampScore(b.trust_level, current.trust_level);
  if (b.opportunity_value !== undefined) updates.opportunity_value = clampScore(b.opportunity_value, current.opportunity_value);
  if (b.kind !== undefined) {
    const kind = String(b.kind);
    if (!RELATIONSHIP_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of relationship`);
    updates.kind = kind;
  }
  if (b.cadence_days !== undefined) {
    const cadence = Number(b.cadence_days);
    if (!Number.isFinite(cadence) || cadence < 1 || cadence > 3650) throw badRequest("cadence_days is between 1 and 3650");
    updates.cadence_days = Math.round(cadence);
  }
  if (b.last_contact_at !== undefined) {
    const ts = b.last_contact_at === null ? null : Number(b.last_contact_at);
    if (ts !== null && !Number.isFinite(ts)) throw badRequest("last_contact_at is an epoch millisecond timestamp");
    updates.last_contact_at = ts;
  }
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);
  if (b.status !== undefined) {
    const status = String(b.status);
    if (!["active", "dormant", "closed"].includes(status)) throw badRequest(`"${status}" is not a relationship status`);
    updates.status = status;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE relationships SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), now, id)
    .run();

  const scored = await rescoreRelationship(c.env.DB, id, now);
  await audit(c.env.DB, { actor: "boss", lane: current.lane, entityType: "relationship", entityId: id, action: "rescored", detail: { changed: keys } });
  return ok(c, scored);
});

/** Re-derives the two derived dimensions without changing a judgement. */
relationships.post("/:id/rescore", async (c) => {
  const id = c.req.param("id");
  const scored = await rescoreRelationship(c.env.DB, id);
  if (!scored) throw notFound("No relationship with that id");
  return ok(c, scored);
});
