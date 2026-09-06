import type { Context } from "hono";

export class AppError extends Error {
  constructor(public status: number, message: string, public hint?: string) {
    super(message);
  }
}

export const badRequest = (m: string, hint?: string) => new AppError(400, m, hint);
export const notFound = (m: string) => new AppError(404, m);
export const conflict = (m: string, hint?: string) => new AppError(409, m, hint);

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ ok: true, data }, status as 200);
}

/** Errors say what happened and what to do. They never apologize. */
export function errorBody(err: unknown) {
  if (err instanceof AppError) {
    return { status: err.status, body: { ok: false, error: err.message, hint: err.hint } };
  }
  const message = err instanceof Error ? err.message : "Unknown failure";
  return { status: 500, body: { ok: false, error: message } };
}
