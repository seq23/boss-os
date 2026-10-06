/**
 * Repo changes — the lane's door for her Mac, and the list a screen reads.
 *
 * ─── One live run per task, as a row-level fact ─────────────────────────────
 *
 * `POST /:id/claim` is the only way a phase starts. It refuses when a claim is still live
 * (`claimed_at` within `CLAIM_LEASE_MS`), and it refuses when the row's own state says the phase
 * may not run — `claimablePhase()` from the shared module, which is `canEnterBuild` / `canLand`
 * under two names. The runner cannot reach the plan, build or land prompt without this claim, and
 * the reports below check the claim they are closing. So "no BUILD without her reply" and "no LAND
 * without a recorded green and her reply" are enforced where the work is handed out, not in a
 * comment in the prompt.
 *
 * ─── The reports record facts the Mac established, never conclusions ────────
 *
 * `/checks` takes what `gh pr checks` said; `checks_green_at` is set here from that and from
 * nothing else. `/land` takes the merge SHA `~/bin/land` printed and the curls the runner made.
 * A runner that skipped a step has nothing to post, and a post with a missing fact is refused.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, conflict, notFound } from "../lib/http";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { repoChangeById, taskEvent, describePhase, safeList, recordForce, retryRow, type RepoChangeRow } from "../repoChange/answer";
import {
  claimablePhase, claimIsLive, canLand, canEnterBuild, canPreview, needsPreview, isForced, RUNNABLE_PHASES, PHASE_MODELS, PHASE_MAX_TURNS,
  CLAIM_LEASE_MS, TASK_KIND, EXECUTOR_SCRIPT, gridRepoNames,
  MAX_REWORKS,
} from "../../../shared/boss/repoChange/lane.mjs";
import { propertyForRepo } from "../../../shared/boss/grid.mjs";
import { constraintsOnRecord } from "../service/constraints";

export const repoChanges = new Hono<{ Bindings: Env; Variables: Vars }>();

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function view(row: RepoChangeRow, now = Date.now()) {
  return {
    ...row,
    decided: safeList(row.decided_json), asks: safeList(row.asks_json), placeholders: safeList(row.placeholders_json),
    needs_preview: needsPreview(row), forced: isForced(row), forced_placeholders: safeList(row.forced_placeholders),
    pre_approved: Boolean(row.pre_approved_phrase),
    proof: parseObj(row.proof_json), live_proof: parseObj(row.live_proof_json),
    sentence: `${row.repo ?? "package"}: ${describePhase(row)}`,
    claim_live: claimIsLive(row, now),
    claimable_phase: claimIsLive(row, now) ? null : claimablePhase(row),
  };
}
function parseObj(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** The list a screen reads: newest first, with the task's status beside the lane's phase. */
repoChanges.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT r.*, t.status AS task_status, t.title AS task_title
         FROM repo_changes r LEFT JOIN tasks t ON t.id = r.task_id
        ORDER BY r.created_at DESC LIMIT 30`,
    )
    .all<RepoChangeRow & { task_status: string | null; task_title: string | null }>();
  const now = Date.now();
  return ok(c, {
    items: (rows.results ?? []).map((r) => view(r, now)),
    lane: { kind: TASK_KIND, executor: EXECUTOR_SCRIPT, models: PHASE_MODELS, max_turns: PHASE_MAX_TURNS, lease_ms: CLAIM_LEASE_MS },
  });
});

/**
 * What the Mac may claim right now. Computed from the rows by the shared rule; a row waiting on her
 * or on the PR's checks is listed under `waiting` with the reason, so a poll that finds nothing can
 * say WHY nothing rather than just "nothing".
 */
repoChanges.get("/claimable", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM repo_changes WHERE phase IN ('plan','build','preview','previewing','landing','land') ORDER BY created_at`)
    .all<RepoChangeRow>();
  const now = Date.now();
  const claimable: unknown[] = [];
  const waiting: unknown[] = [];
  for (const r of rows.results ?? []) {
    const live = claimIsLive(r, now);
    const phase = live ? null : claimablePhase(r);
    if (phase) claimable.push({ id: r.id, task_id: r.task_id, repo: r.repo, phase, pr_number: r.pr_number, pr_url: r.pr_url });
    else waiting.push({ id: r.id, repo: r.repo, phase: r.phase, pr_number: r.pr_number, pr_url: r.pr_url, why: live ? `claimed by ${r.claimed_by} ${Math.round((now - Number(r.claimed_at)) / 60000)} min ago` : r.phase === "landing" ? "checks not yet recorded green" : r.phase === "previewing" ? "waiting for her second approved after the preview" : r.phase === "build" ? canEnterBuild(r).why : r.phase === "preview" ? canPreview(r).why : r.phase === "land" ? canLand(r).why : describePhase(r) });
  }
  return ok(c, { claimable, waiting });
});

repoChanges.get("/:id", async (c) => {
  const row = await repoChangeById(c.env, c.req.param("id"));
  if (!row) throw notFound("No repo change with that id");
  const task = await c.env.DB.prepare(`SELECT id, title, status, input FROM tasks WHERE id = ?`).bind(row.task_id).first<any>();
  return ok(c, { ...view(row), task });
});

/** THE CLAIM. One live run per task; the phase must be runnable by the row's own state. */
repoChanges.post("/:id/claim", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const device = text(b?.device_id, 120);
  if (!device) throw badRequest("A claim needs a device", "Send { device_id }.");
  const row = await repoChangeById(c.env, c.req.param("id"));
  if (!row) throw notFound("No repo change with that id");
  const now = Date.now();
  if (claimIsLive(row, now)) {
    throw conflict(
      `${row.id} is already claimed by ${row.claimed_by} for ${row.claimed_phase}`,
      `One live run per task. The claim lapses ${CLAIM_LEASE_MS / 60000} minutes after it was made if the run never reports.`,
    );
  }
  const phase = claimablePhase(row);
  if (!phase) {
    const why = row.phase === "build" ? canEnterBuild(row).why : row.phase === "land" ? canLand(row).why : row.phase === "preview" ? canPreview(row).why : describePhase(row);
    throw conflict(`${row.id} cannot run now: ${why}`, "Only plan, an answered build, an unsent preview, and a green (and, if previewed, approved) land may be claimed.");
  }
  const claimed = await c.env.DB
    .prepare(`UPDATE repo_changes SET claimed_at = ?, claimed_by = ?, claimed_phase = ?, updated_at = ? WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)`)
    .bind(now, device, phase, now, row.id, now - CLAIM_LEASE_MS)
    .run();
  if (!claimed.meta.changes) throw conflict(`${row.id} was claimed by another run a moment ago`, "Try the next tick.");
  await taskEvent(c.env, row.task_id, "repo_change_claimed", { repo_change_id: row.id, phase, device_id: device });
  const task = await c.env.DB.prepare(`SELECT id, title, input FROM tasks WHERE id = ?`).bind(row.task_id).first<any>();
  return ok(c, {
    ...view({ ...row, claimed_at: now, claimed_by: device, claimed_phase: phase }, now),
    phase,
    // The preview step is the Mac's own (no model): find the deployment URL, email her.
    model: phase === "preview" ? null : PHASE_MODELS[phase], max_turns: phase === "preview" ? null : PHASE_MAX_TURNS[phase],
    task,
    // R19: her standing constraints ride on the claim — the Mac script imports nothing from D1 — and
    // `repo-change.mjs` puts them in the same practices block every cloud run carries.
    constraints: await constraintsOnRecord(c.env.DB),
  }, 201);
});

/** A run that stopped without a result gives the claim back and says why. */
repoChanges.post("/:id/release", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b);
  const reason = text(b?.reason, 2000) ?? "released without a reason";
  await c.env.DB
    .prepare(`UPDATE repo_changes SET claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, run_log = COALESCE(?, run_log), updated_at = ? WHERE id = ?`)
    .bind(text(b?.run_log, 500), Date.now(), row.id)
    .run();
  await taskEvent(c.env, row.task_id, "repo_change_released", { repo_change_id: row.id, phase: row.claimed_phase, reason });
  return ok(c, { id: row.id, released: true });
});

/**
 * PLAN → ASKING. The plan is reported together with the fact that the email carrying it has gone
 * (`ask_message_id`), because a plan she was never sent is a plan that waits for ever. No message id,
 * no phase change: the runner releases the claim and the row says why.
 */
repoChanges.post("/:id/plan", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b, "plan");
  const planText = text(b?.plan_text, 60_000);
  if (!planText) throw badRequest("A plan report needs plan_text", "The plan as written, markdown.");
  const askMessageId = text(b?.ask_message_id, 200);
  if (!askMessageId) throw badRequest("A plan report needs ask_message_id", "The id the mail provider returned for the plan email. Without it the plan never reached her, so nothing here may move to `asking`.");
  const decided = Array.isArray(b?.decided) ? b.decided.slice(0, 100) : [];
  const asks = Array.isArray(b?.asks) ? b.asks.slice(0, 50) : [];
  /*
   * EVERY PLAN SAYS WHETHER IT IS PUBLISH-READY (owner, 21 Sep 2026). A plan that does not say is
   * refused — "did not say" would otherwise read as ready, and ready is the direction that ships a
   * placeholder. Not ready must name what would ship as a placeholder.
   */
  if (typeof b?.publish_ready !== "boolean") throw badRequest("A plan report needs publish_ready (true|false)", "false whenever any placeholder or TODO would ship; then name them in placeholders[].");
  const placeholders = Array.isArray(b?.placeholders) ? b.placeholders.map((x: unknown) => String(x).slice(0, 300)).slice(0, 50) : [];
  if (!b.publish_ready && placeholders.length === 0) throw badRequest("A plan that is not publish-ready must name its placeholders", "placeholders[] — what would ship as a placeholder, by name.");
  /*
   * THE PLAN MAY NAME THE REPO when the mail only linked a package. It must be a grid repo — the
   * same list intake reads — and it may not change a repo the mail already named: the message is
   * hers, the plan is a model's, and a model does not get to retarget her instruction.
   */
  const named = text(b?.repo, 120);
  if (named && row.repo && named !== row.repo) throw conflict(`The plan names ${named} but her message named ${row.repo}`, "A plan does not retarget her instruction.");
  if (named && !row.repo && !gridRepoNames().includes(named)) throw badRequest(`${named} is not a grid repo`, `One of: ${gridRepoNames().join(", ")}.`);
  const repo = row.repo ?? named ?? null;
  const property = repo ? propertyForRepo(repo)?.key ?? null : null;
  const now = Date.now();
  /*
   * A POST-LAND STEP IS A RECORDED COMMAND (21 Sep 2026, rc_m32h8ze2a4hk37pc: the plan said
   * "After land: loop/channel_about.py pushed from the Mac", nothing recorded it, and the LAND phase
   * reported `undefined exited undefined` after the merge). The plan names it here as the exact
   * command, or it names none; the runner refuses a plan whose text names a step this field does
   * not carry, so the stop is before the build, never after the merge.
   */
  const step = b?.post_land_step && typeof b.post_land_step === "object" ? b.post_land_step : null;
  const postLandCommand = step ? text(step.command, 400) : null;
  const postLandProof = step ? text(step.proof, 600) : null;
  if (step && !postLandCommand) throw badRequest("post_land_step needs command", "The exact command, with its arguments, run from the repo's main checkout after land. Prose is not a step.");
  /*
   * PRE-APPROVED IN THE REQUEST: the plan decides everything (a plan that still asks is refused),
   * is filed as approved by her at filing time, and BUILD parks at once. The FYI email still went
   * (`ask_message_id` is still required) so she can "stop" it. A force phrase in the request is
   * recorded through the one force writer, with her as the actor.
   */
  const pre = Boolean(row.pre_approved_phrase && row.pre_approved_by);
  if (pre && asks.length > 0) throw badRequest(`A pre-approved plan may not ask (${asks.length} ask${asks.length === 1 ? "" : "s"})`, `She wrote "${row.pre_approved_phrase}": every decision is Danielle's; move each ask into decided with its default as the decision.`);
  const phase = pre ? "build" : "asking";
  const approvedBy = pre ? `${row.pre_approved_by} (pre-approved in the request: "${row.pre_approved_phrase}")` : null;
  await c.env.DB
    .prepare(
      `UPDATE repo_changes SET phase = ?, repo = ?, property_key = ?, plan_text = ?, decided_json = ?, asks_json = ?, planned_at = ?, plan_written_by = ?,
              publish_ready = ?, placeholders_json = ?, post_land_command = ?, post_land_proof = ?,
              asked_at = ?, ask_message_id = ?, run_log = COALESCE(?, run_log),
              answered_at = ?, answers_text = ?, answers_mode = ?, plan_approved_by = ?,
              claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ?
        WHERE id = ? AND phase = 'plan'`,
    )
    .bind(phase, repo, property, planText, JSON.stringify(decided), JSON.stringify(asks), now, text(b?.written_by, 120), b.publish_ready ? 1 : 0, JSON.stringify(placeholders), postLandCommand, postLandProof, now, askMessageId, text(b?.run_log, 500),
      pre ? now : null, pre ? `pre-approved in the request: "${row.pre_approved_phrase}" — every decision is Danielle's` : null, pre ? "approved" : null, approvedBy, now, row.id)
    .run();
  if (pre && row.force_phrase) {
    await recordForce(c.env, { ...row, placeholders_json: JSON.stringify(placeholders) }, { mailId: row.mail_id, now, sender: row.pre_approved_by! }, "request");
  }
  await taskEvent(c.env, row.task_id, "repo_change_planned", { repo_change_id: row.id, decided: decided.length, asks: asks.length, publish_ready: Boolean(b.publish_ready), placeholders: placeholders.length, ask_message_id: askMessageId, pre_approved: pre, plan_approved_by: approvedBy });
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "repo_change", entityId: row.id, action: pre ? "planned_pre_approved" : "planned", detail: { task_id: row.task_id, asks: asks.length, phrase: row.pre_approved_phrase ?? null } });
  return ok(c, { id: row.id, phase, asks: asks.length, publish_ready: Boolean(b.publish_ready), placeholders: placeholders.length, pre_approved: pre });
});

/** BUILD → LANDING. The PR exists; the checks are not yet recorded. */
repoChanges.post("/:id/build", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b, "build");
  const prUrl = text(b?.pr_url, 400);
  const prNumber = Number.isInteger(b?.pr_number) ? Number(b.pr_number) : null;
  if (!prUrl || !prNumber) throw badRequest("A build report needs pr_url and pr_number", "A build with no pull request is not a build.");
  const now = Date.now();
  // A change that needs a preview goes to the preview step, not to landing: the PR is up, and the
  // next thing that happens is her preview email — never a landing.
  const next = needsPreview(row) && !isForced(row) ? "preview" : "landing";
  await c.env.DB
    .prepare(
      `UPDATE repo_changes SET phase = ?, branch = ?, pr_url = ?, pr_number = ?, built_at = ?, build_written_by = ?, proof_json = ?,
              checks_state = 'pending', run_log = COALESCE(?, run_log),
              claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ?
        WHERE id = ? AND phase = 'build'`,
    )
    .bind(next, text(b?.branch, 200), prUrl, prNumber, now, text(b?.written_by, 120), b?.proof ? JSON.stringify(b.proof).slice(0, 60_000) : null, text(b?.run_log, 500), now, row.id)
    .run();
  await taskEvent(c.env, row.task_id, "repo_change_built", { repo_change_id: row.id, pr_url: prUrl, pr_number: prNumber, next, needs_preview: needsPreview(row) });
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "repo_change", entityId: row.id, action: "pr_opened", detail: { task_id: row.task_id, pr_url: prUrl, next } });
  return ok(c, { id: row.id, phase: next, pr_url: prUrl, needs_preview: needsPreview(row) });
});

/**
 * PREVIEW → PREVIEWING. The preview email went (its id is required); the URL is the Pages branch
 * deployment when there is one and null for a Workers repo, which the email says in words.
 */
repoChanges.post("/:id/preview", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b, "preview");
  const gate = canPreview(row);
  if (!gate.ok) throw conflict(`${row.id} may not preview: ${gate.why}`);
  const messageId = text(b?.preview_message_id, 200);
  if (!messageId) throw badRequest("A preview report needs preview_message_id", "The id the mail provider returned for the preview email; without it she was never sent the preview.");
  const previewUrl = text(b?.preview_url, 500);
  const now = Date.now();
  await c.env.DB
    .prepare(
      `UPDATE repo_changes SET phase = 'previewing', preview_url = ?, preview_sent_at = ?, preview_message_id = ?, run_log = COALESCE(?, run_log),
              claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ?
        WHERE id = ? AND phase = 'preview'`,
    )
    .bind(previewUrl, now, messageId, text(b?.run_log, 500), now, row.id)
    .run();
  await taskEvent(c.env, row.task_id, "repo_change_previewed", { repo_change_id: row.id, preview_url: previewUrl, preview_message_id: messageId });
  return ok(c, { id: row.id, phase: "previewing", preview_url: previewUrl });
});

/**
 * THE CHECKS, AS `gh pr checks` REPORTED THEM. Green sets `checks_green_at` and moves to `land`;
 * pending records and stays; red is a named stop — the runner has already emailed her, and the id
 * of that email is required so "she was told" is on the row.
 */
repoChanges.post("/:id/checks", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await repoChangeById(c.env, c.req.param("id"));
  if (!row) throw notFound("No repo change with that id");
  // Recorded while landing, and while the preview is out or being sent — the green is a fact about
  // the PR whichever word she is on. Only from `landing` does a green move the phase.
  if (row.phase !== "landing" && row.phase !== "previewing" && row.phase !== "preview") throw conflict(`${row.id} is ${describePhase(row)}; checks are recorded only while landing or previewing`);
  const state = text(b?.state, 20);
  if (state !== "green" && state !== "pending" && state !== "red") throw badRequest("state must be green, pending or red");
  const detail = text(b?.detail, 4000);
  const now = Date.now();
  if (state === "green") {
    const next = row.phase === "landing" ? "land" : row.phase;
    await c.env.DB
      .prepare(`UPDATE repo_changes SET phase = ?, checks_state = 'green', checks_detail = ?, checks_green_at = COALESCE(checks_green_at, ?), updated_at = ? WHERE id = ?`)
      .bind(next, detail, now, now, row.id).run();
    await taskEvent(c.env, row.task_id, "repo_change_checks_green", { repo_change_id: row.id, pr_number: row.pr_number, detail, phase: next });
    return ok(c, { id: row.id, phase: next, checks_green_at: row.checks_green_at ?? now });
  }
  if (state === "red") {
    const told = text(b?.notified_message_id, 200);
    if (!told) throw badRequest("A red check needs notified_message_id", "Email her first; the id proves she was told.");
    await c.env.DB
      .prepare(`UPDATE repo_changes SET phase = 'failed', checks_state = 'red', checks_detail = ?, failure = ?, done_message_id = ?, updated_at = ? WHERE id = ?`)
      .bind(detail, `The pull request's checks went red: ${detail ?? "no detail"}`, told, now, row.id).run();
    await taskEvent(c.env, row.task_id, "repo_change_failed", { repo_change_id: row.id, why: "checks red", detail, notified_message_id: told });
    return ok(c, { id: row.id, phase: "failed" });
  }
  await c.env.DB
    .prepare(`UPDATE repo_changes SET checks_state = 'pending', checks_detail = ?, updated_at = ? WHERE id = ?`)
    .bind(detail, now, row.id).run();
  return ok(c, { id: row.id, phase: "landing", checks_state: "pending" });
});

/** LAND → DONE. The merge SHA, the live proof, and the id of the DONE email. */
repoChanges.post("/:id/land", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b, "land");
  const gate = canLand(row);
  if (!gate.ok) throw conflict(`${row.id} may not land: ${gate.why}`);
  const mergeSha = text(b?.merge_sha, 64);
  if (!mergeSha || !/^[0-9a-f]{7,40}$/i.test(mergeSha)) throw badRequest("A land report needs merge_sha", "The merge commit ~/bin/land printed.");
  const doneMessageId = text(b?.done_message_id, 200);
  if (!doneMessageId) throw badRequest("A land report needs done_message_id", "The DONE email must have gone before the row says done.");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE repo_changes SET phase = 'done', merge_sha = ?, landed_at = ?, live_proof_json = ?, done_at = ?, done_message_id = ?, run_log = COALESCE(?, run_log),
              claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ?
        WHERE id = ? AND phase = 'land'`,
    ).bind(mergeSha, now, b?.live_proof ? JSON.stringify(b.live_proof).slice(0, 60_000) : null, now, doneMessageId, text(b?.run_log, 500), now, row.id),
    c.env.DB.prepare(`UPDATE tasks SET status = 'done', output = ?, finished_at = ? WHERE id = ?`)
      .bind(JSON.stringify({ text: `Landed ${row.pr_url} as ${mergeSha}; proven live.`, model: "repo-change.sh on her Mac", repo_change_id: row.id }), now, row.task_id),
  ]);
  await taskEvent(c.env, row.task_id, "completed", { repo_change_id: row.id, merge_sha: mergeSha, pr_url: row.pr_url });
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "repo_change", entityId: row.id, action: "landed", detail: { task_id: row.task_id, merge_sha: mergeSha, pr_url: row.pr_url } });
  await logEvent(c.env.DB, { level: "info", scope: "duties", event: "repo_change_landed", lane: "ops", entityId: row.id, detail: { merge_sha: mergeSha, pr_url: row.pr_url } });
  return ok(c, { id: row.id, phase: "done", merge_sha: mergeSha });
});

/**
 * REWORK — A FAILED POST-LAND STEP GOES BACK TO BUILD, TO THE EMPLOYEE WHO LANDED IT. The merge
 * stands (its sha is kept under reworked_merge_shas); the PR, the checks and the build proof belong
 * to the attempt that failed and are cleared; the plan, her answer, her pre-approval and the
 * recorded post-land command are hers and stay. The failure output becomes the build's brief
 * (rework_note). `MAX_REWORKS` (shared lane.mjs) is the whole budget: a row at the cap is refused
 * here with 409, and the runner then — and only then — writes the owner a named stop that lists
 * every attempt. 21 Sep 2026: "things she can fix herself" never reach the owner.
 */
repoChanges.post("/:id/rework", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await mustBeClaimed(c.env, c.req.param("id"), b, "land");
  if (row.phase !== "land") throw conflict(`${row.id} is ${describePhase(row)}; only a landed change whose post-land step failed can be reworked`);
  const mergeSha = text(b?.merge_sha, 64);
  if (!mergeSha || !/^[0-9a-f]{7,40}$/i.test(mergeSha)) throw badRequest("A rework needs merge_sha", "The merge whose post-land step failed; the merge stands.");
  const reason = text(b?.reason, 4000);
  if (!reason) throw badRequest("A rework needs a reason", "The post-land step's command, exit code and output — that is the brief for the fix.");
  const count = Number(row.rework_count ?? 0);
  if (count >= MAX_REWORKS) throw conflict(`${row.id} has been reworked ${count} time(s); the budget is ${MAX_REWORKS}`, "The next word is the owner's: report a named stop that lists every attempt.");
  let shas: string[] = [];
  try { shas = JSON.parse(row.reworked_merge_shas ?? "[]"); } catch { shas = []; }
  if (!Array.isArray(shas)) shas = [];
  shas.push(mergeSha);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE repo_changes SET phase = 'build', rework_count = ?, rework_note = ?, reworked_merge_shas = ?,
              branch = NULL, pr_url = NULL, pr_number = NULL, built_at = NULL, build_written_by = NULL, proof_json = NULL,
              checks_state = NULL, checks_green_at = NULL, checks_detail = NULL, failure = NULL, run_log = COALESCE(?, run_log),
              claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ?
        WHERE id = ? AND phase = 'land'`,
    ).bind(count + 1, reason, JSON.stringify(shas), text(b?.run_log, 500), now, row.id),
    c.env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(row.task_id),
  ]);
  await taskEvent(c.env, row.task_id, "repo_change_reworked", { repo_change_id: row.id, rework: count + 1, of: MAX_REWORKS, merge_sha: mergeSha, reason: reason.slice(0, 2000) });
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "repo_change", entityId: row.id, action: "reworked", detail: { task_id: row.task_id, rework: count + 1, of: MAX_REWORKS, merge_sha: mergeSha, reason: reason.slice(0, 300) } });
  await logEvent(c.env.DB, { level: "warn", scope: "duties", event: "repo_change_reworked", lane: "ops", entityId: row.id, detail: { rework: count + 1, of: MAX_REWORKS, merge_sha: mergeSha, reason: reason.slice(0, 300) } });
  return ok(c, { id: row.id, phase: "build", rework_count: count + 1, max_reworks: MAX_REWORKS });
});

/** A named stop from any runnable phase. She has been emailed; the id proves it. */
repoChanges.post("/:id/failed", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const row = await repoChangeById(c.env, c.req.param("id"));
  if (!row) throw notFound("No repo change with that id");
  if (row.phase === "done") throw conflict(`${row.id} is already done`);
  const failure = text(b?.failure, 4000);
  if (!failure) throw badRequest("A failure needs a reason", "NAMED STOP [WHAT] and why.");
  const told = text(b?.notified_message_id, 200);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE repo_changes SET phase = 'failed', failure = ?, done_message_id = COALESCE(?, done_message_id), run_log = COALESCE(?, run_log), claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL, updated_at = ? WHERE id = ?`)
      .bind(failure, told, text(b?.run_log, 500), now, row.id),
    c.env.DB.prepare(`UPDATE tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).bind(failure.slice(0, 2000), now, row.task_id),
  ]);
  await taskEvent(c.env, row.task_id, "repo_change_failed", { repo_change_id: row.id, phase: row.phase, failure, notified_message_id: told });
  await logEvent(c.env.DB, { level: "warn", scope: "duties", event: "repo_change_failed", lane: "ops", entityId: row.id, detail: { phase: row.phase, failure: failure.slice(0, 300), told: Boolean(told) } });
  return ok(c, { id: row.id, phase: "failed" });
});

/**
 * RETRY — HER DOOR FOR A FAILED ROW, WITHOUT A REPLY. A named stop that was the lane's own fault
 * (21 Sep 2026: an API key overriding her seat) should not cost her an email. From her session, a
 * `failed` row goes back to `plan`: the claim, the failure and the plan's own outputs are cleared,
 * the task is queued again, and the next tick starts fresh — her instruction, her pre-approval and
 * her force phrase are hers and stay. Anything past `plan` (an answer, a PR) belongs to the run
 * that failed and is cleared with it; the fresh plan email will ask again.
 */
repoChanges.post("/:id/retry", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const row = await repoChangeById(c.env, c.req.param("id"));
  if (!row) throw notFound("No repo change with that id");
  if (row.phase !== "failed") throw conflict(`${row.id} is ${describePhase(row)}; only a failed change can be retried`);
  const { phase } = await retryRow(c.env, row, { now: Date.now(), reason: text(b?.reason, 500), by: "owner session" });
  return ok(c, { id: row.id, phase, previous_failure: row.failure });
});

/** The row must be claimed by the reporting device, for the phase the report closes. */
async function mustBeClaimed(env: Env, id: string, b: any, phase?: (typeof RUNNABLE_PHASES)[number]): Promise<RepoChangeRow> {
  const row = await repoChangeById(env, id);
  if (!row) throw notFound("No repo change with that id");
  const device = text(b?.device_id, 120);
  if (!device) throw badRequest("A report needs device_id", "The device that holds the claim.");
  if (!row.claimed_at || row.claimed_by !== device) throw conflict(`${row.id} is not claimed by ${device}`, "Claim it first; a report without a claim is a run nothing handed out.");
  if (phase && row.claimed_phase !== phase) throw conflict(`${row.id} is claimed for ${row.claimed_phase}, not ${phase}`);
  return row;
}
