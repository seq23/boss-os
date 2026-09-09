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
import { nextDueAt } from "../duties/cadence";

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
     * ── THE THREE FACTS THAT WERE SENT AND THROWN AWAY ────────────────────────
     *
     * `contacts-sync.mjs` has posted `exchanges`, `days_since` and `days_since_she_wrote` for every
     * correspondent since the day it was written, and this endpoint dropped all three on the floor.
     * That is half of why the People tab reads as a directory: the numbers that would answer "why is
     * this person on my screen" were computed on her Mac, sent over the wire, and discarded on
     * arrival, leaving a list of names with a date beside them.
     *
     * NEITHER IDENTIFIES ANYBODY. A count of exchanges and the last time SHE wrote are facts about
     * her own behaviour, and "they wrote in June and you never answered" is a different and far more
     * actionable fact than "you spoke in June".
     */
    const exchanges = Number(row.exchanges) > 0 ? Math.round(Number(row.exchanges)) : null;
    const sinceSheWrote = Number(row.days_since_she_wrote);
    const herLastWrite = Number.isFinite(sinceSheWrote) && sinceSheWrote >= 0
      ? now - sinceSheWrote * 86_400_000
      : null;

    /*
     * ── COLD IS NOT LATE, AND CALLING IT LATE MADE THE WHOLE SECTION IGNORABLE ─
     *
     * The screen was showing twenty-five people at "469d late", "467d late", "459d late" against an
     * asserted cadence of "you normally speak about every 14 days". Both halves are individually
     * defensible and together they are nonsense: a fortnightly rhythm measured over a burst of mail
     * fifteen months ago does not make somebody 469 days overdue. It makes them GONE.
     *
     * The distinction is the whole of the fix, because the two states name different actions. Late
     * is a task — write to them, you are behind. Cold is a DECISION — this relationship has lapsed
     * and reviving it is a choice, not an errand. Rendering the second as the first buried the
     * handful of people genuinely a fortnight overdue under two hundred who are not, which is how a
     * list stops being read.
     *
     * Six months, because a brokerage referral cycle runs two weeks to six months: inside that
     * window silence is a gap, and beyond it the relationship has to be restarted rather than
     * continued.
     */
    const COLD_AFTER_MS = 180 * 86_400_000;
    const cold = lastContact !== null && now - lastContact > COLD_AFTER_MS;
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
                  last_contact_at = ?, next_touch_due_at = ?, scored_at = ?, updated_at = ?,
                  exchanges = ?, her_last_write_at = ?, status = ?
            WHERE id = ?`,
        )
        .bind(
          cadence, importance, importance, lastContact, nextDue, now, now,
          exchanges, herLastWrite,
          // `dormant` already exists in this column's vocabulary and has never been used. It is the
          // right word for a tie that lapsed, and it is what keeps the overdue list workable.
          cold ? "dormant" : "active",
          existing.rel_id,
        )
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
            cadence_days, last_contact_at, next_touch_due_at, scored_at, status,
            exchanges, her_last_write_at, created_at, updated_at)
         VALUES (?,?, 'ops', 'professional', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId("rel"), personId, importance, importance, importance, cadence, lastContact, nextDue, now,
        cold ? "dormant" : "active", exchanges, herLastWrite, now, now,
      )
      .run();
    created++;
  }

  /*
   * THIS IS MONIQUE'S WORK, AND THE RECORD SAYS SO.
   *
   * The owner's challenge was fair: "shouldn't an employee do this part." The Director of
   * Relationships is exactly whose job a decaying network is, and a refresh that appeared nowhere
   * in the OS made her a fictional employee with a department and no work.
   *
   * WHY AN AGENT CANNOT ACTUALLY RUN IT, which is the part worth writing down. The Claude Code
   * runner strips every credential from its environment on purpose — `childEnv` removes anything
   * matching KEY, TOKEN, SECRET, PASSCODE — so it cannot unlock the vault and cannot read the
   * mailbox. That is a deliberate property of the sandbox, not a gap to route around. The launchd
   * job runs as her and can.
   *
   * So the executor is a scheduled local job and the OWNER is Monique: her name on the record, the
   * work visible, and the staleness alarm below firing under her name when it stops.
   */
  await audit(c.env.DB, {
    actor: "employee", lane: "ops", entityType: "relationship", entityId: "emp_relationship",
    action: "synced_from_mailbox",
    detail: { created, updated, total: contacts.length, executor: "launchd:com.seq.boss-network" },
  });
  await logEvent(c.env.DB, {
    level: "info", scope: "relationships", event: "network_refreshed", entityId: "emp_relationship",
    detail: { created, updated, total: contacts.length },
  }).catch(() => {});

  return ok(c, { created, updated, total: contacts.length }, 201);
});

/* ─── Monique's mailbox findings — 0204 ──────────────────────────────────────
 *
 * WHAT SHE ASKED FOR, verbatim, 8 September 2026:
 *
 *   "the people tab is stupid, i just want one of the employees to peruse the mailbox and find
 *    connections and find people that could be buyers that i havent talked to in a while etc....
 *    and find deals im missing between a buyer and seller in my inbox"
 *
 * She is right about the tab. `GET /relationships` returns 200 rows in which every single one reads
 * `importance 100 · trust 100 · recency 0 · opportunity 0`, because those columns were seeded
 * uniformly and nothing has ever computed them. Two hundred identical scores is not knowledge about
 * anybody; it is a directory with a scoreboard drawn on it.
 *
 * A FINDING IS THE OPPOSITE OBJECT. It has a subject, a reason in dates and counts, one suggested
 * action, and evidence she can open. All four are NOT NULL because a finding missing any of them is
 * an observation, and she has enough of those.
 *
 * THESE ROUTES ARE REGISTERED BEFORE `GET /:id`, deliberately. Hono matches in registration order
 * and `/:id` sits at the bottom of this file, so a path declared after it would be swallowed and
 * answer "no relationship with that id" — a 404 that looks like an empty feature.
 */

/** Nothing with an '@' in it crosses this line. Same guard as `/sync` and the KDP determination. */
const FINDING_TEXT_FIELDS = [
  "subject_code", "counterpart_code", "headline", "because", "suggested_action", "subject_matter",
] as const;

relationships.get("/mailbox-findings", async (c) => {
  const status = c.req.query("status") ?? "new";
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM mailbox_findings
        WHERE archived_at IS NULL AND (?1 = 'all' OR status = ?1)
        ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 found_at DESC
        LIMIT 100`,
    )
    .bind(status)
    .all<Record<string, unknown>>();

  const findings = (rows.results ?? []).map((r) => ({
    ...r,
    evidence: (() => { try { return JSON.parse(String(r.evidence ?? "[]")); } catch { return []; } })(),
  }));

  const duty = await c.env.DB
    .prepare(`SELECT last_run_at, next_due_at, suspended FROM standing_duties WHERE id = 'duty_mailbox_sweep'`)
    .first<{ last_run_at: number | null; next_due_at: number | null; suspended: number }>();

  /*
   * AN EMPTY LIST SAYS WHY IT IS EMPTY. "No findings" is true both when the sweep ran and found
   * nothing and when the sweep has never run, and those are opposite facts — one is good news about
   * her mailbox and the other is a broken job. This is the same defect the Executive Briefing had.
   */
  return ok(c, {
    findings,
    total: findings.length,
    sweep: {
      owner: "Monique",
      last_run_at: duty?.last_run_at ?? null,
      next_due_at: duty?.next_due_at ?? null,
      suspended: Boolean(duty?.suspended),
      state:
        !duty ? "There is no mailbox sweep duty in the system."
        : duty.suspended ? "Monique's mailbox sweep is suspended."
        : duty.last_run_at === null
          ? "Monique's mailbox sweep has never run. It reads your mail on your own Mac, from launchd, on Sunday evenings — install it with `bash scripts/ops/install-agent-launchd.sh`."
          : `Monique last read the mailbox ${Math.floor((Date.now() - duty.last_run_at) / 86_400_000)} day(s) ago.`,
    },
  });
});

/**
 * The sweep, reporting what it found.
 *
 * THE WHOLE BATCH IS REFUSED IF ANY FIELD CARRIES AN '@'. Not the offending row — the batch. A
 * partial accept would put some of a leaking run's output into the cloud and report success, and
 * the one time this guard fired for real it was because a collision suffix had been built from the
 * first three characters of a real address. Fail closed, loudly, on the whole thing.
 *
 * IDEMPOTENT BY SUBJECT, COUNTERPART AND KIND. A weekly sweep re-derives the same missed deal every
 * week; stacking a fourth copy of it on her screen is how a useful list becomes one she stops
 * reading. The unique index does the work and the upsert refreshes the reason.
 */
relationships.post("/mailbox-findings", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const rows = Array.isArray(b?.findings) ? b.findings : null;
  if (rows === null) {
    throw badRequest("A sweep reports a findings array", "Send { findings: [...], run_id }. Zero findings is a valid report and is not the same as not reporting.");
  }

  for (const [i, f] of rows.entries()) {
    for (const field of FINDING_TEXT_FIELDS) {
      const v = f?.[field];
      if (typeof v === "string" && v.includes("@")) {
        throw badRequest(
          `Finding ${i + 1} carries an address in ${field}, so the whole batch was refused`,
          "Boss OS stores code names only. Nothing was written — fix the sweep and run it again.",
        );
      }
    }
  }

  const KINDS = new Set(["missed_deal", "cooling_buyer", "unworked_intro", "connector"]);
  const CONF = new Set(["high", "medium", "low"]);
  const now = Date.now();
  const runId = typeof b?.run_id === "string" ? b.run_id.slice(0, 64) : null;
  const text = (v: unknown, max = 600): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  };

  let written = 0;
  let skipped = 0;
  for (const f of rows) {
    const kind = String(f?.kind ?? "");
    const subject = text(f?.subject_code, 64);
    const headline = text(f?.headline, 300);
    const because = text(f?.because);
    const action = text(f?.suggested_action, 300);
    /*
     * A FINDING WITHOUT ALL FOUR IS DROPPED, and this is the load-bearing rule — the same one the
     * sourcing list uses for a candidate with no source. The failure mode of an automated reader is
     * a plausible sentence nobody can check, and checking one costs her a phone call.
     */
    if (!KINDS.has(kind) || !subject || !headline || !because || !action) { skipped++; continue; }

    await c.env.DB
      .prepare(
        `INSERT INTO mailbox_findings
           (id, kind, subject_code, counterpart_code, headline, because, suggested_action,
            evidence, subject_matter, confidence, status, run_id, found_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'new',?,?,?)
         ON CONFLICT(kind, subject_code, COALESCE(counterpart_code, ''), COALESCE(subject_matter, ''))
         DO UPDATE SET
           headline = excluded.headline,
           because = excluded.because,
           suggested_action = excluded.suggested_action,
           evidence = excluded.evidence,
           confidence = excluded.confidence,
           run_id = excluded.run_id,
           updated_at = excluded.updated_at,
           -- A finding she has already dismissed stays dismissed. Re-raising it every Sunday is how
           -- a weekly job teaches her to stop opening the screen.
           archived_at = NULL`,
      )
      .bind(
        newId("fnd"), kind, subject, text(f?.counterpart_code, 64), headline, because, action,
        JSON.stringify(Array.isArray(f?.evidence) ? f.evidence.slice(0, 20) : []),
        text(f?.subject_matter, 120),
        CONF.has(String(f?.confidence)) ? String(f?.confidence) : "low",
        runId, now, now,
      )
      .run();
    written++;
  }

  /*
   * THE DUTY'S CLOCK ADVANCES HERE AND ONLY HERE. This is what makes a `local_job` duty honest: it
   * is not "the launchd job fired", it is "the job reported back". OPERATIONS names this as the
   * exact reason Monique's network refresh and Camille's property read are NOT duty rows — neither
   * reports, so a row for either would put a permanent false alarm on Today.
   */
  const duty = await c.env.DB
    .prepare(`SELECT local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = 'duty_mailbox_sweep'`)
    .first<{
      local_hour: number; local_minute: number; timezone: string;
      cadence: "daily" | "weekly" | "monthly"; weekday: number | null; weekdays: string | null;
    }>();
  if (duty) {
    let weekdays: number[] | null = null;
    try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }
    let advanced: number | null = null;
    try {
      advanced = nextDueAt({ ...duty, weekdays }, now);
    } catch {
      // An unschedulable duty keeps its old clock rather than an invented one, and reads as overdue.
      advanced = null;
    }
    await c.env.DB
      .prepare(
        advanced === null
          ? `UPDATE standing_duties SET last_run_at = ? WHERE id = 'duty_mailbox_sweep'`
          : `UPDATE standing_duties SET last_run_at = ?, next_due_at = ? WHERE id = 'duty_mailbox_sweep'`,
      )
      .bind(...(advanced === null ? [now] : [now, advanced]))
      .run();
  }

  await logEvent(c.env.DB, {
    level: "info", scope: "relationships", event: "mailbox_swept", entityId: "emp_relationship",
    detail: { written, skipped, run_id: runId },
  }).catch(() => {});

  return ok(c, { written, skipped, total: rows.length }, 201);
});

relationships.post("/mailbox-findings/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (action !== "acted" && action !== "dismissed") {
    throw badRequest(`"${action}" is not a decision on a finding`, "Use acted or dismissed.");
  }
  const found = await c.env.DB.prepare(`SELECT id FROM mailbox_findings WHERE id = ?`).bind(id).first();
  if (!found) throw notFound("No finding with that id");

  const now = Date.now();
  await c.env.DB
    .prepare(
      // Dismissed leaves the screen; acted stays visible until the next sweep so she can see what
      // she did this week. Neither is a delete — the whole point of the register is that it
      // remembers what has already been decided.
      `UPDATE mailbox_findings SET status = ?, updated_at = ?, archived_at = ? WHERE id = ?`,
    )
    .bind(action, now, action === "dismissed" ? now : null, id)
    .run();

  return ok(c, { id, status: action });
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
