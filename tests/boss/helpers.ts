import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker/boss/index";
import { sessionFingerprint } from "../../src/worker/boss/auth";

let counter = 0;

/** Like RequestInit, but `body` is the value to serialise rather than a BodyInit. */
type ApiInit = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * Calls the real Worker with a real session, so route tests exercise the actual
 * middleware chain and error handler rather than a sub-app in isolation.
 */
export async function api(path: string, init?: ApiInit): Promise<Response> {
  const token = uid("ses");
  // Minted the way `signIn` mints one, fingerprint included, so route tests
  // exercise the real session check rather than a shape the gate would refuse.
  await env.SESSIONS.put(
    `session:${token}`,
    JSON.stringify({ id: token, issuedAt: Date.now(), fp: await sessionFingerprint(env as any) }),
  );

  const hasBody = init?.body !== undefined;
  const request = new Request(`https://boss.test${path}`, {
    ...init,
    headers: {
      cookie: `boss_session=${token}`,
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body: hasBody ? JSON.stringify(init!.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function apiJson<T = any>(path: string, init?: ApiInit) {
  const res = await api(path, init);
  return { status: res.status, body: (await res.json()) as T };
}

export const uid = (prefix: string) => `${prefix}_test${(counter++).toString().padStart(4, "0")}`;

export async function insertTask(over: Partial<Record<string, unknown>> = {}) {
  const id = (over.id as string) ?? uid("tsk");
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                          intake_kind, execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, over.lane ?? "ops", over.employee_id ?? null, over.title ?? "A task",
      over.input ?? null, over.status ?? "awaiting_approval", now,
      over.intake_kind ?? "drafting", over.execution_assignment ?? "AI_DRAFT",
      over.risk ?? "low", over.sensitivity ?? "private", over.cost_mode ?? "NORMAL",
    )
    .run();
  return id;
}

export async function insertApproval(over: Partial<Record<string, unknown>> = {}) {
  const id = (over.id as string) ?? uid("apr");
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                              payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, over.lane ?? "ops", over.title ?? "An approval", over.summary ?? null,
      over.kind ?? "manual", over.origin_type ?? null, over.origin_id ?? null,
      over.risk ?? "low",
      over.payload === undefined ? null : JSON.stringify(over.payload),
      over.status ?? "pending", now,
      over.expires_at === undefined ? now + 86_400_000 : over.expires_at,
    )
    .run();
  return id;
}

export async function insertMemory(over: Partial<Record<string, unknown>> = {}) {
  const id = (over.id as string) ?? uid("mem");
  await env.DB
    .prepare(
      `INSERT INTO memory_items (id, lane, tier, title, body, source_type, confidence, hits, created_at, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, over.lane ?? "ops", over.tier ?? "capture", over.title ?? "A memory",
      over.body ?? "Body text", over.source_type ?? "manual",
      over.confidence ?? 0.9, over.hits ?? 0,
      over.created_at ?? Date.now(), over.status ?? "active",
    )
    .run();
  return id;
}

export async function row<T = any>(sql: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...binds).first<T>();
}

export async function all<T = any>(sql: string, ...binds: unknown[]): Promise<T[]> {
  const res = await env.DB.prepare(sql).bind(...binds).all<T>();
  return res.results ?? [];
}

/** Replaces global fetch for the duration of a test and restores it after. */
export function stubFetch(handler: (req: Request) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => handler(new Request(input, init))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** A Fireworks-shaped success response. */
export function completionResponse(text: string, inTokens = 100, outTokens = 50) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: inTokens, completion_tokens: outTokens },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
