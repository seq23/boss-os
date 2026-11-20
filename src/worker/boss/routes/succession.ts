/**
 * THE SUCCESSION BOOK (owner ruling 19 Nov 2026, personal brain "SUCCESSION PLAN, $0").
 *
 * Scooter's emergency book, built on her Mac by `npm run succession:build`
 * (scripts/ops/succession-book.mjs) and stored here, behind the session gate in index.ts like every
 * /api route: a logged-out request is refused before this file runs. The text is private (it names
 * her accounts, money and legal papers), so it is never in git: it lives in the Worker's existing R2
 * bucket (the VAULT binding) under one key, and nothing else reads it. No model sees it.
 *
 *   GET /   { markdown, built_at, bytes }  or 404 when it has never been built
 *   PUT /   { markdown, built_at }         the Mac's monthly rebuild
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";

export const succession = new Hono<{ Bindings: Env; Variables: Vars }>();

export const SUCCESSION_KEY = "succession/book.md";
export const SUCCESSION_MAX_BYTES = 900_000;

succession.get("/", async (c) => {
  const object = await c.env.VAULT.get(SUCCESSION_KEY);
  if (!object) throw notFound("The Succession Book has not been built yet.");
  const markdown = await object.text();
  c.header("cache-control", "no-store");
  return ok(c, { markdown, built_at: object.customMetadata?.built_at ?? object.uploaded.toISOString(), bytes: object.size });
});

succession.put("/", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { markdown?: unknown; built_at?: unknown } | null;
  const markdown = typeof b?.markdown === "string" ? b.markdown : "";
  if (!markdown.trim().startsWith("# ")) throw badRequest("Send { markdown } starting with the book's title.");
  const bytes = new TextEncoder().encode(markdown).byteLength;
  if (bytes > SUCCESSION_MAX_BYTES) throw badRequest(`The book is ${bytes} bytes; the limit is ${SUCCESSION_MAX_BYTES}.`);
  const builtAt = typeof b?.built_at === "string" && !Number.isNaN(Date.parse(b.built_at)) ? b.built_at : new Date().toISOString();
  await c.env.VAULT.put(SUCCESSION_KEY, markdown, { httpMetadata: { contentType: "text/markdown; charset=utf-8" }, customMetadata: { built_at: builtAt } });
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "succession_book", action: "stored", detail: { bytes, built_at: builtAt } }).catch(() => undefined);
  return ok(c, { stored: true, bytes, built_at: builtAt });
});
