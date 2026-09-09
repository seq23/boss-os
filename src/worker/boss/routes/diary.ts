/**
 * A diary she can write in.
 *
 * "i should be able to input what meetings i have" — and a diary you cannot write in is not a diary.
 * Manual entry is the PRIMARY route, not a fallback while calendar sync is built: a service account
 * can never read a personal Google calendar, so whatever gets connected, this will always be where
 * some of her meetings come from.
 *
 * `POST /sync` is the calendar half, filed by a local job for the same reason every other read of
 * her accounts is: the Claude Code runner strips credentials, and the Worker holds no Google key.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";
import { diary } from "../today/diary";

export const diaryRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

diaryRoutes.get("/", async (c) => ok(c, await diary(c.env)));

/** One she typed. */
diaryRoutes.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = String(b?.title ?? "").trim();
  const at = Number(b?.scheduled_at);

  if (!title) throw badRequest("A meeting needs a name", "Something you would recognise in a list at 6am.");
  if (!Number.isFinite(at) || at <= 0) {
    throw badRequest("A meeting needs a time", "Send scheduled_at as milliseconds since the epoch.");
  }

  const now = Date.now();
  const id = newId("dia");
  await c.env.DB
    .prepare(
      `INSERT INTO diary_entries
         (id, title, counterpart, scheduled_at, duration_min, location, source, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'manual', ?,?,?)`,
    )
    .bind(
      id, title.slice(0, 200),
      b?.counterpart ? String(b.counterpart).trim().slice(0, 80) : null,
      Math.floor(at),
      Number.isFinite(Number(b?.duration_min)) ? Math.floor(Number(b.duration_min)) : null,
      b?.location ? String(b.location).slice(0, 200) : null,
      b?.note ? String(b.note).slice(0, 600) : null,
      now, now,
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "diary_entry", entityId: id,
    action: "added", detail: { title: title.slice(0, 80) },
  });
  return ok(c, await diary(c.env), 201);
});

/**
 * Cancelled, not deleted.
 *
 * "He moved it" and "it never existed" are different facts, and a deleted row makes them identical.
 * The standing Wednesday has no row at all and cannot be cancelled here — it is derived, which is
 * what keeps it in the diary on a week when everything else has failed.
 */
diaryRoutes.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT id FROM diary_entries WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!row) throw notFound("No diary entry with that id");
  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE diary_entries SET cancelled_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, id)
    .run();
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "diary_entry", entityId: id, action: "cancelled" });
  return ok(c, await diary(c.env));
});

/**
 * A local job filing what it read from a calendar.
 *
 * UPSERTED ON `calendar_uid`, so a job run twice in a morning does not produce a diary with
 * everything in it twice — which is the fastest way to make her stop trusting the screen.
 *
 * A SYNC THAT READ NOTHING FILES NOTHING AND SAYS SO. An empty batch is refused rather than
 * recorded as a successful empty sync, because "the calendar is clear" and "the job could not read
 * the calendar" render identically once they are both zero rows.
 */
diaryRoutes.post("/sync", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const events = Array.isArray(b?.events) ? b.events : null;
  if (!events || events.length === 0) {
    throw badRequest(
      "No events were filed",
      "A sync that read nothing must not report success — an empty calendar and an unreadable one look identical once both are zero rows, and only one of them means she has a clear fortnight.",
    );
  }

  const now = Date.now();
  let filed = 0;
  for (const e of events) {
    const uid = String(e?.calendar_uid ?? "").trim();
    const title = String(e?.title ?? "").trim();
    const at = Number(e?.scheduled_at);
    if (!uid || !title || !Number.isFinite(at)) continue;

    await c.env.DB
      .prepare(
        `INSERT INTO diary_entries
           (id, title, counterpart, scheduled_at, duration_min, location, source, calendar_uid, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'calendar', ?,?,?)
         ON CONFLICT(calendar_uid) DO UPDATE SET
           title = excluded.title, scheduled_at = excluded.scheduled_at,
           duration_min = excluded.duration_min, location = excluded.location,
           counterpart = excluded.counterpart, cancelled_at = NULL, updated_at = excluded.updated_at`,
      )
      .bind(
        newId("dia"), title.slice(0, 200),
        e?.counterpart ? String(e.counterpart).slice(0, 80) : null,
        Math.floor(at),
        Number.isFinite(Number(e?.duration_min)) ? Math.floor(Number(e.duration_min)) : null,
        e?.location ? String(e.location).slice(0, 200) : null,
        uid.slice(0, 200), now, now,
      )
      .run();
    filed += 1;
  }

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "diary_entry", entityId: null,
    action: "calendar_synced", detail: { filed, offered: events.length },
  });
  return ok(c, { filed, offered: events.length }, 201);
});
