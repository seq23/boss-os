/**
 * /api/service — WHAT HER MAC'S PASS COLLECTS AND REPORTS (6 Oct 2026; docs/SERVICE_RULES.md).
 *
 * `scripts/ops/service-tick.mjs` runs on every five-minute claim tick (`agent-claim.sh`), over her
 * own unlocked session like every other Mac script — Boss OS has no separate claimer identity — and:
 *
 *   · collects emailed keys and moves each into the vault (R3), then says so here so the row goes;
 *   · reports a key it found in the vault for work that waited on one (R5 → R4);
 *   · re-checks DNS records she was asked to add, until live or seven days (R27);
 *   · looks at Drive folders named in an ask and loads what arrived (R21).
 *
 * The plaintext of a key exists in exactly one place: the body of `GET /secret-handoffs/pending`.
 * It is never logged and never in an audit row.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { audit } from "../lib/audit";
import { decryptSecret, expireSecretHandoffs, recordSecretWait, resumeForSecret } from "../service/secretHandoff";
import { applyDriveWatchStatus, recordDnsWaits } from "../service/macWaits";

export const service = new Hono<{ Bindings: Env; Variables: Vars }>();

service.get("/secret-handoffs/pending", async (c) => {
  await expireSecretHandoffs(c.env);
  const rows = await c.env.DB
    .prepare(`SELECT id, name, repo, ciphertext, iv FROM boss_secret_handoff ORDER BY created_at ASC LIMIT 20`)
    .all<{ id: string; name: string; repo: string | null; ciphertext: string; iv: string }>();
  const handoffs: Array<{ id: string; name: string; repo: string | null; value: string }> = [];
  const unreadable: string[] = [];
  for (const r of rows.results ?? []) {
    const value = await decryptSecret(c.env, r);
    if (value === null) unreadable.push(r.id);
    else handoffs.push({ id: r.id, name: r.name, repo: r.repo, value });
  }
  return ok(c, { handoffs, unreadable });
});

service.post("/secret-handoffs/:id/stored", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT id, name, repo FROM boss_secret_handoff WHERE id = ?`).bind(id).first<{ id: string; name: string; repo: string | null }>();
  if (!row) return ok(c, { gone: true });
  await c.env.DB.prepare(`DELETE FROM boss_secret_handoff WHERE id = ?`).bind(id).run();
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "secret_handoff", entityId: id, action: "vaulted", detail: { name: row.name, repo: row.repo } });
  return ok(c, { vaulted: row.name });
});

/** Work that waits for a key, by NAME (the repo lane, after it looked in the vault first). */
service.post("/secret-waits", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const names: string[] = Array.isArray(b?.names) ? b.names.filter((n: unknown) => typeof n === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(n)) : [];
  if (!names.length || (!b?.change_id && !b?.task_id)) throw badRequest("A secret wait needs names and a change_id or task_id");
  let added = 0;
  for (const name of names.slice(0, 10)) if (await recordSecretWait(c.env, { name, changeId: b.change_id ?? null, taskId: b.task_id ?? null })) added += 1;
  return ok(c, { added });
});

/** Her Mac found the key in the vault (exact name or vendor prefix): the work that waited resumes, nobody is asked. */
service.post("/secret-waits/resolve", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = typeof b?.name === "string" ? b.name : "";
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(name)) throw badRequest("resolve needs the key's NAME");
  return ok(c, { resumed: await resumeForSecret(c.env, name) });
});

service.post("/dns-waits", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.repo || !Array.isArray(b?.records)) throw badRequest("A DNS wait needs repo and records");
  return ok(c, { ids: await recordDnsWaits(c.env, { changeId: b.change_id ?? null, repo: String(b.repo), records: b.records }) });
});

service.get("/dns-waits/pending", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM boss_dns_wait WHERE live_seen_at IS NULL AND expires_at > ? ORDER BY created_at LIMIT 20`)
    .bind(Date.now())
    .all();
  return ok(c, { items: rows.results ?? [] });
});

service.post("/dns-waits/:id/checked", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE boss_dns_wait SET checked_at = ?, live_seen_at = CASE WHEN ? = 1 THEN ? ELSE live_seen_at END, told_at = CASE WHEN ? = 1 THEN ? ELSE told_at END WHERE id = ?`)
    .bind(now, b?.live ? 1 : 0, now, b?.told ? 1 : 0, now, c.req.param("id"))
    .run();
  return ok(c, { checked: true });
});

service.get("/drive-watches/pending", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, task_id, change_id, folder_id, url FROM boss_drive_watch WHERE state = 'waiting' ORDER BY created_at LIMIT 10`)
    .all();
  return ok(c, { items: rows.results ?? [] });
});

service.post("/drive-watches/:id/status", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  return ok(c, await applyDriveWatchStatus(c.env, c.req.param("id"), { files: Number(b?.files ?? 0), text: typeof b?.text === "string" ? b.text : null }));
});
