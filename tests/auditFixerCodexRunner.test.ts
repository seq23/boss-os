import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Owner, 27 Oct 2026: the search-fix passes may run on Codex (her ChatGPT plan) while Claude usage
// is spent. Codex cannot reach the claude.ai Gmail connector, so an unscoped mail pass on Codex must
// stop by name, never run blind or skip silently.
const script = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");

describe("audit fixer: Codex runner", () => {
  it("runs the same prompt through codex exec when BOSS_AI_RUNNER=codex", () => {
    expect(script).toContain('RUNNER="${BOSS_AI_RUNNER:-claude}"');
    expect(script).toMatch(/"\$CODEX" exec -s danger-full-access -c model_reasoning_effort=high "\$PROMPT_TEXT" < \/dev\/null >> "\$RUN_LOG"/);
  });
  it("refuses the Ahrefs-mail pass on Codex with a named stop", () => {
    const codexBlock = script.slice(script.indexOf('if [ "$RUNNER" = "codex" ]; then'), script.indexOf('elif ! security find-generic-password'));
    expect(codexBlock).toContain('if [ -z "${SR_SCOPE_REPO:-}" ]; then');
    expect(codexBlock).toContain("NAMED STOP [MAIL_PASS_NEEDS_CLAUDE]");
    expect(codexBlock).toContain("NAMED STOP [CODEX_NOT_AUTHENTICATED]");
  });
  it("keeps Claude the default runner", () => {
    expect(script).toMatch(/"\$CLAUDE" -p "\$PROMPT_TEXT" \\\n  --model "\$MODEL"/);
  });
});
