/** Node test stand-in for workerd's built-in `cloudflare:workers` (the real one exists only inside workerd). */
export class WorkerEntrypoint<E = unknown> {
  env: E;
  ctx: unknown;
  constructor(ctx: unknown, env: E) { this.ctx = ctx; this.env = env; }
}
