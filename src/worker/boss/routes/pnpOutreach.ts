/** Authenticated Mac-job desk. Sending belongs exclusively to the campaign site's guarded API. */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { newId } from "../lib/id";
import { blocked, validProspect, planSends, assertStatus, contactRules, dayStart } from "../../../shared/boss/pnp/outreach.mjs";

export const pnpOutreach = new Hono<{ Bindings: Env; Variables: Vars }>();
pnpOutreach.get("/", async (c) => ok(c, { rows: (await c.env.DB.prepare("SELECT * FROM pnp_outreach_prospects ORDER BY found_at, id").all()).results }));

pnpOutreach.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("A job operation is required.");
  const db = c.env.DB;
  const now = Date.now();
  if (b.op === "import") {
    if (!Array.isArray(b.rows) || b.rows.length > 60 || !b.rows.every(validProspect)) throw badRequest("Published contact and line sources are required.");
    if (b.rows.length) await db.batch(b.rows.map((r: any) => db.prepare(`INSERT OR IGNORE INTO pnp_outreach_prospects
      (id,company,domain,contact_first,contact_email,role,kind,line,source_url,line_source_url,found_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(newId("pnp"), r.company, r.domain.toLowerCase(), r.contact_first, r.contact_email.toLowerCase(), r.role, r.kind, r.line, r.source_url, r.line_source_url, now, now)));
    return ok(c, { recorded: true });
  }
  if (b.op === "status") {
    try { assertStatus(b.status); contactRules(b.status); } catch { throw badRequest("Status and do-not-contact settings are required."); }
    const rows = (await db.prepare("SELECT * FROM pnp_outreach_prospects").all<any>()).results;
    const updates = rows.map((r) => ({ r, state: blocked(r, b.status) })).filter((x) => x.state);
    if (updates.length) await db.batch(updates.map(({ r, state }) => db.prepare("UPDATE pnp_outreach_prospects SET state=?,updated_at=? WHERE id=?").bind(state, now, r.id)));
    return ok(c, { recorded: updates.length });
  }
  if (b.op === "verdict") {
    if (typeof b.email !== "string" || !["valid", "invalid", "disposable", "catchall", "unknown"].includes(b.verdict)) throw badRequest("A NeverBounce verdict is required.");
    await db.prepare(`UPDATE pnp_outreach_prospects SET nb_verdict=?,verified_at=?,updated_at=?,state=?
      WHERE contact_email=? AND state='found'`).bind(b.verdict, now, now, b.verdict === "valid" ? "verified" : "skipped", b.email.toLowerCase()).run();
    return ok(c, { recorded: true });
  }
  if (b.op === "claim") {
    try { assertStatus(b.status); contactRules(b.status); } catch { throw badRequest("Current sender status is required."); }
    const rows = (await db.prepare("SELECT * FROM pnp_outreach_prospects").all<any>()).results;
    const due = planSends(rows, b.status, now).find((s: any) => s.row.id === b.id && s.touch === b.touch);
    if (!due) return ok(c, { claimed: false });
    // Conditional writes also prevent two processes claiming the same touch. A lost response is held.
    const q = b.touch === 1
      ? `UPDATE pnp_outreach_prospects SET first_attempt_at=?,updated_at=? WHERE id=? AND state='verified' AND first_attempt_at IS NULL
          AND (SELECT count(*) FROM pnp_outreach_prospects WHERE first_attempt_at>=?) < 12`
      : `UPDATE pnp_outreach_prospects SET followup_attempt_at=?,updated_at=? WHERE id=? AND state='sent1' AND followup_attempt_at IS NULL
          AND (SELECT count(*) FROM pnp_outreach_prospects WHERE followup_attempt_at>=?) < 15`;
    const r = await db.prepare(q).bind(now, now, b.id, dayStart(now)).run();
    return ok(c, { claimed: r.meta.changes === 1 });
  }
  if (b.op === "result") {
    if (![1, 2].includes(b.touch) || typeof b.message_id !== "string" || !b.message_id.trim()) throw badRequest("A successful sender receipt is required.");
    const q = b.touch === 1
      ? "UPDATE pnp_outreach_prospects SET first_sent_at=?,first_message_id=?,state='sent1',updated_at=? WHERE id=? AND state='verified' AND first_attempt_at IS NOT NULL AND first_message_id IS NULL"
      : "UPDATE pnp_outreach_prospects SET followup_sent_at=?,followup_message_id=?,state='sent2',updated_at=? WHERE id=? AND state='sent1' AND followup_attempt_at IS NOT NULL AND followup_message_id IS NULL";
    await db.prepare(q).bind(now, b.message_id, now, b.id).run();
    return ok(c, { recorded: true });
  }
  throw badRequest("Unknown job operation.");
});
