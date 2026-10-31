import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { canonicalSection, replaceSection, parseSections, SECTIONS, BRAIN_SLUGS } from "../../../shared/boss/brains/brain.mjs";
import { allBrains, currentCohesion, listEntry, oneBrain, revisions, saveBrain, scoreboard } from "../brains/store";

/**
 * /api/boss/brains — one document per business, read first by every employee.
 *
 *   GET  /                      every brain: slug, title, updated_at, missing_count, stale (90+ days)
 *   GET  /scoreboard            one row per tracked metric from each Numbers table; "not tracked yet" otherwise
 *   GET  /cohesion              this week's Monday check line
 *   GET  /:slug                 one brain, whole, with its sections
 *   PUT  /:slug                 { body_md } or { section, text } (+ note) — records a revision
 *   GET  /:slug/revisions       its history, newest first
 *
 * Behind the same session as the rest of /api/boss (index.ts). Private spans come back to her: she
 * is the owner; they are cut only on the way to a model (router + dispatch).
 */
export const brains = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_BODY = 200_000;

brains.get("/", async (c) => {
  const now = Date.now();
  return ok(c, { brains: (await allBrains(c.env)).map((b) => listEntry(b, now)) });
});

brains.get("/scoreboard", async (c) => ok(c, { rows: await scoreboard(c.env) }));

brains.get("/cohesion", async (c) => ok(c, await currentCohesion(c.env)));

brains.get("/:slug", async (c) => {
  const b = await oneBrain(c.env, c.req.param("slug"));
  return ok(c, { ...listEntry(b), body_md: b.body_md, sections: parseSections(b.body_md).sections });
});

brains.put("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!BRAIN_SLUGS.includes(slug)) throw badRequest(`There is no brain called ${slug}`);
  const body = await c.req.json<{ body_md?: unknown; section?: unknown; text?: unknown; note?: unknown }>().catch(() => null);
  if (!body) throw badRequest("Send the brain or one section to save");
  const current = await oneBrain(c.env, slug);
  let next: string;
  let note: string;
  if (typeof body.section === "string") {
    const section = canonicalSection(body.section);
    if (!section) throw badRequest(`There is no section called "${body.section}"`, `The sections are: ${SECTIONS.join(", ")}.`);
    if (typeof body.text !== "string") throw badRequest("Send the section's new words as text");
    next = replaceSection(current.body_md, section, body.text);
    note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : `${section} edited`;
  } else if (typeof body.body_md === "string" && body.body_md.trim()) {
    next = body.body_md;
    note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : "Whole brain edited";
  } else {
    throw badRequest("Send the brain or one section to save");
  }
  if (next.length > MAX_BODY) throw badRequest("That brain is too long to save", "Keep each brain under 200,000 characters.");
  const revision = await saveBrain(c.env, slug, next, "Sequoia", note);
  const b = await oneBrain(c.env, slug);
  return ok(c, { ...listEntry(b), body_md: b.body_md, sections: parseSections(b.body_md).sections, revision });
});

brains.get("/:slug/revisions", async (c) => ok(c, { revisions: await revisions(c.env, c.req.param("slug")) }));
