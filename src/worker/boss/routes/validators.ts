import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { audit } from "../lib/audit";
import { matrixFlagWords, matrixSummary, snapshotProblems, type Matrix } from "../../../shared/boss/validators/matrix.mjs";

/**
 * THE VALIDATOR MATRIX (owner, 1 Nov 2026). The Mac reads every repo's validators and the review
 * files on Sunday evening (scripts/ops/validator-matrix.mjs, inside the cohesion check) and posts the
 * whole matrix here; the page (☰ More → Validators) reads it back. Stamped when it ARRIVED, never
 * with a time the Mac claims.
 *
 *   GET  /   { matrix, summary, flagged }   matrix null when the Mac has never posted
 *   POST /   the Mac's snapshot (refused when its shape is wrong)
 */
export const validators = new Hono<{ Bindings: Env; Variables: Vars }>();

export const MATRIX_KEY = "validator_matrix";
const MAX_BYTES = 900_000;

validators.get("/", async (c) => {
  const raw = await getSetting(c.env.DB, MATRIX_KEY);
  let matrix: Matrix | null = null;
  try { matrix = raw ? (JSON.parse(raw) as Matrix) : null; } catch { matrix = null; }
  return ok(c, { matrix, summary: matrix ? matrixSummary(matrix) : null, flagged: matrix ? matrixFlagWords(matrix) : null });
});

validators.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const problems = snapshotProblems(body);
  if (problems.length) throw badRequest("That is not a validator matrix", problems.slice(0, 3).join("; "));
  const rec = { ...(body as Matrix), at: Date.now() };
  const text = JSON.stringify(rec);
  if (text.length > MAX_BYTES) throw badRequest("The validator matrix is too big to keep");
  await setSetting(c.env.DB, MATRIX_KEY, text);
  await audit(c.env.DB, { actor: "mac", lane: "ops", entityType: "validators", entityId: "matrix", action: "validator_matrix_recorded", detail: { rows: rec.rows.length } });
  return ok(c, { recorded: rec.rows.length, summary: matrixSummary(rec), flagged: matrixFlagWords(rec) });
});
