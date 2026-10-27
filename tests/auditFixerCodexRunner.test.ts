import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Owner, 27 Oct 2026: the search-fix passes run on Codex (her ChatGPT plan) when Claude's usage is
// spent, automatically ("an automated fallback"). Codex cannot reach the claude.ai Gmail connector, so
// it takes a pass only when no mail is needed (a scoped pass, or a mail pass handed AHREFS_DIGEST);
// anything else stops by name, never runs blind or skips silently.
const script = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");

describe("audit fixer: runners and the automatic fallback", () => {
  it("runs the same prompt through codex exec", () => {
    expect(script).toContain('RUNNER="${BOSS_AI_RUNNER:-claude}"');
    expect(script).toMatch(/run_codex\(\) \{ "\$CODEX" exec -s danger-full-access -c model_reasoning_effort=high "\$PROMPT_TEXT" < \/dev\/null >> "\$RUN_LOG"/);
  });
  it("auto: Claude first, Codex when Claude is signed out", () => {
    expect(script).toMatch(/if \[ "\$RUNNER" = "auto" \]; then\n  if claude_signed_in; then RUNNER="claude"; FALLBACK="codex"; else .*RUNNER="codex"/);
  });
  it("auto: a Claude run that ran out of usage reruns the same pass on Codex", () => {
    const fb = script.slice(script.indexOf("# THE FALLBACK"));
    expect(fb).toContain('[ "${FALLBACK:-}" = "codex" ] && ! grep -q "AHREFS-AUDIT-COMPLETE:" "$RUN_LOG"');
    expect(fb).toMatch(/usage limit\|limit reached/);
    expect(fb).toContain('RUNNER="codex"; run_codex; RC=$?');
    expect(fb).toContain("NAMED STOP [FALLBACK_UNAVAILABLE]");
  });
  it("Codex takes a mail pass only with a digest, else a named stop", () => {
    expect(script).toMatch(/codex_can_run\(\) \{\n  \[ -n "\$\{SR_SCOPE_REPO:-\}" \] && return 0\n  \[ -n "\$\{AHREFS_DIGEST:-\}" \] && \[ -s "\$AHREFS_DIGEST" \] && return 0\n  return 1\n\}/);
    expect(script).toContain("NAMED STOP [MAIL_PASS_NEEDS_CLAUDE]");
    expect(script).toContain("NAMED STOP [CODEX_NOT_AUTHENTICATED]");
    expect(script).toContain("Do NOT read Gmail this pass.");
  });
  it("keeps Claude the default runner", () => {
    expect(script).toMatch(/run_claude\(\) \{ "\$CLAUDE" -p "\$PROMPT_TEXT" --model "\$MODEL"/);
  });
});
