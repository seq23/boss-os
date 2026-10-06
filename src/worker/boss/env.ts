export interface Env {
  DB: D1Database;
  VAULT: R2Bucket;
  SESSIONS: KVNamespace;
  TASKS: Queue<TaskMessage>;
  ASSETS: Fetcher;

  BOSS_OS_VERSION: string;
  DEFAULT_PROVIDER: string;

  /** "cloud" (default) or "private". A cloud runtime never snapshots LOCAL_ONLY tables. */
  BOSS_DOMAIN?: string;
  BOSS_PASSCODE: string;
  SESSION_SECRET: string;
  FIREWORKS_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /**
   * The second frontier provider, for coaching. Optional for the same reason every other key here
   * is: a required binding makes the local harness fail to CONSTRUCT rather than fail honestly at
   * the point of use, and "the key is not set" is a better error than "the Worker would not start".
   */
  OPENAI_API_KEY?: string;
  /**
   * The gsc-bot service account, as the vault holds it, so the Worker can create a Gmail DRAFT in
   * her own mailbox on the green button (`wealth/gmailDraft.ts`). One scope, `gmail.compose`, and
   * one endpoint, `drafts.create`; the validators refuse a send scope or a send endpoint on that
   * path. Optional for the reason every other key here is: its absence is a NAMED STOP on the card
   * ("the Worker holds no Google key"), never a Worker that will not start.
   */
  GSC_SERVICE_ACCOUNT_JSON?: string;
  /** R3: AES-256 key (base64, 32 bytes) for keys she emails as `SECRET NAME=value`. Absent → the door fails closed. */
  BOSS_OS_SECRET_HANDOFF_KEY?: string;

  /**
   * Workers AI. A BINDING, not an HTTP client — which is why it needs no key, no hostname, and no
   * entry on the egress allowlist: nothing here calls fetch, so there is no credential that could
   * leak and no host to allow.
   *
   * IT WAS DECLARED IN wrangler.toml AND UNREACHABLE FROM CODE. `[ai] binding = "AI"` has been in
   * both profiles since the port, but this interface never named it and `bossMount.ts` never passed
   * it through — so `credentialState(env, "binding:AI")` reported the binding absent and the
   * Workers AI backend could never be enabled.
   *
   * That is load-bearing rather than cosmetic. Workers AI's included daily allowance is the ONLY
   * genuinely free cloud tier this system has, and the owner's standing instruction is to keep
   * everything as close to $0 as possible. With the binding unreachable, the default FREE_ONLY
   * position had exactly one eligible route — Claude Code on her own Mac — and no free cloud route
   * at all. Found independently by two agents, neither of which owned this file.
   *
   * Optional, because the local test harness and the private runtime both stand up an Env without
   * it, and a required binding would make them fail to construct rather than fail honestly at the
   * point of use. Absent means the backend refuses and says the binding is missing.
   */
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
}

export interface TaskMessage {
  taskId: string;
  lane: string;
  attempt?: number;
}

export type Vars = { session: { id: string; issuedAt: number } };
