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
    expect(script).toMatch(/run_codex\(\) \{ "\$CODEX" exec --skip-git-repo-check -s danger-full-access -c model_reasoning_effort=high "\$PROMPT_TEXT" < \/dev\/null >> "\$RUN_LOG"/);
  });
  it("auto: Claude first, Codex when Claude is signed out", () => {
    expect(script).toMatch(/if \[ "\$RUNNER" = "auto" \]; then\n  if claude_signed_in; then RUNNER="claude"; FALLBACK="codex"; else .*RUNNER="codex"/);
  });
  it("auto: a Claude run that ran out of usage reruns the same pass on Codex", () => {
    const fb = script.slice(script.indexOf("# THE FALLBACK"));
    expect(fb).toContain('[ "${FALLBACK:-}" = "codex" ] && ! has_sentinel "$RUN_LOG" && usage_exhausted "$RUN_LOG"');
    expect(fb).toContain('RUNNER="codex"; run_codex; RC=$?');
    expect(fb).toContain("NAMED STOP [FALLBACK_UNAVAILABLE]");
  });
  it("the other direction: a Codex pass that runs out of usage, with Claude signed in, reruns once on Claude", () => {
    expect(script).toContain('if [ "$RUNNER" = "codex" ] && [ -z "${FALLBACK:-}" ] && claude_signed_in; then');
    expect(script).toContain('FALLBACK="claude"');
    const fb = script.slice(script.indexOf("# THE FALLBACK"));
    expect(fb).toContain('elif [ "${FALLBACK:-}" = "claude" ] && ! has_sentinel "$RUN_LOG" && usage_exhausted "$RUN_LOG"; then');
    expect(fb).toContain('RUNNER="claude"; run_claude; RC=$?');
  });
  it("the sentinel is a result, not the prompt's own <n> template echoed by codex exec", () => {
    expect(script).toContain("has_sentinel() { grep -qE 'AHREFS-AUDIT-COMPLETE: projects=[0-9]' \"$1\"; }");
    expect(script).toMatch(/usage_exhausted\(\) \{ grep -qiE "usage limit\|limit reached\|out of \(extra \)\?usage\|rate\.\?limit\|credit balance" "\$1"; \}/);
    expect(script).not.toMatch(/grep -q "AHREFS-AUDIT-COMPLETE:"/);
  });
  it("every runner out of usage: NAMED STOP [AI_USAGE_EXHAUSTED], exit 13, never a stack trace from a missing findings file", () => {
    expect(script).toContain("NAMED STOP [AI_USAGE_EXHAUSTED]");
    expect(script).toMatch(/USAGE_EXHAUSTED=1[\s\S]*?exit 13/);
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
