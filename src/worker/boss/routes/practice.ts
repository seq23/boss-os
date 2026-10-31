import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { ok, badRequest } from "../lib/http";
import { dayIdInZone } from "../../../shared/boss/timezone";
import { buildTodayList, cleanGateItems, GATE_NAMES, MAX_CUSTOM_CHECKS, type GateName } from "../today/list";
import { dueNudges, markNudgeSent, recordEngagement, type DueNudge } from "../practice/lapse";
import { ancestralUrgent } from "../practice/ancestralUrgent";
import { waitingOnYou } from "../today/waiting";
import { foodToday, cityNeedsPlaces, generateLocalPlaces, HOME_CITY_KEY, AWAY_CITY_KEY, AWAY_UNTIL_KEY } from "../today/food";
import { setSetting } from "../lib/settings";
import { lpRow, sendHeldLp, holdHerWords } from "../lp/heldReply";
import { tapUrl } from "../../../shared/boss/lp/plan.mjs";

/**
 * /api/practice — Today's contract (the one list), its ticks, her gates, and the practice emails.
 *
 *   GET  /list                       Today's one list and its one "needs you" count
 *   POST /tick                       { key, done } — a gate step, a Wealth sub-item, "Read it aloud ✓"
 *   POST /opened                     the app was opened (that it happened; nothing else)
 *   PUT  /gates/:gate                { items, scope: "default" | "today" | "reset" }
 *   POST /custom-gates               { name, at_minute, checks[] } — "+ Create a gate"
 *   GET  /waiting                    every unanswered Decide item across mornings (the morning email's carry-over)
 *   POST /waiting/:id/send           ✓ Send as is — the reply held in that person's own thread
 *   POST /waiting/:id/change         ✎ Change it — { words }: her words held in the thread, shown back
 *   POST /waiting/:id/dismiss        off "Still waiting on you" for good ("Not now" is a tick: notnow:<id>)
 *   POST /food/another               the food row's "Another place"
 *   PUT  /food/where                 { home?, away?, until? } — her home city, and "where I am until"
 *   POST /nudges/due                 the Mac's tick asks what practice email is due, and claims it
 *   POST /nudges/:day/:kind/sent     …and says it went
 *
 * The emails are sent by her Mac (scripts/ops/practice-nudges.mjs), from Imani, to her only.
 */
export const practice = new Hono<{ Bindings: Env; Variables: Vars }>();

const TICK_KEY = /^[a-z_]+(?::[A-Za-z0-9_\-]{1,64}){0,3}$/;
const ORIGIN = "https://boss.sequoiataylor.com";

practice.get("/list", async (c) => {
  const list = await buildTodayList(c.env);
  // A city with no hand-written places: a $0 lane may write some, in the background (today/food.ts).
  const city = list.rows.find((r) => r.kind === "food")?.food?.where.city ?? null;
  if (city && (await cityNeedsPlaces(c.env, city))) {
    try { c.executionCtx.waitUntil(generateLocalPlaces(c.env, city, list.day_id)); } catch { /* no context in tests */ }
  }
  return ok(c, list);
});

/** The item behind a "Still waiting on you" line (or a new Decide line), with its LP row when it has one. */
async function waitingItem(env: Env, id: string) {
  const { items } = await waitingOnYou(env, dayIdInZone(Date.now()), { includeSnoozed: true });
  return items.find((w) => w.id === id) ?? null;
}

practice.get("/waiting", async (c) => {
  const { items, latest } = await waitingOnYou(c.env, dayIdInZone(Date.now()));
  return ok(c, {
    latest,
    items: items.map((w) => ({
      id: w.id, key: w.key, title: w.title, days: w.days, first_day: w.first_day, wealth: w.wealth,
      reply: w.reply ? { text: w.reply.text, can_send: w.reply.can_send } : null,
      // The morning email's one-tap page: the same token the held reply's own card carries.
      send_url: w.reply?.can_send && w.reply.tap_token ? tapUrl(w.reply.tap_token, "send", ORIGIN) : null,
      change_url: `${ORIGIN}/?waiting=${encodeURIComponent(w.id)}`,
    })),
  });
});

practice.post("/waiting/:id/send", async (c) => {
  const w = await waitingItem(c.env, c.req.param("id"));
  if (!w?.reply) throw badRequest("There is no reply to send for that item.", "Open it to answer it.");
  const row = await lpRow(c.env, w.reply.lp_id);
  if (!row) throw badRequest("That reply is no longer on the tracker.");
  const r = await sendHeldLp(c.env, row);
  return ok(c, { sent: r.ok, line: r.line, list: await buildTodayList(c.env) });
});

practice.post("/waiting/:id/change", async (c) => {
  const b = await c.req.json<{ words?: string }>().catch(() => ({}) as { words?: string });
  const w = await waitingItem(c.env, c.req.param("id"));
  if (!w?.reply) throw badRequest("There is no reply to change for that item.", "Open it to answer it.");
  const row = await lpRow(c.env, w.reply.lp_id);
  if (!row) throw badRequest("That reply is no longer on the tracker.");
  const r = await holdHerWords(c.env, row, String(b.words ?? ""));
  return ok(c, { held: r.ok, line: r.line, text: r.text, list: await buildTodayList(c.env) });
});

practice.post("/waiting/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-z]+-[a-z0-9]{6,32}$/.test(id)) throw badRequest("That is not a morning item.");
  await c.env.DB.prepare(`INSERT INTO decide_dismissed (item_id, dismissed_at) VALUES (?, ?) ON CONFLICT(item_id) DO NOTHING`).bind(id, Date.now()).run();
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "morning_item", entityId: id, action: "dismissed" });
  return ok(c, await buildTodayList(c.env));
});

practice.post("/food/another", async (c) => {
  await foodToday(c.env, dayIdInZone(Date.now()), { another: true });
  return ok(c, await buildTodayList(c.env));
});

const CITY_RE = /^[A-Za-z][A-Za-z .,'-]{1,59}$/;
practice.put("/food/where", async (c) => {
  const b = await c.req.json<{ home?: string | null; away?: string | null; until?: string | null }>().catch(() => ({}) as any);
  if (b.home !== undefined) {
    const home = String(b.home ?? "").trim();
    if (home && !CITY_RE.test(home)) throw badRequest("Type a city, like Memphis, TN.");
    await setSetting(c.env.DB, HOME_CITY_KEY, home);
  }
  if (b.away !== undefined) {
    const away = String(b.away ?? "").trim();
    const until = String(b.until ?? "").trim();
    if (away && !CITY_RE.test(away)) throw badRequest("Type a city, like New York, NY.");
    if (away && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw badRequest("Pick the last day you are there.");
    await setSetting(c.env.DB, AWAY_CITY_KEY, away);
    await setSetting(c.env.DB, AWAY_UNTIL_KEY, away ? until : "");
  }
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "setting", entityId: "food_where", action: "updated" });
  return ok(c, await buildTodayList(c.env));
});

practice.post("/tick", async (c) => {
  const b = await c.req.json<{ key?: string; done?: boolean }>().catch(() => ({}) as { key?: string; done?: boolean });
  const key = String(b.key ?? "");
  if (!TICK_KEY.test(key) || key.length > 120) throw badRequest("That is not a list item.", "A tick names one item, like morning:gratitude.");
  const day = dayIdInZone(Date.now());
  if (b.done === false) {
    await c.env.DB.prepare(`DELETE FROM today_ticks WHERE day_id = ? AND item_key = ?`).bind(day, key).run();
  } else {
    await c.env.DB.prepare(`INSERT INTO today_ticks (day_id, item_key, done_at) VALUES (?,?,?) ON CONFLICT(day_id, item_key) DO NOTHING`).bind(day, key, Date.now()).run();
  }
  return ok(c, await buildTodayList(c.env));
});

practice.post("/opened", async (c) => {
  await recordEngagement(c.env, "app_open");
  return ok(c, { day_id: dayIdInZone(Date.now()) });
});

practice.put("/gates/:gate", async (c) => {
  const gate = c.req.param("gate") as GateName;
  if (!GATE_NAMES.includes(gate)) throw badRequest("A gate is morning, midday or night.");
  const b = await c.req.json<{ items?: unknown; scope?: string }>().catch(() => ({}) as { items?: unknown; scope?: string });
  const day = dayIdInZone(Date.now());
  const now = Date.now();
  if (b.scope === "reset") {
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM gate_templates WHERE gate = ?`).bind(gate),
      c.env.DB.prepare(`DELETE FROM gate_days WHERE day_id = ? AND gate = ?`).bind(day, gate),
    ]);
  } else {
    const items = cleanGateItems(gate, b.items);
    if (typeof items === "string") throw badRequest(items);
    const text = JSON.stringify(items);
    if (b.scope === "default") {
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO gate_templates (gate, items, updated_at) VALUES (?,?,?) ON CONFLICT(gate) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`).bind(gate, text, now),
        // Saving as the default also becomes today's gate: the edit she just made is what she sees.
        c.env.DB.prepare(`DELETE FROM gate_days WHERE day_id = ? AND gate = ?`).bind(day, gate),
      ]);
    } else {
      await c.env.DB.prepare(`INSERT INTO gate_days (day_id, gate, items, created_at) VALUES (?,?,?,?) ON CONFLICT(day_id, gate) DO UPDATE SET items = excluded.items`).bind(day, gate, text, now).run();
    }
  }
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "gate", entityId: gate, action: `edited_${b.scope === "default" ? "default" : b.scope === "reset" ? "reset" : "today"}` });
  return ok(c, await buildTodayList(c.env));
});

practice.post("/custom-gates", async (c) => {
  const b = await c.req.json<{ name?: string; at_minute?: number; checks?: unknown[] }>().catch(() => ({}) as any);
  const name = String(b.name ?? "").trim().slice(0, 60);
  const at = Number(b.at_minute);
  const checks = (Array.isArray(b.checks) ? b.checks : []).map((x: unknown) => String(x ?? "").trim().slice(0, 140)).filter(Boolean).slice(0, MAX_CUSTOM_CHECKS);
  if (!name) throw badRequest("Name the gate.");
  if (!Number.isFinite(at) || at < 0 || at >= 24 * 60) throw badRequest("Pick a time for the gate.");
  if (!checks.length) throw badRequest("Add at least one check.", `Up to ${MAX_CUSTOM_CHECKS}.`);
  const id = `custom:${Math.random().toString(36).slice(2, 10)}`;
  await c.env.DB.prepare(`INSERT INTO gate_days (day_id, gate, items, name, at_minute, created_at) VALUES (?,?,?,?,?,?)`)
    .bind(dayIdInZone(Date.now()), id, JSON.stringify(checks), name, Math.round(at), Date.now()).run();
  return ok(c, await buildTodayList(c.env), 201);
});

/** Due checks beyond the ladder and the midday push: the ancestral hour's last-day 6pm warning. */
const EXTRA_NUDGES: ((env: Env, now: number, origin: string) => Promise<DueNudge[]>)[] = [ancestralUrgent];

practice.post("/nudges/due", async (c) => {
  const now = Date.now();
  const r = await dueNudges(c.env, ORIGIN, now, async (env, t) => (await Promise.all(EXTRA_NUDGES.map((f) => f(env, t, ORIGIN)))).flat());
  return ok(c, r);
});

practice.post("/nudges/:day/:kind/sent", async (c) => {
  const day = c.req.param("day");
  const kind = c.req.param("kind");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !["lapse", "midday", "ancestral_urgent"].includes(kind)) throw badRequest("Unknown nudge.");
  const marked = await markNudgeSent(c.env, day, kind);
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "practice_nudge", entityId: `${day}:${kind}`, action: "sent" });
  return ok(c, { marked });
});
