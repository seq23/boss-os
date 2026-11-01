/**
 * THE MORNING, AS SENT — what Simone's email said, kept so every link in it opens a real screen.
 *
 * Owner, 24 Oct 2026: her email said "6 decisions", showed 3 and pointed at "your Today page", and
 * Today showed nothing. The email is built on her Mac from the section files the producers write
 * (~/.boss-os/morning); the Worker never saw them, so Today could not list what the email counted.
 *
 *   POST /             the Mac posts the whole morning BEFORE the email goes: { day, payload }
 *   POST /:day/sent    the Mac records that the email carrying it went
 *   GET  /latest       the newest morning (Today's "This morning's email" block)
 *   GET  /:day         one morning (each item screen: /?morning=<day>&item=<id>)
 *
 * THE SECTIONS BEFORE THE MORNING (1 Nov 2026, the Mac→cloud move): the producers' section files,
 * kept here so a producer on a cloud runner and one on her Mac feed the same email.
 *   POST /sections        { section, job, mode: "replace" | "append", body }  (src/shared/boss/mail/morning.mjs)
 *   GET  /sections        every section not yet told (your-day applies the staleness rule)
 *   POST /sections/told   { sections: [...] } after the email that carried them went
 *
 * One writer (scripts/ops/your-day.mjs `buildDay` → `digest`), one shape, read by Today and the item
 * screen alike, so the email, Today and the item can never disagree about what is waiting for her.
 * Names stay in D1 (`morning_digests`, LOCAL_ONLY for models); nothing here reaches a model.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { dismissedSet, pruneDismissed } from "../capital/dismiss";
import { dayIdInZone } from "../../../shared/boss/timezone";
import { MORNING_SECTIONS, morningSectionProblems, appendToSection } from "../../../shared/boss/mail/morningSections.mjs";

export const morning = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAYLOAD = 900_000;

interface Row { day: string; payload: string; sent_at: number | null; created_at: number; updated_at: number }

/**
 * A card she answered by reply ("N: …", lp/decideReply.ts) leaves Decide at once and is kept under
 * `answered`, so its screen still opens. The stored list keeps its order: the numbers in the email
 * she is answering never shift under her.
 */
export function view(r: Row) {
  let payload: any = null;
  try { payload = JSON.parse(r.payload); } catch { payload = null; }
  if (payload && Array.isArray(payload.decide)) {
    const answered = payload.decide.filter((d: any) => d?.answered_at);
    payload = { ...payload, decide: payload.decide.filter((d: any) => !d?.answered_at), answered };
  }
  return { day: r.day, sent_at: r.sent_at, updated_at: r.updated_at, payload };
}

interface SectionRow { section: string; job: string; day: string; body: string; status: string; told_at: number | null; updated_at: number }
const JOB_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Registered before "/:day" so "sections" is never read as a day.
morning.post("/sections", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { section?: string; job?: string; mode?: string; body?: any } | null;
  if (!b || !MORNING_SECTIONS.includes(String(b.section))) throw badRequest(`section must be one of ${MORNING_SECTIONS.join(", ")}`);
  if (!JOB_RE.test(String(b.job ?? ""))) throw badRequest("job is the writing job's name");
  if (b.mode !== "replace" && b.mode !== "append") throw badRequest('mode is "replace" or "append"');
  if (!b.body || typeof b.body !== "object") throw badRequest("body is the section object (replace) or { lines, decide } (append)");
  const now = Date.now();
  const section = b.section as string;
  let obj: any;
  if (b.mode === "replace") {
    obj = { decide: [], rows: [], lines: [], ...b.body, section };
  } else {
    // A told copy is gone, as the renamed file was: the first append after the email starts fresh.
    const prev = await c.env.DB.prepare(`SELECT body, status FROM morning_sections WHERE section = ?`).bind(section).first<{ body: string; status: string }>();
    let prevObj: any = null;
    if (prev && prev.status !== "told") { try { prevObj = JSON.parse(prev.body); } catch { prevObj = null; } }
    obj = appendToSection(prevObj, section, { lines: b.body.lines ?? [], decide: b.body.decide ?? [] }, now);
  }
  const problems = morningSectionProblems(obj);
  if (problems.length) throw badRequest(`morning section "${section}" refused: ${problems.join("; ")}`);
  const json = JSON.stringify(obj);
  if (json.length > MAX_PAYLOAD) throw badRequest(`The section is ${json.length} characters; the most kept is ${MAX_PAYLOAD}`);
  await c.env.DB
    .prepare(`INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at) VALUES (?,?,?,?,'fresh',NULL,?,?)
              ON CONFLICT(section) DO UPDATE SET job = excluded.job, day = excluded.day, body = excluded.body,
                status = 'fresh', told_at = NULL, updated_at = excluded.updated_at`)
    .bind(section, b.job, dayIdInZone(now), json, now, now)
    .run();
  return ok(c, { section, lines: (obj.lines ?? []).length, decide: (obj.decide ?? []).length }, 201);
});

morning.get("/sections", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM morning_sections WHERE status != 'told' ORDER BY section`).all<SectionRow>();
  const rows = (results ?? []).map((r) => {
    let body: unknown = null;
    try { body = JSON.parse(r.body); } catch { body = null; }
    return { section: r.section, job: r.job, day: r.day, status: r.status, updated_at: r.updated_at, body };
  });
  return ok(c, { rows });
});

morning.post("/sections/told", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { sections?: unknown } | null;
  const names = Array.isArray(b?.sections) ? (b!.sections as unknown[]).filter((n): n is string => MORNING_SECTIONS.includes(String(n))) : [];
  if (!names.length) throw badRequest("sections: the names the email told");
  const now = Date.now();
  await c.env.DB.batch(names.map((n) => c.env.DB.prepare(`UPDATE morning_sections SET status = 'told', told_at = ? WHERE section = ?`).bind(now, n)));
  return ok(c, { told: names });
});

morning.post("/", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { day?: string; payload?: unknown } | null;
  if (!b || !DAY_RE.test(String(b.day ?? ""))) throw badRequest("Send { day: YYYY-MM-DD, payload }");
  const p = b.payload as { decide?: unknown } | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.decide)) throw badRequest("payload.decide[] is required, even when empty");
  const json = JSON.stringify(p);
  if (json.length > MAX_PAYLOAD) throw badRequest(`The morning is ${json.length} characters; the most kept is ${MAX_PAYLOAD}`);
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES (?,?,NULL,?,?)
              ON CONFLICT(day) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(b.day, json, now, now)
    .run();
  return ok(c, { day: b.day, decide: (p.decide as unknown[]).length }, 201);
});

morning.post("/:day/sent", async (c) => {
  const day = c.req.param("day");
  if (!DAY_RE.test(day)) throw badRequest("The day is YYYY-MM-DD");
  const r = await c.env.DB.prepare(`UPDATE morning_digests SET sent_at = ? WHERE day = ?`).bind(Date.now(), day).run();
  if (!r.meta.changes) throw notFound(`No morning kept for ${day}`);
  return ok(c, { day, sent: true });
});

morning.get("/latest", async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM morning_digests ORDER BY day DESC LIMIT 1`).first<Row>();
  // What she has dismissed since leaves Today and the item screens at once (25 Oct 2026).
  return ok(c, r ? pruneDismissed(view(r), await dismissedSet(c.env)) : null);
});

morning.get("/:day", async (c) => {
  const day = c.req.param("day");
  if (!DAY_RE.test(day)) throw badRequest("The day is YYYY-MM-DD");
  const r = await c.env.DB.prepare(`SELECT * FROM morning_digests WHERE day = ?`).bind(day).first<Row>();
  if (!r) throw notFound(`No morning kept for ${day}`);
  return ok(c, pruneDismissed(view(r), await dismissedSet(c.env)));
});
