/**
 * Zora's waiting-on register (migration 0313): the list, and the few writes her daily run and the
 * Team page make. Work items only: no names, no addresses.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { newId } from "../lib/id";

export const waitingOn = new Hono<{ Bindings: Env; Variables: Vars }>();

const STATES = new Set(["open", "actioned", "done", "repair", "removed"]);
const KINDS = new Set(["measurement", "her_todo", "build", "other"]);

waitingOn.get("/", async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT * FROM waiting_on WHERE state != 'removed' ORDER BY (due_on IS NULL), due_on, created_at`).all<any>()).results ?? [];
  return ok(c, { items: rows });
});

waitingOn.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const what = String(b?.what ?? "").trim().slice(0, 300);
  if (!what) throw badRequest("what is required");
  const kind = KINDS.has(String(b?.kind)) ? String(b.kind) : "other";
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.due_on ?? "")) ? String(b.due_on) : null;
  const now = Date.now();
  const id = newId("wo");
  await c.env.DB.prepare(`INSERT INTO waiting_on (id, kind, what, owner, due_on, action, surfaces_in, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, kind, what, b?.owner ? String(b.owner).slice(0, 40) : null, due, b?.action ? String(b.action).slice(0, 600) : null, b?.surfaces_in ? String(b.surfaces_in).slice(0, 200) : null, now, now).run();
  return ok(c, { id }, 201);
});

waitingOn.post("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const row = await c.env.DB.prepare(`SELECT id FROM waiting_on WHERE id = ?`).bind(id).first();
  if (!row) throw notFound("No waiting-on item with that id");
  const state = b?.state && STATES.has(String(b.state)) ? String(b.state) : null;
  await c.env.DB.prepare(
    `UPDATE waiting_on SET state = COALESCE(?, state), task_id = COALESCE(?, task_id), told_at = COALESCE(?, told_at),
       note = COALESCE(?, note), owner = COALESCE(?, owner), due_on = COALESCE(?, due_on), updated_at = ? WHERE id = ?`,
  ).bind(state, b?.task_id ?? null, Number(b?.told_at) > 0 ? Number(b.told_at) : null, b?.note ? String(b.note).slice(0, 400) : null,
    b?.owner ? String(b.owner).slice(0, 40) : null, /^\d{4}-\d{2}-\d{2}$/.test(String(b?.due_on ?? "")) ? String(b.due_on) : null, Date.now(), id).run();
  return ok(c, { id });
});
