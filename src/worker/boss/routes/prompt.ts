/**
 * Phase 17 — Prompt Intelligence and the Mastery Lens Bench.
 *
 * Canon §76. A rough request is compiled into a packet: the lens stack that was
 * applied, the counter-lens that argues with it, the points of view it was read
 * from, an output contract, and a score. Nothing here calls a model — the
 * existing router does that, and the packet is what it would be given.
 *
 * Three canon rules are enforced rather than described:
 *
 * §76.3 — the trigger list decides the tier. A caller asking for a light pass on
 *   investor materials is overruled, and the override is on the packet.
 * §76.8, the No Pedestal Law — a lens is a method with an origin discipline.
 *   Naming one after a person is refused.
 * §76.17 — nothing enters the library without review, and the review is the
 *   existing approval inbox rather than a second gate that could disagree.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import {
  TIER_1_TRIGGERS, compilePacket, detectTriggers, scorePacket,
  type LensRow, type PovRow,
} from "../prompt/compile";

export const prompt = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * The No Pedestal Law, made checkable. These are names a lens might be
 * flattered into carrying; canon wants the method instead.
 */
export const PEDESTAL_NAMES = [
  "munger", "buffett", "bezos", "jobs", "musk", "thiel", "naval", "feynman",
  "socrates", "machiavelli", "sun tzu", "drucker", "deming", "kahneman",
  "taleb", "dalio", "da vinci", "einstein", "franklin",
];

const PEDESTAL_POSSESSIVE = /\b[A-Z][a-z]+['’]s\b/;

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

function list(value: unknown, what: string, min = 1): string[] {
  if (!Array.isArray(value)) throw badRequest(`${what} is a list`);
  const items = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (items.length < min) throw badRequest(`${what} needs at least ${min} entr${min === 1 ? "y" : "ies"}`);
  return items;
}

/** §76.8. Refuses a lens that is named for a person rather than a method. */
export function assertNoPedestal(fields: { name: string; summary: string; origin: string; body: any }): void {
  if (fields.body?.named_after !== undefined || fields.body?.person !== undefined) {
    throw badRequest(
      "No Pedestal Law: a lens is a method, not a person",
      "There is no field for whose lens this is. Name the method and put the discipline in `origin`.",
    );
  }

  const haystack = `${fields.name} ${fields.origin}`.toLowerCase();
  const hit = PEDESTAL_NAMES.find((n) => haystack.includes(n));
  if (hit) {
    throw badRequest(
      `No Pedestal Law: "${hit}" is a person, not a method`,
      "Name what the method does. The lens that borrows a reputation stops being examined.",
    );
  }
  if (PEDESTAL_POSSESSIVE.test(fields.name)) {
    throw badRequest(
      "No Pedestal Law: a lens is not somebody's",
      "Rename it for what it does — the possessive is the tell.",
    );
  }
}

// ─── The bench ────────────────────────────────────────────────────────────────

prompt.get("/lenses", async (c) => {
  const category = c.req.query("category");
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM mastery_lenses ${category ? "WHERE category = ? AND status <> 'retired'" : "WHERE status <> 'retired'"}
        ORDER BY category, name`,
    )
    .bind(...(category ? [category] : []))
    .all<LensRow & Record<string, unknown>>();

  const lenses = (rows.results ?? []).map((l) => ({
    ...l,
    method: JSON.parse(String(l.method)),
    questions: JSON.parse(String(l.questions)),
    moves: JSON.parse(String(l.moves)),
    failure_modes: JSON.parse(String(l.failure_modes)),
    best_for: JSON.parse(String(l.best_for)),
    avoid_for: JSON.parse(String(l.avoid_for)),
    evidence_required: Boolean(l.evidence_required),
  }));

  return ok(c, {
    lenses,
    categories: [...new Set(lenses.map((l) => l.category))].sort(),
    law: {
      key: "no_pedestal",
      text: "Canon §76.8: a lens is a structured method with an origin discipline. It is never named for a person, and the API refuses one that is.",
    },
  });
});

prompt.get("/lenses/:key", async (c) => {
  const lens = await c.env.DB.prepare(`SELECT * FROM mastery_lenses WHERE key = ?`).bind(c.req.param("key")).first<any>();
  if (!lens) throw notFound("No lens with that key");
  const counter = lens.counter_lens_key
    ? await c.env.DB.prepare(`SELECT key, name, summary FROM mastery_lenses WHERE key = ?`).bind(lens.counter_lens_key).first()
    : null;
  return ok(c, {
    lens: {
      ...lens,
      method: JSON.parse(lens.method),
      questions: JSON.parse(lens.questions),
      moves: JSON.parse(lens.moves),
      failure_modes: JSON.parse(lens.failure_modes),
      best_for: JSON.parse(lens.best_for),
      avoid_for: JSON.parse(lens.avoid_for),
    },
    counter_lens: counter,
  });
});

prompt.post("/lenses", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = requiredText(b?.key, "A key");
  const name = requiredText(b?.name, "A name");
  const origin = requiredText(b?.origin, "The origin discipline");
  const summary = requiredText(b?.summary, "A summary");

  assertNoPedestal({ name, summary, origin, body: b });

  const method = list(b?.method, "The method", 3);
  const questions = list(b?.questions, "The questions", 1);
  const moves = list(b?.moves, "The moves", 1);
  const failureModes = list(b?.failure_modes, "The failure modes", 1);

  const tierMinimum = Number(b?.tier_minimum ?? 2);
  if (![1, 2, 3].includes(tierMinimum)) throw badRequest("tier_minimum is 1, 2 or 3");

  const existing = await c.env.DB.prepare(`SELECT key FROM mastery_lenses WHERE key = ?`).bind(key).first();
  if (existing) throw conflict("A lens with that key is already on the bench");

  const id = newId("lns");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO mastery_lenses
         (id, key, name, category, summary, method, questions, moves, failure_modes, counter_lens_key,
          best_for, avoid_for, tier_minimum, risk_posture, evidence_required, output_shape, origin, status, review_note, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    )
    .bind(
      id, key, name, optionalText(b?.category) ?? "analysis", summary,
      JSON.stringify(method), JSON.stringify(questions), JSON.stringify(moves), JSON.stringify(failureModes),
      optionalText(b?.counter_lens_key),
      JSON.stringify(Array.isArray(b?.best_for) ? b.best_for.map(String) : []),
      JSON.stringify(Array.isArray(b?.avoid_for) ? b.avoid_for.map(String) : []),
      tierMinimum, optionalText(b?.risk_posture) ?? "balanced",
      b?.evidence_required ? 1 : 0,
      requiredText(b?.output_shape, "The output shape"), origin,
      b?.status === "draft" ? "draft" : "active", optionalText(b?.review_note), now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "mastery_lens", entityId: id, action: "benched", detail: { key } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM mastery_lenses WHERE id = ?`).bind(id).first(), 201);
});

prompt.get("/pov-cards", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM pov_cards WHERE status = 'active' ORDER BY tier_minimum, name`).all<any>();
  return ok(
    c,
    (rows.results ?? []).map((p) => ({
      ...p,
      wants: JSON.parse(p.wants),
      fears: JSON.parse(p.fears),
      questions: JSON.parse(p.questions),
    })),
  );
});

prompt.get("/triggers", async (c) =>
  ok(c, {
    triggers: TIER_1_TRIGGERS.map((t) => ({ key: t.key, label: t.label })),
    rule: "Canon §76.3: work in these categories is compiled at tier 1 whatever tier was asked for. The override is recorded on the packet.",
  }),
);

// ─── Compilation ──────────────────────────────────────────────────────────────

prompt.post("/packets", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const request = requiredText(b?.request, "The request");

  const [lensRows, povRows, provider] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM mastery_lenses WHERE status = 'active'`).all<LensRow>(),
    c.env.DB.prepare(`SELECT * FROM pov_cards WHERE status = 'active' ORDER BY key`).all<PovRow>(),
    // §76.14: the adapter is chosen from the existing backend registry rather
    // than from a second list of providers kept here.
    b?.adapter
      ? Promise.resolve({ id: String(b.adapter) })
      : c.env.DB.prepare(`SELECT id FROM providers WHERE enabled = 1 ORDER BY id LIMIT 1`).first<{ id: string }>(),
  ]);

  if (b?.task_id) {
    const task = await c.env.DB.prepare(`SELECT id FROM tasks WHERE id = ?`).bind(String(b.task_id)).first();
    if (!task) throw badRequest("No task with that id");
  }

  const packet = compilePacket(
    {
      request,
      taskKind: optionalText(b?.task_kind),
      sensitivity: optionalText(b?.sensitivity) ?? "private",
      requestedTier: b?.tier === undefined || b?.tier === null ? null : Number(b.tier),
      taskId: optionalText(b?.task_id),
    },
    lensRows.results ?? [],
    povRows.results ?? [],
    provider?.id ?? "text",
  );

  const score = scorePacket(packet);
  const now = Date.now();
  const scoreId = newId("psc");

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO prompt_packets
           (id, request, task_kind, sensitivity, tier, tier_reason, triggers, lens_stack, counter_lens_key,
            pov_card_keys, adapter, sections, compiled_prompt, task_id, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'compiled',?)`,
      )
      .bind(
        packet.id, packet.request, packet.task_kind, packet.sensitivity, packet.tier, packet.tier_reason,
        JSON.stringify(packet.triggers), JSON.stringify(packet.lens_stack), packet.counter_lens_key,
        JSON.stringify(packet.pov_card_keys), packet.adapter, JSON.stringify(packet.sections),
        packet.compiled_prompt, packet.task_id, now,
      ),
    c.env.DB
      .prepare(`INSERT INTO prompt_scores (id, packet_id, ts, dimensions, total, max_total, scored_by) VALUES (?,?,?,?,?,?,'system')`)
      .bind(scoreId, packet.id, now, JSON.stringify(score.dimensions), score.total, score.max_total),
  ]);

  // The trace points at the ledgers that already exist rather than starting a
  // third one: whatever the task routed to, and what it cost.
  if (packet.task_id) {
    const [routing, usage] = await Promise.all([
      c.env.DB.prepare(`SELECT id FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC LIMIT 1`).bind(packet.task_id).first<{ id: string }>(),
      c.env.DB.prepare(`SELECT id FROM usage_ledger WHERE task_id = ? ORDER BY ts DESC LIMIT 1`).bind(packet.task_id).first<{ id: string }>(),
    ]);
    await c.env.DB
      .prepare(`INSERT INTO prompt_traces (id, packet_id, task_id, routing_decision_id, usage_ledger_id, ts, note) VALUES (?,?,?,?,?,?,?)`)
      .bind(newId("ptr"), packet.id, packet.task_id, routing?.id ?? null, usage?.id ?? null, now, "Linked at compile time")
      .run();
  }

  await logEvent(c.env.DB, {
    level: "info", scope: "prompt", event: "packet_compiled", entityId: packet.id,
    detail: { tier: packet.tier, triggers: packet.triggers.map((t) => t.key), score: score.total },
  });

  return ok(c, { packet, score: { id: scoreId, ...score } }, 201);
});

prompt.get("/packets", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.id, p.request, p.tier, p.tier_reason, p.lens_stack, p.counter_lens_key, p.status, p.created_at,
              s.total, s.max_total
         FROM prompt_packets p
    LEFT JOIN prompt_scores s ON s.packet_id = p.id
        ORDER BY p.created_at DESC LIMIT 100`,
    )
    .all<any>();
  return ok(c, (rows.results ?? []).map((p) => ({ ...p, lens_stack: JSON.parse(p.lens_stack) })));
});

prompt.get("/packets/:id", async (c) => {
  const id = c.req.param("id");
  const packet = await c.env.DB.prepare(`SELECT * FROM prompt_packets WHERE id = ?`).bind(id).first<any>();
  if (!packet) throw notFound("No packet with that id");

  const [score, traces, library] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM prompt_scores WHERE packet_id = ? ORDER BY ts DESC LIMIT 1`).bind(id).first<any>(),
    c.env.DB.prepare(`SELECT * FROM prompt_traces WHERE packet_id = ? ORDER BY ts DESC`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT id, status, review_note FROM prompt_library WHERE packet_id = ?`).bind(id).first<any>(),
  ]);

  return ok(c, {
    packet: {
      ...packet,
      triggers: JSON.parse(packet.triggers),
      lens_stack: JSON.parse(packet.lens_stack),
      pov_card_keys: JSON.parse(packet.pov_card_keys),
      sections: JSON.parse(packet.sections),
    },
    score: score ? { ...score, dimensions: JSON.parse(score.dimensions) } : null,
    traces: traces.results ?? [],
    library: library ?? null,
  });
});

// ─── The library, and its review gate ─────────────────────────────────────────

/**
 * §76.17. Promotion proposes; it does not promote. The approval card is the
 * same machinery every other gate in the system uses, so a prompt cannot enter
 * the library through a second door that nobody is watching.
 */
prompt.post("/packets/:id/promote", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const title = requiredText(b?.title, "A title");

  const packet = await c.env.DB.prepare(`SELECT * FROM prompt_packets WHERE id = ?`).bind(id).first<any>();
  if (!packet) throw notFound("No packet with that id");

  const existing = await c.env.DB
    .prepare(`SELECT id, status FROM prompt_library WHERE packet_id = ?`).bind(id)
    .first<{ id: string; status: string }>();
  if (existing) throw conflict(`That packet is already ${existing.status} in the library`);

  const libraryId = newId("plb");
  const approvalId = newId("apr");
  const now = Date.now();

  // The approval is inserted first: `prompt_library.approval_id` is a foreign
  // key, and foreign keys are enforced per statement inside a batch. Writing the
  // referencing row first is the ordering bug the earlier phases had to fix.
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,'ops',?,?,'prompt_library_promotion','prompt_library',?,'low',?,'pending',?,?)`,
      )
      .bind(
        approvalId, `Add to the prompt library: ${title}`,
        String(packet.compiled_prompt).slice(0, 400), libraryId,
        JSON.stringify({ library_id: libraryId, packet_id: id, tier: packet.tier }),
        now, now + 14 * 24 * 60 * 60 * 1000,
      ),
    c.env.DB
      .prepare(
        `INSERT INTO prompt_library (id, packet_id, title, prompt, task_kind, tier, lens_stack, status, approval_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'proposed',?,?,?)`,
      )
      .bind(libraryId, id, title, packet.compiled_prompt, packet.task_kind, packet.tier, packet.lens_stack, approvalId, now, now),
  ]);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "prompt_library", entityId: libraryId, action: "proposed",
    detail: { packet_id: id, approval_id: approvalId },
  });

  return ok(
    c,
    {
      library: await c.env.DB.prepare(`SELECT * FROM prompt_library WHERE id = ?`).bind(libraryId).first(),
      approval_id: approvalId,
      note: "Proposed, not added. Canon §76.17: nothing enters the library without review, and the review is in the approval inbox.",
    },
    201,
  );
});

prompt.get("/library", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM prompt_library ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(...(status ? [status] : []))
    .all<any>();
  return ok(c, (rows.results ?? []).map((r) => ({ ...r, lens_stack: JSON.parse(r.lens_stack) })));
});

/** Using a library prompt. A proposed one is not usable, which is the point of the gate. */
prompt.post("/library/:id/use", async (c) => {
  const id = c.req.param("id");
  const entry = await c.env.DB.prepare(`SELECT * FROM prompt_library WHERE id = ?`).bind(id).first<any>();
  if (!entry) throw notFound("No library prompt with that id");
  if (entry.status !== "approved") {
    throw conflict(
      `That prompt is ${entry.status}, not approved`,
      "Canon §76.17: the library holds reviewed prompts only. Decide the approval first.",
    );
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE prompt_library SET uses = uses + 1, last_used_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, id)
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM prompt_library WHERE id = ?`).bind(id).first());
});

// ─── Traces ───────────────────────────────────────────────────────────────────

prompt.get("/traces", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT t.*, p.request, r.chosen_model_id, u.cost_micros
         FROM prompt_traces t
         JOIN prompt_packets p ON p.id = t.packet_id
    LEFT JOIN routing_decisions r ON r.id = t.routing_decision_id
    LEFT JOIN usage_ledger u ON u.id = t.usage_ledger_id
        ORDER BY t.ts DESC LIMIT 100`,
    )
    .all<any>();
  return ok(c, {
    traces: rows.results ?? [],
    note: "Traces join the existing routing and usage ledgers. This phase adds no third ledger.",
  });
});

/** What the compiler would do with a request, without storing anything. */
prompt.post("/preview", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const request = requiredText(b?.request, "The request");
  const triggers = detectTriggers(request, optionalText(b?.task_kind), optionalText(b?.sensitivity) ?? "private");
  return ok(c, {
    triggers,
    tier: triggers.length ? 1 : Number(b?.tier ?? 2),
    reason: triggers.length
      ? `Tier 1 required: ${triggers.map((t) => t.label).join(", ")}.`
      : "No automatic trigger fired.",
  });
});
