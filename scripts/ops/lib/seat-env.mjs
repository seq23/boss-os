/**
 * THE ENVIRONMENT A `claude -p` CHILD GETS WHEN IT MUST RUN ON HER SEAT.
 *
 * ─── The live defect this closes (21 Sep 2026, 13:00 CT) ───────────────────
 *
 * Her first two real repo changes (rc_m32h8ze2a4hk37pc, rc_m32h946mv0eybxhj) stopped in 3 s with
 * PHASE_DID_NOT_COMPLETE. The plan log:
 *
 *   ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set
 *     and takes precedence over your claude.ai login
 *   Credit balance is too low
 *
 * `repo-change.sh` runs the runner under `npm run vault:run`, which injects EVERY vault secret —
 * ANTHROPIC_API_KEY among them — and the runner spawned `claude` with `env: process.env`. The CLI
 * saw the key, dropped her subscription login, billed an API account with no credit, and refused.
 * The same key also switches off the claude.ai connectors, which is how `credential-check.mjs`
 * (also under vault:run) would have read the Gmail connector as dead.
 *
 * Her rule (CLAUDE.md, "Reserved env names"): ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL and the like
 * are never used for her lanes — Claude Code runs on her seat at $0 API. So every spawn of the CLI
 * from a vault-injected process goes through this: the parent keeps its secrets for the HTTP calls
 * it makes itself; the child gets none of the CLI's auth overrides.
 *
 * WHAT IS STRIPPED: every `ANTHROPIC_*` name, and every `CLAUDE_*` name that is an auth source
 * (`CLAUDE_CODE_OAUTH_TOKEN`, anything with TOKEN / KEY / SECRET / AUTH / CREDENTIAL in it).
 * `CLAUDE_BIN` (a path) and `CLAUDE_CONFIG_DIR` (where the login lives) are kept on purpose.
 */

const CLAUDE_AUTH = /^CLAUDE_(?:CODE_)?(?:.*(?:TOKEN|KEY|SECRET|AUTH|CREDENTIAL).*)$/i;

/** Which names `seatEnv` removes. Exported so the validator and the test read the same rule. */
export function isSeatOverride(name) {
  if (/^ANTHROPIC_/i.test(name)) return true;
  return CLAUDE_AUTH.test(name);
}

/** A copy of `source` with every CLI auth override removed. Never mutates the parent. */
export function seatEnv(source = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(source)) if (!isSeatOverride(k)) out[k] = v;
  return out;
}
