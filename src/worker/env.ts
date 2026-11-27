import type { WorkerReadingCredentials } from "./boss/router/freeModel";

/** Worker environment bindings. Names must match wrangler.toml. */
export interface Env extends WorkerReadingCredentials {
  /** D1 — relational operational truth. */
  WP_OS_DB: D1Database;
  /** R2 — governed binary documents/artifacts only. Optional at runtime; absence degrades cleanly. */
  WP_OS_DOCUMENTS?: R2Bucket;
  /** KV — ephemeral/config/cache only. Never institutional truth. */
  WP_OS_KV?: KVNamespace;
  /** Static React client assets (SPA). */
  ASSETS: Fetcher;
  /** local | preview | production */
  WP_OS_ENV: string;
  /**
   * Provider credentials (P16). Names only — values live in the encrypted vault and are
   * injected as Worker secrets by the operator. Absent in every current environment, which is
   * why every external provider path is UNPROVEN — CREDENTIAL GATE. Never log or echo these.
   */
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  /** Boss OS's own clock (boss/cron/dispatch.ts): repository_dispatch on seq23/boss-os. Optional: absent is a named stop, never a Worker that will not start. */
  GITHUB_SEQ23_PAT?: string;
  /** Boss OS's frontier coaching backends (passed through by bossMount.toBossEnv). */
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  FIREWORKS_API_KEY?: string;

  /**
   * Cloudflare Workers AI. A platform binding, not a credential. Absent means the cheap tier is unavailable, not that anything is broken.
   */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  /**
   * The Access service token this firm's own browser authenticates with. Present means a request
   * Access has already vouched for can be mapped onto the read-only browser identity; absent means
   * that capability simply does not exist. Read only by effects/browserClient.ts, for this firm's own host.
   */
  CF_ACCESS_CLIENT_ID?: string;
  /**
   * The other half of the service token. Used ONLY by the browser client, and only when the host it
   * is opening is this firm's own — see isOwnHost(). The Worker's own auth never reads it: Access
   * has already verified both halves before a request reaches us.
   */
  CF_ACCESS_CLIENT_SECRET?: string;

  /**
   * Boss OS only: the gsc-bot service account, so the Worker can create a Gmail draft in the
   * owner's own mailbox on her press (src/worker/boss/wealth/gmailDraft.ts). Passed through by
   * bossMount.ts; nothing in the chassis reads it. Synced by `npm run vault:sync:cloudflare`.
   */
  GSC_SERVICE_ACCOUNT_JSON?: string;

  // ── Browser Rendering (P44) ──
  // Cloudflare's own headless browser, as a binding rather than an HTTP client — so browser tasks
  // need no egress exemption and no third-party credential.
  BROWSER?: Fetcher;

  // ── Boss OS (ported subsystems, mounted at /api/boss) ──
  // Boss OS is single-user and unlocks with a passcode rather than Cloudflare Access, because it
  // has to be reachable from a home-screen install with no identity provider in front of it.
  // Both are Worker secrets; absent means Boss OS stays locked rather than open.
  BOSS_PASSCODE?: string;
  BOSS_SESSION_SECRET?: string;
  /** Optional comma-separated owner addresses. Private runtime configuration, never in source. */
  BOSS_EXTRA_OWNER_SENDERS?: string;
  /** R3 (docs/SERVICE_RULES.md): the Worker secret that encrypts a key she emails. Set from the vault. */
  BOSS_OS_SECRET_HANDOFF_KEY?: string;
  BOSS_SIMONE_GOOGLE_CLIENT_ID?: string;
  BOSS_SIMONE_GOOGLE_CLIENT_SECRET?: string;
  BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT?: string;
  BOSS_OS_VERSION?: string;
  BOSS_DEFAULT_PROVIDER?: string;
}
