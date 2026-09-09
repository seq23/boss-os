/**
 * Work that needs her eyes, in her Inbox, with the work itself in it.
 *
 * ─── What she asked for ────────────────────────────────────────────────────
 *
 *   "simone should deliver them in my inbox in the Boss OS system!!!!? right?"
 *   "everything should be delivered like this for my approval? and i should have an easy way to say
 *    approved or try again and if i say apprpved she should continue to finish"
 *
 * ─── The four properties that make it that rather than a list ──────────────
 *
 * 1. THE WORK IS IN THE ITEM. Not a path, not a link to a page published elsewhere — the covers
 *    themselves, rendered where she is deciding. Having to leave the screen to judge is the
 *    hands-off failure she was objecting to in the first place.
 * 2. TWO CONTROLS. Approve, or try again with a sentence. "Try again" with no reason makes the
 *    second attempt a coin flip, so the reason travels with the verdict.
 * 3. APPROVE IS A TRIGGER. `resume_kind` names what happens; `approvals/resume.ts` holds the
 *    handlers; this endpoint REFUSES a kind with no handler, so an item cannot be created that
 *    looks actionable and starts nothing.
 * 4. IT DOES NOT EXPIRE AND IT DOES NOT VANISH. Raised with `expires_at` NULL, escalating on Today
 *    through the same ladder as every other piece of owned work, until she answers.
 *
 * ─── How the bytes get here ────────────────────────────────────────────────
 *
 * A LOCAL SCRIPT UPLOADS THEM, NOT AN AGENT. The Claude Code runner strips every credential from an
 * agent's environment, so an agent can neither unlock the vault nor authenticate to this endpoint —
 * the same split that puts Simone's mail reading on her Mac. `scripts/ops/kdp-covers-submit.mjs`
 * runs through the vault under launchd or by hand, posts the docket, and PUTs each file. That
 * establishes the answer to "can images actually reach the Inbox": yes, through a local job.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";
import { isLane } from "../../../shared/boss/lanes";
import { RESUME_HANDLERS } from "../approvals/resume";

export const judgement = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Images only, and a short allowlist rather than "whatever the client says". */
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);
/** A finished cover is a few hundred kilobytes. Ten megabytes is generous and still bounded. */
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const key = (judgementId: string, ord: number) => `judgement/${judgementId}/${ord}`;

async function assetsFor(env: Env, judgementId: string) {
  const rows = await env.DB
    .prepare(
      `SELECT ord, label, media_type, bytes, r2_key, missing_reason
         FROM judgement_assets WHERE judgement_id = ? ORDER BY ord`,
    )
    .bind(judgementId)
    .all<any>();
  return (rows.results ?? []).map((a) => ({
    ord: a.ord,
    label: a.label,
    media_type: a.media_type,
    bytes: a.bytes,
    /*
     * HONEST DEGRADATION, DECIDED HERE RATHER THAN IN THE BROWSER. `available` false means the
     * screen prints the reason in the frame instead of an empty box. An approval that shows a blank
     * where the work should be is asking her to approve something she cannot see.
     */
    available: a.r2_key !== null,
    missing_reason: a.r2_key === null ? (a.missing_reason ?? "This file was never uploaded.") : null,
    url: a.r2_key !== null ? `/api/boss/judgement/${judgementId}/asset/${a.ord}` : null,
  }));
}

/** Everything waiting on her, with the work attached. */
judgement.get("/pending", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT j.*, e.name AS employee_name
         FROM judgement_calls j
         LEFT JOIN employees e ON e.id = j.employee_id
        WHERE j.state = 'awaiting'
        ORDER BY j.created_at`,
    )
    .all<any>();

  const items = [];
  for (const j of rows.results ?? []) items.push({ ...j, assets: await assetsFor(c.env, j.id) });
  return ok(c, { items });
});

judgement.get("/:id", async (c) => {
  const id = c.req.param("id");
  const j = await c.env.DB
    .prepare(
      `SELECT j.*, e.name AS employee_name
         FROM judgement_calls j LEFT JOIN employees e ON e.id = j.employee_id
        WHERE j.id = ?`,
    )
    .bind(id).first<any>();
  if (!j) throw notFound("No judgement call with that id");
  return ok(c, { ...j, assets: await assetsFor(c.env, id) });
});

/**
 * The bytes, streamed back through the session she already holds.
 *
 * No signed URL, no public object: the R2 object is never reachable except through this route, and
 * this route is behind the same gate as every other screen.
 */
judgement.get("/:id/asset/:ord", async (c) => {
  const id = c.req.param("id");
  const ord = Number(c.req.param("ord"));
  const row = await c.env.DB
    .prepare(`SELECT r2_key, media_type, missing_reason FROM judgement_assets WHERE judgement_id = ? AND ord = ?`)
    .bind(id, ord).first<{ r2_key: string | null; media_type: string; missing_reason: string | null }>();
  if (!row) throw notFound("No such asset on that judgement call");
  if (!row.r2_key) {
    // A NAMED ABSENCE RATHER THAN A BROKEN IMAGE. The screen already knows this from `available`;
    // this is the answer if something requests the bytes anyway.
    throw notFound(row.missing_reason ?? "That file was never uploaded.");
  }

  const object = await c.env.VAULT.get(row.r2_key);
  if (!object) throw notFound("The stored file is gone from the bucket.");
  return new Response(object.body, {
    headers: {
      "content-type": row.media_type,
      "cache-control": "private, max-age=300",
    },
  });
});

/**
 * Raise one.
 *
 * Creates the docket and the judgement together, in one batch, because a judgement with no docket
 * never reaches her and a docket with no judgement has nothing to resume.
 */
judgement.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = String(b?.title ?? "").trim();
  const question = String(b?.question ?? "").trim();
  const resumeKind = String(b?.resume_kind ?? "").trim();
  const employeeId = String(b?.employee_id ?? "").trim();

  if (!title || !question) {
    throw badRequest(
      "A judgement call needs a title and a question",
      "The question is what she is actually being asked. A docket she has to reconstruct the question from is one she defers.",
    );
  }
  /*
   * THE REFUSAL THAT MAKES "APPROVE RESUMES THE WORK" STRUCTURAL.
   *
   * Same construction as `terminal_check` on an owned deliverable. Without it, a typo produces an
   * item she approves, that reports success, and that starts nothing — the defect this repository
   * produces most often, at the one place it would be least visible.
   */
  if (!RESUME_HANDLERS[resumeKind]) {
    throw badRequest(
      `"${resumeKind}" is not a resume kind this system has`,
      `One of: ${Object.keys(RESUME_HANDLERS).join(", ")}. An approval that starts nothing is worse than no approval — it teaches her that answering does not matter.`,
    );
  }
  const employee = await c.env.DB.prepare(`SELECT id, name FROM employees WHERE id = ?`).bind(employeeId).first<any>();
  if (!employee) {
    throw badRequest("A judgement call names the employee whose work it is", "Every item says who is waiting on the answer.");
  }

  const lane = isLane(b?.lane) ? b.lane : "ops";
  const id = newId("jdg");
  const approvalId = newId("apr");
  const now = Date.now();

  /*
   * SUPERSEDING, NOT STACKING. A second attempt at the same work replaces the first on her screen
   * rather than sitting beside it: two dockets showing different covers for the same seven books is
   * a way to approve the wrong set. The superseded docket's approval is closed with a reason.
   */
  const priorKey = String(b?.supersedes_key ?? "").trim();
  let attempt = 1;
  if (priorKey) {
    const prior = await c.env.DB
      .prepare(`SELECT id, approval_id, attempt FROM judgement_calls WHERE resume_kind = ? AND state = 'awaiting' ORDER BY created_at DESC`)
      .bind(priorKey).all<any>();
    for (const p of prior.results ?? []) {
      attempt = Math.max(attempt, (p.attempt ?? 1) + 1);
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE judgement_calls SET state = 'superseded', updated_at = ? WHERE id = ?`).bind(now, p.id),
        c.env.DB.prepare(
          `UPDATE approvals SET status = 'rejected', decided_at = ?, decided_by = 'system',
                                decision_note = 'Superseded by a newer attempt' WHERE id = ? AND status = 'pending'`,
        ).bind(now, p.approval_id),
      ]);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                              payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,'judgement_call','judgement_calls',?,?,?,'pending',?,NULL)`,
    ).bind(
      approvalId, lane, title, question, id,
      b?.risk === "high" || b?.risk === "low" ? b.risk : "medium",
      JSON.stringify({ judgement_id: id, resume_kind: resumeKind }),
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO judgement_calls
         (id, approval_id, employee_id, deliverable_id, title, question, resume_kind, state,
          attempt, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'awaiting',?,?,?)`,
    ).bind(id, approvalId, employeeId, b?.deliverable_id ?? null, title, question, resumeKind, attempt, now, now),
    c.env.DB.prepare(
      `INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'raised',?)`,
    ).bind(newId("ape"), approvalId, now, JSON.stringify({ judgement_id: id, attempt })),
  ]);

  /*
   * ASSET ROWS ARE CREATED EMPTY AND FILLED BY UPLOAD. Declaring them up front is what lets the
   * screen say "cover 3 of 7 was never uploaded" instead of silently showing six — an approval that
   * quietly drops one of the things it is asking about is worse than one that fails.
   */
  const declared = Array.isArray(b?.assets) ? b.assets : [];
  for (let i = 0; i < declared.length; i += 1) {
    const a = declared[i];
    const mediaType = MEDIA.has(String(a?.media_type)) ? String(a.media_type) : "image/jpeg";
    await c.env.DB
      .prepare(
        `INSERT INTO judgement_assets (id, judgement_id, ord, label, media_type, missing_reason, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(newId("jga"), id, i, String(a?.label ?? `Item ${i + 1}`).slice(0, 120), mediaType,
            "Declared but not uploaded yet.", now)
      .run();
  }

  await audit(c.env.DB, {
    actor: "system", lane, entityType: "judgement_call", entityId: id,
    action: "raised", detail: { resume_kind: resumeKind, assets: declared.length, attempt },
  });

  return ok(c, { id, approval_id: approvalId, attempt, assets: declared.length }, 201);
});

/** One file, by its declared slot. Binary body; `content-type` names the media type. */
judgement.put("/:id/asset/:ord", async (c) => {
  const id = c.req.param("id");
  const ord = Number(c.req.param("ord"));
  const row = await c.env.DB
    .prepare(`SELECT id FROM judgement_assets WHERE judgement_id = ? AND ord = ?`)
    .bind(id, ord).first<{ id: string }>();
  if (!row) throw notFound("No such asset slot — declare it when raising the judgement call.");

  const mediaType = ((c.req.header("content-type") ?? "").split(";")[0] ?? "").trim();
  if (!MEDIA.has(mediaType)) {
    throw badRequest(`"${mediaType}" is not an accepted media type`, `One of: ${[...MEDIA].join(", ")}.`);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw badRequest("Empty upload", "Nothing was sent, so nothing was stored and the slot still reads as missing.");
  if (body.byteLength > MAX_ASSET_BYTES) {
    throw badRequest("That file is too large", `The limit is ${MAX_ASSET_BYTES / (1024 * 1024)} MB.`);
  }

  await c.env.VAULT.put(key(id, ord), body, { httpMetadata: { contentType: mediaType } });
  await c.env.DB
    .prepare(
      `UPDATE judgement_assets SET r2_key = ?, media_type = ?, bytes = ?, missing_reason = NULL
        WHERE judgement_id = ? AND ord = ?`,
    )
    .bind(key(id, ord), mediaType, body.byteLength, id, ord)
    .run();

  return ok(c, { ord, bytes: body.byteLength }, 201);
});
