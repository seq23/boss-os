/**
 * Phase 19 — the Operating Governance Layer.
 *
 * Canon v10.10's governance sections, implemented as enforcement. The routes
 * here read and write the layer; the enforcement itself lives in
 * `governance/gate.ts` and is called from the protected actions elsewhere in
 * the system, which is the only way a rule of this kind is real.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import {
  EMOTIONAL_STATES, RISK_CLASSES, WATCH_LIST, checkProtectedAction, currentState,
  modeCard, runAntiDependencyCheck,
} from "../governance/gate";
import { runSentinel } from "../governance/sentinel";
import { vaultIsStale } from "../cron/cadence";

export const governance = new Hono<{ Bindings: Env; Variables: Vars }>();

const HOUR_MS = 3_600_000;

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

// ─── The mode card, canon §7 ──────────────────────────────────────────────────

governance.get("/mode-card", async (c) => ok(c, await modeCard(c.env)));

// ─── Emotional state, canon §18 ───────────────────────────────────────────────

governance.get("/state", async (c) => {
  const [state, history] = await Promise.all([
    currentState(c.env.DB),
    c.env.DB.prepare(`SELECT * FROM emotional_states ORDER BY ts DESC LIMIT 30`).all(),
  ]);
  return ok(c, {
    current: state,
    history: history.results ?? [],
    states: EMOTIONAL_STATES,
    risk_classes: RISK_CLASSES,
    note:
      "A high-risk state holds the protected actions and nothing else. It expires when you say it does, " +
      "and clearing it takes one request.",
  });
});

/**
 * Recording where you are. The risk class is the Boss's own call — the system
 * does not infer distress from typing speed, and inferring it would be worse
 * than asking.
 */
governance.post("/state", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const state = requiredText(b?.state, "A state");
  if (!EMOTIONAL_STATES.includes(state as (typeof EMOTIONAL_STATES)[number])) {
    throw badRequest(`"${state}" is not one of the recorded states`, `One of: ${EMOTIONAL_STATES.join(", ")}.`);
  }
  const riskClass = optionalText(b?.risk_class) ?? "low";
  if (!RISK_CLASSES.includes(riskClass as (typeof RISK_CLASSES)[number])) {
    throw badRequest(`"${riskClass}" is not a risk class`, `One of: ${RISK_CLASSES.join(", ")}.`);
  }

  const hours = b?.hours === undefined || b?.hours === null ? 12 : Number(b.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw badRequest("A state is recorded for between one hour and thirty days");
  }

  const id = newId("est");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO emotional_states (id, ts, state, risk_class, note, source, valid_until, created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, now, state, riskClass, optionalText(b?.note), optionalText(b?.source) ?? "self_report", now + hours * HOUR_MS, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "emotional_state", entityId: id, action: "recorded", detail: { state, risk_class: riskClass } });
  if (riskClass === "high") {
    await logEvent(c.env.DB, { level: "info", scope: "governance", event: "high_risk_state_recorded", entityId: id, detail: { state } });
  }

  return ok(
    c,
    {
      state: await c.env.DB.prepare(`SELECT * FROM emotional_states WHERE id = ?`).bind(id).first(),
      held:
        riskClass === "high"
          ? "Protected actions are held while this stands. Everything else runs as normal."
          : null,
    },
    201,
  );
});

governance.post("/state/clear", async (c) => {
  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE emotional_states SET cleared_at = ? WHERE cleared_at IS NULL AND (valid_until IS NULL OR valid_until > ?)`)
    .bind(now, now)
    .run();
  if (!res.meta.changes) throw conflict("No state is in force");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "emotional_state", action: "cleared" });
  return ok(c, { cleared: res.meta.changes, current: await currentState(c.env.DB, now) });
});

// ─── Decision rights, canon §2–§3 ─────────────────────────────────────────────

governance.get("/decision-rights", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM decision_rights WHERE status = 'active' ORDER BY action_class`).all();
  return ok(c, {
    rights: (rows.results ?? []).map((r: any) => ({ ...r, protected: Boolean(r.protected), requires_approval: Boolean(r.requires_approval) })),
    note: "The approvals layer reads this table before a decision is recorded, and the protected actions read it before they run.",
  });
});

/** What would happen if this action were attempted right now. */
governance.get("/check/:action_class", async (c) => {
  const result = await checkProtectedAction(c.env, c.req.param("action_class"));
  return ok(c, result);
});

// ─── The Compliance Sentinel, canon §4 ────────────────────────────────────────

governance.get("/watch-list", async (c) =>
  ok(c, {
    watch_list: WATCH_LIST,
    note:
      "Canon §4's own enumeration is not reproduced in any authority document available to this build, so these " +
      "are the watch items this system can actually check. Each one reads a real table.",
  }),
);

governance.get("/flags", async (c) => {
  const status = c.req.query("status") ?? "open";
  const rows = await c.env.DB
    .prepare(`SELECT * FROM compliance_flags WHERE status = ? ORDER BY ts DESC LIMIT 100`)
    .bind(status)
    .all();
  return ok(c, (rows.results ?? []).map((f: any) => ({ ...f, detail: f.detail ? JSON.parse(f.detail) : null })));
});

governance.post("/sentinel/run", async (c) => {
  const result = await runSentinel(c.env);
  await logEvent(c.env.DB, { level: "info", scope: "governance", event: "sentinel_run", detail: { raised: result.raised.length } });
  return ok(c, result, 201);
});

governance.post("/flags/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (action !== "clear" && action !== "accept") {
    throw badRequest(`"${action}" is not something you can do to a flag`, "One of: clear, accept.");
  }
  const b = await c.req.json<any>().catch(() => ({}));
  // Accepting a risk is a decision and wants a reason; clearing it means the
  // condition went away.
  if (action === "accept" && !optionalText(b?.note)) {
    throw badRequest("Accepting a flag needs a reason", "Clearing means it stopped being true; accepting means you decided to live with it.");
  }

  const res = await c.env.DB
    .prepare(`UPDATE compliance_flags SET status = ?, cleared_at = ?, note = ? WHERE id = ? AND status = 'open'`)
    .bind(action === "clear" ? "cleared" : "accepted", Date.now(), optionalText(b?.note), id)
    .run();
  if (!res.meta.changes) throw conflict("That flag is not open");

  return ok(c, await c.env.DB.prepare(`SELECT * FROM compliance_flags WHERE id = ?`).bind(id).first());
});

// ─── Anti-dependency, canon §17 ───────────────────────────────────────────────

governance.get("/anti-dependency", async (c) => ok(c, await runAntiDependencyCheck(c.env)));

// ─── Playbooks, canon §6 ──────────────────────────────────────────────────────

/**
 * The playbooks, with the ones whose condition is true right now surfaced
 * first. A playbook nobody sees at the moment it applies is a document.
 */
governance.get("/playbooks", async (c) => {
  const now = Date.now();
  const [playbooks, deadLetters, authority, snapshot, restricted] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM failure_playbooks WHERE status = 'active' ORDER BY title`).all<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT kill_switch FROM trading_authority LIMIT 1`).first<{ kill_switch: number }>(),
    c.env.DB.prepare(`SELECT ts FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`).first<{ ts: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM knowledge_exports WHERE restricted_included > 0`).first<{ n: number }>(),
  ]);

  const live: Record<string, boolean> = {
    open_dead_letters: (deadLetters?.n ?? 0) > 0,
    kill_switch: Boolean(authority?.kill_switch),
    // See `vaultIsStale` — one rule, asked of the snapshot cadence rather than a hardcoded number
    // that this file and `governance/sentinel.ts` each kept a copy of.
    stale_vault: vaultIsStale(now, snapshot?.ts ?? null),
    restricted_export: (restricted?.n ?? 0) > 0,
  };

  const rows = (playbooks.results ?? []).map((p) => ({
    ...p,
    steps: JSON.parse(p.steps),
    applies_now: p.condition_key ? Boolean(live[p.condition_key]) : false,
  }));

  return ok(c, {
    applies_now: rows.filter((p) => p.applies_now),
    playbooks: rows,
  });
});

// ─── Maintenance, IP, brand, learning ─────────────────────────────────────────

governance.get("/maintenance", async (c) => {
  const now = Date.now();
  const rows = await c.env.DB.prepare(`SELECT * FROM maintenance_items WHERE status = 'active' ORDER BY due_at ASC`).all<any>();
  const items = (rows.results ?? []).map((m) => ({ ...m, overdue: Boolean(m.due_at && m.due_at < now) }));
  return ok(c, { items, overdue: items.filter((m) => m.overdue).length });
});

governance.post("/maintenance/:key/done", async (c) => {
  const key = c.req.param("key");
  const item = await c.env.DB
    .prepare(`SELECT * FROM maintenance_items WHERE key = ?`).bind(key)
    .first<{ key: string; cadence_days: number }>();
  if (!item) throw notFound("No maintenance item with that key");

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE maintenance_items SET last_done_at = ?, due_at = ?, updated_at = ? WHERE key = ?`)
    .bind(now, now + item.cadence_days * 86_400_000, now, key)
    .run();

  // Doing the thing clears the flag that said it was overdue.
  await c.env.DB
    .prepare(`UPDATE compliance_flags SET status = 'cleared', cleared_at = ?, note = 'Done' WHERE watch_key = 'overdue_maintenance' AND subject_id = ? AND status = 'open'`)
    .bind(now, key)
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM maintenance_items WHERE key = ?`).bind(key).first());
});

governance.get("/ip", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT i.*, e.name AS entity_name FROM ip_assets i LEFT JOIN entities e ON e.id = i.entity_id ORDER BY i.renewal_at ASC`)
    .all();
  return ok(c, rows.results ?? []);
});

governance.post("/ip", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "A name");
  const kind = requiredText(b?.kind, "A kind");
  const id = newId("ipa");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO ip_assets (id, name, kind, entity_id, identifier, registered_at, renewal_at, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?,?)`,
    )
    .bind(
      id, name, kind, optionalText(b?.entity_id), optionalText(b?.identifier),
      b?.registered_at === undefined || b?.registered_at === null ? null : Number(b.registered_at),
      b?.renewal_at === undefined || b?.renewal_at === null ? null : Number(b.renewal_at),
      optionalText(b?.notes), now, now,
    )
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM ip_assets WHERE id = ?`).bind(id).first(), 201);
});

governance.get("/brand", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM brand_profiles WHERE status = 'active'`).all<any>();
  return ok(
    c,
    (rows.results ?? []).map((b) => ({
      ...b,
      voice: JSON.parse(b.voice),
      forbidden: JSON.parse(b.forbidden),
      audiences: JSON.parse(b.audiences),
    })),
  );
});

/**
 * Holds a draft against the brand's forbidden list. Not a judgement of quality
 * — a check that the things the brand never does are not in it.
 */
governance.post("/brand/check", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const text = requiredText(b?.text, "The text");
  const key = optionalText(b?.profile) ?? "boss_default";

  const profile = await c.env.DB
    .prepare(`SELECT * FROM brand_profiles WHERE key = ? AND status = 'active'`).bind(key)
    .first<{ key: string; name: string; voice: string; forbidden: string }>();
  if (!profile) throw notFound("No brand profile with that key");

  const forbidden: string[] = JSON.parse(profile.forbidden);
  const lowered = text.toLowerCase();
  const hits = forbidden.filter((f) => lowered.includes(f.toLowerCase().split(" ")[0] ?? f.toLowerCase()));
  // Emoji are on the forbidden list and are worth catching properly.
  const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);

  return ok(c, {
    profile: profile.key,
    voice: JSON.parse(profile.voice),
    forbidden,
    matches: hasEmoji ? [...hits, "Emoji in outbound work"] : hits,
    clean: hits.length === 0 && !hasEmoji,
    note: "A keyword check, not a judgement of quality. It catches the things the brand never does.",
  });
});

governance.get("/learning", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM learning_entries ORDER BY ts DESC LIMIT 100`).all();
  return ok(c, rows.results ?? []);
});

governance.post("/learning", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A title");
  const lesson = requiredText(b?.lesson, "The lesson");
  const id = newId("lrn");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO learning_entries (id, ts, source_type, source_id, title, lesson, applies_to, memory_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(
      id, now, optionalText(b?.source_type) ?? "review", optionalText(b?.source_id), title, lesson,
      b?.applies_to === undefined ? null : JSON.stringify(b.applies_to), optionalText(b?.memory_id), now,
    )
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM learning_entries WHERE id = ?`).bind(id).first(), 201);
});

// ─── Firmwide notices ─────────────────────────────────────────────────────────
//
// Posted here because this IS the admin/governance surface — the mode card, the protected actions,
// the playbooks and the learning ledger all live on it, and a notice about how the firm works
// belongs beside them rather than in a new top-level section of its own.
//
// WHAT MAKES THIS NOT DECORATION is not on this page: `queue/consumer.ts` `buildPrompt` reads the
// same table on every employee run, and `scripts/validate/a-notice-reaches-the-employee.mjs`
// proves it. Writing here changes what every employee is told, immediately and without a deploy.

governance.get("/notices", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, title, body, author, created_at FROM boss_notices ORDER BY created_at ASC, id ASC`)
    .all();
  return ok(c, {
    notices: rows.results ?? [],
    note:
      "Every employee reads these at the top of every run. A notice describes how the firm already " +
      "works; it does not create policy on its own, and where code enforces the same rule, both stay.",
  });
});

governance.post("/notices", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A title");
  const body = requiredText(b?.body, "The notice itself");
  // An anonymous standing instruction is the shape this firm refuses everywhere else.
  const author = requiredText(b?.author, "Who is posting it");
  const id = newId("fnt");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO boss_notices (id, title, body, author, created_at) VALUES (?,?,?,?,?)`)
    .bind(id, title, body, author, now)
    .run();
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "firm_notice", entityId: id, action: "posted", detail: { title, author } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM boss_notices WHERE id = ?`).bind(id).first(), 201);
});
